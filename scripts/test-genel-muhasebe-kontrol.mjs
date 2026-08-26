/**
 * Genel Muhasebe Kontrol A–T anonymous matrix + idempotency spies.
 * Run: npm run test:genel-muhasebe-kontrol
 */
import {
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_KAYNAK,
} from "@/src/config/eDefterKontrolDefaults.js";
import { resolveVoucherCounterparts } from "@/src/utils/eDefterKontrolEngine.js";
import {
  classifyLedgerDocumentType,
  createGenelMuhasebeAnalyzeGate,
  reconcileMizanMuavin,
  refineDocumentClass,
  runGenelMuhasebeKontrol,
  GENEL_MUHASEBE_DOC_CLASS,
} from "@/src/utils/genelMuhasebeKontrolEngine.js";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else console.log(`PASS  ${msg}`);
}

function yrow(p) {
  return {
    id: p.id,
    kaynak: p.kaynak || E_DEFTER_KAYNAK.YEVMIYE,
    documentClass: p.documentClass || "YEVMIYE",
    period: p.period || "2026-05",
    tarih: p.tarih || "10.05.2026",
    fisNo: p.fisNo ?? "10",
    yevmiyeNo: p.yevmiyeNo || "1",
    hesapKodu: p.hesapKodu,
    hesapAdi: p.hesapAdi || "",
    aciklama: p.aciklama || "anon",
    belgeTuru: "FT",
    belgeNo: p.belgeNo || "B1",
    borc: p.borc ?? 0,
    alacak: p.alacak ?? 0,
    cariUnvan: "",
    counterAccountCode: p.counterAccountCode || "",
    karsiHesapKodu: p.counterAccountCode || "",
    tutar: Math.max(p.borc || 0, p.alacak || 0),
  };
}

function sheet(headers, bodyRows) {
  return [headers, ...bodyRows];
}

const YEVMIYE_HEADERS = [
  "TARİH",
  "FİŞ NO",
  "YEVMİYE NO",
  "HESAP KODU",
  "HESAP ADI",
  "AÇIKLAMA",
  "BELGE TÜRÜ",
  "BELGE NO",
  "BORÇ",
  "ALACAK",
  "KARŞI HESAP",
];

const MUAVIN_HEADERS = [
  "MUAVİN",
  "TARİH",
  "FİŞ NO",
  "HESAP KODU",
  "HESAP ADI",
  "AÇIKLAMA",
  "BORÇ",
  "ALACAK",
];

// A
{
  const map = resolveVoucherCounterparts([
    yrow({ id: "a1", fisNo: "A1", hesapKodu: "100.01", borc: 100, alacak: 0 }),
    yrow({ id: "a2", fisNo: "A1", hesapKodu: "320.01", borc: 0, alacak: 100 }),
  ]);
  assert(map.get("a1").counterAccountCode === "320.01", "A debit counterpart");
  assert(map.get("a2").counterAccountCode === "100.01", "A credit counterpart");
}

// B
{
  const map = resolveVoucherCounterparts([
    yrow({ id: "b1", fisNo: "B1", hesapKodu: "100.01", borc: 100, alacak: 0 }),
    yrow({ id: "b2", fisNo: "B1", hesapKodu: "320.01", borc: 0, alacak: 60 }),
    yrow({ id: "b3", fisNo: "B1", hesapKodu: "391.01", borc: 0, alacak: 40 }),
  ]);
  assert(map.get("b1").code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART, "B multi");
  assert(!map.get("b1").counterAccountCode, "B no invent");
}

// C
{
  const map = resolveVoucherCounterparts([
    yrow({ id: "c1", fisNo: "C1", hesapKodu: "100.01", borc: 10, alacak: 0 }),
    yrow({ id: "c2", fisNo: "C1", hesapKodu: "102.01", borc: 20, alacak: 0 }),
  ]);
  assert(map.get("c1").code === E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE, "C same side");
}

// D
{
  const map = resolveVoucherCounterparts([
    yrow({
      id: "d1",
      fisNo: "D1",
      hesapKodu: "100.01",
      borc: 10,
      alacak: 0,
      counterAccountCode: "100.01",
    }),
    yrow({ id: "d2", fisNo: "D1", hesapKodu: "320.01", borc: 0, alacak: 10 }),
  ]);
  assert(map.get("d1").code === E_DEFTER_ISSUE_CODE.COUNTERPART_SELF, "D self conflict");
}

// E
{
  const map = resolveVoucherCounterparts([
    yrow({ id: "e1", fisNo: "", hesapKodu: "100.01", borc: 10, alacak: 0 }),
    yrow({ id: "e2", fisNo: "", hesapKodu: "320.01", borc: 0, alacak: 10 }),
  ]);
  assert(map.get("e1").code === E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW, "E no fis merge");
  assert(!map.get("e1").counterAccountCode, "E no bind");
}

// F
{
  const map = resolveVoucherCounterparts([
    yrow({ id: "f1", fisNo: "F1", hesapKodu: "100.01", borc: 10, alacak: 0 }),
    yrow({ id: "f2", fisNo: "F2", hesapKodu: "320.01", borc: 0, alacak: 10 }),
  ]);
  assert(map.get("f1").code === E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART, "F different fis");
}

// G different period
{
  const map = resolveVoucherCounterparts([
    yrow({ id: "g1", fisNo: "G1", period: "2026-04", hesapKodu: "100.01", borc: 10, alacak: 0 }),
    yrow({
      id: "g2",
      fisNo: "G1",
      period: "2026-05",
      hesapKodu: "320.01",
      borc: 0,
      alacak: 10,
    }),
  ]);
  assert(map.get("g1").code === E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART, "G period isolated");
}

// H MUAVIN single-leg → no MISSING_COUNTERPART issue in pipeline findings
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    muavinSheetRows: sheet(MUAVIN_HEADERS, [
      ["MUAVİN", "10.05.2026", "H1", "100.01", "Kasa", "anon", "10", "0"],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  });
  assert((r.documentClasses?.MUAVIN || 0) >= 1, "H classified MUAVIN");
  const missing = (r.rows || []).flatMap((row) => row.issueDetails || []).filter(
    (i) => i.code === E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART
  );
  assert(missing.length === 0, "H muavin single-leg no missing warning");
}

// I YEVMIYE single-leg → review/uyarı
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "I1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }],
    accountPlanStatus: "loaded",
  });
  assert((r.documentClasses?.YEVMIYE || 0) >= 1, "I classified YEVMIYE");
  const miss = (r.rows || []).flatMap((row) => row.issueDetails || []).some(
    (i) => i.code === E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART
  );
  assert(miss, "I yevmiye single-leg emits missing");
}

// J verified explicit
{
  const map = resolveVoucherCounterparts([
    yrow({
      id: "j1",
      fisNo: "J1",
      hesapKodu: "100.01",
      borc: 10,
      alacak: 0,
      counterAccountCode: "320.01",
    }),
    yrow({ id: "j2", fisNo: "J1", hesapKodu: "320.01", borc: 0, alacak: 10 }),
  ]);
  assert(map.get("j1").code === E_DEFTER_ISSUE_CODE.COUNTERPART_VERIFIED, "J verified");
}

// K conflict explicit
{
  const map = resolveVoucherCounterparts([
    yrow({
      id: "k1",
      fisNo: "K1",
      hesapKodu: "100.01",
      borc: 10,
      alacak: 0,
      counterAccountCode: "102.01",
    }),
    yrow({ id: "k2", fisNo: "K1", hesapKodu: "320.01", borc: 0, alacak: 10 }),
  ]);
  assert(map.get("k1").code === E_DEFTER_ISSUE_CODE.COUNTERPART_CONFLICT, "K conflict");
}

// L account not in plan
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "L1", "1", "999.99", "X", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "L1", "2", "100.01", "Kasa", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }],
    accountPlanStatus: "loaded",
  });
  assert(r.summary.hesapPlandaYok > 0, "L not in plan");
  assert(r.summary.edefterUygun === false, "L not clean");
}

// M plan missing
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "M1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "M1", "2", "320.01", "Satici", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: [],
    accountPlanStatus: "missing",
  });
  assert(r.summary.planEvidence === "MISSING", "M plan missing");
  assert(r.summary.hesapPlandaYok === 0, "M no false plan fail");
  assert(
    (r.findingExtras || []).some((f) => f.code === E_DEFTER_ISSUE_CODE.PLAN_EVIDENCE_MISSING),
    "M evidence finding"
  );
}

// N mizan muavin
{
  const eq = reconcileMizanMuavin({
    muavinRows: [
      { hesapKodu: "100.01", borc: 10, alacak: 0 },
      { hesapKodu: "100.01", borc: 0, alacak: 3 },
    ],
    mizanRows: [{ hesapKodu: "100.01", borc: 10, alacak: 3, bakiye: 7 }],
  });
  assert(eq.matched === true, "N equal");
  const diff = reconcileMizanMuavin({
    muavinRows: [{ hesapKodu: "100.01", borc: 10, alacak: 0 }],
    mizanRows: [{ hesapKodu: "100.01", borc: 9, alacak: 0, bakiye: 9 }],
  });
  assert(diff.matched === false && diff.differences.length === 1, "N different");
  const miss = reconcileMizanMuavin({
    muavinRows: [{ hesapKodu: "100.01", borc: 1, alacak: 0 }],
    mizanRows: [],
  });
  assert(miss.status === "EVIDENCE_MISSING", "N missing side");
  const onlyYev = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "N1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "N1", "2", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    mizanSheetRows: [
      ["Hesap Kodu", "Hesap Adı", "Borç Bakiyesi", "Alacak Bakiyesi"],
      ["100.01", "Kasa", "10", "0"],
    ],
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  });
  assert(onlyYev.summary.mizanMuavin.status === "EVIDENCE_MISSING", "N yevmiye≠muavin for reconcile");
}

// O no duplicate rows from run
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "O1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "O1", "2", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  });
  const ids = (r.rows || []).map((row) => row.id).filter(Boolean);
  assert(new Set(ids).size === ids.length, "O no duplicate row ids");
}

// P company change clears via new run object
{
  const a = runGenelMuhasebeKontrol({
    companyId: "co-a",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "P1", "1", "100.01", "Kasa", "anon", "FT", "B1", "5", "0", ""],
      ["10.05.2026", "P1", "2", "320.01", "S", "anon", "FT", "B1", "0", "5", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  });
  const b = runGenelMuhasebeKontrol({
    companyId: "co-b",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "P1", "1", "100.01", "Kasa", "anon", "FT", "B1", "9", "0", ""],
      ["10.05.2026", "P1", "2", "320.01", "S", "anon", "FT", "B1", "0", "9", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  });
  assert(a.companyId === "co-a" && b.companyId === "co-b", "P company scoped");
  assert(a.summary.borcToplam !== b.summary.borcToplam, "P results not shared");
}

// Q double-click gate + single analyze
{
  const gate = createGenelMuhasebeAnalyzeGate();
  const spies = { parseInvocations: 0, analysisInvocations: 0, persistInvocations: 0 };
  const first = gate.begin();
  assert(first.accepted === true, "Q first accepted");
  const second = gate.begin();
  assert(second.accepted === false, "Q double click blocked");
  gate.end();
  runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "Q1", "1", "100.01", "Kasa", "anon", "FT", "B1", "1", "0", ""],
      ["10.05.2026", "Q1", "2", "320.01", "S", "anon", "FT", "B1", "0", "1", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
    spies,
  });
  assert(spies.parseInvocations === 1, "Q parse once");
  assert(spies.analysisInvocations === 1, "Q analyze once");
  assert(spies.persistInvocations === 0, "Q persist zero");
}

// R 0,00 balance preserved
{
  const rec = reconcileMizanMuavin({
    muavinRows: [{ hesapKodu: "100.01", borc: 0, alacak: 0 }],
    mizanRows: [{ hesapKodu: "100.01", borc: 0, alacak: 0, bakiye: 0 }],
  });
  assert(rec.matched === true, "R zero preserved matched");
}

// S vadeli: no cross-fis invent
{
  const map = resolveVoucherCounterparts([
    yrow({
      id: "s1",
      fisNo: "S1",
      hesapKodu: "102.01",
      hesapAdi: "Vadeli",
      aciklama: "virman",
      borc: 10,
      alacak: 0,
    }),
    yrow({
      id: "s2",
      fisNo: "S2",
      hesapKodu: "102.02",
      hesapAdi: "Vadeli",
      aciklama: "virman",
      borc: 0,
      alacak: 10,
    }),
  ]);
  assert(!map.get("s1").counterAccountCode, "S no cross-fis invent");
}

// T description similarity does not create counterpart
{
  const map = resolveVoucherCounterparts([
    yrow({ id: "t1", fisNo: "", hesapKodu: "100.01", borc: 8, alacak: 0, aciklama: "aynı metin" }),
    yrow({ id: "t2", fisNo: "", hesapKodu: "320.01", borc: 0, alacak: 8, aciklama: "aynı metin" }),
  ]);
  assert(!map.get("t1").counterAccountCode, "T no desc counterpart");
}

// Document class content + refine fail-closed
{
  const mizan = classifyLedgerDocumentType([
    ["Hesap Kodu", "Hesap Adı", "Borç Bakiyesi", "Alacak Bakiyesi"],
    ["100.01", "Kasa", "10", "0"],
  ]);
  assert(mizan === GENEL_MUHASEBE_DOC_CLASS.MIZAN, "doc mizan");
  const yev = classifyLedgerDocumentType([
    ["Tarih", "Fiş No", "Yevmiye No", "Hesap Kodu", "Açıklama", "Borç", "Alacak"],
    ["10.05.2026", "1", "1", "100.01", "x", "10", "0"],
  ]);
  assert(yev === GENEL_MUHASEBE_DOC_CLASS.YEVMIYE, "doc yevmiye");
  assert(
    refineDocumentClass(GENEL_MUHASEBE_DOC_CLASS.UNKNOWN, GENEL_MUHASEBE_DOC_CLASS.MUAVIN, [
      ["a", "b"],
      ["100.01", "10"],
    ]) === GENEL_MUHASEBE_DOC_CLASS.MUAVIN,
    "refine muavin single account"
  );
  assert(
    refineDocumentClass(GENEL_MUHASEBE_DOC_CLASS.YEVMIYE, GENEL_MUHASEBE_DOC_CLASS.MUAVIN, []) ===
      GENEL_MUHASEBE_DOC_CLASS.YEVMIYE,
    "refine never demotes yevmiye"
  );
}

if (failed) {
  console.error(`${failed} FAIL(s)`);
  process.exit(1);
}
console.log("ALL PASSED");
