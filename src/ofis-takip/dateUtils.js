export function parseTrDate(value) {
  if (!value) {
    return null;
  }

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parts = text.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [day, month, year] = parts.map(Number);

  if ([day, month, year].some(Number.isNaN)) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTrDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}.${month}.${year}`;
}

export function daysUntil(value) {
  const target = parseTrDate(value);
  if (!target) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function isDueSoon(value, daysBefore = 3) {
  const remaining = daysUntil(value);
  return remaining !== null && remaining >= 0 && remaining <= daysBefore;
}

export function isOverdue(value) {
  const remaining = daysUntil(value);
  return remaining !== null && remaining < 0;
}
