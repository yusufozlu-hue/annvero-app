import * as XLSX from "xlsx";
import {
  BANK_PARSE_STAGES,
  buildBankParserResultFromNormalizedRows,
  normalizeBankParsedRow,
  parseRowsForBank,
} from "@/src/utils/bankParserCore";

function postProgress(stage, detail = "") {
  self.postMessage({
    type: "progress",
    stage,
    detail,
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

  try {
    postProgress(BANK_PARSE_STAGES.READING, "Excel çalışma kitabı okunuyor");
    const workbook = await readWorkbook(arrayBuffer);
    const firstSheetName = workbook.SheetNames?.[0];

    if (!firstSheetName) {
      throw new Error("Excel dosyasında sayfa bulunamadı.");
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const sheetRows = await sheetToRows(worksheet);
    const rawCount = sheetRows.length;

    postProgress(BANK_PARSE_STAGES.PARSING, `${rawCount} ham satır taranıyor`);
    await yieldToWorker();

    const parsedRows = parseRowsForBank(sheetRows, context.selectedBank);

    postProgress(
      BANK_PARSE_STAGES.PARSING,
      `${parsedRows.length} banka hareketi normalize ediliyor`
    );

    const normalizedRows = await mapInChunks(
      parsedRows,
      (row) => normalizeBankParsedRow(row, context.selectedBank),
      200,
      (done, total) => {
        postProgress(BANK_PARSE_STAGES.PARSING, `${done}/${total} hareket hazırlandı`);
      }
    );

    postProgress(BANK_PARSE_STAGES.LUCA, "Luca satırları oluşturuluyor");
    await yieldToWorker();

    console.log("loaded learning memory count", context.learningMemory?.length || 0);

    const result = buildBankParserResultFromNormalizedRows({
      normalizedRows,
      selectedBank: context.selectedBank,
      selectedCompany: context.selectedCompany,
      companyPlans: context.companyPlans,
      companyRules: context.companyRules,
      learningMemory: context.learningMemory,
      accountMemoryRecords: context.accountMemoryRecords,
      accountingRules: context.accountingRules,
      selectedCompanyId: context.selectedCompanyId,
    });

    postProgress(
      BANK_PARSE_STAGES.LEARNING,
      `${result.unrecognizedItems.length} tanınmayan işlem kontrol edildi`
    );
    await yieldToWorker();

    self.postMessage({
      type: "success",
      requestId,
      rawCount,
      ...result,
    });
  } catch (error) {
    console.error("[bankParser.worker] parse failed", error);
    self.postMessage({
      type: "error",
      requestId,
      error: error?.message || "Dosya işlenirken beklenmeyen hata oluştu.",
    });
  }
};
