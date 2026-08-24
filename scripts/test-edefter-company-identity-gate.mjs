/**
 * E-Defter company identity gate — A–J matrix + old skipped FAIL proof.
 * TEST_ONLY synthetic identities; no real VKN/XML fixtures.
 *
 * Run:
 *   node --import ./scripts/_alias-loader.mjs ./scripts/test-edefter-company-identity-gate.mjs
 */

import assert from "node:assert/strict";
import {
  EDEFTER_IDENTITY_STATUS,
  EDEFTER_TEST_ONLY_IDENTITIES as ID,
  IDENTITY_CONFIRMATION,
  applyIdentityGateToSummary,
  applyUserIdentityConfirmation,
  assertEdefterPersistIdentityGate,
  buildIdentityConfirmationScope,
  canOfferExcelIdentityConfirmation,
  clearUserIdentityConfirmation,
  evaluateEDefterCompanyIdentity,
  fingerprintTaxIdentity,
  identityConfirmationScopesEqual,
  maskTaxIdSafe,
  normalizeIdentityConfirmationValue,
} from "@/src/utils/eDefterCompanyIdentityGate.js";
import {
  assertCompanyTaxMatch,
  normalizeTaxId,
} from "@/src/utils/eDefterSecurity.js";
import { runOneClickEDefterKontrol } from "@/src/utils/eDefterKontrolEngine.js";
import { E_DEFTER_KAYNAK } from "@/src/config/eDefterKontrolDefaults.js";
import {
  extractCompanyVkn,
  isCompanyTaxIdentityAmbiguous,
  pickCompanyTaxIdentityRaw,
} from "@/src/utils/companyIdentity.js";
import { normalizeCompanyRecord } from "@/src/utils/companyCenter.js";
import { buildSafeEdefterPersistPayload } from "@/src/utils/eDefterPersistSafe.js";
import { E_DEFTER_ENGINE_VERSION } from "@/src/config/eDefterKontrolDefaults.js";

/** Legacy (pre-fix) behavior — kept only to prove old FAIL. */
function legacyAssertCompanyTaxMatch(fileTaxId = "", companyTaxId = "") {
  const fileId = normalizeTaxId(fileTaxId);
  const companyId = normalizeTaxId(companyTaxId);
  if (!companyId || !fileId) return { ok: true, skipped: !companyId || !fileId };
  if (fileId !== companyId) {
    const err = new Error("mismatch");
    err.code = "COMPANY_MISMATCH";
    throw err;
  }
  return { ok: true, skipped: false };
}

function rowPair(companyId = "co-test") {
  return [
    {
      id: "y-1",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE_XML,
      fisNo: "1",
      yevmiyeNo: "1",
      belgeNo: "B1",
      belgeTarihi: "2026-05-15",
      fisTarihi: "2026-05-15",
      hesapKodu: "100.01",
      hesapAdi: "Kasa",
      aciklama: "sentetik",
      borc: 100,
      alacak: 0,
      tutar: 100,
      companyId,
      period: "2026/05",
    },
    {
      id: "y-2",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE_XML,
      fisNo: "1",
      yevmiyeNo: "1",
      belgeNo: "B1",
      belgeTarihi: "2026-05-15",
      fisTarihi: "2026-05-15",
      hesapKodu: "320.01",
      hesapAdi: "Tedarik",
      aciklama: "sentetik",
      borc: 0,
      alacak: 100,
      tutar: 100,
      companyId,
      period: "2026/05",
    },
  ];
}

const stats = {
  legacySkippedOk: 0,
  legacyWouldContinue: 0,
  gateBlocked: 0,
  gateMatched: 0,
  gateReview: 0,
};

console.log("0) OLD FAIL proof: skipped:true treated as ok");
{
  const cases = [
    { name: "C company missing", file: ID.VKN_A, company: "" },
    { name: "D document missing", file: "", company: ID.VKN_A },
    { name: "E both missing", file: "", company: "" },
  ];
  for (const c of cases) {
    const legacy = legacyAssertCompanyTaxMatch(c.file, c.company);
    assert.equal(legacy.ok, true, `${c.name} legacy ok`);
    assert.equal(legacy.skipped, true, `${c.name} legacy skipped`);
    stats.legacySkippedOk += 1;
    stats.legacyWouldContinue += 1;
  }
  console.log("PASS old FAIL", {
    legacySkippedOk: stats.legacySkippedOk,
    note: "legacy skipped:true ⇒ analiz devam edebilirdi, verified sanılırdı",
  });
}

console.log("A) MATCHED");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: ID.VKN_A,
    companyId: "co-a",
    sourceKind: "xml",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.MATCHED);
  assert.equal(d.matched, true);
  assert.equal(d.verified, true);
  assert.equal(d.blocking, false);
  assert.equal(d.allowPersist, true);
  assert.equal(d.confirmation, IDENTITY_CONFIRMATION.AUTO_MATCHED);
  assert.equal(d.skipped, false);
  stats.gateMatched += 1;
  console.log("PASS A");
}

console.log("B) MISMATCH");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: ID.VKN_B,
    companyId: "co-a",
    sourceKind: "xml",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.MISMATCH);
  assert.equal(d.blocking, true);
  assert.equal(d.verified, false);
  assert.equal(d.allowPersist, false);
  assert.throws(
    () => assertCompanyTaxMatch(ID.VKN_B, ID.VKN_A, { sourceKind: "xml" }),
    (e) => e.code === "COMPANY_MISMATCH"
  );
  stats.gateBlocked += 1;
  console.log("PASS B");
}

console.log("C) COMPANY_IDENTITY_MISSING (was legacy skipped ok)");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: "",
    documentTaxId: ID.VKN_A,
    sourceKind: "xml",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.COMPANY_IDENTITY_MISSING);
  assert.equal(d.blocking, true);
  assert.equal(d.verified, false);
  assert.equal(d.matched, false);
  assert.throws(
    () => assertCompanyTaxMatch(ID.VKN_A, "", { sourceKind: "xml" }),
    (e) => e.code === "COMPANY_IDENTITY_MISSING"
  );
  stats.gateBlocked += 1;
  console.log("PASS C — no longer silent skip");
}

console.log("D) DOCUMENT_IDENTITY_MISSING xml (was legacy skipped ok)");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: "",
    sourceKind: "xml",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING);
  assert.equal(d.blocking, true);
  assert.equal(d.verified, false);
  assert.throws(
    () => assertCompanyTaxMatch("", ID.VKN_A, { sourceKind: "xml" }),
    (e) => e.code === "DOCUMENT_IDENTITY_MISSING"
  );
  stats.gateBlocked += 1;
  console.log("PASS D");
}

console.log("E) both missing xml → COMPANY_IDENTITY_MISSING block");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: "",
    documentTaxId: "",
    sourceKind: "xml",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.COMPANY_IDENTITY_MISSING);
  assert.equal(d.blocking, true);
  assert.equal(d.verified, false);
  stats.gateBlocked += 1;
  console.log("PASS E");
}

console.log("F) ZIP multi same firm → MATCHED");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxIds: [ID.VKN_A, ID.VKN_A],
    companyId: "co-a",
    sourceKind: "zip",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.MATCHED);
  assert.equal(d.verified, true);
  stats.gateMatched += 1;
  console.log("PASS F");
}

console.log("G) ZIP ambiguous two firms → IDENTITY_AMBIGUOUS");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxIds: [ID.VKN_A, ID.VKN_B],
    companyId: "co-a",
    sourceKind: "zip",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.IDENTITY_AMBIGUOUS);
  assert.equal(d.blocking, true);
  assert.equal(d.allowAnalyze, false);
  stats.gateBlocked += 1;
  console.log("PASS G");
}

console.log("H) invalid length → IDENTITY_INVALID");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: ID.VKN_INVALID_SHORT,
    sourceKind: "xml",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.IDENTITY_INVALID);
  assert.equal(d.blocking, true);
  stats.gateBlocked += 1;
  console.log("PASS H");
}

console.log("I) VKN vs TCKN type conflict");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: ID.TCKN_A,
    sourceKind: "xml",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.IDENTITY_TYPE_CONFLICT);
  assert.equal(d.blocking, true);
  stats.gateBlocked += 1;
  console.log("PASS I");
}

console.log("J) company change → previous identity not reusable (fresh evaluate)");
{
  const first = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: ID.VKN_A,
    companyId: "co-old",
    sourceKind: "xml",
  });
  const second = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_B,
    documentTaxId: ID.VKN_A,
    companyId: "co-new",
    sourceKind: "xml",
  });
  assert.equal(first.status, EDEFTER_IDENTITY_STATUS.MATCHED);
  assert.equal(second.status, EDEFTER_IDENTITY_STATUS.MISMATCH);
  assert.notEqual(first.safeFingerprint, second.safeFingerprint);
  stats.gateBlocked += 1;
  console.log("PASS J");
}

console.log("Excel DOCUMENT_IDENTITY_MISSING_REVIEW → analyze ok, no verified/persist/export");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: "",
    sourceKind: "excel",
  });
  assert.equal(d.status, EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW);
  assert.equal(d.blocking, false);
  assert.equal(d.reviewRequired, true);
  assert.equal(d.allowAnalyze, true);
  assert.equal(d.allowPersist, false);
  assert.equal(d.allowExport, false);
  assert.equal(d.verified, false);
  assert.equal(d.identityVerified, false);
  assert.equal(d.userConfirmed, false);
  assert.equal(d.confirmation, IDENTITY_CONFIRMATION.UNVERIFIED);
  stats.gateReview += 1;

  const result = await runOneClickEDefterKontrol({
    yevmiyeRows: rowPair("co-excel"),
    companyId: "co-excel",
    companyTaxId: ID.VKN_A,
    period: "2026/05",
    coreDecision: { decision_source: "CORE", source: "CORE" },
  });
  assert.equal(
    result.identity?.status,
    EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW
  );
  assert.equal(result.identity?.verified, false);
  assert.equal(result.identity?.allowPersist, false);
  assert.equal(result.summary.canApproveExport, false);
  assert.equal(result.summary.identityVerified, false);
  // edefterUygun muhasebe sonucu — identity review tek başına zorla false etmez
  assert.equal(result.summary.identityReviewRequired, true);
  console.log("PASS excel review path");
}

console.log("XML analyze MATCHED path → verified, persist allowed");
{
  const result = await runOneClickEDefterKontrol({
    parsedUpload: {
      rows: rowPair("co-match"),
      technicalFindings: [],
      packageMeta: { taxId: ID.VKN_A, period: "2026-05" },
      fingerprint: "fp-test-only",
      duplicate: false,
    },
    companyId: "co-match",
    companyTaxId: ID.VKN_A,
    period: "2026/05",
    coreDecision: { decision_source: "CORE", source: "CORE" },
  });
  assert.equal(result.identity?.status, EDEFTER_IDENTITY_STATUS.MATCHED);
  assert.equal(result.identity?.verified, true);
  assert.equal(result.identity?.allowPersist, true);
  console.log("PASS matched analyze");
}

console.log("XML analyze MISMATCH → throw, no UYGUN");
{
  await assert.rejects(
    () =>
      runOneClickEDefterKontrol({
        parsedUpload: {
          rows: rowPair("co-x"),
          technicalFindings: [],
          packageMeta: { taxId: ID.VKN_B, period: "2026-05" },
          fingerprint: "fp-x",
          duplicate: false,
        },
        companyId: "co-x",
        companyTaxId: ID.VKN_A,
        period: "2026/05",
      }),
    (e) => e.code === "COMPANY_MISMATCH"
  );
  console.log("PASS mismatch blocks analyze");
}

console.log("PII: mask + fingerprint; no raw identity in safe fields");
{
  const d = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: ID.VKN_A,
    companyId: "co-pii",
    sourceKind: "xml",
  });
  assert.ok(!String(d.safeMessage).includes(ID.VKN_A));
  assert.ok(!String(d.safeFingerprint).includes(ID.VKN_A));
  assert.equal(maskTaxIdSafe(ID.VKN_A).endsWith(ID.VKN_A.slice(-4)), true);
  const fpA = fingerprintTaxIdentity(ID.VKN_A, "tenant-1");
  const fpB = fingerprintTaxIdentity(ID.VKN_A, "tenant-2");
  assert.notEqual(fpA, fpB);
  console.log("PASS PII safeguards");
}

console.log("Company tax normalize: top-level + nested + aliases");
{
  const nestedOnly = normalizeCompanyRecord({
    id: "c1",
    data: { vkn: ID.VKN_A, companyName: "Test A" },
  });
  // normalizeCompany spreads source; data nested remains; extract reads both
  assert.equal(extractCompanyVkn({ id: "c1", data: { vergiNo: ID.VKN_A } }), ID.VKN_A);
  assert.equal(extractCompanyVkn({ id: "c1", taxNumber: ID.VKN_A }), ID.VKN_A);
  assert.equal(extractCompanyVkn({ id: "c1", vkn: ID.VKN_A }), ID.VKN_A);
  assert.equal(
    extractCompanyVkn({ id: "c1", data: { companyName: "x" }, tax_number: ID.VKN_A }),
    ID.VKN_A
  );
  assert.equal(
    extractCompanyVkn({
      id: "c1",
      data: { taxNumber: "" },
      vkn: ID.VKN_B,
    }),
    ID.VKN_B,
    "top-level wins when nested empty"
  );
  assert.equal(pickCompanyTaxIdentityRaw({ taxId: ID.VKN_A }), ID.VKN_A);
  assert.ok(nestedOnly);
  assert.notEqual(extractCompanyVkn({ id: "c1", data: { taxNumber: ID.VKN_A } }), "");
  assert.equal(
    isCompanyTaxIdentityAmbiguous({
      taxNumber: ID.VKN_A,
      vkn: ID.VKN_B,
    }),
    true
  );
  assert.equal(
    extractCompanyVkn({ taxNumber: ID.VKN_A, vkn: ID.VKN_B }),
    "",
    "ambiguous → fail-closed empty"
  );
  assert.equal(
    extractCompanyVkn({ taxNumber: ID.VKN_A, vkn: ID.VKN_A }),
    ID.VKN_A,
    "same digits across aliases ok"
  );
  console.log("PASS company tax field normalize");
}

console.log("Excel confirmation lifecycle (no second analyze)");
{
  const counters = { analyze: 0, persist: 0, export: 0 };
  let identity = null;
  let scope = buildIdentityConfirmationScope({
    companyId: "co-ex",
    fingerprint: "fp-excel-1",
    period: "2026/05",
  });
  let persistedKey = "";

  function analyzeOnce() {
    counters.analyze += 1;
    identity = evaluateEDefterCompanyIdentity({
      companyTaxId: ID.VKN_A,
      documentTaxId: "",
      companyId: scope.companyId,
      sourceKind: "excel",
    });
    return identity;
  }

  function tryPersist() {
    if (!identity?.allowPersist) return false;
    const key = `${scope.companyId}|${scope.fingerprint}|${scope.period}`;
    if (persistedKey === key) return false;
    persistedKey = key;
    counters.persist += 1;
    return true;
  }

  function tryExport() {
    if (!identity?.allowExport) return false;
    counters.export += 1;
    return true;
  }

  // unconfirmed
  analyzeOnce();
  assert.equal(counters.analyze, 1);
  assert.equal(identity.allowAnalyze, true);
  assert.equal(identity.allowPersist, false);
  assert.equal(tryPersist(), false);
  assert.equal(tryExport(), false);
  assert.equal(counters.persist, 0);
  assert.equal(counters.export, 0);
  assert.equal(canOfferExcelIdentityConfirmation(identity), true);

  // confirm — no re-analyze
  identity = applyUserIdentityConfirmation(identity, scope);
  assert.equal(counters.analyze, 1);
  assert.equal(identity.verified, false);
  assert.equal(identity.identityVerified, false);
  assert.equal(identity.userConfirmed, true);
  assert.equal(identity.identityUserConfirmed, true);
  assert.equal(identity.allowPersist, true);
  assert.equal(identity.allowExport, true);
  assert.equal(identity.confirmation, "USER_CONFIRMED");
  assert.equal(identity.safeMessage, "Firma kullanıcı tarafından doğrulandı");
  assert.equal(tryPersist(), true);
  assert.equal(tryExport(), true);
  assert.equal(counters.persist, 1);
  assert.equal(counters.export, 1);

  // double confirm/click — ikinci persist yok
  identity = applyUserIdentityConfirmation(identity, scope);
  assert.equal(tryPersist(), false);
  assert.equal(counters.persist, 1);
  assert.equal(counters.analyze, 1);

  // company change → reset
  scope = buildIdentityConfirmationScope({
    companyId: "co-ex-2",
    fingerprint: "fp-excel-1",
    period: "2026/05",
  });
  identity = clearUserIdentityConfirmation(identity);
  assert.equal(identity.userConfirmed, false);
  assert.equal(identity.allowPersist, false);
  assert.equal(tryPersist(), false);
  assert.equal(counters.persist, 1);

  // file change → reset after re-confirm
  identity = applyUserIdentityConfirmation(
    evaluateEDefterCompanyIdentity({
      companyTaxId: ID.VKN_A,
      sourceKind: "excel",
      companyId: "co-ex",
    }),
    buildIdentityConfirmationScope({
      companyId: "co-ex",
      fingerprint: "fp-excel-1",
      period: "2026/05",
    })
  );
  assert.equal(identity.userConfirmed, true);
  identity = clearUserIdentityConfirmation(identity);
  scope = buildIdentityConfirmationScope({
    companyId: "co-ex",
    fingerprint: "fp-excel-2",
    period: "2026/05",
  });
  assert.equal(identity.allowPersist, false);

  // period change
  identity = applyUserIdentityConfirmation(
    evaluateEDefterCompanyIdentity({
      companyTaxId: ID.VKN_A,
      sourceKind: "excel",
      companyId: "co-ex",
    }),
    buildIdentityConfirmationScope({
      companyId: "co-ex",
      fingerprint: "fp-a",
      period: "2026/05",
    })
  );
  const scopeB = buildIdentityConfirmationScope({
    companyId: "co-ex",
    fingerprint: "fp-a",
    period: "2026/06",
  });
  assert.equal(
    identityConfirmationScopesEqual(identity.confirmedScope, scopeB),
    false
  );
  identity = clearUserIdentityConfirmation(identity);
  assert.equal(identity.userConfirmed, false);

  // remount simulation → confirmation not retained
  const remounted = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    sourceKind: "excel",
    companyId: "co-ex",
  });
  assert.equal(remounted.userConfirmed, false);
  assert.equal(remounted.allowPersist, false);

  console.log("PASS excel confirmation lifecycle", counters);
}

console.log("Confirmation cannot bypass XML/ZIP blocks");
{
  const mismatch = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: ID.VKN_B,
    sourceKind: "xml",
  });
  assert.equal(canOfferExcelIdentityConfirmation(mismatch), false);
  const after = applyUserIdentityConfirmation(mismatch, {
    companyId: "c",
    fingerprint: "f",
    period: "2026/05",
  });
  assert.equal(after.allowPersist, false);
  assert.equal(after.userConfirmed, false);
  assert.equal(after.blocking, true);

  const missingXml = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: "",
    sourceKind: "xml",
  });
  assert.equal(canOfferExcelIdentityConfirmation(missingXml), false);

  const ambiguous = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxIds: [ID.VKN_A, ID.VKN_B],
    sourceKind: "zip",
  });
  assert.equal(canOfferExcelIdentityConfirmation(ambiguous), false);
  assert.equal(
    applyUserIdentityConfirmation(ambiguous, {
      companyId: "c",
      fingerprint: "f",
      period: "p",
    }).blocking,
    true
  );

  const matched = evaluateEDefterCompanyIdentity({
    companyTaxId: ID.VKN_A,
    documentTaxId: ID.VKN_A,
    sourceKind: "xml",
  });
  assert.equal(canOfferExcelIdentityConfirmation(matched), false);
  assert.equal(matched.verified, true);
  assert.equal(matched.allowPersist, true);

  console.log("PASS no confirmation bypass for XML/ZIP");
}

console.log("Persist metadata: USER_CONFIRMED safe; no raw VKN");
{
  const identity = applyUserIdentityConfirmation(
    evaluateEDefterCompanyIdentity({
      companyTaxId: ID.VKN_A,
      sourceKind: "excel",
      companyId: "co-meta",
    }),
    { companyId: "co-meta", fingerprint: "fp-m", period: "2026/05" }
  );
  const summary = applyIdentityGateToSummary(
    { overallSonuc: "Uygun", edefterUygun: true, canApproveExport: true },
    identity
  );
  assert.equal(summary.identityVerified, false);
  assert.equal(summary.identityUserConfirmed, true);
  assert.equal(summary.identityConfirmation, "USER_CONFIRMED");
  const payload = buildSafeEdefterPersistPayload({
    companyId: "co-meta",
    period: "2026/05",
    engineVersion: E_DEFTER_ENGINE_VERSION,
    fingerprints: { source: "fp-m" },
    summary,
    rows: [],
  });
  const blob = JSON.stringify(payload);
  assert.ok(!blob.includes(ID.VKN_A));
  assert.equal(payload.result_summary.identity_confirmation, "USER_CONFIRMED");
  assert.equal(payload.result_summary.identity_verified, false);
  assert.equal(payload.result_summary.identity_user_confirmed, true);
  console.log("PASS persist confirmation metadata");
}

console.log("API persist identity gate — allowlist + no XML bypass");
{
  assert.equal(normalizeIdentityConfirmationValue("USER_CONFIRMED"), "USER_CONFIRMED");
  assert.equal(normalizeIdentityConfirmationValue("AUTO_MATCHED"), "AUTO_MATCHED");
  assert.equal(normalizeIdentityConfirmationValue("UNVERIFIED"), "UNVERIFIED");
  assert.equal(normalizeIdentityConfirmationValue("BLOCKED"), "BLOCKED");
  assert.equal(normalizeIdentityConfirmationValue("HACKED"), null);

  assert.doesNotThrow(() =>
    assertEdefterPersistIdentityGate({
      resultSummary: {
        identity_status: EDEFTER_IDENTITY_STATUS.MATCHED,
        identity_verified: true,
        identity_user_confirmed: false,
        identity_confirmation: IDENTITY_CONFIRMATION.AUTO_MATCHED,
      },
      documentTypes: ["XML/ZIP"],
    })
  );

  assert.doesNotThrow(() =>
    assertEdefterPersistIdentityGate({
      resultSummary: {
        identity_status: EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW,
        identity_verified: false,
        identity_user_confirmed: true,
        identity_confirmation: IDENTITY_CONFIRMATION.USER_CONFIRMED,
      },
      documentTypes: ["Muavin", "Yevmiye Excel"],
    })
  );

  assert.throws(
    () =>
      assertEdefterPersistIdentityGate({
        resultSummary: {
          identity_status: EDEFTER_IDENTITY_STATUS.MISMATCH,
          identity_verified: false,
          identity_user_confirmed: true,
          identity_confirmation: IDENTITY_CONFIRMATION.USER_CONFIRMED,
        },
        documentTypes: ["XML/ZIP"],
      }),
    (e) => e.code === "IDENTITY_BLOCKED" || e.code === "USER_CONFIRMED_NOT_ALLOWED"
  );

  assert.throws(
    () =>
      assertEdefterPersistIdentityGate({
        resultSummary: {
          identity_status: EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW,
          identity_verified: false,
          identity_user_confirmed: true,
          identity_confirmation: IDENTITY_CONFIRMATION.USER_CONFIRMED,
        },
        documentTypes: ["XML/ZIP"],
      }),
    (e) => e.code === "USER_CONFIRMED_XML_FORBIDDEN"
  );

  assert.throws(
    () =>
      assertEdefterPersistIdentityGate({
        resultSummary: {
          identity_status: EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW,
          identity_verified: false,
          identity_user_confirmed: false,
          identity_confirmation: IDENTITY_CONFIRMATION.UNVERIFIED,
        },
        documentTypes: ["Muavin"],
      }),
    (e) => e.code === "IDENTITY_REVIEW_REQUIRED"
  );

  assert.throws(
    () =>
      assertEdefterPersistIdentityGate({
        resultSummary: {
          identity_status: EDEFTER_IDENTITY_STATUS.MATCHED,
          identity_verified: true,
          identity_user_confirmed: false,
          identity_confirmation: "NOT_A_REAL_VALUE",
        },
        documentTypes: [],
      }),
    (e) => e.code === "IDENTITY_CONFIRMATION_INVALID"
  );

  assert.throws(
    () =>
      assertEdefterPersistIdentityGate({
        resultSummary: {
          identity_status: EDEFTER_IDENTITY_STATUS.MATCHED,
          identity_verified: true,
          identity_user_confirmed: true,
          identity_confirmation: IDENTITY_CONFIRMATION.USER_CONFIRMED,
        },
        documentTypes: [],
      }),
    (e) => e.code === "IDENTITY_FLAG_CONFLICT"
  );

  console.log("PASS API persist identity gate");
}

console.log("\nCOUNTERS", stats);
console.log("All edefter company identity gate checks passed.");
