/**
 * Banka ekstresi şema fingerprint — yalnız yapısal imza.
 * Hücre içeriği / IBAN / hesap / tutar / açıklama yazılmaz.
 */

function normalizeStatementHeaderText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1aHex(text = "") {
  let hash = 0x811c9dc5;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `sf:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function rowText(row) {
  if (!Array.isArray(row)) return "";
  return row
    .map((cell) => normalizeStatementHeaderText(cell))
    .filter(Boolean)
    .join(" ");
}

function isColumnHeaderRow(text) {
  if (!text) return false;
  const hasTarih = text.includes("tarih");
  const hasAciklama = text.includes("aciklama");
  const hasAmount =
    text.includes("tutar") ||
    text.includes("bakiye") ||
    (text.includes("borc") && text.includes("alacak")) ||
    text.includes("b/a");
  return hasTarih && hasAciklama && hasAmount;
}

function normalizeColumnKey(cell = "") {
  return normalizeStatementHeaderText(cell)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function classifyDateShape(raw = "") {
  const s = String(raw ?? "").trim();
  if (!s) return "empty";
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s)) return "dmy_sep";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return "iso";
  if (/^\d{5}(\.\d+)?$/.test(s)) return "excel_serial";
  if (/^\d{8}$/.test(s)) return "yyyymmdd";
  return "other";
}

/**
 * @param {unknown[][]} sheetRows
 * @param {{ sheetName?: string, currency?: string }} [options]
 */
export function buildBankStatementSchemaFingerprint(sheetRows = [], options = {}) {
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  let headerRowIndex = -1;
  let headerKeys = [];

  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    const text = rowText(rows[i]);
    if (!text) continue;
    if (isColumnHeaderRow(text)) {
      headerRowIndex = i;
      headerKeys = (rows[i] || [])
        .map((c) => normalizeColumnKey(c))
        .filter(Boolean);
      break;
    }
  }

  if (headerRowIndex < 0 && rows.length) {
    headerKeys = (rows[0] || [])
      .map((c) => normalizeColumnKey(c))
      .filter(Boolean);
    headerRowIndex = headerKeys.length ? 0 : -1;
  }

  const joined = headerKeys.join("|");
  const hasBorc = headerKeys.some((k) => k === "borc" || k.includes("borc"));
  const hasAlacak = headerKeys.some((k) => k === "alacak" || k.includes("alacak"));
  const hasTutar = headerKeys.some((k) => k === "tutar" || k.includes("tutar"));
  const hasBakiye = headerKeys.some((k) => k.includes("bakiye"));
  const hasDekont = headerKeys.some((k) => k.includes("dekont"));
  const hasRef = headerKeys.some(
    (k) =>
      k.includes("dekont") ||
      k.includes("fis_no") ||
      k.includes("islem_no") ||
      k.includes("referans")
  );

  let directionModel = "unknown";
  if (hasBorc && hasAlacak) directionModel = "borc_alacak";
  else if (hasTutar) directionModel = "single_amount";

  let dateFormatClass = "unknown";
  if (headerRowIndex >= 0 && rows[headerRowIndex + 1]) {
    const dateCol = headerKeys.findIndex(
      (k) => k.includes("tarih") || k === "valor" || k === "muh_tarih"
    );
    if (dateCol >= 0) {
      dateFormatClass = classifyDateShape(rows[headerRowIndex + 1][dateCol]);
    }
  }

  const metaRowCount = headerRowIndex > 0 ? headerRowIndex : 0;
  const sheetToken = normalizeStatementHeaderText(options.sheetName || "")
    .replace(/\d+/g, "#")
    .slice(0, 40);
  const currency = String(options.currency || "TRY")
    .trim()
    .toUpperCase() || "TRY";

  const structural = [
    `cols:${joined}`,
    `hdr:${headerRowIndex}`,
    `meta:${metaRowCount}`,
    `dir:${directionModel}`,
    `bal:${hasBakiye ? 1 : 0}`,
    `dek:${hasDekont ? 1 : 0}`,
    `ref:${hasRef ? 1 : 0}`,
    `date:${dateFormatClass}`,
    `n:${headerKeys.length}`,
    sheetToken ? `sheet:${sheetToken}` : "",
  ]
    .filter(Boolean)
    .join("|");

  return {
    schemaFingerprint: fnv1aHex(structural),
    currency,
    directionModel,
    headerRowIndex,
    columnKeys: headerKeys,
    hasBalance: hasBakiye,
    hasDekont,
    hasReference: hasRef,
    dateFormatClass,
    structuralKey: structural,
  };
}

export function buildFormatMemoryLookupKey({
  companyId = "",
  schemaFingerprint = "",
  currency = "TRY",
  directionModel = "unknown",
} = {}) {
  return [
    String(companyId || "").trim(),
    String(schemaFingerprint || "").trim(),
    String(currency || "TRY").trim().toUpperCase() || "TRY",
    String(directionModel || "unknown").trim(),
  ].join("::");
}
