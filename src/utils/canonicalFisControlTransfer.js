/**
 * Faz 6 — Canonical Fiş Kontrol transfer snapshot facade.
 *
 * Bir veri bir kez üretilir; IDB + legacy pending paralel ikinci gerçek olmaz.
 * UI doğrudan storage detayına erişmez — bu modül tek yazma/okuma kapısıdır.
 *
 * PII (ham açıklama / IBAN / hesap no) log veya telemetry’ye yazılmaz.
 */

import {
  LUCA_TRANSFER_SCHEMA_VERSION,
  LUCA_TRANSFER_TTL_MS,
  buildLucaTransferContentFingerprint,
  buildLucaTransferStorageKey,
  buildFisKontrolTransferHref,
  saveLucaTransferDataset,
  loadLucaTransferDataset,
  assertLucaTransferHydrateBinding,
  loadPendingLucaRows,
  clearPendingLucaRows,
  resolveAuthUserIdForTransfer,
} from "@/src/utils/companyCenter";
import {
  buildStandardLucaTransferPayload,
  isStandardLucaPayload,
  stripStandardLucaRow,
  sortStandardLucaRows,
} from "@/src/utils/standardLucaRow";
import { shouldSkipOutputResolveTrusted } from "@/src/utils/accountingDecisionTrust";
import {
  getAccountingResolveCallCount,
  beginAccountingResolveCallTracking,
  endAccountingResolveCallTracking,
  resetAccountingResolveCallCount,
} from "@/src/utils/centralAccountingDecisionResolver";

export const CANONICAL_TRANSFER_PRODUCER = Object.freeze({
  BANK_PARSER: "bank_parser",
  LEGACY_PENDING_MIGRATE: "legacy_pending_migrate",
  FIS_KONTROL_EDIT: "fis_kontrol_edit",
  ELEKTRAWEB: "elektraweb",
  ARCHIVE_PREPARE: "archive_prepare",
  FIS_DONUSTURME: "fis_donusturme",
  BANKA_MUTABAKAT: "banka_mutabakat",
  AI_KONTROL_EDIT: "ai_kontrol_edit",
});

/** Tüketici türü — deterministic runId bileşeni (Date.now yok). */
export const CANONICAL_TRANSFER_CONSUMER = Object.freeze({
  FIS_KONTROL: "fis_kontrol",
  LUCA_PRODUCER: "luca_producer",
  ELEKTRAWEB_LUCA: "elektraweb_luca",
});

export const CANONICAL_TRANSFER_STATUS = Object.freeze({
  READY: "ready",
  CONSUMED: "consumed",
  SUPERSEDED: "superseded",
  REQUIRES_REVIEW: "requires_review",
});

/** In-memory canonical mirror — Node test + IDB yokken tek kaynak. */
const memoryByKey = new Map();
/** transferId → latest snapshot (revision index) */
const memoryByTransferId = new Map();
/** Inflight write promises — çift tıklama / concurrent dedupe */
const inflightWrites = new Map();

export function __resetCanonicalTransferTestState() {
  memoryByKey.clear();
  memoryByTransferId.clear();
  inflightWrites.clear();
  clearPendingLucaRows();
}

export function __listCanonicalTransferMemory() {
  return [...memoryByKey.values()].map((s) => ({ ...s, rows: s.rows?.slice?.() || [] }));
}

function textId(value) {
  return value == null ? "" : String(value).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function safeFingerprint(rows = []) {
  return buildLucaTransferContentFingerprint(rows);
}

/**
 * Borç/alacak özeti — PII yok.
 */
export function computeTransferBalanceSummary(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  let borc = 0;
  let alacak = 0;
  let missingAccount = 0;
  let review = 0;
  for (const row of list) {
    borc += Math.abs(Number(row?.borc) || 0);
    alacak += Math.abs(Number(row?.alacak) || 0);
    if (!String(row?.hesapKodu || "").trim()) missingAccount += 1;
    if (
      row?.accountingDecision?.requiresReview ||
      String(row?.riskDurumu || "").toUpperCase() === "INCELEME"
    ) {
      review += 1;
    }
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  borc = round2(borc);
  alacak = round2(alacak);
  const balanced = borc === alacak;
  const passed = list.length - missingAccount - review;
  return {
    rowCount: list.length,
    passed: Math.max(0, passed),
    missingAccount,
    review,
    borc,
    alacak,
    balanced,
    /** Fiş Kontrol kartı: 24/0/0 */
    controlTriplet: `${list.length}/${missingAccount}/${review}`,
  };
}

export function buildStableTransferId({
  companyId = "",
  source = "bank",
  contentFingerprint = "",
} = {}) {
  const company = textId(companyId).slice(0, 8) || "unknown";
  const src = textId(source).toLowerCase() || "bank";
  const fp = textId(contentFingerprint) || "0";
  return `${src}-xfer-${company}-${fp}`;
}

/**
 * Deterministic run/dataset kimliği:
 * companyId + sourceFingerprint + revision + consumer
 * Aynı snapshot + aynı consumer → aynı runId (Date.now yok).
 * Yeni revision → yeni runId. Luca ve Elektra aynı transferId paylaşır.
 */
export function buildDeterministicRunIdentity({
  companyId = "",
  source = "bank",
  contentFingerprint = "",
  revision = 1,
  consumer = CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
} = {}) {
  const transferId = buildStableTransferId({
    companyId,
    source,
    contentFingerprint,
  });
  const rev = Math.max(1, Number(revision) || 1);
  const cons = textId(consumer) || CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL;
  return {
    transferId,
    revision: rev,
    consumer: cons,
    runId: `${transferId}__${cons}__r${rev}`,
  };
}

export function buildCanonicalChecksum({
  transferId = "",
  revision = 1,
  contentFingerprint = "",
  lucaRowCount = 0,
  companyId = "",
} = {}) {
  const raw = [
    textId(transferId),
    String(Number(revision) || 1),
    textId(contentFingerprint),
    String(Number(lucaRowCount) || 0),
    textId(companyId),
  ].join("|");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Canonical snapshot — StandardLucaRows tek kaynak gerçek.
 * lucaRowCount daima rows.length.
 */
export function buildCanonicalTransferSnapshot({
  companyId = "",
  companyName = "",
  source = "bank",
  sourceId = "",
  archiveId = "",
  authUserId = "",
  rows = [],
  movementCount = 0,
  bankId = "",
  bankName = "",
  kaynakTipi = "",
  kaynakAdi = "",
  producer = CANONICAL_TRANSFER_PRODUCER.BANK_PARSER,
  consumer = CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
  revision = 1,
  status = CANONICAL_TRANSFER_STATUS.READY,
  transferId = "",
  previousTransferId = "",
  consumedAt = null,
  createdAt = "",
  updatedAt = "",
} = {}) {
  const company = textId(companyId);
  const src =
    textId(source).toLowerCase() === "elektraweb" ||
    textId(source).toLowerCase() === "elektra"
      ? "elektraweb"
      : "bank";
  const normalizedRows = sortStandardLucaRows(
    (Array.isArray(rows) ? rows : []).map(stripStandardLucaRow)
  );
  const contentFingerprint = safeFingerprint(normalizedRows);
  const rev = Math.max(1, Number(revision) || 1);
  const cons =
    textId(consumer) || CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL;
  const identity = buildDeterministicRunIdentity({
    companyId: company,
    source: src,
    contentFingerprint,
    revision: rev,
    consumer: cons,
  });
  // Explicit transferId (edit/revision) korunur; runId daima transferId+consumer+revision
  const baseTransferId = textId(transferId) || identity.transferId;
  const runId = `${baseTransferId}__${cons}__r${rev}`;
  const created = createdAt || nowIso();
  const updated = updatedAt || created;
  const createdMs = Date.parse(created);
  const expiresAt = new Date(
    (Number.isNaN(createdMs) ? Date.now() : createdMs) + LUCA_TRANSFER_TTL_MS
  ).toISOString();
  const balanceSummary = computeTransferBalanceSummary(normalizedRows);
  const lucaRowCount = normalizedRows.length;
  const checksum = buildCanonicalChecksum({
    transferId: baseTransferId,
    revision: rev,
    contentFingerprint,
    lucaRowCount,
    companyId: company,
  });

  const malformed =
    !company ||
    !normalizedRows.length ||
    normalizedRows.some((r) => {
      const rowFirma = textId(r?.firmaId || r?.companyId);
      return rowFirma && rowFirma !== company;
    });

  return {
    schemaVersion: LUCA_TRANSFER_SCHEMA_VERSION,
    format: "standard-luca-row-v1",
    transferId: baseTransferId,
    runId,
    datasetId: runId,
    companyId: company,
    firmaId: company,
    companyName: textId(companyName),
    sourceType: src,
    source: src,
    sourceId: textId(sourceId),
    archiveId: textId(archiveId),
    sourceFingerprint: contentFingerprint,
    contentFingerprint,
    createdAt: created,
    updatedAt: updated,
    expiresAt,
    revision: rev,
    consumer: cons,
    status: malformed
      ? CANONICAL_TRANSFER_STATUS.REQUIRES_REVIEW
      : status || CANONICAL_TRANSFER_STATUS.READY,
    StandardLucaRows: normalizedRows,
    rows: normalizedRows,
    lucaRowCount,
    movementCount: Number(movementCount) || 0,
    balanceSummary,
    producer: producer || CANONICAL_TRANSFER_PRODUCER.BANK_PARSER,
    consumedAt: consumedAt || null,
    previousTransferId: textId(previousTransferId) || null,
    checksum,
    authUserId: textId(authUserId),
    bankId: textId(bankId),
    bankName: textId(bankName) || textId(kaynakAdi),
    kaynakTipi:
      textId(kaynakTipi) || (src === "bank" ? "BANKA" : "ELEKTRAWEB"),
    kaynakAdi: textId(kaynakAdi) || textId(bankName) || (src === "bank" ? "BANKA" : "ELEKTRAWEB"),
    requiresReview: malformed,
    reviewReason: malformed ? "malformed_or_tenant_row_mismatch" : "",
  };
}

function memoryKey(snapshot) {
  return buildLucaTransferStorageKey(
    snapshot.source || snapshot.sourceType,
    snapshot.companyId,
    snapshot.runId
  );
}

function putMemory(snapshot) {
  const key = memoryKey(snapshot);
  memoryByKey.set(key, snapshot);
  const tid = snapshot.transferId;
  const list = memoryByTransferId.get(tid) || [];
  const next = list.filter((s) => s.revision !== snapshot.revision);
  next.push(snapshot);
  next.sort((a, b) => a.revision - b.revision);
  memoryByTransferId.set(tid, next);
  return key;
}

function getMemoryLatestForCompany(companyId, source = "bank", runId = "", consumer = "") {
  const company = textId(companyId);
  const src = textId(source) || "bank";
  if (runId) {
    const key = buildLucaTransferStorageKey(src, company, runId);
    return memoryByKey.get(key) || null;
  }
  let best = null;
  for (const snap of memoryByKey.values()) {
    if (textId(snap.companyId) !== company) continue;
    if ((snap.source || snap.sourceType) !== src) continue;
    if (consumer && textId(snap.consumer) !== textId(consumer)) continue;
    if (snap.status === CANONICAL_TRANSFER_STATUS.SUPERSEDED) continue;
    if (
      !best ||
      Number(snap.revision) > Number(best.revision) ||
      String(snap.updatedAt) > String(best.updatedAt)
    ) {
      best = snap;
    }
  }
  return best;
}

/**
 * Yazma — inflight dedupe + revision CAS + stale company guard.
 * Son yazan sessiz kazanmaz: expectedRevision uyuşmazsa REQUIRES_REVIEW.
 */
export async function writeCanonicalTransferSnapshot(
  input = {},
  {
    expectedRevision = null,
    expectedCompanyId = "",
    skipIdb = false,
  } = {}
) {
  const companyGuard = textId(expectedCompanyId || input.companyId);
  if (companyGuard && textId(input.companyId) && companyGuard !== textId(input.companyId)) {
    return {
      ok: false,
      code: "STALE_COMPANY",
      requiresReview: true,
      message: "stale_async_company_mismatch",
    };
  }

  const snapshot = buildCanonicalTransferSnapshot(input);
  if (snapshot.requiresReview && snapshot.status === CANONICAL_TRANSFER_STATUS.REQUIRES_REVIEW) {
    return {
      ok: false,
      code: "REQUIRES_REVIEW",
      requiresReview: true,
      snapshot,
    };
  }

  const existingLatest = getMemoryLatestForCompany(
    snapshot.companyId,
    snapshot.source,
    "",
    snapshot.consumer
  );
  if (
    expectedRevision != null &&
    existingLatest &&
    textId(existingLatest.transferId) === textId(snapshot.transferId) &&
    Number(existingLatest.revision) !== Number(expectedRevision)
  ) {
    return {
      ok: false,
      code: "REVISION_CONFLICT",
      requiresReview: true,
      currentRevision: existingLatest.revision,
      expectedRevision,
    };
  }

  // Aynı transferId+revision+fingerprint+consumer → idempotent
  const same =
    existingLatest &&
    existingLatest.transferId === snapshot.transferId &&
    Number(existingLatest.revision) === Number(snapshot.revision) &&
    existingLatest.contentFingerprint === snapshot.contentFingerprint &&
    existingLatest.consumer === snapshot.consumer &&
    existingLatest.lucaRowCount === snapshot.lucaRowCount;
  if (same) {
    return {
      ok: true,
      deduped: true,
      snapshot: existingLatest,
      runId: existingLatest.runId,
      transferId: existingLatest.transferId,
      revision: existingLatest.revision,
      rowCount: existingLatest.lucaRowCount,
    };
  }

  const inflightKey = `${snapshot.companyId}:${snapshot.transferId}:r${snapshot.revision}:${snapshot.consumer}:${snapshot.contentFingerprint}`;
  if (inflightWrites.has(inflightKey)) {
    return inflightWrites.get(inflightKey);
  }

  const work = (async () => {
    // Eski revision’ı silme — superseded işaretle
    if (existingLatest && existingLatest.transferId === snapshot.transferId) {
      const superseded = {
        ...existingLatest,
        status: CANONICAL_TRANSFER_STATUS.SUPERSEDED,
        updatedAt: nowIso(),
      };
      putMemory(superseded);
    }

    const key = putMemory(snapshot);

    if (!skipIdb && typeof indexedDB !== "undefined") {
      try {
        await saveLucaTransferDataset({
          ...snapshot,
          rows: snapshot.rows,
        });
      } catch {
        // memory canonical kalır; IDB fail-soft
      }
    }

    return {
      ok: true,
      deduped: false,
      key,
      snapshot,
      runId: snapshot.runId,
      transferId: snapshot.transferId,
      revision: snapshot.revision,
      rowCount: snapshot.lucaRowCount,
      contentFingerprint: snapshot.contentFingerprint,
      href: buildFisKontrolTransferHref({
        companyId: snapshot.companyId,
        runId: snapshot.runId,
        source: snapshot.source,
      }),
    };
  })();

  inflightWrites.set(inflightKey, work);
  try {
    return await work;
  } finally {
    inflightWrites.delete(inflightKey);
  }
}

export async function readCanonicalTransferSnapshot({
  companyId = "",
  source = "bank",
  runId = "",
  authUserId = "",
  urlCompanyId = "",
  preferMemory = true,
} = {}) {
  const company = textId(companyId);
  const src = textId(source) || "bank";
  if (!company) {
    return { ok: false, code: "NO_COMPANY", snapshot: null };
  }

  let snapshot = preferMemory
    ? getMemoryLatestForCompany(company, src, runId)
    : null;

  if (!snapshot && typeof indexedDB !== "undefined") {
    try {
      const loaded = await loadLucaTransferDataset({
        source: src,
        companyId: company,
        runId,
        authUserId,
        urlCompanyId: urlCompanyId || company,
        strictBinding: true,
        purgeOnReject: false,
      });
      if (loaded) {
        snapshot = buildCanonicalTransferSnapshot({
          ...loaded,
          rows: loaded.rows,
          revision: loaded.revision || 1,
          transferId: loaded.transferId || loaded.runId,
          producer: loaded.producer || CANONICAL_TRANSFER_PRODUCER.BANK_PARSER,
          status: loaded.status || CANONICAL_TRANSFER_STATUS.READY,
        });
        putMemory(snapshot);
      }
    } catch {
      snapshot = null;
    }
  }

  if (!snapshot) {
    return { ok: false, code: "NOT_FOUND", snapshot: null };
  }

  if (textId(snapshot.companyId) !== company) {
    return { ok: false, code: "TENANT_ISOLATION", snapshot: null };
  }

  const binding = assertLucaTransferHydrateBinding({
    dataset: snapshot,
    activeCompanyId: company,
    urlCompanyId: urlCompanyId || company,
    urlRunId: runId,
    authUserId: authUserId || snapshot.authUserId,
    expectedSource: src,
  });
  if (!binding.ok) {
    return { ok: false, code: binding.code, snapshot: null, binding };
  }

  return { ok: true, snapshot, binding };
}

/**
 * Tüketim — veriyi silmez; status/audit günceller.
 */
export async function markCanonicalTransferConsumed(
  snapshotOrId = null,
  { consumer = "fis_kontrol", companyId = "" } = {}
) {
  let snapshot =
    snapshotOrId && typeof snapshotOrId === "object"
      ? snapshotOrId
      : getMemoryLatestForCompany(companyId, "bank", textId(snapshotOrId));
  if (!snapshot) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (companyId && textId(snapshot.companyId) !== textId(companyId)) {
    return { ok: false, code: "TENANT_ISOLATION" };
  }
  const next = {
    ...snapshot,
    status: CANONICAL_TRANSFER_STATUS.CONSUMED,
    consumedAt: nowIso(),
    consumer: textId(consumer) || "fis_kontrol",
    updatedAt: nowIso(),
  };
  putMemory(next);
  if (typeof indexedDB !== "undefined") {
    try {
      await saveLucaTransferDataset(next);
    } catch {
      /* memory remains */
    }
  }
  return { ok: true, snapshot: next, deleted: false };
}

/**
 * Manuel düzenleme — revision artar; eski revision SUPERSEDED kalır (silinmez).
 */
export async function reviseCanonicalTransferFromEdit({
  baseSnapshot = null,
  nextRows = [],
  companyId = "",
  authUserId = "",
} = {}) {
  if (!baseSnapshot || !Array.isArray(nextRows)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const company = textId(companyId || baseSnapshot.companyId);
  if (textId(baseSnapshot.companyId) !== company) {
    return { ok: false, code: "TENANT_ISOLATION" };
  }

  const nextRev = Number(baseSnapshot.revision || 1) + 1;
  return writeCanonicalTransferSnapshot(
    {
      companyId: company,
      companyName: baseSnapshot.companyName,
      source: baseSnapshot.source || baseSnapshot.sourceType,
      sourceId: baseSnapshot.sourceId,
      archiveId: baseSnapshot.archiveId,
      authUserId: authUserId || baseSnapshot.authUserId,
      rows: nextRows,
      movementCount: baseSnapshot.movementCount,
      bankId: baseSnapshot.bankId,
      bankName: baseSnapshot.bankName,
      kaynakTipi: baseSnapshot.kaynakTipi,
      kaynakAdi: baseSnapshot.kaynakAdi,
      producer: CANONICAL_TRANSFER_PRODUCER.FIS_KONTROL_EDIT,
      consumer:
        baseSnapshot.consumer || CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
      revision: nextRev,
      transferId: baseSnapshot.transferId,
      previousTransferId: baseSnapshot.runId,
      createdAt: baseSnapshot.createdAt,
      updatedAt: nowIso(),
    },
    { expectedRevision: Number(baseSnapshot.revision || 1), expectedCompanyId: company }
  );
}

/**
 * Legacy pending → canonical tek seferlik adapter.
 * Bozuk kayıt auto-hydrate edilmez.
 */
export async function migrateLegacyPendingOnce({
  companyId = "",
  authUserId = "",
} = {}) {
  const company = textId(companyId);
  if (!company) {
    return { ok: false, code: "NO_COMPANY", migrated: false };
  }

  const pending = loadPendingLucaRows();
  if (!pending) {
    return { ok: true, migrated: false, code: "NO_PENDING" };
  }

  if (!isStandardLucaPayload(pending) || !pending?.rows?.length) {
    clearPendingLucaRows();
    return {
      ok: false,
      migrated: false,
      code: "MALFORMED_LEGACY",
      requiresReview: true,
    };
  }

  const pendingFirma = textId(pending.firmaId || pending.companyId);
  if (!pendingFirma || pendingFirma !== company) {
    clearPendingLucaRows();
    return { ok: false, migrated: false, code: "TENANT_MISMATCH" };
  }

  const written = await writeCanonicalTransferSnapshot(
    {
      companyId: company,
      companyName: pending.companyName || "",
      source: pending.source || "bank",
      sourceId: pending.sourceId || "",
      authUserId: authUserId || pending.authUserId || "",
      rows: pending.rows,
      movementCount: pending.movementCount || 0,
      bankId: pending.bankId || "",
      bankName: pending.bankName || pending.kaynakAdi || "",
      kaynakTipi: pending.kaynakTipi,
      kaynakAdi: pending.kaynakAdi,
      producer: CANONICAL_TRANSFER_PRODUCER.LEGACY_PENDING_MIGRATE,
      consumer: CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
      revision: 1,
    },
    { expectedCompanyId: company }
  );

  // Tek sefer — pending silinir (paralel okuma yolu kapanır)
  clearPendingLucaRows();

  return {
    ok: Boolean(written.ok),
    migrated: Boolean(written.ok),
    snapshot: written.snapshot || null,
    code: written.ok ? "MIGRATED" : written.code || "WRITE_FAILED",
    requiresReview: Boolean(written.requiresReview),
  };
}

/**
 * Bank Parser → Fiş Kontrol handoff.
 */
export async function publishBankParserTransfer({
  companyId = "",
  companyName = "",
  bankName = "",
  rows = [],
  movementCount = 0,
  sourceId = "",
  archiveId = "",
  authUserId = "",
} = {}) {
  const userId = textId(authUserId) || (await resolveAuthUserIdForTransfer());
  if (!userId) {
    return { ok: false, code: "AUTH_REQUIRED" };
  }
  return writeCanonicalTransferSnapshot(
    {
      companyId,
      companyName,
      source: "bank",
      sourceId,
      archiveId,
      authUserId: userId,
      rows,
      movementCount,
      bankId: bankName,
      bankName,
      kaynakTipi: "BANKA",
      kaynakAdi: bankName,
      producer: CANONICAL_TRANSFER_PRODUCER.BANK_PARSER,
      consumer: CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
      revision: 1,
    },
    { expectedCompanyId: companyId }
  );
}

/**
 * Legacy archive prepare → aynı facade; ikinci prepare aynı fingerprint’te dedupe.
 * source/job/Drive yazımı burada yok.
 */
export async function publishArchivePrepareTransfer({
  companyId = "",
  companyName = "",
  bankName = "",
  rows = [],
  movementCount = 0,
  sourceId = "",
  archiveId = "",
  authUserId = "",
} = {}) {
  const userId = textId(authUserId) || (await resolveAuthUserIdForTransfer());
  if (!userId) {
    return { ok: false, code: "AUTH_REQUIRED" };
  }
  return writeCanonicalTransferSnapshot(
    {
      companyId,
      companyName,
      source: "bank",
      sourceId,
      archiveId,
      authUserId: userId,
      rows,
      movementCount,
      bankId: bankName,
      bankName,
      kaynakTipi: "BANKA",
      kaynakAdi: bankName,
      producer: CANONICAL_TRANSFER_PRODUCER.ARCHIVE_PREPARE,
      consumer: CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
      revision: 1,
    },
    { expectedCompanyId: companyId }
  );
}

/**
 * Bank / Elektra → Luca Fiş Üretici. Aynı satırlar → aynı transferId;
 * consumer runId’yi ayırır ama Luca/Elektra aynı transferId+revision paylaşır.
 */
export async function publishLucaProducerTransfer({
  companyId = "",
  companyName = "",
  bankName = "",
  rows = [],
  movementCount = 0,
  sourceId = "",
  authUserId = "",
  source = "bank",
  producer = CANONICAL_TRANSFER_PRODUCER.BANK_PARSER,
} = {}) {
  const userId = textId(authUserId) || (await resolveAuthUserIdForTransfer());
  const src =
    textId(source).toLowerCase() === "elektraweb" ? "elektraweb" : "bank";
  const consumer =
    src === "elektraweb"
      ? CANONICAL_TRANSFER_CONSUMER.ELEKTRAWEB_LUCA
      : CANONICAL_TRANSFER_CONSUMER.LUCA_PRODUCER;
  // Ortak transferId için önce fis_kontrol ile aynı fingerprint tabanı
  const contentFingerprint = safeFingerprint(rows);
  const transferId = buildStableTransferId({
    companyId,
    source: src,
    contentFingerprint,
  });
  return writeCanonicalTransferSnapshot(
    {
      companyId,
      companyName,
      source: src,
      sourceId,
      authUserId: userId || "anonymous-transfer",
      rows,
      movementCount,
      bankId: bankName,
      bankName,
      kaynakTipi: src === "bank" ? "BANKA" : "ELEKTRAWEB",
      kaynakAdi: bankName || (src === "bank" ? "BANKA" : "ELEKTRAWEB"),
      producer,
      consumer,
      transferId,
      revision: 1,
    },
    { expectedCompanyId: companyId, skipIdb: false }
  );
}

export async function publishElektrawebLucaTransfer(opts = {}) {
  return publishLucaProducerTransfer({
    ...opts,
    source: "elektraweb",
    producer: CANONICAL_TRANSFER_PRODUCER.ELEKTRAWEB,
  });
}

/** Fiş dönüştürme → Luca üretici (canonical; pending yok). */
export async function publishFisDonusturmeTransfer(opts = {}) {
  return publishLucaProducerTransfer({
    ...opts,
    source: opts.source || "bank",
    producer: CANONICAL_TRANSFER_PRODUCER.FIS_DONUSTURME,
  });
}

/** Banka mutabakat fiş önerisi → Luca üretici. */
export async function publishBankaMutabakatTransfer(opts = {}) {
  return publishLucaProducerTransfer({
    ...opts,
    source: "bank",
    producer: CANONICAL_TRANSFER_PRODUCER.BANKA_MUTABAKAT,
  });
}

/**
 * AI-Kontrol düzenleme — canonical revision bump; pending yazılmaz.
 */
export async function persistAiKontrolRows({
  baseSnapshot = null,
  nextRows = [],
  companyId = "",
  companyName = "",
  kaynakTipi = "",
  kaynakAdi = "",
  authUserId = "",
} = {}) {
  if (baseSnapshot?.transferId) {
    return reviseCanonicalTransferFromEdit({
      baseSnapshot: {
        ...baseSnapshot,
        consumer:
          baseSnapshot.consumer || CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
      },
      nextRows,
      companyId,
      authUserId,
    });
  }
  return writeCanonicalTransferSnapshot(
    {
      companyId,
      companyName,
      source: "bank",
      authUserId: authUserId || "anonymous-transfer",
      rows: nextRows,
      kaynakTipi,
      kaynakAdi,
      producer: CANONICAL_TRANSFER_PRODUCER.AI_KONTROL_EDIT,
      consumer: CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
      revision: 1,
    },
    { expectedCompanyId: companyId }
  );
}

/**
 * Sync okuma — Kurgan / ai-kontrol. Pending okumaz.
 * Snapshot yoksa güvenli boş dizi.
 */
export function getCanonicalRowsForCompanySync(companyId = "", source = "") {
  const company = textId(companyId);
  if (!company) return [];
  const sources = source
    ? [source]
    : ["bank", "elektraweb"];
  let best = null;
  for (const src of sources) {
    for (const cons of Object.values(CANONICAL_TRANSFER_CONSUMER)) {
      const snap = getMemoryLatestForCompany(company, src, "", cons);
      if (!snap?.rows?.length) continue;
      if (
        !best ||
        Number(snap.revision) > Number(best.revision) ||
        String(snap.updatedAt) > String(best.updatedAt)
      ) {
        best = snap;
      }
    }
  }
  return best?.rows ? best.rows.slice() : [];
}

export function getCanonicalSnapshotForCompanySync(companyId = "") {
  const company = textId(companyId);
  if (!company) return null;
  let best = null;
  for (const src of ["bank", "elektraweb"]) {
    for (const cons of Object.values(CANONICAL_TRANSFER_CONSUMER)) {
      const snap = getMemoryLatestForCompany(company, src, "", cons);
      if (!snap) continue;
      if (
        !best ||
        Number(snap.revision) > Number(best.revision) ||
        String(snap.updatedAt) > String(best.updatedAt)
      ) {
        best = snap;
      }
    }
  }
  return best;
}

export function countCanonicalRowsForCompany(companyId = "") {
  return getCanonicalRowsForCompanySync(companyId).length;
}

/**
 * ai-kontrol açılış: önce canonical; yoksa tek sefer migrate.
 */
export async function loadRowsForAiKontrol({ companyId = "", authUserId = "" } = {}) {
  const company = textId(companyId);
  const existing = getCanonicalSnapshotForCompanySync(company);
  if (existing?.rows?.length) {
    return { ok: true, snapshot: existing, source: "canonical" };
  }
  const mig = await migrateLegacyPendingOnce({ companyId: company, authUserId });
  if (mig.migrated && mig.snapshot) {
    return { ok: true, snapshot: mig.snapshot, source: "migrated" };
  }
  return { ok: false, snapshot: null, source: "empty" };
}

export function buildLucaProducerHref({ companyId, runId, source = "bank" }) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", String(companyId));
  if (source) params.set("source", String(source));
  if (runId) params.set("runId", String(runId));
  return `/muhasebe/luca-donusturucu?${params.toString()}`;
}

/**
 * Trusted envelope korunuyor mu? Resolver çağrısı 0 olmalı.
 */
export function assertTrustedEnvelopesUntouched(rows = [], companyId = "") {
  beginAccountingResolveCallTracking();
  resetAccountingResolveCallCount();
  const company = textId(companyId);
  let trusted = 0;
  for (const row of rows || []) {
    if (
      shouldSkipOutputResolveTrusted(row, {
        companyId: company,
        firmaId: company,
      })
    ) {
      trusted += 1;
    }
  }
  const calls = getAccountingResolveCallCount();
  endAccountingResolveCallTracking();
  return { trusted, resolveCalls: calls, ok: calls === 0 };
}

/** İki sekme conflict — aynı revision’a ikinci yazım review döner. */
export async function simulateTwoTabRevisionConflict(baseSnapshot, nextRowsA, nextRowsB) {
  const a = await reviseCanonicalTransferFromEdit({
    baseSnapshot,
    nextRows: nextRowsA,
    companyId: baseSnapshot.companyId,
    authUserId: baseSnapshot.authUserId,
  });
  const b = await reviseCanonicalTransferFromEdit({
    baseSnapshot,
    nextRows: nextRowsB,
    companyId: baseSnapshot.companyId,
    authUserId: baseSnapshot.authUserId,
  });
  return { first: a, second: b };
}

export {
  buildStandardLucaTransferPayload,
  buildFisKontrolTransferHref,
  buildLucaTransferContentFingerprint,
};
