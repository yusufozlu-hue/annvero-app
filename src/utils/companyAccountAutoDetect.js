/**
 * Firma hesap planı otomatik tarama + aday skorlama + bootstrap.
 * Parser / analysisKey / Luca / performans mimarisine dokunmaz.
 */

import { normalizeParserText } from "@/src/utils/textNormalize";

/** Senaryo id'leri — bankAccountingScenarioEngine ile uyumlu stringler */
export const DETECT_SCENARIO = {
  CEK_ODEMESI: "CEK_ODEMESI",
  CEK_TAHSILATI: "CEK_TAHSILATI",
  KASA_BANKAYA_YATAN: "KASA_BANKAYA_YATAN",
  BANKADAN_KASAYA_CEKILEN: "BANKADAN_KASAYA_CEKILEN",
  POS_TAHSILAT: "POS_TAHSILAT",
  POS_BATCH_TAHSILAT: "POS_BATCH_TAHSILAT",
  KREDI_KARTI: "KREDI_KARTI",
  VERGI_SGK: "VERGI_SGK",
  BANKA_ICI_VIRMAN: "BANKA_ICI_VIRMAN",
};

export const ACCOUNT_GROUP = {
  KASA_100: "100",
  CEK_101: "101",
  BANKA_102: "102",
  CEK_103: "103",
  POS_108: "108",
  KK_309: "309",
  VERGI_360: "360",
  SGK_361: "361",
};

export const MAPPING_STATUS = {
  AUTO_APPLIED: "AUTO_APPLIED",
  NEEDS_APPROVAL: "NEEDS_APPROVAL",
  MISSING: "MISSING",
  CONFLICT: "CONFLICT",
  APPROVED: "APPROVED",
  PASSIVE: "PASSIVE",
};

export const CONFIDENCE_AUTO = 90;
export const CONFIDENCE_ASK_MIN = 70;

const BANK_TOKENS = [
  "VAKIFBANK",
  "VAKIF",
  "GARANTI",
  "DENIZBANK",
  "DENIZ",
  "KUVEYTTURK",
  "KUVEYT",
  "AKBANK",
  "ZIRAAT",
  "ISBANK",
  "TEB",
  "SEKERBANK",
  "SEKER",
  "EXIMBANK",
  "EXIM",
  "HALKBANK",
  "YAPIKREDI",
  "YKB",
];

function compactCode(code = "") {
  return String(code || "")
    .trim()
    .replace(/\s+/g, "");
}

function getCode(row = {}) {
  return compactCode(row.accountCode || row.hesapKodu || row.kod || row.code || "");
}

function getName(row = {}) {
  return String(row.accountName || row.hesapAdi || row.name || row.ad || "").trim();
}

function uniqueTokens(text = "") {
  const norm = normalizeParserText(text);
  if (!norm) return [];
  return [...new Set(norm.split(/\s+/).filter((t) => t.length >= 2))];
}

function detectCurrency(text = "") {
  const t = normalizeParserText(text);
  if (/\b(USD|DOLAR|\$)\b/.test(t)) return "USD";
  if (/\b(EUR|EURO)\b/.test(t)) return "EUR";
  if (/\b(GBP|STERLIN)\b/.test(t)) return "GBP";
  return "TL";
}

function detectBankName(text = "") {
  const t = normalizeParserText(text);
  for (const token of BANK_TOKENS) {
    if (t.includes(token)) {
      if (token.startsWith("VAKIF")) return "VAKIFBANK";
      if (token.startsWith("DENIZ")) return "DENIZBANK";
      if (token.startsWith("KUVEYT")) return "KUVEYTTURK";
      if (token.startsWith("SEKER")) return "SEKERBANK";
      if (token.startsWith("EXIM")) return "EXIMBANK";
      if (token === "YKB" || token === "YAPIKREDI") return "YAPIKREDI";
      return token;
    }
  }
  return "";
}

function extractIban(text = "") {
  const match = String(text || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .match(/TR\d{24}/);
  return match ? match[0] : "";
}

function extractAccountNumberHints(text = "") {
  const compact = String(text || "").replace(/\s+/g, "");
  const hints = new Set();
  const spaced = String(text || "");
  // 8449, 428449, long digit runs
  for (const m of compact.match(/\d{6,}/g) || []) hints.add(m);
  for (const m of spaced.match(/\b\d{4,}\b/g) || []) {
    if (m.length >= 4 && m.length <= 16) hints.add(m);
  }
  return [...hints];
}

function extractCardLast4(text = "") {
  const stars = String(text || "").match(/\*{2,}(\d{4})\b/);
  if (stars) return stars[1];
  const name = normalizeParserText(text);
  const kk =
    name.match(/\bKK\b.*?(\d{4})\b/) ||
    name.match(/\b(\d{4})\b.*\bKK\b/) ||
    name.match(/\bKK\s+(\d{4})\b/);
  if (kk) return kk[1];
  // "KREDI KARTI 4682" / "4682 NOLU ... KARTI" / "K. KARTI"
  const karti =
    name.match(/\bKARTI\b.*?(\d{4})\b/) ||
    name.match(/\b(\d{4})\b.{0,24}\bK\.?\s*KARTI\b/) ||
    name.match(/\b(\d{4})\b\s+NOLU\b/) ||
    name.match(/\bKREDI\s+KARTI\b.*?(\d{4})\b/);
  return karti ? karti[1] : "";
}

function extractPosHints(text = "") {
  const raw = String(text || "");
  const merchantNos = [];
  const posNos = [];
  // 57700001130449 style
  for (const m of raw.match(/\b\d{10,14}\b/g) || []) {
    if (m.startsWith("577") || m.length >= 12) merchantNos.push(m);
  }
  // POS terminal like 01670904
  for (const m of raw.match(/\b0?\d{7,8}\b/g) || []) {
    if (!merchantNos.includes(m)) posNos.push(m);
  }
  return {
    merchantNos: [...new Set(merchantNos)],
    posNos: [...new Set(posNos)],
  };
}

/**
 * Tek hesap planı satırını zenginleştirilmiş profile çevir.
 */
export function enrichAccountPlanRow(row = {}) {
  const accountCode = getCode(row);
  const accountName = getName(row);
  const combined = `${accountCode} ${accountName}`;
  const normName = normalizeParserText(accountName);
  const main = accountCode.split(".")[0]?.slice(0, 3) || "";
  const iban = extractIban(combined);
  const accountNoHints = extractAccountNumberHints(accountName);
  const cardLast4 = extractCardLast4(accountName);
  const pos = extractPosHints(accountName);
  const bankName = detectBankName(accountName);
  const currency = detectCurrency(accountName);
  const tokens = uniqueTokens(accountName);

  let cashName = "";
  if (main === "100") {
    if (tokens.includes("BEACH")) cashName = "BEACH";
    else if (tokens.includes("OTEL")) cashName = "OTEL";
    else if (tokens.includes("RESTAURANT") || tokens.includes("RESTORAN")) {
      cashName = "RESTAURANT";
    } else if (tokens.includes("ONBURO") || tokens.includes("ONBURO")) {
      cashName = "ONBURO";
    } else if (tokens.includes("MERKEZ")) cashName = "MERKEZ";
    else if (tokens.includes("MUHASEBE")) cashName = "MUHASEBE";
  }

  let taxSgkSubtype = "";
  if (main === "361") {
    if (normName.includes("SGDP")) taxSgkSubtype = "SGDP";
    else if (normName.includes("ISSIZLIK")) taxSgkSubtype = "ISSIZLIK";
    else if (normName.includes("RESTAURANT")) taxSgkSubtype = "SGK_RESTAURANT";
    else if (normName.includes("SGK")) taxSgkSubtype = "SGK";
  } else if (main === "360") {
    if (normName.includes("KDV")) taxSgkSubtype = "KDV";
    else taxSgkSubtype = "VERGI";
  }

  return {
    accountCode,
    accountName,
    mainGroup: main,
    currency,
    bankName,
    branch: tokens.find((t) => t.includes("SUBE") || t.includes("SB")) || "",
    iban,
    accountNoHints,
    cashName,
    posMerchantNos: pos.merchantNos,
    posNos: pos.posNos,
    cardLast4,
    taxSgkSubtype,
    tokens,
    isActive: row.isActive !== false,
    raw: row,
  };
}

/**
 * Firma kaydı + hesap planı taramasından ekstre/eşleme sinyalleri üret.
 * MARE sabitleri yalnız eksik alanlarda yedek olarak kullanılabilir.
 */
export function buildDetectSignalsFromCompany(company = {}, scan = null) {
  const banks = company.bankAccounts || [];
  const primary = banks.find((b) => b.isActive !== false) || banks[0] || {};
  const planBanks = (scan?.byGroup?.[ACCOUNT_GROUP.BANKA_102] || [])
    .map((p) => p.bankName)
    .filter(Boolean);
  const bankName =
    primary.bankName ||
    company.bankName ||
    planBanks[0] ||
    "";
  const cards = (company.creditCards || [])
    .filter((c) => c.isActive !== false && c.lastFourDigits)
    .map((c) => String(c.lastFourDigits).slice(-4));
  const planCards = (scan?.byGroup?.[ACCOUNT_GROUP.KK_309] || [])
    .map((p) => p.cardLast4)
    .filter(Boolean);
  const posRows = company.posMerchantAccounts || [];
  const posMerchantNo =
    posRows.find((p) => p.merchantNo)?.merchantNo ||
    (scan?.byGroup?.[ACCOUNT_GROUP.POS_108] || [])
      .flatMap((p) => p.posMerchantNos || [])
      .find(Boolean) ||
    "";
  const posNo =
    posRows.find((p) => p.posNo)?.posNo ||
    (scan?.byGroup?.[ACCOUNT_GROUP.POS_108] || [])
      .flatMap((p) => p.posNos || [])
      .find(Boolean) ||
    "";

  return {
    bankName: String(bankName || "").trim(),
    iban: String(primary.iban || "").replace(/\s+/g, "").toUpperCase(),
    accountNumber: String(primary.accountNumber || "").replace(/\s+/g, ""),
    posMerchantNo: String(posMerchantNo || ""),
    posNo: String(posNo || ""),
    cardLast4List: [...new Set([...cards, ...planCards])],
  };
}

/**
 * Hesap planını gruplara ayırarak tara.
 */
export function scanCompanyAccountPlan(accountPlan = []) {
  const profiles = (accountPlan || [])
    .map(enrichAccountPlanRow)
    .filter((p) => p.accountCode && p.isActive !== false);

  const byGroup = {
    [ACCOUNT_GROUP.KASA_100]: [],
    [ACCOUNT_GROUP.CEK_101]: [],
    [ACCOUNT_GROUP.BANKA_102]: [],
    [ACCOUNT_GROUP.CEK_103]: [],
    [ACCOUNT_GROUP.POS_108]: [],
    [ACCOUNT_GROUP.KK_309]: [],
    [ACCOUNT_GROUP.VERGI_360]: [],
    [ACCOUNT_GROUP.SGK_361]: [],
  };

  for (const profile of profiles) {
    if (byGroup[profile.mainGroup]) {
      byGroup[profile.mainGroup].push(profile);
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    totalAccounts: profiles.length,
    profiles,
    byGroup,
  };
}

function scoreCandidate(profile, signals = {}) {
  let score = 0;
  const reasons = [];
  const usedSignals = [];

  if (signals.iban && profile.iban && signals.iban === profile.iban) {
    score = Math.max(score, 100);
    reasons.push("exact IBAN");
    usedSignals.push(`iban:${signals.iban}`);
  }

  if (signals.accountNumber) {
    const sigDigits = String(signals.accountNumber).replace(/\D/g, "");
    const nameDigits = String(profile.accountName || "").replace(/\D/g, "");
    const sigTail = sigDigits.length >= 10 ? sigDigits.slice(-10) : sigDigits;
    const exactNo =
      sigDigits.length >= 8 &&
      ((sigTail.length >= 10 && nameDigits.includes(sigTail)) ||
        (nameDigits.length >= 10 &&
          (sigDigits.includes(nameDigits) || nameDigits.includes(sigDigits))) ||
        profile.accountNoHints.some((h) => {
          const hd = String(h).replace(/\D/g, "");
          return (
            hd.length >= 10 &&
            (sigDigits.includes(hd) ||
              hd.includes(sigTail) ||
              nameDigits.includes(hd))
          );
        }));
    if (exactNo) {
      score = Math.max(score, 100);
      reasons.push("exact hesap no");
      usedSignals.push(`accountNo:${sigTail || sigDigits}`);
    }
  }

  if (signals.cardLast4 && profile.cardLast4 === signals.cardLast4) {
    score = Math.max(score, 100);
    reasons.push("exact kart son 4");
    usedSignals.push(`cardLast4:${signals.cardLast4}`);
  }

  if (signals.posMerchantNo) {
    const m = String(signals.posMerchantNo);
    if (profile.posMerchantNos.includes(m) || profile.tokens.some((t) => t.includes(m))) {
      score = Math.max(score, 100);
      reasons.push("exact POS işyeri");
      usedSignals.push(`merchant:${m}`);
    }
  }

  if (signals.posNo) {
    const p = String(signals.posNo);
    if (profile.posNos.includes(p) || profile.accountName.includes(p)) {
      score = Math.max(score, 100);
      reasons.push("exact POS no");
      usedSignals.push(`pos:${p}`);
    }
  }

  if (signals.bankName && profile.bankName) {
    const sigBank = normalizeParserText(signals.bankName);
    const profBank = normalizeParserText(profile.bankName);
    if (sigBank && profBank && (sigBank.includes(profBank) || profBank.includes(sigBank))) {
      score = Math.max(score, score >= 95 ? score : 95);
      reasons.push("banka adı exact");
      usedSignals.push(`bank:${profile.bankName}`);
    }
  }

  if (signals.aliasTokens?.length) {
    const hits = signals.aliasTokens.filter((tok) =>
      profile.tokens.includes(normalizeParserText(tok))
    );
    if (hits.length >= 2) {
      score = Math.max(score, 92);
      reasons.push(`güçlü alias: ${hits.join("+")}`);
      usedSignals.push(...hits.map((h) => `alias:${h}`));
    } else if (hits.length === 1) {
      score = Math.max(score, 88);
      reasons.push(`alias: ${hits[0]}`);
      usedSignals.push(`alias:${hits[0]}`);
    }
  }

  if (signals.cashName && profile.cashName === signals.cashName) {
    score = Math.max(score, 94);
    reasons.push(`kasa adı: ${signals.cashName}`);
    usedSignals.push(`cash:${signals.cashName}`);
  }

  if (signals.taxSgkSubtype && profile.taxSgkSubtype === signals.taxSgkSubtype) {
    score = Math.max(score, 93);
    reasons.push(`SGK/vergi türü: ${signals.taxSgkSubtype}`);
    usedSignals.push(`tax:${signals.taxSgkSubtype}`);
  }

  if (signals.currency && profile.currency === signals.currency) {
    score = Math.max(score, Math.min(score + 3, 98));
    usedSignals.push(`fx:${signals.currency}`);
  }

  return {
    score,
    reasons,
    usedSignals: [...new Set(usedSignals)],
  };
}

function hasExactIdReason(candidate = {}) {
  return (candidate.reasons || []).some(
    (r) =>
      String(r).includes("exact IBAN") ||
      String(r).includes("exact hesap no") ||
      String(r).includes("exact kart") ||
      String(r).includes("exact POS")
  );
}

function accountDepth(code = "") {
  return String(code || "").split(".").filter(Boolean).length;
}

/** Aynı skorda daha spesifik (yaprak) hesabı tercih et. */
function pickPreferredCandidate(candidates = []) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    const depthDiff = accountDepth(b.accountCode) - accountDepth(a.accountCode);
    if (depthDiff !== 0) return depthDiff;
    // KK: 309.01 ana borç, 309.02 ayrıntı/taksit eğilimli
    const a01 = String(a.accountCode).startsWith("309.01") ? 1 : 0;
    const b01 = String(b.accountCode).startsWith("309.01") ? 1 : 0;
    if (a01 !== b01) return b01 - a01;
    // TL tercih (USD/EUR kart ayrı)
    const aFx = /USD|EUR|GBP/.test(normalizeParserText(a.accountName || "")) ? 0 : 1;
    const bFx = /USD|EUR|GBP/.test(normalizeParserText(b.accountName || "")) ? 0 : 1;
    if (aFx !== bFx) return bFx - aFx;
    // SGK: daha uzun/spesifik kod
    const aLeaf = accountDepth(a.accountCode) >= 3 ? 1 : 0;
    const bLeaf = accountDepth(b.accountCode) >= 3 ? 1 : 0;
    if (aLeaf !== bLeaf) return bLeaf - aLeaf;
    return String(a.accountCode).localeCompare(String(b.accountCode));
  });
  return sorted[0];
}

function finalizeCandidates(candidates, { singleBoost = true } = {}) {
  // Exact ID (IBAN/hesap no/kart/POS) varsa yalnız onlar üst havuzda yarışır
  const exactOnly = candidates.filter(hasExactIdReason);
  let sorted = [...(exactOnly.length > 0 ? exactOnly : candidates)].sort(
    (a, b) => b.confidence - a.confidence
  );
  if (sorted.length === 1 && singleBoost) {
    sorted[0] = {
      ...sorted[0],
      confidence: Math.max(sorted[0].confidence, 85),
      reasons: [...(sorted[0].reasons || []), "tek hesap adayı"].filter(
        (v, i, arr) => arr.indexOf(v) === i
      ),
    };
    return sorted;
  }
  if (sorted.length >= 2) {
    const top = sorted[0].confidence;
    const second = sorted[1].confidence;
    const exactPool = sorted.filter(hasExactIdReason);
    if (exactPool.length === 1 && hasExactIdReason(sorted[0])) {
      // Tek exact ID kazananı otomatik kalsın
      return sorted;
    }
    if (exactPool.length >= 2) {
      const preferred = pickPreferredCandidate(exactPool);
      const preferredKey = preferred?.accountCode;
      const rivals = exactPool.filter((c) => c.accountCode !== preferredKey);
      const preferredClear =
        preferred &&
        !rivals.some((c) => {
          const sameGroup =
            String(c.accountCode).slice(0, 6) ===
            String(preferred.accountCode).slice(0, 6);
          const sameFxTier =
            /USD|EUR|GBP/.test(normalizeParserText(c.accountName || "")) ===
            /USD|EUR|GBP/.test(normalizeParserText(preferred.accountName || ""));
          const sameDepth =
            accountDepth(c.accountCode) === accountDepth(preferred.accountCode);
          // Aynı grup + aynı döviz + aynı derinlik → belirsiz
          return sameGroup && sameFxTier && sameDepth;
        });
      if (preferred && preferredClear) {
        sorted = sorted.map((c) => {
          if (c.accountCode === preferredKey) {
            return {
              ...c,
              confidence: Math.max(c.confidence, 100),
              reasons: [...(c.reasons || []), "exact tercih (yaprak/ana hesap)"].filter(
                (v, i, arr) => arr.indexOf(v) === i
              ),
            };
          }
          if (hasExactIdReason(c)) {
            return {
              ...c,
              confidence: Math.min(c.confidence, 79),
              reasons: [...(c.reasons || []), "birden fazla exact aday"],
            };
          }
          return c;
        });
        return sorted.sort((a, b) => b.confidence - a.confidence);
      }
      // Net tercih yok → onay
      for (const c of sorted) {
        if (c.confidence >= top - 5) {
          c.confidence = Math.min(c.confidence, 79);
          c.reasons = [...(c.reasons || []), "birden fazla benzer aday"];
        }
      }
      return sorted.sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return accountDepth(b.accountCode) - accountDepth(a.accountCode);
      });
    }

    // Exact olmayan yakın skorlar: tek en derin yaprak varsa onu öne al
    if (Math.abs(top - second) <= 5 && top >= 70) {
      const near = sorted.filter((c) => c.confidence >= top - 5);
      const maxDepth = Math.max(...near.map((c) => accountDepth(c.accountCode)));
      const deepest = near.filter((c) => accountDepth(c.accountCode) === maxDepth);
      if (deepest.length === 1 && maxDepth >= 3) {
        const winner = deepest[0].accountCode;
        sorted = sorted.map((c) =>
          c.accountCode === winner
            ? {
                ...c,
                confidence: Math.max(c.confidence, 91),
                reasons: [...(c.reasons || []), "yaprak hesap tercihi"],
              }
            : {
                ...c,
                confidence: Math.min(c.confidence, 79),
                reasons: [...(c.reasons || []), "üst hesap / benzer aday"],
              }
        );
        return sorted.sort((a, b) => b.confidence - a.confidence);
      }
      for (const c of sorted) {
        if (c.confidence >= top - 5) {
          c.confidence = Math.min(c.confidence, 79);
          c.reasons = [...(c.reasons || []), "birden fazla benzer aday"];
        }
      }
    }
  }
  return sorted.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return accountDepth(b.accountCode) - accountDepth(a.accountCode);
  });
}

function statusFromConfidence(confidence, candidateCount) {
  if (!candidateCount || confidence <= 0) return MAPPING_STATUS.MISSING;
  if (confidence >= CONFIDENCE_AUTO) return MAPPING_STATUS.AUTO_APPLIED;
  if (confidence >= CONFIDENCE_ASK_MIN) return MAPPING_STATUS.NEEDS_APPROVAL;
  if (candidateCount > 1) return MAPPING_STATUS.CONFLICT;
  return MAPPING_STATUS.MISSING;
}

function buildMappingResult({
  scenarioType,
  label,
  candidates,
  signals = {},
}) {
  const ranked = finalizeCandidates(candidates);
  const best = ranked[0] || null;
  const confidence = best?.confidence || 0;
  const status = statusFromConfidence(confidence, ranked.length);
  return {
    id: `${scenarioType}:${best?.accountCode || "none"}:${label || "default"}`,
    scenarioType,
    label,
    recommendedAccountCode: best?.accountCode || "",
    recommendedAccountName: best?.accountName || "",
    confidence,
    status,
    reason: (best?.reasons || []).join("; ") || "eşleşme yok",
    usedSignals: best?.usedSignals || [],
    candidates: ranked.slice(0, 5).map((c) => ({
      accountCode: c.accountCode,
      accountName: c.accountName,
      confidence: c.confidence,
      reasons: c.reasons,
    })),
    signals,
    source: status === MAPPING_STATUS.AUTO_APPLIED ? "auto" : "suggest",
    approvedByUser: false,
  };
}

/**
 * Senaryo bazlı aday üretimi (hesap planı + opsiyonel ekstre sinyalleri).
 */
export function generateScenarioCandidates(scan, signals = {}) {
  const byGroup = scan.byGroup || {};
  const results = [];

  // --- KASA ---
  const cashPool = byGroup[ACCOUNT_GROUP.KASA_100] || [];
  const cashSignalSets = [
    { cashName: "BEACH", aliasTokens: ["BEACH", "KASA"], label: "BEACH KASA" },
    { cashName: "OTEL", aliasTokens: ["OTEL", "KASA"], label: "OTEL KASA" },
    { cashName: "MERKEZ", aliasTokens: ["MERKEZ", "KASA"], label: "MERKEZ KASA" },
  ];
  for (const set of cashSignalSets) {
    const candidates = cashPool
      .filter((p) => p.currency === "TL" || !set.cashName)
      .map((p) => {
        const scored = scoreCandidate(p, {
          ...signals,
          cashName: set.cashName,
          aliasTokens: set.aliasTokens,
          currency: "TL",
        });
        return {
          accountCode: p.accountCode,
          accountName: p.accountName,
          confidence: scored.score,
          reasons: scored.reasons,
          usedSignals: scored.usedSignals,
        };
      })
      .filter((c) => c.confidence > 0);
    results.push(
      buildMappingResult({
        scenarioType: DETECT_SCENARIO.KASA_BANKAYA_YATAN,
        label: set.label,
        candidates,
        signals: set,
      })
    );
  }
  // Tek TL kasa fallback
  const tlCash = cashPool.filter((p) => p.currency === "TL");
  if (tlCash.length === 1) {
    results.push(
      buildMappingResult({
        scenarioType: DETECT_SCENARIO.KASA_BANKAYA_YATAN,
        label: "TEK TL KASA",
        candidates: [
          {
            accountCode: tlCash[0].accountCode,
            accountName: tlCash[0].accountName,
            confidence: 85,
            reasons: ["tek TL kasa"],
            usedSignals: ["single:100"],
          },
        ],
      })
    );
  }

  // --- 101 ---
  const cek101 = byGroup[ACCOUNT_GROUP.CEK_101] || [];
  results.push(
    buildMappingResult({
      scenarioType: DETECT_SCENARIO.CEK_TAHSILATI,
      label: "ALINAN CEKLER",
      candidates: cek101.map((p) => {
        const scored = scoreCandidate(p, {
          aliasTokens: ["ALINAN", "CEK"],
        });
        return {
          accountCode: p.accountCode,
          accountName: p.accountName,
          confidence: Math.max(scored.score, cek101.length === 1 ? 85 : scored.score),
          reasons:
            scored.reasons.length > 0
              ? scored.reasons
              : cek101.length === 1
                ? ["tek 101 hesabı"]
                : [],
          usedSignals: scored.usedSignals,
        };
      }),
    })
  );

  // --- 103 banka bazlı ---
  const cek103 = byGroup[ACCOUNT_GROUP.CEK_103] || [];
  const banksFromPlan103 = cek103.map((p) => p.bankName).filter(Boolean);
  const banksFor103 = [
    ...(signals.bankName ? [signals.bankName] : []),
    ...banksFromPlan103,
  ];
  const uniqueBanks = [
    ...new Set(banksFor103.map((b) => normalizeParserText(b)).filter(Boolean)),
  ];
  // Tek 103 ve banka sinyali yoksa genel aday
  if (uniqueBanks.length === 0 && cek103.length > 0) {
    uniqueBanks.push("");
  }
  for (const bank of uniqueBanks) {
    const candidates = cek103.map((p) => {
      const scored = scoreCandidate(p, {
        bankName: bank,
        aliasTokens: ["VERILEN", "CEK", bank],
      });
      return {
        accountCode: p.accountCode,
        accountName: p.accountName,
        confidence: scored.score,
        reasons: scored.reasons,
        usedSignals: scored.usedSignals,
      };
    }).filter((c) => c.confidence > 0);
    results.push(
      buildMappingResult({
        scenarioType: DETECT_SCENARIO.CEK_ODEMESI,
        label: bank ? `VERILEN CEK ${bank}` : "VERILEN CEKLER",
        candidates:
          candidates.length > 0
            ? candidates
            : cek103.length === 1
              ? [
                  {
                    accountCode: cek103[0].accountCode,
                    accountName: cek103[0].accountName,
                    confidence: 85,
                    reasons: ["tek 103 hesabı"],
                    usedSignals: ["single:103"],
                  },
                ]
              : [],
        signals: { bankName: bank },
      })
    );
  }

  // --- 102 banka ---
  const bank102 = byGroup[ACCOUNT_GROUP.BANKA_102] || [];
  const bankSignals = [
    {
      bankName: signals.bankName || "",
      iban: signals.iban || "",
      accountNumber: signals.accountNumber || "",
      label: signals.bankName
        ? `ANA BANKA ${normalizeParserText(signals.bankName)}`
        : "ANA BANKA HESABI",
    },
  ];
  for (const sig of bankSignals) {
    const candidates = bank102
      .map((p) => {
        const scored = scoreCandidate(p, {
          bankName: sig.bankName,
          iban: sig.iban,
          accountNumber: sig.accountNumber,
          currency: "TL",
          aliasTokens: sig.bankName ? [sig.bankName] : [],
        });
        return {
          accountCode: p.accountCode,
          accountName: p.accountName,
          confidence: scored.score,
          reasons: scored.reasons,
          usedSignals: scored.usedSignals,
        };
      })
      .filter((c) => {
        if (c.confidence <= 0) return false;
        // Yalnız TL alias / currency ile ana banka seçme
        const strong = (c.reasons || []).some(
          (r) =>
            String(r).includes("exact") ||
            String(r).includes("banka adı") ||
            String(r).includes("güçlü alias") ||
            String(r).includes(`alias: ${normalizeParserText(sig.bankName)}`)
        );
        return strong;
      });
    results.push(
      buildMappingResult({
        scenarioType: "BANKA_102",
        label: sig.label,
        candidates,
        signals: sig,
      })
    );
  }

  // --- POS 108 ---
  const pos108 = byGroup[ACCOUNT_GROUP.POS_108] || [];
  const posAlias = ["POS"];
  if (signals.bankName) posAlias.push(normalizeParserText(signals.bankName));
  const posCandidates = pos108
    .map((p) => {
      const scored = scoreCandidate(p, {
        bankName: signals.bankName || "",
        posMerchantNo: signals.posMerchantNo || "",
        posNo: signals.posNo || "",
        aliasTokens: posAlias,
      });
      return {
        accountCode: p.accountCode,
        accountName: p.accountName,
        confidence: scored.score,
        reasons: scored.reasons,
        usedSignals: scored.usedSignals,
      };
    })
    .filter((c) => {
      if (c.confidence <= 0) return false;
      if (!signals.bankName && !signals.posMerchantNo && !signals.posNo) {
        return true;
      }
      return (c.reasons || []).some(
        (r) =>
          String(r).includes("exact POS") ||
          String(r).includes("banka adı") ||
          String(r).includes(`alias: ${normalizeParserText(signals.bankName)}`)
      );
    });
  results.push(
    buildMappingResult({
      scenarioType: DETECT_SCENARIO.POS_TAHSILAT,
      label: "POS TAHSILAT",
      candidates: posCandidates,
      signals: {
        bankName: signals.bankName || "",
        posMerchantNo: signals.posMerchantNo || "",
        posNo: signals.posNo || "",
      },
    })
  );

  // --- KK 309 ---
  const kk309 = byGroup[ACCOUNT_GROUP.KK_309] || [];
  const cardLast4List =
    signals.cardLast4List?.length
      ? signals.cardLast4List
      : signals.cardLast4
        ? [signals.cardLast4]
        : [...new Set(kk309.map((p) => p.cardLast4).filter(Boolean))];
  for (const last4 of cardLast4List) {
    const candidates = kk309
      .filter(
        (p) =>
          p.cardLast4 === last4 ||
          String(p.accountName || "").includes(last4)
      )
      .map((p) => {
        const scored = scoreCandidate(p, {
          cardLast4: last4,
        });
        return {
          accountCode: p.accountCode,
          accountName: p.accountName,
          confidence: scored.score,
          reasons: scored.reasons,
          usedSignals: scored.usedSignals,
        };
      })
      .filter((c) => c.confidence > 0);
    results.push(
      buildMappingResult({
        scenarioType: DETECT_SCENARIO.KREDI_KARTI,
        label: `KK ${last4}`,
        candidates,
        signals: { cardLast4: last4 },
      })
    );
  }

  // --- SGK 361 ---
  const sgk361 = byGroup[ACCOUNT_GROUP.SGK_361] || [];
  for (const subtype of ["SGK", "SGDP", "ISSIZLIK"]) {
    const candidates = sgk361.map((p) => {
      const scored = scoreCandidate(p, { taxSgkSubtype: subtype, aliasTokens: [subtype] });
      return {
        accountCode: p.accountCode,
        accountName: p.accountName,
        confidence: scored.score,
        reasons: scored.reasons,
        usedSignals: scored.usedSignals,
      };
    }).filter((c) => c.confidence > 0);
    results.push(
      buildMappingResult({
        scenarioType: DETECT_SCENARIO.VERGI_SGK,
        label: subtype,
        candidates,
        signals: { taxSgkSubtype: subtype },
      })
    );
  }

  return results;
}

/**
 * Firma bootstrap: plan tara → skorla → otomatik/onay kuyruğu.
 */
export function bootstrapCompanyAccountMappings({
  accountPlan = [],
  signals = {},
  company = {},
  existingMappings = [],
} = {}) {
  const started = Date.now();
  const scan = scanCompanyAccountPlan(accountPlan);
  const derived = buildDetectSignalsFromCompany(company, scan);
  const mergedSignals = {
    ...derived,
    ...Object.fromEntries(
      Object.entries(signals || {}).filter(([, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== "" && v != null;
      })
    ),
  };
  const generated = generateScenarioCandidates(scan, mergedSignals);

  const approvedKeys = new Set(
    (existingMappings || [])
      .filter((m) => m.approvedByUser || m.status === MAPPING_STATUS.APPROVED)
      .map((m) => `${m.scenarioType}|${m.label}`)
  );

  const mappings = generated.map((m) => {
    const key = `${m.scenarioType}|${m.label}`;
    if (approvedKeys.has(key)) {
      const prev = existingMappings.find(
        (x) => x.scenarioType === m.scenarioType && x.label === m.label
      );
      return {
        ...m,
        ...prev,
        status: MAPPING_STATUS.APPROVED,
        approvedByUser: true,
        source: "user-approved",
      };
    }
    return m;
  });

  const summary = {
    autoApplied: mappings.filter((m) => m.status === MAPPING_STATUS.AUTO_APPLIED).length,
    needsApproval: mappings.filter((m) => m.status === MAPPING_STATUS.NEEDS_APPROVAL).length,
    missing: mappings.filter((m) => m.status === MAPPING_STATUS.MISSING).length,
    conflict: mappings.filter((m) => m.status === MAPPING_STATUS.CONFLICT).length,
    approved: mappings.filter((m) => m.status === MAPPING_STATUS.APPROVED).length,
    total: mappings.length,
    scannedAt: scan.scannedAt,
    elapsedMs: Date.now() - started,
    planAccountCount: scan.totalAccounts,
  };

  return { scan, mappings, summary };
}

/**
 * Onaylanan/otomatik eşlemeleri company record alanlarına uygula (UI + kalıcı kayıt).
 */
export function applyMappingsToCompanyFields(company = {}, mappings = []) {
  const next = {
    ...company,
    cashAccounts: [...(company.cashAccounts || [])],
    posMerchantAccounts: [...(company.posMerchantAccounts || [])],
    bankAccounts: [...(company.bankAccounts || [])],
    creditCards: [...(company.creditCards || [])],
    checkAccountMappings: {
      ...(company.checkAccountMappings || {
        receivedChecksAccount: "",
        givenChecksAccount: "",
        useMonthlyGivenChecks: true,
        bankGivenChecks: [],
      }),
    },
    taxSgkAccountMappings: {
      ...(company.taxSgkAccountMappings || {
        sgkMainAccount: "",
        sgdpAccount: "",
        unemploymentAccount: "",
        extraMappings: [],
      }),
    },
    accountMappingResults: mappings,
    accountMappingSummary: null,
  };

  const usable = mappings.filter(
    (m) =>
      m.recommendedAccountCode &&
      (m.status === MAPPING_STATUS.AUTO_APPLIED ||
        m.status === MAPPING_STATUS.APPROVED)
  );

  for (const m of usable) {
    if (m.scenarioType === DETECT_SCENARIO.KASA_BANKAYA_YATAN) {
      const aliases =
        m.label === "BEACH KASA"
          ? ["BEACH KASA", "TARİHLİ BEACH KASA"]
          : m.label === "OTEL KASA"
            ? ["OTEL KASA", "TARİHLİ OTEL KASA"]
            : [m.label];
      const exists = next.cashAccounts.some(
        (c) => c.lucaAccountCode === m.recommendedAccountCode
      );
      if (!exists) {
        next.cashAccounts.push({
          id: `auto-cash-${m.recommendedAccountCode}`,
          name: m.label,
          currency: "TL",
          lucaAccountCode: m.recommendedAccountCode,
          aliases,
          isActive: true,
          source: m.source,
        });
      }
    }

    if (m.scenarioType === DETECT_SCENARIO.CEK_TAHSILATI) {
      next.checkAccountMappings.receivedChecksAccount = m.recommendedAccountCode;
    }
    if (m.scenarioType === DETECT_SCENARIO.CEK_ODEMESI) {
      if (!next.checkAccountMappings.givenChecksAccount) {
        next.checkAccountMappings.givenChecksAccount = m.recommendedAccountCode;
      }
      const bankName = m.signals?.bankName || m.label.replace("VERILEN CEK ", "");
      const list = next.checkAccountMappings.bankGivenChecks || [];
      if (!list.some((b) => b.lucaAccountCode === m.recommendedAccountCode)) {
        list.push({
          id: `auto-cek-${m.recommendedAccountCode}`,
          bankName,
          lucaAccountCode: m.recommendedAccountCode,
        });
        next.checkAccountMappings.bankGivenChecks = list;
      }
    }

    if (m.scenarioType === "BANKA_102") {
      const exists = next.bankAccounts.some(
        (b) => b.lucaAccountCode === m.recommendedAccountCode
      );
      if (!exists) {
        next.bankAccounts.push({
          id: `auto-bank-${m.recommendedAccountCode}`,
          bankName: m.signals?.bankName || "VAKIFBANK",
          accountName: m.recommendedAccountName,
          iban: m.signals?.iban || "",
          accountNumber: m.signals?.accountNumber || "",
          currency: "TL",
          accountType: "VADESIZ",
          lucaAccountCode: m.recommendedAccountCode,
          isActive: true,
        });
      }
    }

    if (m.scenarioType === DETECT_SCENARIO.POS_TAHSILAT) {
      const exists = next.posMerchantAccounts.some(
        (p) => p.lucaAccountCode === m.recommendedAccountCode
      );
      if (!exists) {
        next.posMerchantAccounts.push({
          id: `auto-pos-${m.recommendedAccountCode}`,
          bankName: m.signals?.bankName || "VAKIFBANK",
          merchantNo: m.signals?.posMerchantNo || "",
          posNo: m.signals?.posNo || "",
          alias: m.label,
          lucaAccountCode: m.recommendedAccountCode,
          isActive: true,
        });
      }
    }

    if (m.scenarioType === DETECT_SCENARIO.KREDI_KARTI) {
      const last4 = m.signals?.cardLast4 || "";
      const exists = next.creditCards.some(
        (c) =>
          c.lastFourDigits === last4 ||
          c.lucaAccountCode === m.recommendedAccountCode
      );
      if (!exists && last4) {
        next.creditCards.push({
          id: `auto-kk-${last4}`,
          bankName: "VAKIFBANK",
          cardName: `KK ${last4}`,
          lastFourDigits: last4,
          currency: "TL",
          lucaAccountCode: m.recommendedAccountCode,
          singleLucaAccountCode: m.recommendedAccountCode,
          monthly309BaseAccountCode: m.recommendedAccountCode,
          isActive: true,
        });
      }
    }

    if (m.scenarioType === DETECT_SCENARIO.VERGI_SGK) {
      if (m.label === "SGK") {
        next.taxSgkAccountMappings.sgkMainAccount = m.recommendedAccountCode;
      } else if (m.label === "SGDP") {
        next.taxSgkAccountMappings.sgdpAccount = m.recommendedAccountCode;
      } else if (m.label === "ISSIZLIK") {
        next.taxSgkAccountMappings.unemploymentAccount = m.recommendedAccountCode;
      }
    }
  }

  return next;
}

/**
 * Karar motoru için: senaryo + sinyal → firma eşlemesinden hesap kodu.
 */
export function resolveMappedAccountFromCompany(company = {}, query = {}) {
  const scenarioType = String(query.scenarioType || "").trim();
  const mappings = company.accountMappingResults || [];
  const usable = mappings.filter(
    (m) =>
      m.recommendedAccountCode &&
      (m.status === MAPPING_STATUS.AUTO_APPLIED ||
        m.status === MAPPING_STATUS.APPROVED) &&
      m.status !== MAPPING_STATUS.PASSIVE
  );

  if (scenarioType === DETECT_SCENARIO.KASA_BANKAYA_YATAN ||
      scenarioType === DETECT_SCENARIO.BANKADAN_KASAYA_CEKILEN) {
    const desc = normalizeParserText(query.description || "");
    const cash = company.cashAccounts || [];
    for (const row of cash) {
      if (row.isActive === false) continue;
      const aliases = (row.aliases || []).map((a) => normalizeParserText(a));
      if (aliases.some((a) => a && desc.includes(a))) {
        return { accountCode: row.lucaAccountCode, source: "cashAccounts", confidence: 95 };
      }
    }
    const mapped = usable.find(
      (m) =>
        m.scenarioType === DETECT_SCENARIO.KASA_BANKAYA_YATAN &&
        ((desc.includes("BEACH") && m.label.includes("BEACH")) ||
          (desc.includes("OTEL") && m.label.includes("OTEL")))
    );
    if (mapped) {
      return {
        accountCode: mapped.recommendedAccountCode,
        source: "accountMappingResults",
        confidence: mapped.confidence,
      };
    }
  }

  if (scenarioType === DETECT_SCENARIO.CEK_ODEMESI) {
    const bank = normalizeParserText(query.bankName || "");
    const bankMap = company.checkAccountMappings?.bankGivenChecks || [];
    const hit = bankMap.find((b) =>
      normalizeParserText(b.bankName).includes(bank) || bank.includes(normalizeParserText(b.bankName))
    );
    if (hit?.lucaAccountCode) {
      return { accountCode: hit.lucaAccountCode, source: "checkAccountMappings", confidence: 95 };
    }
    if (company.checkAccountMappings?.givenChecksAccount) {
      return {
        accountCode: company.checkAccountMappings.givenChecksAccount,
        source: "checkAccountMappings",
        confidence: 85,
      };
    }
  }

  if (scenarioType === DETECT_SCENARIO.CEK_TAHSILATI) {
    if (company.checkAccountMappings?.receivedChecksAccount) {
      return {
        accountCode: company.checkAccountMappings.receivedChecksAccount,
        source: "checkAccountMappings",
        confidence: 90,
      };
    }
  }

  if (
    scenarioType === DETECT_SCENARIO.POS_TAHSILAT ||
    scenarioType === DETECT_SCENARIO.POS_BATCH_TAHSILAT
  ) {
    const desc = String(query.description || "");
    const posList = company.posMerchantAccounts || [];
    for (const row of posList) {
      if (row.isActive === false) continue;
      if (row.merchantNo && desc.includes(row.merchantNo)) {
        return { accountCode: row.lucaAccountCode, source: "posMerchantAccounts", confidence: 98 };
      }
      if (row.posNo && desc.includes(row.posNo)) {
        return { accountCode: row.lucaAccountCode, source: "posMerchantAccounts", confidence: 96 };
      }
    }
  }

  if (scenarioType === DETECT_SCENARIO.KREDI_KARTI) {
    const last4 = String(query.cardLast4 || "").slice(-4);
    const card = (company.creditCards || []).find(
      (c) => c.isActive !== false && c.lastFourDigits === last4
    );
    if (card?.lucaAccountCode || card?.singleLucaAccountCode) {
      return {
        accountCode: card.lucaAccountCode || card.singleLucaAccountCode,
        source: "creditCards",
        confidence: 98,
      };
    }
  }

  if (scenarioType === DETECT_SCENARIO.VERGI_SGK) {
    const subtype = normalizeParserText(query.taxSgkSubtype || query.description || "");
    if (subtype.includes("SGDP") && company.taxSgkAccountMappings?.sgdpAccount) {
      return {
        accountCode: company.taxSgkAccountMappings.sgdpAccount,
        source: "taxSgkAccountMappings",
        confidence: 95,
      };
    }
    if (subtype.includes("ISSIZLIK") && company.taxSgkAccountMappings?.unemploymentAccount) {
      return {
        accountCode: company.taxSgkAccountMappings.unemploymentAccount,
        source: "taxSgkAccountMappings",
        confidence: 95,
      };
    }
    if (company.taxSgkAccountMappings?.sgkMainAccount) {
      return {
        accountCode: company.taxSgkAccountMappings.sgkMainAccount,
        source: "taxSgkAccountMappings",
        confidence: 90,
      };
    }
  }

  const generic = usable.find((m) => m.scenarioType === scenarioType);
  if (generic) {
    return {
      accountCode: generic.recommendedAccountCode,
      source: "accountMappingResults",
      confidence: generic.confidence,
    };
  }

  return { accountCode: "", source: "", confidence: 0 };
}
