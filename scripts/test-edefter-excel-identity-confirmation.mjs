/**
 * Excel identity confirmation — focused matrix (no second analyze / no XML bypass).
 * Run:
 *   node --import ./scripts/_alias-loader.mjs ./scripts/test-edefter-excel-identity-confirmation.mjs
 */
import assert from "node:assert/strict";
import {
  EDEFTER_IDENTITY_STATUS,
  EDEFTER_TEST_ONLY_IDENTITIES as ID,
  applyUserIdentityConfirmation,
  canOfferExcelIdentityConfirmation,
  clearUserIdentityConfirmation,
  evaluateEDefterCompanyIdentity,
} from "@/src/utils/eDefterCompanyIdentityGate.js";

const counts = { analyze: 0, persist: 0, exportOpen: 0 };
let identity = evaluateEDefterCompanyIdentity({
  companyTaxId: ID.VKN_A,
  sourceKind: "excel",
  companyId: "co-1",
});
counts.analyze = 1;

assert.equal(identity.status, EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW);
assert.equal(identity.allowAnalyze, true);
assert.equal(identity.allowPersist, false);
assert.equal(identity.allowExport, false);
assert.equal(canOfferExcelIdentityConfirmation(identity), true);

identity = applyUserIdentityConfirmation(identity, {
  companyId: "co-1",
  fingerprint: "fp1",
  period: "2026/05",
});
assert.equal(counts.analyze, 1, "confirm must not re-analyze");
assert.equal(identity.identityVerified, false);
assert.equal(identity.identityUserConfirmed, true);
assert.equal(identity.allowPersist, true);
assert.equal(identity.allowExport, true);
counts.persist = 1;
counts.exportOpen = 1;

identity = applyUserIdentityConfirmation(identity, {
  companyId: "co-1",
  fingerprint: "fp1",
  period: "2026/05",
});
assert.equal(counts.analyze, 1);
assert.equal(counts.persist, 1, "second confirm must not imply second persist");

identity = clearUserIdentityConfirmation(identity);
assert.equal(identity.allowPersist, false);

const xmlMismatch = evaluateEDefterCompanyIdentity({
  companyTaxId: ID.VKN_A,
  documentTaxId: ID.VKN_B,
  sourceKind: "xml",
});
assert.equal(canOfferExcelIdentityConfirmation(xmlMismatch), false);
assert.equal(
  applyUserIdentityConfirmation(xmlMismatch, {
    companyId: "x",
    fingerprint: "f",
    period: "p",
  }).blocking,
  true
);

console.log("PASS excel identity confirmation", counts);
