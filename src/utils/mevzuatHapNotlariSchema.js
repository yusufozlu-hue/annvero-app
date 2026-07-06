export const MEVZUAT_HAP_NOTU_SOURCES = [
  "GİB",
  "SGK",
  "Resmî Gazete",
  "TÜRMOB",
  "İSMMMO",
  "Ticaret Bakanlığı",
  "TCMB",
  "KOSGEB",
  "Diğer",
];

export const MEVZUAT_HAP_NOTU_CATEGORIES = [
  "Vergi",
  "SGK",
  "E-Belge",
  "Teşvik",
  "Ticaret",
  "Finans",
  "Diğer",
];

export function normalizeMevzuatSource(value) {
  const normalized = String(value || "").trim();
  return MEVZUAT_HAP_NOTU_SOURCES.includes(normalized) ? normalized : "Diğer";
}

export function normalizeMevzuatCategory(value) {
  const normalized = String(value || "").trim();
  return MEVZUAT_HAP_NOTU_CATEGORIES.includes(normalized) ? normalized : "Diğer";
}

export function toMevzuatHapNotuDbRow(input = {}) {
  return {
    title: String(input.title || "").trim(),
    source: normalizeMevzuatSource(input.source),
    source_url: String(input.sourceUrl || input.source_url || "").trim() || null,
    category: normalizeMevzuatCategory(input.category),
    summary: String(input.summary || "").trim(),
    published_at:
      input.publishedAt || input.published_at || new Date().toISOString(),
    is_pinned: Boolean(input.isPinned ?? input.is_pinned),
    is_active: input.isActive ?? input.is_active ?? true,
  };
}

export function fromMevzuatHapNotuDbRow(row = {}) {
  return {
    id: row.id,
    title: row.title || "",
    source: row.source || "Diğer",
    sourceUrl: row.source_url || "",
    category: row.category || "Diğer",
    summary: row.summary || "",
    publishedAt: row.published_at || "",
    createdAt: row.created_at || "",
    isPinned: Boolean(row.is_pinned),
    isActive: row.is_active !== false,
  };
}

export function mapMevzuatHapNotuRows(rows = []) {
  return rows.map((row) => fromMevzuatHapNotuDbRow(row));
}

export function formatMevzuatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
