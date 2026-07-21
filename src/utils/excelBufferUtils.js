import {
  safeRead,
  sanitizeExportJsonRows,
  sanitizeExportAoa,
  XLSX,
} from "@/src/utils/safeXlsx";

export function readWorkbookFromArrayBuffer(arrayBuffer, options = {}) {
  return safeRead(arrayBuffer, {
    cellDates: true,
    type: "array",
    ...options.readOptions,
  });
}

export function readSheetRowsFromArrayBuffer(
  arrayBuffer,
  { sheetIndex = 0, sheetName = "", jsonOptions = {} } = {}
) {
  const workbook = readWorkbookFromArrayBuffer(arrayBuffer);
  const targetSheet =
    sheetName || workbook.SheetNames?.[sheetIndex] || workbook.SheetNames?.[0];

  if (!targetSheet) {
    throw new Error("Excel dosyasında sayfa bulunamadı.");
  }

  const worksheet = workbook.Sheets[targetSheet];
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    ...jsonOptions,
  });
}

export function readSheetObjectsFromArrayBuffer(arrayBuffer, options = {}) {
  const workbook = readWorkbookFromArrayBuffer(arrayBuffer);
  const targetSheet =
    options.sheetName || workbook.SheetNames?.[options.sheetIndex || 0] || workbook.SheetNames?.[0];

  if (!targetSheet) {
    throw new Error("Excel dosyasında sayfa bulunamadı.");
  }

  const worksheet = workbook.Sheets[targetSheet];
  return XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    ...options.jsonOptions,
  });
}

/**
 * Güvenli Excel yazma — formula injection korumalı satırlar.
 * Muhasebe sayısal alanlar sanitizeExportValue ile sayı olarak kalır.
 */
export function writeJsonRowsToXlsxFile(rows, { sheetName = "Sheet1", fileName, headers } = {}) {
  const safeRows = sanitizeExportJsonRows(rows);
  const worksheet = XLSX.utils.json_to_sheet(safeRows, headers ? { header: headers } : undefined);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
  return { ok: true, rowCount: safeRows.length };
}

export function writeAoaToXlsxFile(aoa, { sheetName = "Sheet1", fileName } = {}) {
  const safeAoa = sanitizeExportAoa(aoa);
  const worksheet = XLSX.utils.aoa_to_sheet(safeAoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
  return { ok: true, rowCount: safeAoa.length };
}

export { XLSX, sanitizeExportJsonRows, sanitizeExportAoa };
