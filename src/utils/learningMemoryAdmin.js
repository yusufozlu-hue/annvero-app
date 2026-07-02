import { formatDateTime } from "@/src/utils/companyCenter";

export function buildLearningMemoryDescription(record = {}) {
  const fisAciklama = String(record.counter_account_name || "").trim();
  const detayAciklama = String(record.description_format || "").trim();

  if (fisAciklama && detayAciklama) {
    return `${fisAciklama} / ${detayAciklama}`;
  }

  return detayAciklama || fisAciklama || "-";
}

export function mapLearningMemoryRecordToListRow(record, companyName = "") {
  return {
    id: record.id,
    firmaId: record.company_id,
    firmaAdi: companyName || record.company_id || "-",
    kaynakTipi: record.transaction_type || record.source_module || "-",
    kaynakAdi: record.account_name || "-",
    aramaAnahtari: record.keyword || "",
    hesapKodu: record.account_code || "",
    belgeTuru: record.document_type || "",
    aciklama: buildLearningMemoryDescription(record),
    fisAciklama: record.counter_account_name || "",
    detayAciklama: record.description_format || "",
    sonGuncelleme: record.updated_at || record.created_at || "",
    isActive: record.is_active !== false,
    raw: record,
  };
}

export function buildLearningMemoryEditDraft(record = {}) {
  return {
    keyword: record.keyword || "",
    account_code: record.account_code || "",
    document_type: record.document_type || "DK",
    counter_account_name: record.counter_account_name || "",
    description_format: record.description_format || "",
    is_active: record.is_active !== false,
  };
}

export function buildLearningMemoryUpdatePayload(draft = {}) {
  return {
    keyword: String(draft.keyword || "").trim(),
    account_code: String(draft.account_code || "").trim(),
    document_type: String(draft.document_type || "DK").trim(),
    counter_account_name: String(draft.counter_account_name || "").trim(),
    description_format: String(draft.description_format || "").trim(),
    is_active: draft.is_active !== false,
  };
}

export function formatLearningMemoryDate(value) {
  if (!value) return "-";
  return formatDateTime(value);
}

export function normalizeKaynakTipiFilter(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr")
    .replaceAll("İ", "I");
}

export function filterLearningMemoryRows(
  rows = [],
  { search = "", companyId = "", kaynakTipi = "" } = {}
) {
  const query = search.trim().toLocaleLowerCase("tr");
  const kaynakFilter = normalizeKaynakTipiFilter(kaynakTipi);

  return rows.filter((row) => {
    if (companyId && row.firmaId !== companyId) return false;

    if (kaynakFilter && kaynakFilter !== "TUMU") {
      if (
        normalizeKaynakTipiFilter(row.kaynakTipi) !==
        normalizeKaynakTipiFilter(kaynakTipi)
      ) {
        return false;
      }
    }

    if (!query) return true;

    const haystack = [
      row.firmaAdi,
      row.kaynakTipi,
      row.kaynakAdi,
      row.aramaAnahtari,
      row.hesapKodu,
      row.belgeTuru,
      row.aciklama,
      row.fisAciklama,
      row.detayAciklama,
    ]
      .join(" ")
      .toLocaleLowerCase("tr");

    return haystack.includes(query);
  });
}

export function getLearningMemoryKaynakTipiOptions(rows = []) {
  const values = new Set();

  rows.forEach((row) => {
    const kaynak = String(row.kaynakTipi || "").trim();
    if (kaynak && kaynak !== "-") {
      values.add(kaynak);
    }
  });

  return Array.from(values).sort((left, right) =>
    left.localeCompare(right, "tr")
  );
}
