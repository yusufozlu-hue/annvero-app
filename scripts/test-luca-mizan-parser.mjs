/**
 * Luca mizan leaf hierarchy + muavin reconcile regressions.
 * Run: npm run test:luca-mizan-parser
 */
import fs from "node:fs";
import path from "node:path";
import { BORC_ALACAK_TOLERANCE, E_DEFTER_ISSUE_CODE } from "@/src/config/eDefterKontrolDefaults.js";
import {
  parseMizanSheet,
  parseMizanSheetWithStructure,
  parseMuavinSheet,
} from "@/src/utils/eDefterKontrolEngine.js";
import {
  reconcileMizanMuavin,
  runGenelMuhasebeKontrol,
} from "@/src/utils/genelMuhasebeKontrolEngine.js";
import { readSheetRowsFromArrayBuffer } from "@/src/utils/excelBufferUtils.js";
import {
  classifyMizanAccountCodes,
  isHierarchicalAccountPrefix,
  isMizanNonAccountRow,
  isMizanTotalsRow,
  MIZAN_ACCOUNT_ROLE,
  structureMizanParseResult,
  verifyMizanMuavinGrandTotals,
} from "@/src/utils/mizanAccountStructure.js";
import { normalizeAccountCodeForComparison } from "@/src/utils/textNormalize.js";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else {
    console.log(`PASS  ${msg}`);
  }
}

function sheet(headers, rows) {
  return [headers, ...rows];
}

// 1 — GENEL TOPLAM is not an account row
{
  const raw = [
    { hesapKodu: "100.01", hesapAdi: "Kasa", borc: 10, alacak: 0 },
    { hesapKodu: "GENEL TOPLAM :", hesapAdi: "", borc: 10, alacak: 10 },
  ];
  const bundle = structureMizanParseResult(raw);
  assert(bundle.rows.length === 1, "1 GENEL TOPLAM excluded from accounts");
  assert(bundle.mizanTotals?.borc === 10, "1 totals borc captured");
  assert(bundle.stats.totalsRowCount === 1, "1 totals row count");
  assert(isMizanTotalsRow({ hesapKodu: "GENEL TOPLAM :" }), "1 isMizanTotalsRow");
  assert(!isMizanNonAccountRow({ hesapKodu: "100.01", hesapAdi: "Kasa" }), "1 real account kept");
}

// 2 — hierarchy: segment + compact prefix
{
  assert(
    isHierarchicalAccountPrefix("102", "102.10"),
    "2 segment prefix 102→102.10"
  );
  assert(
    isHierarchicalAccountPrefix("102.10", "102.10.V001"),
    "2 segment prefix 102.10→102.10.V001"
  );
  assert(isHierarchicalAccountPrefix("1", "100"), "2 compact prefix 1→100");
  assert(!isHierarchicalAccountPrefix("100.01", "100.01"), "2 same code not prefix");
  const { parentCodes, leafCodes } = classifyMizanAccountCodes([
    "102",
    "102.10",
    "102.10.V001",
    "320.01",
  ]);
  assert(parentCodes.has("102") && parentCodes.has("102.10"), "2 parents detected");
  assert(leafCodes.has("102.10.V001") && leafCodes.has("320.01"), "2 leaves detected");
  assert(!leafCodes.has("102"), "2 102 not leaf");
}

// 3 — short code without children stays leaf
{
  const { leafCodes, parentCodes } = classifyMizanAccountCodes(["100.01", "320.01"]);
  assert(leafCodes.has("100.01") && leafCodes.has("320.01"), "3 short real accounts are leaves");
  assert(parentCodes.size === 0, "3 no false parents");
}

// 4 — Unicode account codes preserved
{
  const code = "120.01.PDİ01";
  const normalized = normalizeAccountCodeForComparison(code);
  assert(normalized.includes("PD"), "4 unicode segment preserved");
  assert(normalized !== "12001PDI01", "4 no ASCII transliteration");
  const bundle = structureMizanParseResult([
    { hesapKodu: code, hesapAdi: "Cari", borc: 1, alacak: 0 },
    { hesapKodu: "120.01", hesapAdi: "Üst", borc: 1, alacak: 0 },
  ]);
  assert(
    bundle.rows.some((row) => row.hesapKodu === code && row.mizanAccountRole === MIZAN_ACCOUNT_ROLE.LEAF),
    "4 Unicode leaf row preserved"
  );
}

// 5 — parent rows excluded from onlyMizan reconcile
{
  const rec = reconcileMizanMuavin({
    muavinRows: [{ hesapKodu: "100.01", borc: 10, alacak: 0 }],
    mizanRows: [
      { hesapKodu: "100", hesapAdi: "Kasa grubu", borc: 10, alacak: 0, mizanAccountRole: MIZAN_ACCOUNT_ROLE.PARENT },
      { hesapKodu: "100.01", hesapAdi: "Kasa", borc: 10, alacak: 0, mizanAccountRole: MIZAN_ACCOUNT_ROLE.LEAF },
    ],
    mizanTotals: { borc: 10, alacak: 0 },
  });
  assert(rec.onlyMizan.length === 0, "5 parent not in onlyMizan");
  assert(rec.matched === true, "5 leaf reconcile matched");
  assert(rec.parentAccountCount === 1, "5 parent count tracked");
}

// 6 — grand total check with kuruş tolerance
{
  const gt = verifyMizanMuavinGrandTotals({
    muavinRows: [{ hesapKodu: "100.01", borc: 10.005, alacak: 0 }],
    mizanTotals: { borc: 10, alacak: 0 },
    tolerance: BORC_ALACAK_TOLERANCE,
  });
  assert(gt.matched === true, "6 grand totals within tolerance");
  const gtFail = verifyMizanMuavinGrandTotals({
    muavinRows: [{ hesapKodu: "100.01", borc: 10.2, alacak: 0 }],
    mizanTotals: { borc: 10, alacak: 0 },
    tolerance: BORC_ALACAK_TOLERANCE,
  });
  assert(gtFail.matched === false, "6 real total diff fails");
}

// 7 — real account diff still fail-closed
{
  const rec = reconcileMizanMuavin({
    muavinRows: [{ hesapKodu: "100.01", borc: 10, alacak: 0 }],
    mizanRows: [
      { hesapKodu: "100.01", hesapAdi: "Kasa", borc: 9, alacak: 0, mizanAccountRole: MIZAN_ACCOUNT_ROLE.LEAF },
    ],
    mizanTotals: { borc: 9, alacak: 0 },
  });
  assert(rec.matched === false && rec.differences.length === 1, "7 amount diff fails");
}

// 8 — parseMizanSheet integration
{
  const rows = parseMizanSheet(
    sheet(["Hesap Kodu", "Hesap Adı", "Borç Bakiyesi", "Alacak Bakiyesi"], [
      ["100", "Üst", "10", "0"],
      ["100.01", "Kasa", "10", "0"],
      ["GENEL TOPLAM :", "", "10", "10"],
    ])
  );
  assert(rows.length === 2, "8 parseMizanSheet skips GENEL TOPLAM");
  assert(rows.some((r) => r.mizanAccountRole === MIZAN_ACCOUNT_ROLE.PARENT), "8 parent role");
  assert(rows.some((r) => r.mizanAccountRole === MIZAN_ACCOUNT_ROLE.LEAF), "8 leaf role");
  const bundle = parseMizanSheetWithStructure(
    sheet(["Hesap Kodu", "Hesap Adı", "Borç Bakiyesi", "Alacak Bakiyesi"], [
      ["100.01", "Kasa", "10", "0"],
      ["GENEL TOPLAM :", "", "10", "10"],
    ])
  );
  assert(bundle.mizanTotals?.alacak === 10, "8 structured totals");
}

// 9 — optional real mare smoke (read-only Desktop files)
{
  const muavinPath = path.join(process.env.USERPROFILE || "", "Desktop", "muavin_mare.xlsx");
  const mizanPath = path.join(process.env.USERPROFILE || "", "Desktop", "mizan_mare.xlsx");
  const yevPath = path.join(process.env.USERPROFILE || "", "Desktop", "yevmiye_defteri_mare.xlsx");
  if (!fs.existsSync(muavinPath) || !fs.existsSync(mizanPath) || !fs.existsSync(yevPath)) {
    console.log("SKIP  9 real mare mizan smoke (xlsx not on Desktop)");
  } else {
    const read = (p) => {
      const buf = fs.readFileSync(p);
      return readSheetRowsFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      );
    };
    const bundle = parseMizanSheetWithStructure(read(mizanPath));
    assert(bundle.stats.accountCount === 409, "9 mizan account rows 409");
    assert(bundle.stats.parentCount === 149, "9 parent count 149");
    assert(bundle.stats.leafCount === 260, "9 leaf count 260");
    assert(bundle.stats.totalsRowCount === 1, "9 GENEL TOPLAM row 1");

    const r = runGenelMuhasebeKontrol({
      companyId: "mare",
      period: "2026/03",
      muavinSheetRows: read(muavinPath),
      yevmiyeSheetRows: read(yevPath),
      mizanSheetRows: read(mizanPath),
      accountPlanAccounts: [],
      accountPlanStatus: "missing",
    });

    const mm = r.summary.mizanMuavin;
    assert(mm.status === "MATCHED" && mm.matched === true, "9 muavin↔mizan matched");
    assert(mm.onlyMuavin?.length === 0, "9 onlyMuavin 0");
    assert(mm.onlyMizan?.length === 0, "9 onlyMizan 0");
    assert(mm.differences?.length === 0, "9 amount diffs 0");
    assert(mm.comparedAccounts === 260, "9 compared leaf accounts 260");
    assert(mm.grandTotals?.matched === true, "9 grand totals matched");
    assert(r.summary.hesapPlandaYok === 0, "9 ACCOUNT_NOT_IN_PLAN 0");
    assert(
      !(r.findingsCatalog || []).some((f) => String(f.hesapKodu || "").includes("GENEL TOPLAM")),
      "9 no GENEL TOPLAM finding"
    );
    assert(r.summary.muavinYevmiye?.matchedCount === 545, "9 muavin↔yevmiye 545/545");
    assert(r.counters.persistInvocations === 0, "9 persist 0");
    console.log("REAL mizanMuavin", mm.userLabel, "structure", r.parsedCounts?.mizan);
  }
}

if (failed) {
  console.error(`${failed} FAIL(s)`);
  process.exit(1);
}
console.log("ALL PASSED");
