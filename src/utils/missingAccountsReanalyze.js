/**
 * Eksik hesap uygulaması sonrası yeniden analiz — dosya yeniden yüklemeden.
 * Hafıza auto-apply + Fiş Kontrol + bulgu sınıfları.
 */

import {
  applyAccountMemoryV2RecordsToRows,
  loadAccountMemoryV2Records,
} from "@/src/utils/accountMemoryV2";
import { runVoucherControlStage } from "@/src/utils/annveroV1Orchestration";
import { classifyFisKontrolFindings } from "@/src/utils/fisKontrolFindingClasses";
import { analyzeMissingHesapRows } from "@/src/utils/previewExportValidation";
import {
  deriveAutoMatchedMovements,
  deriveUnresolvedMovements,
} from "@/src/utils/bankOneClickPipeline";

/**
 * @returns {{
 *   lucaRows: array,
 *   missingReport: object,
 *   fisKontrol: object,
 *   findingClasses: object,
 *   memoryApplied: number,
 *   durationMs: number
 * }}
 */
export function reanalyzeAfterMissingAccountApply({
  lucaRows = [],
  companyId = "",
  bankName = "",
  memoryRecords = null,
  skipMemoryPass = false,
} = {}) {
  const started = performance.now();
  let next = Array.isArray(lucaRows) ? lucaRows : [];
  let memoryApplied = 0;

  if (!skipMemoryPass && companyId) {
    const records = memoryRecords || loadAccountMemoryV2Records();
    const beforeMissing = analyzeMissingHesapRows(next).missingCount;
    next = applyAccountMemoryV2RecordsToRows(next, records, {
      firmaId: companyId,
      companyId,
      bankName,
    });
    const afterMissing = analyzeMissingHesapRows(next).missingCount;
    memoryApplied = Math.max(0, beforeMissing - afterMissing);
  }

  const missingReport = analyzeMissingHesapRows(next);
  const fisKontrol = runVoucherControlStage(next, {
    companyId,
    firmaId: companyId,
  });
  const findingClasses = classifyFisKontrolFindings(fisKontrol.analysis || {});

  return {
    lucaRows: next,
    missingReport,
    fisKontrol,
    findingClasses,
    memoryApplied,
    durationMs: Math.round(performance.now() - started),
    pipelinePatch: buildPipelinePatchFromReanalyze({
      missingReport,
      fisKontrol,
      findingClasses,
      memoryApplied,
    }),
  };
}

export function buildPipelinePatchFromReanalyze({
  missingReport,
  fisKontrol,
  findingClasses,
  memoryApplied = 0,
} = {}) {
  const report = missingReport || { missingCount: 0 };
  return {
    missingCount: report.missingCount,
    missingLucaRowCount: report.missingLucaRowCount ?? report.missingCount,
    uniqueUnresolvedMovements: report.uniqueUnresolvedMovements,
    uniqueMatchedMovements: report.uniqueMatchedMovements,
    autoMatchedCount: deriveAutoMatchedMovements(report.readyCount, {
      uniqueMatchedMovements: report.uniqueMatchedMovements,
    }),
    unresolvedMovementCount: deriveUnresolvedMovements(report.missingCount, {
      uniqueUnresolvedMovements: report.uniqueUnresolvedMovements,
    }),
    unrecognizedCount: deriveUnresolvedMovements(report.missingCount, {
      uniqueUnresolvedMovements: report.uniqueUnresolvedMovements,
    }),
    passed: fisKontrol?.passed ?? 0,
    warnings: fisKontrol?.warnings ?? 0,
    errors: fisKontrol?.errors ?? 0,
    lowConfidence: fisKontrol?.lowConfidence ?? 0,
    canAutoApprove: Boolean(fisKontrol?.canAutoApprove),
    reviewRequired: Boolean(fisKontrol?.reviewRequired),
    lucaBatchCount: fisKontrol?.lucaBatchCount ?? 0,
    fisKontrolHref: fisKontrol?.fisKontrolHref,
    findingClasses,
    memoryReappliedCount: memoryApplied,
    reanalyzedWithoutReload: true,
  };
}

/**
 * Undo için satır anlık görüntüsü (hassas içerik UI’ya gitmez; yalnız id→hesap).
 */
export function snapshotLucaRowsForUndo(rows = [], rowIds = []) {
  const idSet = new Set((rowIds || []).map(String));
  const snap = [];
  for (const row of rows || []) {
    if (!idSet.has(String(row.id))) continue;
    snap.push({
      id: row.id,
      hesapKodu: row.hesapKodu || "",
      riskDurumu: row.riskDurumu || "",
      missingHesapCategory: row.missingHesapCategory || "",
      kontrolNotu: row.kontrolNotu || "",
      accountMemoryAutoFilled: Boolean(row.accountMemoryAutoFilled),
    });
  }
  return snap;
}

export function restoreLucaRowsFromUndoSnapshot(rows = [], snapshot = []) {
  const byId = new Map((snapshot || []).map((s) => [String(s.id), s]));
  return (rows || []).map((row) => {
    const prev = byId.get(String(row.id));
    if (!prev) return row;
    return {
      ...row,
      hesapKodu: prev.hesapKodu,
      riskDurumu: prev.riskDurumu,
      missingHesapCategory: prev.missingHesapCategory,
      kontrolNotu: prev.kontrolNotu,
      accountMemoryAutoFilled: prev.accountMemoryAutoFilled,
    };
  });
}
