import * as XLSX from "xlsx";
import { enforceLucaExportDateStrings } from "@/src/utils/formatDateTR";
import { validatePreviewForExport } from "@/src/utils/previewExportValidation";
import {
  LUCA_EXPORT_HEADERS,
  logStandardLucaReport,
  sortStandardLucaRows,
  standardLucaRowsToExcelRows,
} from "@/src/utils/standardLucaRow";

export function exportStandardLucaExcel(rows = [], options = {}) {
  const {
    filePrefix = "luca",
    logLabel = "luca-export",
    onValidationFail,
  } = options;

  if (!rows.length) {
    return {
      ok: false,
      reason: "empty",
      message: "Önce ön izleme oluşturun.",
    };
  }

  const validation = validatePreviewForExport(rows);
  if (!validation.ok) {
    onValidationFail?.(validation);
    return {
      ok: false,
      reason: "validation",
      validation,
      message: "Excel oluşturulamadı. Lütfen satır hatalarını düzeltin.",
    };
  }

  const sortedRows = sortStandardLucaRows(rows);
  const uniqueFisNo = [...new Set(sortedRows.map((row) => row.fisNo))];
  const chunkSize = 50;
  const totalFiles = Math.ceil(uniqueFisNo.length / chunkSize);

  for (let fileIndex = 0; fileIndex < totalFiles; fileIndex += 1) {
    const chunkFisNos = new Set(
      uniqueFisNo.slice(fileIndex * chunkSize, fileIndex * chunkSize + chunkSize)
    );
    const chunkRows = sortedRows.filter((row) => chunkFisNos.has(row.fisNo));
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

    const ilkFis = fileIndex * chunkSize + 1;
    const sonFis = Math.min((fileIndex + 1) * chunkSize, uniqueFisNo.length);
    const fileSuffix = totalFiles === 1 ? filePrefix : `${filePrefix}_${ilkFis}-${sonFis}`;

    XLSX.writeFile(workbook, `${fileSuffix}.xlsx`);
  }

  logStandardLucaReport(logLabel, sortedRows);

  return {
    ok: true,
    fileCount: totalFiles,
    rowCount: sortedRows.length,
  };
}
