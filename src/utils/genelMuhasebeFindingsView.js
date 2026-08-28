import {
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
  E_DEFTER_SONUC_SEVIYE,
} from "@/src/config/eDefterKontrolDefaults";

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

function matchesFisFilter(finding, fisFilter = "") {
  const needle = String(fisFilter || "").trim();
  if (!needle) return true;
  return String(finding.fisNo || "").includes(needle);
}

function buildMultiCounterpartGroup(items = []) {
  const fisNo = items[0]?.fisNo || "";
  const count = items.length;
  return {
    kind: "group",
    id: `multi|${fisNo}|${E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART}`,
    fisNo,
    tarih: items[0]?.tarih || "",
    hesapKodu: "",
    severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
    code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
    message: `Fiş ${fisNo || "—"} — ${count} hesap satırı — çoklu karşıt hesap; otomatik tek karşıt atanmadı.`,
    statusLabel: "",
    count,
    details: items,
  };
}

/**
 * UI sunumu — motor sayaçlarını değiştirmez.
 * MULTI_COUNTERPART aynı fişte tek özet satır; HATA/UYARI her zaman üstte.
 */
export function buildGenelMuhasebeFindingsPresentation(catalog = [], options = {}) {
  const fisFilter = options.fisFilter || "";
  const filtered = catalog.filter((item) => matchesFisFilter(item, fisFilter));
  const sorted = sortFindingsBySeverity(filtered);

  const priority = [];
  const multiByFis = new Map();
  const otherInfo = [];

  for (const item of sorted) {
    if (item.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI) {
      priority.push({ kind: "single", ...item });
      continue;
    }
    if (item.code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART) {
      const key = item.fisNo || "—";
      const list = multiByFis.get(key) || [];
      list.push(item);
      multiByFis.set(key, list);
      continue;
    }
    otherInfo.push({ kind: "single", ...item });
  }

  const groupedMulti = [...multiByFis.entries()]
    .sort((left, right) => String(left[0]).localeCompare(String(right[0]), "tr"))
    .map(([, items]) => buildMultiCounterpartGroup(items));

  return [...priority, ...groupedMulti, ...otherInfo];
}

export function isReviewIssueCode(code = "") {
  return REVIEW_ISSUE_CODES.has(code);
}
