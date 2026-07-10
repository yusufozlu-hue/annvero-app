import { parseGarantiEkstre } from "@/parsers/garantiParser";
import { parseVakifbankEkstre } from "@/parsers/vakifbankParser";
import { bankaKurallari } from "@/parsers/bankaKurallari";
import {
  formatParserDate,
  filterActiveBankParsedRows,
  mapParsedRowsToStandardMovements,
  mapSingleParsedRowToMovement,
  buildParserOnlyMovement,
} from "@/src/utils/bankMovementMapper";
import { enrichTebParsedRows } from "@/src/utils/tebHavaleGrouping";
import {
  bankMovementToStandardLucaRows,
  bankMovementsToStandardLucaRows,
  ensureStandardLucaRowIds,
  KAYNAK_TIPI,
  sortStandardLucaRows,
} from "@/src/utils/standardLucaRow";
import { applyLearningMemoryToStandardLucaRows } from "@/src/utils/bankLearningMemory";
import { buildUnrecognizedQueueItems } from "@/src/utils/bankParserLearningPipeline";
import { applyAccountMemoryV1RecordsToRows } from "@/src/utils/accountMemoryV1";
import { applySmartBankSuggestionsToRows } from "@/src/utils/bankSmartSuggestions";
import { applyDeclarationAccrualDistributionToRows } from "@/src/utils/beyannameTahakkukEngine";
import {
  mapParsedRowsWithCoreFallback,
  isAnnveroCoreEnabled,
  DEFAULT_CORE_PREVIEW_LIMIT,
  CORE_BATCH_TIMEOUT_MS,
  CORE_TOTAL_BUDGET_MS,
} from "@/src/utils/bankCoreBridge";
import {
  BANK_PARSE_STAGES,
  normalizeBankParsedRow,
  parseGenericBankEkstre,
  parseMoney,
  parseRowsForBank as parseRowsForBankWorkerSafe,
} from "@/src/utils/bankParserWorkerCore";
import { resolveParserName } from "@/src/utils/financialSourceArchitecture";

/** Önizleme / Luca / muhasebe analiz chunk boyutları */
export const MOVEMENT_MAP_CHUNK_SIZE = 40;
export const LUCA_MOVEMENT_CHUNK_SIZE = 40;
export const ACCOUNTING_ANALYSIS_CHUNK_SIZE = 100;
export const PARSER_PREVIEW_CHUNK_SIZE = 400;

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertNotAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("İşlem iptal edildi.");
    error.name = "AbortError";
    throw error;
  }
}

export {
  BANK_PARSE_STAGES,
  normalizeBankParsedRow,
  parseGenericBankEkstre,
  parseMoney,
};

/** Ana thread: TEB için tam enrich; worker kendi lite sürümünü kullanır */
export function parseRowsForBank(sheetRows, selectedBank) {
  if (selectedBank === "GARANTI") return parseGarantiEkstre(sheetRows);
  if (selectedBank === "VAKIFBANK") return parseVakifbankEkstre(sheetRows);
  if (selectedBank === "TEB") {
    return enrichTebParsedRows(parseGenericBankEkstre(sheetRows, "TEB"));
  }
  if (selectedBank === "KUVEYT") return parseGenericBankEkstre(sheetRows, "KUVEYT");
  if (selectedBank === "ZIRAAT") return parseGenericBankEkstre(sheetRows, "ZIRAAT");
  return parseRowsForBankWorkerSafe(sheetRows, selectedBank);
}

export function buildBankParserResult({
  parsedRows = [],
  selectedBank,
  selectedCompany,
  companyPlans,
  companyRules,
  learningMemory,
  accountMemoryRecords,
  accountingRules,
  declarationAccrualRecords,
  selectedCompanyId,
  sourceFileName = "",
  sourceFileType = "xlsx",
  sourceType = "bank",
}) {
  const normalizedRows = parsedRows.map((row) =>
    normalizeBankParsedRow(row, selectedBank)
  );

  return buildBankParserResultFromNormalizedRows({
    normalizedRows,
    selectedBank,
    selectedCompany,
    companyPlans,
    companyRules,
    learningMemory,
    accountMemoryRecords,
    accountingRules,
    declarationAccrualRecords,
    selectedCompanyId,
    sourceFileName,
    sourceFileType,
    sourceType,
  });
}

function buildMovementMappingContext(options = {}) {
  return {
    selectedCompany: options.selectedCompany,
    companyPlans: options.companyPlans,
    companyRules: options.companyRules,
    selectedBank: options.selectedBank,
    learningMemory: options.learningMemory,
    accountingRules: options.accountingRules,
    selectedCompanyId: options.selectedCompanyId,
    sourceFileName: options.sourceFileName,
    sourceType: options.sourceType || "bank",
    currency: options.currency || "TRY",
    legacyRules: bankaKurallari,
  };
}

export function buildBankParserResultFromNormalizedRows({
  normalizedRows = [],
  selectedBank,
  selectedCompany,
  companyPlans,
  companyRules,
  learningMemory,
  accountMemoryRecords,
  accountingRules,
  declarationAccrualRecords,
  selectedCompanyId,
  sourceFileName = "",
  sourceFileType = "xlsx",
  sourceType = "bank",
  movementRows: prebuiltMovementRows = null,
  coreSummary = null,
}) {
  const movementRows =
    prebuiltMovementRows ||
    mapParsedRowsToStandardMovements(normalizedRows, buildMovementMappingContext({
      selectedCompany,
      companyPlans,
      companyRules,
      selectedBank,
      learningMemory,
      accountingRules,
      selectedCompanyId,
      sourceFileName,
      sourceType,
    }));

  const baseRows = bankMovementsToStandardLucaRows(movementRows, {
    firmaId: selectedCompanyId,
    kaynakAdi: selectedBank,
  });

  const learningRows = applyLearningMemoryToStandardLucaRows(
    ensureStandardLucaRowIds(baseRows),
    learningMemory,
    {
      firmaId: selectedCompanyId,
      kaynakTipi: KAYNAK_TIPI.BANKA,
      kaynakAdi: selectedBank,
    }
  );

  const memoryRows = applyAccountMemoryV1RecordsToRows(
    learningRows,
    accountMemoryRecords,
    {
      firmaId: selectedCompanyId,
      kaynakAdi: selectedBank,
    }
  );

  const smartRows = applySmartBankSuggestionsToRows(memoryRows, {
    companyPlans,
    selectedBank,
    selectedCompanyId,
  });

  const declarationResult = applyDeclarationAccrualDistributionToRows(
    smartRows,
    declarationAccrualRecords,
    {
      companyId: selectedCompanyId,
      selectedBank,
    }
  );

  const standardLucaRows = declarationResult.rows;

  const unrecognizedItems = buildUnrecognizedQueueItems(standardLucaRows, {
    companyId: selectedCompanyId,
    sourceModule: "banka",
    sourceBank: selectedBank,
    learningMemory,
  });

  // NFT/dashboard worker içinde üretilmez (import crash + structured clone riski).
  // Ana thread buildBankCardOpsSideOutput ile doldurur.
  return {
    normalizedRows,
    movementRows,
    standardLucaRows,
    unrecognizedItems,
    declarationSummary: declarationResult.summary,
    financialTransactions: null,
    opsDashboard: null,
    opsMeta: {
      selectedBank,
      selectedCompanyId,
      sourceFileName,
      sourceFileType,
      sourceType,
      parserName: resolveParserName(selectedBank, sourceType),
      annveroCoreEnabled: isAnnveroCoreEnabled(),
      coreSummary,
    },
  };
}

/**
 * ANNVERO CORE etkinse async karar pipeline; değilse senkron legacy.
 * Parser/Luca/öğrenme akışı buildBankParserResultFromNormalizedRows içinde aynı kalır.
 */
export async function buildBankParserResultFromNormalizedRowsAsync(options = {}) {
  const mappingContext = buildMovementMappingContext(options);

  let movementRows = null;
  let coreSummary = null;

  if (isAnnveroCoreEnabled()) {
    const mapped = await mapParsedRowsWithCoreFallback(
      options.normalizedRows || [],
      mappingContext,
      {
        companyId: options.selectedCompanyId,
        coreRowLimit: options.coreRowLimit,
        signal: options.signal,
        batchTimeoutMs: options.batchTimeoutMs ?? CORE_BATCH_TIMEOUT_MS,
        totalBudgetMs: options.totalBudgetMs ?? CORE_TOTAL_BUDGET_MS,
      }
    );
    movementRows = mapped.movements;
    coreSummary = mapped.coreSummary;
  }

  return buildBankParserResultFromNormalizedRows({
    ...options,
    movementRows,
    coreSummary,
  });
}

/**
 * AŞAMA 1 — yalnızca parser hareketleri.
 * CORE / learning / kural / cari / Luca YOK.
 */
export async function buildParserPreviewFromNormalizedRowsAsync(options = {}) {
  const { signal = null, onProgress = null } = options;
  const normalizedRows = options.normalizedRows || [];
  const activeRows = filterActiveBankParsedRows(normalizedRows);
  const context = { selectedBank: options.selectedBank };
  const chunkSize = PARSER_PREVIEW_CHUNK_SIZE;
  let lastProgressAt = 0;

  onProgress?.({
    stage: "Önizleme hazırlanıyor",
    detail: "Hareket nesneleri oluşturuluyor",
    percent: 40,
  });

  const movementRows = [];
  for (let offset = 0; offset < activeRows.length; offset += chunkSize) {
    assertNotAborted(signal);
    const end = Math.min(offset + chunkSize, activeRows.length);
    for (let index = offset; index < end; index += 1) {
      movementRows.push(buildParserOnlyMovement(activeRows[index], context, index));
    }
    const now = Date.now();
    if (now - lastProgressAt >= 250 || end >= activeRows.length) {
      lastProgressAt = now;
      onProgress?.({
        stage: "Önizleme hazırlanıyor",
        detail: `${end}/${activeRows.length} hareket`,
        percent: 40 + Math.round((end / Math.max(activeRows.length, 1)) * 50),
      });
    }
    await yieldToMain();
  }

  onProgress?.({
    stage: "Önizleme hazır",
    detail: `${movementRows.length} hareket`,
    percent: 100,
  });

  return {
    normalizedRows,
    movementRows,
    standardLucaRows: [],
    unrecognizedItems: [],
    declarationSummary: null,
    financialTransactions: null,
    opsDashboard: null,
    opsMeta: {
      selectedBank: options.selectedBank,
      selectedCompanyId: options.selectedCompanyId,
      sourceFileName: options.sourceFileName || "",
      sourceFileType: options.sourceFileType || "xlsx",
      sourceType: options.sourceType || "bank",
      parserName: resolveParserName(
        options.selectedBank,
        options.sourceType || "bank"
      ),
      annveroCoreEnabled: isAnnveroCoreEnabled(),
      coreSummary: null,
      previewOnly: true,
      parserOnly: true,
    },
  };
}

/** @deprecated Aşama 1 artık buildParserPreviewFromNormalizedRowsAsync kullanır */
export async function buildMovementPreviewFromNormalizedRowsAsync(options = {}) {
  return buildParserPreviewFromNormalizedRowsAsync(options);
}

/**
 * AŞAMA 2 — muhasebe analizi (learning + kural + cari + CORE).
 * Chunk 100 + yield; progress throttle.
 */
export async function runAccountingAnalysisOnMovementsAsync(options = {}) {
  const {
    signal = null,
    onProgress = null,
    coreRowLimit = DEFAULT_CORE_PREVIEW_LIMIT,
  } = options;
  const mappingContext = buildMovementMappingContext(options);
  const sourceMovements = Array.isArray(options.movementRows)
    ? options.movementRows
    : [];
  const normalizedRows =
    options.normalizedRows ||
    sourceMovements.map((m) => m.rawRow).filter(Boolean);
  const chunkSize = ACCOUNTING_ANALYSIS_CHUNK_SIZE;
  let lastProgressAt = 0;

  onProgress?.({
    stage: "Muhasebe Analizi",
    detail: "Learning / kural / cari uygulanıyor",
    percent: 5,
  });

  const analyzed = [];
  for (let offset = 0; offset < sourceMovements.length; offset += chunkSize) {
    assertNotAborted(signal);
    const end = Math.min(offset + chunkSize, sourceMovements.length);
    for (let index = offset; index < end; index += 1) {
      const raw = sourceMovements[index]?.rawRow || normalizedRows[index];
      if (!raw) {
        analyzed.push({
          ...sourceMovements[index],
          _accountingAnalyzed: true,
          _parserOnly: false,
        });
        continue;
      }
      const mapped = mapSingleParsedRowToMovement(raw, mappingContext, index);
      analyzed.push({
        ...mapped,
        id: sourceMovements[index]?.id || mapped.id,
        _accountingAnalyzed: true,
        _parserOnly: false,
      });
    }
    const now = Date.now();
    if (now - lastProgressAt >= 250 || end >= sourceMovements.length) {
      lastProgressAt = now;
      onProgress?.({
        stage: "Muhasebe Analizi",
        detail: `${end}/${sourceMovements.length} hareket analiz edildi`,
        percent: 5 + Math.round((end / Math.max(sourceMovements.length, 1)) * 60),
      });
    }
    await yieldToMain();
  }

  let movementRows = analyzed;
  let coreSummary = {
    enabled: false,
    core: 0,
    fallback: analyzed.length,
    total: analyzed.length,
    coreLimit: 0,
  };

  if (isAnnveroCoreEnabled()) {
    onProgress?.({
      stage: "Muhasebe Analizi",
      detail: "CORE eşleştirme",
      percent: 70,
    });
    try {
      const mapped = await mapParsedRowsWithCoreFallback(
        normalizedRows,
        mappingContext,
        {
          companyId: options.selectedCompanyId,
          coreRowLimit,
          signal,
          batchTimeoutMs: CORE_BATCH_TIMEOUT_MS,
          totalBudgetMs: CORE_TOTAL_BUDGET_MS,
          prebuiltMovements: analyzed,
        }
      );
      assertNotAborted(signal);
      movementRows = (mapped.movements || []).map((row) => ({
        ...row,
        _accountingAnalyzed: true,
        _parserOnly: false,
      }));
      coreSummary = mapped.coreSummary;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      console.warn("[bank-parser] CORE analysis overlay failed", error);
      coreSummary = {
        enabled: true,
        batchError: true,
        total: analyzed.length,
        userWarning: "CORE yanıt vermedi — legacy analiz korundu.",
      };
    }
    await yieldToMain();
  }

  onProgress?.({
    stage: "Muhasebe Analizi",
    detail: "Tamamlandı",
    percent: 100,
  });

  return { movementRows, coreSummary };
}

/**
 * Yalnızca CORE yeniden eşleştirme — Luca üretmez
 */
export async function remapMovementsWithCoreAsync(options = {}) {
  const mappingContext = buildMovementMappingContext(options);
  return mapParsedRowsWithCoreFallback(options.normalizedRows || [], mappingContext, {
    companyId: options.selectedCompanyId,
    coreRowLimit: options.coreRowLimit,
    signal: options.signal,
    batchTimeoutMs: options.batchTimeoutMs ?? CORE_BATCH_TIMEOUT_MS,
    totalBudgetMs: options.totalBudgetMs ?? CORE_TOTAL_BUDGET_MS,
    prebuiltMovements: options.movementRows,
  });
}

/**
 * Luca üretimi: kullanıcı butonu ile; muhasebe kuralları aynı, chunk + yield.
 */
export async function buildLucaRowsFromMovementsAsync(
  movementRows = [],
  options = {},
  { chunkSize = LUCA_MOVEMENT_CHUNK_SIZE, signal = null, onProgress = null } = {}
) {
  const selectedCompanyId = options.selectedCompanyId;
  const selectedBank = options.selectedBank;
  const learningMemory = options.learningMemory || [];
  const accountMemoryRecords = options.accountMemoryRecords;
  const declarationAccrualRecords = options.declarationAccrualRecords;
  const lucaContext = {
    firmaId: selectedCompanyId,
    kaynakAdi: selectedBank,
  };
  const bankName = String(selectedBank || "").trim().toUpperCase();
  const size = Math.max(25, Math.min(50, Number(chunkSize) || LUCA_MOVEMENT_CHUNK_SIZE));

  onProgress?.({
    stage: BANK_PARSE_STAGES.LUCA,
    detail: "Luca satırları hazırlanıyor",
    percent: 10,
  });

  let baseRows = [];
  if (bankName === "TEB") {
    assertNotAborted(signal);
    await yieldToMain();
    baseRows = bankMovementsToStandardLucaRows(movementRows, lucaContext);
    await yieldToMain();
  } else {
    for (let offset = 0; offset < movementRows.length; offset += size) {
      assertNotAborted(signal);
      const end = Math.min(offset + size, movementRows.length);
      for (let index = offset; index < end; index += 1) {
        baseRows.push(
          ...bankMovementToStandardLucaRows(
            movementRows[index],
            index + 1,
            lucaContext
          )
        );
      }
      onProgress?.({
        stage: BANK_PARSE_STAGES.LUCA,
        detail: `Luca ${end}/${movementRows.length} hareket`,
        percent: 10 + Math.round((end / Math.max(movementRows.length, 1)) * 35),
      });
      await yieldToMain();
    }
    baseRows = sortStandardLucaRows(baseRows);
  }

  assertNotAborted(signal);
  const withIds = ensureStandardLucaRowIds(baseRows);
  const learningRows = [];
  for (let offset = 0; offset < withIds.length; offset += size) {
    assertNotAborted(signal);
    const slice = withIds.slice(offset, offset + size);
    learningRows.push(
      ...applyLearningMemoryToStandardLucaRows(slice, learningMemory, {
        firmaId: selectedCompanyId,
        kaynakTipi: KAYNAK_TIPI.BANKA,
        kaynakAdi: selectedBank,
      })
    );
    onProgress?.({
      stage: "Öğrenme",
      detail: `Hafıza ${Math.min(offset + size, withIds.length)}/${withIds.length}`,
      percent: 50 + Math.round(((offset + size) / Math.max(withIds.length, 1)) * 15),
    });
    await yieldToMain();
  }

  assertNotAborted(signal);
  const memoryRows = [];
  for (let offset = 0; offset < learningRows.length; offset += size) {
    assertNotAborted(signal);
    const slice = learningRows.slice(offset, offset + size);
    memoryRows.push(
      ...applyAccountMemoryV1RecordsToRows(slice, accountMemoryRecords, {
        firmaId: selectedCompanyId,
        kaynakAdi: selectedBank,
      })
    );
    await yieldToMain();
  }

  assertNotAborted(signal);
  onProgress?.({
    stage: "Öğrenme",
    detail: "Akıllı öneriler uygulanıyor",
    percent: 78,
  });
  const smartRows = applySmartBankSuggestionsToRows(memoryRows, {
    companyPlans: options.companyPlans,
    selectedBank,
    selectedCompanyId,
  });
  await yieldToMain();

  assertNotAborted(signal);
  const declarationResult = applyDeclarationAccrualDistributionToRows(
    smartRows,
    declarationAccrualRecords,
    {
      companyId: selectedCompanyId,
      selectedBank,
    }
  );
  await yieldToMain();

  assertNotAborted(signal);
  const unrecognizedItems = buildUnrecognizedQueueItems(declarationResult.rows, {
    companyId: selectedCompanyId,
    sourceModule: "banka",
    sourceBank: selectedBank,
    learningMemory,
  });

  onProgress?.({
    stage: BANK_PARSE_STAGES.LUCA,
    detail: "Luca satırları tamamlandı",
    percent: 100,
  });

  return {
    standardLucaRows: declarationResult.rows,
    unrecognizedItems,
    declarationSummary: declarationResult.summary,
  };
}

export { formatParserDate };
