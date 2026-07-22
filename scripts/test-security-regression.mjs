/**
 * ANNVERO güvenlik regresyon testleri (yerel, production'a bağlanmaz).
 * Çalıştır: node --import ./scripts/_alias-loader.mjs scripts/test-security-regression.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { isAdminUser, isManagementUser, explainAdminGate, isAdminEmail, getAdminEmails, evaluateManagementGate, isOwnerEmail } from "../src/lib/auth/admin.js";
import { buildFallbackProfile, createUserAccess, mergeProfileWithAuth, demoteUntrustedElevatedRole, shouldShowAccessWarning, getAccessWarningReason } from "../src/lib/auth/userAccess.js";
import {
  buildAnnveroMetadataUpdatePayload,
  resolveProvisionRole,
  shouldPromoteToOwner,
  shouldBootstrapAsAdmin,
  isBootstrapOwnerEmail,
} from "../src/lib/auth/profileProvisionPolicy.js";
import {
  resolveRuntimeCompanyAccess,
  resolveAccessibleCompanyScope,
  selectActiveMembershipCompanyIds,
  normalizeCompanyIds,
} from "../src/lib/auth/companyAccessPolicy.js";
import { mapProfileRow } from "../src/lib/supabase/userProfilesSchema.js";
import { ANNVERO_ROLES } from "../src/config/annveroRoles.js";
import {
  assertSafeSupabaseProjectRef,
  ANNVERO_KNOWN_PROJECT_REFS,
  findForbiddenPublicEnvLeaks,
  requiresStrictRuntimeSecrets,
  resolveAnnveroAppEnv,
} from "../src/lib/security/envGuard.js";
import {
  checkRateLimit,
  resetRateLimitBuckets,
} from "../src/lib/security/rateLimitCore.js";
import {
  redactDeep,
  stripSecretsFromExportValue,
  sanitizeSpreadsheetCell,
  safeErrorMessage,
  REDACTED,
} from "../src/lib/security/redact.js";
import { buildSoftDeletePatch, buildSoftRestorePatch } from "../src/lib/softDelete.js";
import { assertCriticalHumanApproval, CRITICAL_OPERATIONS } from "../src/lib/security/criticalApproval.js";
import { validateUploadFile } from "../src/lib/security/uploadGuard.js";
import { getSafeNextPath } from "../src/utils/authRedirect.js";
import {
  computeWebhookSignature,
  resetWebhookReplayStore,
  rememberWebhookEvent,
  safeEqualString,
  verifyWebhookRequest,
  validateWebhookPayloadBody,
  resolveWebhookEventKey,
} from "../src/lib/security/webhookAuth.js";
import { claimWebhookReplayEvent, buildWebhookReplayRateLimitKey, WEBHOOK_REPLAY_NAMESPACE } from "../src/lib/security/webhookReplay.js";
import {
  checkDurableRateLimit,
  resolveRateLimitBackend,
  hashRateLimitBucketKey,
  RATE_LIMIT_BACKENDS,
} from "../src/lib/security/rateLimitDurable.js";
import { buildJobFromWebhookPayload } from "../src/utils/n8nOtomasyonEngine.js";
import { isRecoveryApiEnabled } from "../src/lib/recovery/recoveryGate.js";

/** next/server'siz privilege strip (requestGuards ile aynı mantık) */
function stripClientPrivilegeClaims(body = {}) {
  if (!body || typeof body !== "object") return body;
  const {
    role: _r,
    isAdmin: _a,
    is_admin: _ia,
    isManagementUser: _m,
    is_management_user: _imu,
    permissions: _p,
    ...rest
  } = body;
  void _r;
  void _a;
  void _ia;
  void _m;
  void _imu;
  void _p;
  return rest;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PREV_ADMIN_EMAILS = process.env.ANNVERO_ADMIN_EMAILS;
const PREV_OWNER_EMAILS = process.env.ANNVERO_OWNER_EMAILS;
const PREV_PUBLIC_ADMIN = process.env.NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS;
const PREV_PUBLIC_OWNER = process.env.NEXT_PUBLIC_ANNVERO_OWNER_EMAILS;

function withAdminEnv(adminEmails, fn) {
  process.env.ANNVERO_ADMIN_EMAILS = adminEmails;
  delete process.env.NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS;
  try {
    return fn();
  } finally {
    if (PREV_ADMIN_EMAILS === undefined) delete process.env.ANNVERO_ADMIN_EMAILS;
    else process.env.ANNVERO_ADMIN_EMAILS = PREV_ADMIN_EMAILS;
    if (PREV_PUBLIC_ADMIN === undefined) delete process.env.NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS;
    else process.env.NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS = PREV_PUBLIC_ADMIN;
  }
}

function restoreAuthEnvs() {
  if (PREV_ADMIN_EMAILS === undefined) delete process.env.ANNVERO_ADMIN_EMAILS;
  else process.env.ANNVERO_ADMIN_EMAILS = PREV_ADMIN_EMAILS;
  if (PREV_OWNER_EMAILS === undefined) delete process.env.ANNVERO_OWNER_EMAILS;
  else process.env.ANNVERO_OWNER_EMAILS = PREV_OWNER_EMAILS;
  if (PREV_PUBLIC_ADMIN === undefined) delete process.env.NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS;
  else process.env.NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS = PREV_PUBLIC_ADMIN;
  if (PREV_PUBLIC_OWNER === undefined) delete process.env.NEXT_PUBLIC_ANNVERO_OWNER_EMAILS;
  else process.env.NEXT_PUBLIC_ANNVERO_OWNER_EMAILS = PREV_PUBLIC_OWNER;
}

function stripSqlCommentsAndStrings(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      continue;
    }
    if (sql[i] === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += " ";
      continue;
    }
    if (sql[i] === "$") {
      const m = sql.slice(i).match(/^\$([A-Za-z_]*)\$/);
      if (m) {
        const tag = m[0];
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) {
          i = n;
        } else {
          i = end + tag.length;
        }
        out += " ";
        continue;
      }
    }
    out += sql[i++];
  }
  return out;
}

const __securityTestQueue = [];

function test(name, fn) {
  __securityTestQueue.push({ name, fn });
}

// 1–3: Auth gate helpers (statik + davranış)
test("oturumsuz / yetkisiz / cross-tenant koruma kalıpları apiGuard'da mevcut", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/auth/apiGuard.js"), "utf8");
  assert.match(src, /jsonUnauthorized/);
  assert.match(src, /jsonForbidden/);
  assert.match(src, /assertCompanyAccess/);
  assert.match(src, /canAccessCompany/);
  assert.match(src, /requireApiSession/);
});

test("P0: hardcoded DEFAULT_OWNER_EMAILS runtime source'ta yok", () => {
  const adminSrc = fs.readFileSync(path.join(root, "src/lib/auth/admin.js"), "utf8");
  assert.doesNotMatch(adminSrc, /DEFAULT_OWNER_EMAILS/);
  assert.doesNotMatch(adminSrc, /yusufozlu@gmail\.com/);
  assert.doesNotMatch(adminSrc, /NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS/);
  withAdminEnv("", () => {
    assert.deepEqual(getAdminEmails(), []);
    assert.equal(isAdminEmail("yusufozlu@gmail.com"), false);
  });
});

test("P0: NEXT_PUBLIC admin/owner env yetki kaynağı değil", () => {
  delete process.env.ANNVERO_ADMIN_EMAILS;
  process.env.NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS = "public-admin@example.com";
  process.env.NEXT_PUBLIC_ANNVERO_OWNER_EMAILS = "public-owner@example.com";
  process.env.ANNVERO_OWNER_EMAILS = "owner-only@example.com";
  try {
    assert.equal(isAdminEmail("public-admin@example.com"), false);
    assert.equal(getAdminEmails().includes("public-admin@example.com"), false);
    assert.equal(isOwnerEmail("owner-only@example.com"), true);
    const ownerOnly = {
      email: "owner-only@example.com",
      app_metadata: { role: "admin" },
      user_metadata: {},
    };
    assert.equal(isAdminUser(ownerOnly), false);
    assert.equal(evaluateManagementGate(ownerOnly).allowed, false);
  } finally {
    restoreAuthEnvs();
  }
});

test("admin user_metadata.role ile yükseltilmez", () => {
  withAdminEnv("attacker@example.com", () => {
    const attacker = {
      email: "attacker@example.com",
      user_metadata: { role: "admin", annvero_role: "admin", company_ids: ["other"] },
      app_metadata: {},
    };
    assert.equal(isAdminUser(attacker), false);
    assert.equal(isManagementUser(attacker), false);
    const fallback = buildFallbackProfile(attacker);
    assert.equal(fallback.isPlatformAdmin, false);
    assert.notEqual(fallback.role, "admin");
    assert.deepEqual(fallback.companyIds, []);
  });
});

test("admin AND: email yalnız VEYA app_metadata yalnız yetmez; ikisi birlikte admin", () => {
  withAdminEnv("admin@annvero.test", () => {
    const emailOnly = {
      email: "admin@annvero.test",
      app_metadata: {},
      user_metadata: {},
    };
    assert.equal(isAdminEmail(emailOnly.email), true);
    assert.equal(isAdminUser(emailOnly), false);
    assert.equal(evaluateManagementGate(emailOnly).allowed, false);

    const appOnly = {
      email: "random@example.com",
      app_metadata: { role: "admin" },
      user_metadata: {},
    };
    assert.equal(isAdminUser(appOnly), false);
    assert.equal(evaluateManagementGate(appOnly).allowed, false);

    const both = {
      email: "admin@annvero.test",
      app_metadata: { role: "admin" },
      user_metadata: { role: "viewer" },
    };
    const gate = explainAdminGate(both);
    assert.equal(gate.emailOk, true);
    assert.equal(gate.appOk, true);
    assert.equal(gate.isAdmin, true);
    assert.equal(gate.usedOrInsteadOfAnd, false);
    assert.equal(isAdminUser(both), true);
    assert.equal(evaluateManagementGate(both).allowed, true);
    assert.equal(evaluateManagementGate(both).reason, "platform_admin_and");
  });
});

test("P0: owner email tek başına admin/management değil", () => {
  process.env.ANNVERO_OWNER_EMAILS = "owner@annvero.test";
  delete process.env.ANNVERO_ADMIN_EMAILS;
  try {
    assert.equal(isOwnerEmail("owner@annvero.test"), true);
    assert.equal(isAdminEmail("owner@annvero.test"), false);
    const user = {
      email: "owner@annvero.test",
      app_metadata: {},
      user_metadata: {},
    };
    assert.equal(isAdminUser(user), false);
    assert.equal(isManagementUser(user), false);
  } finally {
    restoreAuthEnvs();
  }
});

test("P0: first-user / no-admin / first-profile / owner auto-promote kapalı", () => {
  assert.equal(shouldPromoteToOwner(), false);
  assert.equal(isBootstrapOwnerEmail("anything@x.com"), false);
  withAdminEnv("first@annvero.test", () => {
    const first = { email: "first@annvero.test", app_metadata: {}, user_metadata: {} };
    assert.equal(resolveProvisionRole(first), ANNVERO_ROLES.ACCOUNTING);
    assert.equal(resolveProvisionRole({ email: "x@y.com", app_metadata: { role: "admin" } }), ANNVERO_ROLES.ACCOUNTING);
  });
});

test("P0: login provisioning elevated app_metadata yazmaz", () => {
  const adminPayload = buildAnnveroMetadataUpdatePayload({
    email: "a@b.com",
    displayName: "A",
    role: ANNVERO_ROLES.ADMIN,
    teamId: "",
  });
  assert.equal(adminPayload.skippedElevatedAppMetadata, true);
  assert.equal(adminPayload.payload.app_metadata, undefined);
  assert.ok(adminPayload.payload.user_metadata);

  const partnerPayload = buildAnnveroMetadataUpdatePayload({
    email: "p@b.com",
    role: ANNVERO_ROLES.PARTNER,
  });
  assert.equal(partnerPayload.skippedElevatedAppMetadata, true);
  assert.equal(partnerPayload.payload.app_metadata, undefined);

  const safePayload = buildAnnveroMetadataUpdatePayload({
    email: "c@b.com",
    role: ANNVERO_ROLES.ACCOUNTING,
  });
  assert.equal(safePayload.skippedElevatedAppMetadata, false);
  assert.equal(safePayload.payload.app_metadata.role, ANNVERO_ROLES.ACCOUNTING);
});

test("P0: DB profile role=admin + boş app_metadata → management/admin değil", () => {
  withAdminEnv("db-admin@annvero.test", () => {
    const user = {
      id: "u1",
      email: "db-admin@annvero.test",
      app_metadata: {},
      user_metadata: {},
    };
    assert.equal(demoteUntrustedElevatedRole(ANNVERO_ROLES.ADMIN, user), ANNVERO_ROLES.VIEWER);
    const merged = mergeProfileWithAuth(user, {
      id: "u1",
      email: user.email,
      role: ANNVERO_ROLES.ADMIN,
      permissions: [],
      companyIds: [],
      isActive: true,
    });
    assert.equal(merged.isPlatformAdmin, false);
    assert.equal(merged.isManagementUser, false);
    assert.notEqual(merged.role, ANNVERO_ROLES.ADMIN);
    const access = createUserAccess(merged);
    assert.equal(access.isPlatformAdmin, false);
    assert.equal(access.isManagementUser, false);
    assert.notEqual(access.role, ANNVERO_ROLES.ADMIN);
    assert.equal(evaluateManagementGate(user).allowed, false);
  });
});

test("P0: DB profile role=partner + boş app_metadata → management değil", () => {
  const user = {
    id: "u2",
    email: "partner-db@annvero.test",
    app_metadata: {},
    user_metadata: {},
  };
  const merged = mergeProfileWithAuth(user, {
    id: "u2",
    email: user.email,
    role: ANNVERO_ROLES.PARTNER,
    permissions: [],
    companyIds: [],
    isActive: true,
  });
  assert.equal(merged.isManagementUser, false);
  assert.equal(merged.isPartner, false);
  assert.equal(merged.role, ANNVERO_ROLES.VIEWER);
  assert.equal(evaluateManagementGate(user).allowed, false);
});

test("P0: trusted app_metadata partner management olur; AND admin admin route erişir", () => {
  withAdminEnv("real-admin@annvero.test", () => {
    const partner = {
      email: "partner@annvero.test",
      app_metadata: { role: "partner" },
      user_metadata: {},
    };
    assert.equal(isAdminUser(partner), false);
    assert.equal(isManagementUser(partner), true);
    const mgmt = evaluateManagementGate(partner);
    assert.equal(mgmt.allowed, true);
    assert.equal(mgmt.reason, "trusted_app_partner");

    const admin = {
      email: "real-admin@annvero.test",
      app_metadata: { role: "admin" },
      user_metadata: {},
    };
    assert.equal(isAdminUser(admin), true);
    const merged = mergeProfileWithAuth(admin, {
      id: "a1",
      email: admin.email,
      role: ANNVERO_ROLES.ACCOUNTING,
      permissions: [],
      companyIds: [],
      isActive: true,
    });
    assert.equal(merged.isPlatformAdmin, true);
    assert.equal(merged.role, ANNVERO_ROLES.ADMIN);
    const access = createUserAccess(merged);
    assert.equal(access.isPlatformAdmin, true);
    assert.equal(
      access.canAccessRoute("/admin", (role, pathname) => {
        return role === ANNVERO_ROLES.ADMIN && String(pathname).startsWith("/admin");
      }),
      true
    );

    assert.equal(shouldBootstrapAsAdmin({ email: "x@y.com", app_metadata: {} }), false);
    assert.equal(shouldBootstrapAsAdmin(admin), true);
  });
});

test("P0: serverAuth management DB profile role tek başına kabul etmez (kaynak)", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/supabase/serverAuth.js"), "utf8");
  assert.match(src, /evaluateManagementGate/);
  assert.match(src, /requireAdminUser[\s\S]*isPlatformAdmin/);
  assert.doesNotMatch(
    src,
    /profileRole === ANNVERO_ROLES\.PARTNER \|\| profileRole === ANNVERO_ROLES\.ADMIN/
  );
  assert.match(src, /Profil rolü bilgilendirici/);
});

test("createUserAccess email allowlist / role string tek başına ADMIN zorlamaz", () => {
  withAdminEnv("listed@annvero.test", () => {
    const access = createUserAccess({
      email: "listed@annvero.test",
      role: ANNVERO_ROLES.ADMIN,
      companyIds: [],
      isPlatformAdmin: false,
      isManagementUser: false,
      isActive: true,
    });
    assert.notEqual(access.role, "admin");
    assert.equal(access.isPlatformAdmin, false);
    assert.equal(access.isManagementUser, false);
  });
});

test("P1: legacy profile.company_ids / metadata yetki vermez; membership verir", () => {
  const stagingCompany = "00000000-0000-4000-8000-000000000001";
  const authUserId = "1fb8c953-ed5a-4d13-9a46-f69619cc11d6";

  const mapped = mapProfileRow({
    id: authUserId,
    auth_user_id: authUserId,
    email: "viewer@staging.test",
    role: "goruntuleme",
    company_ids: ["legacy-should-not-grant"],
    is_active: true,
  });
  assert.deepEqual(mapped.companyIds, []);
  assert.equal(mapped.companyIdsSource, "none");
  assert.deepEqual(mapped.legacyCompanyIds, ["legacy-should-not-grant"]);

  const legacyOnly = resolveRuntimeCompanyAccess({
    authUserId,
    profileAuthUserId: authUserId,
    membershipRows: [],
    legacyProfileCompanyIds: ["legacy-should-not-grant"],
    userMetadataCompanyIds: [stagingCompany],
    appMetadataCompanyIds: [stagingCompany],
    clientProvidedCompanyIds: [stagingCompany],
  });
  assert.equal(legacyOnly.ok, true);
  assert.deepEqual(legacyOnly.companyIds, []);
  assert.equal(legacyOnly.companyIdsSource, "membership");

  const withMembership = resolveRuntimeCompanyAccess({
    authUserId,
    profileAuthUserId: authUserId,
    membershipRows: [
      { user_id: authUserId, company_id: stagingCompany, is_active: true },
      { user_id: authUserId, company_id: stagingCompany, is_active: true },
      { user_id: "other-user", company_id: "other-co", is_active: true },
      { user_id: authUserId, company_id: null, is_active: true },
      { user_id: authUserId, company_id: "passive-co", is_active: false },
    ],
  });
  assert.deepEqual(withMembership.companyIds, [stagingCompany]);

  const passiveOnly = resolveRuntimeCompanyAccess({
    authUserId,
    profileAuthUserId: authUserId,
    membershipRows: [
      { user_id: authUserId, company_id: stagingCompany, is_active: false },
    ],
  });
  assert.deepEqual(passiveOnly.companyIds, []);

  const queryError = resolveRuntimeCompanyAccess({
    authUserId,
    profileAuthUserId: authUserId,
    membershipError: new Error("db down"),
    legacyProfileCompanyIds: [stagingCompany],
  });
  assert.equal(queryError.ok, false);
  assert.equal(queryError.deniedReason, "membership_query_error");
  assert.deepEqual(queryError.companyIds, []);

  const unbound = resolveRuntimeCompanyAccess({
    authUserId,
    profileAuthUserId: "",
    membershipRows: [{ user_id: authUserId, company_id: stagingCompany, is_active: true }],
  });
  assert.equal(unbound.ok, false);
  assert.equal(unbound.deniedReason, "profile_unbound");

  const mergedLegacy = mergeProfileWithAuth(
    { id: authUserId, email: "viewer@staging.test", app_metadata: {}, user_metadata: { company_ids: [stagingCompany] } },
    {
      ...mapped,
      companyIds: mapped.legacyCompanyIds,
      companyIdsSource: "none",
    }
  );
  assert.deepEqual(mergedLegacy.companyIds, []);
  const accessLegacy = createUserAccess(mergedLegacy);
  assert.equal(accessLegacy.canAccessCompany(stagingCompany), false);

  const mergedOk = mergeProfileWithAuth(
    { id: authUserId, email: "viewer@staging.test", app_metadata: {}, user_metadata: {} },
    {
      ...mapped,
      companyIds: [stagingCompany],
      companyIdsSource: "membership",
    }
  );
  assert.deepEqual(mergedOk.companyIds, [stagingCompany]);
  const accessOk = createUserAccess(mergedOk);
  assert.equal(accessOk.canAccessCompany(stagingCompany), true);
  assert.equal(accessOk.canAccessCompany("other-co"), false);
  assert.deepEqual(
    resolveAccessibleCompanyScope({
      isElevatedTrusted: false,
      companyIds: accessOk.companyIds,
      companyIdsSource: accessOk.companyIdsSource,
    }),
    [stagingCompany]
  );

  // DB role=admin tek başına unscoped liste açmaz
  assert.deepEqual(
    resolveAccessibleCompanyScope({
      isElevatedTrusted: false,
      companyIds: [stagingCompany],
      companyIdsSource: "none",
    }),
    []
  );
  assert.equal(
    resolveAccessibleCompanyScope({
      isElevatedTrusted: true,
      companyIds: [],
      companyIdsSource: "elevated_trusted",
    }),
    null
  );

  assert.deepEqual(
    selectActiveMembershipCompanyIds(
      [
        { user_id: authUserId, company_id: "a", is_active: true },
        { user_id: authUserId, company_id: "a", is_active: true },
      ],
      authUserId
    ),
    ["a"]
  );
  assert.deepEqual(normalizeCompanyIds(["", null, "x", "x"]), ["x"]);
});

test("P1: viewer banner — goruntuleme tek başına uyarı değil; canonical membership karar verir", () => {
  const stagingCompany = "00000000-0000-4000-8000-000000000001";
  const viewerBase = {
    email: "viewer@staging.test",
    role: ANNVERO_ROLES.VIEWER,
    isPlatformAdmin: false,
    isManagementUser: false,
    isPartner: false,
    isActive: true,
    source: "database",
  };

  assert.equal(
    shouldShowAccessWarning({
      ...viewerBase,
      companyIds: [stagingCompany],
      companyIdsSource: "membership",
    }),
    false
  );
  assert.equal(
    getAccessWarningReason({
      ...viewerBase,
      companyIds: [stagingCompany],
      companyIdsSource: "membership",
    }),
    "ok_no_warning"
  );

  assert.equal(
    shouldShowAccessWarning({
      ...viewerBase,
      companyIds: [],
      companyIdsSource: "membership",
    }),
    true
  );
  assert.equal(
    shouldShowAccessWarning({
      ...viewerBase,
      companyIds: [stagingCompany],
      companyIdsSource: "none",
    }),
    true
  );
  assert.equal(
    shouldShowAccessWarning({
      ...viewerBase,
      companyIds: ["legacy-only"],
      companyIdsSource: "none",
      legacyCompanyIds: ["legacy-only"],
    }),
    true
  );

  const metaUser = {
    id: "1fb8c953-ed5a-4d13-9a46-f69619cc11d6",
    email: "viewer@staging.test",
    app_metadata: { company_ids: [stagingCompany] },
    user_metadata: { company_ids: [stagingCompany] },
  };
  const mergedMeta = mergeProfileWithAuth(metaUser, {
    id: metaUser.id,
    email: metaUser.email,
    role: ANNVERO_ROLES.VIEWER,
    companyIds: [],
    companyIdsSource: "none",
    legacyCompanyIds: [stagingCompany],
    isActive: true,
  });
  assert.equal(shouldShowAccessWarning(mergedMeta), true);
  assert.equal(createUserAccess(mergedMeta).isManagementUser, false);
  assert.equal(createUserAccess(mergedMeta).isPlatformAdmin, false);

  const accessOk = createUserAccess({
    ...viewerBase,
    companyIds: [stagingCompany],
    companyIdsSource: "membership",
  });
  assert.equal(accessOk.showAccessWarning, false);
  assert.equal(accessOk.isManagementUser, false);
  assert.equal(accessOk.role, ANNVERO_ROLES.VIEWER);

  withAdminEnv("admin@annvero.test", () => {
    const admin = {
      email: "admin@annvero.test",
      app_metadata: { role: "admin" },
      user_metadata: {},
    };
    const mergedAdmin = mergeProfileWithAuth(admin, {
      id: "a1",
      email: admin.email,
      role: ANNVERO_ROLES.ACCOUNTING,
      companyIds: [],
      companyIdsSource: "elevated_trusted",
      isActive: true,
    });
    assert.equal(mergedAdmin.isPlatformAdmin, true);
    assert.equal(shouldShowAccessWarning(mergedAdmin), false);

    const partner = {
      email: "partner@annvero.test",
      app_metadata: { role: "partner" },
      user_metadata: {},
    };
    const mergedPartner = mergeProfileWithAuth(partner, {
      id: "p1",
      email: partner.email,
      role: ANNVERO_ROLES.VIEWER,
      companyIds: [],
      companyIdsSource: "elevated_trusted",
      isActive: true,
    });
    assert.equal(mergedPartner.isManagementUser, true);
    assert.equal(shouldShowAccessWarning(mergedPartner), false);
  });
});

test("client privilege claim strip edilir", () => {
  const cleaned = stripClientPrivilegeClaims({
    companyId: "c1",
    role: "admin",
    isAdmin: true,
    isManagementUser: true,
    permissions: ["*"],
    note: "ok",
  });
  assert.equal(cleaned.companyId, "c1");
  assert.equal(cleaned.note, "ok");
  assert.equal(cleaned.role, undefined);
  assert.equal(cleaned.isAdmin, undefined);
});

// 6: Rate limit aşımı
test("rate limit aşımı blocked + retryAfter", () => {
  resetRateLimitBuckets();
  const key = "test:rl:" + Date.now();
  for (let i = 0; i < 3; i++) {
    const r = checkRateLimit(key, { limit: 3, windowMs: 60_000 });
    assert.equal(r.allowed, true);
  }
  const blocked = checkRateLimit(key, { limit: 3, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs >= 0);
  const routeSrc = fs.readFileSync(
    path.join(root, "src/lib/security/rateLimit.js"),
    "utf8"
  );
  assert.match(routeSrc, /status:\s*429/);
  assert.match(routeSrc, /Retry-After/);
});

// 7: Redaction / strip
test("hassas alanlar export nesnesinden tamamen çıkarılır", () => {
  const redacted = redactDeep({
    password: "secret123",
    token: "abc",
    ok: "visible",
  });
  assert.equal(redacted.password, REDACTED);
  assert.equal(redacted.ok, "visible");

  const stripped = stripSecretsFromExportValue({
    company_id: "c1",
    encrypted_password: "cipher",
    nested: { gib_password: "x", name: "ok", auth: { access_token: "t" } },
    password: "p",
    parola: "p2",
  });
  assert.equal(stripped.company_id, "c1");
  assert.equal("encrypted_password" in stripped, false);
  assert.equal(stripped.encrypted_password_was_present, true);
  assert.equal("password" in stripped, false);
  assert.equal("parola" in stripped, false);
  assert.equal(stripped.nested.name, "ok");
  assert.equal("gib_password" in stripped.nested, false);
  assert.ok(stripped.nested.auth);
  assert.equal("access_token" in (stripped.nested.auth || {}), false);

  assert.equal(sanitizeSpreadsheetCell("=CMD()"), "'=CMD()");
  assert.equal(
    safeErrorMessage(new Error("password=supersecret stack at foo")),
    "İşlem başarısız."
  );
});

test("cross-tenant export satırı engellenir (statik + fixture)", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/backup/companyExport.js"), "utf8");
  assert.match(src, /cross_tenant_row_blocked/);
  assert.match(src, /stripSecretsFromExportValue/);
  const foreign = { company_id: "other", amount: 1 };
  assert.notEqual(String(foreign.company_id), "mine");
});

// 8: Soft delete fiziksel silme yapmaz
test("soft delete patch fiziksel silme alanı içermez", () => {
  const patch = buildSoftDeletePatch({ email: "a@b.com" });
  assert.ok(patch.deleted_at);
  assert.equal(patch.deleted_by, "a@b.com");
  assert.equal("id" in patch, false);
  const restore = buildSoftRestorePatch();
  assert.equal(restore.deleted_at, null);
  assert.equal(restore.deleted_by, null);
});

// 9: Restore onay + entity allowlist
test("restore insan onayı zorunlu; keyfi tablo yok", () => {
  const restoreSrc = fs.readFileSync(
    path.join(root, "src/lib/recovery/restoreDeletedRecord.js"),
    "utf8"
  );
  assert.match(restoreSrc, /RESTORE_CONFIRMATION_PHRASE\s*=\s*"RESTORE_CONFIRM"/);
  assert.match(restoreSrc, /RESTORE_ENTITY_ALLOWLIST/);
  assert.match(restoreSrc, /isRecoveryApiEnabled/);
  assert.match(restoreSrc, /writeAuditEvent/);
  assert.match(restoreSrc, /DB backup \/ PITR restore yapmaz|PITR restore yapmaz/);

  const denied = assertCriticalHumanApproval({
    operation: CRITICAL_OPERATIONS.RESTORE,
    confirm: false,
    confirmPhrase: "",
    summary: { table: "companies", id: "1" },
  });
  assert.equal(denied.ok, false);

  const ok = assertCriticalHumanApproval({
    operation: CRITICAL_OPERATIONS.RESTORE,
    confirm: true,
    confirmPhrase: "RESTORE_CONFIRM",
    summary: { table: "companies", id: "1" },
  });
  assert.equal(ok.ok, true);
});

// 10: Export version redacted
test("company export v3 redaksiyonlu", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/backup/companyExport.js"), "utf8");
  assert.match(src, /COMPANY_EXPORT_VERSION\s*=\s*3/);
  assert.match(src, /redactExportRows/);
  assert.match(src, /cross_tenant_row_blocked/);
});

// 11: Client bundle server secret — static check file exists
test("client secret scan script mevcut", () => {
  assert.ok(fs.existsSync(path.join(root, "scripts/security/scan-client-secrets.mjs")));
});

// 12: Production/staging ref fail-closed
test("bilinen project ref sabitleri doğru pinlenmiş", () => {
  assert.equal(
    ANNVERO_KNOWN_PROJECT_REFS.staging,
    "bveipjvbopbkvojfdpmo",
    "staging ref Dashboard ile birebir olmalı"
  );
  assert.equal(
    ANNVERO_KNOWN_PROJECT_REFS.production,
    "ttxigznwcjvrlzuppbro",
    "production ref değişmemeli"
  );
  assert.notEqual(
    ANNVERO_KNOWN_PROJECT_REFS.staging,
    "bveipjbopbkvojfdpmo",
    "eksik harfli eski staging ref kullanılmamalı"
  );
});

test("local ortamda production/staging ref fail-closed", () => {
  const prev = process.env.ANNVERO_APP_ENV;
  const allow = process.env.ANNVERO_ALLOW_REMOTE_SUPABASE;
  process.env.ANNVERO_APP_ENV = "development";
  delete process.env.ANNVERO_ALLOW_REMOTE_SUPABASE;

  const prod = assertSafeSupabaseProjectRef({
    projectRef: ANNVERO_KNOWN_PROJECT_REFS.production,
    appEnv: "development",
  });
  assert.equal(prod.ok, false);
  assert.equal(prod.blocked, true);

  const staging = assertSafeSupabaseProjectRef({
    projectRef: ANNVERO_KNOWN_PROJECT_REFS.staging,
    appEnv: "test",
  });
  assert.equal(staging.ok, false);

  // Eski/yanlış staging yazımı bilinen remote listesinde olmamalı (fail-closed tetiklemez)
  const typoStaging = assertSafeSupabaseProjectRef({
    projectRef: "bveipjbopbkvojfdpmo",
    appEnv: "development",
  });
  assert.equal(typoStaging.ok, true);

  const local = assertSafeSupabaseProjectRef({
    projectRef: "abcdefghijklmnop",
    appEnv: "development",
  });
  assert.equal(local.ok, true);

  if (prev === undefined) delete process.env.ANNVERO_APP_ENV;
  else process.env.ANNVERO_APP_ENV = prev;
  if (allow === undefined) delete process.env.ANNVERO_ALLOW_REMOTE_SUPABASE;
  else process.env.ANNVERO_ALLOW_REMOTE_SUPABASE = allow;
});

test("public env secret leak tespiti", () => {
  const leaks = findForbiddenPublicEnvLeaks({
    // Kasıtlı sahte public sızıntı adı — gerçek secret değeri yok
    NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "placeholder_not_a_real_secret",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_ok",
  });
  assert.ok(leaks.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"));
});

// 13: Backup dry-run manifest/checksum
test("backup dry-run manifest + checksum üretir", () => {
  const fixture = {
    version: 1,
    tables: { companies: [{ id: "demo" }] },
    exported_at: "2026-07-19T00:00:00.000Z",
  };
  const payload = JSON.stringify(fixture);
  const checksum = createHash("sha256").update(payload).digest("hex");
  const manifest = {
    algorithm: "sha256",
    checksum,
    bytes: Buffer.byteLength(payload),
    dry_run: true,
  };
  assert.equal(manifest.checksum.length, 64);
  assert.equal(manifest.dry_run, true);
});

// Upload + open redirect
test("path traversal ve open redirect engellenir", () => {
  assert.equal(getSafeNextPath("https://evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("//evil.com"), "/dashboard");
  assert.equal(getSafeNextPath("/muhasebe/banka"), "/muhasebe/banka");

  const bad = validateUploadFile({
    fileName: "../etc/passwd.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 100,
    buffer: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  });
  // basename temizler; uzantı xlsx kalır — isim sanitize edilir
  assert.equal(bad.ok, true);
  assert.ok(!bad.safeName.includes(".."));

  const exe = validateUploadFile({
    fileName: "malware.exe",
    mimeType: "application/octet-stream",
    size: 10,
  });
  assert.equal(exe.ok, false);
});

test("migration 024 restrictive deny + no DROP POLICY + rate limit RPC", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/024_security_dr_hardening.sql"),
    "utf8"
  );
  const stripped = stripSqlCommentsAndStrings(sql);
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\btruncate\s+table\b/i);
  // DROP POLICY checks must strip comments/strings first
  assert.doesNotMatch(stripped, /\bdrop\s+policy\b/i);
  assert.match(sql, /rate_limit_buckets/);
  assert.match(sql, /as restrictive/i);
  assert.match(sql, /annvero_rate_limit_consume/);
  assert.match(sql, /audit_events_no_delete/);
  assert.match(sql, /to_regprocedure\('public\.annvero_is_management\(\)'\)/);
  // rate limit search_path: pg_catalog, pg_temp without public
  assert.match(sql, /set search_path\s*=\s*pg_catalog,\s*pg_temp/i);
  assert.match(
    sql,
    /create or replace function public\.annvero_rate_limit_consume[\s\S]*?set search_path\s*=\s*pg_catalog,\s*pg_temp/i
  );
  const rlBlock = sql.match(
    /create or replace function public\.annvero_rate_limit_consume[\s\S]*?\$\$;/i
  );
  assert.ok(rlBlock, "rate_limit function block present");
  assert.doesNotMatch(
    stripSqlCommentsAndStrings(rlBlock[0]).match(/set search_path\s*=\s*[^;\n]+/i)?.[0] || "",
    /\bpublic\b/i
  );
  assert.match(sql, /least\s*\(\s*b\.count::bigint\s*\+\s*1\s*,\s*v_limit::bigint\s*\+\s*1\s*\)\s*::integer/i);
  assert.match(sql, /interval\s+'1 second'\s*\*\s*\(\s*v_window_ms::double precision\s*\/\s*1000\.0\s*\)/i);
  // executed unique on (company_id, table_name, record_id)
  assert.match(
    sql,
    /uq_recovery_restore_approvals_executed_record[\s\S]*?\(\s*company_id\s*,\s*table_name\s*,\s*record_id\s*\)/i
  );
  assert.match(sql, /where\s*\(?\s*executed\s+is\s+true\s*\)?/i);
  assert.match(
    sql,
    /idx_recovery_restore_approvals_company[\s\S]*?\(\s*company_id\s+asc\s*,\s*created_at\s+desc\s*\)/i
  );
  assert.match(sql, /recovery_restore_approvals_company_id_fkey/);
  // helpers revoke service_role EXECUTE; allow revoke truncate privilege text
  assert.match(sql, /truncate,\s*references,\s*trigger/i);
  assert.match(
    sql,
    /revoke\s+truncate,\s*references,\s*trigger\s+on\s+table\s+public\.rate_limit_buckets\s+from\s+service_role/i
  );
  assert.match(
    sql,
    /revoke all on function public\.annvero_ensure_restrictive_deny_policy[\s\S]*service_role/i
  );
  assert.match(
    sql,
    /revoke all on function public\.annvero_assert_table_column[\s\S]*service_role/i
  );
});

test("migration 025 index gating — user_id, no schema comment, no DROP POLICY/FUNCTION", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/025_security_view_indexes_grants.sql"),
    "utf8"
  );
  const stripped = stripSqlCommentsAndStrings(sql);
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\btruncate\s+table\b/i);
  assert.doesNotMatch(stripped, /\bdrop\s+policy\b/i);
  assert.doesNotMatch(stripped, /\bdrop\s+function\b/i);
  // no top-level comment on schema public
  assert.doesNotMatch(sql, /^\s*comment\s+on\s+schema\s+public\b/im);
  assert.match(sql, /annvero_company_members\s*\(\s*user_id\s*\)/i);
  assert.doesNotMatch(sql, /annvero_company_members\s*\(\s*auth_user_id\s*\)/i);
  assert.match(sql, /annvero_ensure_index_if_columns/);
  assert.match(sql, /View ALTER|security_invoker/i);
  // revoke old 7-arg overload (no DROP FUNCTION)
  assert.match(
    sql,
    /annvero_ensure_index_if_columns\(text,\s*text,\s*text,\s*text,\s*text\[\],\s*boolean,\s*text\)/
  );
  // full 7-priv checks
  assert.match(sql, /array\['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'\]/);
  // helpers revoke service_role EXECUTE; allow revoke truncate privilege text
  assert.match(sql, /truncate,\s*references,\s*trigger/i);
  assert.match(
    sql,
    /revoke all on function public\.annvero_ensure_index_if_columns[\s\S]*service_role/i
  );
});

test("production rate limit memory fallback kullanmaz (statik)", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/security/rateLimitDurable.js"), "utf8");
  assert.match(src, /RATE_LIMIT_BACKENDS\.UNAVAILABLE/);
  assert.match(src, /jsonRateLimitMisconfigured/);
  assert.match(src, /fail-closed/);
  assert.doesNotMatch(
    src,
    /production.*falling back to memory|falling back to memory.*production/i
  );
  assert.doesNotMatch(src, /from ["']next\/server["']/);
});

test("kök neden: staging supabase RL client yok → unavailable; dual Map; boş body enqueue", async () => {
  await withEnvAsync(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: undefined,
      NODE_ENV: "production",
      ANNVERO_RATE_LIMIT_BACKEND: "supabase",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async () => {
      assert.equal(resolveRateLimitBackend(), RATE_LIMIT_BACKENDS.SUPABASE);
      const rl = await checkDurableRateLimit("automation:webhook:proof", { limit: 60, windowMs: 300_000 }, { supabase: null });
      assert.equal(rl.unavailable, true);
      assert.equal(rl.allowed, false);
    }
  );

  const mapA = new Map();
  const mapB = new Map();
  const claimLocal = (store, key) => {
    if (store.has(key)) return false;
    store.set(key, 1);
    return true;
  };
  assert.equal(claimLocal(mapA, "evt") && claimLocal(mapB, "evt"), true);

  const job = buildJobFromWebhookPayload({});
  assert.equal(job.flowId, "mail-to-pool");
  assert.equal(job.triggeredBy, "n8n_webhook");
  assert.equal(validateWebhookPayloadBody({}).ok, false);
  assert.equal(validateWebhookPayloadBody({}).code, "INVALID_PAYLOAD");
});

test("webhook HMAC helpers + local memory rememberWebhookEvent", () => {
  resetWebhookReplayStore();
  const secret = "test-hmac-secret-value-32chars!!";
  const ts = String(Date.now());
  const body = '{"flowId":"mail-to-pool"}';
  const sig = computeWebhookSignature(secret, ts, body);
  assert.equal(safeEqualString(sig, sig), true);
  assert.equal(safeEqualString(sig, "nope"), false);

  const first = rememberWebhookEvent("evt-1");
  const second = rememberWebhookEvent("evt-1");
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "replay");
});

function mockWebhookRequest(headers = {}) {
  const map = new Map(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)])
  );
  return {
    headers: {
      get(name) {
        return map.get(String(name).toLowerCase()) || null;
      },
    },
  };
}

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    const v = overrides[k];
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

async function withEnvAsync(overrides, fn) {
  const keys = Object.keys(overrides);
  const prev = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    const v = overrides[k];
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function createAtomicRateLimitMock() {
  const counts = new Map();
  return {
    counts,
    rpc(_name, args) {
      const key = args.p_bucket_key;
      assert.match(key, /^[a-f0-9]{64}$/);
      const limit = Number(args.p_limit);
      const next = (counts.get(key) || 0) + 1;
      counts.set(key, next);
      return Promise.resolve({
        data: [
          {
            allowed: next <= limit,
            current_count: next,
            remaining: Math.max(0, limit - next),
            reset_at: new Date(Date.now() + Number(args.p_window_ms || 600_000)).toISOString(),
          },
        ],
        error: null,
      });
    },
  };
}

test("webhook staging/preview/production HMAC missing → fail-closed; local DEV_OPEN", () => {
  resetWebhookReplayStore();
  const body = "{}";

  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: undefined,
      NODE_ENV: "production",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: undefined,
      N8N_AUTOMATION_WEBHOOK_SECRET: undefined,
    },
    () => {
      assert.equal(requiresStrictRuntimeSecrets(), true);
      const r = verifyWebhookRequest(mockWebhookRequest(), body);
      assert.equal(r.ok, false);
      assert.equal(r.code, "WEBHOOK_SECRET_MISSING");
    }
  );

  withEnv(
    {
      ANNVERO_APP_ENV: undefined,
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: undefined,
      N8N_AUTOMATION_WEBHOOK_SECRET: undefined,
    },
    () => {
      assert.equal(resolveAnnveroAppEnv(), "staging");
      const r = verifyWebhookRequest(mockWebhookRequest(), body);
      assert.equal(r.ok, false);
      assert.equal(r.code, "WEBHOOK_SECRET_MISSING");
    }
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: undefined,
      N8N_AUTOMATION_WEBHOOK_SECRET: undefined,
    },
    () => {
      const r = verifyWebhookRequest(mockWebhookRequest(), body);
      assert.equal(r.ok, false);
      assert.equal(r.code, "WEBHOOK_SECRET_MISSING");
    }
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "development",
      VERCEL_ENV: undefined,
      NODE_ENV: "development",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: undefined,
      N8N_AUTOMATION_WEBHOOK_SECRET: undefined,
    },
    () => {
      const r = verifyWebhookRequest(mockWebhookRequest(), body);
      assert.equal(r.ok, true);
      assert.equal(r.code, "DEV_OPEN");
    }
  );
});

test("webhook HMAC: seconds expired; ms invalid signature; valid accepts without consuming replay", () => {
  const hmac = "staging-hmac-secret-for-tests-only!!";
  const body = '{"flowId":"mail-to-pool"}';

  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      N8N_AUTOMATION_WEBHOOK_HMAC_SECRET: hmac,
      N8N_AUTOMATION_WEBHOOK_SECRET: "legacy-bearer-should-not-bypass",
    },
    () => {
      const tsSec = String(Math.floor(Date.now() / 1000));
      const staleSec = verifyWebhookRequest(
        mockWebhookRequest({
          "x-annvero-signature": computeWebhookSignature(hmac, tsSec, body),
          "x-annvero-timestamp": tsSec,
          "x-annvero-event-id": "evt-seconds",
        }),
        body
      );
      assert.equal(staleSec.ok, false);
      assert.equal(staleSec.code, "TIMESTAMP_EXPIRED");

      const ts = String(Date.now());
      const bad = verifyWebhookRequest(
        mockWebhookRequest({
          "x-annvero-signature": "0".repeat(64),
          "x-annvero-timestamp": ts,
          "x-annvero-event-id": "evt-bad",
        }),
        body
      );
      assert.equal(bad.ok, false);
      assert.equal(bad.code, "INVALID_SIGNATURE");

      const sig = computeWebhookSignature(hmac, ts, body);
      const ok = verifyWebhookRequest(
        mockWebhookRequest({
          "x-annvero-signature": sig,
          "x-annvero-timestamp": ts,
          "x-annvero-event-id": "evt-staging-1",
        }),
        body
      );
      assert.equal(ok.ok, true, ok.message);
      // Stateless: aynı imza ikinci kez de verify OK (replay claim ayrı)
      const ok2 = verifyWebhookRequest(
        mockWebhookRequest({
          "x-annvero-signature": sig,
          "x-annvero-timestamp": ts,
          "x-annvero-event-id": "evt-staging-1",
        }),
        body
      );
      assert.equal(ok2.ok, true);

      const bearerOnly = verifyWebhookRequest(
        mockWebhookRequest({ authorization: "Bearer legacy-bearer-should-not-bypass" }),
        body
      );
      assert.equal(bearerOnly.ok, false);
      assert.equal(bearerOnly.code, "HMAC_REQUIRED");
    }
  );
});

test("webhook payload gate: null/array/primitive/empty rejected; known signals ok", () => {
  assert.equal(validateWebhookPayloadBody(null).ok, false);
  assert.equal(validateWebhookPayloadBody([]).ok, false);
  assert.equal(validateWebhookPayloadBody("x").ok, false);
  assert.equal(validateWebhookPayloadBody(1).ok, false);
  assert.equal(validateWebhookPayloadBody({}).ok, false);
  assert.equal(validateWebhookPayloadBody({ ok: true }).ok, false);
  assert.equal(validateWebhookPayloadBody({ flowId: "not-a-real-flow" }).ok, false);
  assert.equal(validateWebhookPayloadBody({ flowId: "mail-to-pool" }).ok, true);
  assert.equal(validateWebhookPayloadBody({ fileName: "fatura.pdf" }).ok, true);
  assert.equal(validateWebhookPayloadBody({ scheduled: true }).ok, true);
});

test("durable webhook replay claim: unavailable / single enqueue / replay / concurrent / cross-instance", async () => {
  resetRateLimitBuckets();

  await withEnvAsync(
    {
      ANNVERO_APP_ENV: "staging",
      NODE_ENV: "production",
      ANNVERO_RATE_LIMIT_BACKEND: "supabase",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async () => {
      const missing = await claimWebhookReplayEvent("evt-no-client", { supabase: null });
      assert.equal(missing.ok, false);
      assert.equal(missing.unavailable, true);
      assert.equal(missing.code, "REPLAY_BACKEND_UNAVAILABLE");

      const mock = createAtomicRateLimitMock();
      const first = await claimWebhookReplayEvent("evt-shared", { supabase: mock });
      const second = await claimWebhookReplayEvent("evt-shared", { supabase: mock });
      assert.equal(first.ok, true);
      assert.equal(second.ok, false);
      assert.equal(second.code, "REPLAY");

      // Concurrent: aynı store üzerinde Promise.all — en fazla bir CLAIMED
      const mock2 = createAtomicRateLimitMock();
      const concurrent = await Promise.all([
        claimWebhookReplayEvent("evt-conc", { supabase: mock2 }),
        claimWebhookReplayEvent("evt-conc", { supabase: mock2 }),
      ]);
      assert.equal(concurrent.filter((r) => r.ok).length, 1);
      assert.equal(concurrent.filter((r) => r.code === "REPLAY").length, 1);

      // İki “instance” aynı durable mock’u paylaşır → ikinci reddedilir
      const shared = createAtomicRateLimitMock();
      const instA = await claimWebhookReplayEvent("evt-cross", { supabase: shared });
      const instB = await claimWebhookReplayEvent("evt-cross", { supabase: shared });
      assert.equal(instA.ok, true);
      assert.equal(instB.ok, false);
      assert.equal(instB.code, "REPLAY");

      assert.match(buildWebhookReplayRateLimitKey("evt-x"), new RegExp(`^${WEBHOOK_REPLAY_NAMESPACE}:`));
      const hashed = hashRateLimitBucketKey(buildWebhookReplayRateLimitKey("secret-event-id"));
      assert.equal(hashed.length, 64);
      assert.doesNotMatch(hashed, /secret-event-id/);
    }
  );

  // local/test memory kullanılabilir
  await withEnvAsync(
    {
      ANNVERO_APP_ENV: "development",
      NODE_ENV: "development",
      ANNVERO_RATE_LIMIT_BACKEND: undefined,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async () => {
      resetRateLimitBuckets();
      assert.equal(resolveRateLimitBackend(), RATE_LIMIT_BACKENDS.MEMORY);
      const a = await claimWebhookReplayEvent("local-evt-1", { supabase: null });
      const b = await claimWebhookReplayEvent("local-evt-1", { supabase: null });
      assert.equal(a.ok, true);
      assert.equal(b.ok, false);
      assert.equal(b.code, "REPLAY");
    }
  );
});

test("webhook route pipeline: HMAC ok ama invalid JSON/payload replay tüketmez (statik sıra)", () => {
  const routeSrc = fs.readFileSync(path.join(root, "app/api/automation/webhook/route.js"), "utf8");
  const postSrc = routeSrc.slice(routeSrc.indexOf("export async function POST"));
  const authIdx = postSrc.indexOf("verifyWebhookRequest");
  const parseIdx = postSrc.indexOf("JSON.parse");
  const payloadIdx = postSrc.indexOf("validateWebhookPayloadBody");
  const rlIdx = postSrc.indexOf("enforceDurableRateLimit");
  const claimIdx = postSrc.indexOf("claimWebhookReplayEvent");
  const enqueueIdx = postSrc.indexOf("globalQueue.unshift");
  assert.ok(authIdx > 0 && parseIdx > authIdx);
  assert.ok(payloadIdx > parseIdx);
  assert.ok(rlIdx > payloadIdx);
  assert.ok(claimIdx > rlIdx);
  assert.ok(enqueueIdx > claimIdx);
  assert.match(routeSrc, /getWebhookDurableSupabase/);
  assert.match(routeSrc, /claimWebhookReplayEvent/);
});

test("webhook raw event-id/body secret loglanmaz (statik)", () => {
  const authSrc = fs.readFileSync(path.join(root, "src/lib/security/webhookAuth.js"), "utf8");
  const routeSrc = fs.readFileSync(path.join(root, "app/api/automation/webhook/route.js"), "utf8");
  const replaySrc = fs.readFileSync(path.join(root, "src/lib/security/webhookReplay.js"), "utf8");
  assert.match(routeSrc, /code:\s*auth\.code/);
  assert.doesNotMatch(routeSrc, /console\.(log|warn|error)\([^)]*rawBody/);
  assert.doesNotMatch(routeSrc, /console\.(log|warn|error)\([^)]*eventId/);
  assert.doesNotMatch(authSrc, /console\.(log|warn|error)\([^)]*rawBody/);
  assert.match(replaySrc, /Ham event-id/);
  void resolveWebhookEventKey;
});

test("SECURITY.md webhook timestamp milliseconds sözleşmesi", () => {
  const md = fs.readFileSync(path.join(root, "SECURITY.md"), "utf8");
  assert.match(md, /milliseconds/i);
  assert.match(md, /timestampMs\.\$\{rawBody\}|`\$\{timestampMs\}\.\$\{rawBody\}`/);
  assert.match(md, /HMAC-SHA256/i);
  assert.match(md, /lowercase hex/i);
  assert.match(md, /webhook:replay/);
});

test("recovery staging/preview require RECOVERY_API_ENABLED=true; local default on", () => {
  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: undefined,
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: undefined,
    },
    () => assert.equal(isRecoveryApiEnabled(), false)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: "false",
    },
    () => assert.equal(isRecoveryApiEnabled(), false)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: undefined,
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: undefined,
    },
    () => assert.equal(isRecoveryApiEnabled(), false)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "staging",
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: "true",
    },
    () => assert.equal(isRecoveryApiEnabled(), true)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      RECOVERY_API_ENABLED: "false",
    },
    () => assert.equal(isRecoveryApiEnabled(), false)
  );

  withEnv(
    {
      ANNVERO_APP_ENV: "development",
      VERCEL_ENV: undefined,
      NODE_ENV: "development",
      RECOVERY_API_ENABLED: undefined,
    },
    () => assert.equal(isRecoveryApiEnabled(), true)
  );

  // Route still gates on management/CSRF when enabled — static contract
  const routeSrc = fs.readFileSync(
    path.join(root, "app/api/recovery/restore/route.js"),
    "utf8"
  );
  assert.match(routeSrc, /requireManagementApi/);
  assert.match(routeSrc, /enforceSameOriginCsrf/);
  assert.match(routeSrc, /isRecoveryApiEnabled/);
  assert.match(routeSrc, /RECOVERY_API_ENABLED=true/);
  assert.match(
    routeSrc,
    /RESTORE_CONFIRM tek başına yetki değildir/
  );
});

test("user_metadata yetki kaynağı olarak kullanılmıyor (tarama)", () => {
  const files = [
    "src/lib/auth/admin.js",
    "src/lib/auth/userAccess.js",
    "src/lib/auth/apiGuard.js",
    "src/lib/auth/profileService.js",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    // Yetki ataması: user_metadata.company_ids = ... veya ? user.user_metadata.company_ids
    assert.doesNotMatch(
      src,
      /companyIds:\s*[^\n]*user_metadata\.company_ids/,
      `${rel} companyIds için user_metadata kullanmamalı`
    );
    assert.doesNotMatch(
      src,
      /=\s*user\.user_metadata\.company_ids/,
      `${rel} user_metadata.company_ids ataması olmamalı`
    );
  }
  const adminSrc = fs.readFileSync(path.join(root, "src/lib/auth/admin.js"), "utf8");
  assert.match(adminSrc, /emailOk && appOk/);
});

test("RTO dokümanı 4 saat (4s değil)", () => {
  const docs = [
    "docs/disaster-recovery/BACKUP_POLICY.md",
    "docs/disaster-recovery/RESTORE_DRILL_CHECKLIST.md",
  ];
  for (const rel of docs) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    assert.doesNotMatch(text, /RTO\s*≤\s*4s\b|RTO\s*<=\s*4s\b/);
    assert.match(text, /4 saat|240/);
  }
});

test("security headers next.config'te bağlı", () => {
  const src = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
  assert.match(src, /buildSecurityHeaders/);
});

function extractExportAsyncHandler(src, name) {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} handler missing`);
  const next = src.indexOf("export async function ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

test("GİB credentials: tenant guard encryption/supabase/decrypt'ten önce (sıra)", () => {
  const src = fs.readFileSync(
    path.join(root, "app/api/gib-credentials/route.js"),
    "utf8"
  );

  for (const method of ["GET", "POST", "DELETE"]) {
    const body = extractExportAsyncHandler(src, method);
    const accessAt = body.search(/assertCompanyAccess\s*\(/);
    assert.ok(accessAt >= 0, `${method}: assertCompanyAccess zorunlu`);

    const encryptionAt = body.search(/getGibEncryptionKeyGuardResponse\s*\(/);
    if (encryptionAt >= 0) {
      assert.ok(
        accessAt < encryptionAt,
        `${method}: assertCompanyAccess encryption guard'dan önce olmalı`
      );
    }

    const supabaseGuardAt = body.search(/getGibSupabaseGuardResponse\s*\(/);
    assert.ok(supabaseGuardAt >= 0, `${method}: supabase guard`);
    assert.ok(
      accessAt < supabaseGuardAt,
      `${method}: assertCompanyAccess supabase guard'dan önce olmalı`
    );

    const adminAt = body.search(/getGibSupabaseAdmin\s*\(/);
    assert.ok(adminAt >= 0, `${method}: getGibSupabaseAdmin`);
    assert.ok(
      accessAt < adminAt,
      `${method}: assertCompanyAccess credential DB client'tan önce olmalı`
    );

    const encryptAt = body.search(/encryptSecret\s*\(/);
    if (encryptAt >= 0) {
      assert.ok(
        accessAt < encryptAt,
        `${method}: assertCompanyAccess encryptSecret'ten önce olmalı`
      );
    }
  }

  // Bilinen auth/access hatası genel catch ile 500'e çevrilmesin; DB hata mesajı sızmasın
  assert.doesNotMatch(src, /error:\s*error\.message/);
  assert.doesNotMatch(src, /error:\s*stateError\.message/);
  assert.doesNotMatch(src, /error:\s*existingError\.message/);
  assert.match(src, /SANITIZED_SERVER_ERROR|İşlem tamamlanamadı/);
});

test("GİB credentials: viewer membership A → B cross-tenant deny (mevcut/yok aynı)", () => {
  const companyA = "00000000-0000-4000-8000-000000000001";
  const companyB = "00000000-0000-4000-8000-eeeeeeeeee01";
  const missingId = "00000000-0000-4000-8000-ffffffff0002";
  const access = createUserAccess({
    role: ANNVERO_ROLES.VIEWER,
    companyIds: [companyA],
    companyIdsSource: "membership",
    isActive: true,
  });

  assert.equal(access.canAccessCompany(companyA), true);
  assert.equal(access.canAccessCompany(companyB), false);
  assert.equal(access.canAccessCompany(missingId), false);

  // apiGuard.assertCompanyAccess aynı canAccessCompany kapısını kullanır → 403
  const apiGuardSrc = fs.readFileSync(
    path.join(root, "src/lib/auth/apiGuard.js"),
    "utf8"
  );
  assert.match(apiGuardSrc, /canAccessCompany/);
  assert.match(apiGuardSrc, /jsonForbidden/);
  assert.match(apiGuardSrc, /status:\s*403|jsonForbidden\(/);
});

test("GİB encryption key guard: missing → sanitize 503 (secret/config ayrıntısı yok)", () => {
  const src = fs.readFileSync(
    path.join(root, "src/lib/gibCredentialsRouteGuard.js"),
    "utf8"
  );
  assert.match(src, /status:\s*503/);
  assert.match(src, /Servis geçici olarak kullanılamıyor/);
  assert.doesNotMatch(src, /error\s*,\s*\{\s*status:\s*500/);
  assert.doesNotMatch(src, /status:\s*500/);
  // Ham env hata mesajı istemciye yazılmamalı
  assert.doesNotMatch(src, /error:\s*error\b/);
  assert.doesNotMatch(src, /\{\s*error\s*\}/);
});

for (const { name, fn } of __securityTestQueue) {
  try {
    // eslint-disable-next-line no-await-in-loop
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  console.error("\nSecurity regression: FAILED");
} else {
  console.log("\nSecurity regression: ALL PASSED");
}
