/**
 * Kredi Kartı Motoru V1 — tespit, eşleştirme, ekstre dönemi, 309/409 çözüm.
 * Yeni hesap kodu üretmez; yalnız mevcut plan / firma kartı / hafıza kullanır.
 */

import { normalizeParserText } from "@/src/utils/textNormalize";

export const CREDIT_CARD_CLASSIFICATION = "CREDIT_CARD_PAYMENT";
export const CREDIT_CARD_MISSING_LABEL =
  "Kredi kartı hesabı bulunamadı — 309/409 seçilmeli";

const MONTH_NAMES = [
  "OCAK",
  "ŞUBAT",
  "MART",
  "NİSAN",
  "MAYIS",
  "HAZİRAN",
  "TEMMUZ",
  "AĞUSTOS",
  "EYLÜL",
  "EKİM",
  "KASIM",
  "ARALIK",
];

const MONTH_NAMES_ASCII = [
  "OCAK",
  "SUBAT",
  "MART",
  "NISAN",
  "MAYIS",
  "HAZIRAN",
  "TEMMUZ",
  "AGUSTOS",
  "EYLUL",
  "EKIM",
  "KASIM",
  "ARALIK",
];

function normalizeTrText(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C");
}

export function normalizeMonthlyBaseAccount(baseAccount) {
  const text = String(baseAccount || "").trim();
  if (!text) return "";
  const segments = text.split(".").filter((segment) => segment !== "");
  if (segments.length >= 3) {
    return segments.slice(0, 2).join(".");
  }
  return segments.join(".");
}

export function parseFlexibleDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Date.UTC(1899, 11, 30) + value * 86400000;
    const fromSerial = new Date(ms);
    return Number.isNaN(fromSerial.getTime()) ? null : fromSerial;
  }
  const text = String(value || "").trim();
  if (!text) return null;
  let match = text.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (match) {
    const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^\d+$/.test(text)) return parseFlexibleDate(Number(text));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** POS tahsilat / komisyon — kart borcu ödemesi değil */
export function isPosOrCommissionNotCardDebt(text = "") {
  const t = normalizeParserText(text);
  if (!t) return false;
  if (/\bPOS\b/.test(t) || t.includes("UYE ISYERI") || t.includes("ÜYE İŞYERİ")) {
    return true;
  }
  if (
    t.includes("KOMISYON") ||
    t.includes("KOMİSYON") ||
    t.includes("BSMV") ||
    t.includes("SERVİS BEDEL") ||
    t.includes("SERVIS BEDEL")
  ) {
    // "KART KOMİSYON" — borç ödemesi değil
    if (t.includes("KOMISYON") || t.includes("KOMİSYON")) return true;
  }
  return false;
}

/**
 * Banka ekstresinden kart borcu ödemesi mi?
 * (POS tahsilatı ve kart komisyonu hariç)
 */
export function isCreditCardPaymentDescription(description = "") {
  if (isPosOrCommissionNotCardDebt(description)) return false;
  const raw = String(description || "");
  const text = normalizeParserText(description);
  if (!text) return false;

  if (
    text.includes("KREDI KARTI ODEME") ||
    text.includes("KREDI KARTI BORC") ||
    text.includes("KREDI KART") ||
    text.includes("KK ODEME") ||
    text.includes("KK ODEMESI") ||
    text.includes("K KART") ||
    text.includes("KART EKSTRE") ||
    text.includes("CARD PAYMENT") ||
    text.includes("EKSTRE BORC") ||
    text.includes("EKSTRESI ODEME") ||
    text.includes("EKSTRESI ODEMESI") ||
    text.includes("EKSTESI ODEME")
  ) {
    return true;
  }

  // Yalnız maskeli kart (* / X) + ekstre/ödeme anlatımı — rastgele 4 hane yetmez
  const hasMaskedCard = /\*{1,}\s*\d{4}\b|X{2,}\s*\d{4}\b/i.test(raw);
  if (
    hasMaskedCard &&
    (text.includes("EKSTRE") ||
      text.includes("ODEME") ||
      text.includes("BORC") ||
      text.includes("KART"))
  ) {
    return true;
  }

  return false;
}

/** Geriye dönük alias */
export function isCreditCardPaymentText(description) {
  return isCreditCardPaymentDescription(description);
}

export function extractCardLast4FromText(text = "") {
  const raw = String(text || "");
  const masked =
    raw.match(/\*{1,}\s*(\d{4})\b/) ||
    raw.match(/\*{4}(\d{4})\b/) ||
    raw.match(/X{2,}\s*(\d{4})\b/i) ||
    raw.match(/\b(?:SON\s*4|LAST\s*4)[^\d]*(\d{4})\b/i);
  if (masked?.[1]) return masked[1];
  return "";
}

/**
 * Açıklamadaki ekstre dönemi (ödeme ayı değil).
 * 1) Ay adı + yıl  2) MM/YYYY  3) YYYY-MM
 */
export function extractStatementPeriodFromText(text = "") {
  const norm = normalizeTrText(text);
  if (!norm) return null;

  // 05/2026 veya 5.2026
  let m = norm.match(/\b(0?[1-9]|1[0-2])[./](20\d{2})\b/);
  if (m) {
    return { month: Number(m[1]), year: Number(m[2]), source: "numeric_my" };
  }
  // 2026-05
  m = norm.match(/\b(20\d{2})-(0?[1-9]|1[0-2])\b/);
  if (m) {
    return { month: Number(m[2]), year: Number(m[1]), source: "iso_ym" };
  }

  for (let i = 0; i < MONTH_NAMES_ASCII.length; i++) {
    if (norm.includes(MONTH_NAMES_ASCII[i])) {
      const yearMatch = norm.match(/(20\d{2})/);
      return {
        month: i + 1,
        year: yearMatch ? Number(yearMatch[1]) : null,
        source: "month_name",
      };
    }
  }
  return null;
}

function previousMonthPeriod(date) {
  let month = date.getMonth() + 1;
  let year = date.getFullYear();
  month -= 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return { month, year };
}

/**
 * Ekstre dönemi bulma sırası:
 * 1) açıklama  2) kredi kartı ekstresi kaydı (yok)  3) ONCEKI_AY varsayımı
 * (yalnız ödeme tarihinden geriye bir ay ile kesin karar yok — soft)
 */
export function resolveCreditCardStatementPeriod({
  creditCard = null,
  paymentDate = null,
  description = "",
} = {}) {
  const fromText = extractStatementPeriodFromText(description);
  if (fromText?.month) {
    const date = parseFlexibleDate(paymentDate);
    return {
      month: fromText.month,
      year: fromText.year || date?.getFullYear() || null,
      source: fromText.source || "description",
      confidence: fromText.year ? "high" : "medium",
    };
  }

  const date = parseFlexibleDate(paymentDate);
  if (!date) {
    return { month: null, year: null, source: "none", confidence: "none" };
  }

  const rule = String(creditCard?.statementPeriodRule || "ONCEKI_AY").toUpperCase();
  if (rule === "AYNI_AY") {
    return {
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      source: "payment_same_month",
      confidence: "low",
    };
  }

  const prev = previousMonthPeriod(date);
  return {
    month: prev.month,
    year: prev.year,
    source: "payment_previous_month_soft",
    confidence: "low",
  };
}

function planHasAccount(companyPlans = [], code = "") {
  const compact = String(code || "").trim().replace(/\s+/g, "");
  if (!compact) return false;
  return (companyPlans || []).some((row) => {
    if (row?.isActive === false) return false;
    const c = String(row.accountCode || row.hesapKodu || row.kod || "")
      .trim()
      .replace(/\s+/g, "");
    return c === compact;
  });
}

function is309or409(code = "") {
  const c = String(code || "").trim();
  return (
    c === "309" ||
    c.startsWith("309.") ||
    c === "409" ||
    c.startsWith("409.")
  );
}

/**
 * Ekstre dönem anahtarı — kesin dönem vs belirsiz ayrı.
 * Soft (ödeme±1 ay) tahminleri "belirsiz" sayılır.
 */
export function creditCardStatementPeriodKey(period = null) {
  if (!period || !period.month) return "belirsiz";
  const strongSources = new Set([
    "month_name",
    "numeric_my",
    "iso_ym",
    "description",
  ]);
  const conf = String(period.confidence || "");
  const source = String(period.source || "");
  const isStrong =
    strongSources.has(source) || conf === "high" || conf === "medium";
  if (!isStrong) return "belirsiz";
  if (period.year) {
    return `${period.year}-${String(period.month).padStart(2, "0")}`;
  }
  return `m${String(period.month).padStart(2, "0")}-y?`;
}

/**
 * Ay bazlı: hesap planı adından 309/409 eşleştir — kod üretmez.
 * Sinyaller: son 4, ay adı, yıl, EKSTRE, banka, kart adı.
 */
export function findCreditCardAccountsByPlanName({
  companyPlans = [],
  lastFourDigits = "",
  periodMonth = null,
  periodYear = null,
  bankName = "",
  cardName = "",
  prefer409 = false,
  basePrefix = "",
} = {}) {
  const last4 = String(lastFourDigits || "").trim();
  const monthAscii =
    periodMonth && periodMonth >= 1 && periodMonth <= 12
      ? MONTH_NAMES_ASCII[periodMonth - 1]
      : "";
  const yearStr = periodYear ? String(periodYear) : "";
  const bankNorm = normalizeBankHint(bankName);
  const cardNorm = normalizeTrText(cardName);
  const base = String(basePrefix || "").trim();

  const ranked = [];
  for (const row of companyPlans || []) {
    if (row?.isActive === false) continue;
    const code = String(row.accountCode || row.hesapKodu || row.kod || "")
      .trim()
      .replace(/\s+/g, "");
    if (!is309or409(code)) continue;
    if (prefer409) {
      if (!(code === "409" || code.startsWith("409."))) continue;
    } else if (!(code === "309" || code.startsWith("309.") || code.startsWith("409."))) {
      // 309 tercih; 409 da listelenebilir ama düşük skor
    }
    const name = String(
      row.accountName || row.hesapAdi || row.name || ""
    ).trim();
    const hay = normalizeTrText(`${code} ${name}`);

    let score = 0;
    const reasons = [];
    if (last4 && (hay.includes(last4) || name.includes(last4))) {
      score += 40;
      reasons.push("last4");
    }
    if (monthAscii && hay.includes(monthAscii)) {
      score += 35;
      reasons.push("month");
    }
    if (yearStr && hay.includes(yearStr)) {
      score += 15;
      reasons.push("year");
    }
    if (hay.includes("EKSTRE")) {
      score += 10;
      reasons.push("ekstre");
    }
    if (bankNorm && hay.includes(bankNorm)) {
      score += 8;
      reasons.push("bank");
    }
    if (cardNorm && cardNorm.length >= 3 && hay.includes(cardNorm)) {
      score += 8;
      reasons.push("card_name");
    }
    if (base && code.startsWith(base)) {
      score += 6;
      reasons.push("base");
    }
    if (prefer409 && code.startsWith("409")) score += 4;
    if (!prefer409 && code.startsWith("309")) score += 4;

    if (score < 40) continue;
    ranked.push({
      code,
      name,
      score,
      reasons,
      confidence: Math.min(98, score),
      reasonLabel: reasons.join("+"),
    });
  }

  ranked.sort(
    (a, b) => b.score - a.score || a.code.localeCompare(b.code, "tr")
  );

  // Otomatik: tek güçlü aday (son4 + ay zorunlu)
  const strong = ranked.filter(
    (r) =>
      r.reasons.includes("last4") &&
      r.reasons.includes("month") &&
      r.score >= 75
  );
  let autoCode = "";
  let ambiguous = false;
  if (strong.length === 1) {
    autoCode = strong[0].code;
  } else if (strong.length > 1) {
    ambiguous = true;
  }

  return {
    candidates: ranked.slice(0, 12),
    autoCode,
    ambiguous,
  };
}

export function getCreditCardAccount({
  creditCard,
  paymentDate,
  installmentYearShift = false,
  description = "",
  companyPlans = null,
  statementPeriod = null,
}) {
  if (!creditCard) {
    return {
      accountCode: "",
      periodMonth: null,
      periodYear: null,
      warning: "Kredi kartı bilgisi bulunamadı.",
      inPlan: false,
      candidates: [],
    };
  }

  const period =
    statementPeriod ||
    resolveCreditCardStatementPeriod({
      creditCard,
      paymentDate,
      description,
    });

  const month = period.month;
  const year = period.year;
  const periodKey = creditCardStatementPeriodKey(period);

  const single =
    creditCard.singleLucaAccountCode || creditCard.lucaAccountCode || "";
  const base309 = normalizeMonthlyBaseAccount(
    creditCard.monthly309BaseAccount ||
      creditCard.monthly309BaseAccountCode ||
      ""
  );
  const base409 = normalizeMonthlyBaseAccount(
    creditCard.monthly409BaseAccount ||
      creditCard.monthly409BaseAccountCode ||
      ""
  );
  const trackingMethod = String(creditCard.trackingMethod || "")
    .toUpperCase()
    .replace(/\s+/g, "_");

  const last4 = String(creditCard.lastFourDigits || "").trim();
  const plans = Array.isArray(companyPlans) ? companyPlans : [];

  // —— TEK HESAP ——
  if (trackingMethod === "TEK_HESAP" || (!trackingMethod && single && !base309)) {
    const accountCode = single || "";
    let inPlan = true;
    if (accountCode && plans.length) {
      inPlan = planHasAccount(plans, accountCode);
      if (!inPlan) {
        return {
          accountCode: "",
          suggestedAccountCode: accountCode,
          periodMonth: month,
          periodYear: year,
          periodSource: period.source,
          periodKey,
          warning: `${accountCode} hesap planında yok; manuel seçin.`,
          inPlan: false,
          candidates: [],
        };
      }
    }
    return {
      accountCode,
      suggestedAccountCode: accountCode,
      periodMonth: month,
      periodYear: year,
      periodSource: period.source,
      periodKey,
      warning: !accountCode ? "Tek Luca hesabı tanımlı değil." : "",
      inPlan,
      candidates: accountCode
        ? [{ code: accountCode, name: "Tek hesap", score: 100 }]
        : [],
    };
  }

  // —— AY BAZLI: plan adından eşle, kod üretme ——
  const isMonthly =
    trackingMethod === "AY_BAZLI_309" ||
    trackingMethod === "AY_BAZLI_309_409" ||
    Boolean(base309 || base409);

  if (isMonthly) {
    if (periodKey === "belirsiz" || !month) {
      return {
        accountCode: "",
        suggestedAccountCode: "",
        periodMonth: month,
        periodYear: year,
        periodSource: period.source,
        periodKey: "belirsiz",
        warning: "Ekstre dönemi belirsiz; hesap adından otomatik seçilmedi.",
        inPlan: false,
        candidates: findCreditCardAccountsByPlanName({
          companyPlans: plans,
          lastFourDigits: last4,
          bankName: creditCard.bankName || "",
          cardName: creditCard.cardName || "",
          prefer409: installmentYearShift,
          basePrefix: installmentYearShift ? base409 : base309,
        }).candidates,
      };
    }

    const found = findCreditCardAccountsByPlanName({
      companyPlans: plans,
      lastFourDigits: last4 || extractCardLast4FromText(description),
      periodMonth: month,
      periodYear: year,
      bankName: creditCard.bankName || "",
      cardName: creditCard.cardName || "",
      prefer409: Boolean(installmentYearShift),
      basePrefix: installmentYearShift
        ? base409 || base309
        : base309 || base409,
    });

    if (found.ambiguous) {
      return {
        accountCode: "",
        suggestedAccountCode: found.candidates[0]?.code || "",
        periodMonth: month,
        periodYear: year,
        periodSource: period.source,
        periodKey,
        warning:
          "Birden fazla 309/409 adayı; otomatik uygulanmadı — manuel seçin.",
        inPlan: false,
        candidates: found.candidates,
        ambiguous: true,
      };
    }

    if (found.autoCode) {
      return {
        accountCode: found.autoCode,
        suggestedAccountCode: found.autoCode,
        periodMonth: month,
        periodYear: year,
        periodSource: period.source,
        periodKey,
        warning: "",
        inPlan: true,
        candidates: found.candidates,
        matchReason: "plan_name",
      };
    }

    return {
      accountCode: "",
      suggestedAccountCode: found.candidates[0]?.code || "",
      periodMonth: month,
      periodYear: year,
      periodSource: period.source,
      periodKey,
      warning:
        "Hesap planında ekstre dönemi / kart adına uygun 309/409 bulunamadı.",
      inPlan: false,
      candidates: found.candidates,
    };
  }

  if (single) {
    const ok = !plans.length || planHasAccount(plans, single);
    return {
      accountCode: ok ? single : "",
      suggestedAccountCode: single,
      periodMonth: month,
      periodYear: year,
      periodSource: period.source,
      periodKey,
      warning: ok ? "" : `${single} hesap planında yok.`,
      inPlan: ok,
      candidates: [],
    };
  }

  return {
    accountCode: "",
    periodMonth: month,
    periodYear: year,
    periodSource: period.source,
    periodKey,
    warning: "Kredi kartı takip yöntemi tanımsız.",
    inPlan: false,
    candidates: [],
  };
}

export function listActiveCreditCards(creditCards = []) {
  return (creditCards || []).filter((c) => c && c.isActive !== false);
}

export function findCreditCardsMatchingText(creditCards = [], text = "") {
  const normalizedText = String(text || "").toUpperCase();
  const digitsOnly = normalizedText.replace(/\D/g, "");
  const last4FromText = extractCardLast4FromText(text);
  const active = listActiveCreditCards(creditCards);

  return active.filter((card) => {
    const lastFour = String(card.lastFourDigits || "").trim();
    const cardName = String(card.cardName || "").toUpperCase();
    if (
      lastFour &&
      (last4FromText === lastFour ||
        normalizedText.includes(lastFour) ||
        digitsOnly.endsWith(lastFour) ||
        digitsOnly.includes(lastFour))
    ) {
      return true;
    }
    if (cardName && normalizedText.includes(cardName)) return true;
    return false;
  });
}

/** Tek eşleşme için geriye dönük API */
export function findCreditCardByText(creditCards = [], text = "") {
  const matches = findCreditCardsMatchingText(creditCards, text);
  return matches.length === 1 ? matches[0] : matches[0] || null;
}

function normalizeBankHint(name = "") {
  return normalizeParserText(name).replace(/\s+/g, " ");
}

function bankNamesCompatible(a = "", b = "") {
  const na = normalizeBankHint(a);
  const nb = normalizeBankHint(b);
  if (!na || !nb) return true;
  return na.includes(nb) || nb.includes(na);
}

/**
 * Kart çözüm sırası (V1):
 * 1) tam kart kaydı  2) son 4  3) banka+son 4  4) hafıza
 * 5) muhasebe eşlemesi (kart alanları)  6) plan 309/409 aday  7) manuel
 * Belirsiz son 4 → otomatik yok.
 */
export function resolveCreditCardPayment({
  company = null,
  description = "",
  paymentDate = null,
  selectedBank = "",
  companyPlans = [],
  memoryAccountCode = "",
  installmentYearShift = false,
} = {}) {
  const empty = {
    isCreditCardPayment: false,
    classification: "",
    creditCard: null,
    matches: [],
    ambiguous: false,
    accountCode: "",
    suggestedAccountCode: "",
    periodMonth: null,
    periodYear: null,
    periodSource: "",
    matchReason: "",
    confidence: 0,
    confidenceLabel: "Aday yok",
    warning: "",
    lastFourDigits: "",
  };

  if (!isCreditCardPaymentDescription(description)) {
    // Firma kartı son 4 eşleşmesi ile de aday olabilir
    const softMatches = findCreditCardsMatchingText(
      company?.creditCards || [],
      description
    );
    if (!softMatches.length) return empty;
  }

  const lastFourDigits = extractCardLast4FromText(description);
  let matches = findCreditCardsMatchingText(
    company?.creditCards || [],
    description
  );

  // Banka + son 4 sıkılaştırma
  if (matches.length > 1 && selectedBank) {
    const bankNarrow = matches.filter((c) =>
      bankNamesCompatible(c.bankName, selectedBank)
    );
    if (bankNarrow.length === 1) matches = bankNarrow;
    else if (bankNarrow.length > 1) matches = bankNarrow;
  }

  if (matches.length > 1 && lastFourDigits) {
    const last4Only = matches.filter(
      (c) => String(c.lastFourDigits || "").trim() === lastFourDigits
    );
    if (last4Only.length === 1) matches = last4Only;
    else if (last4Only.length > 1) matches = last4Only;
  }

  const ambiguous = matches.length > 1;
  const card = matches.length === 1 ? matches[0] : null;

  if (ambiguous) {
    return {
      ...empty,
      isCreditCardPayment: true,
      classification: CREDIT_CARD_CLASSIFICATION,
      matches,
      ambiguous: true,
      lastFourDigits:
        lastFourDigits ||
        String(matches[0]?.lastFourDigits || "").trim(),
      matchReason: "ambiguous_last4",
      confidence: 40,
      confidenceLabel: "Belirsiz — birden fazla kart",
      warning:
        "Aynı son 4 hane birden fazla kartta; otomatik uygulanmadı.",
    };
  }

  // Hafıza (tek kart yoksa bile 309/409 kodu)
  const memCode = String(memoryAccountCode || "").trim();
  if (!card && memCode && is309or409(memCode)) {
    const ok =
      !companyPlans?.length || planHasAccount(companyPlans, memCode);
    return {
      ...empty,
      isCreditCardPayment: true,
      classification: CREDIT_CARD_CLASSIFICATION,
      accountCode: ok ? memCode : "",
      suggestedAccountCode: memCode,
      lastFourDigits,
      matchReason: "memory",
      confidence: ok ? 85 : 50,
      confidenceLabel: ok ? "Yüksek (hafıza)" : "Hafıza — planda yok",
      warning: ok ? "" : `${memCode} hesap planında yok.`,
      periodMonth: resolveCreditCardStatementPeriod({
        paymentDate,
        description,
      }).month,
      periodYear: resolveCreditCardStatementPeriod({
        paymentDate,
        description,
      }).year,
    };
  }

  if (!card) {
    const period = resolveCreditCardStatementPeriod({
      paymentDate,
      description,
    });
    // Plan’da son 4 geçen 309/409 önerisi (otomatik değil)
    const planHints = (companyPlans || [])
      .filter((row) => row?.isActive !== false)
      .map((row) => ({
        code: String(row.accountCode || row.hesapKodu || "").trim(),
        name: String(row.accountName || row.hesapAdi || "").trim(),
      }))
      .filter(
        (r) =>
          is309or409(r.code) &&
          lastFourDigits &&
          (r.name.includes(lastFourDigits) || r.code.includes(lastFourDigits))
      )
      .slice(0, 5);

    return {
      ...empty,
      isCreditCardPayment: true,
      classification: CREDIT_CARD_CLASSIFICATION,
      lastFourDigits,
      periodMonth: period.month,
      periodYear: period.year,
      periodSource: period.source,
      matchReason: lastFourDigits ? "last4_no_card" : "keyword_only",
      confidence: 20,
      confidenceLabel: "Düşük",
      warning: CREDIT_CARD_MISSING_LABEL,
      planHints,
    };
  }

  const resolved = getCreditCardAccount({
    creditCard: card,
    paymentDate,
    installmentYearShift,
    description,
    companyPlans,
  });

  const accountCode = String(resolved.accountCode || "").trim();
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
  const confidence = accountCode
    ? periodKey !== "belirsiz"
      ? 90
      : 75
    : resolved.ambiguous
      ? 40
      : 35;

  return {
    isCreditCardPayment: true,
    classification: CREDIT_CARD_CLASSIFICATION,
    creditCard: card,
    matches: [card],
    ambiguous: Boolean(resolved.ambiguous),
    accountCode: resolved.ambiguous ? "" : accountCode,
    suggestedAccountCode:
      resolved.suggestedAccountCode || accountCode || "",
    periodMonth: resolved.periodMonth,
    periodYear: resolved.periodYear,
    periodSource: resolved.periodSource || "",
    periodKey,
    matchReason: resolved.matchReason || "company_card",
    confidence,
    confidenceLabel: resolved.ambiguous
      ? "Belirsiz — birden fazla hesap"
      : accountCode
        ? confidence >= 85
          ? "Yüksek"
          : "Orta"
        : "Hesap seçilmeli",
    warning: resolved.warning || (!accountCode ? CREDIT_CARD_MISSING_LABEL : ""),
    lastFourDigits:
      lastFourDigits || String(card.lastFourDigits || "").trim(),
    bankName: card.bankName || "",
    cardName: card.cardName || "",
    trackingMethod: card.trackingMethod || "",
    candidates: resolved.candidates || [],
  };
}

export function buildCreditCardPaymentDescription({
  creditCard,
  paymentDate,
  rawDescription = "",
}) {
  const lastFour = String(creditCard?.lastFourDigits || "").trim();
  const prefix = lastFour ? `**${lastFour}` : "**";

  // Yalnız açıklamadaki kesin ekstre dönemi — ödeme tarihinden tahmini ay yazma
  const fromText = extractStatementPeriodFromText(rawDescription);
  if (fromText?.month) {
    const date = parseFlexibleDate(paymentDate);
    const year = fromText.year || date?.getFullYear() || null;
    if (year) {
      return `${prefix} ${MONTH_NAMES[fromText.month - 1]} ${year} EKSTRESİ ÖDEMESİ`;
    }
    return `${prefix} ${MONTH_NAMES[fromText.month - 1]} EKSTRESİ ÖDEMESİ`;
  }
  return `${prefix} EKSTRESİ ÖDEMESİ`;
}

export function isCreditCardAccountCode(code = "") {
  return is309or409(code);
}

export function buildCreditCardGroupKey({
  companyId = "",
  bankName = "",
  lastFourDigits = "",
  statementPeriodKey = "belirsiz",
  direction = "",
  transactionType = "",
} = {}) {
  return [
    companyId || "-",
    normalizeBankHint(bankName) || "-",
    String(lastFourDigits || "").trim() || "-",
    String(statementPeriodKey || "belirsiz").trim() || "belirsiz",
    String(direction || "").toUpperCase() || "-",
    String(transactionType || "") || "-",
  ].join("|");
}
