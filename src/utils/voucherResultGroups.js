/**
 * Fiş bazlı sonuç grupları — ana tabloda her fisNo yalnız bir satır.
 * Ham findings mutate edilmez; motor/sayaç değişmez.
 */
import {
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
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
import { buildMultiCounterpartVoucherDetail } from "@/src/utils/multiCounterpartDetail";

const SEVERITY_PRIORITY = {
  [E_DEFTER_ISSUE_SEVERITY.KRITIK]: 0,
  HATA: 0,
  [E_DEFTER_ISSUE_SEVERITY.UYARI]: 1,
  [E_DEFTER_ISSUE_SEVERITY.BILGI]: 2,
};

function compactFis(value = "") {
  return String(value ?? "").trim();
}

function severityPriority(severity = "") {
  return SEVERITY_PRIORITY[severity] ?? 9;
}

/** yerel kopya — genelMuhasebeFindingsView ile döngüsel import yok */
function normalizeFisNoForFilter(value = "") {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) {
    const stripped = trimmed.replace(/^0+/, "");
    return stripped === "" ? "0" : stripped;
  }
  return trimmed.toLocaleLowerCase("tr-TR");
}

function matchesVoucherNumberFilter(voucherNo, query = "") {
  const needle = normalizeFisNoForFilter(query);
  if (!needle) return true;
  const haystack = normalizeFisNoForFilter(voucherNo);
  if (!haystack) return false;
  return haystack === needle;
}

function sortFindingsBySeverity(catalog = []) {
  return [...catalog].sort((left, right) => {
    const rankDiff = severityPriority(left.severity) - severityPriority(right.severity);
    if (rankDiff !== 0) return rankDiff;
    const fisDiff = String(left.fisNo || "").localeCompare(String(right.fisNo || ""), "tr");
    if (fisDiff !== 0) return fisDiff;
    return String(left.hesapKodu || "").localeCompare(String(right.hesapKodu || ""), "tr");
  });
}

function enrichCatalogItem(item, recordsByFingerprint) {
  const record = resolveCorrectionRecordForFinding(item, recordsByFingerprint);
  const enriched = enrichFindingWithCorrectionRecord(
    enrichFindingForUserPresentation({ kind: "single", ...item }),
    record
  );
  if (enriched.correctionResolved) {
    enriched.displayTitle = enriched.correctionStatusLabel || "Düzeltildi";
  }
  return enriched;
}

function compareUnresolvedWarnings(left, right) {
  const sev = severityPriority(left.severity) - severityPriority(right.severity);
  if (sev !== 0) return sev;
  return String(left.hesapKodu || "").localeCompare(String(right.hesapKodu || ""), "tr");
}

/**
 * Öncelik: APPLIED > çözülmemiş HATA/UYARI > bileşik fiş > diğer BİLGİ.
 */
export function selectVoucherPrimaryFinding(findings = [], options = {}) {
  const list = Array.isArray(findings) ? findings : [];
  if (!list.length) {
    return { primary: null, secondaryFindings: [], primaryKind: "empty" };
  }

  const applied = list.filter((item) => item.correctionResolved);
  if (applied.length) {
    const sortedApplied = [...applied].sort(compareUnresolvedWarnings);
    const primary = sortedApplied[0];
    return {
      primary,
      secondaryFindings: list.filter((item) => item !== primary),
      primaryKind: "applied",
    };
  }

  const unresolved = list
    .filter(
      (item) =>
        item.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI &&
        item.severity !== E_DEFTER_ISSUE_SEVERITY.UYGUN &&
        !item.correctionResolved
    )
    .sort(compareUnresolvedWarnings);
  if (unresolved.length) {
    const primary = unresolved[0];
    return {
      primary,
      secondaryFindings: list.filter((item) => item !== primary),
      primaryKind: "warning",
    };
  }

  const multiItems = list.filter(
    (item) => item.code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART
  );
  if (multiItems.length) {
    const fisNo = compactFis(multiItems[0].fisNo);
    const tarih = compactFis(multiItems[0].tarih);
    const messageTr = genelMuhasebeMultiGroupMessageTr(fisNo, multiItems.length);
    const primary = enrichFindingForUserPresentation({
      kind: "group",
      id: `multi|${fisNo}|${E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART}`,
      fisNo,
      tarih,
      hesapKodu: "",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
      message: messageTr,
      count: multiItems.length,
      details: multiItems,
      multiDetail: options.multiDetail || null,
      displayTitle: "Bileşik fiş",
      titleTr: "Bileşik fiş",
      displayMessage: messageTr,
      messageTr,
    });
    return {
      primary,
      secondaryFindings: list.filter(
        (item) => item.code !== E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART
      ),
      primaryKind: "composite",
    };
  }

  const sortedInfo = sortFindingsBySeverity(list);
  const primary = sortedInfo[0];
  return {
    primary,
    secondaryFindings: list.filter((item) => item !== primary),
    primaryKind: "info",
  };
}

/**
 * Correction-aware findings → fisNo bazlı salt okunur voucherResultGroups.
 * Catalog mutate edilmez.
 */
export function buildVoucherResultGroups({
  findingsCatalog = [],
  correctionRecords = [],
  ledgerRows = [],
} = {}) {
  const catalog = Array.isArray(findingsCatalog) ? findingsCatalog : [];
  const correctionImpact = summarizeCorrectionPresentationImpact(
    catalog,
    Array.isArray(correctionRecords) ? correctionRecords : []
  );
  const recordsByFingerprint = correctionImpact.recordsByFingerprint;

  const byFis = new Map();
  for (const raw of catalog) {
    const fisNo = compactFis(raw.fisNo);
    if (!fisNo) continue; // sistem/fişsiz bulgular ana tabloda fiş satırı üretmez
    const enriched = enrichCatalogItem(raw, recordsByFingerprint);
    const list = byFis.get(fisNo) || [];
    list.push(enriched);
    byFis.set(fisNo, list);
  }

  const groups = [];
  for (const [fisNo, findings] of [...byFis.entries()].sort((a, b) =>
    String(a[0]).localeCompare(String(b[0]), "tr")
  )) {
    const multiItems = findings.filter(
      (item) => item.code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART
    );
    const multiDetail =
      multiItems.length > 0
        ? buildMultiCounterpartVoucherDetail({
            fisNo,
            tarih: findings[0]?.tarih || "",
            ledgerRows,
            multiFindingItems: multiItems,
          })
        : null;

    const { primary, secondaryFindings, primaryKind } = selectVoucherPrimaryFinding(
      findings,
      { multiDetail }
    );
    if (!primary) continue;

    const correctionRecord =
      primary.correctionRecord ||
      findings.find((item) => item.correctionRecord)?.correctionRecord ||
      null;

    const primaryStatus =
      primaryKind === "applied"
        ? primary.correctionStatusLabel || "Düzeltildi"
        : primaryKind === "composite"
          ? "Bileşik fiş"
          : primary.displayTitle || primary.titleTr || primary.code || "İnceleme";

    const primaryMessage =
      primaryKind === "applied"
        ? primary.correctionStatusMessage || primary.displayMessage || primary.messageTr
        : primary.displayMessage || primary.messageTr || primary.message;

    groups.push({
      kind: "voucher",
      id: `voucher|${fisNo}`,
      fisNo,
      tarih: primary.tarih || findings[0]?.tarih || "",
      primaryFinding: primary,
      primaryKind,
      primaryStatus,
      primarySeverity: primary.severity || E_DEFTER_ISSUE_SEVERITY.BILGI,
      primaryAccount: primary.hesapKodu || "",
      primaryMessage,
      primaryCode: primary.code || "",
      secondaryFindings,
      findingCount: findings.length,
      secondaryCount: secondaryFindings.length,
      findings, // ham (enrich edilmiş) — kayıp yok
      multiDetail,
      hasComposite: Boolean(multiDetail) || primaryKind === "composite",
      correctionRecord,
      correctionResolved: Boolean(primary.correctionResolved),
      displayTitle: primaryStatus,
      displayMessage: primaryMessage,
      severity: primary.severity,
      code: primary.code,
      hesapKodu: primary.hesapKodu || "",
      // Correction CTA için primary üzerinden
      correctionStatusMessage: primary.correctionStatusMessage || "",
      correctionStatusLabel: primary.correctionStatusLabel || "",
    });
  }

  return groups;
}

/** Ana tablo görünür fiş satırları — filtre + düzeltildi filtresi. */
export function buildVisibleVoucherResultRows({
  findingsCatalog = [],
  fisFilter = "",
  correctionRecords = [],
  ledgerRows = [],
  showDuzeltildiOnly = false,
} = {}) {
  const query = String(fisFilter ?? "");
  const groups = buildVoucherResultGroups({
    findingsCatalog,
    correctionRecords,
    ledgerRows,
  });
  const filtered = groups.filter((group) =>
    matchesVoucherNumberFilter(group.fisNo, query)
  );
  if (!showDuzeltildiOnly) return filtered;
  return filtered.filter((group) => group.correctionResolved);
}

export function voucherResultRowRenderKey(item = {}, index = 0) {
  return `voucher|${item.fisNo || "x"}|${item.primaryKind || ""}|${index}`;
}

export function countCompositeVoucherGroups(groups = []) {
  return (Array.isArray(groups) ? groups : []).filter((group) => group.hasComposite).length;
}
