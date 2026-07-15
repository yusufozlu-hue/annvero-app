/**
 * Cari eksik satır gruplama + yönlü aday arama (Çözüm Merkezi V1).
 * Muhasebe mapper / worker / perf path'e dokunmaz.
 */

import {
  buildCariMatchIndex,
  resolveCariAccountMatch,
  normalizeCariName,
  CARI_MATCH_REASON,
} from "@/src/utils/cariAccountMatcher";
import {
  CARI_NOT_REQUIRED_TYPES,
  CARI_REQUIRED_TYPES,
  PERSONEL_REQUIRED_TYPES,
  isVergiSgkType,
  isVirmanType,
} from "@/src/utils/bankTransactionType";
import {
  classifyMissingHesapCategory,
  MISSING_HESAP_CATEGORY,
  isMissingHesapRow,
} from "@/src/utils/previewExportValidation";
import {
  normalizeBankAnalysisKey,
  normalizeParserText,
  resolveLucaRowBankDirection,
} from "@/src/utils/textNormalize";
import {
  extractIbansFromText,
  createOwnAccountVirmanContext,
  evaluateOwnAccountVirmanTransfer,
  isOwnAccountVirmanTransfer,
  isVirmanCandidateTransfer,
  BANK_INTERNAL_TRANSFER,
  VIRMAN_CANDIDATE_LABEL,
} from "@/src/utils/bankInternalTransfer";

export {
  extractIbansFromText,
  createOwnAccountVirmanContext,
  evaluateOwnAccountVirmanTransfer,
  isOwnAccountVirmanTransfer,
  isVirmanCandidateTransfer,
  BANK_INTERNAL_TRANSFER,
  VIRMAN_CANDIDATE_LABEL,
};

export const FOREIGN_VENDOR_RE =
  /\b(GOOGLE|META|FACEBOOK|MICROSOFT|BOOKING|EXPEDIA|AIRBNB|TRIPADVISOR|ADWORDS)\b/i;

export const CARI_RESOLUTION_FILTERS = {
  ALL: "all",
  INCOMING: "incoming",
  OUTGOING: "outgoing",
  FOREIGN: "foreign",
  RESOLVED: "resolved",
  REMAINING: "remaining",
  VIRMAN_CANDIDATES: "virman_candidates",
};

/** İlk açılışta peşinen aday üretilecek grup sayısı */
export const CARI_RESOLUTION_INITIAL_CANDIDATE_GROUPS = 30;

function compactCode(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
}

function rowAmount(row = {}) {
  return Math.abs(Number(row.borc || 0) || Number(row.alacak || 0) || 0);
}

function rowDescription(row = {}) {
  return String(
    row.detayAciklama || row.fisAciklama || row.aciklama || row.description || ""
  ).trim();
}

function rowDate(row = {}) {
  return String(row.fisTarihi || row.evrakTarihi || row.date || "").trim();
}

export function isForeignVendorDescription(text = "") {
  return FOREIGN_VENDOR_RE.test(normalizeParserText(text));
}

/** Personel / vergi / finans (+ kesin kendi hesap virman) satırlarını cari çözüm grubundan çıkar */
export function isExcludedFromCariResolution(
  row = {},
  context = {},
  { skipOwnVirman = false } = {}
) {
  const type = String(row.transactionType || "");
  if (PERSONEL_REQUIRED_TYPES.has(type)) return true;
  if (isVergiSgkType(type)) return true;
  if (CARI_NOT_REQUIRED_TYPES.has(type) && type !== "BILINMEYEN") return true;
  const cat = classifyMissingHesapCategory(row);
  if (
    cat === MISSING_HESAP_CATEGORY.PERSONEL_BULUNAMADI ||
    cat === MISSING_HESAP_CATEGORY.VERGI_SGK ||
    cat === MISSING_HESAP_CATEGORY.POS_KOMISYON ||
    cat === MISSING_HESAP_CATEGORY.FINAN_ISLEM ||
    cat === MISSING_HESAP_CATEGORY.VIRMAN_HESAP_EKSIK ||
    cat === MISSING_HESAP_CATEGORY.CEK_HESAP_EKSIK ||
    cat === MISSING_HESAP_CATEGORY.KASA_HESAP_EKSIK
  ) {
    return true;
  }
  // Virman adayları normal cari listesinde yok — ayrı kova
  if (
    cat === MISSING_HESAP_CATEGORY.VIRMAN_ADAY ||
    isVirmanCandidateTransfer(row, context)
  ) {
    return true;
  }
  const desc = normalizeParserText(rowDescription(row));
  if (
    /\b(MAAS|MAAŞ|BORDRO|MAAS AVANS|PERSONEL AVANS)\b/i.test(desc) &&
    !/KONAKLAMA|OTÈL|OTEL/i.test(desc)
  ) {
    if (PERSONEL_REQUIRED_TYPES.has(type) || /AVANS ODEME|MAAS/i.test(desc)) {
      return type.includes("MAAS") || type.includes("PERSONEL");
    }
  }
  if (!skipOwnVirman && isOwnAccountVirmanTransfer(row, context)) return true;
  return false;
}

export function isCariMissingRow(
  row = {},
  context = {},
  { skipOwnVirman = false } = {}
) {
  if (!isMissingHesapRow(row)) return false;
  if (isExcludedFromCariResolution(row, context, { skipOwnVirman })) {
    return false;
  }
  if (row.cariRequired === false) return false;
  const type = String(row.transactionType || "");
  if (type && CARI_NOT_REQUIRED_TYPES.has(type)) return false;
  const cat = classifyMissingHesapCategory(row);
  if (cat === MISSING_HESAP_CATEGORY.CARI_BULUNAMADI) return true;
  if (
    cat &&
    cat !== MISSING_HESAP_CATEGORY.CARI_BULUNAMADI &&
    cat !== MISSING_HESAP_CATEGORY.DIGER
  ) {
    return false;
  }
  if (row.cariRequired === true || CARI_REQUIRED_TYPES.has(type)) return true;
  if (!type || type === "BILINMEYEN") {
    const note = String(row.kontrolNotu || row.uyari || "");
    return (
      /cari hesap bulunamadı/i.test(note) || !String(row.hesapKodu || "").trim()
    );
  }
  return false;
}

/**
 * Gelen → 120 önce; giden → 320 sonra 336.
 * Gider (7xx) yabancı satıcıda önerilmez.
 */
export function preferredCariPrefixesForDirection(direction = "") {
  const dir = String(direction || "").toUpperCase();
  if (dir === "GIRIS" || dir === "GELEN" || dir === "ALACAK") {
    return ["120"];
  }
  return ["320", "336"];
}

export function isExpenseAccountCode(code = "") {
  const c = compactCode(code);
  return (
    /^7\d{2}/.test(c) ||
    c.startsWith("760") ||
    c.startsWith("770") ||
    c.startsWith("740")
  );
}

export function accountMatchesPrefixes(code = "", prefixes = []) {
  const c = compactCode(code);
  if (!c || !prefixes?.length) return true;
  return prefixes.some(
    (p) => c === p || c.startsWith(`${p}.`) || c.startsWith(p)
  );
}

/**
 * Yön koruması: 120 giden satıra / 320 gelen satıra otomatik aday olmamalı.
 */
export function isAccountAllowedForDirection(code = "", direction = "") {
  const c = compactCode(code);
  if (!c) return false;
  const dir = String(direction || "").toUpperCase();
  const isIncoming = dir === "GIRIS" || dir === "GELEN" || dir === "ALACAK";
  if (isIncoming) {
    if (c === "320" || c.startsWith("320.")) return false;
    if (c === "336" || c.startsWith("336.")) return false;
  } else {
    if (c === "120" || c.startsWith("120.")) return false;
  }
  return true;
}

/**
 * Hesap planını 1 kez normalize + cari index.
 * 225 grup için aynı index’i yeniden kurmayı engeller.
 */
export function createCariResolutionPlanCache(companyPlans = []) {
  const plans = companyPlans || [];
  const planRows = plans
    .filter((row) => row?.isActive !== false)
    .map((row) => {
      const code = compactCode(
        row.accountCode || row.hesapKodu || row.kod || ""
      );
      const name = String(
        row.accountName || row.hesapAdi || row.name || ""
      ).trim();
      return {
        code,
        name,
        haystack: normalizeParserText(`${code} ${name}`),
      };
    })
    .filter((row) => row.code);

  return {
    companyPlans: plans,
    planRows,
    cariIndex: plans.length ? buildCariMatchIndex(plans) : null,
    indexBuildCount: plans.length ? 1 : 0,
    planNormalizeCount: 1,
  };
}

function resolvePlanCache(companyPlans = [], planCache = null) {
  if (planCache?.planRows && "cariIndex" in planCache) {
    return planCache;
  }
  return createCariResolutionPlanCache(companyPlans);
}

export function searchCariResolutionCandidates(
  companyPlans = [],
  {
    query = "",
    direction = "",
    description = "",
    limit = 5,
    foreignVendor = false,
    searchAll = false,
    planCache = null,
  } = {}
) {
  const prefixes = preferredCariPrefixesForDirection(direction);
  const cache = resolvePlanCache(companyPlans, planCache);
  const plans = cache.companyPlans?.length
    ? cache.companyPlans
    : companyPlans || [];
  const match = resolveCariAccountMatch(plans, {
    description,
    lucaDescription: description,
    cariIndex: cache.cariIndex,
  });

  const ranked = [];
  const seen = new Set();

  const pushCand = (cand) => {
    const code = compactCode(cand.code);
    if (!code || seen.has(code)) return;
    if (foreignVendor && isExpenseAccountCode(code)) return;
    if (!searchAll && !accountMatchesPrefixes(code, prefixes)) return;
    if (!isAccountAllowedForDirection(code, direction)) return;
    seen.add(code);
    ranked.push({
      code,
      name: String(cand.name || cand.matchedName || "").trim(),
      confidence: Number(cand.confidence || 0),
      matchReason: cand.matchReason || CARI_MATCH_REASON.NONE,
      reasonLabel: formatMatchReason(cand.matchReason, cand.confidence),
    });
  };

  if (match?.code) {
    pushCand({
      code: match.code,
      name: match.matchedName,
      confidence: match.confidence,
      matchReason: match.matchReason,
    });
  }
  for (const s of match?.suggestions || []) {
    pushCand(s);
  }

  const q = normalizeParserText(query || "");
  const qCode = compactCode(query);
  const pool = searchAll
    ? cache.planRows
    : cache.planRows.filter((row) => accountMatchesPrefixes(row.code, prefixes));

  for (const row of pool) {
    if (q) {
      if (!row.haystack.includes(q) && !row.code.includes(qCode)) {
        continue;
      }
    }
    pushCand({
      code: row.code,
      name: row.name,
      confidence: q ? 40 : 20,
      matchReason: "plan_search",
    });
    if (ranked.length >= Math.max(limit, 40)) break;
  }

  return {
    extractedParty: match?.extractedParty || "",
    hasVergiNo: Boolean(match?.hasVergiNo),
    hasIban: Boolean(match?.hasIban),
    candidates: ranked.slice(0, limit),
    allCandidates: ranked,
    foreignVendor,
    preferredPrefixes: prefixes,
    vendorMessage: foreignVendor
      ? ranked.some((c) => accountMatchesPrefixes(c.code, ["320"]))
        ? ""
        : "Satıcı cari hesabı bulunamadı"
      : "",
    _stats: {
      indexBuilds: cache.indexBuildCount || 0,
      planNormalizes: cache.planNormalizeCount || 0,
    },
  };
}

function formatMatchReason(reason, confidence) {
  const r = String(reason || "");
  if (r.includes("IBAN") || r === CARI_MATCH_REASON.IBAN) return "IBAN eşleşmesi";
  if (r.includes("vergi") || r === CARI_MATCH_REASON.VERGI_NO)
    return "VKN/TCKN eşleşmesi";
  if (r.includes("unvan") || r === CARI_MATCH_REASON.UNVAN)
    return "Unvan eşleşmesi";
  if (r.includes("alias") || r === CARI_MATCH_REASON.ALIAS)
    return "Alias eşleşmesi";
  if (r.includes("token") || r.includes("fuzzy")) {
    return `Benzer unvan (~${confidence}%) — onay gerekli`;
  }
  if (r === "plan_search") return "Hesap planı araması";
  if (r.includes("hafiza") || r.includes("memory") || r.includes("FIRMA")) {
    return "Firma hafızası";
  }
  return r || "Aday";
}

function emptyCandidateFields(foreignVendor, direction) {
  return {
    vendorMessage: foreignVendor ? "Satıcı cari hesabı bulunamadı" : "",
    preferredPrefixes: preferredCariPrefixesForDirection(direction),
    candidates: [],
    suggestedAccount: "",
    suggestedName: "",
    confidence: 0,
    confidenceLabel: "Aday yükleniyor…",
    matchReason: "",
    candidatesReady: false,
  };
}

function applySearchToGroupBase(base, search) {
  const top = search.candidates[0] || null;
  const confidence = Number(top?.confidence || 0);
  const confidenceLabel =
    confidence >= 80
      ? "Yüksek (onay gerekli)"
      : confidence >= 50
        ? "Orta"
        : confidence > 0
          ? "Düşük"
          : "Aday yok";
  const party =
    search.extractedParty ||
    base.partyName ||
    normalizeCariName(base.samples?.[0] || "").slice(0, 80) ||
    "Karşı taraf";

  return {
    ...base,
    partyName: party,
    vendorMessage: search.vendorMessage,
    preferredPrefixes: search.preferredPrefixes,
    candidates: search.candidates,
    suggestedAccount: top?.code || "",
    suggestedName: top?.name || "",
    confidence,
    confidenceLabel,
    matchReason: top?.matchReason || "",
    candidatesReady: true,
  };
}

/**
 * Tek grup için aday üret (kart görünür / arama / lazy hydrate).
 * Aynı planCache paylaşılmalı.
 */
export function hydrateCariResolutionGroupCandidates(
  group,
  companyPlans = [],
  { planCache = null, limit = 5 } = {}
) {
  if (!group) return group;
  const sample = group.samples?.[0] || "";
  const search = searchCariResolutionCandidates(companyPlans, {
    direction: group.direction,
    description: sample,
    limit,
    foreignVendor: group.foreignVendor,
    searchAll: false,
    planCache,
  });
  return applySearchToGroupBase(group, search);
}

/**
 * Cari eksik Luca satırlarını (gelen/giden ayrı) analysisKey ile gruplar.
 *
 * @param {object} options
 * @param {number|false|'all'} options.initialCandidateGroups
 *   İlk N grubun adaylarını peşinen üret. false → hiç; 'all' → hepsi.
 * @param {boolean} options.collectStats ölçüm için sayaç
 */
export function buildCariResolutionGroups(rows = [], context = {}, options = {}) {
  const {
    initialCandidateGroups = CARI_RESOLUTION_INITIAL_CANDIDATE_GROUPS,
    collectStats = false,
  } = options;

  const ownAccountContext =
    context.ownAccountContext ||
    createOwnAccountVirmanContext(
      context.selectedCompany,
      context.selectedBank
    );
  const fullContext = { ...context, ownAccountContext };

  const groupStart = collectStats ? performance.now() : 0;

  // Virman adayları (kesin 102↔102 olmayan soft sinyaller)
  const virmanCandidates = [];
  for (const row of rows || []) {
    if (!isMissingHesapRow(row)) continue;
    if (isOwnAccountVirmanTransfer(row, fullContext)) continue;
    if (!isVirmanCandidateTransfer(row, fullContext)) continue;
    const verdict = evaluateOwnAccountVirmanTransfer(row, fullContext);
    virmanCandidates.push({
      rowId: row.id,
      analysisKey: row.analysisKey || "",
      reasons: verdict.reasons || [],
      suggested102: verdict.suggested102 || "",
      label: VIRMAN_CANDIDATE_LABEL,
      description: rowDescription(row).slice(0, 160),
      direction: resolveLucaRowBankDirection(row, fullContext) || "",
      amount: rowAmount(row),
    });
  }

  // Kesin virman (complete) — cari listesinde yok
  const divertedVirman = [];
  for (const row of rows || []) {
    if (!isCariMissingRow(row, fullContext, { skipOwnVirman: true })) continue;
    if (!isOwnAccountVirmanTransfer(row, fullContext)) continue;
    divertedVirman.push({
      rowId: row.id,
      analysisKey: row.analysisKey || "",
      reasons: ["definite_102_pair"],
      suggested102: "",
      label: "Firma kendi hesabı / virman",
    });
  }

  const unresolved = (rows || []).filter((row) =>
    isCariMissingRow(row, fullContext)
  );
  const groups = new Map();

  for (const row of unresolved) {
    const desc = rowDescription(row);
    const direction = resolveLucaRowBankDirection(row, fullContext) || "";
    const key =
      row.analysisKey ||
      normalizeBankAnalysisKey(desc, direction) ||
      `unknown|${direction || "NA"}`;
    if (!groups.has(key)) {
      groups.set(key, {
        analysisKey: key,
        direction,
        rows: [],
        samples: [],
        dates: [],
      });
    }
    const g = groups.get(key);
    // Güvenlik: gelen/giden karışmasın
    if (g.direction && direction && g.direction !== direction) {
      const splitKey = `${key}__${direction}`;
      if (!groups.has(splitKey)) {
        groups.set(splitKey, {
          analysisKey: splitKey,
          direction,
          rows: [],
          samples: [],
          dates: [],
        });
      }
      const sg = groups.get(splitKey);
      sg.rows.push(row);
      if (sg.samples.length < 3) sg.samples.push(desc.slice(0, 160));
      const d = rowDate(row);
      if (d) sg.dates.push(d);
      continue;
    }
    if (!g.direction && direction) g.direction = direction;
    g.rows.push(row);
    if (g.samples.length < 3) g.samples.push(desc.slice(0, 160));
    const d = rowDate(row);
    if (d) g.dates.push(d);
  }

  const groupingMs = collectStats ? performance.now() - groupStart : 0;

  const companyPlans = context.companyPlans || [];
  const planCache =
    context.planCache || createCariResolutionPlanCache(companyPlans);

  const hydrateCount =
    initialCandidateGroups === "all" || initialCandidateGroups === true
      ? Number.POSITIVE_INFINITY
      : initialCandidateGroups === false || initialCandidateGroups === 0
        ? 0
        : Math.max(0, Number(initialCandidateGroups) || 0);

  let candidateMs = 0;
  let candidateHydrations = 0;
  let planScansDuringCandidates = 0;

  const ranked = [...groups.values()]
    .map((g) => {
      const sample = g.samples[0] || rowDescription(g.rows[0]) || "";
      const foreignVendor = isForeignVendorDescription(sample);
      const totalAmount = g.rows.reduce((sum, r) => sum + rowAmount(r), 0);
      const sortedDates = [...g.dates].filter(Boolean).sort();
      const partyFallback =
        normalizeCariName(sample).slice(0, 80) || "Karşı taraf";

      return {
        id: g.analysisKey,
        analysisKey: g.analysisKey,
        partyName: partyFallback,
        direction: g.direction || "",
        directionLabel:
          g.direction === "GIRIS" || g.direction === "GELEN"
            ? "Gelen"
            : g.direction === "CIKIS" || g.direction === "GIDEN"
              ? "Giden"
              : "—",
        count: g.rows.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        samples: g.samples,
        dateFrom: sortedDates[0] || "",
        dateTo: sortedDates[sortedDates.length - 1] || "",
        rowIds: g.rows.map((r) => r.id).filter(Boolean),
        seedRow: g.rows[0],
        foreignVendor,
        status: "remaining",
        ...emptyCandidateFields(foreignVendor, g.direction),
      };
    })
    .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount)
    .map((base, index) => {
      if (index >= hydrateCount) return base;
      const t0 = collectStats ? performance.now() : 0;
      const enriched = hydrateCariResolutionGroupCandidates(base, companyPlans, {
        planCache,
        limit: 5,
      });
      if (collectStats) {
        candidateMs += performance.now() - t0;
        candidateHydrations += 1;
        // Her hydrate: match + (en fazla) bir plan pool taraması; index yeniden kurulmaz
        planScansDuringCandidates += 1;
      }
      return enriched;
    });

  const divertedGroupKeys = new Set(
    divertedVirman.map((d) => d.analysisKey).filter(Boolean)
  );
  const candidateGroupKeys = new Set(
    virmanCandidates.map((d) => d.analysisKey).filter(Boolean)
  );

  // Virman adayı grupları — 120/320 aday yok; banka hesabı tanımlama mesajı
  const candidateGroupMap = new Map();
  for (const item of virmanCandidates) {
    const key = item.analysisKey || `virman-aday|${item.rowId}`;
    if (!candidateGroupMap.has(key)) {
      candidateGroupMap.set(key, {
        analysisKey: key,
        direction: item.direction || "",
        rows: [],
        samples: [],
        totalAmount: 0,
      });
    }
    const g = candidateGroupMap.get(key);
    g.rows.push(item);
    if (g.samples.length < 3 && item.description) {
      g.samples.push(item.description);
    }
    g.totalAmount += Number(item.amount) || 0;
  }
  const virmanCandidateGroups = [...candidateGroupMap.values()]
    .map((g) => ({
      id: `virman-aday:${g.analysisKey}`,
      analysisKey: g.analysisKey,
      partyName:
        normalizeCariName(g.samples[0] || "").slice(0, 80) || "Virman adayı",
      direction: g.direction || "",
      directionLabel:
        g.direction === "GIRIS" || g.direction === "GELEN"
          ? "Gelen"
          : g.direction === "CIKIS" || g.direction === "GIDEN"
            ? "Giden"
            : "—",
      count: g.rows.length,
      totalAmount: Math.round(g.totalAmount * 100) / 100,
      samples: g.samples,
      dateFrom: "",
      dateTo: "",
      rowIds: g.rows.map((r) => r.rowId).filter(Boolean),
      foreignVendor: false,
      status: "remaining",
      virmanCandidate: true,
      vendorMessage: VIRMAN_CANDIDATE_LABEL,
      preferredPrefixes: ["102"],
      candidates: [],
      suggestedAccount: "",
      suggestedName: "",
      confidence: 0,
      confidenceLabel: "Banka hesabı tanımla",
      matchReason: "",
      candidatesReady: true,
    }))
    .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);

  const result = {
    totalMissing: (rows || []).filter(isMissingHesapRow).length,
    cariMissingCount: unresolved.length,
    groupCount: ranked.length,
    groups: ranked,
    planCache,
    virmanDivertedCount: divertedVirman.length,
    virmanDivertedGroupCount: divertedGroupKeys.size,
    virmanDivertedWith102Count: divertedVirman.filter((d) =>
      String(d.suggested102 || "").startsWith("102")
    ).length,
    virmanDivertedRows: divertedVirman,
    virmanCandidateCount: virmanCandidates.length,
    virmanCandidateGroupCount: virmanCandidateGroups.length,
    virmanCandidateRows: virmanCandidates,
    virmanCandidateGroups,
    virmanCandidateLabel: VIRMAN_CANDIDATE_LABEL,
  };

  if (collectStats) {
    result.stats = {
      groupingMs: Math.round(groupingMs * 100) / 100,
      candidateMs: Math.round(candidateMs * 100) / 100,
      totalMs: Math.round((groupingMs + candidateMs) * 100) / 100,
      groupCount: ranked.length,
      candidateHydrations,
      indexBuilds: planCache.indexBuildCount || 0,
      planNormalizeCount: planCache.planNormalizeCount || 0,
      planScansDuringCandidates,
      /**
       * Eski davranış: her grup için index yeniden → groupCount index build.
       * Yeni: 1 index + sadece hydrate edilen grup kadar aday araması.
       */
      legacyWouldHaveRebuiltIndex: ranked.length,
    };
  }

  return result;
}

export function filterCariResolutionGroups(
  groups = [],
  { filter = CARI_RESOLUTION_FILTERS.ALL, query = "", resolvedIds = null } = {}
) {
  const resolved =
    resolvedIds instanceof Set ? resolvedIds : new Set(resolvedIds || []);
  const q = normalizeParserText(query || "");

  return (groups || []).filter((g) => {
    const isResolved = resolved.has(g.id) || g.status === "resolved";
    if (filter === CARI_RESOLUTION_FILTERS.RESOLVED && !isResolved) return false;
    if (filter === CARI_RESOLUTION_FILTERS.REMAINING && isResolved) return false;
    if (filter === CARI_RESOLUTION_FILTERS.FOREIGN && !g.foreignVendor)
      return false;
    if (filter === CARI_RESOLUTION_FILTERS.INCOMING) {
      if (!(g.direction === "GIRIS" || g.direction === "GELEN")) return false;
    }
    if (filter === CARI_RESOLUTION_FILTERS.OUTGOING) {
      if (!(g.direction === "CIKIS" || g.direction === "GIDEN")) return false;
    }
    if (!q) return true;
    const hay = normalizeParserText(
      `${g.partyName} ${g.samples.join(" ")} ${g.suggestedAccount} ${g.totalAmount}`
    );
    return hay.includes(q);
  });
}

/**
 * UI’ı bir frame/tick bloke etmeden ağır işi ertele.
 * Çift rAF: modal shell paint sonrası hesaplama.
 */
export function scheduleAfterPaint(fn) {
  if (typeof fn !== "function") return () => {};
  let cancelled = false;
  const run = () => {
    if (!cancelled) fn();
  };

  const timers = [];
  const clearAll = () => {
    cancelled = true;
    for (const t of timers) {
      if (t.type === "raf" && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(t.id);
      } else if (t.type === "timeout") {
        clearTimeout(t.id);
      }
    }
  };

  if (typeof requestAnimationFrame === "function") {
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        const t = setTimeout(run, 0);
        timers.push({ type: "timeout", id: t });
      });
      timers.push({ type: "raf", id: raf2 });
    });
    timers.push({ type: "raf", id: raf1 });
    return clearAll;
  }

  const t = setTimeout(run, 0);
  timers.push({ type: "timeout", id: t });
  return clearAll;
}

/**
 * İlk tıklama: modal shell hemen, gruplar async.
 * Çift tıklama / zaten açık → ignore.
 */
export function shouldIgnoreCariResolutionOpen({
  isOpen = false,
  isLoading = false,
} = {}) {
  return Boolean(isOpen || isLoading);
}

/**
 * Kapatma sonrası async sonuç state’e yazılmamalı.
 */
export function shouldApplyCariResolutionAsyncResult({
  generation,
  activeGeneration,
  isOpen,
} = {}) {
  if (!isOpen) return false;
  if (generation == null || activeGeneration == null) return Boolean(isOpen);
  return generation === activeGeneration;
}

/** Modal desktop width class helper (test edilebilir sabit) */
export const CARI_RESOLUTION_MODAL_MAX_WIDTH_PX = 1500;
export const CARI_RESOLUTION_MODAL_WIDTH_CSS =
  "w-[min(96vw,1500px)] max-w-[1500px] h-[min(92vh,920px)] max-h-[92vh]";
