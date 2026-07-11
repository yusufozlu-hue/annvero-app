import { parseGarantiEkstre } from "@/parsers/garantiParser";
import { parseVakifbankEkstre } from "@/parsers/vakifbankParser";
import { bankaKurallari } from "@/parsers/bankaKurallari";
import {
  formatParserDate,
  filterActiveBankParsedRows,
  mapParsedRowsToStandardMovements,
  mapSingleParsedRowToMovement,
  buildParserOnlyMovement,
  normalizeParserText,
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
export const ACCOUNTING_ANALYSIS_UNIQUE_CHUNK_SIZE = 12;
export const PARSER_PREVIEW_CHUNK_SIZE = 400;
/** Yalnızca CORE aşaması için süre bütçesi (mapping kesilmez) */
export const ACCOUNTING_ANALYSIS_TOTAL_BUDGET_MS = 60_000;
export const ACCOUNTING_CORE_BUDGET_MS = 20_000;

function yieldToMain(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildAnalysisMemoKey(raw = {}, fallbackDirection = "") {
  const description = normalizeParserText(
    String(raw?.aciklama || raw?.description || "")
  );
  const direction =
    raw?.yon === "CIKIS" ||
    raw?.direction === "CIKIS" ||
    fallbackDirection === "CIKIS"
      ? "CIKIS"
      : "GIRIS";
  return `${description}|${direction}`;
}

function cloneAnalyzedMovement(template, sourceMovement, index) {
  const raw = sourceMovement?.rawRow || template.rawRow || {};
  return {
    ...template,
    id: sourceMovement?.id || template.id || `analyzed-${index + 1}`,
    date: formatParserDate(raw?.tarih || raw?.date || sourceMovement?.date || template.date),
    amount: Math.abs(
      Number(raw?.tutar ?? raw?.amount ?? sourceMovement?.amount ?? template.amount ?? 0)
    ),
    description:
      String(raw?.aciklama || raw?.description || sourceMovement?.description || template.description || "").trim(),
    direction:
      raw?.yon === "CIKIS" ||
      raw?.direction === "CIKIS" ||
      sourceMovement?.direction === "CIKIS"
        ? "CIKIS"
        : template.direction || "GIRIS",
    rawRow: raw,
    sourceRowIndex: index,
    _accountingAnalyzed: true,
    _parserOnly: false,
    _analysisMemoHit: true,
  };
}

/**
 * AŞAMA 2 — muhasebe analizi (learning + kural + cari + CORE).
 * 1) Unique açıklama+yön grupları çıkar
 * 2) Unique'leri küçük chunk + yield ile analiz et
 * 3) Tüm hareketlere clone map et (yeniden analiz yok)
 * 4) CORE ayrı bütçe; timeout mapping sonuçlarını silmez / baştan çalıştırmaz
 */
export async function runAccountingAnalysisOnMovementsAsync(options = {}) {
  const {
    signal = null,
    onProgress = null,
    coreRowLimit = DEFAULT_CORE_PREVIEW_LIMIT,
  } = options;
  const mappingContext = buildMovementMappingContext(options);
  const sourceMovements = Array.isArray(options.movementRows) ? options.movementRows : [];
  const normalizedRows =
    options.normalizedRows || sourceMovements.map((m) => m.rawRow).filter(Boolean);
  const uniqueChunk = ACCOUNTING_ANALYSIS_UNIQUE_CHUNK_SIZE;
  const startedAt = Date.now();
  let lastProgressAt = 0;
  let rowErrors = 0;
  let memoHits = 0;
  let memoMisses = 0;
  const analysisMemo = new Map();
  const timings = {
    uniqueBuildMs: 0,
    learningMatchMs: 0,
    ruleMatchMs: 0,
    cariResolutionMs: 0,
    accountSuggestionMs: 0,
    mappingMs: 0,
    coreMs: 0,
    legacyFallbackMs: 0,
    totalAnalysisMs: 0,
  };
  const callCounts = {
    uniqueDescriptionCount: 0,
    findLearningMemoryMatch: 0,
    matchAccountingRule: 0,
    collectAccountSuggestions: 0,
    applyCariResolution: 0,
    coreApiBatches: 0,
    legacyFallbackRows: 0,
    memoHits: 0,
    memoMisses: 0,
  };

  const USER_REVIEW_MSG =
    "Bazı hareketler otomatik değerlendirilemedi ve incelemeye bırakıldı.";

  const emitProgress = (stage, detail, percent) => {
    const now = Date.now();
    if (now - lastProgressAt < 340 && percent < 100) return;
    lastProgressAt = now;
    onProgress?.({ stage, detail, percent });
  };

  // Phase 1: unique groups
  const uniqueBuildStarted = Date.now();
  emitProgress("Muhasebe Analizi", "Unique açıklama grupları hazırlanıyor", 3);
  const uniqueGroups = new Map();
  for (let index = 0; index < sourceMovements.length; index += 1) {
    const source = sourceMovements[index] || {};
    const raw = source.rawRow || normalizedRows[index] || null;
    const key = buildAnalysisMemoKey(raw || source, source.direction);
    if (!uniqueGroups.has(key)) {
      uniqueGroups.set(key, { raw, source, indices: [] });
    }
    uniqueGroups.get(key).indices.push(index);
  }
  const uniqueEntries = Array.from(uniqueGroups.entries());
  timings.uniqueBuildMs = Date.now() - uniqueBuildStarted;
  callCounts.uniqueDescriptionCount = uniqueEntries.length;
  await yieldToMain(0);

  emitProgress(
    "Muhasebe Analizi",
    `Unique 0/${uniqueEntries.length} · hareket ${sourceMovements.length}`,
    5
  );

  // Phase 2: analyze uniques only
  const mapStarted = Date.now();
  for (let offset = 0; offset < uniqueEntries.length; offset += uniqueChunk) {
    assertNotAborted(signal);
    const end = Math.min(offset + uniqueChunk, uniqueEntries.length);
    for (let u = offset; u < end; u += 1) {
      const [memoKey, group] = uniqueEntries[u];
      try {
        const raw = group.raw;
        if (!raw) {
          analysisMemo.set(memoKey, {
            ...(group.source || {}),
            _accountingAnalyzed: true,
            _parserOnly: false,
          });
          memoMisses += 1;
          continue;
        }
        const mapped = mapSingleParsedRowToMovement(raw, mappingContext, group.indices[0] || 0);
        analysisMemo.set(memoKey, {
          ...mapped,
          _accountingAnalyzed: true,
          _parserOnly: false,
          _analysisMemoHit: false,
        });
        memoMisses += 1;
      } catch (rowError) {
        rowErrors += 1;
        analysisMemo.set(memoKey, {
          ...(group.source || {}),
          _accountingAnalyzed: true,
          _parserOnly: false,
          mappingError: true,
          warning: `Analiz hatası: ${rowError?.message || "mapping"}`,
        });
      }
    }
    emitProgress(
      "Muhasebe Analizi",
      `Unique ${end}/${uniqueEntries.length} analiz · hareket ${sourceMovements.length}`,
      5 + Math.round((end / Math.max(uniqueEntries.length, 1)) * 60)
    );
    await yieldToMain(0);
  }
  timings.mappingMs = Date.now() - mapStarted;
  // Approximate: each unique miss runs learning/rule/cari/suggestions once
  callCounts.findLearningMemoryMatch = memoMisses;
  callCounts.matchAccountingRule = memoMisses;
  callCounts.collectAccountSuggestions = memoMisses;
  callCounts.applyCariResolution = memoMisses;
  callCounts.memoMisses = memoMisses;
  timings.learningMatchMs = Math.round(timings.mappingMs * 0.35);
  timings.ruleMatchMs = Math.round(timings.mappingMs * 0.25);
  timings.cariResolutionMs = Math.round(timings.mappingMs * 0.2);
  timings.accountSuggestionMs = Math.round(timings.mappingMs * 0.2);

  // Phase 3: expand to all movements (fast)
  emitProgress(
    "Muhasebe Analizi",
    `Sonuçlar ${sourceMovements.length} harekete uygulanıyor`,
    68
  );
  const analyzed = new Array(sourceMovements.length);
  for (let index = 0; index < sourceMovements.length; index += 1) {
    const source = sourceMovements[index] || {};
    const raw = source.rawRow || normalizedRows[index] || null;
    const memoKey = buildAnalysisMemoKey(raw || source, source.direction);
    const cached = analysisMemo.get(memoKey);
    if (cached) {
      memoHits += 1;
      analyzed[index] = cloneAnalyzedMovement(cached, source, index);
    } else {
      analyzed[index] = {
        ...source,
        sourceRowIndex: index,
        _accountingAnalyzed: true,
        _parserOnly: false,
        warning: [source.warning, "İncelemeye bırakıldı"].filter(Boolean).join(" | "),
      };
      callCounts.legacyFallbackRows += 1;
    }
    if (index > 0 && index % 250 === 0) {
      assertNotAborted(signal);
      await yieldToMain(0);
    }
  }
  callCounts.memoHits = memoHits;
  await yieldToMain(0);

  let movementRows = analyzed;
  let coreSummary = {
    enabled: false,
    core: 0,
    fallback: analyzed.length,
    total: analyzed.length,
    coreLimit: 0,
  };
  let coreTimedOut = false;

  if (isAnnveroCoreEnabled()) {
    assertNotAborted(signal);
    emitProgress(
      "Muhasebe Analizi",
      `CORE değerlendiriyor (ilk ${coreRowLimit} / ${sourceMovements.length})`,
      72
    );
    const coreStarted = Date.now();
    try {
      const mapped = await mapParsedRowsWithCoreFallback(
        normalizedRows,
        mappingContext,
        {
          companyId: options.selectedCompanyId,
          coreRowLimit,
          signal,
          batchTimeoutMs: CORE_BATCH_TIMEOUT_MS,
          totalBudgetMs: Math.min(CORE_TOTAL_BUDGET_MS, ACCOUNTING_CORE_BUDGET_MS),
          prebuiltMovements: analyzed,
        }
      );
      assertNotAborted(signal);
      // Preserve analyzed ids/accounts; overlay CORE only where matched
      const coreMovements = mapped.movements || [];
      movementRows = analyzed.map((row, index) => {
        const coreRow = coreMovements[index];
        if (!coreRow) return row;
        if (coreRow._coreMatched) {
          return {
            ...coreRow,
            id: row.id,
            sourceRowIndex: row.sourceRowIndex ?? index,
            _accountingAnalyzed: true,
            _parserOnly: false,
          };
        }
        // Keep legacy analysis; mark review-left only if CORE attempted and failed
        if (index < Number(coreRowLimit || 0) && (coreRow._coreFallback || coreRow._coreSkipped)) {
          return {
            ...row,
            ...coreRow,
            id: row.id,
            accountCode: row.accountCode || coreRow.accountCode,
            counterAccountCode: row.counterAccountCode || coreRow.counterAccountCode,
            matchedRule: row.matchedRule || coreRow.matchedRule,
            lucaDescription: row.lucaDescription || coreRow.lucaDescription,
            sourceRowIndex: row.sourceRowIndex ?? index,
            _accountingAnalyzed: true,
            _parserOnly: false,
          };
        }
        return {
          ...row,
          _coreSkipped: true,
          corePreview: coreRow.corePreview || row.corePreview,
        };
      });
      coreTimedOut = Boolean(mapped.coreSummary?.timedOut);
      coreSummary = {
        ...mapped.coreSummary,
        userWarning:
          mapped.coreSummary?.timedOut || mapped.coreSummary?.batchError
            ? USER_REVIEW_MSG
            : Number(coreRowLimit) > 0
              ? `CORE yalnızca ilk ${coreRowLimit} harekette denendi.`
              : "",
      };
      callCounts.coreApiBatches = Math.ceil(
        Math.min(Number(coreRowLimit) || 0, analyzed.length) / 20
      );
      if (mapped.coreSummary?.batchError || mapped.coreSummary?.timedOut) {
        callCounts.legacyFallbackRows += Number(mapped.coreSummary?.fallback) || 0;
      }
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      console.warn("[bank-parser] CORE overlay failed — analiz sonuçları korundu", error);
      const fallbackStarted = Date.now();
      // DO NOT re-analyze; keep analyzed results
      movementRows = analyzed.map((row) => ({
        ...row,
        _coreFallback: true,
        _coreSkipped: true,
      }));
      timings.legacyFallbackMs = Date.now() - fallbackStarted;
      coreSummary = {
        enabled: true,
        batchError: true,
        total: analyzed.length,
        coreLimit: coreRowLimit,
        userWarning: USER_REVIEW_MSG,
      };
      callCounts.legacyFallbackRows += analyzed.length;
    }
    timings.coreMs = Date.now() - coreStarted;
    await yieldToMain(0);
  }

  timings.totalAnalysisMs = Date.now() - startedAt;
  emitProgress("Muhasebe Analizi", "Tamamlandı", 100);

  console.info("[bank-parser] analysis timings", {
    ...timings,
    ...callCounts,
    movementCount: sourceMovements.length,
    coreTimedOut,
  });

  return {
    movementRows,
    coreSummary,
    processedCount: sourceMovements.length,
    rowErrors,
    timedOut: coreTimedOut,
    total: sourceMovements.length,
    timings,
    callCounts,
    uniqueDescriptionCount: uniqueEntries.length,
  };
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
 * Luca üretimi: analiz edilmiş movement'lardan doğrudan satır üretir.
 * Learning/kural/CORE yeniden çalıştırılmaz. İlk 50 satır erken önizleme.
 */
export async function buildLucaRowsFromMovementsAsync(
  movementRows = [],
  options = {},
  {
    chunkSize = LUCA_MOVEMENT_CHUNK_SIZE,
    signal = null,
    onProgress = null,
    onEarlyPreview = null,
    earlyPreviewCount = 50,
  } = {}
) {
  const selectedCompanyId = options.selectedCompanyId;
  const selectedBank = options.selectedBank;
  const learningMemory = options.learningMemory || [];
  const accountMemoryRecords = options.accountMemoryRecords;
  const declarationAccrualRecords = options.declarationAccrualRecords;
  const lucaContext = {
    firmaId: selectedCompanyId,
    kaynakAdi: selectedBank,
    creationSource: "bank_double_entry",
  };
  const bankName = String(selectedBank || "").trim().toUpperCase();
  const size = Math.max(25, Math.min(50, Number(chunkSize) || LUCA_MOVEMENT_CHUNK_SIZE));
  const alreadyAnalyzed = movementRows.some((row) => row?._accountingAnalyzed);
  const startedAt = Date.now();
  let lastProgressAt = 0;
  let earlyPreviewSent = false;
  const timings = {
    descriptionBuildMs: 0,
    movementMappingMs: 0,
    learningApplyMs: 0,
    accountMemoryMs: 0,
    declarationDistributionMs: 0,
    duplicateCheckMs: 0,
    sortingMs: 0,
    totalLucaMs: 0,
  };

  const emitProgress = (stage, detail, percent) => {
    const now = Date.now();
    if (now - lastProgressAt < 340 && percent < 100) return;
    lastProgressAt = now;
    onProgress?.({ stage, detail, percent });
  };

  const maybeEarlyPreview = (rows) => {
    if (earlyPreviewSent || !onEarlyPreview) return;
    if (rows.length < earlyPreviewCount) return;
    earlyPreviewSent = true;
    onEarlyPreview(rows.slice(0, earlyPreviewCount), {
      partial: true,
      totalSoFar: rows.length,
    });
  };

  emitProgress(BANK_PARSE_STAGES.LUCA, "Luca satırları hazırlanıyor", 10);

  let baseRows = [];
  const mapStarted = Date.now();
  if (bankName === "TEB") {
    assertNotAborted(signal);
    await yieldToMain();
    baseRows = bankMovementsToStandardLucaRows(movementRows, lucaContext);
    maybeEarlyPreview(baseRows);
    await yieldToMain();
  } else {
    for (let offset = 0; offset < movementRows.length; offset += size) {
      assertNotAborted(signal);
      const end = Math.min(offset + size, movementRows.length);
      for (let index = offset; index < end; index += 1) {
        baseRows.push(
          ...bankMovementToStandardLucaRows(movementRows[index], index + 1, {
            ...lucaContext,
            sourceRowIndex: index,
          })
        );
      }
      maybeEarlyPreview(baseRows);
      emitProgress(
        BANK_PARSE_STAGES.LUCA,
        `Luca ${end}/${movementRows.length} hareket → ${baseRows.length} satır`,
        10 + Math.round((end / Math.max(movementRows.length, 1)) * 55)
      );
      await yieldToMain();
    }
    const sortStarted = Date.now();
    baseRows = sortStandardLucaRows(baseRows);
    timings.sortingMs = Date.now() - sortStarted;
  }
  timings.movementMappingMs = Date.now() - mapStarted;
  timings.descriptionBuildMs = timings.movementMappingMs;

  assertNotAborted(signal);
  let workingRows = ensureStandardLucaRowIds(baseRows);
  maybeEarlyPreview(workingRows);

  // Analiz zaten yapıldıysa learning/kural/CORE tekrarlanmaz
  if (!alreadyAnalyzed) {
    const learningStarted = Date.now();
    const learningRows = [];
    for (let offset = 0; offset < workingRows.length; offset += size) {
      assertNotAborted(signal);
      const slice = workingRows.slice(offset, offset + size);
      learningRows.push(
        ...applyLearningMemoryToStandardLucaRows(slice, learningMemory, {
          firmaId: selectedCompanyId,
          kaynakTipi: KAYNAK_TIPI.BANKA,
          kaynakAdi: selectedBank,
        })
      );
      emitProgress(
        "Öğrenme",
        `Hafıza ${Math.min(offset + size, workingRows.length)}/${workingRows.length}`,
        70 + Math.round(((offset + size) / Math.max(workingRows.length, 1)) * 10)
      );
      await yieldToMain();
    }
    workingRows = learningRows;
    timings.learningApplyMs = Date.now() - learningStarted;
  } else {
    timings.learningApplyMs = 0;
    emitProgress(BANK_PARSE_STAGES.LUCA, "Analiz sonuçları kullanılıyor (tekrar eşleşme yok)", 72);
  }

  assertNotAborted(signal);
  const accountStarted = Date.now();
  const needsAccountFill = workingRows.some((row) => !String(row.hesapKodu || "").trim());
  if (needsAccountFill) {
    const memoryRows = [];
    for (let offset = 0; offset < workingRows.length; offset += size) {
      assertNotAborted(signal);
      const slice = workingRows.slice(offset, offset + size);
      memoryRows.push(
        ...applyAccountMemoryV1RecordsToRows(slice, accountMemoryRecords, {
          firmaId: selectedCompanyId,
          kaynakAdi: selectedBank,
        })
      );
      await yieldToMain();
    }
    workingRows = memoryRows;
    if (!alreadyAnalyzed) {
      workingRows = applySmartBankSuggestionsToRows(workingRows, {
        companyPlans: options.companyPlans,
        selectedBank,
        selectedCompanyId,
      });
    }
  }
  timings.accountMemoryMs = Date.now() - accountStarted;
  await yieldToMain();

  assertNotAborted(signal);
  emitProgress(BANK_PARSE_STAGES.LUCA, "Beyanname dağıtımı", 88);
  const declarationStarted = Date.now();
  const declarationResult = applyDeclarationAccrualDistributionToRows(
    workingRows,
    declarationAccrualRecords,
    {
      companyId: selectedCompanyId,
      selectedBank,
    }
  );
  timings.declarationDistributionMs = Date.now() - declarationStarted;
  await yieldToMain();

  assertNotAborted(signal);
  const unrecognizedItems = alreadyAnalyzed
    ? []
    : buildUnrecognizedQueueItems(declarationResult.rows, {
        companyId: selectedCompanyId,
        sourceModule: "banka",
        sourceBank: selectedBank,
        learningMemory,
      });

  timings.totalLucaMs = Date.now() - startedAt;
  emitProgress(BANK_PARSE_STAGES.LUCA, "Luca satırları tamamlandı", 100);

  const rows = declarationResult.rows || [];
  const perMovement = new Map();
  for (const row of rows) {
    const key = String(row.sourceMovementId || row._movementId || "");
    if (!key) continue;
    perMovement.set(key, (perMovement.get(key) || 0) + 1);
  }
  let pairs2 = 0;
  let singles = 0;
  let triplesOrMore = 0;
  for (const count of perMovement.values()) {
    if (count === 2) pairs2 += 1;
    else if (count === 1) singles += 1;
    else triplesOrMore += 1;
  }

  console.info("[bank-parser] luca timings", {
    ...timings,
    movementCount: movementRows.length,
    lucaRows: rows.length,
    alreadyAnalyzed,
    pairs2,
    singles,
    triplesOrMore,
  });

  return {
    standardLucaRows: rows,
    unrecognizedItems,
    declarationSummary: declarationResult.summary,
    timings,
    lucaStats: {
      movementCount: movementRows.length,
      lucaRows: rows.length,
      expectedDoubleEntry: movementRows.length * 2,
      movementsWith2Rows: pairs2,
      movementsWith1Row: singles,
      movementsWith3PlusRows: triplesOrMore,
      alreadyAnalyzed,
    },
  };
}

export { formatParserDate };
