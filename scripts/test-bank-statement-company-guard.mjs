/**
 * Banka ekstresi firma kimliği koruması
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-statement-company-guard.mjs
 */
import assert from "node:assert/strict";
import {
  BANK_COMPANY_GUARD_CODE,
  COMPANY_VERIFY_CONFIRM_BUTTON_LABEL,
  applyManualCompanyConfirmationToGuard,
  assertManualCompanyConfirmation,
  buildCrossCompanyContaminationReport,
  canAcceptManualCompanyConfirmation,
  extractBankStatementCompanySignals,
  formatCompanyMismatchMessage,
  formatCompanyVerificationConfirmLabel,
  formatEmptyAccountPlanMessage,
  shouldBlockCariResolutionForCompanyGuard,
  titlesMatchForGuard,
  verifyBankStatementCompanyMatch,
} from "@/src/utils/bankStatementCompanyGuard.js";
import {
  FIXTURE_TEB_SEVEN_COLUMN_ANON,
  FIXTURE_TEB_FOURTEEN_COLUMN_ANON,
} from "./fixtures/bank-excel/sheetRows.mjs";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

const adh = {
  id: "adh-1",
  companyName: "ADH AVRASYA DİL HİZMETLERİ A.Ş",
  taxNumber: "1234567890",
  bankAccounts: [
    {
      iban: "TR330006100519786457841326",
      accountNumber: "519786457841",
      isActive: true,
    },
  ],
};

const mare = {
  id: "mare-1",
  companyName: "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş",
  taxNumber: "9876543210",
  bankAccounts: [
    {
      iban: "TR560001000100000001234567",
      accountNumber: "00001234567",
      isActive: true,
    },
  ],
};

function mareSheetRows() {
  return [
    ["VAKIFBANK"],
    ["Hesap Sahibi", "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş"],
    ["VKN", "9876543210"],
    ["IBAN", "TR56 0001 0001 0000 0001 2345 67"],
    ["Hesap No", "00001234567"],
    [],
    ["Hesap Hareketleri", "İşlem Tarihi", "Açıklama", "Tutar", "B/A"],
    ["", "01.01.2025", "GONDEREN HAVALE / TEST", "-100,00", "B"],
  ];
}

test("MARE dosyası + ADH aktif → COMPANY_MISMATCH kesin blok", () => {
  const result = verifyBankStatementCompanyMatch({
    sheetRows: mareSheetRows(),
    fileName: "VAKIFBANK ÖRNEK.xlsx",
    selectedCompany: adh,
    companies: [adh, mare],
  });
  assert.equal(result.code, BANK_COMPANY_GUARD_CODE.MISMATCH);
  assert.equal(result.ok, false);
  assert.equal(result.blockPipeline, true);
  assert.match(result.message, /MARE RESORT/i);
  assert.match(result.message, /ADH AVRASYA/i);
  assert.match(result.message, /İşlem durduruldu/);
  assert.equal(result.suggestedCompanyId, "mare-1");
  assert.equal(shouldBlockCariResolutionForCompanyGuard(result), true);
});

test("MARE dosyası + MARE aktif → devam (MATCH)", () => {
  const result = verifyBankStatementCompanyMatch({
    sheetRows: mareSheetRows(),
    fileName: "VAKIFBANK ÖRNEK.xlsx",
    selectedCompany: mare,
    companies: [adh, mare],
  });
  assert.equal(result.code, BANK_COMPANY_GUARD_CODE.MATCH);
  assert.equal(result.ok, true);
  assert.equal(result.blockPipeline, false);
});

test("unvan varyasyonu eşleşir", () => {
  assert.equal(
    titlesMatchForGuard(
      "MARE RESORT TURIZM VE OTELCILIK TICARET A.S",
      "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş"
    ),
    true
  );
});

test("VKN eşleşme / uyuşmazlık", () => {
  const match = verifyBankStatementCompanyMatch({
    sheetRows: [
      ["VKN", "9876543210"],
      ["Hesap Sahibi", "MARE RESORT TURİZM"],
    ],
    selectedCompany: mare,
    companies: [adh, mare],
  });
  assert.ok(match.reasons.includes("vkn_match"));

  const mismatch = verifyBankStatementCompanyMatch({
    sheetRows: [
      ["VKN", "9876543210"],
      ["Hesap Sahibi", "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş"],
    ],
    selectedCompany: adh,
    companies: [adh, mare],
  });
  assert.equal(mismatch.code, BANK_COMPANY_GUARD_CODE.MISMATCH);
  assert.ok(mismatch.reasons.includes("vkn_mismatch"));
});

test("IBAN eşleşme / uyuşmazlık", () => {
  const match = verifyBankStatementCompanyMatch({
    sheetRows: [
      ["IBAN", "TR560001000100000001234567"],
      ["Hesap Sahibi", "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş"],
    ],
    selectedCompany: mare,
    companies: [adh, mare],
  });
  assert.ok(match.reasons.includes("iban_match"));

  const mismatch = verifyBankStatementCompanyMatch({
    sheetRows: [
      ["IBAN", "TR560001000100000001234567"],
      ["Hesap Sahibi", "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş"],
    ],
    selectedCompany: adh,
    companies: [adh, mare],
  });
  assert.equal(mismatch.code, BANK_COMPANY_GUARD_CODE.MISMATCH);
  assert.ok(
    mismatch.reasons.includes("iban_mismatch") ||
      mismatch.reasons.includes("title_mismatch") ||
      mismatch.suggestedCompanyId === "mare-1"
  );
});

test("kimlik sinyali olmayan dosya → VERIFICATION_REQUIRED", () => {
  const result = verifyBankStatementCompanyMatch({
    sheetRows: [
      ["Hareket", "Tutar"],
      ["01.01.2025", "100"],
    ],
    fileName: "ekstre.xlsx",
    selectedCompany: adh,
    companies: [adh, mare],
  });
  assert.equal(result.code, BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED);
  assert.equal(result.blockPipeline, true);
});

test("yanlış firmada Drive/persist/hafıza yazımı sıfır (sözleşme)", () => {
  const result = verifyBankStatementCompanyMatch({
    sheetRows: mareSheetRows(),
    selectedCompany: adh,
    companies: [adh, mare],
  });
  assert.equal(result.blockPipeline, true);
  // Workbench: block → throw before archive/persist; guard API bunu zorunlu kılar
  assert.equal(result.ok, false);
});

test("kontaminasyon raporu salt okunur; silme yok", () => {
  const report = buildCrossCompanyContaminationReport({
    activeCompanyId: "adh-1",
    activeCompanyName: "ADH",
    statementFingerprint: "mare|vkn",
  });
  assert.equal(report.readOnly, true);
  assert.equal(report.action, "none");
  assert.equal(report.deletionRequiresUserApproval, true);
});

test("hesap planı boş mesajı; mismatch öncelikli", () => {
  assert.equal(
    formatEmptyAccountPlanMessage(),
    "Bu firmanın hesap planı tanımlı değil."
  );
  const mismatchMsg = formatCompanyMismatchMessage({
    statementOwnerName: "MARE RESORT X",
    activeCompanyName: "ADH Y",
  });
  assert.match(mismatchMsg, /MARE RESORT X/);
  assert.match(mismatchMsg, /ADH Y/);
  // Öncelik: mismatch code ayrı; empty plan ayrı kod
  assert.notEqual(
    BANK_COMPANY_GUARD_CODE.MISMATCH,
    BANK_COMPANY_GUARD_CODE.EMPTY_ACCOUNT_PLAN
  );
});

test("sinyal çıkarımı IBAN/VKN/unvan", () => {
  const signals = extractBankStatementCompanySignals({
    sheetRows: mareSheetRows(),
  });
  assert.ok(signals.ibans.some((i) => i.startsWith("TR56")));
  assert.ok(signals.taxNumbers.includes("9876543210"));
  assert.ok(signals.ownerCores.length >= 1);
  assert.equal(signals.hasAnySignal, true);
  assert.ok(!String(JSON.stringify(signals)).includes("GONDEREN HAVALE"));
});

test("firma değişiminde state temizlik sözleşmesi", () => {
  let file = { name: "x.xlsx" };
  let result = { missing: 1 };
  let centerOpen = true;
  let guard = { code: "COMPANY_MATCH" };
  let checkpoint = { fileName: "x.xlsx", contentHash: "h" };
  const onCompanyChange = () => {
    file = null;
    result = null;
    centerOpen = false;
    guard = null;
    checkpoint = null;
  };
  onCompanyChange();
  assert.equal(file, null);
  assert.equal(result, null);
  assert.equal(centerOpen, false);
  assert.equal(guard, null);
  assert.equal(checkpoint, null);
});

test("tenant izolasyonu — başka firma profili score düşürür", () => {
  const result = verifyBankStatementCompanyMatch({
    sheetRows: mareSheetRows(),
    selectedCompany: adh,
    companies: [adh, mare],
  });
  assert.notEqual(result.suggestedCompanyId, "adh-1");
  assert.equal(result.suggestedCompanyId, "mare-1");
});

test("manuel onay yalnız VERIFICATION_REQUIRED; MISMATCH bypass yok", () => {
  const ambiguous = verifyBankStatementCompanyMatch({
    sheetRows: [
      ["Hareket", "Tutar"],
      ["01.01.2025", "100"],
    ],
    fileName: "ekstre.pdf",
    selectedCompany: mare,
    companies: [adh, mare],
  });
  assert.equal(ambiguous.code, BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED);
  assert.equal(canAcceptManualCompanyConfirmation(ambiguous.code), true);

  const mismatch = verifyBankStatementCompanyMatch({
    sheetRows: mareSheetRows(),
    selectedCompany: adh,
    companies: [adh, mare],
  });
  assert.equal(mismatch.code, BANK_COMPANY_GUARD_CODE.MISMATCH);
  assert.equal(canAcceptManualCompanyConfirmation(mismatch.code), false);

  const mismatchBypass = assertManualCompanyConfirmation({
    guardCode: BANK_COMPANY_GUARD_CODE.MISMATCH,
    checkboxChecked: true,
    confirmedCompanyId: "adh-1",
    activeCompanyId: "adh-1",
  });
  assert.equal(mismatchBypass.ok, false);
  assert.equal(mismatchBypass.code, "MANUAL_CONFIRM_FORBIDDEN");

  const stillMismatch = applyManualCompanyConfirmationToGuard(mismatch, {
    confirmedCompanyId: "adh-1",
    activeCompanyId: "adh-1",
  });
  assert.equal(stillMismatch.blockPipeline, true);
  assert.equal(stillMismatch.code, BANK_COMPANY_GUARD_CODE.MISMATCH);
});

test("checkbox + aynı companyId olmadan pipeline devam etmez", () => {
  const noCheck = assertManualCompanyConfirmation({
    guardCode: BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED,
    checkboxChecked: false,
    confirmedCompanyId: "mare-1",
    activeCompanyId: "mare-1",
  });
  assert.equal(noCheck.ok, false);
  assert.equal(noCheck.code, "CONFIRM_CHECKBOX_REQUIRED");

  const wrongCompany = assertManualCompanyConfirmation({
    guardCode: BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED,
    checkboxChecked: true,
    confirmedCompanyId: "adh-1",
    activeCompanyId: "mare-1",
  });
  assert.equal(wrongCompany.ok, false);
  assert.equal(wrongCompany.code, "CONFIRM_COMPANY_MISMATCH");

  const ok = assertManualCompanyConfirmation({
    guardCode: BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED,
    checkboxChecked: true,
    confirmedCompanyId: "mare-1",
    activeCompanyId: "mare-1",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.companyId, "mare-1");
});

test("onay sonrası VERIFICATION_REQUIRED blok kalkar; cari çözüm açılır", () => {
  const raw = verifyBankStatementCompanyMatch({
    sheetRows: [["Tarih", "Tutar"], ["01.01.2025", "50"]],
    fileName: "belirsiz.pdf",
    selectedCompany: mare,
    companies: [adh, mare],
  });
  assert.equal(raw.blockPipeline, true);
  const confirmed = applyManualCompanyConfirmationToGuard(raw, {
    confirmedCompanyId: "mare-1",
    activeCompanyId: "mare-1",
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.blockPipeline, false);
  assert.equal(confirmed.manuallyConfirmed, true);
  assert.equal(shouldBlockCariResolutionForCompanyGuard(confirmed), false);
});

test("onay kutusu etiketi seçili firma unvanını kullanır", () => {
  const label = formatCompanyVerificationConfirmLabel(
    "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş"
  );
  assert.equal(
    label,
    "Bu ekstre MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş firmasına aittir"
  );
  assert.equal(
    COMPANY_VERIFY_CONFIRM_BUTTON_LABEL,
    "Firmayı Onayla ve Devam Et"
  );
});

function assertNoFakeHeaderOwner(signals, label) {
  for (const title of signals.ownerTitles || []) {
    const core = String(title || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i");
    assert.equal(
      /ozel islem/.test(core) && /tutar/.test(core) && /bakiye/.test(core),
      false,
      `${label}: fake header owner: ${title.slice(0, 40)}`
    );
    assert.equal(
      /^ozel islem/.test(core),
      false,
      `${label}: owner starts with ozel islem`
    );
  }
}

test("TEB 7-col header → sahte owner üretmez", () => {
  const signals = extractBankStatementCompanySignals({
    sheetRows: FIXTURE_TEB_SEVEN_COLUMN_ANON.rows,
    fileName: FIXTURE_TEB_SEVEN_COLUMN_ANON.fileName,
  });
  assertNoFakeHeaderOwner(signals, "teb7");
  assert.equal(signals.ownerTitles.length, 0);
  assert.equal(signals.ownerCores.length, 0);
});

test("TEB 14-col header → sahte owner üretmez", () => {
  const signals = extractBankStatementCompanySignals({
    sheetRows: FIXTURE_TEB_FOURTEEN_COLUMN_ANON.rows,
    fileName: FIXTURE_TEB_FOURTEEN_COLUMN_ANON.fileName,
  });
  assertNoFakeHeaderOwner(signals, "teb14");
  assert.ok(
    !(signals.ownerTitles || []).some((t) =>
      /alici hesap|eft sorgu|musteri referans/i.test(t)
    )
  );
});

test("kimliksiz TEB 7-col → VERIFICATION_REQUIRED / no_identity_signal", () => {
  const result = verifyBankStatementCompanyMatch({
    sheetRows: FIXTURE_TEB_SEVEN_COLUMN_ANON.rows,
    fileName: "TEB GERCEK ESKTRE.xlsx",
    selectedCompany: mare,
    companies: [adh, mare],
  });
  assert.equal(result.code, BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED);
  assert.equal(result.ok, false);
  assert.equal(result.blockPipeline, true);
  assert.ok(result.reasons.includes("no_identity_signal"));
  assert.equal(result.statementOwnerLabel, "");
  assert.equal(canAcceptManualCompanyConfirmation(result.code), true);
});

test("gerçek Hesap Sahibi satırı → owner doğru çıkar", () => {
  const signals = extractBankStatementCompanySignals({
    sheetRows: [
      ["Hesap Sahibi", "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş"],
      ["Tarih", "Açıklama", "Unvan", "Özel İşlem Açıklaması", "Tutar", "Bakiye", "Dekont"],
    ],
    fileName: "ekstre.xlsx",
  });
  assert.ok(signals.ownerTitles.some((t) => /MARE RESORT/i.test(t)));
  assertNoFakeHeaderOwner(signals, "hesap-sahibi");
});

test("gerçek Hesap Ünvanı satırı → owner doğru çıkar", () => {
  const signals = extractBankStatementCompanySignals({
    sheetRows: [
      ["Hesap Ünvanı", "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş"],
      ["Tarih", "Unvan", "Tutar", "Bakiye", "Dekont"],
    ],
    fileName: "ekstre.xlsx",
  });
  assert.ok(signals.ownerTitles.some((t) => /MARE RESORT/i.test(t)));
  assertNoFakeHeaderOwner(signals, "hesap-unvani");
});

test("gerçek VKN/IBAN mismatch → hâlâ BLOCK", () => {
  const result = verifyBankStatementCompanyMatch({
    sheetRows: [
      ["Hesap Sahibi", "MARE RESORT TURİZM"],
      ["VKN", "9876543210"],
      ["IBAN", "TR56 0001 0001 0000 0001 2345 67"],
    ],
    selectedCompany: adh,
    companies: [adh, mare],
  });
  assert.equal(result.code, BANK_COMPANY_GUARD_CODE.MISMATCH);
  assert.equal(result.blockPipeline, true);
});

test("gerçek title mismatch → hâlâ BLOCK", () => {
  const result = verifyBankStatementCompanyMatch({
    sheetRows: [
      ["Hesap Sahibi", "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş"],
    ],
    fileName: "ekstre.xlsx",
    selectedCompany: adh,
    companies: [adh, mare],
  });
  assert.equal(result.code, BANK_COMPANY_GUARD_CODE.MISMATCH);
  assert.equal(result.blockPipeline, true);
  assert.ok(result.reasons.includes("title_mismatch"));
  assert.match(result.message, /MARE RESORT/i);
  assert.match(result.message, /ADH AVRASYA/i);
});

test("firma unvanında tutar kelimesi false-negative yaratmaz", () => {
  const signals = extractBankStatementCompanySignals({
    sheetRows: [["Hesap Sahibi", "TUTAR LOJISTIK VE TICARET A.S."]],
    fileName: "ekstre.xlsx",
  });
  assert.ok(signals.ownerTitles.some((t) => /TUTAR LOJISTIK/i.test(t)));
});

console.log("All bank-statement-company-guard tests passed.");
