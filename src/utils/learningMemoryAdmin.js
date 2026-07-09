import { formatDateTime } from "@/src/utils/companyCenter";

export const LEARNING_MEMORY_STATUS_LABELS = {
  active: "Aktif",
  passive: "Pasif",
  deleted: "Silindi",
};

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
    matchCount: Number(record.match_count ?? record.usage_count ?? 0),
    lastMatchedAt: record.last_matched_at || "",
    learnedAt: record.learned_at || record.created_at || "",
    sonGuncelleme: record.updated_at || record.learned_at || record.created_at || "",
    status: record.status || (record.is_active === false ? "passive" : "active"),
    isActive:
      ["passive", "deleted"].includes(String(record.status || "").toLowerCase())
        ? false
        : record.is_active !== false,
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

export function buildLearningMemoryCreateDraft(defaults = {}) {
  return {
    company_id: defaults.company_id || defaults.companyId || "",
    keyword: defaults.keyword || "",
    transaction_type: defaults.transaction_type || defaults.transactionType || "",
    bank_name: defaults.bank_name || defaults.bankName || "",
    account_code: defaults.account_code || "",
    account_name: defaults.account_name || "",
    cari_name: defaults.cari_name || "",
    document_type: defaults.document_type || "DK",
    status: defaults.status || "active",
    clean_description: defaults.clean_description || "",
  };
}

export function buildLearningMemoryCreatePayload(draft = {}) {
  const status = ["active", "passive", "deleted"].includes(draft.status)
    ? draft.status
    : "active";

  return {
    company_id: String(draft.company_id || "").trim(),
    keyword: String(draft.keyword || "").trim(),
    transaction_type: String(draft.transaction_type || "").trim(),
    bank_name: String(draft.bank_name || "").trim(),
    account_code: String(draft.account_code || "").trim(),
    account_name: String(draft.account_name || "").trim(),
    cari_name: String(draft.cari_name || "").trim(),
    document_type: String(draft.document_type || "DK").trim(),
    clean_description: String(draft.clean_description || draft.keyword || "").trim(),
    status,
  };
}

export function buildLearningMemoryUpdatePayload(draft = {}) {
  const status = ["active", "passive", "deleted"].includes(draft.status)
    ? draft.status
    : "active";

  return {
    keyword: String(draft.keyword || "").trim(),
    account_code: String(draft.account_code || "").trim(),
    account_name: String(draft.account_name || "").trim(),
    document_type: String(draft.document_type || "DK").trim(),
    cari_name: String(draft.cari_name || "").trim(),
    clean_description: String(draft.clean_description || "").trim(),
    status,
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

function normalizeFilterText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr");
}

export function filterLearningMemoryRows(
  rows = [],
  {
    search = "",
    companyId = "",
    kaynakTipi = "",
    accountCode = "",
    documentType = "",
    bankName = "",
    status = "",
  } = {}
) {
  const query = normalizeFilterText(search);
  const kaynakFilter = normalizeKaynakTipiFilter(kaynakTipi);
  const accountCodeQuery = normalizeFilterText(accountCode);
  const documentFilter = normalizeFilterText(documentType);
  const bankFilter = normalizeFilterText(bankName);
  const statusFilter = normalizeFilterText(status);

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

    if (accountCodeQuery && !normalizeFilterText(row.hesapKodu).includes(accountCodeQuery)) {
      return false;
    }

    if (
      documentFilter &&
      documentFilter !== "tumu" &&
      normalizeFilterText(row.belgeTuru) !== documentFilter
    ) {
      return false;
    }

    if (
      bankFilter &&
      bankFilter !== "tumu" &&
      normalizeFilterText(row.kaynakAdi) !== bankFilter
    ) {
      return false;
    }

    if (
      statusFilter &&
      statusFilter !== "tumu" &&
      normalizeFilterText(row.status) !== statusFilter
    ) {
      return false;
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

function getUniqueSortedValues(rows = [], getter) {
  const values = new Set();

  rows.forEach((row) => {
    const value = String(getter(row) || "").trim();
    if (value && value !== "-") {
      values.add(value);
    }
  });

  return Array.from(values).sort((left, right) =>
    left.localeCompare(right, "tr")
  );
}

export function getLearningMemoryKaynakTipiOptions(rows = []) {
  return getUniqueSortedValues(rows, (row) => row.kaynakTipi);
}

export function getLearningMemoryDocumentTypeOptions(rows = []) {
  return getUniqueSortedValues(rows, (row) => row.belgeTuru);
}

export function getLearningMemoryBankOptions(rows = []) {
  return getUniqueSortedValues(rows, (row) => row.kaynakAdi);
}

export function getLearningMemoryStats(rows = []) {
  const visibleRows = rows.filter(
    (row) => String(row.status || "active").toLowerCase() !== "deleted"
  );
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const matchedThisMonth = visibleRows.filter((row) => {
    if (!row.lastMatchedAt) return false;
    const date = new Date(row.lastMatchedAt);
    if (Number.isNaN(date.getTime())) return false;
    return date.getFullYear() === currentYear && date.getMonth() === currentMonth;
  });
  const topMatched = visibleRows.reduce((best, row) => {
    if (!best || Number(row.matchCount || 0) > Number(best.matchCount || 0)) {
      return row;
    }
    return best;
  }, null);

  return {
    total: visibleRows.length,
    active: visibleRows.filter((row) => row.status === "active").length,
    passive: visibleRows.filter((row) => row.status === "passive").length,
    matchedThisMonth: matchedThisMonth.length,
    topMatched,
  };
}
