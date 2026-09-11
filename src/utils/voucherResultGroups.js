/**
 * Fiş bazlı sonuç grupları — ana tabloda her fisNo yalnız bir satır.
 * Ham findings mutate edilmez; motor/sayaç değişmez.
 */
import {
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
  E_DEFTER_KAYNAK,
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
import { matchesVoucherNumberFilter } from "@/src/utils/canonicalFisNo";

const SEVERITY_PRIORITY = {
  [E_DEFTER_ISSUE_SEVERITY.KRITIK]: 0,
  HATA: 0,
  [E_DEFTER_ISSUE_SEVERITY.UYARI]: 1,
  [E_DEFTER_ISSUE_SEVERITY.BILGI]: 2,
  UYGUN: 3,
};

export const VOUCHER_RESULT_VIEW = {
  FINDINGS: "findings",
  ALL: "all",
};

const LEDGER_VOUCHER_SOURCES = new Set([
  E_DEFTER_KAYNAK.MUAVIN,
  E_DEFTER_KAYNAK.YEVMIYE,
  E_DEFTER_KAYNAK.YEVMIYE_XML,
]);

function compactFis(value = "") {
  return String(value ?? "").trim();
}

function severityPriority(severity = "") {
  return SEVERITY_PRIORITY[severity] ?? 9;
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
  const record =
    item?.correctionRecord ||
    resolveCorrectionRecordForFinding(item, recordsByFingerprint);
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
 * Öncelik: çözülmemiş HATA/UYARI > APPLIED > bileşik fiş > diğer BİLGİ.
 */
export function selectVoucherPrimaryFinding(findings = [], options = {}) {
  const list = Array.isArray(findings) ? findings : [];
  if (!list.length) {
    return { primary: null, secondaryFindings: [], primaryKind: "empty" };
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
  includeAppropriate = false,
} = {}) {
  const catalog = Array.isArray(findingsCatalog) ? findingsCatalog : [];
  const correctionImpact = summarizeCorrectionPresentationImpact(
    catalog,
    Array.isArray(correctionRecords) ? correctionRecords : []
  );
  const recordsByFingerprint = correctionImpact.recordsByFingerprint;

  const byFis = new Map();
  const voucherMeta = new Map();
  if (includeAppropriate) {
    for (const row of Array.isArray(ledgerRows) ? ledgerRows : []) {
      const fisNo = compactFis(row?.fisNo);
      if (!fisNo || !LEDGER_VOUCHER_SOURCES.has(row?.kaynak)) continue;
      if (!voucherMeta.has(fisNo)) {
        voucherMeta.set(fisNo, {
          tarih: compactFis(row?.tarih),
          hesapKodu: compactFis(row?.hesapKodu),
        });
      }
      if (!byFis.has(fisNo)) byFis.set(fisNo, []);
    }
  }

  for (const raw of catalog) {
    const fisNo = compactFis(raw.fisNo);
    if (!fisNo) continue; // sistem/fişsiz bulgular ana tabloda fiş satırı üretmez
    const enriched = enrichCatalogItem(raw, recordsByFingerprint);
    const list = byFis.get(fisNo) || [];
    list.push(enriched);
    byFis.set(fisNo, list);
  }

  const groups = [];
  for (const [fisNo, findings] of byFis.entries()) {
    if (!findings.length) {
      const meta = voucherMeta.get(fisNo) || {};
      groups.push({
        kind: "voucher",
        id: `voucher|${fisNo}`,
        fisNo,
        tarih: meta.tarih || "",
        primaryFinding: null,
        primaryKind: "appropriate",
        primaryStatus: "Uygun",
        primarySeverity: "UYGUN",
        primaryAccount: "",
        primaryMessage: "Bu fişte gösterilecek bulgu yok.",
        primaryCode: "",
        secondaryFindings: [],
        findingCount: 0,
        secondaryCount: 0,
        findings: [],
        multiDetail: null,
        hasComposite: false,
        correctionRecord: null,
        correctionResolved: false,
        displayTitle: "Uygun",
        displayMessage: "Bu fişte gösterilecek bulgu yok.",
        severity: "UYGUN",
        code: "",
        hesapKodu: "",
        correctionStatusMessage: "",
        correctionStatusLabel: "",
      });
      continue;
    }

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

  return groups.sort((left, right) => {
    const leftUnresolved = left.findings
      .filter(
        (item) =>
          item.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI &&
          !item.correctionResolved
      )
      .sort(compareUnresolvedWarnings)[0];
    const rightUnresolved = right.findings
      .filter(
        (item) =>
          item.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI &&
          !item.correctionResolved
      )
      .sort(compareUnresolvedWarnings)[0];
    const leftSeverity =
      leftUnresolved?.severity ||
      (left.primaryKind === "appropriate"
        ? "UYGUN"
        : E_DEFTER_ISSUE_SEVERITY.BILGI);
    const rightSeverity =
      rightUnresolved?.severity ||
      (right.primaryKind === "appropriate"
        ? "UYGUN"
        : E_DEFTER_ISSUE_SEVERITY.BILGI);
    const rankDiff =
      severityPriority(leftSeverity) - severityPriority(rightSeverity);
    if (rankDiff !== 0) return rankDiff;
    return String(left.fisNo).localeCompare(String(right.fisNo), "tr", {
      numeric: true,
    });
  });
}

/** Aynı snapshot'tan Bulgular / Tüm fişler / görünür satırlar ve sayaçlar. */
export function buildVoucherResultSnapshot({
  findingsCatalog = [],
  fisFilter = "",
  correctionRecords = [],
  ledgerRows = [],
  showDuzeltildiOnly = false,
  view = VOUCHER_RESULT_VIEW.FINDINGS,
} = {}) {
  const query = String(fisFilter ?? "");
  const findingGroups = buildVoucherResultGroups({
    findingsCatalog,
    correctionRecords,
    ledgerRows,
  });
  const allGroups = buildVoucherResultGroups({
    findingsCatalog,
    correctionRecords,
    ledgerRows,
    includeAppropriate: true,
  });
  const selectedGroups =
    view === VOUCHER_RESULT_VIEW.ALL ? allGroups : findingGroups;
  let visibleRows = selectedGroups.filter((group) =>
    matchesVoucherNumberFilter(group.fisNo, query)
  );
  if (showDuzeltildiOnly) {
    visibleRows = visibleRows.filter((group) => group.correctionResolved);
  }
  return {
    findingGroups,
    allGroups,
    visibleRows,
    counts: {
      findings: findingGroups.length,
      appropriate: Math.max(0, allGroups.length - findingGroups.length),
      total: allGroups.length,
    },
  };
}

/** Ana tablo görünür fiş satırları — görünüm + filtre + düzeltildi filtresi. */
export function buildVisibleVoucherResultRows(options = {}) {
  return buildVoucherResultSnapshot(options).visibleRows;
}

export function voucherResultRowRenderKey(item = {}, index = 0) {
  return `voucher|${item.fisNo || "x"}|${item.primaryKind || ""}|${index}`;
}

export function countCompositeVoucherGroups(groups = []) {
  return (Array.isArray(groups) ? groups : []).filter((group) => group.hasComposite).length;
}
