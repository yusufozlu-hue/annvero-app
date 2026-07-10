/**
 * Ortak banka parser → öğrenme / tanınmayan işlem pipeline'ı.
 * Vakıfbank, TEB, Garanti, Ziraat, Kuveyt Türk aynı akışı kullanır.
 */
import {
  applyLearningMemoryToStandardLucaRows,
} from "@/src/utils/bankLearningMemory";
import {
  applySuggestionsToCandidates,
  collectUnrecognizedFromStandardRows,
} from "@/src/utils/transactionMemoryEngine";
import { ensureStandardLucaRowIds, KAYNAK_TIPI } from "@/src/utils/standardLucaRow";

export function applyBankLearningToStandardRows(
  rows = [],
  learningMemory = [],
  context = {}
) {
  const withIds = ensureStandardLucaRowIds(rows);
  return applyLearningMemoryToStandardLucaRows(withIds, learningMemory, {
    firmaId: context.companyId || context.firmaId,
    companyId: context.companyId || context.firmaId,
    kaynakTipi: context.kaynakTipi || KAYNAK_TIPI.BANKA,
    kaynakAdi: context.sourceBank || context.kaynakAdi || "",
  });
}

/**
 * Parser sonrası tanınmayan satırları üretir; learning_memory önerilerini ekler.
 * Satırlar zaten applyLearningMemoryToStandardLucaRows geçmiş olmalı — tekrar uygulama yok.
 */
export function buildUnrecognizedQueueItems(standardRows = [], context = {}) {
  const learningMemory = context.learningMemory || [];

  const candidates = collectUnrecognizedFromStandardRows(standardRows, {
    companyId: context.companyId,
    sourceModule: context.sourceModule || "banka",
    sourceBank: context.sourceBank || "",
  });

  return applySuggestionsToCandidates(candidates, learningMemory);
}
