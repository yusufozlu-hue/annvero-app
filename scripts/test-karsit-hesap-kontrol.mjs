/**
 * Karşıt hesap (voucher-scoped) contract tests — anonymous fixtures only.
 * Run: npm run test:karsit-hesap  (or node --import ./scripts/_alias-loader.mjs ./scripts/test-karsit-hesap-kontrol.mjs)
 */
import {
  analyzeEDefterRows,
  resolveVoucherCounterparts,
  runEDefterKontrolPipeline,
} from "@/src/utils/eDefterKontrolEngine.js";
import {
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
  E_DEFTER_KAYNAK,
  E_DEFTER_SONUC_SEVIYE,
} from "@/src/config/eDefterKontrolDefaults.js";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else {
    console.log(`PASS  ${msg}`);
  }
}

function row(partial) {
  return {
    id: partial.id,
    kaynak: partial.kaynak || E_DEFTER_KAYNAK.YEVMIYE,
    tarih: partial.tarih || "10.05.2026",
    fisNo: partial.fisNo ?? "10",
    yevmiyeNo: partial.yevmiyeNo || "1",
    hesapKodu: partial.hesapKodu,
    hesapAdi: partial.hesapAdi || "",
    aciklama: partial.aciklama || "anon",
    belgeTuru: partial.belgeTuru || "FT",
    belgeNo: partial.belgeNo || "B1",
    belgeTarihi: partial.belgeTarihi || "",
    borc: partial.borc ?? 0,
    alacak: partial.alacak ?? 0,
    cariUnvan: partial.cariUnvan || "",
    counterAccountCode: partial.counterAccountCode || "",
    tutar: Math.max(partial.borc || 0, partial.alacak || 0),
  };
}

// A: 2-line balanced → counterparts exact
{
  const rows = [
    row({ id: "a1", fisNo: "A1", hesapKodu: "100.01", borc: 100, alacak: 0 }),
    row({ id: "a2", fisNo: "A1", hesapKodu: "320.01", borc: 0, alacak: 100 }),
  ];
  const map = resolveVoucherCounterparts(rows);
  assert(map.get("a1").counterAccountCode === "320.01", "A debit→credit counterpart");
  assert(map.get("a2").counterAccountCode === "100.01", "A credit→debit counterpart");
  assert(map.get("a1").status === "RESOLVED" && map.get("a2").status === "RESOLVED", "A resolved");
}

// B: multi-line balanced → MULTI_COUNTERPART, no invent
{
  const rows = [
    row({ id: "b1", fisNo: "B1", hesapKodu: "100.01", borc: 100, alacak: 0 }),
    row({ id: "b2", fisNo: "B1", hesapKodu: "320.01", borc: 0, alacak: 60 }),
    row({ id: "b3", fisNo: "B1", hesapKodu: "391.01", borc: 0, alacak: 40 }),
  ];
  const map = resolveVoucherCounterparts(rows);
  assert(map.get("b1").status === "MULTI", "B multi status");
  assert(map.get("b1").code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART, "B multi code");
  assert(!map.get("b1").counterAccountCode, "B no invented single counterpart");
  assert(map.get("b1").candidates.length === 2, "B two candidates");
}

// C: unbalanced → blocking via pipeline
{
  const result = runEDefterKontrolPipeline({
    xmlRows: [
      row({ id: "c1", fisNo: "C1", hesapKodu: "100.01", borc: 50, alacak: 0 }),
      row({ id: "c2", fisNo: "C1", hesapKodu: "320.01", borc: 0, alacak: 40 }),
    ],
    period: "2026/05",
    companyId: "c1",
  });
  assert(
    result.rows.some((r) =>
      (r.issueDetails || []).some((i) => i.code === E_DEFTER_ISSUE_CODE.DEBIT_CREDIT_MISMATCH && i.blocking)
    ),
    "C unbalanced blocking"
  );
  assert(result.summary.edefterUygun === false, "C not uygun");
}

// D: same-side only → not counterpart
{
  const map = resolveVoucherCounterparts([
    row({ id: "d1", fisNo: "D1", hesapKodu: "100.01", borc: 10, alacak: 0 }),
    row({ id: "d2", fisNo: "D1", hesapKodu: "102.01", borc: 20, alacak: 0 }),
  ]);
  assert(map.get("d1").code === E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE, "D same-side code");
  assert(!map.get("d1").counterAccountCode, "D no counterpart");
}

// E: missing fis → review, no hard match
{
  const map = resolveVoucherCounterparts([
    row({ id: "e1", fisNo: "", hesapKodu: "100.01", borc: 10, alacak: 0, aciklama: "aynı" }),
    row({ id: "e2", fisNo: "", hesapKodu: "320.01", borc: 0, alacak: 10, aciklama: "aynı" }),
  ]);
  assert(map.get("e1").code === E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW, "E review without fis");
  assert(!map.get("e1").counterAccountCode, "E no invented match");
}

// F: exact duplicate line still flagged by analyze
{
  const analyzed = analyzeEDefterRows([
    row({ id: "f1", fisNo: "F1", yevmiyeNo: "1", belgeNo: "X", hesapKodu: "100.01", borc: 9, alacak: 0 }),
    row({ id: "f2", fisNo: "F1", yevmiyeNo: "1", belgeNo: "X", hesapKodu: "100.01", borc: 9, alacak: 0 }),
    row({ id: "f3", fisNo: "F1", yevmiyeNo: "2", belgeNo: "X", hesapKodu: "320.01", borc: 0, alacak: 18 }),
  ]);
  assert(
    analyzed.some((r) => (r.issues || []).some((m) => String(m).includes("Birebir"))),
    "F exact duplicate"
  );
}

// G: same explanation/amount different fis → not duplicate
{
  const analyzed = analyzeEDefterRows([
    row({ id: "g1", fisNo: "G1", hesapKodu: "100.01", borc: 11, alacak: 0, aciklama: "ortak" }),
    row({ id: "g2", fisNo: "G1", hesapKodu: "320.01", borc: 0, alacak: 11, aciklama: "ortak" }),
    row({ id: "g3", fisNo: "G2", hesapKodu: "100.01", borc: 11, alacak: 0, aciklama: "ortak" }),
    row({ id: "g4", fisNo: "G2", hesapKodu: "320.01", borc: 0, alacak: 11, aciklama: "ortak" }),
  ]);
  assert(
    !analyzed.some((r) => (r.issues || []).some((m) => String(m).includes("Birebir aynı satır"))),
    "G different fis not exact duplicate"
  );
}

// H: zero amount preserved / skipped for counterpart
{
  const map = resolveVoucherCounterparts([
    row({ id: "h1", fisNo: "H1", hesapKodu: "100.01", borc: 0, alacak: 0 }),
    row({ id: "h2", fisNo: "H1", hesapKodu: "320.01", borc: 0, alacak: 50 }),
    row({ id: "h3", fisNo: "H1", hesapKodu: "100.01", borc: 50, alacak: 0 }),
  ]);
  assert(map.get("h1").status === "SKIP", "H zero skip");
  assert(map.get("h3").counterAccountCode === "320.01", "H nonzero resolved");
}

// I: 100/102 reverse-looking period net → BILGI (not auto kritik) via analyze path
{
  const analyzed = analyzeEDefterRows([
    row({ id: "i1", fisNo: "I1", hesapKodu: "100.01", borc: 0, alacak: 100 }),
    row({ id: "i2", fisNo: "I1", hesapKodu: "102.01", borc: 100, alacak: 0 }),
  ]);
  const ters = analyzed.flatMap((r) => r.issueDetails || []).filter((i) =>
    String(i.message || "").toLocaleLowerCase("tr-TR").includes("ters bakiye")
  );
  assert(
    ters.every((i) => i.severity === E_DEFTER_ISSUE_SEVERITY.BILGI),
    "I period ters bakiye is BILGI"
  );
}

// L: company isolation — different companyId pipelines don't share rows (smoke)
{
  const a = runEDefterKontrolPipeline({
    xmlRows: [row({ id: "l1", fisNo: "L1", hesapKodu: "100.01", borc: 5, alacak: 0 }), row({ id: "l2", fisNo: "L1", hesapKodu: "320.01", borc: 0, alacak: 5 })],
    companyId: "co-a",
    period: "2026/05",
  });
  const b = runEDefterKontrolPipeline({
    xmlRows: [row({ id: "l3", fisNo: "L1", hesapKodu: "100.01", borc: 9, alacak: 0 }), row({ id: "l4", fisNo: "L1", hesapKodu: "320.01", borc: 0, alacak: 9 })],
    companyId: "co-b",
    period: "2026/05",
  });
  assert(a.rows.some((r) => r.id === "l1" && r.counterAccountCode === "320.01"), "L co-a counterpart");
  assert(b.rows.some((r) => r.id === "l3" && r.counterAccountCode === "320.01"), "L co-b counterpart");
  assert(!a.rows.some((r) => r.id === "l3"), "L co-a does not contain co-b rows");
}

// O: clean two-line layout → no KRITIK from counterpart
{
  const result = runEDefterKontrolPipeline({
    xmlRows: [
      row({ id: "o1", fisNo: "O1", hesapKodu: "100.01", borc: 25, alacak: 0, belgeTuru: "FT" }),
      row({ id: "o2", fisNo: "O1", hesapKodu: "320.01", borc: 0, alacak: 25, belgeTuru: "FT" }),
    ],
    period: "2026/05",
    companyId: "c1",
  });
  assert(result.overallSonuc !== E_DEFTER_SONUC_SEVIYE.KRITIK, "O no false kritik");
  assert(
    result.rows
      .filter((r) => r.fisNo === "O1")
      .every((r) => r.counterAccountCode === "100.01" || r.counterAccountCode === "320.01"),
    "O counterparts filled"
  );
}

if (failed) {
  console.error(`${failed} FAIL(s)`);
  process.exit(1);
}
console.log("ALL PASSED");
