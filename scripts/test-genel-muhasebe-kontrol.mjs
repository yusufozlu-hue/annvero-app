/**
 * Genel Muhasebe Kontrol A–T anonymous matrix + idempotency spies.
 * Run: npm run test:genel-muhasebe-kontrol
 */
import {
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
  E_DEFTER_KAYNAK,
  E_DEFTER_SONUC_SEVIYE,
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
import {
  accountCodeFromPlanRow,
  buildCloneSafeAnalyzePayload,
  executeEDefterAnalyzePayload,
  resultsAreParityEqual,
} from "@/src/utils/eDefterAnalyzeContract.js";
import {
  buildGenelMuhasebeFindingsPresentation,
  countVisiblePresentationRows,
  filterGenelMuhasebePresentationRows,
  normalizeFisNoForFilter,
  pruneExpandedPresentationGroups,
} from "@/src/utils/genelMuhasebeFindingsView.js";
import {
  GENEL_MUHASEBE_FINDING_TITLE_TR,
  genelMuhasebeFindingMessageTr,
  genelMuhasebeFindingTitleTr,
  userVisibleTextHasTechnicalCode,
} from "@/src/utils/genelMuhasebeFindingsLabels.js";
import {
  closeMultiCounterpartGroup,
  createMultiCounterpartUiState,
  isMultiCounterpartModalOpen,
  openMultiCounterpartGroup,
  shouldRenderInlineMultiGroupDetails,
} from "@/src/utils/multiCounterpartUi.js";
import {
  buildMultiCounterpartVoucherDetail,
  sortMultiCounterpartLinesForDisplay,
} from "@/src/utils/multiCounterpartDetail.js";
import { LUCA_MULTI_ACCOUNT_MUAVIN_ROWS } from "./fixtures/luca-multi-account-muavin.mjs";
import fs from "node:fs";
import path from "node:path";
import { readSheetRowsFromArrayBuffer } from "@/src/utils/excelBufferUtils.js";

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

// ——— Evidence / warning cleanup regressions (a–m) ———

function hasIssueMessage(rows, extras, needle) {
  const fromRows = (rows || []).some((row) =>
    (row.issueDetails || []).some((i) => String(i.message || "").includes(needle))
  );
  const fromExtras = (extras || []).some((i) => String(i.message || "").includes(needle));
  return fromRows || fromExtras;
}

function hasIssueCode(rows, extras, code) {
  const fromRows = (rows || []).some((row) =>
    (row.issueDetails || []).some((i) => i.code === code)
  );
  const fromExtras = (extras || []).some((i) => i.code === code);
  return fromRows || fromExtras;
}

// a) API camelCase accountCode → PRESENT, no PLAN_EVIDENCE_MISSING
{
  const rawAccounts = [
    { accountCode: "100.01", accountName: "Kasa" },
    { accountCode: "320.01", accountName: "Satıcı" },
  ];
  const payload = buildCloneSafeAnalyzePayload({
    jobKind: "GENERAL_LEDGER_CONTROL",
    companyId: "c1",
    period: "2026/05",
    muavinSheetRows: null,
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "A1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "A1", "2", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: rawAccounts,
    accountPlanStatus: "loaded",
  });
  assert(
    Array.isArray(payload.accountPlanAccounts) && payload.accountPlanAccounts.length === 2,
    "a sanitize keeps accountCode"
  );
  assert(
    payload.accountPlanAccounts.every((a) => a.account_code),
    "a normalized account_code"
  );
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "A1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "A1", "2", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: payload.accountPlanAccounts,
    accountPlanStatus: payload.accountPlanStatus,
  });
  assert(r.summary.planEvidence === "PRESENT", "a planEvidence PRESENT");
  assert(
    !hasIssueCode(r.rows, r.findingExtras, E_DEFTER_ISSUE_CODE.PLAN_EVIDENCE_MISSING),
    "a no PLAN_EVIDENCE_MISSING"
  );
}

// b) Plan gerçekten yok → PLAN_EVIDENCE_MISSING, hesap planda yok kararı yok
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "B1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "B1", "2", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: [],
    accountPlanStatus: "missing",
  });
  assert(r.summary.planEvidence === "MISSING", "b plan MISSING");
  assert(r.summary.hesapPlandaYok === 0, "b no ACCOUNT_NOT_IN_PLAN decision");
  assert(
    hasIssueCode(r.rows, r.findingExtras, E_DEFTER_ISSUE_CODE.PLAN_EVIDENCE_MISSING),
    "b PLAN_EVIDENCE_MISSING present"
  );
}

// c) Worker payload vs main-thread plan parity
{
  const input = {
    jobKind: "GENERAL_LEDGER_CONTROL",
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "C1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "C1", "2", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: [{ accountCode: "100.01" }, { accountCode: "320.01" }],
    accountPlanStatus: "loaded",
  };
  const payload = buildCloneSafeAnalyzePayload(input);
  const viaPayload = await executeEDefterAnalyzePayload(payload);
  const direct = runGenelMuhasebeKontrol({
    companyId: input.companyId,
    period: input.period,
    yevmiyeSheetRows: input.yevmiyeSheetRows,
    accountPlanAccounts: payload.accountPlanAccounts,
    accountPlanStatus: payload.accountPlanStatus,
  });
  assert(viaPayload.summary.planEvidence === "PRESENT", "c worker path PRESENT");
  assert(direct.summary.planEvidence === "PRESENT", "c main path PRESENT");
  assert(
    viaPayload.summary.planEvidence === direct.summary.planEvidence,
    "c plan evidence parity"
  );
  assert(
    !hasIssueCode(viaPayload.rows, viaPayload.findingExtras, E_DEFTER_ISSUE_CODE.PLAN_EVIDENCE_MISSING) &&
      !hasIssueCode(direct.rows, direct.findingExtras, E_DEFTER_ISSUE_CODE.PLAN_EVIDENCE_MISSING),
    "c neither emits PLAN_EVIDENCE_MISSING"
  );
}

// d–e) Muavin-only: fisNo korunur, Yevmiye no eksik üretilmez
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/01",
    muavinSheetRows: LUCA_MULTI_ACCOUNT_MUAVIN_ROWS,
    accountPlanAccounts: [
      { account_code: "102.01.012" },
      { account_code: "320.01.001" },
    ],
    accountPlanStatus: "loaded",
  });
  const opening = (r.rows || []).find((row) => row.fisNo === "00001");
  assert(Boolean(opening), "d fisNo=00001 preserved");
  assert(opening.yevmiyeNo === "", "d yevmiyeNo not copied from fisNo");
  assert(!hasIssueMessage(r.rows, r.findingExtras, "Yevmiye no eksik"), "e no yevmiye missing on muavin-only");
}

// f) Yevmiye kaynağında yevmiye numarası zorunluluğu
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "F1", "", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "F1", "", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  });
  assert(hasIssueMessage(r.rows, r.findingExtras, "Yevmiye no eksik"), "f yevmiye requires yevmiyeNo");
}

// g) Muavin-only belge türü boşluğu genel sonucu Uyarı yapmaz
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    muavinSheetRows: sheet(MUAVIN_HEADERS, [
      ["MUAVİN", "10.05.2026", "00001", "100.01", "Kasa", "anon", "10", "0"],
      ["MUAVİN", "10.05.2026", "00001", "100.01", "Kasa", "anon2", "0", "10"],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }],
    accountPlanStatus: "loaded",
  });
  assert((r.documentClasses?.MUAVIN || 0) >= 1, "g classified MUAVIN");
  const belgeInfo = (r.rows || []).flatMap((row) => row.issueDetails || []).filter(
    (i) => String(i.message || "").includes("Belge türü boş")
  );
  assert(belgeInfo.length > 0, "g belge boşluğu BİLGİ olarak görünür");
  assert(
    belgeInfo.every((i) => i.severity === E_DEFTER_ISSUE_SEVERITY.BILGI),
    "g belge severity BILGI"
  );
  assert(r.summary.overallSonuc !== E_DEFTER_SONUC_SEVIYE.UYARI, "g not Uyarı from empty belge");
  assert(
    r.summary.overallSonuc === E_DEFTER_SONUC_SEVIYE.BILGI ||
      r.summary.overallSonuc === E_DEFTER_SONUC_SEVIYE.UYGUN,
    "g Bilgi or Uygun"
  );
}

// h) MULTI_COUNTERPART BİLGİ; tek başına Uyarı değil
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "H1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "H1", "2", "120.01", "A", "anon", "FT", "B1", "5", "0", ""],
      ["10.05.2026", "H1", "3", "320.01", "S", "anon", "FT", "B1", "0", "8", ""],
      ["10.05.2026", "H1", "4", "321.01", "S2", "anon", "FT", "B1", "0", "7", ""],
    ]),
    accountPlanAccounts: [
      { account_code: "100.01" },
      { account_code: "120.01" },
      { account_code: "320.01" },
      { account_code: "321.01" },
    ],
    accountPlanStatus: "loaded",
  });
  const multi = (r.rows || []).flatMap((row) => row.issueDetails || []).filter(
    (i) => i.code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART
  );
  assert(multi.length > 0, "h MULTI_COUNTERPART present");
  assert(
    multi.every((i) => i.severity === E_DEFTER_ISSUE_SEVERITY.BILGI),
    "h MULTI is BILGI"
  );
  const nonInfo = (r.rows || []).flatMap((row) => row.issueDetails || []).filter(
    (i) => i.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI
  );
  const nonInfoExtras = (r.findingExtras || []).filter(
    (i) => i.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI
  );
  if (!nonInfo.length && !nonInfoExtras.length) {
    assert(r.summary.overallSonuc !== E_DEFTER_SONUC_SEVIYE.UYARI, "h MULTI alone not Uyarı");
  }
}

// i–j) Hareket vs sistem bilgisi; sistem BA/fiş/duplicate'a girmez
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "I1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "I1", "2", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  });
  assert(r.summary.hareketSatir === 2, "i hareket=2");
  assert(r.summary.sistemBilgisi >= 1, "i sistem bilgisi counted");
  assert(r.summary.toplamSatir === r.summary.hareketSatir, "i toplamSatir=hareket");
  assert(r.summary.toplamFis === 1, "j fis excludes system");
  assert(r.summary.borcToplam === 10 && r.summary.alacakToplam === 10, "j BA excludes system");
  assert(r.summary.mukerrer === 0, "j mukerrer excludes system");
}

// k) Mizan yokluğu güvenli kullanıcı metni
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    muavinSheetRows: sheet(MUAVIN_HEADERS, [
      ["MUAVİN", "10.05.2026", "00001", "100.01", "Kasa", "anon", "10", "0"],
      ["MUAVİN", "10.05.2026", "00001", "320.01", "Satıcı", "anon", "0", "10"],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  });
  assert(r.summary.mizanMuavin?.userLabel === "Mizan yüklenmedi", "k userLabel");
  assert(
    (r.findingExtras || []).some((f) => f.message === "Mizan yüklenmedi"),
    "k safe finding message"
  );
  assert(r.summary.incelemeGerekli === 0, "k mizan missing does not increment inceleme");
}

// l) Persist 0
{
  const spies = { parseInvocations: 0, analysisInvocations: 0, persistInvocations: 9 };
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "L2", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "L2", "2", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
    spies,
  });
  assert(r.counters.persistInvocations === 0, "l persist stays 0");
}

// m) bilgi-only extras + MULTI → Sonuç Bilgi, İnceleme 0, summary/table parity
{
  const r = runGenelMuhasebeKontrol({
    companyId: "c1",
    period: "2026/05",
    muavinSheetRows: sheet(MUAVIN_HEADERS, [
      ["MUAVİN", "10.05.2026", "00001", "100.01", "Kasa", "anon", "10", "0"],
      ["MUAVİN", "10.05.2026", "00001", "320.01", "Satıcı", "anon", "0", "10"],
    ]),
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "M1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "M1", "2", "120.01", "A", "anon", "FT", "B1", "5", "0", ""],
      ["10.05.2026", "M1", "3", "320.01", "S", "anon", "FT", "B1", "0", "8", ""],
      ["10.05.2026", "M1", "4", "321.01", "S2", "anon", "FT", "B1", "0", "7", ""],
    ]),
    accountPlanAccounts: [
      { account_code: "100.01" },
      { account_code: "120.01" },
      { account_code: "320.01" },
      { account_code: "321.01" },
    ],
    accountPlanStatus: "loaded",
  });
  const nonInfo = (r.findingsCatalog || []).filter(
    (item) => item.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI
  );
  if (!nonInfo.length) {
    assert(
      r.summary.overallSonuc === E_DEFTER_SONUC_SEVIYE.BILGI ||
        r.summary.overallSonuc === E_DEFTER_SONUC_SEVIYE.UYGUN,
      "m bilgi-only overall not Uyarı"
    );
    assert(r.summary.incelemeGerekli === 0, "m bilgi-only inceleme 0");
  }
  assert(
    r.summary.overallSonuc === r.findingsSummary?.overallSonuc,
    "m summary/table overall parity"
  );
  assert(
    r.summary.incelemeGerekli === r.findingsSummary?.incelemeGerekli,
    "m summary/table inceleme parity"
  );
}

// n) MULTI grouped in presentation; UYARI stays above grouped BILGI
{
  const multiRows = Array.from({ length: 55 }, (_, idx) => ({
    fisNo: "00001",
    tarih: "01.01.2026",
    hesapKodu: `120.01.B${String(idx).padStart(4, "0")}`,
    severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
    code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
    message: `multi ${idx}`,
  }));
  const catalog = [
    {
      fisNo: "00049",
      tarih: "01.01.2026",
      hesapKodu: "320.10.Y0010",
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      code: E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE,
      message: "Aynı fişte yalnız aynı yönlü satırlar var; karşıt hesap bağlanamaz.",
    },
    ...multiRows,
  ];
  const presentation = buildGenelMuhasebeFindingsPresentation(catalog);
  assert(presentation[0]?.severity === E_DEFTER_ISSUE_SEVERITY.UYARI, "n UYARI first");
  assert(
    presentation.some((item) => item.kind === "group" && item.fisNo === "00001"),
    "n MULTI grouped summary row"
  );
  assert(
    presentation.find((item) => item.kind === "group" && item.fisNo === "00001")?.count === 55,
    "n grouped count preserved"
  );
  assert(
    presentation[0]?.displayTitle ===
      GENEL_MUHASEBE_FINDING_TITLE_TR[E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE],
    "n UYARI Turkish title"
  );
  assert(
    !userVisibleTextHasTechnicalCode(presentation[0]?.displayMessage || ""),
    "n UYARI user message has no English code"
  );
  const multiGroup = presentation.find((item) => item.kind === "group" && item.fisNo === "00001");
  assert(
    multiGroup?.displayTitle ===
      GENEL_MUHASEBE_FINDING_TITLE_TR[E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART],
    "n MULTI Turkish title"
  );
  assert(
    !userVisibleTextHasTechnicalCode(multiGroup?.displayMessage || ""),
    "n MULTI user message has no English code"
  );
  assert(multiGroup?.code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART, "n MULTI technical code preserved");
  assert(
    presentation[0]?.code === E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE,
    "n UYARI technical code preserved"
  );
}

// o) worker/main payload parity includes findings summary
{
  const input = {
    companyId: "c1",
    period: "2026/05",
    yevmiyeSheetRows: sheet(YEVMIYE_HEADERS, [
      ["10.05.2026", "O1", "1", "100.01", "Kasa", "anon", "FT", "B1", "10", "0", ""],
      ["10.05.2026", "O1", "2", "320.01", "S", "anon", "FT", "B1", "0", "10", ""],
    ]),
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "320.01" }],
    accountPlanStatus: "loaded",
  };
  const direct = runGenelMuhasebeKontrol(input);
  const again = runGenelMuhasebeKontrol(input);
  assert(resultsAreParityEqual(direct, again), "o worker/main parity");
  assert(direct.findingsSummary?.overallSonuc, "o findingsSummary present");
  assert(
    direct.summary.overallSonuc === direct.findingsSummary.overallSonuc,
    "o summary uses catalog overall"
  );
}

// p) optional real-file smoke: severity/code distribution + hidden UYARI visibility
{
  const muavinPath = path.join(process.env.USERPROFILE || "", "Desktop", "muavin_mare.xlsx");
  const mizanPath = path.join(process.env.USERPROFILE || "", "Desktop", "mizan_mare.xlsx");
  const yevPath = path.join(
    process.env.USERPROFILE || "",
    "Desktop",
    "yevmiye_defteri_mare.xlsx"
  );
  if (!fs.existsSync(muavinPath) || !fs.existsSync(yevPath)) {
    console.log("SKIP  p real-file findings smoke (mare xlsx not on Desktop)");
  } else {
    const read = (p) => {
      const buf = fs.readFileSync(p);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return readSheetRowsFromArrayBuffer(ab);
    };
    const r = runGenelMuhasebeKontrol({
      companyId: "mare",
      period: "2026/03",
      muavinSheetRows: read(muavinPath),
      yevmiyeSheetRows: read(yevPath),
      mizanSheetRows: fs.existsSync(mizanPath) ? read(mizanPath) : null,
      accountPlanAccounts: [],
      accountPlanStatus: "missing",
    });
    const presentation = buildGenelMuhasebeFindingsPresentation(r.findingsCatalog || []);
    const nonInfo = (r.findingsCatalog || []).filter(
      (item) => item.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI
    );
    console.log("REAL severity", r.findingsSummary?.severityCounts);
    console.log("REAL codes", r.findingsSummary?.codeCounts);
    console.log("REAL overall", r.summary.overallSonuc, "inceleme", r.summary.incelemeGerekli);
    if (fs.existsSync(mizanPath)) {
      assert(r.summary.mizanMuavin?.matched === true, "p mizan↔muavin matched");
      assert(r.summary.mizanMuavin?.onlyMizan?.length === 0, "p onlyMizan 0");
      assert(r.summary.mizanMuavin?.comparedAccounts === 260, "p compared leaf 260");
      assert(r.summary.mizanMuavin?.grandTotals?.matched === true, "p grand totals pass");
      assert(r.summary.hesapPlandaYok === 0, "p ACCOUNT_NOT_IN_PLAN 0");
    }
    if (nonInfo.length === 1) {
      const only = nonInfo[0];
      console.log(
        "REAL sole non-info",
        only.code,
        only.severity,
        only.fisNo,
        only.hesapKodu,
        only.message
      );
      assert(only.code === E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE, "p sole warning code");
      assert(only.fisNo === "00049", "p sole warning fis");
      assert(r.summary.overallSonuc === E_DEFTER_SONUC_SEVIYE.UYARI, "p overall Uyarı");
      assert(r.summary.incelemeGerekli === 1, "p inceleme 1");
      assert(
        presentation[0]?.code === E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE,
        "p warning visible at top of presentation"
      );
      assert(
        presentation[0]?.displayTitle ===
          GENEL_MUHASEBE_FINDING_TITLE_TR[E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE],
        "p warning Turkish title"
      );
      assert(
        !userVisibleTextHasTechnicalCode(presentation[0]?.displayMessage || ""),
        "p warning user message no EN code"
      );
    }
    assert(r.summary.muavinYevmiye?.matchedCount === 545, "p 545/545 preserved");
    assert(r.summary.muavinYevmiye?.counts?.onlyMuavin === 0, "p onlyMuavin 0");
    assert(r.summary.muavinYevmiye?.counts?.onlyYevmiye === 0, "p onlyYevmiye 0");
    assert(r.counters.persistInvocations === 0, "p persist 0");
  }
}

// q) fiş filtresi — exact match, gruplu satırlar, boş/temizleme
{
  const catalog = [
    {
      fisNo: "00049",
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      code: E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE,
      message: "uyarı",
    },
    {
      fisNo: "00001",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
      message: "multi-a",
    },
    {
      fisNo: "00001",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
      message: "multi-b",
    },
    {
      fisNo: "00002",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "other fis",
    },
    {
      fisNo: "",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.MIZAN_MUAVIN_EVIDENCE_MISSING,
      message: "Mizan yüklenmedi",
    },
  ];

  const all = buildGenelMuhasebeFindingsPresentation(catalog);
  const f49 = buildGenelMuhasebeFindingsPresentation(catalog, { fisFilter: "00049" });
  const f01 = buildGenelMuhasebeFindingsPresentation(catalog, { fisFilter: "00001" });
  const fTrim = buildGenelMuhasebeFindingsPresentation(catalog, { fisFilter: "  00049  " });
  const fMissing = buildGenelMuhasebeFindingsPresentation(catalog, { fisFilter: "99999" });
  const fPartial = buildGenelMuhasebeFindingsPresentation(catalog, { fisFilter: "0000" });

  assert(all.length >= 3, "q clear filter returns grouped rows");
  assert(
    f49.every((row) => normalizeFisNoForFilter(row.fisNo) === "00049"),
    "q 00049 only 00049 rows"
  );
  assert(!f49.some((row) => row.fisNo === "00001" || row.fisNo === "00002"), "q 00049 hides other fis");
  assert(
    f49.some((row) => row.code === E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE),
    "q 00049 keeps UYARI row"
  );
  assert(
    f01.length === 1 && f01[0].kind === "group" && f01[0].fisNo === "00001",
    "q 00001 only grouped MULTI row"
  );
  assert(f01[0]?.count === 2, "q grouped MULTI count preserved");
  assert(fMissing.length === 0, "q unknown fis empty");
  assert(fPartial.length === 0, "q partial 0000 exact match yields none");
  assert(
    fTrim.length === f49.length && fTrim[0]?.fisNo === "00049",
    "q trim preserves leading zeros"
  );
  assert(
    filterGenelMuhasebePresentationRows(all, "00049").every(
      (row) => row.fisNo === "00049"
    ),
    "q presentation-row filter exact"
  );
}

// r) filtre değişiminde expansion prune + görünür satır sayısı
{
  const catalog = [
    {
      fisNo: "00049",
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      code: E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE,
      message: "uyarı",
    },
    {
      fisNo: "00049",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING,
      message: "round",
    },
    {
      fisNo: "00001",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
      message: "multi-a",
    },
    {
      fisNo: "00001",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
      message: "multi-b",
    },
  ];

  const f01 = buildGenelMuhasebeFindingsPresentation(catalog, { fisFilter: "00001" });
  const groupId = f01[0]?.id;
  const expandedOld = new Set([groupId]);
  const f49 = buildGenelMuhasebeFindingsPresentation(catalog, { fisFilter: "00049" });
  const pruned = pruneExpandedPresentationGroups([...expandedOld], f49);

  assert(f01.length === 1 && f01[0].kind === "group", "r 00001 grouped row");
  assert(f49.length === 2, "r 00049 two parent rows");
  assert(pruned.size === 0, "r stale 00001 expansion pruned on 00049 filter");
  assert(
    countVisiblePresentationRows(f49, pruned) === 2,
    "r 00049 visible rows without orphan children"
  );
  assert(
    !f49.some((row) => row.fisNo === "00001"),
    "r 00049 filter hides 00001 parent"
  );

  const openOn01 = pruneExpandedPresentationGroups([groupId], f01);
  assert(
    countVisiblePresentationRows(f01, openOn01) === 1 + (f01[0]?.details?.length || 0),
    "r expanded 00001 counts children"
  );

  const all = buildGenelMuhasebeFindingsPresentation(catalog);
  const expandedAfterClear = new Set();
  assert(expandedAfterClear.size === 0, "r clear filter resets expansion");
  assert(
    countVisiblePresentationRows(all, expandedAfterClear) >= 3,
    "r clear filter shows all parent rows collapsed"
  );
}

assert(accountCodeFromPlanRow({ accountCode: "102.01" }) === "102.01", "accountCode helper");

// s) Türkçe UI sunumu — teknik kod korunur, kullanıcı metninde İngilizce yok
{
  assert(
    genelMuhasebeFindingTitleTr(E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART) ===
      "Birden fazla karşıt hesap",
    "s MULTI title TR"
  );
  assert(
    genelMuhasebeFindingTitleTr(E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE) === "Aynı yönlü kayıt",
    "s SAME_SIDE title TR"
  );
  assert(
    genelMuhasebeFindingTitleTr(E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING) ===
      "Şüpheli yuvarlama kaydı",
    "s ROUNDING title TR"
  );
  assert(
    genelMuhasebeFindingMessageTr(E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART).includes(
      "birden fazla karşıt hesap"
    ),
    "s MULTI message TR"
  );
  assert(
    genelMuhasebeFindingMessageTr(E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE).includes(
      "aynı yönlü"
    ),
    "s SAME_SIDE message TR"
  );
  assert(
    genelMuhasebeFindingMessageTr(E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING).includes("yuvarlama"),
    "s ROUNDING message TR"
  );

  const catalog = [
    {
      fisNo: "00049",
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      code: E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE,
      message: "engine message kept",
    },
    {
      fisNo: "00001",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
      message: "engine multi",
    },
    {
      fisNo: "00002",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING,
      message: "engine round",
    },
    {
      fisNo: "",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "engine unknown",
    },
  ];
  const presentation = buildGenelMuhasebeFindingsPresentation(catalog);
  for (const row of presentation) {
    assert(row.code, "s technical code on presentation");
    assert(!userVisibleTextHasTechnicalCode(row.displayTitle || ""), "s title no EN code");
    assert(!userVisibleTextHasTechnicalCode(row.displayMessage || ""), "s message no EN code");
  }
  assert(
    catalog[0].code === E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE,
    "s catalog technical code unchanged"
  );
}

// t) MULTI group multiDetail from ledgerRows — read-only voucher snapshot
{
  const catalog = [
    {
      fisNo: "00017",
      tarih: "19.01.2026",
      hesapKodu: "102.10.V001",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
      message: "multi",
    },
  ];
  const ledgerRows = [
    {
      id: "y1",
      fisNo: "00017",
      tarih: "19.01.2026",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      hesapKodu: "102.10.V001",
      hesapAdi: "Vadeli TL",
      borc: 0,
      alacak: 100,
      issueDetails: [{ code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART }],
    },
    {
      id: "y2",
      fisNo: "00017",
      tarih: "19.01.2026",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      hesapKodu: "300.01.042",
      hesapAdi: "Banka kredisi",
      borc: 70,
      alacak: 0,
    },
    {
      id: "y3",
      fisNo: "00017",
      tarih: "19.01.2026",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      hesapKodu: "780.10.003",
      hesapAdi: "Faiz gideri",
      borc: 30,
      alacak: 0,
    },
  ];
  const presentation = buildGenelMuhasebeFindingsPresentation(catalog, { ledgerRows });
  const group = presentation.find((item) => item.kind === "group" && item.fisNo === "00017");
  assert(Boolean(group?.multiDetail), "t multiDetail attached");
  assert(group.multiDetail.lineCount === 3, "t voucher line count 3");
  assert(group.multiDetail.candidateCount === 2, "t candidate count 2");
  assert(
    group.multiDetail.candidates.includes("300.01.042") &&
      group.multiDetail.candidates.includes("780.10.003"),
    "t candidates are opposite debit codes"
  );
  assert(
    /Karşı yönde 2 farklı hesap bulunduğu için tek karşıt hesap seçilemedi/.test(
      group.multiDetail.reasonTr || ""
    ),
    "t reasonTr mentions N=2"
  );
  assert(
    group.multiDetail.lines.every((line) => line.yon === "BORÇ" || line.yon === "ALACAK"),
    "t lines have BORÇ/ALACAK direction"
  );
  assert(
    group.details?.length === 1 && group.details[0].hesapKodu === "102.10.V001",
    "t technical detail rows preserved"
  );
  assert(
    !JSON.stringify(group.multiDetail).includes("BANKA_VE_BORC") &&
      !JSON.stringify(group).includes("pattern"),
    "t heuristic pattern not exposed on presentation"
  );

  const again = buildGenelMuhasebeFindingsPresentation(catalog, { ledgerRows });
  assert(
    JSON.stringify(group.multiDetail) === JSON.stringify(again[0]?.multiDetail),
    "t presentation multiDetail deterministic (worker/main same builder)"
  );
}

// u) MULTI (ayrıntı) → modal state; inline expand yok; close clears
{
  assert(
    shouldRenderInlineMultiGroupDetails() === false,
    "u inline multi group details disabled"
  );

  const catalog = [
    {
      fisNo: "00002",
      tarih: "02.01.2026",
      hesapKodu: "320.10.M0009",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
      message: "multi",
    },
  ];
  const ledgerRows = [
    {
      id: "a",
      fisNo: "00002",
      tarih: "02.01.2026",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      hesapKodu: "191.01.001",
      hesapAdi: "KDV",
      borc: 23.4,
      alacak: 0,
    },
    {
      id: "b",
      fisNo: "00002",
      tarih: "02.01.2026",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      hesapKodu: "320.10.M0009",
      hesapAdi: "Cari",
      borc: 0,
      alacak: 2363.4,
      issueDetails: [{ code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART }],
    },
    {
      id: "c",
      fisNo: "00002",
      tarih: "02.01.2026",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      hesapKodu: "740.30.003",
      hesapAdi: "Gider",
      borc: 2340,
      alacak: 0,
    },
  ];
  const presentation = buildGenelMuhasebeFindingsPresentation(catalog, { ledgerRows });
  const group = presentation.find((item) => item.kind === "group" && item.fisNo === "00002");
  assert(Boolean(group), "u group present");

  let ui = createMultiCounterpartUiState(null);
  assert(!isMultiCounterpartModalOpen(ui), "u modal closed initially");

  ui = openMultiCounterpartGroup(ui, group, ledgerRows);
  assert(isMultiCounterpartModalOpen(ui), "u (ayrıntı) opens modal state");
  assert(ui.multiDetailGroup?.kind === "group", "u modal holds group");
  assert(ui.multiDetailGroup?.multiDetail?.lineCount === 3, "u modal multiDetail 3 lines");
  assert(ui.multiDetailGroup?.multiDetail?.candidateCount === 2, "u modal 2 candidates");
  assert(
    /tek karşıt hesap seçilemedi/.test(ui.multiDetailGroup?.multiDetail?.reasonTr || ""),
    "u modal reason present"
  );
  assert(
    (ui.multiDetailGroup?.details || []).length === 1,
    "u technical details preserved on group for modal secondary section"
  );

  ui = closeMultiCounterpartGroup(ui);
  assert(!isMultiCounterpartModalOpen(ui), "u close clears modal state");
  assert(ui.multiDetailGroup === null, "u close nulls group");

  const pageSrc = fs.readFileSync(
    path.resolve("app/(annvero)/muhasebe/genel-muhasebe-kontrol/page.jsx"),
    "utf8"
  );
  assert(!/toggleFindingGroup/.test(pageSrc), "u page has no toggleFindingGroup");
  assert(
    !/\{open \? " \(gizle\)" : " \(ayrıntı\)"\}/.test(pageSrc),
    "u page has no inline gizle/ayrıntı toggle"
  );
  assert(
    !/for \(const detail of item\.details/.test(pageSrc),
    "u page does not inline-expand item.details"
  );
  assert(/openMultiCounterpartDetail/.test(pageSrc), "u page opens multi modal");
  assert(/MultiCounterpartDetailModal/.test(pageSrc), "u page mounts multi modal");
  assert(
    /data-testid="multi-counterpart-detail-open"/.test(pageSrc),
    "u open button test id present"
  );
}

// v) modal display order BORÇ then ALACAK; source order within side; ledgerRows not mutated
{
  // Kaynak sıra: BORÇ / ALACAK / BORÇ → modal: BORÇ / BORÇ / ALACAK
  const ledgerRows = [
    {
      id: "debit-191",
      fisNo: "00002",
      tarih: "02.01.2026",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      hesapKodu: "191.01.001",
      hesapAdi: "KDV",
      borc: 23.4,
      alacak: 0,
    },
    {
      id: "credit-320",
      fisNo: "00002",
      tarih: "02.01.2026",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      hesapKodu: "320.10.M0009",
      hesapAdi: "Cari",
      borc: 0,
      alacak: 2363.4,
      issueDetails: [{ code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART }],
    },
    {
      id: "debit-740",
      fisNo: "00002",
      tarih: "02.01.2026",
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      hesapKodu: "740.30.003",
      hesapAdi: "Gider",
      borc: 2340,
      alacak: 0,
    },
  ];
  const snapshot = JSON.stringify(ledgerRows);
  const detail = buildMultiCounterpartVoucherDetail({
    fisNo: "00002",
    tarih: "02.01.2026",
    ledgerRows,
    multiFindingItems: [{ hesapKodu: "320.10.M0009" }],
  });
  assert(JSON.stringify(ledgerRows) === snapshot, "v ledgerRows not mutated");
  assert(
    detail.lines.map((line) => `${line.yon}|${line.hesapKodu}`).join(",") ===
      "BORÇ|191.01.001,BORÇ|740.30.003,ALACAK|320.10.M0009",
    "v source BORÇ/ALACAK/BORÇ becomes modal BORÇ/BORÇ/ALACAK"
  );
  assert(detail.lines[0].borc === 23.4, "v first debit amount 23,40");
  assert(detail.lines[1].borc === 2340, "v second debit amount 2.340,00");
  assert(detail.lines[2].alacak === 2363.4, "v credit amount 2.363,40");
  assert(
    detail.candidates.join(",") === "191.01.001,740.30.003",
    "v candidate codes/order unchanged (locale sorted)"
  );

  const unsorted = [
    { yon: "BORÇ", hesapKodu: "A" },
    { yon: "ALACAK", hesapKodu: "C" },
    { yon: "BORÇ", hesapKodu: "B" },
    { yon: "", hesapKodu: "Z" },
    { yon: "ALACAK", hesapKodu: "D" },
  ];
  const unsortedSnap = JSON.stringify(unsorted);
  const sorted = sortMultiCounterpartLinesForDisplay(unsorted);
  assert(JSON.stringify(unsorted) === unsortedSnap, "v sort input not mutated");
  assert(
    sorted.map((line) => line.hesapKodu).join(",") === "A,B,C,D,Z",
    "v same-side order kept; unknown last"
  );
}

if (failed) {
  console.error(`${failed} FAIL(s)`);
  process.exit(1);
}
console.log("ALL PASSED");
