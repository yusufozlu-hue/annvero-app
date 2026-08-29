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
  CORRECTION_RECORD_ERROR,
  CORRECTION_RECORD_STATUS,
  assertExportApiReadyForDownload,
  canOpenApplyForCorrectionRecord,
  fingerprintInputFromDraftAndRecipe,
  isCorrectionRecordNotFoundError,
  mergeCorrectionRecordIntoList,
  publicCorrectionRecordView,
  resolveCorrectionRecordForFinding,
  resolveCorrectionRecordRouteId,
  indexCorrectionRecordsByFingerprint,
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

// g/h/i presentation counters + overallSonuc correction-aware
{
  const catalog = [
    { fisNo: "00049", severity: "UYARI", code: "COUNTERPART_SAME_SIDE", hesapKodu: "320.10.Y0010" },
    { fisNo: "00050", severity: "UYARI", code: "MISSING_COUNTERPART", hesapKodu: "100" },
    { fisNo: "00001", severity: "BILGI", code: "MULTI_COUNTERPART", hesapKodu: "100" },
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

  const unresolvedSummary = summarizeGenelMuhasebeFindingsWithCorrections(catalog, []);
  assert(unresolvedSummary.overallSonuc === "Uyarı", "unresolved UYARI → Sonuç Uyarı");
  assert(unresolvedSummary.incelemeGerekli === 2, "unresolved İnceleme 2");
  assert(unresolvedSummary.duzeltildi === 0, "unresolved Düzeltildi 0");

  const exportedSummary = summarizeGenelMuhasebeFindingsWithCorrections(catalog, [exportedRecord]);
  assert(exportedSummary.duzeltildi === 0, "EXPORTED not counted as duzeltildi");
  assert(exportedSummary.incelemeGerekli === 2, "EXPORTED still inceleme");
  assert(exportedSummary.overallSonuc === "Uyarı", "EXPORTED → Sonuç Uyarı");

  const appliedSummary = summarizeGenelMuhasebeFindingsWithCorrections(catalog, [appliedRecord]);
  assert(appliedSummary.duzeltildi === 1, "APPLIED duzeltildi count 1");
  assert(appliedSummary.incelemeGerekli === 1, "APPLIED removes one from inceleme");
  assert(appliedSummary.overallSonuc === "Uyarı", "APPLIED one of two still Uyarı");

  const soleAppliedCatalog = [
    { fisNo: "00049", severity: "UYARI", code: "COUNTERPART_SAME_SIDE", hesapKodu: "320.10.Y0010" },
    { fisNo: "00001", severity: "BILGI", code: "MULTI_COUNTERPART", hesapKodu: "100" },
  ];
  const soleApplied = summarizeGenelMuhasebeFindingsWithCorrections(soleAppliedCatalog, [
    appliedRecord,
  ]);
  assert(soleApplied.overallSonuc === "Bilgi", "APPLIED sole UYARI → Sonuç Bilgi");
  assert(soleApplied.incelemeGerekli === 0, "APPLIED sole → İnceleme 0");
  assert(soleApplied.duzeltildi === 1, "APPLIED sole → Düzeltildi 1");

  const cancelledSummary = summarizeGenelMuhasebeFindingsWithCorrections(catalog, [cancelledRecord]);
  assert(cancelledSummary.incelemeGerekli === 2, "CANCELLED back to unresolved");
  assert(cancelledSummary.overallSonuc === "Uyarı", "CANCELLED → Sonuç Uyarı");
  assert(cancelledSummary.duzeltildi === 0, "CANCELLED not duzeltildi");

  const presentationApplied = buildGenelMuhasebeFindingsPresentation(soleAppliedCatalog, {
    correctionRecords: [appliedRecord],
  });
  const appliedRow = presentationApplied.find((row) => row.fisNo === "00049");
  assert(appliedRow?.severity === "UYARI", "table keeps UYARI severity history");
  assert(appliedRow?.correctionResolved === true, "table Durum=Düzeltildi via correctionResolved");
  assert(appliedRow?.correctionStatusLabel === "Düzeltildi", "table status label Düzeltildi");
  assert(soleApplied.overallSonuc === "Bilgi", "table UYARI history does not inflate overall");
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

// s migration contract file exists + RLS keywords + least-privilege grants
{
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/036_accounting_correction_records.sql"),
    "utf8"
  );
  assert(migration.includes("accounting_correction_records"), "migration table");
  assert(migration.includes("annvero_can_access_company"), "RLS company gate");
  assert(migration.includes("uq_accounting_correction_records_active_fingerprint"), "unique fingerprint");

  const sql = migration.toLowerCase();
  assert(
    /revoke\s+all\s+privileges\s+on\s+table\s+public\.accounting_correction_records\s+from\s+anon\s*,\s*authenticated/i.test(
      migration
    ),
    "036 revoke ALL from anon+authenticated"
  );
  assert(
    /grant\s+select\s+on\s+table\s+public\.accounting_correction_records\s+to\s+authenticated/i.test(
      migration
    ),
    "036 grant SELECT only to authenticated"
  );
  assert(
    /grant\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.accounting_correction_records\s+to\s+service_role/i.test(
      migration
    ),
    "036 grant SELECT/INSERT/UPDATE/DELETE to service_role"
  );
  assert(!/grant\s+all\b/i.test(migration), "036 must not GRANT ALL");
  assert(
    !/grant\s+[^;]*\btruncate\b[^;]*to\s+authenticated/i.test(sql),
    "036 must not GRANT TRUNCATE to authenticated"
  );
  assert(
    !/grant\s+[^;]*\breferences\b[^;]*to\s+authenticated/i.test(sql),
    "036 must not GRANT REFERENCES to authenticated"
  );
  assert(
    !/grant\s+[^;]*\btrigger\b[^;]*to\s+authenticated/i.test(sql),
    "036 must not GRANT TRIGGER to authenticated"
  );
  assert(
    !/grant\s+[^;]*\btruncate\b[^;]*to\s+service_role/i.test(sql),
    "036 must not GRANT TRUNCATE to service_role"
  );
  // API cancel = soft UPDATE; physical DELETE not used on correction records
  const apiRoot = path.join(process.cwd(), "app/api/accounting-correction-records");
  const apiFiles = fs
    .readdirSync(apiRoot, { recursive: true })
    .filter((f) => String(f).endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(apiRoot, f), "utf8"))
    .join("\n");
  assert(
    !/\.from\(\s*CORRECTION_RECORDS_TABLE\s*\)[\s\S]{0,120}\.delete\s*\(/m.test(apiFiles),
    "API must not physically DELETE correction records"
  );
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

// fail-closed export gate + apply route params + hydrate
{
  const failHttp = assertExportApiReadyForDownload(false, {
    code: CORRECTION_RECORD_ERROR.EXPORT_FAILED,
    error: "Düzeltme export kaydı oluşturulamadı.",
  });
  assert(!failHttp.ok && !failHttp.allowDownload && !failHttp.allowApply, "export API fail blocks download+apply");

  const failMissingRecord = assertExportApiReadyForDownload(true, { created: true, fileName: "x.xlsx" });
  assert(!failMissingRecord.ok && !failMissingRecord.allowDownload, "200 without record id blocks download");

  const exportedView = publicCorrectionRecordView({
    id: "4cc7f573-ccfb-4685-813b-bb825577154f",
    company_id: "company-a",
    source_voucher_no: "00049",
    source_fingerprint: "fp-abc",
    status: CORRECTION_RECORD_STATUS.EXPORTED,
    finding_code: fx.finding.code,
    wrong_account_code: fx.finding.hesapKodu,
    exported_file_name: "MARE.xlsx",
    correction_debit: 135000,
    correction_credit: 135000,
  });
  const okGate = assertExportApiReadyForDownload(true, {
    record: exportedView,
    created: true,
    fileName: "MARE.xlsx",
  });
  assert(
    okGate.ok && okGate.allowDownload && okGate.allowApply && okGate.record.id === exportedView.id,
    "export success keeps record id"
  );

  assert(canOpenApplyForCorrectionRecord(exportedView), "EXPORTED with id can open apply");
  assert(!canOpenApplyForCorrectionRecord({ ...exportedView, id: "" }), "missing id cannot open apply");
  assert(!canOpenApplyForCorrectionRecord({ ...exportedView, status: "DRAFT" }), "non-EXPORTED cannot open apply");

  const merged = mergeCorrectionRecordIntoList([], exportedView);
  assert(merged.length === 1 && merged[0].id === exportedView.id, "hydrate stores exported record");
  const mergedDup = mergeCorrectionRecordIntoList(merged, {
    ...exportedView,
    exportedFileName: "other.xlsx",
  });
  assert(mergedDup.length === 1, "same fingerprint does not duplicate");

  const byFp = indexCorrectionRecordsByFingerprint(mergedDup);
  const hydrated = resolveCorrectionRecordForFinding(fx.finding, byFp);
  assert(hydrated?.id === exportedView.id, "reload/hydrate finds same fingerprint record");

  const applyOk = validateApplyCorrectionRecordInput({
    record: {
      id: exportedView.id,
      status: CORRECTION_RECORD_STATUS.EXPORTED,
      source_voucher_no: "00049",
      correction_date: "2026-04-01",
    },
    externalVoucherNo: "00121",
    externalVoucherDate: "2026-04-01",
    userConfirmed: true,
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "USER_CONFIRMED",
  });
  assert(applyOk.ok, "EXPORTED→APPLIED validation ok");

  const wrongTenant = validateApplyCorrectionRecordInput({
    record: null,
    externalVoucherNo: "00121",
    externalVoucherDate: "2026-04-01",
    userConfirmed: true,
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "USER_CONFIRMED",
  });
  assert(!wrongTenant.ok && wrongTenant.code === CORRECTION_RECORD_ERROR.NOT_FOUND, "missing/wrong record rejected");

  assert(
    isCorrectionRecordNotFoundError(
      { code: CORRECTION_RECORD_ERROR.NOT_FOUND, error: "Düzeltme kaydı bulunamadı." },
      false
    ),
    "NOT_FOUND closes stale apply modal"
  );

  const applyRouteSrc = fs.readFileSync(
    path.join(process.cwd(), "app/api/accounting-correction-records/[id]/apply/route.js"),
    "utf8"
  );
  const cancelRouteSrc = fs.readFileSync(
    path.join(process.cwd(), "app/api/accounting-correction-records/[id]/cancel/route.js"),
    "utf8"
  );
  assert(
    applyRouteSrc.includes("resolveCorrectionRecordRouteId(context?.params)"),
    "apply route awaits Next params via helper"
  );
  assert(
    cancelRouteSrc.includes("resolveCorrectionRecordRouteId(context?.params)"),
    "cancel route awaits Next params via helper"
  );
  assert(!/params\?\.id/.test(applyRouteSrc), "apply must not read params.id without await");
  assert(!/params\?\.id/.test(cancelRouteSrc), "cancel must not read params.id without await");
}

{
  const fromPromise = await resolveCorrectionRecordRouteId(
    Promise.resolve({ id: "4cc7f573-ccfb-4685-813b-bb825577154f" })
  );
  assert(fromPromise === "4cc7f573-ccfb-4685-813b-bb825577154f", "await params Promise resolves id");
  const fromObject = await resolveCorrectionRecordRouteId({ id: "abc" });
  assert(fromObject === "abc", "plain params object still works");
  const emptyPromise = await resolveCorrectionRecordRouteId(Promise.resolve({}));
  assert(emptyPromise === "", "empty params Promise yields empty id (NOT_FOUND path)");
}

console.log(failed ? `\n${failed} test(s) failed` : "\nAll correction-records-v2 tests passed");
process.exit(failed ? 1 : 0);
