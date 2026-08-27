import * as XLSX from "xlsx";

function normalizeYear(yearPart) {
  const year = Number(yearPart);

  if (Number.isNaN(year)) {
    return null;
  }

  if (year < 100) {
    return 2000 + year;
  }

  return year;
}

function excelSerialToDate(serial) {
  const utcDays = Math.floor(Number(serial) - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isUtcMidnight(date) {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/** Calendar day from Excel Date — avoids TR export TZ day-shift (2025-12-31T21:00Z → 01.01.2026). */
export function calendarPartsFromExcelDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }

  if (isUtcMidnight(value)) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  // Typical Luca/XLSX export lands at 21:00Z (= next local midnight in UTC+3).
  if (value.getUTCHours() === 21 && value.getUTCMinutes() === 0) {
    const shifted = new Date(value.getTime() + 3 * 3600 * 1000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
  }

  // Noon-UTC anchor for other non-midnight instants.
  const noonUtc = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0)
  );
  return {
    year: noonUtc.getUTCFullYear(),
    month: noonUtc.getUTCMonth() + 1,
    day: noonUtc.getUTCDate(),
  };
}

function dateFromCalendarParts(parts) {
  return new Date(parts.year, parts.month - 1, parts.day);
}

function parseSlashDate(parts) {
  if (parts.length < 3) {
    return null;
  }

  const first = Number(parts[0]);
  const second = Number(parts[1]);
  const year = normalizeYear(parts[2]);

  if (Number.isNaN(first) || Number.isNaN(second) || year === null) {
    return null;
  }

  let day;
  let month;

  if (first > 12) {
    day = first;
    month = second;
  } else if (second > 12) {
    month = first;
    day = second;
  } else {
    month = first;
    day = second;
  }

  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseDateTR(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const parts = calendarPartsFromExcelDate(value);
    return parts ? dateFromCalendarParts(parts) : value;
  }

  if (typeof value === "number") {
    return excelSerialToDate(value);
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(text)) {
    const [dayPart, monthPart, yearPart] = text.split(".");
    const year = normalizeYear(yearPart);
    const day = Number(dayPart);
    const month = Number(monthPart);

    if (year === null || Number.isNaN(day) || Number.isNaN(month)) {
      return null;
    }

    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (text.includes("/")) {
    return parseSlashDate(text.split("/").map((part) => part.trim()));
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (text.includes("-")) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function formatDateTR(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "number") {
    const serialDate = excelSerialToDate(value);

    if (serialDate) {
      const day = String(serialDate.getUTCDate()).padStart(2, "0");
      const month = String(serialDate.getUTCMonth() + 1).padStart(2, "0");
      const year = serialDate.getUTCFullYear();
      return `${day}.${month}.${year}`;
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) {
      return trimmed;
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const parts = calendarPartsFromExcelDate(value);
    if (parts) {
      const day = String(parts.day).padStart(2, "0");
      const month = String(parts.month).padStart(2, "0");
      return `${day}.${month}.${parts.year}`;
    }
  }

  const date = parseDateTR(value);

  if (!date || Number.isNaN(date.getTime())) {
    return String(value).trim();
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}.${month}.${year}`;
}

export function enforceLucaExportDateStrings(worksheet, columnNames = ["Fiş Tarihi", "Evrak Tarihi"]) {
  if (!worksheet?.["!ref"]) {
    return worksheet;
  }

  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  const headerNames = [];

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cellRef = XLSX.utils.encode_cell({ r: range.s.r, c: column });
    headerNames.push(worksheet[cellRef]?.v);
  }

  const targetColumns = columnNames
    .map((name) => headerNames.indexOf(name))
    .filter((index) => index >= 0);

  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    for (const column of targetColumns) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = worksheet[cellRef];

      if (!cell) {
        continue;
      }

      cell.t = "s";
      cell.v = String(cell.v ?? "");
      delete cell.w;
    }
  }

  return worksheet;
}
