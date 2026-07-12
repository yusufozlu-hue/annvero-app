import * as XLSX from "xlsx";
import { enforceLucaExportDateStrings } from "@/src/utils/formatDateTR";
import {
  recordMemoryUsageAfterSuccessfulValidation,
  validatePreviewForExport,
} from "@/src/utils/previewExportValidation";
import {
  LUCA_EXPORT_HEADERS,
  logStandardLucaReport,
  sortStandardLucaRows,
  standardLucaRowsToExcelRows,
} from "@/src/utils/standardLucaRow";

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error =
    typeof DOMException !== "undefined"
      ? new DOMException("Export cancelled", "AbortError")
      : Object.assign(new Error("Export cancelled"), { name: "AbortError" });
  throw error;
}

export async function exportStandardLucaExcel(rows = [], options = {}) {
  const {
    filePrefix = "luca",
    logLabel = "luca-export",
    onValidationFail,
    ignoreWarnings = false,
    signal,
    onProgress,
  } = options;

  if (!rows.length) {
    return {
      ok: false,
      reason: "empty",
      message: "Önce ön izleme oluşturun.",
    };
  }

  const validation = validatePreviewForExport(rows);

  if (validation.hasBlockingErrors) {
    onValidationFail?.(validation);
    return {
      ok: false,
      reason: "validation",
      validation,
      message: validation.hasCriticalDuplicates
        ? "Excel oluşturulamadı. Kritik mükerrer kayıtları giderin."
        : "Excel oluşturulamadı. Lütfen satır hatalarını düzeltin.",
    };
  }

  if (validation.hasWarnings && !ignoreWarnings) {
    return {
      ok: false,
      reason: "warnings",
      needsConfirm: true,
      validation,
      message: validation.hasHighDuplicateRisk
        ? `${validation.warningCount} uyarı bulundu (yüksek/orta mükerrer riski dahil). Devam etmek için onaylayın.`
        : `${validation.warningCount} uyarı bulundu. Devam etmek için onaylayın.`,
    };
  }

  // Başarılı validation → Öğrenen Hafıza kullanım istatistikleri
  const memoryStats = recordMemoryUsageAfterSuccessfulValidation(
    rows,
    validation
  );

  try {
    throwIfAborted(signal);
    await yieldToMain();
    throwIfAborted(signal);

    const sortedRows = sortStandardLucaRows(rows);
    const uniqueFisNo = [...new Set(sortedRows.map((row) => row.fisNo))];
    const rowsByFisNo = new Map();
    for (const row of sortedRows) {
      const fisNo = row.fisNo;
      if (!rowsByFisNo.has(fisNo)) rowsByFisNo.set(fisNo, []);
      rowsByFisNo.get(fisNo).push(row);
    }

    const chunkSize = 50;
    const totalFiles = Math.ceil(uniqueFisNo.length / chunkSize) || 0;

    for (let fileIndex = 0; fileIndex < totalFiles; fileIndex += 1) {
      throwIfAborted(signal);

      const chunkFisNos = uniqueFisNo.slice(
        fileIndex * chunkSize,
        fileIndex * chunkSize + chunkSize
      );
      const chunkRows = [];
      for (const fisNo of chunkFisNos) {
        const group = rowsByFisNo.get(fisNo);
        if (group) chunkRows.push(...group);
      }

      const ilkFis = fileIndex * chunkSize + 1;
      const sonFis = Math.min((fileIndex + 1) * chunkSize, uniqueFisNo.length);
      const fileSuffix = totalFiles === 1 ? filePrefix : `${filePrefix}_${ilkFis}-${sonFis}`;

      onProgress?.({
        fileIndex,
        totalFiles,
        detail: `Dosya ${fileIndex + 1}/${totalFiles} hazırlanıyor (${ilkFis}-${sonFis})`,
      });

      const excelRows = standardLucaRowsToExcelRows(chunkRows);
      const worksheet = XLSX.utils.json_to_sheet(excelRows, {
        header: LUCA_EXPORT_HEADERS,
      });
      enforceLucaExportDateStrings(worksheet, [
        "Fiş Tarihi",
        "Evrak Tarihi",
        "Hesap Kodu",
      ]);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Luca Fisleri");
      XLSX.writeFile(workbook, `${fileSuffix}.xlsx`);

      await yieldToMain();
    }

    throwIfAborted(signal);
    logStandardLucaReport(logLabel, sortedRows);

    return {
      ok: true,
      fileCount: totalFiles,
      rowCount: sortedRows.length,
      exportedWithWarnings: validation.hasWarnings && ignoreWarnings,
      memoryStats,
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      return { ok: false, reason: "cancelled" };
    }
    throw error;
  }
}
