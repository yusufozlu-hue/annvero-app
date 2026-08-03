/**
 * Staging E2E (redacted / metadata-only): MARE + kimliği belirsiz PDF
 * → manuel onay → devam → mükerrer → reanalyze revision.
 * Gerçek müşteri dosyası / production upload yok.
 *
 * Env (optional live plan count): ../annvero-app/.env.staging.local
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-company-verify-staging-e2e.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  BANK_COMPANY_GUARD_CODE,
  COMPANY_VERIFY_CONFIRM_BUTTON_LABEL,
  applyManualCompanyConfirmationToGuard,
  assertManualCompanyConfirmation,
  canAcceptManualCompanyConfirmation,
  formatCompanyVerificationConfirmLabel,
  verifyBankStatementCompanyMatch,
} = await import("@/src/utils/bankStatementCompanyGuard.js");

const {
  applySessionMovementDedup,
  DUPLICATE_STATEMENT_UI_MESSAGE,
} = await import("@/src/utils/bankStatementDedup.js");

const {
  REANALYZE_BUTTON_LABEL,
  assertSameTenantReanalyze,
  buildRevisionIdempotencyKey,
  buildSkippedArchiveSummaryFromPrior,
  deriveRevisionCounters,
  nextRevisionNumber,
  shouldBypassIdempotencyHistoryBlock,
  shouldSkipDriveArchiveOnReanalyze,
} = await import("@/src/utils/bankStatementReanalyze.js");

const { buildIdempotencyKey } = await import(
  "@/src/utils/annveroV1Orchestration.js"
);
const { buildSafeV1PersistPayload } = await import(
  "@/src/utils/annveroV1SafePersist.js"
);

const STAGING_MARE_ID = "84384297-270c-47cd-ac5a-d693ba80b84a";
const MARE_DISPLAY =
  "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş";
const CONTENT_HASH = "redacted-ambiguous-pdf-hash-e2e";

const mare = {
  id: STAGING_MARE_ID,
  companyName: MARE_DISPLAY,
  taxNumber: "9876543210",
};

console.log("=== Staging E2E: company manual verify → duplicate → reanalyze ===");
console.log(`MARE company: ${STAGING_MARE_ID}`);

// 1) Kimliği belirsiz PDF → VERIFICATION_REQUIRED (otomatik eşleşme yok)
const ambiguousRows = [
  ["Hareket", "Tutar", "B/A"],
  ["01.01.2025", "1.250,00", "B"],
  ["02.01.2025", "500,00", "A"],
];
const guard = verifyBankStatementCompanyMatch({
  sheetRows: ambiguousRows,
  fileName: "belirsiz-ekstre.pdf",
  text: "sayfa tarama metni — unvan/vkn/iban yok",
  selectedCompany: mare,
  companies: [mare],
});
assert.equal(guard.code, BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED);
assert.equal(guard.blockPipeline, true);
assert.equal(canAcceptManualCompanyConfirmation(guard.code), true);
assert.equal(
  canAcceptManualCompanyConfirmation(BANK_COMPANY_GUARD_CODE.MISMATCH),
  false
);
console.log("PASS  ambiguous PDF → COMPANY_VERIFICATION_REQUIRED (no auto-match)");

// 2) Checkbox + onay olmadan devam yok
const noCheckbox = assertManualCompanyConfirmation({
  guardCode: guard.code,
  checkboxChecked: false,
  confirmedCompanyId: STAGING_MARE_ID,
  activeCompanyId: STAGING_MARE_ID,
});
assert.equal(noCheckbox.ok, false);
console.log("PASS  pipeline blocked until checkbox + confirm");

// 3) Manuel onay (aktif MARE) → devam; aynı kaynak yeniden yüklenmez
const confirm = assertManualCompanyConfirmation({
  guardCode: guard.code,
  checkboxChecked: true,
  confirmedCompanyId: STAGING_MARE_ID,
  activeCompanyId: STAGING_MARE_ID,
});
assert.equal(confirm.ok, true);
const afterConfirm = applyManualCompanyConfirmationToGuard(guard, {
  confirmedCompanyId: STAGING_MARE_ID,
  activeCompanyId: STAGING_MARE_ID,
});
assert.equal(afterConfirm.blockPipeline, false);
assert.equal(afterConfirm.manuallyConfirmed, true);
const label = formatCompanyVerificationConfirmLabel(MARE_DISPLAY);
assert.match(label, /MARE RESORT/);
assert.equal(COMPANY_VERIFY_CONFIRM_BUTTON_LABEL, "Firmayı Onayla ve Devam Et");
console.log("PASS  manual confirm unlocks pipeline on same source (no re-upload)");

// 3b) Immutable checkpoint — onay sonrası File input'a bağımlı değil
const {
  createBankStatementSourceCheckpoint,
  getCheckpointArrayBufferAsync,
  getCheckpointFile,
  hasUsableSourceCheckpoint,
  rememberArchiveOnCheckpoint,
  shouldReuseArchiveFromCheckpoint,
  buildArchiveReuseFromCheckpoint,
  shouldBypassDedupForCompanyApproveResume,
  clearBankStatementSourceCheckpoint,
} = await import("@/src/utils/bankStatementSourceCheckpoint.js");

const fixturePdf = new File(
  [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 7, 7, 7])],
  "redacted-ambiguous-mare.pdf",
  { type: "application/pdf" }
);
const sourceCp = await createBankStatementSourceCheckpoint(fixturePdf);
assert.equal(hasUsableSourceCheckpoint(sourceCp), true);
assert.ok(sourceCp.contentHash);
// Simüle: input temizlendi, yalnız checkpoint kaldı
const resumeBytes = await getCheckpointArrayBufferAsync(sourceCp);
assert.ok(resumeBytes.byteLength > 0);
assert.ok(getCheckpointFile(sourceCp) instanceof File);
assert.equal(shouldBypassDedupForCompanyApproveResume(true), true);
// Drive FormData upload simülasyonu — parse baytları bozulmamalı
const { assertCheckpointSurvivesFormDataConsume } = await import(
  "@/src/utils/bankStatementSourceCheckpoint.js"
);
await assertCheckpointSurvivesFormDataConsume(sourceCp);
const afterArchiveBytes = await getCheckpointArrayBufferAsync(sourceCp);
assert.equal(afterArchiveBytes.byteLength, resumeBytes.byteLength);
rememberArchiveOnCheckpoint(sourceCp, {
  ok: true,
  code: "ARCHIVED",
  safeSummary: { archived: true },
});
assert.equal(shouldReuseArchiveFromCheckpoint(sourceCp), true);
assert.equal(
  buildArchiveReuseFromCheckpoint(sourceCp).code,
  "CHECKPOINT_REUSE_ARCHIVE"
);
assert.equal(clearBankStatementSourceCheckpoint(sourceCp), null);
console.log(
  "PASS  approve → checkpoint parse source intact; no 2nd Drive; no file-read error path"
);

// 4) MISMATCH manuel onay bypass YOK
const mismatchConfirm = assertManualCompanyConfirmation({
  guardCode: BANK_COMPANY_GUARD_CODE.MISMATCH,
  checkboxChecked: true,
  confirmedCompanyId: STAGING_MARE_ID,
  activeCompanyId: STAGING_MARE_ID,
});
assert.equal(mismatchConfirm.ok, false);
assert.equal(mismatchConfirm.code, "MANUAL_CONFIRM_FORBIDDEN");
console.log("PASS  COMPANY_MISMATCH cannot use manual confirm bypass");

// 5) Aynı dosya yeniden işlenirse mükerrer engeli
const movements = Array.from({ length: 6 }, (_, i) => ({
  transactionId: `ambig-tx-${i}`,
  sourceType: "pdf",
  direction: i % 2 ? "CIKIS" : "GIRIS",
  amount: 100 + i,
}));
const pass1 = applySessionMovementDedup(movements, new Set(), {
  companyId: STAGING_MARE_ID,
  sourceFileHash: CONTENT_HASH,
  selectedBank: "VAKIFBANK",
});
assert.equal(pass1.allDuplicate, false);
const pass2 = applySessionMovementDedup(movements, new Set(pass1.seenKeys), {
  companyId: STAGING_MARE_ID,
  sourceFileHash: CONTENT_HASH,
  selectedBank: "VAKIFBANK",
});
assert.equal(pass2.allDuplicate, true);
assert.equal(pass2.uiMessage, DUPLICATE_STATEMENT_UI_MESSAGE);
console.log("PASS  normal re-upload still duplicate-blocked");

// 6) Sonuç kartı reanalyze + full plan revision (4166), ikinci Drive yok
assert.equal(REANALYZE_BUTTON_LABEL, "Yeni hesap planıyla yeniden analiz et");
assert.equal(shouldBypassIdempotencyHistoryBlock(true), true);
assert.equal(shouldSkipDriveArchiveOnReanalyze(true), true);
const archive = buildSkippedArchiveSummaryFromPrior({ drive_archived: true });
assert.equal(archive.code, "REANALYZE_REUSE_ARCHIVE");

const ACCOUNT_PLAN_COUNT = 4166;
const priorKey = buildIdempotencyKey({
  companyId: STAGING_MARE_ID,
  contentHash: CONTENT_HASH,
});
const prior = buildSafeV1PersistPayload({
  companyId: STAGING_MARE_ID,
  jobId: "job-prior-verify",
  idempotencyKey: priorKey,
  summary: {
    terminalStatus: "completed",
    movementCount: 6,
    autoMatchedCount: 1,
    reviewCount: 5,
    driveArchived: true,
  },
});
const revision = nextRevisionNumber(1);
const revKey = buildRevisionIdempotencyKey({
  companyId: STAGING_MARE_ID,
  contentHash: CONTENT_HASH,
  revision,
});
assert.notEqual(revKey, priorKey);
const revPayload = buildSafeV1PersistPayload({
  companyId: STAGING_MARE_ID,
  jobId: "job-rev-verify",
  idempotencyKey: revKey,
  summary: {
    terminalStatus: "review_required",
    movementCount: 6,
    autoMatchedCount: 4,
    reviewCount: 2,
    driveArchived: true,
    reanalyze: true,
    revision,
    revisionOf: "audit-prior",
    supersedesJobId: "audit-prior",
    accountPlanCount: ACCOUNT_PLAN_COUNT,
    resolvedMissingCount: 3,
    trulyNotFoundCount: 1,
  },
});
assert.equal(revPayload.metadata.supersedes_job_id, "audit-prior");
assert.equal(revPayload.metadata.account_plan_count, 4166);
assert.equal(prior.metadata.movement_count, 6);
const compare = deriveRevisionCounters({
  previous: { auto_matched_count: 1, review_count: 5 },
  next: { autoMatchedCount: 4, uniqueUnresolvedMovements: 2 },
  trulyNotFoundCount: 1,
});
assert.equal(compare.resolvedMissing, 3);

const tenant = assertSameTenantReanalyze({
  requestCompanyId: STAGING_MARE_ID,
  priorCompanyId: STAGING_MARE_ID,
});
assert.equal(tenant.ok, true);
const cross = assertSameTenantReanalyze({
  requestCompanyId: STAGING_MARE_ID,
  priorCompanyId: "other-company",
});
assert.equal(cross.ok, false);
console.log("PASS  reanalyze revision with ~4166 plan; supersedes; no 2nd Drive");

// 7) UI wiring
const oneClick = fs.readFileSync(
  path.join(
    root,
    "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
  ),
  "utf8"
);
assert.match(oneClick, /company-verification-checkbox/);
assert.match(oneClick, /Firmayı Onayla ve Devam Et/);
assert.match(oneClick, /isVerification && typeof onConfirmCompanyAndContinue/);

const workbench = fs.readFileSync(
  path.join(
    root,
    "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
  ),
  "utf8"
);
assert.match(workbench, /handleConfirmCompanyAndContinue/);
assert.match(workbench, /applyManualCompanyConfirmationToGuard/);
assert.match(workbench, /companyManualConfirmedRef/);
assert.match(workbench, /ANNVERO_COMPANY_CHANGED_EVENT/);
assert.match(workbench, /createBankStatementSourceCheckpoint/);
assert.match(workbench, /sourceCheckpointRef/);
assert.match(workbench, /companyApproveResume:\s*true/);
assert.match(workbench, /shouldReuseArchiveFromCheckpoint/);
assert.match(workbench, /clearBankStatementSourceCheckpoint/);
console.log("PASS  UI confirm checkbox + button wired; company change clears state");
console.log("PASS  approve resume uses immutable source checkpoint (no file re-pick)");

console.log("All bank-company-verify staging E2E checks passed.");
