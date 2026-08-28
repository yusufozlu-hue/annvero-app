/**
 * Luca çok-hesaplı muavin parser regressions (a–j).
 * Run: npm run test:luca-muavin-parser
 */
import {
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_KAYNAK,
} from "@/src/config/eDefterKontrolDefaults.js";
import {
  analyzeEDefterRows,
  detectLucaMultiAccountMuavinLayout,
  parseLucaAccountHeaderCell,
  parseLucaMultiAccountMuavinSheet,
  parseMuavinSheet,
  parseYevmiyeSheet,
  resolveVoucherCounterparts,
} from "@/src/utils/eDefterKontrolEngine.js";
import {
  classifyLedgerDocumentType,
  GENEL_MUHASEBE_DOC_CLASS,
  runGenelMuhasebeKontrol,
} from "@/src/utils/genelMuhasebeKontrolEngine.js";
import { calendarPartsFromExcelDate, formatDateTR } from "@/src/utils/formatDateTR.js";
import {
  buildLucaMultiAccountMuavinFixture,
  buildLucaTurkishAccountMuavinFixture,
  lucaExcelDate,
} from "./fixtures/luca-multi-account-muavin.mjs";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else {
    console.log(`PASS  ${msg}`);
  }
}

const fixture = buildLucaMultiAccountMuavinFixture();

// a — two account blocks carry correct hesapKodu/hesapAdi
{
  const rows = parseMuavinSheet(fixture);
  const bank = rows.filter((r) => r.hesapKodu === "102.01.012");
  const cari = rows.filter((r) => r.hesapKodu === "320.01.001");
  assert(bank.length === 3, "a bank movement count");
  assert(cari.length === 2, "a cari movement count");
  assert(bank.every((r) => r.hesapAdi.includes("ANON BANKA")), "a bank hesapAdi");
  assert(cari.every((r) => r.hesapAdi.includes("ANON TİCARİ")), "a cari hesapAdi");
}

// b — only real movements parsed
{
  const rows = parseMuavinSheet(fixture);
  assert(rows.length === 5, "b movement count excludes totals/headers");
}

// c — subtotals and repeated headers skipped
{
  const rows = parseMuavinSheet(fixture);
  const bad = rows.filter(
    (r) =>
      /nakli|genel toplam|tar[iı]h/i.test(r.aciklama) ||
      /nakli|genel toplam/i.test(r.hesapAdi) ||
      !r.hesapKodu
  );
  assert(bad.length === 0, "c no subtotal/header rows");
  assert(detectLucaMultiAccountMuavinLayout(fixture), "c layout detected");
}

// d — fisNo leading zeros preserved
{
  const rows = parseMuavinSheet(fixture);
  const fis = rows.find((r) => r.fisNo === "00001");
  assert(fis?.fisNo === "00001", "d preserveFisNo leading zeros");
}

// e — Jan–Mar valid for UI period 2026/03 (cumulative muavin)
{
  const rows = parseMuavinSheet(fixture);
  const analyzed = analyzeEDefterRows(rows, { expectedPeriod: "2026/03" });
  const q1 = analyzed.filter((r) =>
    ["01.01.2026", "15.01.2026", "10.02.2026", "20.01.2026"].includes(r.tarih)
  );
  const outCount = q1.filter((r) =>
    (r.issueDetails || []).some((i) => i.code === E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD)
  ).length;
  assert(outCount === 0, "e Q1 rows not DATE_OUT_OF_PERIOD for 2026/03");
}

// f — Excel Date 21:00 UTC does not shift to previous day
{
  const raw = lucaExcelDate(2026, 1, 1);
  const parts = calendarPartsFromExcelDate(raw);
  assert(parts?.day === 1 && parts?.month === 1 && parts?.year === 2026, "f calendar parts Jan 1");
  assert(formatDateTR(raw) === "01.01.2026", "f formatDateTR Jan 1");
}

// g — muavin single-leg does not emit MISSING_COUNTERPART
{
  const rows = parseMuavinSheet(fixture);
  const analyzed = analyzeEDefterRows(rows, { expectedPeriod: "2026/03" });
  const missing = analyzed.filter((r) =>
    (r.issueDetails || []).some((i) => i.code === E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART)
  );
  assert(missing.length === 0, "g muavin no MISSING_COUNTERPART");
}

// h — yevmiye fail-closed preserved (single row → review)
{
  const yevmiyeSheet = [
    ["TARİH", "FİŞ NO", "YEVMİYE NO", "HESAP KODU", "AÇIKLAMA", "BORÇ", "ALACAK"],
    ["10.05.2026", "Y1", "1", "100.01", "anon", "100", "0"],
  ];
  assert(!detectLucaMultiAccountMuavinLayout(yevmiyeSheet), "h yevmiye not luca layout");
  const yRows = parseYevmiyeSheet(yevmiyeSheet);
  const map = resolveVoucherCounterparts(
    yRows.map((r) => ({ ...r, kaynak: E_DEFTER_KAYNAK.YEVMIYE }))
  );
  assert(map.get(yRows[0].id)?.code === E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART, "h yevmiye missing counterpart");
}

// i — parser idempotent (no duplicate ids / rows)
{
  const first = parseMuavinSheet(fixture);
  const second = parseMuavinSheet(fixture);
  assert(first.length === second.length, "i stable row count");
  const ids = first.map((r) => r.id);
  assert(ids.length === new Set(ids).size, "i unique ids");
  assert(JSON.stringify(first) === JSON.stringify(second), "i idempotent output");
}

// j — engine main-thread path parity (worker uses same motor)
{
  const spiesA = { parseInvocations: 0, analysisInvocations: 0, persistInvocations: 0 };
  const spiesB = { parseInvocations: 0, analysisInvocations: 0, persistInvocations: 0 };
  const a = runGenelMuhasebeKontrol({
    companyId: "luca-co",
    period: "2026/03",
    muavinSheetRows: fixture,
    accountPlanAccounts: [{ account_code: "102.01.012" }, { account_code: "320.01.001" }],
    accountPlanStatus: "loaded",
    spies: spiesA,
  });
  const b = runGenelMuhasebeKontrol({
    companyId: "luca-co",
    period: "2026/03",
    muavinSheetRows: fixture,
    accountPlanAccounts: [{ account_code: "102.01.012" }, { account_code: "320.01.001" }],
    accountPlanStatus: "loaded",
    spies: spiesB,
  });
  assert(a.summary.toplamSatir === b.summary.toplamSatir, "j parity row count");
  assert(
    a.rows.filter((r) => r.kaynak === E_DEFTER_KAYNAK.MUAVIN && r.hesapKodu && r.tarih).length === 5,
    "j five parsed movements in pipeline"
  );
  assert(spiesA.persistInvocations === 0 && spiesB.persistInvocations === 0, "j persist=0");
  assert(classifyLedgerDocumentType(fixture) === GENEL_MUHASEBE_DOC_CLASS.MUAVIN, "j class MUAVIN");
}

// April row flagged out-of-period for 2026/03
{
  const rows = parseLucaMultiAccountMuavinSheet(fixture);
  const april = rows.find((r) => r.tarih === "01.04.2026");
  assert(april, "april row present");
  const analyzed = analyzeEDefterRows([april], { expectedPeriod: "2026/03" });
  assert(
    (analyzed[0].issueDetails || []).some((i) => i.code === E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD),
    "april DATE_OUT_OF_PERIOD for 2026/03"
  );
}

// k — Turkish letters in account codes (İ/Ç) must open new blocks
{
  const tr = buildLucaTurkishAccountMuavinFixture();
  assert(
    parseLucaAccountHeaderCell("120.01.PDİ01 ANON CARI PDI")?.hesapKodu === "120.01.PDİ01",
    "k PDİ01 header preserves İ"
  );
  assert(
    parseLucaAccountHeaderCell("320.10.Ç0005 ANON CARI C5")?.hesapKodu === "320.10.Ç0005",
    "k Ç0005 header preserves Ç"
  );
  const rows = parseMuavinSheet(tr);
  assert(rows.length === 4, "k four turkish-account movements");
  const pdi = rows.find((r) => r.hesapKodu === "120.01.PDİ01");
  const b27 = rows.find((r) => r.hesapKodu === "120.01.B0027");
  const c5 = rows.find((r) => r.hesapKodu === "320.10.Ç0005");
  const b21 = rows.find((r) => r.hesapKodu === "320.10.B0021");
  assert(b27?.borc === 79685.24, "k B0027 keeps own amount");
  assert(pdi?.borc === 89415.37, "k PDİ01 not absorbed into B0027");
  assert(b21?.alacak === 5750, "k B0021 own amount");
  assert(c5?.borc === 11220.95, "k Ç0005 not absorbed into B0021");
}

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll luca muavin parser tests passed.");
