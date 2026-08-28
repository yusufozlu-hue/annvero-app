/**
 * Düzeltme fişi V1 — recipe, tarih politikası, taslak, validasyon, export sözleşmesi.
 * Run: npm run test:correction-voucher-v1
 */
import fs from "node:fs";
import path from "node:path";
import {
  CORRECTION_DATE_SOURCE,
  CORRECTION_RECIPE,
  buildCorrectionDraft,
  buildSourceVoucherFromLedgerRows,
  detectCorrectionRecipe,
  exportCorrectionDraft,
  firstOpenDateAfterClosedPeriod,
  prepareCorrectionFromFinding,
  resolveCorrectionDateContext,
  resolveLastClosedLedgerPeriod,
  validateCorrectionDate,
  validateCorrectionDraft,
} from "@/src/utils/correctionVoucher/index.js";
import { buildAccountPlanCodeSet } from "@/src/utils/genelMuhasebeKontrolEngine.js";
import { CORRECTION_VOUCHER_00049 } from "./fixtures/correction-voucher-00049.mjs";
import { readSheetRowsFromArrayBuffer } from "@/src/utils/excelBufferUtils.js";
import { runGenelMuhasebeKontrol } from "@/src/utils/genelMuhasebeKontrolEngine.js";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else console.log(`PASS  ${msg}`);
}

const fx = CORRECTION_VOUCHER_00049;
const sourceVoucher = buildSourceVoucherFromLedgerRows(fx.ledgerRows, fx.finding.fisNo);
const planCodes = buildAccountPlanCodeSet(fx.accountPlan);

// 1 — recipe algılama (hardcode yok)
{
  const recipe = detectCorrectionRecipe(fx.finding, sourceVoucher);
  assert(recipe.ok, "1 recipe detected");
  assert(recipe.recipeType === CORRECTION_RECIPE.SAME_ACCOUNT_WRONG_DEBIT, "1 SAME_ACCOUNT_WRONG_DEBIT");
  assert(recipe.wrongAccountCode === "320.10.Y0010", "1 wrong account from voucher");
  assert(recipe.wrongDebitAmount === 135000, "1 wrong amount");
}

// 2 — farklı fiş verisiyle generic (MARE/00049 hardcode yok)
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
  assert(draft.reference.sourceDate.includes("02") || draft.reference.sourceDate === "16.02.2026", "7 source date preserved");
  assert(draft.reference.sourceDocumentNo === "YEF2026000000003", "7 source document");
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
  const badDraft = {
    ok: true,
    persist: 0,
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
    description: "test",
    correctionPeriod: "2026/04",
  };
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

// Luca block: belge açıklamadan çözülür
{
  const rows = [
    {
      fisNo: "00049",
      tarih: "16.02.2026",
      hesapKodu: "191.01.020.108",
      borc: 27000,
      alacak: 0,
      aciklama: "YEF2026000000003 KDV",
    },
    {
      fisNo: "00049",
      tarih: "16.02.2026",
      hesapKodu: "320.10.Y0010",
      borc: 135000,
      alacak: 0,
      aciklama: "YEF2026000000003",
    },
    {
      fisNo: "00049",
      tarih: "16.02.2026",
      hesapKodu: "320.10.Y0010",
      borc: 0,
      alacak: 162000,
      aciklama: "YEF2026000000003",
    },
  ];
  const voucher = buildSourceVoucherFromLedgerRows(rows, "00049");
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
  assert(!recipe?.ok || !buildCorrectionDraft(recipe, {
    correctDebitAccountCode: "740.30.038",
    correctDebitAccountName: "GIDER",
    companyAccountingRules: { lastClosedEdefterPeriod: "2026/03" },
    userCorrectionDate: "2026-04-01",
    accountPlanCodes: planCodes,
  }).ok, "ambiguous source meta blocks draft");
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

// Real Excel readonly smoke (optional)
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
      companyId: "mare-smoke",
      period: "2026/03",
      yevmiyeSheetRows: sheetRows,
      accountPlanAccounts: fx.accountPlan,
      accountPlanStatus: "loaded",
    });
    const prep = prepareCorrectionFromFinding({
      finding: (r.findingsCatalog || []).find(
        (f) => f.fisNo === "00049" && f.severity === "UYARI"
      ),
      ledgerRows: r.rows,
      companyAccountingRules: fx.companyAccountingRules,
    });
    if (prep.recipe?.ok) {
      assert(prep.sourceVoucher?.metaComplete, "real smoke source meta complete");
      assert(
        prep.sourceVoucher?.tarih && prep.sourceVoucher?.belgeNo,
        "real smoke source date+document"
      );
      const draft = buildCorrectionDraft(prep.recipe, {
        correctDebitAccountCode: "740.30.038",
        correctDebitAccountName: "MALİ DANIŞMANLIK GİDERLERİ",
        companyAccountingRules: fx.companyAccountingRules,
        userCorrectionDate: "2026-04-01",
        accountPlanCodes: planCodes,
      });
      assert(draft.lines.length === 2, "real smoke 2 lines");
      assert(draft.lines[0].borc === 135000, "real smoke debit amount");
      assert(draft.persist === 0, "real smoke persist 0");
      assert(r.counters.persistInvocations === 0, "real GM persist 0 unchanged");
    } else {
      console.log("SKIP  real smoke recipe not detected on live file");
    }
  }
}

console.log(failed ? `\n${failed} failed` : "\nAll correction-voucher-v1 tests passed");
process.exit(failed ? 1 : 0);
