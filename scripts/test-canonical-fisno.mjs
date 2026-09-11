/**
 * Canonical fiş no sözleşmesi + Fiş Kontrol gruplama matrisi.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-canonical-fisno.mjs
 */
import {
  canonicalFisNoKey,
  compareCanonicalFisNoKeys,
  displayFisNo,
  fisNosCanonicallyEqual,
  matchesVoucherNumberFilter,
  normalizeFisNoForFilter,
} from "@/src/utils/canonicalFisNo.js";
import {
  analyzeStandardLucaRows,
  buildFisKontrolExcelRows,
  groupLucaFisBatches,
  KONTROL_TIP,
} from "@/src/utils/fisKontrolMerkezi.js";
import { normalizeFisNoForFilter as gmNormalize } from "@/src/utils/genelMuhasebeFindingsView.js";

function pass(condition, label) {
  if (!condition) {
    console.error(`FAIL  ${label}`);
    process.exit(1);
  }
  console.log(`PASS  ${label}`);
}

function leg(fisNo, side, amount = 10) {
  return {
    id: `${fisNo}-${side}`,
    fisNo,
    fisTarihi: "10.03.2026",
    hesapKodu: side === "d" ? "102.01.001" : "320.01.001",
    borc: side === "d" ? amount : 0,
    alacak: side === "c" ? amount : 0,
    aciklama: "anon",
    belgeTuru: "FT",
    firmaId: "co-a",
    sourceMovementId: `src-${fisNo}`,
    lineRole: side === "d" ? "debit" : "credit",
  };
}

console.log("1) digit zero-pad → same canonical key");
for (const v of ["1", "01", "001", "00001"]) {
  pass(canonicalFisNoKey(v) === "1", `key(${v})===1`);
}
pass(normalizeFisNoForFilter("00001") === "1", "normalizeFisNoForFilter alias");
pass(gmNormalize("00049") === "49", "GM re-export parity");

console.log("2) all zeros → 0");
for (const v of ["0", "00", "00000"]) {
  pass(canonicalFisNoKey(v) === "0", `key(${v})===0`);
}

console.log("3) long numeric — no Number precision loss");
const long = "9007199254740993"; // > Number.MAX_SAFE_INTEGER
pass(canonicalFisNoKey(`000${long}`) === long, "long strip zeros");
pass(canonicalFisNoKey(long) === long, "long stable");
pass(String(Number(long)) !== long, "Number would lose precision");
pass(
  compareCanonicalFisNoKeys(
    canonicalFisNoKey(long),
    canonicalFisNoKey(`0${long}`)
  ) === 0,
  "compare canonical equal"
);

console.log("4) alphanumeric keeps zeros");
pass(canonicalFisNoKey("001A") === "001a", "001A lower");
pass(canonicalFisNoKey("1A") === "1a", "1A lower");
pass(!fisNosCanonicallyEqual("001A", "1A"), "001A !== 1A");

console.log("5) empty / null / whitespace");
pass(canonicalFisNoKey("") === "", "empty");
pass(canonicalFisNoKey("   ") === "", "whitespace");
pass(canonicalFisNoKey(null) === "", "null");
pass(canonicalFisNoKey(undefined) === "", "undefined");
pass(!fisNosCanonicallyEqual("", ""), "empty not equal");
pass(!fisNosCanonicallyEqual(null, "0"), "null !== 0");

console.log("6) display preserves source zeros");
pass(displayFisNo("00001") === "00001", "display keeps zeros");
pass(displayFisNo(49) === "49", "numeric cell → string 49 (no fake pad)");

console.log("7) filter 1 matches 00001");
pass(matchesVoucherNumberFilter("00001", "1"), "filter 1→00001");
pass(matchesVoucherNumberFilter("1", "00001"), "filter 00001→1");
pass(!matchesVoucherNumberFilter("001A", "1A"), "filter alnum strict");

console.log("8) balance groups merge zero-pad variants");
{
  const rows = [
    leg("00001", "d", 25),
    leg("1", "c", 25),
    leg("02", "d", 10),
    leg("2", "c", 10),
  ];
  // distinct sourceMovementId so legs aren't treated as cross-fis duplicate
  rows[0].sourceMovementId = "m1";
  rows[1].sourceMovementId = "m1";
  rows[2].sourceMovementId = "m2";
  rows[3].sourceMovementId = "m2";
  const analysis = analyzeStandardLucaRows(rows, { firmaId: "co-a" });
  pass(analysis.summary.totalFis === 2, "two canonical fis groups");
  pass(analysis.summary.unbalancedFisCount === 0, "balanced after merge");
  pass(analysis.summary.isBalanced === true, "isBalanced");
  // display on rows unchanged
  pass(analysis.rows[0].fisNo === "00001", "row display 00001");
  pass(analysis.rows[1].fisNo === "1", "row display 1");
}

console.log("9) empty fisNo not merged into one fake voucher");
{
  const rows = [
    { ...leg("", "d", 5), fisNo: "", id: "e1", sourceMovementId: "e1" },
    { ...leg("", "c", 5), fisNo: "  ", id: "e2", sourceMovementId: "e2" },
  ];
  const analysis = analyzeStandardLucaRows(rows, { firmaId: "co-a" });
  pass(analysis.summary.totalFis === 2, "empty rows stay separate fail-safe");
}

console.log("10) different real vouchers do not merge");
{
  const rows = [
    leg("10", "d", 5),
    leg("10", "c", 5),
    leg("100", "d", 7),
    leg("100", "c", 7),
  ];
  rows[0].sourceMovementId = "a";
  rows[1].sourceMovementId = "a";
  rows[2].sourceMovementId = "b";
  rows[3].sourceMovementId = "b";
  const analysis = analyzeStandardLucaRows(rows, { firmaId: "co-a" });
  pass(analysis.summary.totalFis === 2, "10 and 100 distinct");
}

console.log("11) mükerrer: same source legs on zero-pad variants are not duplicate");
{
  const rows = [
    {
      ...leg("00001", "d", 12),
      sourceMovementId: "same-move",
      lineRole: "debit",
    },
    {
      ...leg("1", "c", 12),
      sourceMovementId: "same-move",
      lineRole: "credit",
    },
  ];
  const analysis = analyzeStandardLucaRows(rows, { firmaId: "co-a" });
  const mukerrer = (analysis.issues || []).filter(
    (i) => i.type === KONTROL_TIP.MUKERRER_KAYNAK
  );
  pass(mukerrer.length === 0, "same-fis opposite legs no MUKERRER_KAYNAK");
}

console.log("12) mükerrer: same source across different fis is duplicate");
{
  const rows = [
    {
      ...leg("1", "d", 12),
      sourceMovementId: "dup-move",
      lineRole: "debit",
    },
    {
      ...leg("2", "d", 12),
      sourceMovementId: "dup-move",
      lineRole: "debit",
    },
  ];
  const analysis = analyzeStandardLucaRows(rows, { firmaId: "co-a" });
  const mukerrer = (analysis.issues || []).filter(
    (i) => i.type === KONTROL_TIP.MUKERRER_KAYNAK
  );
  pass(mukerrer.length >= 1, "cross-fis same source → MUKERRER_KAYNAK");
}

console.log("13) export keeps source fisNo display");
{
  const rows = [leg("00049", "d", 3), leg("00049", "c", 3)];
  rows[0].sourceMovementId = "x";
  rows[1].sourceMovementId = "x";
  const analysis = analyzeStandardLucaRows(rows, { firmaId: "co-a" });
  const excel = buildFisKontrolExcelRows(analysis.rows);
  pass(
    excel.every((r) => r["Fiş No"] === "00049"),
    "export Fiş No = 00049"
  );
}

console.log("14) batch grouping uses canonical keys");
{
  const rows = [
    leg("001", "d"),
    leg("1", "c"),
    leg("2", "d"),
    leg("02", "c"),
  ];
  const batches = groupLucaFisBatches(rows, 50);
  pass(batches.length === 1, "one batch");
  // two canonical vouchers inside
  const keys = new Set(rows.map((r) => canonicalFisNoKey(r.fisNo)));
  pass(keys.size === 2, "batch input two keys");
}

console.log("ALL canonical fisno tests passed.");
