/**
 * Staging closeout proof: VakıfBank PDF → missing-account center list not empty.
 * Uses local real PDF (not committed). Asserts Tümü shows every missing row group.
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

// Simulate unresolved counterparties (no plan match) while keeping tax/POS types.
const unresolved = lucaRows.map((row) => {
  const isBankGl = String(row.hesapKodu || "").startsWith("102");
  if (isBankGl) return row;
  return {
    ...row,
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    missingHesapCategory:
      row.missingHesapCategory ||
      (String(row.transactionType || "").includes("MTV") ||
      /VERGI|SGK|MTV|KDV/i.test(String(row.detayAciklama || ""))
        ? "Vergi/SGK türü çözülemedi"
        : "Cari bulunamadı"),
  };
});

const report = analyzeMissingHesapRows(unresolved);
assert.ok(report.missingCount >= 1, "expected missing hesap rows");

const snapshot = buildCariResolutionGroups(
  unresolved,
  {
    selectedCompany: MARE,
    selectedBank: "VAKIFBANK",
    companyPlans: [],
  },
  { initialCandidateGroups: 0 }
);

const allVisible = selectVisibleResolutionGroups({
  filter: CARI_RESOLUTION_FILTERS.ALL,
  ...snapshot,
});
const remainingVisible = selectVisibleResolutionGroups({
  filter: CARI_RESOLUTION_FILTERS.REMAINING,
  ...snapshot,
});
const defaultFilter = pickDefaultCariResolutionFilter(snapshot);
const defaultVisible = selectVisibleResolutionGroups({
  filter: defaultFilter,
  ...snapshot,
});

assert.equal(
  allVisible.length,
  snapshot.resolvableGroupCount,
  "Tümü must list every resolvable group"
);
assert.ok(allVisible.length >= 1, "Tümü must not be empty when missing>0");
assert.equal(remainingVisible.length, countOpenResolutionGroups(snapshot));
assert.ok(defaultVisible.length > 0, "default filter must not be empty");
assert.ok(
  snapshot.totalMissing === 0 || allVisible.length > 0,
  "counter/list mismatch forbidden"
);

// MARE live shape target: when 3 missing exist, Tümü shows 3.
if (snapshot.totalMissing === 3) {
  assert.equal(allVisible.length, 3, "totalMissing 3 → Tümü 3");
  assert.equal(remainingVisible.length, 3, "totalMissing 3 → Kalanlar 3");
}

console.log(
  JSON.stringify({
    movementCount: parsed.transactions.length,
    lucaRows: lucaRows.length,
    totalMissing: snapshot.totalMissing,
    taxMissing: snapshot.taxObligationMissingCount,
    taxGroups: snapshot.taxObligationGroupCount,
    cariGroups: snapshot.groupCount,
    resolvableGroupCount: snapshot.resolvableGroupCount,
    allVisible: allVisible.length,
    remainingVisible: remainingVisible.length,
    defaultFilter,
    defaultVisible: defaultVisible.length,
    partyNames: allVisible.map((g) => g.partyName),
  })
);

console.log("PASS  missing-account center staging e2e (PDF → visible groups)");
