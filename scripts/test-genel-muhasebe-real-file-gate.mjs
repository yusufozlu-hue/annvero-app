/**
 * Faz 8A local-only real workbook acceptance gate.
 * Customer rows, account codes, descriptions and amounts are never logged.
 *
 * Run:
 * node --import ./scripts/_alias-loader.mjs ./scripts/test-genel-muhasebe-real-file-gate.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildMuavinYevmiyeFingerprint,
  runGenelMuhasebeKontrol,
} from "@/src/utils/genelMuhasebeKontrolEngine.js";
import {
  detectYevmiyeLayout,
  parseMuavinSheet,
  parseYevmiyeSheet,
  YEVMIYE_LAYOUT,
} from "@/src/utils/eDefterKontrolEngine.js";
import { readSheetRowsFromArrayBuffer } from "@/src/utils/excelBufferUtils.js";
import { buildGenelMuhasebePresentationSnapshot } from "@/src/utils/genelMuhasebeFindingsView.js";
import { VOUCHER_RESULT_VIEW } from "@/src/utils/voucherResultGroups.js";

const desktop = path.join(process.env.USERPROFILE || "", "Desktop");
const files = {
  muavin:
    process.env.MARE_MUAVIN_SMOKE || path.join(desktop, "muavin_mare.xlsx"),
  yevmiye:
    process.env.LUCA_YEVMIYE_SMOKE ||
    path.join(desktop, "yevmiye_defteri_mare.xlsx"),
  mizan:
    process.env.MARE_MIZAN_SMOKE || path.join(desktop, "mizan_mare.xlsx"),
};

const missing = Object.entries(files)
  .filter(([, filePath]) => !fs.existsSync(filePath))
  .map(([kind, filePath]) => ({ kind, path: filePath }));

if (missing.length) {
  console.error(JSON.stringify({ status: "REAL_FILE_MISSING", missing }));
  process.exit(1);
}

function assertExact(condition, metric) {
  if (!condition) {
    console.error(JSON.stringify({ status: "REAL_FILE_GATE_FAILED", metric }));
    process.exit(1);
  }
}

function readWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  return {
    rows: readSheetRowsFromArrayBuffer(arrayBuffer),
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16),
  };
}

function multiset(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = buildMuavinYevmiyeFingerprint(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

const muavin = readWorkbook(files.muavin);
const yevmiye = readWorkbook(files.yevmiye);
const mizan = readWorkbook(files.mizan);

assertExact(
  detectYevmiyeLayout(yevmiye.rows) ===
    YEVMIYE_LAYOUT.REPEATED_JOURNAL_BLOCK,
  "repeatedJournalLayout"
);

const parsedMuavin = parseMuavinSheet(muavin.rows);
const parsedYevmiye = parseYevmiyeSheet(yevmiye.rows);
const muavinSet = multiset(parsedMuavin);
const yevmiyeSet = multiset(parsedYevmiye);
const unicodeMuavin = parsedMuavin.filter((row) =>
  /[^\u0000-\u007f]/u.test(String(row.hesapKodu || ""))
);

assertExact(unicodeMuavin.length > 0, "unicodeEvidence");
assertExact(
  unicodeMuavin.every(
    (row) =>
      muavinSet.get(buildMuavinYevmiyeFingerprint(row)) ===
      yevmiyeSet.get(buildMuavinYevmiyeFingerprint(row))
  ),
  "unicodeFingerprintParity"
);

const result = runGenelMuhasebeKontrol({
  companyId: "local-real-file-gate",
  period: "2026/03",
  muavinSheetRows: muavin.rows,
  yevmiyeSheetRows: yevmiye.rows,
  mizanSheetRows: mizan.rows,
  accountPlanAccounts: [],
  accountPlanStatus: "missing",
});
const summary = result.summary || {};
const reconcile = summary.muavinYevmiye || {};
const counts = reconcile.counts || {};
const normalizedDates = (result.rows || [])
  .map((row) => String(row.tarih || ""))
  .filter(Boolean);
const findingsSnapshot = buildGenelMuhasebePresentationSnapshot({
  findingsCatalog: result.findingsCatalog,
  ledgerRows: result.rows,
  view: VOUCHER_RESULT_VIEW.FINDINGS,
});
const allSnapshot = buildGenelMuhasebePresentationSnapshot({
  findingsCatalog: result.findingsCatalog,
  ledgerRows: result.rows,
  view: VOUCHER_RESULT_VIEW.ALL,
});

assertExact(reconcile.matched === true, "muavinYevmiyeMatched");
assertExact(reconcile.matchedCount === 545, "matchedCount");
assertExact(reconcile.denominator === 545, "denominator");
assertExact(counts.onlyMuavin === 0, "onlyMuavin");
assertExact(counts.onlyYevmiye === 0, "onlyYevmiye");
assertExact(counts.amountDiff === 0, "amountDiff");
assertExact(counts.dateDiff === 0, "dateDiff");
assertExact(counts.fisDiff === 0, "fisDiff");
assertExact(counts.total === 0, "totalDifferences");
assertExact(summary.toplamFis === 115, "totalVouchers");
assertExact(summary.dengeliFis === 115, "balancedVouchers");
assertExact(summary.dengesizFis === 0, "unbalancedVouchers");
assertExact(summary.donemDisi === 0, "outOfPeriod");
assertExact(summary.mukerrer === 0, "duplicates");
assertExact(summary.borcAlacakFark === 0, "debitCreditDifference");
assertExact(summary.mizanMuavin?.matched === true, "mizanMuavinMatched");
assertExact(
  normalizedDates.every((date) => /^\d{2}\.\d{2}\.\d{4}$/.test(date)),
  "normalizedDateContract"
);
assertExact(result.counters?.persistInvocations === 0, "persistInvocations");
assertExact(findingsSnapshot.counts.findings === 94, "findingVouchers");
assertExact(findingsSnapshot.counts.appropriate === 21, "appropriateVouchers");
assertExact(findingsSnapshot.counts.total === 115, "presentationTotalVouchers");
assertExact(findingsSnapshot.visibleRows.length === 94, "defaultFindingRows");
assertExact(allSnapshot.visibleRows.length === 115, "allVoucherRows");
assertExact(
  findingsSnapshot.summary.overallSonuc !== "Uyarı" ||
    ["UYARI", "KRITIK", "HATA"].includes(
      findingsSnapshot.visibleRows[0]?.primarySeverity
    ),
  "warningFirst"
);

console.log(
  JSON.stringify(
    {
      status: "REAL_FILE_GATE_PASS",
      fingerprints: {
        muavin: muavin.sha256,
        yevmiye: yevmiye.sha256,
        mizan: mizan.sha256,
      },
      bytes: {
        muavin: muavin.bytes,
        yevmiye: yevmiye.bytes,
        mizan: mizan.bytes,
      },
      parsed: {
        muavin: result.parsedCounts?.muavin,
        yevmiye: result.parsedCounts?.yevmiye,
        mizan: result.parsedCounts?.mizan,
      },
      reconciliation: {
        matchedCount: reconcile.matchedCount,
        denominator: reconcile.denominator,
        onlyMuavin: counts.onlyMuavin,
        onlyYevmiye: counts.onlyYevmiye,
        amountDiff: counts.amountDiff,
        dateDiff: counts.dateDiff,
        fisDiff: counts.fisDiff,
      },
      vouchers: {
        total: summary.toplamFis,
        balanced: summary.dengeliFis,
        unbalanced: summary.dengesizFis,
        findings: findingsSnapshot.counts.findings,
        appropriate: findingsSnapshot.counts.appropriate,
        allRows: allSnapshot.visibleRows.length,
      },
      outOfPeriod: summary.donemDisi,
      duplicates: summary.mukerrer,
      debitCreditDifference: summary.borcAlacakFark,
      unicodeEvidenceCount: unicodeMuavin.length,
    },
    null,
    2
  )
);
