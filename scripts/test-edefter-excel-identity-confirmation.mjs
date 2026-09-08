/**
 * Excel-only missing identity — read-only preview contract.
 * Run:
 *   node --import ./scripts/_alias-loader.mjs ./scripts/test-edefter-excel-identity-confirmation.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EDEFTER_IDENTITY_STATUS,
  EDEFTER_TEST_ONLY_IDENTITIES as ID,
  evaluateEDefterCompanyIdentity,
} from "@/src/utils/eDefterCompanyIdentityGate.js";

const counts = {
  analyze: 0,
  apiCalls: 0,
  dbWrites: 0,
  localCacheWrites: 0,
  historyWrites: 0,
  pdfExports: 0,
  excelExports: 0,
};
const identity = evaluateEDefterCompanyIdentity({
  companyTaxId: ID.VKN_A,
  sourceKind: "excel",
  companyId: "co-1",
});
counts.analyze = 1;

assert.equal(identity.status, EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW);
assert.equal(identity.allowAnalyze, true);
assert.equal(identity.allowPersist, false);
assert.equal(identity.allowExport, false);
assert.equal(identity.identityVerified, false);
assert.equal(identity.identityUserConfirmed, false);
assert.equal(identity.confirmation, "UNVERIFIED");
assert.equal(counts.apiCalls, 0);
assert.equal(counts.dbWrites, 0);
assert.equal(counts.localCacheWrites, 0);
assert.equal(counts.historyWrites, 0);
assert.equal(counts.pdfExports, 0);
assert.equal(counts.excelExports, 0);

const xmlMismatch = evaluateEDefterCompanyIdentity({
  companyTaxId: ID.VKN_A,
  documentTaxId: ID.VKN_B,
  sourceKind: "xml",
});
assert.equal(xmlMismatch.blocking, true);
assert.equal(xmlMismatch.allowPersist, false);
assert.equal(xmlMismatch.allowExport, false);

const pageSource = fs.readFileSync(
  new URL("../app/(annvero)/muhasebe/e-defter-kontrol/page.jsx", import.meta.url),
  "utf8"
);
assert.match(
  pageSource,
  /pendingParsed\s*\|\|\s*\(\s*xmlRows\.length[\s\S]*?:\s*null\s*\)/,
  "Excel-only analyze must not send a synthetic parsedUpload/XML package"
);
assert.match(
  pageSource,
  /pendingParsed\s*\|\|\s*\(\s*xmlRows\.length\s*\?\s*\{/,
  "real XML/ZIP state must keep the parsed upload path"
);
assert.match(
  pageSource,
  /Belgede vergi kimliği bulunamadı\. Sonuçlar yalnız ön inceleme içindir; doğrulanmış veya onaylı sayılmaz\./
);
assert.match(pageSource, /Sonuçlar Kontrol Geçmişine kaydedilmedi\./);
assert.match(
  pageSource,
  /if\s*\(!identityBlocksPersist\)\s*\{\s*persistRecord\(localRecord\);/,
  "unverified preview must not write temporary control records"
);
assert.match(
  pageSource,
  /const handlePdf = \(\) => \{\s*if \(identityInfo && identityInfo\.allowExport === false\)/,
  "PDF must be blocked when identity export permission is false"
);
assert.doesNotMatch(
  pageSource,
  /Bu dosyanın seçili firmaya ait olduğunu onaylıyorum/,
  "company selection/user checkbox must not become document identity evidence"
);
assert.doesNotMatch(
  pageSource,
  /setIdentityPersistOnceKey/,
  "removed identity confirmation state must not leave a dangling setter"
);

const invalidationStart = pageSource.indexOf(
  "const invalidateCurrentAnalysis = useCallback("
);
const invalidationEnd = pageSource.indexOf(
  "const clearAnalysisState = useCallback(",
  invalidationStart
);
assert.ok(invalidationStart > 0 && invalidationEnd > invalidationStart);
const invalidationSource = pageSource.slice(invalidationStart, invalidationEnd);
for (const requiredReset of [
  "setRows([])",
  "setSummary(null)",
  "setGroupCounts([])",
  "setIdentityInfo(null)",
  "setPersistError(\"\")",
  "setPersistRetryPayload(null)",
  "setLastPersistMeta(null)",
  "setActiveGroup(\"\")",
  "setSearch(\"\")",
  "setRiskLevelFilter(\"Tümü\")",
  "setHataTuruFilter(\"Tümü\")",
  "setCozumFilter(\"Tümü\")",
  "setToast(\"\")",
  "resetParserJob()",
]) {
  assert.ok(
    invalidationSource.includes(requiredReset),
    `central invalidation must include ${requiredReset}`
  );
}

for (const trigger of [
  'invalidateCurrentAnalysis("company-change")',
  'invalidateCurrentAnalysis("year-change")',
  'invalidateCurrentAnalysis("month-change")',
  'invalidateCurrentAnalysis("xml-file-change")',
  "invalidateCurrentAnalysis(`${kind}-file-change`)",
  "invalidateCurrentAnalysis(`${kind}-file-clear`)",
  'invalidateCurrentAnalysis("analyze-start")',
]) {
  assert.ok(pageSource.includes(trigger), `missing invalidation trigger: ${trigger}`);
}

const excelUploadStart = pageSource.indexOf("const handleExcelUpload = async");
const excelInvalidate = pageSource.indexOf(
  "invalidateCurrentAnalysis(`${kind}-file-change`)",
  excelUploadStart
);
const excelParse = pageSource.indexOf("parseExcelUploadFile(file", excelUploadStart);
assert.ok(excelInvalidate > excelUploadStart && excelInvalidate < excelParse);
assert.ok(
  pageSource.indexOf("setParsedRows([])", excelInvalidate) < excelParse,
  "new/failed Excel parse must not retain previous file rows"
);

const xmlUploadStart = pageSource.indexOf("const handleXmlUpload = async");
const xmlInvalidate = pageSource.indexOf(
  'invalidateCurrentAnalysis("xml-file-change")',
  xmlUploadStart
);
const xmlParse = pageSource.indexOf("file.arrayBuffer()", xmlUploadStart);
assert.ok(xmlInvalidate > xmlUploadStart && xmlInvalidate < xmlParse);
for (const xmlReset of [
  "setXmlRows([])",
  "setTechnicalFindings([])",
  "setUploadMeta(null)",
  "setPendingParsed(null)",
]) {
  const resetAt = pageSource.indexOf(xmlReset, xmlInvalidate);
  assert.ok(
    resetAt > xmlInvalidate && resetAt < xmlParse,
    `new/failed XML parse must clear previous state: ${xmlReset}`
  );
}

assert.match(
  pageSource,
  /if \(version !== analysisVersionRef\.current\) return;/,
  "stale parse/analyze completions must not restore invalidated state"
);
assert.match(
  pageSource,
  /if \(identityBlocksPersist\) \{[\s\S]*?Sonuçlar Kontrol Geçmişine kaydedilmedi\.[\s\S]*?\} else \{[\s\S]*?persistAnalysisResult\(payload\)/,
  "read-only Excel must not call the runs API/persistence path"
);

console.log("PASS excel-only identity read-only preview", counts);
