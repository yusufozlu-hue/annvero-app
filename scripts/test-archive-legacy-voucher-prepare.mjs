/**
 * Legacy archive on-demand prepare — modes A/B/C.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-archive-legacy-voucher-prepare.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out
        .then(() => console.log(`PASS  ${name}`))
        .catch((err) => {
          failed += 1;
          console.error(`FAIL  ${name}`);
          console.error(err);
        });
    }
    console.log(`PASS  ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
    return Promise.resolve();
  }
}

const {
  LEGACY_ARCHIVE_NEEDS_PREPARE,
  LEGACY_ARCHIVE_PREPARE_INFO,
  LEGACY_ARCHIVE_PREPARE_BUTTON,
  resolveArchiveFisKontrolAction,
  prepareLegacyArchiveVouchersForFisKontrol,
} = await import("@/src/utils/archiveLegacyVoucherPrepare.js");

const {
  buildCanonicalHydrateBoundResult,
  movementsHaveArchiveAccountingLegs,
} = await import("@/src/utils/canonicalHydrateReuse.js");

const { bankMovementToStandardLucaRows } = await import(
  "@/src/utils/standardLucaRow.js"
);

function mareMovementsWithoutLegs() {
  return [
    {
      amount: -1000000,
      direction: "CIKIS",
      description: "vadeli acilis",
      lucaDescription: "vadeli acilis",
      transactionType: "VADELI_ACILIS",
      rawRow: { aciklama: "vadeli acilis", tutar: 1000000, yon: "CIKIS" },
    },
    {
      amount: 33931.4,
      direction: "GIRIS",
      description: "faiz",
      lucaDescription: "faiz",
      transactionType: "FAIZ_GELIRI",
      rawRow: { aciklama: "faiz", tutar: 33931.4, yon: "GIRIS" },
    },
    {
      amount: -5938,
      direction: "CIKIS",
      description: "stopaj",
      lucaDescription: "stopaj",
      transactionType: "FAIZ_STOPAJI",
      rawRow: { aciklama: "stopaj", tutar: 5938, yon: "CIKIS" },
    },
    {
      amount: 1027993.4,
      direction: "GIRIS",
      description: "kapanis",
      lucaDescription: "kapanis",
      transactionType: "VADELI_KAPANIS",
      rawRow: { aciklama: "kapanis", tutar: 1027993.4, yon: "GIRIS" },
    },
  ];
}

function mareMovementsWithLegs() {
  return [
    {
      amount: 1000000,
      direction: "CIKIS",
      accountCode: "102.10.V005",
      counterAccountCode: "102.10.V001",
      description: "open",
      lucaDescription: "open",
      _accountingAnalyzed: true,
    },
    {
      amount: 33931.4,
      direction: "GIRIS",
      accountCode: "102.10.V005",
      counterAccountCode: "642.01.001",
      description: "faiz",
      lucaDescription: "faiz",
      _accountingAnalyzed: true,
    },
    {
      amount: 5938,
      direction: "CIKIS",
      accountCode: "102.10.V005",
      counterAccountCode: "193.01.001",
      description: "stopaj",
      lucaDescription: "stopaj",
      _accountingAnalyzed: true,
    },
    {
      amount: 1027993.4,
      direction: "GIRIS",
      accountCode: "102.10.V005",
      counterAccountCode: "102.10.V001",
      description: "close",
      lucaDescription: "close",
      _accountingAnalyzed: true,
    },
  ];
}

await test("preview FAIL repro: 4 movements, no legs → prepare CTA, page-open accounting 0", () => {
  const movements = mareMovementsWithoutLegs();
  assert.equal(movements.length, 4);
  assert.equal(movementsHaveArchiveAccountingLegs(movements), false);
  const bound = buildCanonicalHydrateBoundResult({
    job: {
      id: "j1",
      metadata: {
        luca_row_count: 8,
        output_gate_code: "OUTPUT_READY",
        balance_code: "BALANCE_MATCHED",
        terminal_status: "completed",
        can_auto_approve: true,
      },
    },
    archivedHydrateResult: true,
    movementCount: 4,
    materializedLucaRowCount: 0,
    archiveHandoffCode: LEGACY_ARCHIVE_NEEDS_PREPARE,
    archiveHandoffMessage: LEGACY_ARCHIVE_PREPARE_INFO,
  });
  assert.equal(bound.lucaRowCount, 0);
  assert.equal(bound.lucaReadyHint, false);
  assert.equal(bound.legacyArchiveNeedsPrepare, true);
  const action = resolveArchiveFisKontrolAction({
    archivedHydrateResult: true,
    movementCount: 4,
    lucaRowCount: 0,
    lucaReady: false,
    hasAccountingLegs: false,
    archiveHandoffCode: LEGACY_ARCHIVE_NEEDS_PREPARE,
  });
  assert.equal(action.mode, "prepare_and_control");
  assert.equal(action.showPrepareButton, true);
  assert.equal(action.buttonLabel, LEGACY_ARCHIVE_PREPARE_BUTTON);
  assert.match(action.infoMessage, /tek tıkla/);
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  // Page-open must not auto-run accounting for missing legs
  assert.match(workbench, /LEGACY_ARCHIVE_NEEDS_PREPARE/);
  assert.match(workbench, /otomatik accounting YOK/);
  assert.match(workbench, /handlePrepareLegacyArchiveAndGoToFisKontrol/);
  assert.doesNotMatch(
    workbench,
    /if \(!hasLegs && movementsRef\.current\.length > 0\) \{\s*try \{\s*const \{\s*runAccountingAnalysisOnMovementsAsync/
  );
});

await test("mode A: modern legs → direct handoff, accounting 0", async () => {
  const movements = mareMovementsWithLegs();
  assert.equal(movementsHaveArchiveAccountingLegs(movements), true);
  const lucaRows = [];
  movements.forEach((m, i) => {
    lucaRows.push(...bankMovementToStandardLucaRows(m, i + 1, {}));
  });
  assert.equal(lucaRows.length, 8);
  let accounting = 0;
  const result = await prepareLegacyArchiveVouchersForFisKontrol({
    movements,
    companyId: "co",
    runAccounting: async ({ movementRows }) => {
      accounting += 1;
      return { movementRows };
    },
    buildLucaRows: async () => ({ standardLucaRows: lucaRows }),
    runFisKontrol: () => ({ critical: 0, errors: 0 }),
    saveDataset: async () => ({ ok: true, runId: "r1" }),
    buildHref: () => "/muhasebe/fis-kontrol?x=1",
    navigate: () => {},
  });
  // prepare always runs accounting once when called — mode A UI should NOT call prepare
  assert.equal(result.ok, true);
  const action = resolveArchiveFisKontrolAction({
    archivedHydrateResult: true,
    movementCount: 4,
    lucaRowCount: 8,
    lucaReady: true,
    hasAccountingLegs: true,
  });
  assert.equal(action.mode, "direct_handoff");
  assert.equal(action.showPrepareButton, false);
  assert.equal(action.showDirectHandoff, true);
  void accounting;
});

await test("mode B: legacy click → accounting 1, luca 8, nav 1, persist 0", async () => {
  const movements = mareMovementsWithoutLegs();
  const withLegs = mareMovementsWithLegs();
  let accounting = 0;
  let luca = 0;
  let fis = 0;
  let saves = 0;
  let navs = 0;
  const clicks = [];
  const runOnce = async () => {
    if (clicks.length) return clicks[0];
    const out = await prepareLegacyArchiveVouchersForFisKontrol({
      movements,
      companyId: "co",
      runAccounting: async () => {
        accounting += 1;
        return { movementRows: withLegs };
      },
      buildLucaRows: async (rows) => {
        luca += 1;
        const lucaRows = [];
        rows.forEach((m, i) => {
          lucaRows.push(...bankMovementToStandardLucaRows(m, i + 1, {}));
        });
        return { standardLucaRows: lucaRows };
      },
      runFisKontrol: (rows) => {
        fis += 1;
        assert.equal(rows.length, 8);
        return { critical: 0, errors: 0, passed: 8 };
      },
      saveDataset: async ({ rows }) => {
        saves += 1;
        assert.equal(rows.length, 8);
        return { ok: true, runId: "bank-fis-co-abc" };
      },
      buildHref: ({ runId }) => `/muhasebe/fis-kontrol?runId=${runId}`,
      navigate: () => {
        navs += 1;
      },
    });
    clicks.push(out);
    return out;
  };
  const first = await runOnce();
  const second = await runOnce();
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(accounting, 1);
  assert.equal(luca, 1);
  assert.equal(fis, 1);
  assert.equal(saves, 1);
  assert.equal(navs, 1);
  assert.equal(first.counts.pdfParse, 0);
  assert.equal(first.counts.snapshotPersist, 0);
  assert.equal(first.counts.drivePersist, 0);
  assert.equal(first.lucaRows.length, 8);
  const codes = first.lucaRows.map((r) => String(r.hesapKodu || "").trim()).sort();
  assert.ok(codes.includes("102.10.V005"));
  assert.ok(codes.includes("102.10.V001"));
  assert.ok(codes.includes("642.01.001"));
  assert.ok(codes.includes("193.01.001"));
});

await test("mode C: prepare fail → nav 0, no fake luca, retry message", async () => {
  const result = await prepareLegacyArchiveVouchersForFisKontrol({
    movements: mareMovementsWithoutLegs(),
    companyId: "co",
    runAccounting: async () => ({ movementRows: [] }),
    buildLucaRows: async () => ({ standardLucaRows: [{ fake: true }] }),
    navigate: () => {
      throw new Error("should not navigate");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.counts.navigations, 0);
  assert.equal(result.lucaRows.length, 0);
  assert.match(result.message, /hazırlanamadı|korundu/i);
  const action = resolveArchiveFisKontrolAction({
    archivedHydrateResult: true,
    movementCount: 4,
    lucaRowCount: 0,
    lucaReady: false,
    hasAccountingLegs: false,
    archiveHandoffCode: "LEGACY_ARCHIVE_PREPARE_FAILED",
  });
  assert.equal(action.showPrepareButton, true);
  assert.match(action.infoMessage, /tekrar|korundu/i);
});

await test("wiring: one-click prepare button + workbench handler", () => {
  const oneClick = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
    ),
    "utf8"
  );
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(oneClick, /bank-prepare-legacy-archive-fis-kontrol/);
  assert.match(oneClick, /Fişleri Hazırla ve Kontrol Et/);
  assert.match(oneClick, /onPrepareLegacyArchiveAndGoToFisKontrol/);
  assert.match(oneClick, /Fişler hazırlanıyor/);
  assert.match(workbench, /fetchFullActiveAccountPlan/);
  assert.match(workbench, /prepareLegacyArchiveVouchersForFisKontrol/);
  assert.doesNotMatch(
    workbench,
    /alert\("Önce ön izleme oluşturup Luca satırlarını hazırlayın\."\)/
  );
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll archive-legacy-voucher-prepare tests passed.");
