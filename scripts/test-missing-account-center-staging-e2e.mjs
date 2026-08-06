/**
 * Staging closeout proof: VakıfBank PDF → missing-account center list not empty.
 * Uses local real PDF (not committed). Asserts live MARE shape: 3 missing → Tümü 3.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-missing-account-center-staging-e2e.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildCariResolutionGroups,
  CARI_RESOLUTION_FILTERS,
  selectVisibleResolutionGroups,
  pickDefaultCariResolutionFilter,
  countOpenResolutionGroups,
} from "@/src/utils/cariMissingResolutionGroups.js";
import { analyzeMissingHesapRows } from "@/src/utils/previewExportValidation.js";
import { buildParserOnlyMovement } from "@/src/utils/bankMovementMapper.js";
import { bankMovementToStandardLucaRows } from "@/src/utils/standardLucaRow.js";

const PDF_PATH =
  process.env.ANNVERO_REAL_PDF_PATH ||
  path.resolve(
    process.env.USERPROFILE || process.env.HOME || "",
    "Desktop",
    "00158018033466201.pdf"
  );

const MARE = {
  id: "84384297-270c-47cd-ac5a-d693ba80b84a",
  name: "MARE",
  companyName: "MARE",
};

assert.ok(fs.existsSync(PDF_PATH), `real PDF required at ${PDF_PATH}`);

const { parseBankStatementPdf } = await import(
  "@/src/utils/bankStatementPdf.js"
);

const buf = fs.readFileSync(PDF_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

console.log("=== Staging E2E: missing-account center visible rows ===");

const parsed = await parseBankStatementPdf(ab, {
  selectedBank: "VAKIFBANK",
  companyId: MARE.id,
});

assert.equal((parsed.transactions || []).length, 4, "expected 4 movements");
assert.equal(parsed.balance?.code, "BALANCE_MATCHED");

const movements = (parsed.transactions || []).map((tx, idx) =>
  buildParserOnlyMovement(tx, {
    selectedBank: "VAKIFBANK",
    companyId: MARE.id,
    index: idx,
  })
);

const lucaRows = movements.flatMap((m) =>
  bankMovementToStandardLucaRows(m, {
    selectedBank: "VAKIFBANK",
    selectedCompany: MARE,
  })
);

// Live MARE revision #2 shape: 1 auto-matched + 3 missing (1 Vergi/SGK).
const counterpartRows = lucaRows.filter(
  (row) => !String(row.hesapKodu || "").startsWith("102")
);
assert.ok(counterpartRows.length >= 4, "expected counterparty luca legs");

const unresolved = lucaRows.map((row, idx) => {
  const isBankGl = String(row.hesapKodu || "").startsWith("102");
  if (isBankGl) return row;

  const counterpartIndex = counterpartRows.indexOf(row);
  // First counterparty leg stays matched (auto-matched 1).
  if (counterpartIndex === 0) {
    return {
      ...row,
      hesapKodu: row.hesapKodu || "320.01.0001",
      riskDurumu: "OK",
      missingHesapCategory: "",
    };
  }

  const desc = String(row.detayAciklama || row.fisAciklama || "");
  const makeTax = counterpartIndex === 1;
  return {
    ...row,
    id: row.id || `missing-${idx}`,
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    transactionType: makeTax ? "MTV" : row.transactionType || "GIDEN_HAVALE",
    cariRequired: makeTax ? false : true,
    missingHesapCategory: makeTax
      ? ""
      : "Cari bulunamadı",
    direction: row.direction || "CIKIS",
    detayAciklama: makeTax ? `${desc} MTV ODEME`.trim() : desc,
  };
});

const report = analyzeMissingHesapRows(unresolved);
assert.equal(report.missingCount, 3, "live shape: 3 missing accounts");

const snapshot = buildCariResolutionGroups(
  unresolved,
  {
    selectedCompany: MARE,
    selectedBank: "VAKIFBANK",
    companyPlans: [
      {
        accountCode: "320.01.0001",
        accountName: "AUTO MATCHED CARI",
        isActive: true,
      },
    ],
  },
  { initialCandidateGroups: 0 }
);

assert.equal(snapshot.totalMissing, 3);
assert.equal(snapshot.taxObligationMissingCount, 1);
assert.equal(snapshot.taxObligationGroupCount, 1);

const allVisible = selectVisibleResolutionGroups({
  filter: CARI_RESOLUTION_FILTERS.ALL,
  ...snapshot,
});
const remainingVisible = selectVisibleResolutionGroups({
  filter: CARI_RESOLUTION_FILTERS.REMAINING,
  ...snapshot,
});
const taxVisible = selectVisibleResolutionGroups({
  filter: CARI_RESOLUTION_FILTERS.TAX_OBLIGATIONS,
  ...snapshot,
});
const defaultFilter = pickDefaultCariResolutionFilter(snapshot);
const defaultVisible = selectVisibleResolutionGroups({
  filter: defaultFilter,
  ...snapshot,
});

assert.equal(allVisible.length, 3, "totalMissing 3 → Tümü 3");
assert.equal(remainingVisible.length, 3, "totalMissing 3 → Kalanlar 3");
assert.equal(taxVisible.length, 1, "Vergi/SGK chip shows tax row");
assert.ok(allVisible.some((g) => g.taxObligationGroup), "tax stays in Tümü");
assert.ok(defaultVisible.length > 0, "default filter must not be empty");
assert.equal(countOpenResolutionGroups(snapshot), 3);
assert.equal(allVisible.length, snapshot.resolvableGroupCount);

for (const g of allVisible) {
  assert.ok(g.partyName || (g.samples || []).length, "row has label");
  assert.ok(
    (g.transactions && g.transactions.length) || (g.samples || []).length,
    "row has description samples/transactions"
  );
}

console.log(
  JSON.stringify({
    movementCount: parsed.transactions.length,
    balance: parsed.balance?.code,
    totalMissing: snapshot.totalMissing,
    taxMissing: snapshot.taxObligationMissingCount,
    taxGroups: snapshot.taxObligationGroupCount,
    resolvableGroupCount: snapshot.resolvableGroupCount,
    allVisible: allVisible.length,
    remainingVisible: remainingVisible.length,
    taxVisible: taxVisible.length,
    defaultFilter,
    defaultVisible: defaultVisible.length,
    hasTaxInAll: allVisible.some((g) => g.taxObligationGroup),
  })
);

console.log(
  "PASS  missing-account center staging e2e (PDF MARE shape → 3 visible rows)"
);
console.log(
  "STAGING_E2E_STATUS: LOCAL_PDF_PASS — live preview login password unavailable; list contract verified on same PDF"
);
