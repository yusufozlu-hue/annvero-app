import { formatDateTime } from "@/src/utils/companyCenter";

export function buildLearningMemoryDescription(record = {}) {
  const fisAciklama = String(record.cari_name || record.counter_account_name || "").trim();
  const detayAciklama = String(
    record.clean_description || record.raw_description || record.description_format || ""
  ).trim();

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
    kaynakAdi: record.bank_name || record.account_name || "-",
    aramaAnahtari: record.keyword || "",
    hesapKodu: record.account_code || "",
    hesapAdi: record.account_name || "",
    belgeTuru: record.document_type || "",
    cari: record.cari_name || record.counter_account_name || "",
    aciklama: buildLearningMemoryDescription(record),
    fisAciklama: record.cari_name || record.counter_account_name || "",
    detayAciklama: record.clean_description || record.description_format || "",
    matchCount: Number(record.match_count || 0),
    lastMatchedAt: record.last_matched_at || "",
    sonGuncelleme: record.updated_at || record.learned_at || record.created_at || "",
    status: record.status || (record.is_active === false ? "passive" : "active"),
    isActive:
      record.status === "passive" ? false : record.is_active !== false,
    raw: record,
  };
}

export function buildLearningMemoryEditDraft(record = {}) {
  return {
    keyword: record.keyword || "",
    account_code: record.account_code || "",
    account_name: record.account_name || "",
    document_type: record.document_type || "DK",
    cari_name: record.cari_name || record.counter_account_name || "",
    clean_description: record.clean_description || record.description_format || "",
    status: record.status || (record.is_active === false ? "passive" : "active"),
  };
}

export function buildLearningMemoryUpdatePayload(draft = {}) {
  return {
    keyword: String(draft.keyword || "").trim(),
    account_code: String(draft.account_code || "").trim(),
    account_name: String(draft.account_name || "").trim(),
    document_type: String(draft.document_type || "DK").trim(),
    cari_name: String(draft.cari_name || "").trim(),
    clean_description: String(draft.clean_description || "").trim(),
    status: draft.status === "passive" ? "passive" : "active",
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
      row.hesapAdi,
      row.belgeTuru,
      row.cari,
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
