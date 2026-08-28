/**
 * Düzeltme fişi V1 — recipe registry, taslak, validasyon, export sözleşmesi.
 * Run: npm run test:correction-voucher-v1
 */
import fs from "node:fs";
import path from "node:path";
import {
  CORRECTION_DATE_SOURCE,
  CORRECTION_DRAFT_STATUS,
  CORRECTION_RECIPE,
  PLANNED_CORRECTION_RECIPES,
  buildCorrectionDraft,
  buildSourceVoucherFromLedgerRows,
  detectCorrectionRecipe,
  exportCorrectionDraft,
  firstOpenDateAfterClosedPeriod,
  isCorrectionEligibleFinding,
  listCorrectionRecipeTypes,
  normalizeCorrectionDraft,
  plannedRecipeMessage,
  prepareCorrectionFromFinding,
  resolveCorrectionCandidate,
  resolveCorrectionDateContext,
  resolveLastClosedLedgerPeriod,
  validateCorrectionDate,
  validateCorrectionDraft,
  resolveSourceVoucherDate,
  canonicalLedgerDateTR,
} from "@/src/utils/correctionVoucher/index.js";
import { sanitizeAnalyzeResult } from "@/src/utils/eDefterAnalyzeContract.js";
import { buildAccountPlanCodeSet } from "@/src/utils/genelMuhasebeKontrolEngine.js";
import { CORRECTION_VOUCHER_SAME_ACCOUNT_WRONG_DEBIT } from "./fixtures/correction-voucher-same-account-wrong-debit.mjs";
import { readSheetRowsFromArrayBuffer } from "@/src/utils/excelBufferUtils.js";
import { runGenelMuhasebeKontrol } from "@/src/utils/genelMuhasebeKontrolEngine.js";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else console.log(`PASS  ${msg}`);
}

const fx = CORRECTION_VOUCHER_SAME_ACCOUNT_WRONG_DEBIT;
const sourceVoucher = buildSourceVoucherFromLedgerRows(fx.ledgerRows, fx.finding.fisNo, {
  finding: fx.finding,
});
const planCodes = buildAccountPlanCodeSet(fx.accountPlan);

function pickAlternativeDebitAccount(plan = [], wrongCode = "") {
  const wrong = String(wrongCode || "").trim();
  const row = plan.find((entry) => {
    const code = String(entry.account_code || "").trim();
    return code && code !== wrong && !code.startsWith("191");
  });
  if (!row) return null;
  return {
    code: row.account_code,
    name: row.account_name || "",
  };
}

function findFirstEligibleFinding(findings = [], ledgerRows = []) {
  return (findings || []).find((finding) =>
    isCorrectionEligibleFinding(finding, ledgerRows)
  );
}

// Registry — recipe mimarisi
{
  const types = listCorrectionRecipeTypes();
  assert(
    types.implemented.includes(CORRECTION_RECIPE.SAME_ACCOUNT_WRONG_DEBIT),
    "registry SAME_ACCOUNT_WRONG_DEBIT implemented"
  );
  assert(
    PLANNED_CORRECTION_RECIPES.includes(CORRECTION_RECIPE.WRONG_ACCOUNT_TRANSFER),
    "registry WRONG_ACCOUNT_TRANSFER planned"
  );
  for (const planned of PLANNED_CORRECTION_RECIPES) {
    assert(
      plannedRecipeMessage(planned).includes("manuel"),
      `planned recipe ${planned} fail-closed message`
    );
  }
}

// Worker/main — sanitize tarih alanını düşürmez (preview kök neden)
{
  const raw = {
    rows: [
      {
        id: "w1",
        fisNo: "00049",
        tarih: "16.02.2026",
        hesapKodu: "320.10.Y0010",
        borc: 135000,
        alacak: 0,
        belgeNo: "YEF2026000000003",
      },
    ],
    summary: {},
  };
  const sanitized = sanitizeAnalyzeResult(raw, { jobKind: "GENERAL_LEDGER_CONTROL" });
  assert(sanitized.rows[0]?.tarih === "16.02.2026", "sanitize preserves tarih");
  const voucher = buildSourceVoucherFromLedgerRows(sanitized.rows, "00049", {
    finding: { fisNo: "00049", tarih: "16.02.2026", severity: "UYARI" },
  });
  assert(voucher?.tarih === "16.02.2026", "sanitized rows → source date 16.02.2026");
  assert(voucher?.metaComplete, "sanitized rows meta complete");
}

// Tarih satırlarda yok — bulgu tarihi fallback (gerçek preview senaryosu)
{
  const rowsNoDate = fx.ledgerRows.map((row) => ({ ...row, tarih: "" }));
  const voucher = buildSourceVoucherFromLedgerRows(rowsNoDate, fx.finding.fisNo, {
    finding: fx.finding,
  });
  assert(voucher?.tarih === "16.02.2026", "finding tarih fallback 16.02.2026");
  assert(voucher?.metaComplete, "finding tarih fallback meta complete");
}

// Luca block header DD/MM/YYYY — 16/02/2026 → 16.02.2026 (MM/DD yorumlanmaz)
{
  assert(canonicalLedgerDateTR("16/02/2026") === "16.02.2026", "16/02/2026 DD/MM safe");
  const rows = [
    {
      fisNo: "00049",
      hesapKodu: "320.10.Y0010",
      borc: 135000,
      alacak: 0,
      aciklama: "00049-----00049-----MAHSUP-----16/02/2026",
      belgeNo: "YEF2026000000003",
    },
    {
      fisNo: "00049",
      hesapKodu: "320.10.Y0010",
      borc: 0,
      alacak: 135000,
      aciklama: "00049-----00049-----MAHSUP-----16/02/2026",
      belgeNo: "YEF2026000000003",
    },
  ];
  const resolved = resolveSourceVoucherDate({ fisRows: rows, allRows: rows, fisNo: "00049" });
  assert(resolved.ok && resolved.value === "16.02.2026", "block header date 16.02.2026");
}

// Çelişkili tarihler fail-closed
{
  const rows = [
    { fisNo: "C1", tarih: "01.02.2026", hesapKodu: "100", borc: 10, alacak: 0 },
    { fisNo: "C1", tarih: "02.02.2026", hesapKodu: "100", borc: 0, alacak: 10 },
  ];
  const resolved = resolveSourceVoucherDate({ fisRows: rows, allRows: rows, fisNo: "C1" });
  assert(!resolved.ok && resolved.reason === "AMBIGUOUS_DATE", "conflicting dates fail-closed");
}

// Kullanıcı hesap seçimi korunur — 740.03.044 stale olmaz
{
  const recipe = detectCorrectionRecipe(fx.finding, sourceVoucher);
  const draft = buildCorrectionDraft(recipe, {
    correctDebitAccountCode: "740.03.044",
    correctDebitAccountName: "DİĞER DANIŞMANLIK GİDERLERİ",
    companyAccountingRules: fx.companyAccountingRules,
    userCorrectionDate: "2026-04-01",
    accountPlanCodes: null,
  });
  assert(draft.lines[0].hesapKodu === "740.03.044", "user pick 740.03.044 debit line");
  assert(draft.description.includes("740.03.044"), "user pick 740.03.044 description");
  assert(!draft.description.includes("740.30.038"), "no stale 740.30.038");
}

// 1 — recipe algılama (00049 yalnız fixture)
{
  const recipe = detectCorrectionRecipe(fx.finding, sourceVoucher);
  assert(recipe.ok, "1 recipe detected");
  assert(
    recipe.recipeType === CORRECTION_RECIPE.SAME_ACCOUNT_WRONG_DEBIT,
    "1 SAME_ACCOUNT_WRONG_DEBIT"
  );
  assert(recipe.wrongAccountCode === "320.10.Y0010", "1 wrong account from voucher");
  assert(recipe.wrongDebitAmount === 135000, "1 wrong amount");
  assert(
    resolveCorrectionCandidate(fx.finding, sourceVoucher).ok,
    "1 resolveCorrectionCandidate alias"
  );
}

// Generic minimal voucher — fiş/firma bağımsız
{
  const rows = [
    { fisNo: "GEN-1", tarih: "01.03.2026", belgeNo: "DOC001", hesapKodu: "600.01", borc: 100, alacak: 0 },
    { fisNo: "GEN-1", tarih: "01.03.2026", belgeNo: "DOC001", hesapKodu: "600.01", borc: 0, alacak: 100 },
  ];
  const finding = { fisNo: "GEN-1", severity: "UYARI", code: "COUNTERPART_SAME_SIDE" };
  const voucher = buildSourceVoucherFromLedgerRows(rows, "GEN-1");
  const recipe = detectCorrectionRecipe(finding, voucher);
  assert(recipe.ok, "generic voucher recipe ok");
  assert(recipe.wrongDebitAmount === 100, "generic voucher amount");
}

// 2 — belirsiz çoklu borç fail-closed
{
  const rows = [
    { fisNo: "X99", hesapKodu: "400.01", borc: 50, alacak: 0 },
    { fisNo: "X99", hesapKodu: "400.01", borc: 0, alacak: 100 },
    { fisNo: "X99", hesapKodu: "400.01", borc: 50, alacak: 0 },
  ];
  const finding = { fisNo: "X99", severity: "UYARI" };
  const voucher = buildSourceVoucherFromLedgerRows(rows, "X99");
  const recipe = detectCorrectionRecipe(finding, voucher);
  assert(!recipe.ok, "2 ambiguous multi-debit fail-closed");
}

// 3–5 — iki satırlı dengeli taslak, KDV yok
{
  const recipe = detectCorrectionRecipe(fx.finding, sourceVoucher);
  const draft = buildCorrectionDraft(recipe, {
    ...fx.userSelections,
    companyAccountingRules: fx.companyAccountingRules,
    userCorrectionDate: "2026-04-01",
    correctionDateSource: CORRECTION_DATE_SOURCE.AUTO_DEFAULT,
    accountPlanCodes: planCodes,
  });
  assert(draft.ok, "3 draft ok");
  assert(draft.lines.length === 2, "3 two lines");
  assert(draft.kdvLineCount === 0, "5 no KDV in draft");
  assert(draft.status === CORRECTION_DRAFT_STATUS.READY, "3 draft status READY");
  assert(draft.totalDebit === 135000 && draft.totalCredit === 135000, "3 normalized totals");
  assert(draft.sourceFindingCode === "COUNTERPART_SAME_SIDE", "3 sourceFindingCode");
  const val = validateCorrectionDraft(draft, {
    accountPlanCodes: planCodes,
    lastClosedReliability: "COMPANY_PROFILE",
  });
  assert(val.ok, "4 balanced draft");
  assert(val.borc === 135000 && val.alacak === 135000, "4 borc=alacak");
}

// 6 — düzeltme 2026/04, kaynak 2026/02 korunur
{
  const recipe = detectCorrectionRecipe(fx.finding, sourceVoucher);
  const draft = buildCorrectionDraft(recipe, {
    ...fx.userSelections,
    companyAccountingRules: fx.companyAccountingRules,
    userCorrectionDate: "2026-04-15",
    correctionDateSource: CORRECTION_DATE_SOURCE.USER_SELECTED,
    accountPlanCodes: planCodes,
  });
  assert(draft.correctionPeriod === "2026/04", "6 correction period 2026/04");
  assert(
    draft.sourceDate.includes("02") || draft.sourceDate === "16.02.2026",
    "7 source date preserved"
  );
  assert(draft.sourceDocumentNo === "YEF2026000000003", "7 source document");
}

// Tarih politikası — 2026/03 kapalı → varsayılan 01.04.2026
{
  assert(firstOpenDateAfterClosedPeriod("2026/03") === "2026-04-01", "date default 01.04.2026");
  const ctx = resolveCorrectionDateContext({
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "COMPANY_PROFILE",
  });
  assert(ctx.correctionDate === "2026-04-01", "date ctx auto default");
  assert(ctx.correctionDateSource === CORRECTION_DATE_SOURCE.AUTO_DEFAULT, "date source auto");
}

// kullanıcı 15.04.2026 seçebilir
{
  const ok = validateCorrectionDate({
    correctionDate: "2026-04-15",
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "COMPANY_PROFILE",
  });
  assert(ok.ok, "user 15.04.2026 allowed");
}

// 31.03.2026 reddedilir
{
  const bad = validateCorrectionDate({
    correctionDate: "2026-03-31",
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "COMPANY_PROFILE",
  });
  assert(!bad.ok, "31.03.2026 rejected");
}

// kapalı dönem bilinmiyorsa otomatik tarih yok
{
  const ctx = resolveCorrectionDateContext({
    lastClosedLedgerPeriod: "",
    lastClosedReliability: null,
  });
  assert(ctx.requiresClosedPeriodInput, "unknown closed → require input");
  assert(!ctx.correctionDate, "unknown closed → no auto date");
}

// farklı firmalar bağımsız
{
  const a = resolveLastClosedLedgerPeriod({
    companyAccountingRules: { lastClosedEdefterPeriod: "2026/03" },
  });
  const b = resolveLastClosedLedgerPeriod({
    companyAccountingRules: { lastClosedEdefterPeriod: "2025/12" },
  });
  assert(a.lastClosedLedgerPeriod === "2026/03", "firm A period");
  assert(b.lastClosedLedgerPeriod === "2025/12", "firm B period");
  assert(
    firstOpenDateAfterClosedPeriod(a.lastClosedLedgerPeriod) === "2026-04-01",
    "firm A first open"
  );
  assert(
    firstOpenDateAfterClosedPeriod(b.lastClosedLedgerPeriod) === "2026-01-01",
    "firm B first open"
  );
}

// 8 — aktif olmayan hesap reddedilir
{
  const recipe = detectCorrectionRecipe(fx.finding, sourceVoucher);
  const draft = buildCorrectionDraft(recipe, {
    correctDebitAccountCode: "999.99.999",
    correctDebitAccountName: "YOK",
    companyAccountingRules: fx.companyAccountingRules,
    userCorrectionDate: "2026-04-01",
    accountPlanCodes: planCodes,
  });
  assert(!draft.ok, "8 inactive account rejected");
}

// 9 — belirsiz aday fail-closed (çoklu çift yönlü hesap)
{
  const rows = [
    { fisNo: "M1", hesapKodu: "100", borc: 10, alacak: 0 },
    { fisNo: "M1", hesapKodu: "100", borc: 0, alacak: 10 },
    { fisNo: "M1", hesapKodu: "200", borc: 5, alacak: 0 },
    { fisNo: "M1", hesapKodu: "200", borc: 0, alacak: 5 },
  ];
  const recipe = detectCorrectionRecipe(
    { fisNo: "M1", severity: "UYARI" },
    buildSourceVoucherFromLedgerRows(rows, "M1")
  );
  assert(!recipe.ok && recipe.reason === "AMBIGUOUS_ACCOUNT", "9 ambiguous fail-closed");
}

// 10 — dengesiz taslak export edilemez
{
  const badDraft = normalizeCorrectionDraft({
    ok: true,
    persist: 0,
    status: CORRECTION_DRAFT_STATUS.READY,
    correctionDate: "2026-04-01",
    lastClosedLedgerPeriod: "2026/03",
    lines: [
      { hesapKodu: "740.30.038", borc: 100, alacak: 0 },
      { hesapKodu: "320.10.Y0010", borc: 0, alacak: 90 },
    ],
    reference: {
      ok: true,
      sourceFisNo: "00049",
      sourceDate: "16.02.2026",
      sourceDocumentNo: "YEF2026000000003",
    },
    sourceFisNo: "00049",
    sourceDate: "16.02.2026",
    sourceDocumentNo: "YEF2026000000003",
    description: "test",
    correctionPeriod: "2026/04",
  });
  const exp = exportCorrectionDraft(badDraft, {
    userApproved: true,
    lastClosedReliability: "COMPANY_PROFILE",
  });
  assert(!exp.ok, "10 unbalanced export blocked");
}

// 11 — onay öncesi export yok
{
  const recipe = detectCorrectionRecipe(fx.finding, sourceVoucher);
  const draft = buildCorrectionDraft(recipe, {
    ...fx.userSelections,
    companyAccountingRules: fx.companyAccountingRules,
    userCorrectionDate: "2026-04-01",
    accountPlanCodes: planCodes,
  });
  const exp = exportCorrectionDraft(draft, { userApproved: false });
  assert(!exp.ok && exp.reason === "APPROVAL_REQUIRED", "11 no export without approval");
}

// Kaynak meta tamamlanır
{
  assert(sourceVoucher?.metaComplete, "source voucher meta complete");
  assert(sourceVoucher?.tarih === "16.02.2026", "source voucher date resolved");
  assert(sourceVoucher?.belgeNo === "YEF2026000000003", "source voucher document resolved");
}

// Ay/yıl geçişi: 2026/12 → 01.01.2027
{
  assert(firstOpenDateAfterClosedPeriod("2026/12") === "2027-01-01", "year rollover first open");
  const ok = validateCorrectionDate({
    correctionDate: "2027-01-15",
    lastClosedLedgerPeriod: "2026/12",
    lastClosedReliability: "COMPANY_PROFILE",
  });
  assert(ok.ok && ok.correctionPeriod === "2027/01", "2027/01 open period accepted");
}

// Timezone kayması yok — ordinal karşılaştırma 2026-04-01 açık dönem
{
  const ctx = resolveCorrectionDateContext({
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "COMPANY_PROFILE",
  });
  const val = validateCorrectionDate({
    correctionDate: ctx.correctionDate,
    lastClosedLedgerPeriod: "2026/03",
    lastClosedReliability: "COMPANY_PROFILE",
  });
  assert(val.ok, "auto default date validates without tz shift");
  assert(ctx.correctionDate === "2026-04-01", "auto default iso stable");
}

// Luca block: belge açıklamadan çözülür (generic fisNo)
{
  const rows = [
    {
      fisNo: "LUCA-1",
      tarih: "16.02.2026",
      hesapKodu: "191.01.020.108",
      borc: 27000,
      alacak: 0,
      aciklama: "YEF2026000000003 KDV",
    },
    {
      fisNo: "LUCA-1",
      tarih: "16.02.2026",
      hesapKodu: "320.10.Y0010",
      borc: 135000,
      alacak: 0,
      aciklama: "YEF2026000000003",
    },
    {
      fisNo: "LUCA-1",
      tarih: "16.02.2026",
      hesapKodu: "320.10.Y0010",
      borc: 0,
      alacak: 162000,
      aciklama: "YEF2026000000003",
    },
  ];
  const voucher = buildSourceVoucherFromLedgerRows(rows, "LUCA-1");
  assert(voucher?.metaComplete, "luca block meta from aciklama");
  assert(voucher?.belgeNo === "YEF2026000000003", "luca block document token");
}

// Kaynak tarih/belge belirsizse fail-closed
{
  const rows = [
    { fisNo: "X1", tarih: "01.01.2026", hesapKodu: "320.01", borc: 10, alacak: 0, belgeNo: "B1" },
    { fisNo: "X1", tarih: "02.01.2026", hesapKodu: "320.01", borc: 0, alacak: 10, belgeNo: "B1" },
  ];
  const voucher = buildSourceVoucherFromLedgerRows(rows, "X1");
  assert(!voucher?.metaComplete, "ambiguous date blocks meta");
  const recipe = detectCorrectionRecipe({ fisNo: "X1", severity: "UYARI" }, voucher);
  const alt = pickAlternativeDebitAccount(fx.accountPlan, "320.01");
  assert(
    !recipe?.ok ||
      !buildCorrectionDraft(recipe, {
        correctDebitAccountCode: alt?.code || "740.30.038",
        correctDebitAccountName: alt?.name || "GIDER",
        companyAccountingRules: { lastClosedEdefterPeriod: "2026/03" },
        userCorrectionDate: "2026-04-01",
        accountPlanCodes: planCodes,
      }).ok,
    "ambiguous source meta blocks draft"
  );
}

// Hesap seçimi taslak/açıklama/export'ta tutarlı
{
  const recipe = detectCorrectionRecipe(fx.finding, sourceVoucher);
  const draftA = buildCorrectionDraft(recipe, {
    correctDebitAccountCode: "740.30.038",
    correctDebitAccountName: "MALİ DANIŞMANLIK GİDERLERİ",
    companyAccountingRules: fx.companyAccountingRules,
    userCorrectionDate: "2026-04-01",
    accountPlanCodes: null,
  });
  const draftB = buildCorrectionDraft(recipe, {
    correctDebitAccountCode: "740.03.044",
    correctDebitAccountName: "DİĞER DANIŞMANLIK GİDERLERİ",
    companyAccountingRules: fx.companyAccountingRules,
    userCorrectionDate: "2026-04-01",
    accountPlanCodes: null,
  });
  assert(draftA.lines[0].hesapKodu === "740.30.038", "draft A debit code");
  assert(draftA.description.includes("740.30.038"), "draft A description code");
  assert(draftB.lines[0].hesapKodu === "740.03.044", "draft B debit code");
  assert(!draftA.description.includes("740.03.044"), "draft A not stale B code");
}

// prepareCorrectionFromFinding entegrasyon
{
  const prep = prepareCorrectionFromFinding({
    finding: fx.finding,
    ledgerRows: fx.ledgerRows,
    companyAccountingRules: fx.companyAccountingRules,
  });
  assert(prep.recipe?.ok, "prepare recipe ok");
  assert(prep.dateContext?.correctionDate === "2026-04-01", "prepare default date");
}

// Real Excel readonly smoke (optional) — fiş numarası hardcode yok
{
  const yevPath = path.join(
    process.env.USERPROFILE || "",
    "Desktop",
    "yevmiye_defteri_mare.xlsx"
  );
  if (!fs.existsSync(yevPath)) {
    console.log("SKIP  real excel smoke (yevmiye not on Desktop)");
  } else {
    const buf = fs.readFileSync(yevPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const sheetRows = readSheetRowsFromArrayBuffer(ab);
    const r = runGenelMuhasebeKontrol({
      companyId: "real-smoke-company",
      period: "2026/03",
      yevmiyeSheetRows: sheetRows,
      accountPlanAccounts: fx.accountPlan,
      accountPlanStatus: "loaded",
    });
    const eligibleFinding = findFirstEligibleFinding(r.findingsCatalog, r.rows);
    if (!eligibleFinding) {
      console.log("SKIP  real smoke — no eligible finding in live file");
    } else {
      const prep = prepareCorrectionFromFinding({
        finding: eligibleFinding,
        ledgerRows: r.rows,
        companyAccountingRules: fx.companyAccountingRules,
      });
      assert(prep.recipe?.ok, "real smoke recipe detected generically");
      assert(prep.sourceVoucher?.metaComplete, "real smoke source meta complete");
      const alt = pickAlternativeDebitAccount(
        fx.accountPlan,
        prep.recipe.wrongAccountCode
      );
      assert(alt?.code, "real smoke alternative debit account from plan");
      const draft = buildCorrectionDraft(prep.recipe, {
        correctDebitAccountCode: alt.code,
        correctDebitAccountName: alt.name,
        companyAccountingRules: fx.companyAccountingRules,
        userCorrectionDate: "2026-04-01",
        accountPlanCodes: planCodes,
      });
      assert(draft.lines.length === 2, "real smoke 2 lines");
      assert(
        draft.lines[0].borc === prep.recipe.wrongDebitAmount,
        "real smoke debit amount from recipe"
      );
      assert(draft.persist === 0, "real smoke persist 0");
      assert(r.counters.persistInvocations === 0, "real GM persist 0 unchanged");
    }
  }
}

console.log(failed ? `\n${failed} failed` : "\nAll correction-voucher-v1 tests passed");
process.exit(failed ? 1 : 0);
