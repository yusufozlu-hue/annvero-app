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

export const FOREIGN_VENDOR_RE =
  /\b(GOOGLE|META|FACEBOOK|MICROSOFT|BOOKING|EXPEDIA|AIRBNB|TRIPADVISOR|ADWORDS)\b/i;

export const CARI_RESOLUTION_FILTERS = {
  ALL: "all",
  INCOMING: "incoming",
  OUTGOING: "outgoing",
  FOREIGN: "foreign",
  RESOLVED: "resolved",
  REMAINING: "remaining",
};

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

/** Personel / vergi satırlarını cari çözüm grubundan çıkar */
export function isExcludedFromCariResolution(row = {}) {
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
    cat === MISSING_HESAP_CATEGORY.CEK_HESAP_EKSIK ||
    cat === MISSING_HESAP_CATEGORY.KASA_HESAP_EKSIK
  ) {
    return true;
  }
  const desc = normalizeParserText(rowDescription(row));
  if (/\b(MAAS|MAAŞ|BORDRO|MAAS AVANS|PERSONEL AVANS)\b/i.test(desc) && !/KONAKLAMA|OTÈL|OTEL/i.test(desc)) {
    if (PERSONEL_REQUIRED_TYPES.has(type) || /AVANS ODEME|MAAS/i.test(desc)) {
      return type.includes("MAAS") || type.includes("PERSONEL");
    }
  }
  return false;
}

export function isCariMissingRow(row = {}) {
  if (!isMissingHesapRow(row)) return false;
  if (isExcludedFromCariResolution(row)) return false;
  if (row.cariRequired === false) return false;
  const type = String(row.transactionType || "");
  if (type && CARI_NOT_REQUIRED_TYPES.has(type)) return false;
  const cat = classifyMissingHesapCategory(row);
  if (cat === MISSING_HESAP_CATEGORY.CARI_BULUNAMADI) return true;
  if (cat && cat !== MISSING_HESAP_CATEGORY.CARI_BULUNAMADI && cat !== MISSING_HESAP_CATEGORY.DIGER) {
    return false;
  }
  if (row.cariRequired === true || CARI_REQUIRED_TYPES.has(type)) return true;
  if (!type || type === "BILINMEYEN") {
    const note = String(row.kontrolNotu || row.uyari || "");
    return /cari hesap bulunamadı/i.test(note) || !String(row.hesapKodu || "").trim();
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
  return /^7\d{2}/.test(c) || c.startsWith("760") || c.startsWith("770") || c.startsWith("740");
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

export function searchCariResolutionCandidates(
  companyPlans = [],
  {
    query = "",
    direction = "",
    description = "",
    limit = 5,
    foreignVendor = false,
    searchAll = false,
  } = {}
) {
  const prefixes = preferredCariPrefixesForDirection(direction);
  const cariIndex = companyPlans.length ? buildCariMatchIndex(companyPlans) : null;
  const match = resolveCariAccountMatch(companyPlans, {
    description,
    lucaDescription: description,
    cariIndex,
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
  const planRows = (companyPlans || [])
    .filter((row) => row?.isActive !== false)
    .map((row) => ({
      code: compactCode(row.accountCode || row.hesapKodu || row.kod || ""),
      name: String(row.accountName || row.hesapAdi || row.name || "").trim(),
    }))
    .filter((row) => row.code);

  const pool = searchAll
    ? planRows
    : planRows.filter((row) => accountMatchesPrefixes(row.code, prefixes));

  for (const row of pool) {
    if (q) {
      const hay = normalizeParserText(`${row.code} ${row.name}`);
      if (!hay.includes(q) && !compactCode(row.code).includes(compactCode(query))) {
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
  };
}

function formatMatchReason(reason, confidence) {
  const r = String(reason || "");
  if (r.includes("IBAN") || r === CARI_MATCH_REASON.IBAN) return "IBAN eşleşmesi";
  if (r.includes("vergi") || r === CARI_MATCH_REASON.VERGI_NO) return "VKN/TCKN eşleşmesi";
  if (r.includes("unvan") || r === CARI_MATCH_REASON.UNVAN) return "Unvan eşleşmesi";
  if (r.includes("alias") || r === CARI_MATCH_REASON.ALIAS) return "Alias eşleşmesi";
  if (r.includes("token") || r.includes("fuzzy")) {
    return `Benzer unvan (~${confidence}%) — onay gerekli`;
  }
  if (r === "plan_search") return "Hesap planı araması";
  if (r.includes("hafiza") || r.includes("memory") || r.includes("FIRMA")) {
    return "Firma hafızası";
  }
  return r || "Aday";
}

/**
 * Cari eksik Luca satırlarını (gelen/giden ayrı) analysisKey ile gruplar.
 */
export function buildCariResolutionGroups(rows = [], context = {}) {
  const unresolved = (rows || []).filter(isCariMissingRow);
  const groups = new Map();

  for (const row of unresolved) {
    const desc = rowDescription(row);
    const direction = resolveLucaRowBankDirection(row, context) || "";
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

  const companyPlans = context.companyPlans || [];
  const ranked = [...groups.values()]
    .map((g) => {
      const sample = g.samples[0] || rowDescription(g.rows[0]) || "";
      const foreignVendor = isForeignVendorDescription(sample);
      const search = searchCariResolutionCandidates(companyPlans, {
        direction: g.direction,
        description: sample,
        limit: 5,
        foreignVendor,
        searchAll: false,
      });
      const party =
        search.extractedParty ||
        normalizeCariName(sample).slice(0, 80) ||
        "Karşı taraf";
      const totalAmount = g.rows.reduce((sum, r) => sum + rowAmount(r), 0);
      const sortedDates = [...g.dates].filter(Boolean).sort();
      const top = search.candidates[0] || null;
      // Otomatik uygulama yok — fuzzy yüksek olsa bile yalnızca öneri
      const confidence = Number(top?.confidence || 0);
      const confidenceLabel =
        confidence >= 80
          ? "Yüksek (onay gerekli)"
          : confidence >= 50
            ? "Orta"
            : confidence > 0
              ? "Düşük"
              : "Aday yok";

      return {
        id: g.analysisKey,
        analysisKey: g.analysisKey,
        partyName: party,
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
        vendorMessage: search.vendorMessage,
        preferredPrefixes: search.preferredPrefixes,
        candidates: search.candidates,
        suggestedAccount: top?.code || "",
        suggestedName: top?.name || "",
        confidence,
        confidenceLabel,
        matchReason: top?.matchReason || "",
        status: "remaining",
      };
    })
    .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);

  return {
    totalMissing: (rows || []).filter(isMissingHesapRow).length,
    cariMissingCount: unresolved.length,
    groupCount: ranked.length,
    groups: ranked,
  };
}

export function filterCariResolutionGroups(
  groups = [],
  { filter = CARI_RESOLUTION_FILTERS.ALL, query = "", resolvedIds = null } = {}
) {
  const resolved = resolvedIds instanceof Set ? resolvedIds : new Set(resolvedIds || []);
  const q = normalizeParserText(query || "");

  return (groups || []).filter((g) => {
    const isResolved = resolved.has(g.id) || g.status === "resolved";
    if (filter === CARI_RESOLUTION_FILTERS.RESOLVED && !isResolved) return false;
    if (filter === CARI_RESOLUTION_FILTERS.REMAINING && isResolved) return false;
    if (filter === CARI_RESOLUTION_FILTERS.FOREIGN && !g.foreignVendor) return false;
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
 * Önce modal mount + paint, sonra hesaplama.
 */
export function scheduleAfterPaint(fn) {
  if (typeof fn !== "function") return () => {};
  let cancelled = false;
  const run = () => {
    if (!cancelled) fn();
  };
  if (typeof requestAnimationFrame === "function") {
    const rafId = requestAnimationFrame(() => {
      setTimeout(run, 0);
    });
    return () => {
      cancelled = true;
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
    };
  }
  const t = setTimeout(run, 0);
  return () => {
    cancelled = true;
    clearTimeout(t);
  };
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
