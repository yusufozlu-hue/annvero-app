/**
 * Çözüm Merkezi yeşil buton uygulama gövdesi (React state’siz).
 * BankParserWorkbench.handleApplyCariResolutionGroup bunu çağırır.
 *
 * Öğrenme: server learning_memory yetkili → local V2 cache activate.
 * `skipServerPersist` yalnız test enjeksiyonu (`__testOnly`); production UI’dan gelmez.
 */
import {
  buildCariMemoryCanonicalKey,
  deleteAccountMemoryV2Record,
  loadAccountMemoryV2Records,
  persistCariResolutionLearnWithReadback,
} from "@/src/utils/accountMemoryV2";
import { persistUserConfirmedAccountingMemory } from "@/src/utils/accountingMemoryV1";
import {
  analyzeMissingHesapRows,
} from "@/src/utils/previewExportValidation";
import {
  createLearningMemoryRecordDetailed,
  updateLearningMemoryRecord,
} from "@/src/utils/learningMemory";
import { shouldApplyVadeliOnboardingRow } from "@/src/utils/vadeliResolutionOnboarding";

/**
 * Production’da asla true olmamalı. Yalnız birim testleri `__testOnly.skipServerPersist` verir.
 */
function resolveTestSkipServerPersist(options = {}) {
  const flag = Boolean(options?.__testOnly?.skipServerPersist);
  if (!flag) return false;
  // Node test ortamı dışında sessizce yok say
  if (typeof process === "undefined") return false;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}

export async function runCariResolutionGroupApply({
  lucaRows = [],
  group,
  accountCode,
  learn = false,
  selectedCompanyId = "",
  selectedBank = "",
  resolveMemoryLearnContext,
  existingLearningRecords = [],
  createRecord = createLearningMemoryRecordDetailed,
  updateRecord = updateLearningMemoryRecord,
  currency = "TRY",
  company = null,
  accountPlanCodes = null,
  /** @deprecated kullanma — yalnız __testOnly */
  skipServerPersist = false,
  __testOnly = null,
} = {}) {
  const testSkip = resolveTestSkipServerPersist({
    __testOnly: __testOnly || (skipServerPersist ? { skipServerPersist: true } : null),
  });

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
      serverWriteCount: 0,
      warning: null,
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
    if (!shouldApplyVadeliOnboardingRow(item, group)) return item;
    const missing =
      !String(item.hesapKodu || "").trim() || item.riskDurumu === "HESAP_EKSIK";
    if (!missing && !group.allowOverwriteFilled) return item;
    const itemDir =
      typeof resolveMemoryLearnContext === "function"
        ? resolveMemoryLearnContext(item).direction
        : String(item.direction || "").trim().toUpperCase();
    if (
      group.direction &&
      itemDir &&
      group.direction !== itemDir &&
      !group.vadeliOnboardingStep
    ) {
      return item;
    }
    updated += 1;
    const applyNote = group.vadeliOnboardingStep
      ? `Çözüm Merkezi: ${group.vadeliOnboardingStep}`
      : "Çözüm Merkezi: cari gruba uygulandı";
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
          .replace(/Vadeli mevduat hesabı eşleştirilmedi/gi, "")
          .replace(/Faiz stopajı hesabı seçilmeli/gi, "")
          .replace(/\s+\|\s+/g, " | ")
          .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
          .trim(),
        applyNote,
      ]
        .filter(Boolean)
        .join(" | "),
      memoryDecisionSource: learn ? "Öğrenen Hafıza" : item.memoryDecisionSource,
    };
  });

  let learned = false;
  let learnPersistFailed = false;
  let learnSaveTrace = null;
  let serverWriteCount = 0;
  let warning = null;

  if (learn) {
    if (testSkip) {
      // Yalnız birim test: local read-back zinciri
      const localResult = persistCariResolutionLearnWithReadback({
        seedRow: group.seedRow,
        accountCode: code,
        learnContext: learnCtx,
        companyId: selectedCompanyId,
        bankName: selectedBank,
        source: "cari-resolution-center",
      });
      learnSaveTrace = localResult.saveTrace || null;
      learned = Boolean(localResult.learnOk);
      learnPersistFailed = !learned;
    } else {
      const persistResult = await persistUserConfirmedAccountingMemory({
        companyId: selectedCompanyId,
        bankId: selectedBank,
        bankName: selectedBank,
        direction: learnCtx.direction,
        transactionType:
          learnCtx.transactionType || group.seedRow.transactionType || "",
        currency,
        descriptionOrKey: learnCtx.description,
        analysisKey: learnCtx.analysisKey || learnCtx.description,
        accountCode: code,
        company,
        accountPlanCodes,
        source: "cari-resolution-center",
        seedRow: group.seedRow,
        rememberForCompany: true,
        existingServerRows: existingLearningRecords,
        createRecord,
        updateRecord,
      });
      learned = Boolean(persistResult.learned && persistResult.persisted);
      learnPersistFailed = !persistResult.persisted;
      serverWriteCount = Number(persistResult.serverWriteCount || 0);
      warning = persistResult.warning || null;
      learnSaveTrace = {
        build: buildCariMemoryCanonicalKey(
          learnCtx.analysisKey || learnCtx.description,
          learnCtx.direction
        ),
        checkbox: true,
        shouldLearn: true,
        source: "cari-resolution-center",
        persisted: Boolean(persistResult.persisted),
        serverWriteCount,
        serverWriteAttempt: Number(persistResult.serverWriteAttempt || 0),
        activeCache: Number(persistResult.activeCache || 0),
        signature: persistResult.signature || "",
        rejectReason: persistResult.rejectReason || "",
        immediateReadBack: {
          autoApply: Boolean(persistResult.persisted),
          rejectReason: persistResult.rejectReason || "",
        },
        supersededCount: persistResult.superseded ? 1 : 0,
        activeCanonicalCountAfterSave: Number(persistResult.activeCache || 0),
      };

      // Eski local-only aktif BSA olmayan çakışan kayıtları pasifleştir (fail-safe)
      if (!persistResult.persisted) {
        const dangling = loadAccountMemoryV2Records().filter(
          (r) =>
            r.companyId === selectedCompanyId &&
            r.serverPersisted !== true &&
            (r.status === "pending" ||
              r.analysisKey === (learnCtx.analysisKey || learnCtx.description))
        );
        for (const row of dangling) {
          deleteAccountMemoryV2Record(row.id, { soft: true });
        }
      }
    }
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
    serverWriteCount,
    warning,
  };
}
