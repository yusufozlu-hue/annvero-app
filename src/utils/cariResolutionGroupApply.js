/**
 * Çözüm Merkezi yeşil buton uygulama gövdesi (React state’siz).
 * BankParserWorkbench.handleApplyCariResolutionGroup bunu çağırır.
 */
import {
  buildCariMemoryCanonicalKey,
  persistCariResolutionLearnWithReadback,
} from "@/src/utils/accountMemoryV2";
import { analyzeMissingHesapRows } from "@/src/utils/previewExportValidation";

export function runCariResolutionGroupApply({
  lucaRows = [],
  group,
  accountCode,
  learn = false,
  selectedCompanyId = "",
  selectedBank = "",
  resolveMemoryLearnContext,
} = {}) {
  const code = String(accountCode || "").trim();
  if (!group?.seedRow || !code) {
    return {
      ok: false,
      lucaRows,
      updated: 0,
      learned: false,
      learnPersistFailed: false,
      learnSaveTrace: null,
      beforeMissing: 0,
      afterMissing: 0,
    };
  }

  const beforeMissing = analyzeMissingHesapRows(lucaRows).missingCount;
  const targetIds = new Set((group.rowIds || []).filter(Boolean));
  if (targetIds.size === 0 && group.seedRow?.id) {
    targetIds.add(group.seedRow.id);
  }

  const learnCtx =
    typeof resolveMemoryLearnContext === "function"
      ? resolveMemoryLearnContext(group.seedRow)
      : {
          ok: Boolean(
            group.seedRow.direction &&
              (group.seedRow.analysisKey ||
                group.seedRow.detayAciklama ||
                group.seedRow.fisAciklama)
          ),
          direction: String(group.seedRow.direction || "").trim().toUpperCase(),
          analysisKey: String(group.seedRow.analysisKey || "").trim(),
          transactionType: String(group.seedRow.transactionType || "").trim(),
          description: String(
            group.seedRow.detayAciklama ||
              group.seedRow.fisAciklama ||
              group.seedRow.aciklama ||
              ""
          ).trim(),
        };

  let updated = 0;
  const nextLuca = (lucaRows || []).map((item) => {
    if (!targetIds.has(item.id)) return item;
    const missing =
      !String(item.hesapKodu || "").trim() || item.riskDurumu === "HESAP_EKSIK";
    if (!missing) return item;
    const itemDir =
      typeof resolveMemoryLearnContext === "function"
        ? resolveMemoryLearnContext(item).direction
        : String(item.direction || "").trim().toUpperCase();
    if (group.direction && itemDir && group.direction !== itemDir) {
      return item;
    }
    updated += 1;
    return {
      ...item,
      hesapKodu: code,
      riskDurumu: "",
      missingHesapCategory: "",
      kontrolNotu: [
        String(item.kontrolNotu || "")
          .replace(/Hesap eşleşmesi bulunamadı/gi, "")
          .replace(/Kural bulunamadı/gi, "")
          .replace(/Cari hesap bulunamadı[^.|]*/gi, "")
          .replace(/\s+\|\s+/g, " | ")
          .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
          .trim(),
        "Çözüm Merkezi: cari gruba uygulandı",
      ]
        .filter(Boolean)
        .join(" | "),
    };
  });

  let learned = false;
  let learnPersistFailed = false;
  let learnSaveTrace = null;
  if (learn) {
    const learnResult = persistCariResolutionLearnWithReadback({
      seedRow: group.seedRow,
      accountCode: code,
      learnContext: learnCtx,
      companyId: selectedCompanyId,
      bankName: selectedBank,
      source: "cari-resolution-center",
    });
    learnSaveTrace = learnResult.saveTrace || null;
    learned = Boolean(learnResult.learnOk);
    learnPersistFailed = !learned;
  }

  const afterMissing = analyzeMissingHesapRows(nextLuca).missingCount;
  return {
    ok: true,
    lucaRows: nextLuca,
    updated,
    learned,
    learnPersistFailed,
    learnSaveTrace,
    beforeMissing,
    afterMissing,
    learnCtx,
    // expose for tests — same canonical builder Workbench used historically
    canonicalAnalysisKey: buildCariMemoryCanonicalKey(
      learnCtx.analysisKey || learnCtx.description,
      learnCtx.direction
    ),
  };
}
