/**
 * Düzeltme fişi V2 — fingerprint, idempotency, presentation, apply validation.
 * Run: npm run test:correction-records-v2
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildCorrectionDraft,
  buildCorrectionExportWorkbook,
  buildSourceVoucherFromLedgerRows,
  exportCorrectionDraft,
  prepareCorrectionFromFinding,
} from "@/src/utils/correctionVoucher/index.js";
import { sanitizeAnalyzeResult } from "@/src/utils/eDefterAnalyzeContract.js";
import {
  buildGenelMuhasebeFindingsPresentation,
  summarizeGenelMuhasebeFindingsWithCorrections,
} from "@/src/utils/genelMuhasebeFindingsView.js";
import {
  buildCorrectionRecordFingerprint,
  buildCorrectionRecordFingerprintInput,
  buildExportRecordPayloadFromDraft,
  CORRECTION_RECORD_STATUS,
  fingerprintInputFromDraftAndRecipe,
  publicCorrectionRecordView,
  validateApplyCorrectionRecordInput,
  validateCancelCorrectionRecordInput,
} from "@/src/utils/correctionRecords/index.js";
import { normalizeAccountCodeForComparison } from "@/src/utils/textNormalize.js";
import { CORRECTION_VOUCHER_SAME_ACCOUNT_WRONG_DEBIT } from "./fixtures/correction-voucher-same-account-wrong-debit.mjs";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else console.log(`PASS  ${msg}`);
}

const fx = CORRECTION_VOUCHER_SAME_ACCOUNT_WRONG_DEBIT;
const prep = prepareCorrectionFromFinding({
  finding: fx.finding,
  ledgerRows: fx.ledgerRows,
  companyAccountingRules: fx.companyAccountingRules,
});
const draft = buildCorrectionDraft(prep.recipe, {
  ...fx.userSelections,
  companyAccountingRules: fx.companyAccountingRules,
  companyId: "company-a",
  companySlug: "MARE",
});

// a. fingerprint deterministik
{
  const a = buildCorrectionRecordFingerprint(
    fingerprintInputFromDraftAndRecipe(draft, prep.recipe)
  );
  const b = buildCorrectionRecordFingerprint(
    fingerprintInputFromDraftAndRecipe(draft, prep.recipe)
  );
  assert(a && a === b, "fingerprint deterministic");
}

// b. Unicode hesap kodu
{
  const input = buildCorrectionRecordFingerprintInput({
    companyId: "c1",
    sourceVoucherNo: "00049",
    sourceVoucherDate: "16.02.2026",
    sourceDocumentNo: "YEF2026000000003",
    findingCode: "COUNTERPART_SAME_SIDE",
    recipeCode: "SAME_ACCOUNT_WRONG_DEBIT",
    wrongAccountCode: "320.10.Y0010",
    wrongDebit: 135000,
    wrongCredit: 162000,
  });
  assert(
    input.includes(normalizeAccountCodeForComparison("320.10.Y0010")),
    "unicode account preserved in fingerprint input"
  );
}

// c/d/n. baştaki sıfırlar
{
  const validation = validateApplyCorrectionRecordInput({
    record: { id: "1", status: CORRECTION_RECORD_STATUS.EXPORTED, source_voucher_no: "00049", correction_date: "2026-04-01" },
    externalVoucherNo: "00121",
    externalVoucherDate: "2026-04-01",
    userConfirmed: true,
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "USER_CONFIRMED",
  });
  assert(validation.ok && validation.externalVoucherNo === "00121", "00121 leading zeros preserved");
}

// e. farklı firma eşleşmez
{
  const base = fingerprintInputFromDraftAndRecipe(draft, prep.recipe);
  const fpA = buildCorrectionRecordFingerprint({ ...base, companyId: "company-a" });
  const fpB = buildCorrectionRecordFingerprint({ ...base, companyId: "company-b" });
  assert(fpA !== fpB, "different company different fingerprint");
}

// f. farklı tarih eşleşmez
{
  const base = fingerprintInputFromDraftAndRecipe(draft, prep.recipe);
  const fp1 = buildCorrectionRecordFingerprint(base);
  const fp2 = buildCorrectionRecordFingerprint({
    ...base,
    sourceVoucherDate: "17.02.2026",
  });
  assert(fp1 !== fp2, "different source date different fingerprint");
}

// export payload
{
  const payload = buildExportRecordPayloadFromDraft({
    draft,
    recipe: prep.recipe,
    exportedFileName: "test.xlsx",
    lastClosedReliability: "COMPANY_PROFILE",
  });
  assert(payload.ok && payload.sourceFingerprint, "export payload ok");
  assert(payload.row.external_system === "LUCA", "external_system LUCA");
}

// g/h/i presentation counters
{
  const catalog = [
    { fisNo: "00049", severity: "UYARI", code: "COUNTERPART_SAME_SIDE", hesapKodu: "320.10.Y0010" },
    { fisNo: "00050", severity: "UYARI", code: "MISSING_COUNTERPART", hesapKodu: "100" },
  ];
  const exportedRecord = publicCorrectionRecordView({
    id: "r1",
    company_id: "c1",
    source_voucher_no: "00049",
    finding_code: "COUNTERPART_SAME_SIDE",
    wrong_account_code: "320.10.Y0010",
    source_fingerprint: buildCorrectionRecordFingerprint(
      fingerprintInputFromDraftAndRecipe(draft, prep.recipe)
    ),
    status: CORRECTION_RECORD_STATUS.EXPORTED,
    external_system: "LUCA",
  });
  const appliedRecord = {
    ...exportedRecord,
    status: CORRECTION_RECORD_STATUS.APPLIED,
    external_voucher_no: "00121",
    external_voucher_date: "2026-04-01",
  };
  const cancelledRecord = {
    ...exportedRecord,
    status: CORRECTION_RECORD_STATUS.CANCELLED,
  };

  const exportedSummary = summarizeGenelMuhasebeFindingsWithCorrections(catalog, [exportedRecord]);
  assert(exportedSummary.duzeltildi === 0, "EXPORTED not counted as duzeltildi");
  assert(exportedSummary.incelemeGerekli === 2, "EXPORTED still inceleme");

  const appliedSummary = summarizeGenelMuhasebeFindingsWithCorrections(catalog, [appliedRecord]);
  assert(appliedSummary.duzeltildi === 1, "APPLIED duzeltildi count 1");
  assert(appliedSummary.incelemeGerekli === 1, "APPLIED removes one from inceleme");

  const cancelledSummary = summarizeGenelMuhasebeFindingsWithCorrections(catalog, [cancelledRecord]);
  assert(cancelledSummary.incelemeGerekli === 2, "CANCELLED back to unresolved");
}

// l/m/o apply validation
{
  const emptyNo = validateApplyCorrectionRecordInput({
    record: { id: "1", status: CORRECTION_RECORD_STATUS.EXPORTED, source_voucher_no: "00049", correction_date: "2026-04-01" },
    externalVoucherNo: "   ",
    externalVoucherDate: "2026-04-01",
    userConfirmed: true,
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "USER_CONFIRMED",
  });
  assert(!emptyNo.ok, "empty luca voucher no rejected");

  const noConfirm = validateApplyCorrectionRecordInput({
    record: { id: "1", status: CORRECTION_RECORD_STATUS.EXPORTED, source_voucher_no: "00049", correction_date: "2026-04-01" },
    externalVoucherNo: "00121",
    externalVoucherDate: "2026-04-01",
    userConfirmed: false,
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "USER_CONFIRMED",
  });
  assert(!noConfirm.ok, "no confirm rejected");

  const closedDate = validateApplyCorrectionRecordInput({
    record: { id: "1", status: CORRECTION_RECORD_STATUS.EXPORTED, source_voucher_no: "00049", correction_date: "2026-04-01" },
    externalVoucherNo: "00121",
    externalVoucherDate: "2026-02-01",
    userConfirmed: true,
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "USER_CONFIRMED",
  });
  assert(!closedDate.ok, "closed period date rejected");
}

// cancel backend
{
  const cancel = validateCancelCorrectionRecordInput({
    record: { id: "1", status: CORRECTION_RECORD_STATUS.APPLIED },
    cancelReason: "Yanlış fiş",
    userConfirmed: true,
  });
  assert(cancel.ok, "cancel validation ok");
}

// p worker parity preserved
{
  const raw = { rows: fx.ledgerRows, summary: {} };
  const sanitized = sanitizeAnalyzeResult(raw, { jobKind: "GENERAL_LEDGER_CONTROL" });
  const rows = buildGenelMuhasebeFindingsPresentation(
    [{ ...fx.finding, source: "extra" }],
    { correctionRecords: [] }
  );
  assert(sanitized.rows.length === fx.ledgerRows.length && rows.length >= 1, "worker parity presentation");
}

// q muavin/yevmiye sayaçları — genel-muhasebe-kontrol test paketi tarafından korunur (p 545/545)

// r V1 export regression — workbook headers
{
  const built = buildCorrectionExportWorkbook(draft, {
    userApproved: true,
    lastClosedReliability: "COMPANY_PROFILE",
    companySlug: "MARE",
  });
  assert(built.ok && built.rowCount === 2, "V1 export workbook 2 rows");
  const sheet = built.workbook.Sheets["Luca Fisleri"];
  assert(Boolean(sheet), "Luca Fisleri sheet preserved");
}

// s migration contract file exists + RLS keywords
{
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/036_accounting_correction_records.sql"),
    "utf8"
  );
  assert(migration.includes("accounting_correction_records"), "migration table");
  assert(migration.includes("annvero_can_access_company"), "RLS company gate");
  assert(migration.includes("uq_accounting_correction_records_active_fingerprint"), "unique fingerprint");
}

// t/u idempotent export payload same fingerprint
{
  const p1 = buildExportRecordPayloadFromDraft({ draft, recipe: prep.recipe, exportedFileName: "a.xlsx", lastClosedReliability: "COMPANY_PROFILE" });
  const p2 = buildExportRecordPayloadFromDraft({ draft, recipe: prep.recipe, exportedFileName: "b.xlsx", lastClosedReliability: "COMPANY_PROFILE" });
  assert(p1.sourceFingerprint === p2.sourceFingerprint, "same fingerprint regardless of filename");
}

// v unresolved warning still visible in presentation
{
  const catalog = [
    { fisNo: "00050", severity: "UYARI", code: "MISSING_COUNTERPART", hesapKodu: "100", message: "x" },
  ];
  const rows = buildGenelMuhasebeFindingsPresentation(catalog, { correctionRecords: [] });
  assert(rows.some((row) => row.fisNo === "00050"), "unresolved warning visible");
}

console.log(failed ? `\n${failed} test(s) failed` : "\nAll correction-records-v2 tests passed");
process.exit(failed ? 1 : 0);
