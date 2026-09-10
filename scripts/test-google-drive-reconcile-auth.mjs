/**
 * Google Drive reconcile — system-secret auth, body validation,
 * checker bypass negatifleri, runtime side-effect=0 (DI sayaçları).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateServiceRoleRouteAuth } from "./security/check-service-role-routes.mjs";
import {
  authorizeSystemReconcileRequest,
  readSystemReconcileProvidedSecret,
  SYSTEM_RECONCILE_AUTH_CODE,
} from "../src/lib/security/systemReconcileAuth.js";
import {
  normalizeReconcileBody,
  parseReconcileRequestBody,
  RECONCILE_BODY_ERROR,
} from "../src/utils/cloudStorage/reconcileRequestBody.js";
import { RECONCILE_MAX_COMPANIES_PER_RUN } from "../src/utils/cloudStorage/reconcileBatch.js";
import { runSystemReconcile } from "../src/lib/googleDrive/runSystemReconcile.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "expected-secret-value-32chars!!";
const UUID = "11111111-1111-4111-8111-111111111111";

function mockRequest({ method = "GET", headers = {}, body } = {}) {
  const map = new Map(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)])
  );
  return {
    method,
    headers: {
      get(name) {
        return map.get(String(name).toLowerCase()) || null;
      },
    },
    async text() {
      if (body === undefined || body === null) return "";
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    async json() {
      return JSON.parse(await this.text());
    },
  };
}

async function withEnvAsync(overrides, fn) {
  const prev = {};
  for (const [key, value] of Object.entries(overrides)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createSideEffectSpies() {
  const counts = {
    getApiSupabase: 0,
    ensureCompanyDriveProvisioned: 0,
    runCompanyDriveSync: 0,
    resolveCompanyDriveConnection: 0,
    dbSelect: 0,
    dbWrite: 0,
    googleDriveApi: 0,
  };

  const supabase = {
    from() {
      return {
        select() {
          counts.dbSelect += 1;
          return {
            eq() {
              return this;
            },
            maybeSingle: async () => {
              counts.dbSelect += 1;
              return { data: null, error: null };
            },
            then: undefined,
          };
        },
        update() {
          counts.dbWrite += 1;
          return {
            eq: async () => ({ error: null }),
          };
        },
        upsert() {
          counts.dbWrite += 1;
          return { error: null };
        },
        insert() {
          counts.dbWrite += 1;
          return { error: null };
        },
      };
    },
  };

  const deps = {
    authorizeSystemReconcileRequest,
    parseReconcileRequestBody,
    enforceRateLimit: () => null,
    getApiSupabase: () => {
      counts.getApiSupabase += 1;
      return { supabase, guard: null };
    },
    resolveCompanyDriveConnection: async () => {
      counts.resolveCompanyDriveConnection += 1;
      counts.googleDriveApi += 1;
      return {
        accessToken: "tok",
        rootFolderId: "root",
        connectionId: "c1",
      };
    },
    ensureCompanyDriveProvisioned: async () => {
      counts.ensureCompanyDriveProvisioned += 1;
      counts.googleDriveApi += 1;
      return { status: "CREATED" };
    },
    runCompanyDriveSync: async () => {
      counts.runCompanyDriveSync += 1;
      counts.googleDriveApi += 1;
      counts.dbWrite += 1;
      return { stats: { created: 0 }, lastSyncAt: new Date().toISOString() };
    },
  };

  return { counts, deps };
}

function assertZeroSideEffects(counts) {
  assert.equal(counts.getApiSupabase, 0, "getApiSupabase");
  assert.equal(counts.ensureCompanyDriveProvisioned, 0, "ensure");
  assert.equal(counts.runCompanyDriveSync, 0, "sync");
  assert.equal(counts.resolveCompanyDriveConnection, 0, "resolve");
  assert.equal(counts.googleDriveApi, 0, "drive");
  assert.equal(counts.dbSelect, 0, "dbSelect");
  assert.equal(counts.dbWrite, 0, "dbWrite");
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

await test("auth: secret missing config → 503 in strict", async () => {
  await withEnvAsync(
    {
      ANNVERO_RECONCILE_SECRET: undefined,
      CRON_SECRET: undefined,
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
    },
    async () => {
      const result = authorizeSystemReconcileRequest(
        mockRequest({ headers: { authorization: "Bearer x" } })
      );
      assert.equal(result.ok, false);
      assert.equal(result.status, 503);
      assert.equal(result.body.code, SYSTEM_RECONCILE_AUTH_CODE.SECRET_MISSING);
      assert.doesNotMatch(
        JSON.stringify(result.body),
        /Bearer|CRON|ANNVERO_RECONCILE|expected-secret/
      );
    }
  );
});

await test("auth: wrong/missing/broken/multi/ambiguous → 401", async () => {
  await withEnvAsync(
    {
      ANNVERO_RECONCILE_SECRET: undefined,
      CRON_SECRET: SECRET,
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
    },
    async () => {
      const cases = [
        mockRequest({}),
        mockRequest({ headers: { authorization: "Bearer wrong" } }),
        mockRequest({ headers: { authorization: "Basic abc" } }),
        mockRequest({ headers: { authorization: "Bearer" } }),
        mockRequest({ headers: { authorization: "Bearer a, Bearer b" } }),
        mockRequest({
          headers: {
            authorization: `Bearer ${SECRET}`,
            "x-annvero-reconcile-secret": SECRET,
          },
        }),
        mockRequest({
          headers: {
            authorization: `Bearer ${SECRET}`,
            "x-annvero-reconcile-secret": "other-secret-value-32chars!!!!",
          },
        }),
        mockRequest({ headers: { "x-annvero-reconcile-secret": "a,b" } }),
        mockRequest({
          headers: { authorization: `Bearer ${SECRET} trailing` },
        }),
      ];
      for (const req of cases) {
        const result = authorizeSystemReconcileRequest(req);
        assert.equal(result.ok, false);
        assert.equal(result.status, 401);
        assert.doesNotMatch(
          JSON.stringify(result.body),
          new RegExp(SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        );
      }
    }
  );
});

await test("auth: correct single Bearer or single custom header", async () => {
  await withEnvAsync(
    {
      CRON_SECRET: SECRET,
      ANNVERO_RECONCILE_SECRET: undefined,
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
    },
    async () => {
      const bearer = authorizeSystemReconcileRequest(
        mockRequest({ headers: { authorization: `Bearer ${SECRET}` } })
      );
      assert.equal(bearer.ok, true);
      assert.equal(bearer.actor, "system");

      const custom = authorizeSystemReconcileRequest(
        mockRequest({
          headers: { "x-annvero-reconcile-secret": SECRET },
        })
      );
      assert.equal(custom.ok, true);
      assert.equal(custom.actor, "system");
    }
  );
});

await test("auth: ANNVERO_RECONCILE_SECRET precedence over CRON_SECRET", async () => {
  await withEnvAsync(
    {
      ANNVERO_RECONCILE_SECRET: "annvero-primary-secret-value!!!!",
      CRON_SECRET: SECRET,
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
    },
    async () => {
      const withCron = authorizeSystemReconcileRequest(
        mockRequest({ headers: { authorization: `Bearer ${SECRET}` } })
      );
      assert.equal(withCron.ok, false);
      const withPrimary = authorizeSystemReconcileRequest(
        mockRequest({
          headers: {
            authorization: "Bearer annvero-primary-secret-value!!!!",
          },
        })
      );
      assert.equal(withPrimary.ok, true);
    }
  );
});

await test("runtime side-effect=0: unauthorized / secret-missing / malformed / invalid body", async () => {
  await withEnvAsync(
    {
      CRON_SECRET: SECRET,
      ANNVERO_RECONCILE_SECRET: undefined,
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
    },
    async () => {
      const scenarios = [
        {
          name: "unauthorized",
          req: mockRequest({ method: "GET" }),
          expectStatus: 401,
        },
        {
          name: "malformed JSON",
          req: mockRequest({
            method: "POST",
            headers: {
              authorization: `Bearer ${SECRET}`,
              "content-type": "application/json",
            },
            body: "{not-json",
          }),
          expectStatus: 400,
        },
        {
          name: "invalid companyId",
          req: mockRequest({
            method: "POST",
            headers: {
              authorization: `Bearer ${SECRET}`,
              "content-type": "application/json",
            },
            body: { companyId: "not-a-uuid" },
          }),
          expectStatus: 400,
        },
        {
          name: "wrong content-type",
          req: mockRequest({
            method: "POST",
            headers: {
              authorization: `Bearer ${SECRET}`,
              "content-type": "text/plain",
            },
            body: '{"companyId":"' + UUID + '"}',
          }),
          expectStatus: 415,
        },
      ];

      for (const scenario of scenarios) {
        const { counts, deps } = createSideEffectSpies();
        const res = await runSystemReconcile(scenario.req, deps);
        assert.equal(res.status, scenario.expectStatus, scenario.name);
        assertZeroSideEffects(counts);
        assert.doesNotMatch(
          JSON.stringify(res.body),
          /tok|accessToken|refresh|SECRET/
        );
      }
    }
  );

  await withEnvAsync(
    {
      CRON_SECRET: undefined,
      ANNVERO_RECONCILE_SECRET: undefined,
      ANNVERO_APP_ENV: "production",
      VERCEL_ENV: "production",
    },
    async () => {
      const { counts, deps } = createSideEffectSpies();
      const res = await runSystemReconcile(
        mockRequest({
          method: "GET",
          headers: { authorization: `Bearer ${SECRET}` },
        }),
        deps
      );
      assert.equal(res.status, 503);
      assertZeroSideEffects(counts);
    }
  );
});

await test("body matrix: GET/empty POST/malformed/types/uuid/limit/cursor/proto", async () => {
  const getBody = await parseReconcileRequestBody(mockRequest({ method: "GET" }));
  assert.equal(getBody.ok, true);
  assert.equal(getBody.value.companyId, "");

  const emptyPost = await parseReconcileRequestBody(
    mockRequest({ method: "POST", body: "" })
  );
  assert.equal(emptyPost.ok, true);
  assert.equal(emptyPost.value.limit, RECONCILE_MAX_COMPANIES_PER_RUN);

  const malformed = await parseReconcileRequestBody(
    mockRequest({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    })
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, RECONCILE_BODY_ERROR.INVALID_JSON);
  assert.equal(malformed.status, 400);

  const wrongCt = await parseReconcileRequestBody(
    mockRequest({
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: '{"a":1}',
    })
  );
  assert.equal(wrongCt.ok, false);
  assert.equal(wrongCt.status, 415);

  assert.equal(normalizeReconcileBody({ companyId: 123 }).ok, false);
  assert.equal(normalizeReconcileBody({ companyId: "" }).ok, false);
  assert.equal(normalizeReconcileBody({ companyId: "abc" }).ok, false);
  assert.equal(normalizeReconcileBody({ companyId: UUID }).ok, true);
  assert.equal(normalizeReconcileBody({ cursor: "../x" }).ok, false);
  assert.equal(normalizeReconcileBody({ cursor: UUID }).ok, true);
  assert.equal(normalizeReconcileBody({ limit: 0 }).ok, false);
  assert.equal(normalizeReconcileBody({ limit: 99 }).ok, false);
  assert.equal(normalizeReconcileBody({ limit: "2" }).ok, false);
  assert.equal(normalizeReconcileBody(null).ok, false);
  assert.equal(normalizeReconcileBody([]).ok, false);
  assert.equal(normalizeReconcileBody("x").ok, false);

  const polluted = normalizeReconcileBody(
    JSON.parse(`{"companyId":"${UUID}","__proto__":{"isAdmin":true},"role":"admin"}`)
  );
  assert.equal(polluted.ok, true);
  assert.equal(polluted.value.companyId, UUID);
  assert.equal(Object.hasOwn(polluted.value, "role"), false);
  assert.equal(polluted.value.isAdmin, undefined);
});

await test("checker: import-only / late / ignored / catch-swallow / dynamic FAIL", () => {
  assert.equal(
    evaluateServiceRoleRouteAuth(`
      import { authorizeSystemReconcileRequest } from "x";
      export async function POST() { return getApiSupabase("a","b"); }
    `).reason,
    "system_guard_name_without_call"
  );

  assert.equal(
    evaluateServiceRoleRouteAuth(`
      export async function POST(request) {
        const { supabase } = getApiSupabase("a","b");
        const auth = authorizeSystemReconcileRequest(request);
        if (!auth.ok) return auth.body;
        return supabase;
      }
    `).reason,
    "system_guard_after_service_role"
  );

  assert.equal(
    evaluateServiceRoleRouteAuth(`
      export async function POST(request) {
        const auth = authorizeSystemReconcileRequest(request);
        const { supabase } = getApiSupabase("a","b");
        return supabase;
      }
    `).reason,
    "system_guard_result_ignored"
  );

  assert.equal(
    evaluateServiceRoleRouteAuth(`
      export async function POST(request) {
        try {
          const auth = authorizeSystemReconcileRequest(request);
          if (!auth.ok) return auth.body;
        } catch (e) {}
        return getApiSupabase("a","b");
      }
    `).reason,
    "system_guard_catch_swallows"
  );

  assert.equal(
    evaluateServiceRoleRouteAuth(`
      export async function POST(request) {
        const fn = globalThis["authorizeSystemReconcileRequest"];
        const auth = fn(request);
        if (!auth.ok) return auth.body;
        return getApiSupabase("a","b");
      }
    `).ok,
    false
  );

  // Bracket alias of the canonical name
  assert.equal(
    evaluateServiceRoleRouteAuth(`
      export async function POST(request) {
        const auth = mods["authorizeSystemReconcileRequest"](request);
        if (!auth.ok) return auth.body;
        return getApiSupabase("a","b");
      }
    `).reason,
    "system_guard_dynamic_alias"
  );

  const ordered = evaluateServiceRoleRouteAuth(`
    export async function POST(request) {
      const auth = authorizeSystemReconcileRequest(request);
      if (!auth.ok) return auth.body;
      const { supabase } = getApiSupabase("a","b");
      return supabase;
    }
  `);
  assert.equal(ordered.ok, true);
  assert.equal(ordered.reason, "system_reconcile_guard");

  // Other routes with only session markers still pass; bare service-role still fails
  assert.equal(
    evaluateServiceRoleRouteAuth(`
      export async function POST() { return getApiSupabase("x","y"); }
    `).reason,
    "missing_auth_guard"
  );
  assert.equal(
    evaluateServiceRoleRouteAuth(`
      export async function POST(request) {
        const session = await requireApiSession();
        if (session.error) return session.error;
        return getApiSupabase("x","y");
      }
    `).ok,
    true
  );
});

await test("static: production core order + route wrapper + vercel cron", () => {
  const core = fs.readFileSync(
    path.join(root, "src/lib/googleDrive/runSystemReconcile.js"),
    "utf8"
  );
  const authIdx = core.indexOf("authorizeSystemReconcileRequest(");
  const rateIdx = core.indexOf("enforceRateLimit(");
  const bodyIdx = core.indexOf("parseReconcileRequestBody(");
  const srIdx = core.indexOf("getApiSupabase(");
  assert.ok(authIdx >= 0 && rateIdx > authIdx && bodyIdx > rateIdx && srIdx > bodyIdx);
  assert.doesNotMatch(core, /requireApiSession|requireAuthenticatedApi|assertCompanyAccess/);
  assert.equal(evaluateServiceRoleRouteAuth(core).ok, true);
  assert.equal(evaluateServiceRoleRouteAuth(core).reason, "system_reconcile_guard");

  const route = fs.readFileSync(
    path.join(root, "app/api/google-drive/reconcile/route.js"),
    "utf8"
  );
  assert.match(route, /runSystemReconcile/);
  assert.doesNotMatch(route, /requireApiSession|assertCompanyAccess/);

  const syncSrc = fs.readFileSync(
    path.join(root, "app/api/google-drive/sync/route.js"),
    "utf8"
  );
  assert.match(syncSrc, /requireApiSession/);
  assert.match(syncSrc, /assertCompanyAccess/);

  const vercel = JSON.parse(
    fs.readFileSync(path.join(root, "vercel.json"), "utf8")
  );
  assert.ok(
    vercel.crons.some(
      (c) =>
        c.path === "/api/google-drive/reconcile" &&
        (c.schedule === "0 * * * *" || c.schedule === "0 4 * * *")
    )
  );
});

await test("provided secret reader rejects multi values", () => {
  const multi = readSystemReconcileProvidedSecret(
    mockRequest({ headers: { authorization: "Bearer a, Bearer b" } })
  );
  assert.equal(multi.ok, false);
});

console.log(`\ntest-google-drive-reconcile-auth: ${passed} passed`);
