/**
 * Banka Parser → Fiş Kontrol handoff + MARE anonymous fixture.
 * FAIL (eski): Fiş Kontrol’e Git yalnız router.push(companyId) — satır yazılmaz.
 * PASS (yeni): saveLucaTransferDataset + content fingerprint runId + tenant clear.
 *
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-fis-kontrol-handoff.mjs
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
  analyzeStandardLucaRows,
  groupLucaFisBatches,
  buildPassedExportPayload,
  filterPassedRowsForExport,
  LUCA_FIS_GROUP_SIZE,
  KONTROL_DURUM,
  KONTROL_TIP,
} = await import("@/src/utils/fisKontrolMerkezi.js");

const {
  buildStandardLucaTransferPayload,
  KAYNAK_TIPI,
} = await import("@/src/utils/standardLucaRow.js");

const {
  buildLucaTransferContentFingerprint,
  buildFisKontrolTransferHref,
  buildLucaTransferStorageKey,
  assertLucaTransferHydrateBinding,
  LUCA_TRANSFER_SCHEMA_VERSION,
  LUCA_TRANSFER_TTL_MS,
} = await import("@/src/utils/companyCenter.js");

const {
  runVoucherControlStage,
} = await import("@/src/utils/annveroV1Orchestration.js");

const COMPANY_A = "co-alpha-fis";
const COMPANY_B = "co-beta-fis";
const V001 = "102.10.V001";
const V005 = "102.10.V005";
const FAIZ = "642.01.001";
const STOPAJ = "193.01.001";

function lucaRow(overrides = {}) {
  return {
    fisTarihi: "15.01.2026",
    fisNo: "1",
    evrakNo: "EV-1",
    hesapKodu: V005,
    borc: "",
    alacak: "",
    detayAciklama: "anon-row",
    fisAciklama: "anon-fis",
    belgeTuru: "DK",
    firmaId: COMPANY_A,
    kaynakTipi: KAYNAK_TIPI.BANKA,
    kaynakAdi: "VAKIFBANK",
    sourceMovementId: "m1",
    ...overrides,
  };
}

/** Anonim MARE lifecycle: 4 hareket → 8 Luca satırı / 4 dengeli fiş */
function mareAnonymousRows() {
  return [
    lucaRow({
      fisNo: "1",
      sourceMovementId: "open",
      hesapKodu: V005,
      borc: 1000000,
      alacak: "",
      detayAciklama: "acilis-borc",
      evrakNo: "EV-open-a",
    }),
    lucaRow({
      fisNo: "1",
      sourceMovementId: "open",
      hesapKodu: V001,
      borc: "",
      alacak: 1000000,
      detayAciklama: "acilis-alacak",
      evrakNo: "EV-open-b",
    }),
    lucaRow({
      fisNo: "2",
      sourceMovementId: "faiz",
      hesapKodu: V005,
      borc: 33931.4,
      alacak: "",
      detayAciklama: "faiz-borc",
      evrakNo: "EV-faiz-a",
    }),
    lucaRow({
      fisNo: "2",
      sourceMovementId: "faiz",
      hesapKodu: FAIZ,
      borc: "",
      alacak: 33931.4,
      detayAciklama: "faiz-alacak",
      evrakNo: "EV-faiz-b",
    }),
    lucaRow({
      fisNo: "3",
      sourceMovementId: "stopaj",
      hesapKodu: STOPAJ,
      borc: 5938,
      alacak: "",
      detayAciklama: "stopaj-borc",
      evrakNo: "EV-stop-a",
    }),
    lucaRow({
      fisNo: "3",
      sourceMovementId: "stopaj",
      hesapKodu: V005,
      borc: "",
      alacak: 5938,
      detayAciklama: "stopaj-alacak",
      evrakNo: "EV-stop-b",
    }),
    lucaRow({
      fisNo: "4",
      sourceMovementId: "close",
      hesapKodu: V001,
      borc: 1027993.4,
      alacak: "",
      detayAciklama: "kapanis-borc",
      evrakNo: "EV-close-a",
    }),
    lucaRow({
      fisNo: "4",
      sourceMovementId: "close",
      hesapKodu: V005,
      borc: "",
      alacak: 1027993.4,
      detayAciklama: "kapanis-alacak",
      evrakNo: "EV-close-b",
    }),
  ];
}

await test("eski FAIL: workbench yalnız router.push ile satır yazmıyordu", () => {
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(workbench, /handleGoToFisKontrol/);
  assert.match(workbench, /saveLucaTransferDataset/);
  assert.match(workbench, /buildLucaTransferContentFingerprint/);
  assert.match(workbench, /buildFisKontrolTransferHref/);
  assert.doesNotMatch(
    workbench,
    /onGoToFisKontrol=\{\(\)\s*=>\s*\{\s*if \(pipelineResult\?\.fisKontrolHref\)/
  );
});

await test("wiring: Fiş Kontrol page IndexedDB hydrate + tenant clear", () => {
  const page = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/fis-kontrol/page.jsx"),
    "utf8"
  );
  assert.match(page, /loadLucaTransferDataset/);
  assert.match(page, /assertLucaTransferHydrateBinding/);
  assert.match(page, /clearPendingLucaRows/);
  assert.match(page, /clearAllLucaTransferDatasets/);
  assert.match(page, /strictBinding:\s*true/);
  assert.match(page, /useSearchParams/);
  assert.match(page, /hydrateEmptyMessage/);
  assert.match(page, /SIGNED_OUT/);
  assert.doesNotMatch(page, /console\.(log|debug|info)\([^)]*rows/);
  assert.doesNotMatch(page, /console\.(log|debug|info)\([^)]*transferred/);
});

await test("binding: Firma A dataset + Firma B aktif → reject before render", () => {
  const rows = mareAnonymousRows();
  const dataset = {
    schemaVersion: LUCA_TRANSFER_SCHEMA_VERSION,
    companyId: COMPANY_A,
    source: "bank",
    sourceId: "src-a",
    runId: "run-a",
    authUserId: "user-1",
    contentFingerprint: buildLucaTransferContentFingerprint(rows),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + LUCA_TRANSFER_TTL_MS).toISOString(),
    rows,
  };
  const reject = assertLucaTransferHydrateBinding({
    dataset,
    activeCompanyId: COMPANY_B,
    urlCompanyId: COMPANY_A,
    urlRunId: "run-a",
    authUserId: "user-1",
    expectedSource: "bank",
  });
  assert.equal(reject.ok, false);
  assert.equal(reject.code, "COMPANY_MISMATCH");
  assert.equal(reject.cleanup, true);
});

await test("binding: URL companyId manipülasyonu → reject", () => {
  const rows = mareAnonymousRows();
  const dataset = {
    schemaVersion: LUCA_TRANSFER_SCHEMA_VERSION,
    companyId: COMPANY_A,
    source: "bank",
    runId: "run-a",
    authUserId: "user-1",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    rows,
  };
  const reject = assertLucaTransferHydrateBinding({
    dataset,
    activeCompanyId: COMPANY_A,
    urlCompanyId: COMPANY_B,
    urlRunId: "run-a",
    authUserId: "user-1",
  });
  assert.equal(reject.ok, false);
  assert.equal(reject.code, "URL_COMPANY_MISMATCH");
});

await test("binding: runId manipülasyonu → reject", () => {
  const rows = mareAnonymousRows();
  const dataset = {
    schemaVersion: LUCA_TRANSFER_SCHEMA_VERSION,
    companyId: COMPANY_A,
    source: "bank",
    runId: "run-real",
    authUserId: "user-1",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    rows,
  };
  const reject = assertLucaTransferHydrateBinding({
    dataset,
    activeCompanyId: COMPANY_A,
    urlCompanyId: COMPANY_A,
    urlRunId: "run-tampered",
    authUserId: "user-1",
  });
  assert.equal(reject.ok, false);
  assert.equal(reject.code, "RUN_ID_MISMATCH");
});

await test("binding: logout sonrası başka kullanıcı → AUTH_USER_MISMATCH", () => {
  const rows = mareAnonymousRows();
  const dataset = {
    schemaVersion: LUCA_TRANSFER_SCHEMA_VERSION,
    companyId: COMPANY_A,
    source: "bank",
    runId: "run-a",
    authUserId: "user-old",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    rows,
  };
  const reject = assertLucaTransferHydrateBinding({
    dataset,
    activeCompanyId: COMPANY_A,
    urlCompanyId: COMPANY_A,
    urlRunId: "run-a",
    authUserId: "user-new",
  });
  assert.equal(reject.ok, false);
  assert.equal(reject.code, "AUTH_USER_MISMATCH");
});

await test("binding: expired dataset → reject + cleanup", () => {
  const rows = mareAnonymousRows();
  const dataset = {
    schemaVersion: LUCA_TRANSFER_SCHEMA_VERSION,
    companyId: COMPANY_A,
    source: "bank",
    runId: "run-a",
    authUserId: "user-1",
    createdAt: new Date(Date.now() - LUCA_TRANSFER_TTL_MS - 1000).toISOString(),
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    rows,
  };
  const reject = assertLucaTransferHydrateBinding({
    dataset,
    activeCompanyId: COMPANY_A,
    urlCompanyId: COMPANY_A,
    urlRunId: "run-a",
    authUserId: "user-1",
  });
  assert.equal(reject.ok, false);
  assert.equal(reject.code, "EXPIRED");
  assert.equal(reject.cleanup, true);
});

await test("binding: malformed dataset → reject", () => {
  assert.equal(
    assertLucaTransferHydrateBinding({
      dataset: { schemaVersion: 2, companyId: COMPANY_A, rows: "nope" },
      activeCompanyId: COMPANY_A,
      authUserId: "user-1",
    }).code,
    "MALFORMED"
  );
  assert.equal(
    assertLucaTransferHydrateBinding({
      dataset: null,
      activeCompanyId: COMPANY_A,
      authUserId: "user-1",
    }).code,
    "MALFORMED"
  );
});

await test("binding: aynı kullanıcı + aynı firma + doğru runId → PASS", () => {
  const rows = mareAnonymousRows();
  const fp = buildLucaTransferContentFingerprint(rows);
  const dataset = {
    schemaVersion: LUCA_TRANSFER_SCHEMA_VERSION,
    companyId: COMPANY_A,
    source: "bank",
    sourceId: "src-1",
    runId: "run-ok",
    authUserId: "user-1",
    contentFingerprint: fp,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + LUCA_TRANSFER_TTL_MS).toISOString(),
    rows,
  };
  const pass = assertLucaTransferHydrateBinding({
    dataset,
    activeCompanyId: COMPANY_A,
    urlCompanyId: COMPANY_A,
    urlRunId: "run-ok",
    authUserId: "user-1",
    expectedSource: "bank",
    expectedSourceId: "src-1",
    expectedContentFingerprint: fp,
  });
  assert.equal(pass.ok, true);
  assert.equal(pass.code, "BINDING_OK");
});

await test("workbench authUserId + sourceId handoff zorunlu", () => {
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(workbench, /resolveAuthUserIdForTransfer/);
  assert.match(workbench, /payload\.authUserId/);
  assert.match(workbench, /payload\.contentFingerprint/);
  assert.match(workbench, /payload\.sourceId/);
});

await test("MARE anonim: 4 fiş / 8 satır dengeli → Geçti", () => {
  const rows = mareAnonymousRows();
  assert.equal(rows.length, 8);
  const t0 = Date.now();
  const analysis = analyzeStandardLucaRows(rows, { firmaId: COMPANY_A });
  const ms = Date.now() - t0;
  assert.equal(analysis.summary.totalFis, 4);
  assert.equal(analysis.summary.totalRows || analysis.rows.length, 8);
  const hata = analysis.issues.filter((i) => i.seviye === "Hata");
  assert.equal(hata.length, 0, `beklenmeyen hata: ${hata.map((i) => i.message).join("; ")}`);
  const gecti = analysis.rows.filter(
    (r) => r._kontrol?.kontrolDurumu === KONTROL_DURUM.GECTI
  );
  assert.equal(gecti.length, 8);
  // yönler
  const byFis = Object.fromEntries(
    [1, 2, 3, 4].map((n) => [
      n,
      rows.filter((r) => String(r.fisNo) === String(n)).map((r) => r.hesapKodu),
    ])
  );
  assert.deepEqual(byFis[1].sort(), [V001, V005].sort());
  assert.ok(byFis[2].includes(FAIZ) && byFis[2].includes(V005));
  assert.ok(byFis[3].includes(STOPAJ) && byFis[3].includes(V005));
  assert.deepEqual(byFis[4].sort(), [V001, V005].sort());
  assert.ok(ms < 500, `4/8 kontrol süresi yüksek: ${ms}ms`);
  console.log(`  timing 4fis/8rows: ${ms}ms`);
});

await test("content fingerprint aynı satırda stabil; farklı satırda değişir", () => {
  const a = mareAnonymousRows();
  const b = mareAnonymousRows();
  const c = mareAnonymousRows();
  c[0].borc = 1;
  assert.equal(
    buildLucaTransferContentFingerprint(a),
    buildLucaTransferContentFingerprint(b)
  );
  assert.notEqual(
    buildLucaTransferContentFingerprint(a),
    buildLucaTransferContentFingerprint(c)
  );
  const runA = `bank-fis-${COMPANY_A.slice(0, 8)}-${buildLucaTransferContentFingerprint(a)}`;
  const runB = `bank-fis-${COMPANY_A.slice(0, 8)}-${buildLucaTransferContentFingerprint(b)}`;
  assert.equal(runA, runB);
  assert.equal(
    buildLucaTransferStorageKey("bank", COMPANY_A, runA),
    buildLucaTransferStorageKey("bank", COMPANY_A, runB)
  );
});

await test("ikinci aktarım aynı anahtar — mükerrer satır üretilmez", () => {
  const rows = mareAnonymousRows();
  const fp = buildLucaTransferContentFingerprint(rows);
  const p1 = buildStandardLucaTransferPayload({
    firmaId: COMPANY_A,
    companyName: "Alpha",
    kaynakTipi: KAYNAK_TIPI.BANKA,
    kaynakAdi: "VAKIFBANK",
    source: "bank",
    runId: `bank-fis-${COMPANY_A.slice(0, 8)}-${fp}`,
    movementCount: 4,
    rows,
  });
  const p2 = buildStandardLucaTransferPayload({
    firmaId: COMPANY_A,
    companyName: "Alpha",
    kaynakTipi: KAYNAK_TIPI.BANKA,
    kaynakAdi: "VAKIFBANK",
    source: "bank",
    runId: `bank-fis-${COMPANY_A.slice(0, 8)}-${fp}`,
    movementCount: 4,
    rows,
  });
  assert.equal(p1.runId, p2.runId);
  assert.equal(p1.rows.length, 8);
  assert.equal(p2.rows.length, 8);
  const once = analyzeStandardLucaRows(p1.rows, { firmaId: COMPANY_A });
  assert.equal(once.summary.totalFis, 4);
  assert.equal(once.rows.length, 8);
});

await test("tenant: Firma A satırları Firma B analizi HATA", () => {
  const rows = mareAnonymousRows();
  const foreign = analyzeStandardLucaRows(rows, { firmaId: COMPANY_B });
  assert.ok(
    foreign.issues.some((i) => /başka firmaya|firma/i.test(i.message || "")),
    "tenant mismatch issue beklenirdi"
  );
  const hrefA = buildFisKontrolTransferHref({
    companyId: COMPANY_A,
    runId: "r1",
    source: "bank",
  });
  const hrefB = buildFisKontrolTransferHref({
    companyId: COMPANY_B,
    runId: "r1",
    source: "bank",
  });
  assert.match(hrefA, /companyId=co-alpha-fis/);
  assert.match(hrefB, /companyId=co-beta-fis/);
  assert.notEqual(hrefA, hrefB);
});

await test("tam 50 fiş kabul; 51+ sessiz kırpma yok, batch görünür", () => {
  const makeN = (n) => {
    const many = [];
    for (let i = 1; i <= n; i += 1) {
      many.push(
        lucaRow({
          fisNo: String(i),
          borc: 1,
          alacak: "",
          hesapKodu: V005,
          sourceMovementId: `m-${i}`,
          detayAciklama: `d-${i}-a`,
          evrakNo: `E-${i}-a`,
        })
      );
      many.push(
        lucaRow({
          fisNo: String(i),
          borc: "",
          alacak: 1,
          hesapKodu: V001,
          sourceMovementId: `m-${i}`,
          detayAciklama: `d-${i}-b`,
          evrakNo: `E-${i}-b`,
        })
      );
    }
    return many;
  };

  const exact50 = analyzeStandardLucaRows(makeN(50), { firmaId: COMPANY_A });
  assert.equal(exact50.summary.totalFis, 50);
  assert.equal(
    exact50.issues.filter((i) => i.type === KONTROL_TIP.LUCA_GRUP_50).length,
    0
  );

  const t0 = Date.now();
  const over = analyzeStandardLucaRows(makeN(52), { firmaId: COMPANY_A });
  const ms = Date.now() - t0;
  assert.equal(over.summary.totalFis, 52, "52 fiş sessiz kırpılmamalı");
  assert.equal(over.rows.length, 104);
  assert.ok(
    over.issues.some((i) => i.type === KONTROL_TIP.LUCA_GRUP_50),
    "51+ için görünür LUCA_GRUP_50 bilgisi"
  );
  const batches = groupLucaFisBatches(
    filterPassedRowsForExport(over),
    LUCA_FIS_GROUP_SIZE
  );
  assert.equal(batches.length, 2);
  // Aynı fişin borç/alacak satırları aynı batch'te
  for (const batch of batches) {
    const byFis = new Map();
    for (const row of batch) {
      const k = String(row.fisNo);
      byFis.set(k, (byFis.get(k) || 0) + 1);
    }
    for (const [, count] of byFis) {
      assert.equal(count, 2, "fiş ortadan bölünmemeli");
    }
  }
  const exportPayload = buildPassedExportPayload(over, { firmaId: COMPANY_A });
  assert.ok(exportPayload.ok);
  assert.equal(exportPayload.batches.length, 2);
  console.log(`  timing 52fis: ${ms}ms`);
  assert.ok(ms < 2000, `52 fiş kontrol süresi yüksek: ${ms}ms`);
});

await test("runVoucherControlStage ortak motor + href source=bank", () => {
  const rows = mareAnonymousRows();
  const stage = runVoucherControlStage(rows, { companyId: COMPANY_A });
  assert.equal(stage.passed, 8);
  assert.equal(stage.errors, 0);
  assert.match(stage.fisKontrolHref, /source=bank/);
  assert.match(stage.fisKontrolHref, /companyId=/);
  assert.equal(stage.lucaGroupSize, 50);
});

await test("click-lock UI wiring", () => {
  const oneClick = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
    ),
    "utf8"
  );
  assert.match(oneClick, /isNavigatingToFisKontrol/);
  assert.match(oneClick, /bank-go-to-fis-kontrol/);
  assert.match(oneClick, /Fiş Kontrol’e aktarılıyor/);
  assert.match(oneClick, /result\.lucaRowCount/);
});

await test("archive hydrate: meta-only lucaReady must not enable handoff", () => {
  const workbench = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(workbench, /materializedLucaRowCount/);
  assert.match(workbench, /LEGACY_ARCHIVE_NEEDS_PREPARE/);
  assert.match(workbench, /handlePrepareLegacyArchiveAndGoToFisKontrol/);
  assert.match(workbench, /otomatik accounting YOK/);
  assert.doesNotMatch(
    workbench,
    /alert\("Önce ön izleme oluşturup Luca satırlarını hazırlayın\."\)/
  );
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll bank-fis-kontrol-handoff tests passed.");
