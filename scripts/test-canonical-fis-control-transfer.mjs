/**
 * Faz 6 — Canonical Fiş Kontrol transfer queue.
 * Run: node --import ./scripts/_alias-loader.mjs --test ./scripts/test-canonical-fis-control-transfer.mjs
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const store = new Map();
const localStorageMock = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.localStorage = localStorageMock;
globalThis.window = {
  localStorage: localStorageMock,
};

const {
  __resetCanonicalTransferTestState,
  __listCanonicalTransferMemory,
  buildCanonicalTransferSnapshot,
  buildDeterministicRunIdentity,
  writeCanonicalTransferSnapshot,
  readCanonicalTransferSnapshot,
  publishBankParserTransfer,
  publishArchivePrepareTransfer,
  publishLucaProducerTransfer,
  publishElektrawebLucaTransfer,
  reviseCanonicalTransferFromEdit,
  markCanonicalTransferConsumed,
  migrateLegacyPendingOnce,
  loadRowsForAiKontrol,
  getCanonicalRowsForCompanySync,
  computeTransferBalanceSummary,
  assertTrustedEnvelopesUntouched,
  simulateTwoTabRevisionConflict,
  CANONICAL_TRANSFER_STATUS,
  CANONICAL_TRANSFER_CONSUMER,
} = await import("@/src/utils/canonicalFisControlTransfer.js");

const {
  bankMovementsToStandardLucaRows,
} = await import("@/src/utils/standardLucaRow.js");

const {
  stampBankMaterializedLucaRow,
  applyOutputAccountingDecisionsToRows,
} = await import("@/src/utils/outputAccountingDecisionFacade.js");

const {
  prepareElektrawebExportRows,
} = await import("@/src/utils/elektrawebOutputAdapter.js");

const {
  savePendingLucaRows,
  loadPendingLucaRows,
  PENDING_LUCA_ROWS_STORAGE_KEY,
} = await import("@/src/utils/companyCenter.js");

const { buildStandardLucaTransferPayload } = await import(
  "@/src/utils/standardLucaRow.js"
);

const COMPANY_A = "mare-co-aaaa";
const COMPANY_B = "other-co-bbbb";
const SHARED_102 = "102.01.037";
const VADESIZ = "102.10.V001";
const FAIZ = "642.01.001";
const STOPAJ = "193.01.001";

function dualMovement(i, counter = FAIZ) {
  return {
    id: `m-${i}`,
    sourceMovementId: `m-${i}`,
    date: "2026-03-01",
    description: `H${i}`,
    amount: 1000 + i,
    direction: i % 2 === 0 ? "GIRIS" : "CIKIS",
    accountCode: SHARED_102,
    counterAccountCode: counter,
    documentType: "DK",
    lucaDescription: `H${i}`,
    matchedMemoryId: null,
    decisionSource: "safeSystemRule",
    decisionRequiresReview: false,
    missingHesapCategory: "",
  };
}

function mare12Movements() {
  const counters = [VADESIZ, FAIZ, STOPAJ, VADESIZ, FAIZ, STOPAJ, FAIZ, STOPAJ, VADESIZ, FAIZ, STOPAJ, VADESIZ];
  return counters.map((c, i) => dualMovement(i + 1, c));
}

beforeEach(() => {
  store.clear();
  __resetCanonicalTransferTestState();
});

describe("Faz6 canonical fis-control transfer", () => {
  it("1+2) 12 hareket → tek snapshot → 24 rows; lucaRowCount === rows.length", async () => {
    const rows = bankMovementsToStandardLucaRows(mare12Movements(), {
      firmaId: COMPANY_A,
      kaynakAdi: "VAKIFBANK",
    });
    assert.equal(rows.length, 24);
    const saved = await publishBankParserTransfer({
      companyId: COMPANY_A,
      companyName: "MARE",
      bankName: "VAKIFBANK",
      rows,
      movementCount: 12,
      authUserId: "user-a",
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.snapshot.lucaRowCount, 24);
    assert.equal(saved.snapshot.rows.length, 24);
    assert.equal(saved.snapshot.StandardLucaRows.length, 24);
    assert.equal(saved.snapshot.lucaRowCount, saved.snapshot.rows.length);
    assert.equal(__listCanonicalTransferMemory().filter((s) => s.status !== "superseded").length, 1);
  });

  it("3+4) aynı aktarım iki kez / çift tıklama → snapshot 1", async () => {
    const rows = bankMovementsToStandardLucaRows(mare12Movements(), {
      firmaId: COMPANY_A,
    });
    const a = await publishBankParserTransfer({
      companyId: COMPANY_A,
      bankName: "VAKIFBANK",
      rows,
      movementCount: 12,
      authUserId: "user-a",
    });
    const b = await publishBankParserTransfer({
      companyId: COMPANY_A,
      bankName: "VAKIFBANK",
      rows,
      movementCount: 12,
      authUserId: "user-a",
    });
    assert.equal(a.ok && b.ok, true);
    assert.equal(b.deduped, true);
    assert.equal(a.transferId, b.transferId);
    assert.equal(a.revision, b.revision);
    const ready = __listCanonicalTransferMemory().filter(
      (s) => s.status === CANONICAL_TRANSFER_STATUS.READY || s.status === CANONICAL_TRANSFER_STATUS.CONSUMED
    );
    assert.equal(ready.length, 1);
  });

  it("5) refresh → aynı transferId/revision", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(1)], {
      firmaId: COMPANY_A,
    });
    const saved = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const again = await readCanonicalTransferSnapshot({
      companyId: COMPANY_A,
      source: "bank",
      runId: saved.runId,
      authUserId: "user-a",
    });
    assert.equal(again.ok, true);
    assert.equal(again.snapshot.transferId, saved.transferId);
    assert.equal(again.snapshot.revision, saved.revision);
  });

  it("6) A→B tenant sızıntısı yok", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(1)], {
      firmaId: COMPANY_A,
    });
    await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const leak = await readCanonicalTransferSnapshot({
      companyId: COMPANY_B,
      source: "bank",
      authUserId: "user-a",
    });
    assert.equal(leak.ok, false);
  });

  it("7) stale async A sonucu B’ye yazılmaz", async () => {
    const rowsA = bankMovementsToStandardLucaRows([dualMovement(1)], {
      firmaId: COMPANY_A,
    });
    const stale = await writeCanonicalTransferSnapshot(
      {
        companyId: COMPANY_A,
        rows: rowsA,
        movementCount: 1,
        authUserId: "user-a",
        source: "bank",
      },
      { expectedCompanyId: COMPANY_B }
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "STALE_COMPANY");
  });

  it("8) legacy pending → canonical tek sefer dönüşüm", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(2, STOPAJ)], {
      firmaId: COMPANY_A,
    });
    const pending = buildStandardLucaTransferPayload({
      firmaId: COMPANY_A,
      companyName: "MARE",
      kaynakTipi: "BANKA",
      kaynakAdi: "VAKIFBANK",
      source: "bank",
      rows,
      movementCount: 1,
    });
    savePendingLucaRows(pending);
    assert.ok(loadPendingLucaRows()?.rows?.length);

    const mig = await migrateLegacyPendingOnce({
      companyId: COMPANY_A,
      authUserId: "user-a",
    });
    assert.equal(mig.migrated, true);
    assert.equal(loadPendingLucaRows(), null);
    assert.equal(mig.snapshot.lucaRowCount, 2);

    const second = await migrateLegacyPendingOnce({
      companyId: COMPANY_A,
      authUserId: "user-a",
    });
    assert.equal(second.migrated, false);
  });

  it("9) bozuk legacy → auto hydrate yok", async () => {
    store.set(PENDING_LUCA_ROWS_STORAGE_KEY, "{not-json");
    const mig = await migrateLegacyPendingOnce({
      companyId: COMPANY_A,
      authUserId: "user-a",
    });
    // parse fail → loadPending returns null → NO_PENDING or clear
    assert.equal(mig.migrated, false);
  });

  it("10) trusted envelope korunur; resolver 0", async () => {
    let rows = bankMovementsToStandardLucaRows([dualMovement(3)], {
      firmaId: COMPANY_A,
    });
    rows = rows.map((r) =>
      stampBankMaterializedLucaRow(r, {
        bankAccountCode: SHARED_102,
        companyId: COMPANY_A,
        source: "SYSTEM_RULE",
      })
    );
    const saved = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const check = assertTrustedEnvelopesUntouched(
      saved.snapshot.rows,
      COMPANY_A
    );
    assert.equal(check.resolveCalls, 0);
    assert.ok(check.trusted >= 1);
  });

  it("11) manuel edit → revision artar, eski revision korunur", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(4)], {
      firmaId: COMPANY_A,
    });
    const saved = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const edited = rows.map((r, i) =>
      i === 1 ? { ...r, hesapKodu: "340.01.010", manuallyEdited: true } : r
    );
    const rev = await reviseCanonicalTransferFromEdit({
      baseSnapshot: saved.snapshot,
      nextRows: edited,
      companyId: COMPANY_A,
      authUserId: "user-a",
    });
    assert.equal(rev.ok, true);
    assert.equal(rev.revision, 2);
    const all = __listCanonicalTransferMemory();
    assert.ok(all.some((s) => s.revision === 1 && s.status === "superseded"));
    assert.ok(all.some((s) => s.revision === 2));
  });

  it("12) Luca/Elektra/Fiş Kontrol aynı satır ve revision", async () => {
    const rows = bankMovementsToStandardLucaRows(
      [dualMovement(1, FAIZ), dualMovement(2, STOPAJ)],
      { firmaId: COMPANY_A }
    );
    const saved = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 2,
      authUserId: "user-a",
    });
    const luca = applyOutputAccountingDecisionsToRows(saved.snapshot.rows, {
      companyId: COMPANY_A,
    });
    const elektra = prepareElektrawebExportRows(saved.snapshot.rows, {
      companyId: COMPANY_A,
    });
    assert.equal(elektra.ok, true);
    assert.equal(luca.length, elektra.rows.length);
    for (let i = 0; i < luca.length; i += 1) {
      assert.equal(luca[i].hesapKodu, elektra.rows[i].hesapKodu);
      assert.equal(Number(luca[i].borc || 0), Number(elektra.rows[i].borc || 0));
    }
    assert.equal(saved.revision, 1);
  });

  it("13) archive reuse → ikinci transfer yok (aynı content)", async () => {
    const rows = bankMovementsToStandardLucaRows(mare12Movements(), {
      firmaId: COMPANY_A,
    });
    const a = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 12,
      sourceId: "src-1",
      archiveId: "arch-1",
      authUserId: "user-a",
    });
    const b = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 12,
      sourceId: "src-1",
      archiveId: "arch-1",
      authUserId: "user-a",
    });
    assert.equal(b.deduped, true);
    assert.equal(a.transferId, b.transferId);
  });

  it("14) clean-open → stale snapshot bind yok (okuma explicit run/company ister)", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(1)], {
      firmaId: COMPANY_A,
    });
    await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    // Yanlış firma / boş company → bind yok
    const empty = await readCanonicalTransferSnapshot({
      companyId: "",
      authUserId: "user-a",
    });
    assert.equal(empty.ok, false);
  });

  it("15) balance 24/0/0 ve borç=alacak", async () => {
    const rows = bankMovementsToStandardLucaRows(mare12Movements(), {
      firmaId: COMPANY_A,
    });
    const saved = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 12,
      authUserId: "user-a",
    });
    const bal = saved.snapshot.balanceSummary;
    assert.equal(bal.rowCount, 24);
    assert.equal(bal.balanced, true);
    assert.equal(bal.borc, bal.alacak);
    assert.equal(bal.controlTriplet, "24/0/0");
  });

  it("16) iki sekme conflict deterministic/review", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(5)], {
      firmaId: COMPANY_A,
    });
    const saved = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const rowsA = rows.map((r) => ({ ...r, hesapKodu: r.hesapKodu || SHARED_102 }));
    const rowsB = rows.map((r, i) =>
      i === 1 ? { ...r, hesapKodu: "340.01.010" } : r
    );
    const { first, second } = await simulateTwoTabRevisionConflict(
      saved.snapshot,
      rowsA,
      rowsB
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.code, "REVISION_CONFLICT");
    assert.equal(second.requiresReview, true);
  });

  it("17) tüketim veriyi silmez, status günceller", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(6)], {
      firmaId: COMPANY_A,
    });
    const saved = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const consumed = await markCanonicalTransferConsumed(saved.snapshot, {
      consumer: "fis_kontrol",
      companyId: COMPANY_A,
    });
    assert.equal(consumed.ok, true);
    assert.equal(consumed.deleted, false);
    assert.equal(consumed.snapshot.status, CANONICAL_TRANSFER_STATUS.CONSUMED);
    assert.ok(consumed.snapshot.consumedAt);
    assert.equal(consumed.snapshot.rows.length, 2);
  });

  it("18) idempotency — tekrar publish aynı checksum", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(7, VADESIZ)], {
      firmaId: COMPANY_A,
    });
    const a = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const b = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    assert.equal(a.snapshot.checksum, b.snapshot.checksum);
    assert.equal(b.deduped, true);
  });

  it("wiring: BankParserWorkbench publishBankParserTransfer kullanır", () => {
    const wb = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"),
      "utf8"
    );
    assert.match(wb, /publishBankParserTransfer/);
    assert.match(wb, /publishArchivePrepareTransfer/);
    assert.match(wb, /publishLucaProducerTransfer/);
    assert.match(wb, /handleGoToFisKontrol/);
    assert.doesNotMatch(wb, /saveLucaTransferDataset\(/);
    assert.doesNotMatch(wb, /savePendingLucaRows\(/);
  });

  it("wiring: fis-kontrol reviseCanonical + migrateLegacy", () => {
    const page = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/fis-kontrol/page.jsx"),
      "utf8"
    );
    assert.match(page, /reviseCanonicalTransferFromEdit/);
    assert.match(page, /migrateLegacyPendingOnce/);
    assert.match(page, /readCanonicalTransferSnapshot/);
    assert.doesNotMatch(page, /savePendingLucaRows\(/);
    assert.doesNotMatch(page, /loadLucaTransferDataset\(/);
  });

  it("20) archive prepare iki kez → tek canonical transfer", async () => {
    const rows = bankMovementsToStandardLucaRows(mare12Movements(), {
      firmaId: COMPANY_A,
    });
    const a = await publishArchivePrepareTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 12,
      sourceId: "arch-src",
      archiveId: "arch-1",
      authUserId: "user-a",
    });
    const b = await publishArchivePrepareTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 12,
      sourceId: "arch-src",
      archiveId: "arch-1",
      authUserId: "user-a",
    });
    assert.equal(a.ok && b.ok, true);
    assert.equal(b.deduped, true);
    assert.equal(a.transferId, b.transferId);
    assert.equal(a.revision, b.revision);
    const ready = __listCanonicalTransferMemory().filter(
      (s) =>
        s.producer === "archive_prepare" &&
        (s.status === "ready" || s.status === "consumed")
    );
    assert.equal(ready.length, 1);
  });

  it("21) archive reuse → ikinci source/job/transfer yok", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(8)], {
      firmaId: COMPANY_A,
    });
    const a = await publishArchivePrepareTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      sourceId: "reuse-src",
      authUserId: "user-a",
    });
    const b = await publishArchivePrepareTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      sourceId: "reuse-src",
      authUserId: "user-a",
    });
    assert.equal(b.deduped, true);
    assert.equal(a.runId, b.runId);
    // prepare facade source/job/Drive yazmaz — yalnız transfer memory
    assert.equal(
      __listCanonicalTransferMemory().filter((s) => s.sourceId === "reuse-src")
        .length,
      1
    );
  });

  it("22) aynı snapshot Luca iki kez → aynı deterministic run/dataset", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(9)], {
      firmaId: COMPANY_A,
    });
    const a = await publishLucaProducerTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
      source: "bank",
    });
    const b = await publishLucaProducerTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
      source: "bank",
    });
    assert.equal(a.runId, b.runId);
    assert.equal(a.transferId, b.transferId);
    assert.equal(b.deduped, true);
    assert.doesNotMatch(a.runId, /Date/);
    assert.match(a.runId, /__luca_producer__r1$/);
  });

  it("23) aynı snapshot Elektra iki kez → aynı deterministic run/dataset", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(10)], {
      firmaId: COMPANY_A,
    });
    const a = await publishElektrawebLucaTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const b = await publishElektrawebLucaTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    assert.equal(a.runId, b.runId);
    assert.equal(a.transferId, b.transferId);
    assert.equal(b.deduped, true);
    assert.match(a.runId, /__elektraweb_luca__r1$/);
  });

  it("24) yeni revision → yeni kimlik", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(11)], {
      firmaId: COMPANY_A,
    });
    const saved = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const edited = rows.map((r, i) =>
      i === 0 ? { ...r, hesapKodu: "340.01.099", manuallyEdited: true } : r
    );
    const rev = await reviseCanonicalTransferFromEdit({
      baseSnapshot: saved.snapshot,
      nextRows: edited,
      companyId: COMPANY_A,
      authUserId: "user-a",
    });
    assert.equal(rev.ok, true);
    assert.notEqual(rev.runId, saved.runId);
    assert.equal(rev.transferId, saved.transferId);
    assert.equal(rev.revision, 2);
    assert.match(rev.runId, /__fis_kontrol__r2$/);
  });

  it("25) Luca ve Elektra → aynı transferId/revision + satır paritesi", async () => {
    const rows = bankMovementsToStandardLucaRows(
      [dualMovement(1, FAIZ), dualMovement(2, STOPAJ)],
      { firmaId: COMPANY_A }
    );
    const fp = buildCanonicalTransferSnapshot({
      companyId: COMPANY_A,
      rows,
      source: "bank",
    }).contentFingerprint;
    const lucaId = buildDeterministicRunIdentity({
      companyId: COMPANY_A,
      source: "bank",
      contentFingerprint: fp,
      revision: 1,
      consumer: CANONICAL_TRANSFER_CONSUMER.LUCA_PRODUCER,
    });
    const elektraId = buildDeterministicRunIdentity({
      companyId: COMPANY_A,
      source: "bank",
      contentFingerprint: fp,
      revision: 1,
      consumer: CANONICAL_TRANSFER_CONSUMER.ELEKTRAWEB_LUCA,
    });
    assert.equal(lucaId.transferId, elektraId.transferId);
    assert.equal(lucaId.revision, elektraId.revision);
    assert.notEqual(lucaId.runId, elektraId.runId);

    const published = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 2,
      authUserId: "user-a",
    });
    assert.equal(published.transferId, lucaId.transferId);
    const luca = applyOutputAccountingDecisionsToRows(published.snapshot.rows, {
      companyId: COMPANY_A,
    });
    const elektra = prepareElektrawebExportRows(published.snapshot.rows, {
      companyId: COMPANY_A,
    });
    assert.equal(elektra.ok, true);
    assert.equal(luca.length, elektra.rows.length);
  });

  it("26) ai-kontrol canonical snapshot okur", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(12)], {
      firmaId: COMPANY_A,
    });
    await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const loaded = await loadRowsForAiKontrol({
      companyId: COMPANY_A,
      authUserId: "user-a",
    });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, "canonical");
    assert.equal(loaded.snapshot.rows.length, 2);
  });

  it("27) Kurgan canonical okur veya güvenli boş", async () => {
    assert.deepEqual(getCanonicalRowsForCompanySync(COMPANY_B), []);
    const rows = bankMovementsToStandardLucaRows([dualMovement(13)], {
      firmaId: COMPANY_A,
    });
    await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const kurganRows = getCanonicalRowsForCompanySync(COMPANY_A);
    assert.equal(kurganRows.length, 2);
  });

  it("28) migration sonrası legacy pending tekrar okunmaz", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(14)], {
      firmaId: COMPANY_A,
    });
    savePendingLucaRows(
      buildStandardLucaTransferPayload({
        firmaId: COMPANY_A,
        rows,
        kaynakTipi: "BANKA",
        kaynakAdi: "VAKIFBANK",
        source: "bank",
      })
    );
    await migrateLegacyPendingOnce({
      companyId: COMPANY_A,
      authUserId: "user-a",
    });
    assert.equal(loadPendingLucaRows(), null);
    savePendingLucaRows(
      buildStandardLucaTransferPayload({
        firmaId: COMPANY_A,
        rows,
        kaynakTipi: "BANKA",
        kaynakAdi: "VAKIFBANK",
        source: "bank",
      })
    );
    // Normal yol: ai-kontrol canonical tercih eder; pending yazılmış olsa bile
    // migrate bir kez daha temizler ve canonical öncelikli
    const loaded = await loadRowsForAiKontrol({
      companyId: COMPANY_A,
      authUserId: "user-a",
    });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, "canonical");
  });

  it("29) normal zincirde global pending yazımı 0", async () => {
    store.delete(PENDING_LUCA_ROWS_STORAGE_KEY);
    const rows = bankMovementsToStandardLucaRows([dualMovement(15)], {
      firmaId: COMPANY_A,
    });
    await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    await publishLucaProducerTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    await publishArchivePrepareTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    assert.equal(loadPendingLucaRows(), null);
    assert.equal(store.has(PENDING_LUCA_ROWS_STORAGE_KEY), false);
  });

  it("30) UI dosyalarında doğrudan storage yazımı yok", () => {
    const uiFiles = [
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx",
      "app/(annvero)/muhasebe/fis-kontrol/page.jsx",
      "app/(annvero)/muhasebe/elektraweb/page.tsx",
      "app/(annvero)/muhasebe/luca-donusturucu/page.jsx",
      "app/(annvero)/muhasebe/ai-kontrol/page.jsx",
      "app/(annvero)/muhasebe/fis-donusturme/page.jsx",
      "app/(annvero)/muhasebe/banka-mutabakat/page.jsx",
    ];
    for (const rel of uiFiles) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      assert.doesNotMatch(src, /savePendingLucaRows\(/, rel);
      assert.doesNotMatch(src, /saveLucaTransferDataset\(/, rel);
      assert.doesNotMatch(src, /loadPendingLucaRows\(/, rel);
      assert.doesNotMatch(src, /loadLucaTransferDataset\(/, rel);
    }
    const kurgan = fs.readFileSync(
      path.join(root, "src/utils/kurganRiskEngine.js"),
      "utf8"
    );
    assert.doesNotMatch(kurgan, /loadPendingLucaRows\(/);
    assert.match(kurgan, /getCanonicalRowsForCompanySync/);
  });

  it("31) iki sekme revision conflict davranışı korunur", async () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(16)], {
      firmaId: COMPANY_A,
    });
    const base = await publishBankParserTransfer({
      companyId: COMPANY_A,
      rows,
      movementCount: 1,
      authUserId: "user-a",
    });
    const rowsA = rows.map((r) => ({ ...r, hesapKodu: "340.01.001" }));
    const rowsB = rows.map((r) => ({ ...r, hesapKodu: "340.01.002" }));
    const { first, second } = await simulateTwoTabRevisionConflict(
      base.snapshot,
      rowsA,
      rowsB
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.code, "REVISION_CONFLICT");
  });

  it("MARE kodları korunur", async () => {
    const rows = bankMovementsToStandardLucaRows(mare12Movements(), {
      firmaId: COMPANY_A,
    });
    const codes = [...new Set(rows.map((r) => r.hesapKodu))].sort();
    assert.ok(codes.includes(SHARED_102));
    assert.ok(codes.includes(VADESIZ));
    assert.ok(codes.includes(FAIZ));
    assert.ok(codes.includes(STOPAJ));
  });
});
