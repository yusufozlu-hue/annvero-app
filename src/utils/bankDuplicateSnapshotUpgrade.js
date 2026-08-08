/**
 * Legacy mükerrer ekstre + canonical snapshot yükseltme/geri yükleme.
 *
 * Normal "İşle ve Kontrol Et" sırasında:
 * - snapshot var → restore (ikinci job/Drive/source yok)
 * - snapshot yok → upgrade: parse edip aynı content_hash’e snapshot yaz
 *   (ikinci V1 job / Drive yok; bank_statement_sources upsert idempotent)
 * - ne dosya ne snapshot → legacy duplicate kartı (eski özet)
 */

export const DUPLICATE_SNAPSHOT_ACTION = Object.freeze({
  RESTORE: "restore",
  UPGRADE: "upgrade",
  LEGACY: "legacy_duplicate",
});

/**
 * @param {{
 *   hasSnapshotMovements?: boolean,
 *   hasFileBytes?: boolean,
 * }} opts
 * @returns {'restore'|'upgrade'|'legacy_duplicate'}
 */
export function resolveDuplicateSnapshotAction({
  hasSnapshotMovements = false,
  hasFileBytes = false,
} = {}) {
  if (hasSnapshotMovements) return DUPLICATE_SNAPSHOT_ACTION.RESTORE;
  if (hasFileBytes) return DUPLICATE_SNAPSHOT_ACTION.UPGRADE;
  return DUPLICATE_SNAPSHOT_ACTION.LEGACY;
}

/**
 * Eski audit özetindeki yanlış hareket sayısını (ör. 5) snapshot lehine ezer.
 */
export function preferSnapshotMovementCount(priorMovementCount, snapshotCount) {
  const snap = Math.max(0, Number(snapshotCount) || 0);
  if (snap > 0) return snap;
  return Math.max(0, Number(priorMovementCount) || 0);
}

/**
 * Mükerrer sonuç kartı — snapshot/upgrade sonrası kanonik sayılar.
 * @param {{
 *   prior?: object,
 *   movementCount?: number,
 *   action?: string,
 *   sourceId?: string,
 *   contentHash?: string,
 * }} opts
 */
export function buildDuplicateSnapshotPipelineResult({
  prior = null,
  movementCount = 0,
  action = DUPLICATE_SNAPSHOT_ACTION.RESTORE,
  sourceId = "",
  contentHash = "",
} = {}) {
  const meta = prior?.metadata || {};
  const count = preferSnapshotMovementCount(
    meta.movement_count,
    movementCount
  );
  const upgraded = action === DUPLICATE_SNAPSHOT_ACTION.UPGRADE;
  return {
    movementCount: count,
    lucaRowCount: 0,
    duplicate: true,
    code: "DUPLICATE_CONTENT",
    terminalStatus: "duplicate",
    edefterStatus: meta.edefter_status || "",
    edefterCode: meta.edefter_code || "",
    driveArchived: Boolean(meta.drive_archived),
    driveSkipped: true,
    reviewRequired: Boolean(meta.review_required),
    canAutoApprove: false,
    passed: Number(meta.passed || 0),
    warnings: Number(meta.warnings || 0),
    errors: Number(meta.errors || 0),
    autoMatchedCount: Number(meta.auto_matched_count || 0),
    uniqueUnresolvedMovements: Number(meta.review_count || count || 0),
    reviewCount: Number(meta.review_count || count || 0),
    totalDurationMs: 0,
    priorJobId: prior?.id || "",
    fromCanonicalSnapshot: true,
    snapshotUpgraded: upgraded,
    snapshotRestored: action === DUPLICATE_SNAPSHOT_ACTION.RESTORE,
    canonicalSourceId: sourceId || "",
    contentHash: contentHash || meta.content_hash || meta.source_file_hash || "",
    accountPlanCount: Number(meta.account_plan_count || 0),
  };
}

/**
 * Aynı upgrade iki kez → ikinci çağrı restore gibi davranmalı (idempotent).
 */
export function isDuplicateSnapshotUpgradeIdempotent({
  firstAction = "",
  secondHasSnapshotMovements = false,
} = {}) {
  if (firstAction !== DUPLICATE_SNAPSHOT_ACTION.UPGRADE) return false;
  return Boolean(secondHasSnapshotMovements);
}
