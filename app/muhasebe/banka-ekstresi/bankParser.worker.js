import * as XLSX from "xlsx";
import {
  BANK_PARSE_STAGES,
  buildBankParserResultFromNormalizedRows,
  normalizeBankParsedRow,
  parseRowsForBank,
} from "@/src/utils/bankParserCore";

function formatWorkerError(error, stage = "") {
  const parts = [];
  if (stage) parts.push(`[${stage}]`);
  if (error?.name) parts.push(error.name);
  if (error?.message) parts.push(error.message);
  else parts.push(String(error || "Bilinmeyen worker hatası"));
  if (error?.stack) {
    const firstLine = String(error.stack).split("\n").slice(0, 3).join(" | ");
    parts.push(firstLine);
  }
  return parts.filter(Boolean).join(" — ").slice(0, 800);
}

function postProgress(stage, detail = "") {
  self.postMessage({
    type: "progress",
    stage,
    detail,
  });
}

function postError(requestId, error, stage = "") {
  const message = formatWorkerError(error, stage);
  console.error("[bankParser.worker]", stage, error);
  self.postMessage({
    type: "error",
    requestId,
    error: message,
    stage: stage || null,
    errorName: error?.name || null,
  });
}

function yieldToWorker() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function mapInChunks(items, mapper, chunkSize = 200, onChunk = null) {
  const result = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);

    for (const item of chunk) {
      result.push(mapper(item));
    }

    if (onChunk) {
      onChunk(Math.min(index + chunk.length, items.length), items.length);
    }

    await yieldToWorker();
  }

  return result;
}

async function readWorkbook(arrayBuffer) {
  await yieldToWorker();
  return XLSX.read(arrayBuffer, {
    cellDates: true,
    type: "array",
  });
}

async function sheetToRows(worksheet) {
  await yieldToWorker();
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
  });
}

self.onmessage = async (event) => {
  const { requestId, arrayBuffer, context } = event.data || {};
  let stage = BANK_PARSE_STAGES.READING;

  try {
    if (!arrayBuffer) {
      throw new Error("Excel verisi (arrayBuffer) worker'a ulaşmadı.");
    }
    if (!context?.selectedBank) {
      throw new Error("Banka seçimi (selectedBank) worker context'te yok.");
    }

    postProgress(stage, "Excel çalışma kitabı okunuyor");
    const workbook = await readWorkbook(arrayBuffer);
    const firstSheetName = workbook.SheetNames?.[0];

    if (!firstSheetName) {
      throw new Error("Excel dosyasında sayfa bulunamadı.");
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const sheetRows = await sheetToRows(worksheet);
    const rawCount = sheetRows.length;

    stage = BANK_PARSE_STAGES.PARSING;
    postProgress(stage, `${rawCount} ham satır taranıyor`);
    await yieldToWorker();

    let parsedRows;
    try {
      parsedRows = parseRowsForBank(sheetRows, context.selectedBank);
    } catch (parseError) {
      throw new Error(
        formatWorkerError(parseError, `parseRowsForBank:${context.selectedBank}`)
      );
    }

    postProgress(
      stage,
      `${parsedRows.length} banka hareketi normalize ediliyor`
    );

    const normalizedRows = await mapInChunks(
      parsedRows,
      (row) => normalizeBankParsedRow(row, context.selectedBank),
      200,
      (done, total) => {
        postProgress(stage, `${done}/${total} hareket hazırlandı`);
      }
    );

    stage = BANK_PARSE_STAGES.LUCA;
    postProgress(stage, "Luca satırları oluşturuluyor");
    await yieldToWorker();

    console.log("loaded learning memory count", context.learningMemory?.length || 0);

    let result;
    try {
      result = buildBankParserResultFromNormalizedRows({
        normalizedRows,
        selectedBank: context.selectedBank,
        selectedCompany: context.selectedCompany,
        companyPlans: context.companyPlans,
        companyRules: context.companyRules,
        learningMemory: context.learningMemory,
        accountMemoryRecords: context.accountMemoryRecords,
        accountingRules: context.accountingRules,
        declarationAccrualRecords: context.declarationAccrualRecords,
        selectedCompanyId: context.selectedCompanyId,
        sourceFileName: context.sourceFileName || "",
        sourceFileType: context.sourceFileType || "xlsx",
        sourceType: context.sourceType || "bank",
      });
    } catch (buildError) {
      throw new Error(
        formatWorkerError(buildError, "buildBankParserResultFromNormalizedRows")
      );
    }

    stage = BANK_PARSE_STAGES.LEARNING;
    postProgress(
      stage,
      `${result.unrecognizedItems?.length || 0} tanınmayan işlem kontrol edildi`
    );
    await yieldToWorker();

    // structured clone güvenliği: sonuç JSON-serializable olmalı
    let safeResult;
    try {
      safeResult = JSON.parse(JSON.stringify(result));
    } catch (serializeError) {
      throw new Error(
        formatWorkerError(serializeError, "serializeResult")
      );
    }

    self.postMessage({
      type: "success",
      requestId,
      rawCount,
      ...safeResult,
    });
  } catch (error) {
    postError(requestId, error, stage);
  }
};

self.addEventListener("error", (event) => {
  console.error("[bankParser.worker] uncaught", event?.message, event?.error);
  self.postMessage({
    type: "error",
    requestId: null,
    error: formatWorkerError(
      event?.error || new Error(event?.message || "Worker script hatası"),
      "uncaught"
    ),
  });
});

self.addEventListener("unhandledrejection", (event) => {
  console.error("[bankParser.worker] unhandledrejection", event?.reason);
  self.postMessage({
    type: "error",
    requestId: null,
    error: formatWorkerError(event?.reason, "unhandledrejection"),
  });
});
