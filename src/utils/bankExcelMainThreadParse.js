/**
 * Ana thread banka Excel parse — worker bypass.
 * Worker dosyası silinmez; bu yol geçici fallback.
 */

import {
  normalizeBankParsedRow,
  parseRowsForBank,
} from "@/src/utils/bankParserWorkerCore";

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function classifyBankParseError(error, stage = "") {
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();

  if (stage === "file_read" || lower.includes("arraybuffer") || lower.includes("dosya")) {
    return {
      code: "FILE_READ",
      userMessage: `Dosya okunamadı: ${message}`,
    };
  }
  if (
    stage === "xlsx_import" ||
    lower.includes("xlsx") ||
    lower.includes("cannot find module") ||
    lower.includes("failed to fetch")
  ) {
    return {
      code: "XLSX_IMPORT",
      userMessage: `xlsx import hatası: ${message}`,
    };
  }
  if (
    error?.code === "BANK_FORMAT_MISMATCH" ||
    lower.includes("ekstre formatı uyuşmuyor") ||
    lower.includes("ekstre formati uyusmuyor")
  ) {
    return {
      code: "BANK_FORMAT_MISMATCH",
      userMessage: message,
    };
  }
  if (
    lower.includes("başlık") ||
    lower.includes("baslik") ||
    lower.includes("kolon") ||
    lower.includes("header") ||
    lower.includes("bulunamadı")
  ) {
    return {
      code: "COLUMN_NOT_FOUND",
      userMessage: `Kolon / başlık bulunamadı: ${message}`,
    };
  }
  if (stage === "empty_result" || lower.includes("boş") || lower.includes("empty")) {
    return {
      code: "EMPTY_RESULT",
      userMessage: `Parser sonucu boş: ${message}`,
    };
  }
  return {
    code: "PARSE_FAILED",
    userMessage: message || "Ön izleme oluşturulamadı.",
  };
}

/**
 * Excel'i ana thread'de okuyup banka satırlarını normalize eder.
 * 4. argüman: ArrayBuffer | { arrayBuffer?, sheetRows? }
 * - sheetRows verilirse XLSX / file.arrayBuffer tekrarlanmaz (worker fallback).
 * - arrayBuffer verilirse dosya yeniden okunmaz.
 * @returns {{ rawCount: number, normalizedRows: object[], selectedBank: string, parseMode: string }}
 */
export async function parseBankExcelOnMainThread(
  file,
  selectedBank,
  onProgress,
  arrayBufferOrOptions = null
) {
  let arrayBufferInput = null;
  let sheetRowsInput = null;

  if (arrayBufferOrOptions instanceof ArrayBuffer) {
    arrayBufferInput = arrayBufferOrOptions;
  } else if (
    arrayBufferOrOptions &&
    typeof arrayBufferOrOptions === "object" &&
    !Array.isArray(arrayBufferOrOptions)
  ) {
    arrayBufferInput = arrayBufferOrOptions.arrayBuffer || null;
    sheetRowsInput = Array.isArray(arrayBufferOrOptions.sheetRows)
      ? arrayBufferOrOptions.sheetRows
      : null;
  }

  if (!file && !arrayBufferInput && !sheetRowsInput) {
    const err = new Error("Excel dosyası seçilmedi.");
    Object.assign(err, classifyBankParseError(err, "file_read"));
    throw err;
  }
  if (!selectedBank) {
    const err = new Error("Banka seçimi yok.");
    Object.assign(err, classifyBankParseError(err, "PARSE_FAILED"));
    throw err;
  }

  let sheetRows = sheetRowsInput;
  if (sheetRows) {
    onProgress?.({
      stage: "Dosya okunuyor",
      detail: "Ana thread — hazır sheetRows kullanılıyor",
    });
    await yieldToMain();
  } else {
    let arrayBuffer = arrayBufferInput;
    if (!arrayBuffer) {
      try {
        onProgress?.({ stage: "Dosya okunuyor", detail: "Ana thread — dosya okunuyor" });
        arrayBuffer = await file.arrayBuffer();
        await yieldToMain();
      } catch (error) {
        const classified = classifyBankParseError(error, "file_read");
        const err = new Error(classified.userMessage);
        Object.assign(err, classified);
        throw err;
      }
    } else {
      onProgress?.({
        stage: "Dosya okunuyor",
        detail: "Ana thread — hazır buffer kullanılıyor",
      });
      await yieldToMain();
    }

    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      const classified = classifyBankParseError(
        new Error("Dosya içeriği boş veya okunamadı."),
        "file_read"
      );
      const err = new Error(classified.userMessage);
      Object.assign(err, classified);
      throw err;
    }

    try {
      onProgress?.({ stage: "Dosya okunuyor", detail: "xlsx yükleniyor (ana thread)" });
      const { readSheetRowsFromArrayBuffer } = await import("@/src/utils/excelBufferUtils");
      await yieldToMain();
      onProgress?.({ stage: "Dosya okunuyor", detail: "Excel sayfası okunuyor" });
      sheetRows = readSheetRowsFromArrayBuffer(arrayBuffer);
      await yieldToMain();
    } catch (error) {
      const classified = classifyBankParseError(error, "xlsx_import");
      const err = new Error(classified.userMessage);
      Object.assign(err, classified);
      throw err;
    }
  }

  const rawCount = Array.isArray(sheetRows) ? sheetRows.length : 0;
  if (!rawCount) {
    const classified = classifyBankParseError(
      new Error("Excel sayfasında satır bulunamadı."),
      "empty_result"
    );
    const err = new Error(classified.userMessage);
    Object.assign(err, classified);
    throw err;
  }

  onProgress?.({
    stage: "Parser çalışıyor",
    detail: `${rawCount} ham satır — ${selectedBank} (ana thread)`,
  });
  await yieldToMain();

  let parsedRows;
  try {
    parsedRows = parseRowsForBank(sheetRows, selectedBank);
  } catch (error) {
    const classified = classifyBankParseError(error, "column");
    const err = new Error(classified.userMessage);
    Object.assign(err, classified);
    throw err;
  }

  if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
    const classified = classifyBankParseError(
      new Error(
        `${selectedBank} parser sonucu boş. Başlık satırı / kolon eşleşmesini kontrol edin.`
      ),
      "empty_result"
    );
    const err = new Error(classified.userMessage);
    Object.assign(err, classified);
    throw err;
  }

  onProgress?.({
    stage: "Parser çalışıyor",
    detail: `${parsedRows.length} hareket normalize ediliyor`,
  });
  await yieldToMain();

  const normalizedRows = [];
  const chunkSize = 200;
  for (let i = 0; i < parsedRows.length; i += chunkSize) {
    const chunk = parsedRows.slice(i, i + chunkSize);
    for (const row of chunk) {
      normalizedRows.push(normalizeBankParsedRow(row, selectedBank));
    }
    onProgress?.({
      stage: "Parser çalışıyor",
      detail: `${Math.min(i + chunk.length, parsedRows.length)}/${parsedRows.length} hareket`,
    });
    await yieldToMain();
  }

  return {
    rawCount,
    normalizedRows,
    selectedBank,
    parseMode: "main-thread-fallback",
  };
}

export { classifyBankParseError };
