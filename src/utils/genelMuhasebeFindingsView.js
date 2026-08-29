import {
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
  E_DEFTER_SONUC_SEVIYE,
} from "@/src/config/eDefterKontrolDefaults";
import {
  enrichFindingForUserPresentation,
  genelMuhasebeMultiGroupMessageTr,
} from "@/src/utils/genelMuhasebeFindingsLabels";
import {
  enrichFindingWithCorrectionRecord,
  resolveCorrectionRecordForFinding,
  summarizeCorrectionPresentationImpact,
} from "@/src/utils/correctionRecords/correctionRecordPresentation";
import { CORRECTION_RECORD_STATUS } from "@/src/utils/correctionRecords/correctionRecordTypes";
import { buildMultiCounterpartVoucherDetail } from "@/src/utils/multiCounterpartDetail";

function isSyntheticSystemFindingRow(row = {}) {
  const id = String(row?.id || "");
  return (
    id.startsWith("donem-sonu") ||
    id.startsWith("fis-gap") ||
    id.startsWith("teknik-") ||
    id.startsWith("vergisel-") ||
    id.startsWith("capraz-") ||
    id.startsWith("cross-")
  );
}

const SEVERITY_RANK = {
  [E_DEFTER_ISSUE_SEVERITY.KRITIK]: 0,
  HATA: 0,
  [E_DEFTER_ISSUE_SEVERITY.UYARI]: 1,
  [E_DEFTER_ISSUE_SEVERITY.BILGI]: 2,
  [E_DEFTER_ISSUE_SEVERITY.UYGUN]: 3,
};

const SONUC_RANK = {
  [E_DEFTER_SONUC_SEVIYE.KRITIK]: 3,
  [E_DEFTER_SONUC_SEVIYE.UYARI]: 2,
  [E_DEFTER_SONUC_SEVIYE.BILGI]: 1,
  [E_DEFTER_SONUC_SEVIYE.UYGUN]: 0,
};

const REVIEW_ISSUE_CODES = new Set([
  E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART,
  E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE,
  E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW,
  E_DEFTER_ISSUE_CODE.COUNTERPART_SELF,
  E_DEFTER_ISSUE_CODE.COUNTERPART_CONFLICT,
  E_DEFTER_ISSUE_CODE.MUAVIN_YEVMIYE_MISMATCH,
  E_DEFTER_ISSUE_CODE.MIZAN_MUAVIN_MISMATCH,
]);

function severityRank(severity = "") {
  return SEVERITY_RANK[severity] ?? 9;
}

function issueToSonuc(severity = "") {
  if (severity === E_DEFTER_ISSUE_SEVERITY.KRITIK || severity === "HATA") {
    return E_DEFTER_SONUC_SEVIYE.KRITIK;
  }
  if (severity === E_DEFTER_ISSUE_SEVERITY.UYARI) return E_DEFTER_SONUC_SEVIYE.UYARI;
  if (severity === E_DEFTER_ISSUE_SEVERITY.BILGI) return E_DEFTER_SONUC_SEVIYE.BILGI;
  return E_DEFTER_SONUC_SEVIYE.UYGUN;
}

function normalizeFinding(raw = {}, source = "row") {
  return {
    source,
    fisNo: String(raw.fisNo || "").trim(),
    tarih: String(raw.tarih || "").trim(),
    hesapKodu: String(raw.hesapKodu || "").trim(),
    severity: raw.severity || E_DEFTER_ISSUE_SEVERITY.BILGI,
    code: raw.code || "",
    message: String(raw.message || "").trim(),
    statusLabel: String(raw.statusLabel || "").trim(),
    kaynak: raw.kaynak || "",
    groupKey: `${String(raw.fisNo || "").trim()}|${raw.code || ""}`,
  };
}

/** Flat normalized catalog — motor sayaçları ve UI aynı kaynaktan türer. */
export function buildGenelMuhasebeFindingsCatalog({
  rows = [],
  findingExtras = [],
  includeSyntheticRows = false,
} = {}) {
  const catalog = [];

  for (const issue of findingExtras) {
    catalog.push(normalizeFinding(issue, "extra"));
  }

  for (const row of rows) {
    if (!includeSyntheticRows && isSyntheticSystemFindingRow(row)) continue;
    for (const issue of row.issueDetails || []) {
      catalog.push(
        normalizeFinding(
          {
            ...issue,
            fisNo: row.fisNo,
            tarih: row.tarih,
            hesapKodu: row.hesapKodu,
            kaynak: row.kaynak,
          },
          "row"
        )
      );
    }
  }

  return catalog;
}

export function countFindingsBySeverity(catalog = []) {
  const counts = {
    [E_DEFTER_ISSUE_SEVERITY.KRITIK]: 0,
    HATA: 0,
    [E_DEFTER_ISSUE_SEVERITY.UYARI]: 0,
    [E_DEFTER_ISSUE_SEVERITY.BILGI]: 0,
  };
  for (const item of catalog) {
    const key = item.severity in counts ? item.severity : E_DEFTER_ISSUE_SEVERITY.BILGI;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function countFindingsByCode(catalog = []) {
  const counts = new Map();
  for (const item of catalog) {
    const code = item.code || "UNKNOWN";
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort((left, right) => right[1] - left[1])
  );
}

/** Özet kartları — yalnız normalize katalogdan. */
export function summarizeGenelMuhasebeFindingsCatalog(catalog = []) {
  let overallSonuc = E_DEFTER_SONUC_SEVIYE.UYGUN;
  let incelemeGerekli = 0;

  for (const item of catalog) {
    const mapped = issueToSonuc(item.severity);
    if ((SONUC_RANK[mapped] || 0) > (SONUC_RANK[overallSonuc] || 0)) {
      overallSonuc = mapped;
    }
    if (item.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI) {
      incelemeGerekli += 1;
    }
  }

  return {
    overallSonuc,
    incelemeGerekli,
    severityCounts: countFindingsBySeverity(catalog),
    codeCounts: countFindingsByCode(catalog),
  };
}

export function sortFindingsBySeverity(catalog = []) {
  return [...catalog].sort((left, right) => {
    const rankDiff = severityRank(left.severity) - severityRank(right.severity);
    if (rankDiff !== 0) return rankDiff;
    const fisDiff = String(left.fisNo).localeCompare(String(right.fisNo), "tr");
    if (fisDiff !== 0) return fisDiff;
    return String(left.hesapKodu).localeCompare(String(right.hesapKodu), "tr");
  });
}

/** Fiş filtresi — baştaki sıfırları korur, yalnız trim. */
export function normalizeFisNoForFilter(value = "") {
  return String(value ?? "").trim();
}

function matchesFisFilter(finding, fisFilter = "") {
  const needle = normalizeFisNoForFilter(fisFilter);
  if (!needle) return true;
  return normalizeFisNoForFilter(finding.fisNo) === needle;
}

function presentationRowMatchesFisFilter(row, fisFilter = "") {
  const needle = normalizeFisNoForFilter(fisFilter);
  if (!needle) return true;
  return normalizeFisNoForFilter(row.fisNo) === needle;
}

/** Presentation satırlarına filtre — gruplu MULTI dahil. */
export function filterGenelMuhasebePresentationRows(rows = [], fisFilter = "") {
  const needle = normalizeFisNoForFilter(fisFilter);
  if (!needle) return rows;
  return rows
    .filter((row) => presentationRowMatchesFisFilter(row, needle))
    .map((row) => {
      if (row.kind !== "group" || !Array.isArray(row.details)) return row;
      const details = row.details.filter((detail) =>
        presentationRowMatchesFisFilter(detail, needle)
      );
      const count = details.length;
      const messageTr = genelMuhasebeMultiGroupMessageTr(row.fisNo, count);
      return enrichFindingForUserPresentation({
        ...row,
        details,
        count,
        message: messageTr,
        messageTr,
        multiDetail: row.multiDetail || null,
      });
    });
}

function buildMultiCounterpartGroup(items = [], ledgerRows = []) {
  const fisNo = items[0]?.fisNo || "";
  const tarih = items[0]?.tarih || "";
  const count = items.length;
  const messageTr = genelMuhasebeMultiGroupMessageTr(fisNo, count);
  const details = items.map((item) => enrichFindingForUserPresentation(item));
  const multiDetail = buildMultiCounterpartVoucherDetail({
    fisNo,
    tarih,
    ledgerRows,
    multiFindingItems: items,
  });
  return enrichFindingForUserPresentation({
    kind: "group",
    id: `multi|${fisNo}|${E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART}`,
    fisNo,
    tarih,
    hesapKodu: "",
    severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
    code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
    message: messageTr,
    statusLabel: "",
    count,
    details,
    multiDetail,
  });
}

/**
 * UI sunumu — motor sayaçlarını değiştirmez.
 * MULTI_COUNTERPART aynı fişte tek özet satır; HATA/UYARI her zaman üstte.
 */
export function buildGenelMuhasebeFindingsPresentation(catalog = [], options = {}) {
  const fisFilter = normalizeFisNoForFilter(options.fisFilter || "");
  const correctionRecords = Array.isArray(options.correctionRecords)
    ? options.correctionRecords
    : [];
  const ledgerRows = Array.isArray(options.ledgerRows)
    ? options.ledgerRows
    : Array.isArray(options.rows)
      ? options.rows
      : [];
  const correctionImpact = summarizeCorrectionPresentationImpact(catalog, correctionRecords);
  const recordsByFingerprint = correctionImpact.recordsByFingerprint;

  const filtered = catalog.filter((item) => matchesFisFilter(item, fisFilter));
  const sorted = sortFindingsBySeverity(filtered);

  const priority = [];
  const multiByFis = new Map();
  const otherInfo = [];

  function presentFinding(item, kind = "single") {
    const record = resolveCorrectionRecordForFinding(item, recordsByFingerprint);
    const enriched = enrichFindingWithCorrectionRecord(
      enrichFindingForUserPresentation({ kind, ...item }),
      record
    );
    if (enriched.correctionResolved) {
      enriched.displayTitle = enriched.correctionStatusLabel || "Düzeltildi";
    }
    return enriched;
  }

  for (const item of sorted) {
    if (item.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI) {
      priority.push(presentFinding(item));
      continue;
    }
    if (item.code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART) {
      const key = item.fisNo || "—";
      const list = multiByFis.get(key) || [];
      list.push(item);
      multiByFis.set(key, list);
      continue;
    }
    otherInfo.push(presentFinding(item));
  }

  const groupedMulti = [...multiByFis.entries()]
    .sort((left, right) => String(left[0]).localeCompare(String(right[0]), "tr"))
    .map(([, items]) => {
      const group = buildMultiCounterpartGroup(items, ledgerRows);
      const record = resolveCorrectionRecordForFinding(items[0], recordsByFingerprint);
      return enrichFindingWithCorrectionRecord(group, record);
    });

  const built = [...priority, ...groupedMulti, ...otherInfo];
  return filterGenelMuhasebePresentationRows(built, fisFilter);
}

/**
 * Düzeltme kayıtlarıyla Genel Sonuç / İnceleme / Düzeltildi.
 * APPLIED bulgular unresolved katalogdan çıkarılır; EXPORTED/CANCELLED unresolved kalır.
 * overallSonuc ve incelemeGerekli aynı correction-aware katalogdan türetilir.
 * Motor ham özetine (summary.overallSonuc) dokunmaz — UI correction-aware özeti kullanır.
 */
export function summarizeGenelMuhasebeFindingsWithCorrections(catalog = [], correctionRecords = []) {
  const base = summarizeGenelMuhasebeFindingsCatalog(catalog);
  const correctionImpact = summarizeCorrectionPresentationImpact(catalog, correctionRecords);

  const unresolvedCatalog = [];
  for (const item of catalog) {
    if (item.severity === E_DEFTER_ISSUE_SEVERITY.BILGI) {
      unresolvedCatalog.push(item);
      continue;
    }
    const record = resolveCorrectionRecordForFinding(
      item,
      correctionImpact.recordsByFingerprint
    );
    if (record?.status === CORRECTION_RECORD_STATUS.APPLIED) {
      continue;
    }
    unresolvedCatalog.push(item);
  }

  const corrected = summarizeGenelMuhasebeFindingsCatalog(unresolvedCatalog);
  return {
    ...corrected,
    duzeltildi: correctionImpact.duzeltildi,
    exportedPending: correctionImpact.exportedPending,
    incelemeGerekliRaw: base.incelemeGerekli,
  };
}

/** Aktif presentation içindeki gruplu satır kimlikleri. */
export function collectPresentationGroupIds(rows = []) {
  return new Set(
    rows.filter((row) => row.kind === "group" && row.id).map((row) => row.id)
  );
}

/** Filtre dışında kalan parent gruplarının expansion state'ini buda. */
export function pruneExpandedPresentationGroups(expandedGroupIds = [], presentationRows = []) {
  const allowed = collectPresentationGroupIds(presentationRows);
  return new Set(
    [...expandedGroupIds].filter((id) => allowed.has(id))
  );
}

/** Tabloda görünen satır sayısı — açık grup ayrıntıları dahil. */
export function countVisiblePresentationRows(presentationRows = [], expandedGroupIds = new Set()) {
  let count = 0;
  for (const row of presentationRows) {
    if (row.kind === "group") {
      count += 1;
      if (expandedGroupIds.has(row.id)) {
        count += (row.details || []).length;
      }
      continue;
    }
    count += 1;
  }
  return count;
}

export function isReviewIssueCode(code = "") {
  return REVIEW_ISSUE_CODES.has(code);
}
