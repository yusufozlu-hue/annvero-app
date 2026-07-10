import { parseGarantiEkstre } from "@/parsers/garantiParser";
import { parseVakifbankEkstre } from "@/parsers/vakifbankParser";
import { bankaKurallari } from "@/parsers/bankaKurallari";
import {
  formatParserDate,
  mapParsedRowsToStandardMovements,
  mapParsedRowsToStandardMovementsAsync,
} from "@/src/utils/bankMovementMapper";
import { enrichTebParsedRows } from "@/src/utils/tebHavaleGrouping";
import {
  bankMovementToStandardLucaRows,
  bankMovementsToStandardLucaRows,
  ensureStandardLucaRowIds,
  sortStandardLucaRows,
  KAYNAK_TIPI,
} from "@/src/utils/standardLucaRow";
import {
  applyLearningMemoryToStandardLucaRows,
  applyLearningMemoryToStandardLucaRowsAsync,
  buildLearningMemoryIndex,
} from "@/src/utils/bankLearningMemory";
import { buildUnrecognizedQueueItems } from "@/src/utils/bankParserLearningPipeline";
import { applyAccountMemoryV1RecordsToRows } from "@/src/utils/accountMemoryV1";
import { applySmartBankSuggestionsToRows } from "@/src/utils/bankSmartSuggestions";
import { applyDeclarationAccrualDistributionToRows } from "@/src/utils/beyannameTahakkukEngine";
import {
  mapParsedRowsWithCoreFallback,
  isAnnveroCoreEnabled,
} from "@/src/utils/bankCoreBridge";
import {
  BANK_PARSE_STAGES,
  normalizeBankParsedRow,
  parseGenericBankEkstre,
  parseMoney,
  parseRowsForBank as parseRowsForBankWorkerSafe,
} from "@/src/utils/bankParserWorkerCore";
import { resolveParserName } from "@/src/utils/financialSourceArchitecture";
import {
  assertNotAborted,
  createStageTimer,
  isDevTelemetryEnabled,
  mapInChunksAsync,
  ParseAbortError,
  yieldToMain,
} from "@/src/utils/asyncChunkProcess";
import { prepareAccountingRulesForMatch } from "@/src/utils/accountingRuleEngine";

export {
  BANK_PARSE_STAGES,
  normalizeBankParsedRow,
  parseGenericBankEkstre,
  parseMoney,
  ParseAbortError,
};

const PIPELINE_CHUNK_SIZE = 40;

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
  const preparedAccountingRules =
    options.preparedAccountingRules ||
    prepareAccountingRulesForMatch(options.accountingRules || [], {
      companyId: options.selectedCompany?.id || options.selectedCompanyId,
      kaynakTipi: "Banka",
    });

  return {
    selectedCompany: options.selectedCompany,
    companyPlans: options.companyPlans,
    companyRules: options.companyRules,
    selectedBank: options.selectedBank,
    learningMemory: options.learningMemory,
    accountingRules: options.accountingRules,
    preparedAccountingRules,
    selectedCompanyId: options.selectedCompanyId,
    sourceFileName: options.sourceFileName,
    sourceType: options.sourceType || "bank",
    currency: options.currency || "TRY",
    legacyRules: bankaKurallari,
  };
}

async function bankMovementsToStandardLucaRowsChunked(
  movements = [],
  context = {},
  { chunkSize = PIPELINE_CHUNK_SIZE, signal = null, onChunk = null } = {}
) {
  const bankName = String(context.kaynakAdi || context.bankName || "")
    .trim()
    .toUpperCase();

  if (bankName === "TEB") {
    assertNotAborted(signal);
    await yieldToMain(0);
    const rows = bankMovementsToStandardLucaRows(movements, context);
    onChunk?.(movements.length, movements.length);
    return rows;
  }

  const nested = await mapInChunksAsync(
    movements,
    (movement, index) => bankMovementToStandardLucaRows(movement, index + 1, context),
    { chunkSize, signal, onChunk }
  );

  assertNotAborted(signal);
  await yieldToMain(0);
  return sortStandardLucaRows(nested.flat());
}

async function applyAccountMemoryChunked(
  rows = [],
  accountMemoryRecords = [],
  context = {},
  { chunkSize = PIPELINE_CHUNK_SIZE, signal = null, onChunk = null } = {}
) {
  if (!rows.length || !accountMemoryRecords?.length) return rows;

  return mapInChunksAsync(
    rows,
    (row) =>
      applyAccountMemoryV1RecordsToRows([row], accountMemoryRecords, context)[0],
    { chunkSize, signal, onChunk }
  );
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
  const mappingContext = buildMovementMappingContext({
    selectedCompany,
    companyPlans,
    companyRules,
    selectedBank,
    learningMemory,
    accountingRules,
    selectedCompanyId,
    sourceFileName,
    sourceType,
  });

  const movementRows =
    prebuiltMovementRows ||
    mapParsedRowsToStandardMovements(normalizedRows, mappingContext);

  const baseRows = bankMovementsToStandardLucaRows(movementRows, {
    firmaId: selectedCompanyId,
    kaynakAdi: selectedBank,
  });

  const learningMemoryIndex = buildLearningMemoryIndex(learningMemory || []);
  const learningRows = applyLearningMemoryToStandardLucaRows(
    ensureStandardLucaRowIds(baseRows),
    learningMemory,
    {
      firmaId: selectedCompanyId,
      kaynakTipi: KAYNAK_TIPI.BANKA,
      kaynakAdi: selectedBank,
      learningMemoryIndex,
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
 * Chunk + yield ile Luca/öğrenme pipeline — ana thread'i kilitlemez.
 */
export async function buildBankParserResultFromNormalizedRowsAsync(options = {}) {
  const {
    signal = null,
    onProgress = null,
    skipOpsSide = true,
  } = options;

  const timer = createStageTimer(isDevTelemetryEnabled());
  const mappingContext = buildMovementMappingContext(options);
  const selectedCompanyId = options.selectedCompanyId;
  const selectedBank = options.selectedBank;
  const learningMemory = options.learningMemory || [];
  const learningMemoryIndex = buildLearningMemoryIndex(learningMemory);

  let movementRows = null;
  let coreSummary = null;

  const reportProgress = (stage, detail, percent) => {
    onProgress?.({ stage, detail, percent });
  };

  assertNotAborted(signal);

  if (isAnnveroCoreEnabled()) {
    timer.start("core");
    reportProgress(BANK_PARSE_STAGES.LEARNING, "CORE eşleştirmesi", 35);
    const mapped = await mapParsedRowsWithCoreFallback(
      options.normalizedRows || [],
      mappingContext,
      {
        companyId: selectedCompanyId,
        coreRowLimit: options.coreRowLimit,
        signal,
        onProgress: reportProgress,
      }
    );
    movementRows = mapped.movements;
    coreSummary = mapped.coreSummary;
    timer.end("core");
    reportProgress(
      BANK_PARSE_STAGES.LEARNING,
      coreSummary?.partial
        ? "CORE tamamlandı (kısmi — unknown satırlar var)"
        : "CORE eşleştirmesi tamamlandı",
      48
    );
  } else {
    timer.start("mapping");
    reportProgress("Hesap eşleştirme", "Hareketler standartlaştırılıyor", 30);
    movementRows = await mapParsedRowsToStandardMovementsAsync(
      options.normalizedRows || [],
      mappingContext,
      {
        chunkSize: PIPELINE_CHUNK_SIZE,
        signal,
        onChunk: (done, total) =>
          reportProgress(
            "Hesap eşleştirme",
            `${done}/${total} hareket eşleştirildi`,
            30 + Math.round((done / Math.max(total, 1)) * 15)
          ),
      }
    );
    timer.end("mapping");
  }

  assertNotAborted(signal);
  timer.start("luca");
  reportProgress(BANK_PARSE_STAGES.LUCA, "Luca satırları oluşturuluyor", 50);

  const baseRows = await bankMovementsToStandardLucaRowsChunked(
    movementRows,
    {
      firmaId: selectedCompanyId,
      kaynakAdi: selectedBank,
    },
    {
      chunkSize: PIPELINE_CHUNK_SIZE,
      signal,
      onChunk: (done, total) =>
        reportProgress(
          BANK_PARSE_STAGES.LUCA,
          `Luca satırları ${done}/${total}`,
          50 + Math.round((done / Math.max(total, 1)) * 15)
        ),
    }
  );
  timer.end("luca");

  assertNotAborted(signal);
  timer.start("learning");
  reportProgress("Öğrenme", "İşlem hafızası uygulanıyor", 70);

  const learningRows = await applyLearningMemoryToStandardLucaRowsAsync(
    ensureStandardLucaRowIds(baseRows),
    learningMemory,
    {
      firmaId: selectedCompanyId,
      kaynakTipi: KAYNAK_TIPI.BANKA,
      kaynakAdi: selectedBank,
      learningMemoryIndex,
    },
    {
      chunkSize: PIPELINE_CHUNK_SIZE,
      signal,
      onChunk: (done, total) =>
        reportProgress(
          "Öğrenme",
          `Hafıza ${done}/${total}`,
          70 + Math.round((done / Math.max(total, 1)) * 8)
        ),
    }
  );
  timer.end("learning");

  assertNotAborted(signal);
  timer.start("accountMemory");
  reportProgress("Öğrenme", "Hesap hafızası uygulanıyor", 80);

  const memoryRows = await applyAccountMemoryChunked(
    learningRows,
    options.accountMemoryRecords,
    {
      firmaId: selectedCompanyId,
      kaynakAdi: selectedBank,
    },
    { chunkSize: PIPELINE_CHUNK_SIZE, signal }
  );
  timer.end("accountMemory");

  assertNotAborted(signal);
  await yieldToMain(0);
  timer.start("smart");
  const smartRows = applySmartBankSuggestionsToRows(memoryRows, {
    companyPlans: options.companyPlans,
    selectedBank,
    selectedCompanyId,
  });
  timer.end("smart");

  assertNotAborted(signal);
  await yieldToMain(0);
  timer.start("declaration");
  const declarationResult = applyDeclarationAccrualDistributionToRows(
    smartRows,
    options.declarationAccrualRecords,
    {
      companyId: selectedCompanyId,
      selectedBank,
    }
  );
  timer.end("declaration");

  assertNotAborted(signal);
  await yieldToMain(0);
  timer.start("unrecognized");
  const unrecognizedItems = buildUnrecognizedQueueItems(declarationResult.rows, {
    companyId: selectedCompanyId,
    sourceModule: "banka",
    sourceBank: selectedBank,
    learningMemory,
  });
  timer.end("unrecognized");

  const timings = timer.report("[bank-parser-timing]");

  return {
    normalizedRows: options.normalizedRows || [],
    movementRows,
    standardLucaRows: declarationResult.rows,
    unrecognizedItems,
    declarationSummary: declarationResult.summary,
    financialTransactions: null,
    opsDashboard: null,
    opsMeta: {
      selectedBank,
      selectedCompanyId,
      sourceFileName: options.sourceFileName || "",
      sourceFileType: options.sourceFileType || "xlsx",
      sourceType: options.sourceType || "bank",
      parserName: resolveParserName(selectedBank, options.sourceType || "bank"),
      annveroCoreEnabled: isAnnveroCoreEnabled(),
      coreSummary,
      timings,
      skipOpsSide,
      rowCounts: {
        normalized: (options.normalizedRows || []).length,
        movements: movementRows?.length || 0,
        luca: declarationResult.rows?.length || 0,
      },
    },
  };
}

export { formatParserDate };
