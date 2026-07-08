import * as XLSX from "xlsx";

export function readWorkbookFromArrayBuffer(arrayBuffer, options = {}) {
  return XLSX.read(arrayBuffer, {
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
