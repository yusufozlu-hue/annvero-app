/**
 * Cari eksik satır gruplama + yönlü aday arama (Çözüm Merkezi V1).
 * Muhasebe mapper / worker / perf path'e dokunmaz.
 */

import {
  buildCariMatchIndex,
  resolveCariAccountMatch,
  normalizeCariName,
  normalizeCariNameCore,
  CARI_MATCH_REASON,
} from "@/src/utils/cariAccountMatcher";
import {
  buildOwnCompanyIdentity,
  extractCounterpartyParty,
  isOwnCompanyPartyName,
  isOwnOnlyOrMissingCounterparty,
  isSelectableCariLeafAccount,
  sortCariDisplayDates,
  buildCariParentCodeSet,
} from "@/src/utils/cariCounterpartyExtract";
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
import {
  extractIbansFromText,
  createOwnAccountVirmanContext,
  evaluateOwnAccountVirmanTransfer,
  isOwnAccountVirmanTransfer,
  isVirmanCandidateTransfer,
  classifyVirmanForCariCenter,
  BANK_INTERNAL_TRANSFER,
  VIRMAN_CANDIDATE_LABEL,
} from "@/src/utils/bankInternalTransfer";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  resolveCreditCardPayment,
  extractCardLast4FromText,
  isCreditCardPaymentDescription,
  isCreditCardAccountCode,
  CREDIT_CARD_MISSING_LABEL,
  buildCreditCardGroupKey,
  creditCardStatementPeriodKey,
  findCreditCardAccountsByPlanName,
} from "@/src/utils/creditCardAccountResolver";
import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType";
import { buildTaxObligationResolutionGroups } from "@/src/utils/taxObligation/resolutionGroups";
import { classifyObligationPayment } from "@/src/utils/taxObligation/classify";

export {
  extractIbansFromText,
  createOwnAccountVirmanContext,
  evaluateOwnAccountVirmanTransfer,
  isOwnAccountVirmanTransfer,
  isVirmanCandidateTransfer,
  classifyVirmanForCariCenter,
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
  CREDIT_CARDS: "credit_cards",
  TAX_OBLIGATIONS: "tax_obligations",
};

/** İlk açılışta peşinen aday üretilecek grup sayısı */
export const CARI_RESOLUTION_INITIAL_CANDIDATE_GROUPS = 30;

/** Karşı taraf çıkarılamayan / yalnız kendi firma unvanı */
export const PARTY_UNRESOLVED_LABEL = "Karşı taraf tespit edilemedi";

const STRONG_CARI_AUTO_REASONS = new Set([
  CARI_MATCH_REASON.UNVAN,
  CARI_MATCH_REASON.ALIAS,
  CARI_MATCH_REASON.IBAN,
  CARI_MATCH_REASON.VERGI_NO,
  CARI_MATCH_REASON.FIRMA_HAFIZA,
  CARI_MATCH_REASON.ANALYSIS_KEY,
  CARI_MATCH_REASON.LEARNED_DESCRIPTION,
  CARI_MATCH_REASON.IBAN_HISTORY,
]);

function isStrongCariAutoReason(reason = "") {
  const r = String(reason || "");
  if (STRONG_CARI_AUTO_REASONS.has(r)) return true;
  if (r.includes("unvan") || r.includes("alias") || r.includes("IBAN")) return true;
  if (r.includes("vergi") || r.includes("hafiza") || r.includes("memory")) return true;
  if (r.includes("analysisKey") || r.includes("öğrenilmiş")) return true;
  return false;
}

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

function digitsOnlyLoose(value = "") {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Aktif firmanın kendi cari kartı (120/320) — aday listesine hiç girmez.
 * Yalnız güçlü kimlik: VKN/vergi, exact unvan core, isOwnCompany.
 * Benzer isimli üçüncü taraf (ekstra ayırt edici token) dışlanmaz.
 */
export function isActiveCompanyOwnCariAccount(candidate = {}, selectedCompany = null) {
  if (!selectedCompany || !candidate) return false;
  if (candidate.isOwnCompany === true) return true;

  const companyId = String(selectedCompany.id || selectedCompany.companyId || "");
  const candCompanyId = String(
    candidate.companyId || candidate.firmaId || candidate.ownerCompanyId || ""
  );
  if (companyId && candCompanyId && companyId === candCompanyId) return true;

  const companyTax = digitsOnlyLoose(
    selectedCompany.taxNumber ||
      selectedCompany.vkn ||
      selectedCompany.vergiNo ||
      selectedCompany.vergiNumarasi ||
      ""
  );
  const candTax = digitsOnlyLoose(
    candidate.taxNumber || candidate.vkn || candidate.vergiNo || ""
  );
  if (companyTax.length >= 10 && candTax === companyTax) return true;

  const companyCore = normalizeCariNameCore(
    getCompanyDisplayName(selectedCompany)
  );
  if (!companyCore || companyCore.length < 8) return false;

  const rawName = String(
    candidate.name ||
      candidate.matchedName ||
      candidate.accountName ||
      candidate.hesapAdi ||
      ""
  ).trim();
  if (!rawName) return false;
  const nameCore = normalizeCariNameCore(rawName);
  const stripped = nameCore
    .replace(/^(DE|ALICI|SATICI|MUSTERI|CARI)\s+/i, "")
    .trim();

  if (nameCore === companyCore || stripped === companyCore) return true;

  const companyTokens = companyCore.split(/\s+/).filter((t) => t.length >= 3);
  if (companyTokens.length < 2) return false;
  if (!companyTokens.every((t) => stripped.includes(t) || nameCore.includes(t))) {
    return false;
  }
  // Şirket tokenlarının tamamı var; ekstra ayırt edici token var mı?
  const ALLOWED_EXTRA = new Set([
    "DE",
    "AS",
    "A",
    "S",
    "TICARET",
    "LIMITED",
    "LTD",
    "SIRKETI",
    "ANONIM",
  ]);
  const extra = stripped
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !companyTokens.includes(t));
  return extra.every((t) => ALLOWED_EXTRA.has(t));
}

/** Eksik vergi/SGK (360/361) satırı — cari listesine girmez; Vergi/SGK sekmesi */
export function isTaxObligationMissingRow(row = {}, context = {}) {
  if (isCreditCardMissingRow(row, context)) return false;
  const type = String(row.transactionType || "");
  if (isVergiSgkType(type)) return true;
  const cat = classifyMissingHesapCategory(row);
  if (cat === MISSING_HESAP_CATEGORY.VERGI_SGK) return true;
  const classified = classifyObligationPayment(
    rowDescription(row)
  );
  return Boolean(classified.isObligationPayment);
}

/** Personel / vergi / finans (+ kesin/aday virman) satırlarını cari çözüm grubundan çıkar */
export function isExcludedFromCariResolution(
  row = {},
  context = {},
  { skipOwnVirman = false, skipVirmanCandidate = false } = {}
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
    cat === MISSING_HESAP_CATEGORY.KREDI_KARTI ||
    cat === MISSING_HESAP_CATEGORY.FINAN_ISLEM ||
    cat === MISSING_HESAP_CATEGORY.VIRMAN_HESAP_EKSIK ||
    cat === MISSING_HESAP_CATEGORY.CEK_HESAP_EKSIK ||
    cat === MISSING_HESAP_CATEGORY.KASA_HESAP_EKSIK
  ) {
    return true;
  }
  if (cat === MISSING_HESAP_CATEGORY.VIRMAN_ADAY) return true;

  const virmanBucket = classifyVirmanForCariCenter(row, context).bucket;
  if (!skipOwnVirman && virmanBucket === "definite") return true;
  if (!skipVirmanCandidate && virmanBucket === "candidate") return true;

  const desc = normalizeParserText(rowDescription(row));
  if (
    /\b(MAAS|MAAŞ|BORDRO|MAAS AVANS|PERSONEL AVANS)\b/i.test(desc) &&
    !/KONAKLAMA|OTÈL|OTEL/i.test(desc)
  ) {
    if (PERSONEL_REQUIRED_TYPES.has(type) || /AVANS ODEME|MAAS/i.test(desc)) {
      return type.includes("MAAS") || type.includes("PERSONEL");
    }
  }
  return false;
}

/** Eksik kredi kartı (309/409) satırı — cari/virman listelerine girmez */
export function isCreditCardMissingRow(row = {}, context = {}) {
  if (!isMissingHesapRow(row)) return false;
  if (isOwnAccountVirmanTransfer(row, context)) return false;
  const type = String(row.transactionType || "");
  const cat = classifyMissingHesapCategory(row);
  if (cat === MISSING_HESAP_CATEGORY.KREDI_KARTI) return true;
  if (type === BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI) return true;
  if (row.classification === "CREDIT_CARD_PAYMENT") return true;
  if (isCreditCardPaymentDescription(rowDescription(row))) return true;
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

/** Kredi kartı çözüm adayları — yalnız 309/409; ad + dönem sinyali */
export function searchCreditCardResolutionCandidates(
  companyPlans = [],
  {
    query = "",
    lastFourDigits = "",
    periodMonth = null,
    periodYear = null,
    bankName = "",
    cardName = "",
    limit = 8,
  } = {}
) {
  const q = normalizeParserText(query || "");
  const last4 = String(lastFourDigits || "").trim();
  if (last4 || periodMonth || bankName || cardName) {
    const found = findCreditCardAccountsByPlanName({
      companyPlans,
      lastFourDigits: last4,
      periodMonth,
      periodYear,
      bankName,
      cardName,
    });
    let list = found.candidates || [];
    if (q) {
      list = list.filter(
        (c) =>
          normalizeParserText(`${c.code} ${c.name}`).includes(q) ||
          compactCode(c.code).includes(compactCode(q))
      );
    }
    if (list.length) {
      return list.slice(0, Math.max(1, Number(limit) || 8)).map((c) => ({
        code: c.code,
        name: c.name,
        confidence: c.score || c.confidence || 0,
        matchReason: c.reasonLabel || "plan_name",
        reasonLabel: c.reasonLabel || `309/409 · ${c.code}`,
      }));
    }
  }

  const ranked = [];
  const seen = new Set();

  for (const row of companyPlans || []) {
    if (row?.isActive === false) continue;
    const code = compactCode(row.accountCode || row.hesapKodu || row.kod || "");
    if (!isCreditCardAccountCode(code)) continue;
    const name = String(
      row.accountName || row.hesapAdi || row.name || ""
    ).trim();
    const hay = normalizeParserText(`${code} ${name}`);
    if (q && !hay.includes(q) && !code.includes(compactCode(q))) continue;
    let score = 10;
    if (last4 && (name.includes(last4) || code.includes(last4) || hay.includes(last4))) {
      score += 40;
    }
    if (seen.has(code)) continue;
    seen.add(code);
    ranked.push({
      code,
      name,
      confidence: score,
      matchReason: last4 && score >= 40 ? "last4_plan" : "plan_309_409",
      reasonLabel:
        score >= 40 ? `Son 4 hane · ${code}` : `309/409 plan · ${code}`,
    });
  }

  ranked.sort((a, b) => b.confidence - a.confidence || a.code.localeCompare(b.code));
  return ranked.slice(0, Math.max(1, Number(limit) || 8));
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
    selectedCompany = null,
    filterStats = null,
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
    direction,
    ownIdentity: buildOwnCompanyIdentity(selectedCompany),
  });

  const ranked = [];
  const seen = new Set();
  let ownCompanyFiltered = 0;
  const parentCodes =
    cache.cariIndex?.parentCodes ||
    buildCariParentCodeSet((cache.planRows || []).map((r) => r.code));

  const pushCand = (cand) => {
    const code = compactCode(cand.code);
    if (!code || seen.has(code)) return;
    if (!isSelectableCariLeafAccount(code, parentCodes)) return;
    if (foreignVendor && isExpenseAccountCode(code)) return;
    if (!searchAll && !accountMatchesPrefixes(code, prefixes)) return;
    if (!isAccountAllowedForDirection(code, direction)) return;
    if (
      isActiveCompanyOwnCariAccount(
        {
          code,
          name: cand.name || cand.matchedName,
          taxNumber: cand.taxNumber,
          vkn: cand.vkn,
          companyId: cand.companyId,
          isOwnCompany: cand.isOwnCompany,
        },
        selectedCompany
      )
    ) {
      ownCompanyFiltered += 1;
      return;
    }
    seen.add(code);
    ranked.push({
      code,
      name: String(cand.name || cand.matchedName || "").trim(),
      confidence: Number(cand.confidence || 0),
      matchReason: cand.matchReason || CARI_MATCH_REASON.NONE,
      reasonLabel: formatMatchReason(cand.matchReason, cand.confidence),
      isLeaf: true,
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

  // Boş sorguda plan_search doldurma: güçlü tekil unvan/IBAN adayını bozmasın.
  // Kullanıcı yazınca veya hiç güçlü aday yoksa plan taraması yapılır.
  const shouldPadPlanSearch = Boolean(q) || ranked.length === 0;

  if (shouldPadPlanSearch) {
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
  }

  if (filterStats && typeof filterStats === "object") {
    filterStats.ownCompanyFiltered =
      (filterStats.ownCompanyFiltered || 0) + ownCompanyFiltered;
  }

  return {
    extractedParty: match?.extractedParty || "",
    hasVergiNo: Boolean(match?.hasVergiNo),
    hasIban: Boolean(match?.hasIban),
    duplicateAccounts: Boolean(match?.duplicateAccounts),
    candidates: ranked.slice(0, limit),
    allCandidates: ranked,
    foreignVendor,
    preferredPrefixes: prefixes,
    ownCompanyFiltered,
    vendorMessage: foreignVendor
      ? ranked.some((c) => accountMatchesPrefixes(c.code, ["320"]))
        ? ""
        : "Satıcı cari hesabı bulunamadı"
      : match?.duplicateAccounts
        ? "Mükerrer cari hesap bulundu — kullanıcı seçimi gerekli"
        : "",
    _stats: {
      indexBuilds: cache.indexBuildCount || 0,
      planNormalizes: cache.planNormalizeCount || 0,
      ownCompanyFiltered,
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
  const duplicateAccounts = Boolean(search.duplicateAccounts);
  const leafCandidates = (search.candidates || []).filter((c) =>
    isSelectableCariLeafAccount(c.code)
  );
  // Güvenli otomatik: yalnızca güçlü exact (unvan/IBAN/VKN/hafıza) leaf'ler.
  // plan_search dolgusu ve zayıf token tekil sayılmaz; mükerrer leaf → asla.
  const strongLeafCandidates = leafCandidates.filter(
    (c) =>
      Number(c.confidence || 0) >= 80 &&
      c.matchReason !== CARI_MATCH_REASON.TOKEN_WEAK &&
      c.matchReason !== "plan_search" &&
      isStrongCariAutoReason(c.matchReason)
  );
  const uniqueStrongCodes = new Set(
    strongLeafCandidates.map((c) => compactCode(c.code)).filter(Boolean)
  );
  const safeTop =
    !duplicateAccounts &&
    !base.partyUnresolved &&
    uniqueStrongCodes.size === 1 &&
    strongLeafCandidates.length >= 1
      ? strongLeafCandidates[0]
      : null;
  // Öneri listesinde göster ama otomatik seçme (mükerrer / zayıf / ana hesap)
  const displayTop = leafCandidates[0] || null;
  const confidence = Number(
    safeTop?.confidence || (duplicateAccounts ? 90 : displayTop?.confidence) || 0
  );
  const confidenceLabel =
    duplicateAccounts
      ? "Mükerrer — seçim gerekli"
      : confidence >= 80
        ? "Yüksek (onay gerekli)"
        : confidence >= 50
          ? "Orta"
          : confidence > 0
            ? "Düşük"
            : "Aday yok";
  const party =
    search.extractedParty &&
    !isOwnCompanyPartyName(
      search.extractedParty,
      buildOwnCompanyIdentity(base.selectedCompany || null)
    )
      ? search.extractedParty
      : base.partyUnresolved
        ? base.partyName
        : search.extractedParty ||
          base.partyName ||
          PARTY_UNRESOLVED_LABEL;

  return {
    ...base,
    partyName: party,
    partyUnresolved:
      party === PARTY_UNRESOLVED_LABEL ||
      party === "Karşı taraf bilgisi yetersiz" ||
      base.partyUnresolved,
    vendorMessage: search.vendorMessage,
    preferredPrefixes: search.preferredPrefixes,
    candidates: leafCandidates.length ? leafCandidates : search.candidates,
    suggestedAccount: safeTop?.code || "",
    suggestedName: safeTop?.name || "",
    confidence,
    confidenceLabel,
    matchReason: safeTop?.matchReason || displayTop?.matchReason || "",
    candidatesReady: true,
    ownCompanyFiltered: Number(search.ownCompanyFiltered || 0),
    duplicateAccounts,
    learnAllowedDefault: Boolean(safeTop) && !base.partyUnresolved,
  };
}

/**
 * Tek grup için aday üret (kart görünür / arama / lazy hydrate).
 * Aynı planCache paylaşılmalı.
 */
export function hydrateCariResolutionGroupCandidates(
  group,
  companyPlans = [],
  { planCache = null, limit = 5, selectedCompany = null } = {}
) {
  if (!group) return group;
  if (group.virmanCandidate) {
    return {
      ...group,
      candidates: [],
      suggestedAccount: "",
      suggestedName: "",
      confidence: 0,
      confidenceLabel: "Banka hesabı tanımla",
      vendorMessage: VIRMAN_CANDIDATE_LABEL,
      candidatesReady: true,
    };
  }
  if (group.partyUnresolved) {
    return {
      ...group,
      partyName: PARTY_UNRESOLVED_LABEL,
      partyUnresolved: true,
      candidates: [],
      suggestedAccount: "",
      suggestedName: "",
      confidence: 0,
      confidenceLabel: PARTY_UNRESOLVED_LABEL,
      matchReason: "",
      candidatesReady: true,
      learnAllowedDefault: false,
    };
  }
  const sample = group.samples?.[0] || "";
  const search = searchCariResolutionCandidates(companyPlans, {
    direction: group.direction,
    description: sample,
    limit,
    foreignVendor: group.foreignVendor,
    searchAll: false,
    planCache,
    selectedCompany: selectedCompany || group.selectedCompany || null,
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
function pushRowIntoCariGroupMap(groups, row, fullContext, options = {}) {
  const desc = rowDescription(row);
  const direction = resolveLucaRowBankDirection(row, fullContext) || "";
  const key =
    options.forceKey ||
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
      partyUnresolvedForced: Boolean(options.partyUnresolved),
    });
  }
  const g = groups.get(key);
  if (g.direction && direction && g.direction !== direction) {
    const splitKey = `${key}__${direction}`;
    if (!groups.has(splitKey)) {
      groups.set(splitKey, {
        analysisKey: splitKey,
        direction,
        rows: [],
        samples: [],
        dates: [],
        partyUnresolvedForced: Boolean(options.partyUnresolved),
      });
    }
    const sg = groups.get(splitKey);
    sg.rows.push(row);
    if (sg.samples.length < 3) sg.samples.push(desc.slice(0, 160));
    const d = rowDate(row);
    if (d) sg.dates.push(d);
    return;
  }
  if (!g.direction && direction) g.direction = direction;
  if (options.partyUnresolved) g.partyUnresolvedForced = true;
  g.rows.push(row);
  if (g.samples.length < 3) g.samples.push(desc.slice(0, 160));
  const d = rowDate(row);
  if (d) g.dates.push(d);
}

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
  const selectedCompany = context.selectedCompany || null;

  const groupStart = collectStats ? performance.now() : 0;

  const divertedVirman = [];
  const virmanCandidates = [];
  const creditCardRows = [];
  const taxObligationRows = [];
  const groups = new Map();
  let unresolvedCount = 0;
  let totalMissing = 0;

  for (const row of rows || []) {
    if (!isMissingHesapRow(row)) continue;
    totalMissing += 1;

    const virman = classifyVirmanForCariCenter(row, fullContext);

    // 1) Kesin virman — cari akışına hiç girme
    if (virman.bucket === "definite") {
      const verdict = evaluateOwnAccountVirmanTransfer(row, fullContext);
      divertedVirman.push({
        rowId: row.id,
        analysisKey: row.analysisKey || "",
        reasons: verdict.reasons?.length
          ? verdict.reasons
          : ["definite_102_pair"],
        suggested102: verdict.suggested102 || "",
        label: virman.label || "Firma kendi hesabı / virman",
      });
      continue;
    }

    // 2) Kredi kartı — cari / virman adayına girmez
    if (isCreditCardMissingRow(row, fullContext)) {
      creditCardRows.push(row);
      continue;
    }

    // 2b) Vergi / SGK — cari / virman / KK'ye girmez
    if (isTaxObligationMissingRow(row, fullContext)) {
      taxObligationRows.push(row);
      continue;
    }

    // 3) Virman adayı — cari aday / 120-320 üretme
    if (virman.bucket === "candidate") {
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
        dates: rowDate(row),
      });
      continue;
    }

    // 4) Normal cari grubu
    if (!isCariMissingRow(row, fullContext)) continue;
    unresolvedCount += 1;
    const direction = resolveLucaRowBankDirection(row, fullContext) || "";
    const desc = rowDescription(row);
    if (isOwnOnlyOrMissingCounterparty(desc, direction, selectedCompany)) {
      // Kendi unvanı / dış taraf yok → sahte MARE grubu yok; tespit edilemedi sınıfı
      pushRowIntoCariGroupMap(groups, row, fullContext, {
        forceKey: `${PARTY_UNRESOLVED_LABEL}|${direction || "NA"}`,
        partyUnresolved: true,
      });
      continue;
    }
    pushRowIntoCariGroupMap(groups, row, fullContext);
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
  let ownCompanyFilteredTotal = 0;

  const ranked = [...groups.values()]
    .map((g) => {
      const sample = g.samples[0] || rowDescription(g.rows[0]) || "";
      const foreignVendor = isForeignVendorDescription(sample);
      const totalAmount = g.rows.reduce((sum, r) => sum + rowAmount(r), 0);
      const sortedDates = sortCariDisplayDates(g.dates);
      const ownIdentity = buildOwnCompanyIdentity(selectedCompany);
      let partyFallback =
        extractCounterpartyParty({
          description: sample,
          direction: g.direction || "",
          ownIdentity,
        }) || "";
      if (
        g.partyUnresolvedForced ||
        !partyFallback ||
        isOwnCompanyPartyName(partyFallback, ownIdentity)
      ) {
        partyFallback = PARTY_UNRESOLVED_LABEL;
      }

      return {
        id: g.analysisKey,
        analysisKey: g.analysisKey,
        partyName: partyFallback,
        partyUnresolved: partyFallback === PARTY_UNRESOLVED_LABEL,
        selectedCompany,
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
        transactions: g.rows.map((r) =>
          buildCariResolutionRowView(r, fullContext)
        ),
        seedRow: g.rows[0],
        foreignVendor,
        status: "remaining",
        ...emptyCandidateFields(foreignVendor, g.direction),
      };
    })
    .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount)
    .map((base, index) => {
      if (index >= hydrateCount) return base;
      if (base.partyUnresolved) {
        return {
          ...base,
          ...emptyCandidateFields(base.foreignVendor, base.direction),
          partyName: PARTY_UNRESOLVED_LABEL,
          partyUnresolved: true,
          candidatesReady: true,
          confidenceLabel: PARTY_UNRESOLVED_LABEL,
          learnAllowedDefault: false,
        };
      }
      const t0 = collectStats ? performance.now() : 0;
      const enriched = hydrateCariResolutionGroupCandidates(base, companyPlans, {
        planCache,
        limit: 5,
        selectedCompany,
      });
      if (collectStats) {
        candidateMs += performance.now() - t0;
        candidateHydrations += 1;
        planScansDuringCandidates += 1;
        ownCompanyFilteredTotal += Number(enriched.ownCompanyFiltered || 0);
      }
      return enriched;
    });

  const divertedGroupKeys = new Set(
    divertedVirman.map((d) => d.analysisKey).filter(Boolean)
  );

  const candidateGroupMap = new Map();
  for (const item of virmanCandidates) {
    const key = item.analysisKey || `virman-aday|${item.rowId}`;
    if (!candidateGroupMap.has(key)) {
      candidateGroupMap.set(key, {
        analysisKey: key,
        direction: item.direction || "",
        rows: [],
        samples: [],
        dates: [],
        totalAmount: 0,
      });
    }
    const g = candidateGroupMap.get(key);
    g.rows.push(item);
    if (g.samples.length < 3 && item.description) {
      g.samples.push(item.description);
    }
    if (item.dates) g.dates.push(item.dates);
    g.totalAmount += Number(item.amount) || 0;
  }
  const virmanCandidateGroups = [...candidateGroupMap.values()]
    .map((g) => {
      const sortedDates = sortCariDisplayDates(g.dates);
      return {
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
        dateFrom: sortedDates[0] || "",
        dateTo: sortedDates[sortedDates.length - 1] || "",
        rowIds: g.rows.map((r) => r.rowId).filter(Boolean),
        transactions: g.rows.map((item) =>
          buildCariResolutionRowView(
            {
              id: item.rowId,
              fisTarihi: item.dates || "",
              detayAciklama: item.description || "",
              borc: item.amount,
              alacak: 0,
              direction: item.direction || g.direction || "",
              transactionType: "VIRMAN_ADAY",
              analysisKey: g.analysisKey,
              missingHesapCategory: VIRMAN_CANDIDATE_LABEL,
              riskDurumu: "HESAP_EKSIK",
            },
            fullContext
          )
        ),
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
      };
    })
    .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);

  // Kredi kartı grupları — company_id | banka | son4 | ekstre YYYY-MM | yön | tip
  const ccGroupMap = new Map();
  for (const row of creditCardRows) {
    const desc = rowDescription(row);
    const direction = resolveLucaRowBankDirection(row, fullContext) || "";
    const resolved = resolveCreditCardPayment({
      company: selectedCompany,
      description: desc,
      paymentDate: rowDate(row),
      selectedBank: context.selectedBank || "",
      companyPlans,
    });
    const last4 =
      resolved.lastFourDigits ||
      extractCardLast4FromText(desc) ||
      String(row.creditCardLast4 || "").trim() ||
      "????";
    const bankName =
      resolved.bankName ||
      row.bankaAdi ||
      row.bankName ||
      context.selectedBank ||
      "";
    const periodKey =
      resolved.periodKey ||
      creditCardStatementPeriodKey({
        month: resolved.periodMonth,
        year: resolved.periodYear,
        source: resolved.periodSource,
        confidence:
          resolved.periodSource === "month_name" ||
          resolved.periodSource === "numeric_my" ||
          resolved.periodSource === "iso_ym"
            ? "high"
            : "low",
      });
    const key = buildCreditCardGroupKey({
      companyId: selectedCompany?.id || "",
      bankName,
      lastFourDigits: last4,
      statementPeriodKey: periodKey,
      direction,
      transactionType:
        row.transactionType || BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
    });
    if (!ccGroupMap.has(key)) {
      ccGroupMap.set(key, {
        key,
        lastFourDigits: last4,
        bankName,
        direction,
        periodKey,
        periodMonth: resolved.periodMonth || null,
        periodYear: resolved.periodYear || null,
        rows: [],
        rowResolved: [],
        samples: [],
        dates: [],
        resolved,
      });
    }
    const g = ccGroupMap.get(key);
    g.rows.push(row);
    g.rowResolved.push(resolved);
    if (g.samples.length < 5) g.samples.push(desc.slice(0, 200));
    const d = rowDate(row);
    if (d) g.dates.push(d);
    if (!g.resolved?.accountCode && resolved.accountCode) {
      g.resolved = resolved;
    }
    if (
      (!g.periodMonth || g.periodKey === "belirsiz") &&
      resolved.periodMonth &&
      periodKey !== "belirsiz"
    ) {
      g.periodMonth = resolved.periodMonth;
      g.periodYear = resolved.periodYear;
      g.periodKey = periodKey;
    }
  }

  const creditCardGroups = [...ccGroupMap.values()]
    .map((g) => {
      const totalAmount = g.rows.reduce((sum, r) => sum + rowAmount(r), 0);
      const sortedDates = sortCariDisplayDates(g.dates);
      const resolved = g.resolved || {};
      const periodKey = g.periodKey || "belirsiz";
      const periodLabel =
        periodKey === "belirsiz"
          ? "Dönem belirsiz"
          : g.periodMonth && g.periodYear
            ? `${String(g.periodMonth).padStart(2, "0")}/${g.periodYear}`
            : g.periodMonth
              ? `Ay ${g.periodMonth}`
              : periodKey;
      const candidates = searchCreditCardResolutionCandidates(companyPlans, {
        lastFourDigits: g.lastFourDigits,
        periodMonth: g.periodMonth,
        periodYear: g.periodYear,
        bankName: g.bankName,
        limit: 8,
      });
      const suggested =
        resolved.accountCode ||
        resolved.suggestedAccountCode ||
        candidates[0]?.code ||
        "";
      return {
        id: `kk:${g.key}`,
        analysisKey: g.key,
        partyName: `****${g.lastFourDigits}`,
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
        transactions: g.rows.map((r, idx) => {
          const view = buildCariResolutionRowView(r, fullContext);
          const rowResolved = g.rowResolved[idx] || {};
          const rowPeriodKey =
            rowResolved.periodKey ||
            creditCardStatementPeriodKey({
              month: rowResolved.periodMonth,
              year: rowResolved.periodYear,
              source: rowResolved.periodSource,
              confidence:
                rowResolved.periodSource === "month_name" ||
                rowResolved.periodSource === "numeric_my" ||
                rowResolved.periodSource === "iso_ym"
                  ? "high"
                  : "low",
            });
          const rowPeriodLabel =
            rowPeriodKey === "belirsiz"
              ? "Dönem belirsiz"
              : rowResolved.periodMonth && rowResolved.periodYear
                ? `${String(rowResolved.periodMonth).padStart(2, "0")}/${rowResolved.periodYear}`
                : rowResolved.periodMonth
                  ? `Ay ${rowResolved.periodMonth}`
                  : rowPeriodKey;
          return {
            ...view,
            creditCardRow: true,
            lastFourDigits:
              rowResolved.lastFourDigits || g.lastFourDigits || "",
            bankName:
              rowResolved.bankName ||
              view.bankName ||
              g.bankName ||
              context.selectedBank ||
              "",
            statementPeriodKey: rowPeriodKey,
            statementPeriodLabel: rowPeriodLabel,
            statusOrSuggestion:
              rowResolved.accountCode
                ? `Öneri: ${rowResolved.accountCode}`
                : rowResolved.warning ||
                  view.statusOrSuggestion ||
                  CREDIT_CARD_MISSING_LABEL,
          };
        }),
        seedRow: g.rows[0],
        foreignVendor: false,
        status: "remaining",
        creditCardGroup: true,
        lastFourDigits: g.lastFourDigits,
        bankName: g.bankName,
        statementPeriodKey: periodKey,
        statementPeriodLabel: periodLabel,
        periodMonth: g.periodMonth || null,
        periodYear: g.periodYear || null,
        vendorMessage: CREDIT_CARD_MISSING_LABEL,
        preferredPrefixes: ["309", "409"],
        candidates,
        suggestedAccount: suggested,
        suggestedName:
          candidates.find((c) => c.code === suggested)?.name || "",
        confidence: Number(resolved.confidence || 0),
        confidenceLabel: resolved.confidenceLabel || "Hesap seçilmeli",
        matchReason: resolved.matchReason || "",
        candidatesReady: true,
        ambiguous: Boolean(resolved.ambiguous),
      };
    })
    .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);

  const taxObligationGroups = buildTaxObligationResolutionGroups(
    taxObligationRows,
    context.obligationAccruals || [],
    fullContext
  );

  const result = {
    totalMissing,
    cariMissingCount: unresolvedCount,
    groupCount: ranked.length,
    groups: ranked,
    planCache,
    selectedCompany,
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
    creditCardMissingCount: creditCardRows.length,
    creditCardGroupCount: creditCardGroups.length,
    creditCardGroups,
    creditCardMissingLabel: CREDIT_CARD_MISSING_LABEL,
    taxObligationMissingCount: taxObligationRows.length,
    taxObligationGroupCount: taxObligationGroups.length,
    taxObligationGroups,
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
      ownCompanyFiltered: ownCompanyFilteredTotal,
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

/** Büyük gruplarda ilk render satır sayısı */
export const CARI_RESOLUTION_ROW_PAGE_SIZE = 25;

export function directionLabelForCari(direction = "") {
  const d = String(direction || "").toUpperCase();
  if (d === "GIRIS" || d === "GELEN" || d === "ALACAK") return "Gelen";
  if (d === "CIKIS" || d === "GIDEN" || d === "BORC") return "Giden";
  return "—";
}

/**
 * Grup kartı listesi için hafif satır görünümü (teknik JSON yok).
 */
export function buildCariResolutionRowView(row = {}, context = {}) {
  const direction =
    resolveLucaRowBankDirection(row, context) ||
    String(row.direction || "").trim();
  const desc = rowDescription(row);
  const amount = rowAmount(row);
  const statusLabel =
    String(row.missingHesapCategory || "").trim() ||
    (row.riskDurumu === "HESAP_EKSIK" ? "Hesap eksik" : "") ||
    String(row.kontrolNotu || row.uyari || "")
      .split("|")[0]
      .trim()
      .slice(0, 80) ||
    "—";
  const suggestedAccount = String(
    row.hesapKodu || row.accountCode || ""
  ).trim();

  return {
    id: String(row.id || ""),
    date: rowDate(row),
    description: desc,
    direction,
    directionLabel: directionLabelForCari(direction),
    amount,
    transactionType: String(row.transactionType || "—"),
    statusLabel,
    bankName: String(
      row.bankaAdi || row.bankName || row.bank || row.kaynakAdi || ""
    ).trim(),
    analysisKey: String(row.analysisKey || ""),
    suggestedAccount,
    statusOrSuggestion: suggestedAccount
      ? `Öneri: ${suggestedAccount}`
      : statusLabel,
    learnSeed: {
      id: row.id,
      analysisKey: row.analysisKey || "",
      direction,
      detayAciklama: desc,
      fisAciklama: row.fisAciklama || "",
      transactionType: row.transactionType || "",
      belgeTuru: row.belgeTuru || "",
      borc: row.borc,
      alacak: row.alacak,
      fisTarihi: rowDate(row),
    },
  };
}

export function createInitialCariRowSelection(rowIds = []) {
  return new Set((rowIds || []).filter(Boolean).map(String));
}

export function toggleCariRowSelection(selectedSet, rowId) {
  const next = new Set(selectedSet instanceof Set ? selectedSet : []);
  const id = String(rowId || "");
  if (!id) return next;
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function setAllCariRowSelection(rowIds = [], selected = true) {
  if (!selected) return new Set();
  return createInitialCariRowSelection(rowIds);
}

export function sliceCariRowsForDisplay(
  rows = [],
  visibleCount = CARI_RESOLUTION_ROW_PAGE_SIZE
) {
  const total = Array.isArray(rows) ? rows.length : 0;
  const n = Math.max(
    0,
    Number(visibleCount) || CARI_RESOLUTION_ROW_PAGE_SIZE
  );
  return {
    visible: (rows || []).slice(0, n),
    hasMore: total > n,
    remaining: Math.max(0, total - n),
    total,
  };
}

/**
 * page.jsx group.rowIds ile çalışır; kısmi uygulamada orijinal id’yi resolved
 * işaretletmemek için id’yi geçici kısmi anahtara çevirir.
 */
export function buildCariApplyGroupPayload(group, selectedRowIds = []) {
  const allIds = (group?.rowIds || []).map(String).filter(Boolean);
  const selectedWanted = new Set(
    (selectedRowIds || []).map(String).filter(Boolean)
  );
  const selected = allIds.filter((id) => selectedWanted.has(id));
  const applyAll = selected.length > 0 && selected.length >= allIds.length;
  const firstId = selected[0];
  const tx = (group?.transactions || []).find(
    (t) => String(t.id) === String(firstId)
  );
  const seedRow = tx?.learnSeed
    ? { ...(group.seedRow || {}), ...tx.learnSeed }
    : group.seedRow;

  return {
    ...group,
    rowIds: selected,
    count: selected.length,
    seedRow,
    id: applyAll ? group.id : `${group.id}::__partial__`,
    applySelectedCount: selected.length,
    applyTotalCount: allIds.length,
    isPartialApply: Boolean(selected.length && !applyAll),
  };
}

export function formatCariApplyButtonLabel(selectedCount = 0) {
  const n = Number(selectedCount) || 0;
  if (n <= 0) return "Seçilen Hesabı İşleme Uygula";
  return `Seçilen Hesabı ${n} İşleme Uygula`;
}

/** Otomatik öğrenme checkbox varsayılanı — güvenli koşullarda bile opt-in. */
export function shouldDefaultCariAutoLearn({
  confidence = 0,
  accountCode = "",
  duplicateAccounts = false,
  partyName = "",
  parentCodes = null,
} = {}) {
  if (duplicateAccounts) return false;
  if (!accountCode || !isSelectableCariLeafAccount(accountCode, parentCodes)) {
    return false;
  }
  if (Number(confidence) < 80) return false;
  if (!String(partyName || "").trim()) return false;
  return false; // kullanıcı açıkça işaretlesin
}

export function canEnableCariAutoLearn({
  confidence = 0,
  accountCode = "",
  duplicateAccounts = false,
  parentCodes = null,
} = {}) {
  if (duplicateAccounts) return false;
  if (!accountCode || !isSelectableCariLeafAccount(accountCode, parentCodes)) {
    return false;
  }
  if (Number(confidence) < 80) return false;
  return true;
}