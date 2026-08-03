/**
 * Banka ekstresi ↔ aktif firma kimlik doğrulaması.
 * Ham ekstre satırı / IBAN / VKN loglanmaz; yalnız eşleşme kodları ve maskeli özet.
 */

import { getCompanyDisplayName } from "@/src/utils/companies";
import { buildOwnCompanyIdentity } from "@/src/utils/cariCounterpartyExtract";
import {
  digitsOnly,
  extractCompanyVkn,
  normalizeCompanyTitleKey,
} from "@/src/utils/companyIdentity";
import { normalizeCariNameCore } from "@/src/utils/cariAccountMatcher";

export const BANK_COMPANY_GUARD_CODE = Object.freeze({
  MATCH: "COMPANY_MATCH",
  MISMATCH: "COMPANY_MISMATCH",
  VERIFICATION_REQUIRED: "COMPANY_VERIFICATION_REQUIRED",
  EMPTY_ACCOUNT_PLAN: "EMPTY_ACCOUNT_PLAN",
});

const TITLE_NOISE = new Set([
  "AS",
  "A",
  "S",
  "LTD",
  "STI",
  "SAN",
  "TIC",
  "VE",
  "ANONIM",
  "SIRKETI",
  "SIRKET",
  "LIMITED",
]);

function compactIban(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeCore(value = "") {
  return normalizeCariNameCore(value || "");
}

function significantTokens(core = "") {
  return String(core || "")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !TITLE_NOISE.has(t));
}

function coresOverlapStrong(a = "", b = "") {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))) {
    return true;
  }
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const setB = new Set(tb);
  const hit = ta.filter((t) => setB.has(t)).length;
  return hit >= Math.min(2, ta.length) && hit / Math.max(ta.length, tb.length) >= 0.6;
}

function coresClearlyDifferent(a = "", b = "") {
  if (!a || !b) return false;
  if (coresOverlapStrong(a, b)) return false;
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const setB = new Set(tb);
  const hit = ta.filter((t) => setB.has(t)).length;
  return hit === 0;
}

function flattenSheetText(sheetRows = [], maxRows = 40) {
  const lines = [];
  for (let i = 0; i < Math.min(sheetRows.length, maxRows); i += 1) {
    const row = sheetRows[i];
    if (!Array.isArray(row)) continue;
    const line = row
      .map((cell) => String(cell ?? "").trim())
      .filter(Boolean)
      .join(" ");
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Ekstre üst bilgisinden kimlik sinyalleri (hesap sahibi, VKN, IBAN, hesap no).
 */
export function extractBankStatementCompanySignals({
  sheetRows = null,
  text = "",
  fileName = "",
} = {}) {
  const topText = sheetRows?.length
    ? flattenSheetText(sheetRows, 50)
    : String(text || "");
  const hay = `${fileName || ""}\n${topText}`;

  const ibans = [];
  const ibanRe =
    /\bTR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}\b|\bTR\d{24}\b/gi;
  let m;
  while ((m = ibanRe.exec(hay)) && ibans.length < 8) {
    const iban = compactIban(m[0]);
    if (iban.length >= 24 && !ibans.includes(iban)) ibans.push(iban);
  }

  const taxNumbers = [];
  const labeledTax =
    hay.match(
      /(?:VKN|Vergi\s*(?:No|Numaras[ıi])|TCKN|TC\s*Kimlik)\s*[:\-]?\s*(\d{10,11})/gi
    ) || [];
  for (const hit of labeledTax) {
    const d = digitsOnly(hit);
    if ((d.length === 10 || d.length === 11) && !taxNumbers.includes(d)) {
      taxNumbers.push(d);
    }
  }

  const accountNumbers = [];
  const accMatch =
    hay.match(
      /(?:Hesap\s*No|Hesap\s*Numaras[ıi]|Account\s*No)\s*[:\-]?\s*([0-9\s\-]{6,24})/gi
    ) || [];
  for (const hit of accMatch) {
    const d = digitsOnly(hit);
    if (d.length >= 6 && d.length <= 20 && !accountNumbers.includes(d)) {
      accountNumbers.push(d);
    }
  }

  const ownerTitles = [];
  const ownerPatterns = [
    /(?:Hesap\s*Sahibi|Hesap\s*Ünvan[ıi]|Müsteri\s*Unvan[ıi]|Müşteri\s*Ünvan[ıi]|Unvan|Ünvan|Account\s*Holder)\s*[:\-]?\s*([^\n\r|;]{6,120})/gi,
  ];
  for (const re of ownerPatterns) {
    let om;
    while ((om = re.exec(hay)) && ownerTitles.length < 5) {
      const title = String(om[1] || "").trim();
      if (title.length >= 6) ownerTitles.push(title);
    }
  }

  // Dosya adında firma sinyali (ÖRNEK / VAKIFBANK gibi gürültüyü ayıkla)
  const fileBase = String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (
    fileBase &&
    !/vak[iı]f|örnek|ornek|ekstre|statement|staging|e2e/i.test(fileBase)
  ) {
    ownerTitles.push(fileBase);
  }

  const ownerCores = [
    ...new Set(ownerTitles.map((t) => normalizeCore(t)).filter((c) => c.length >= 6)),
  ];

  return {
    ownerTitles: [...new Set(ownerTitles)],
    ownerCores,
    taxNumbers,
    ibans,
    accountNumbers,
    hasAnySignal: Boolean(
      ownerCores.length || taxNumbers.length || ibans.length || accountNumbers.length
    ),
    // fingerprint for contamination reports — no raw content
    signalFingerprint: [
      ownerCores[0] || "",
      taxNumbers[0] || "",
      ibans[0] ? `iban:${ibans[0].slice(0, 4)}…${ibans[0].slice(-4)}` : "",
      accountNumbers[0] ? `acc:${accountNumbers[0].slice(-4)}` : "",
    ]
      .filter(Boolean)
      .join("|"),
  };
}

export function buildCompanyGuardProfile(company = null) {
  if (!company) {
    return {
      id: "",
      displayName: "",
      cores: [],
      taxNumbers: [],
      ibans: [],
      accountNumbers: [],
    };
  }
  const identity = buildOwnCompanyIdentity(company);
  const vkn = extractCompanyVkn(company);
  const taxNumbers = [...new Set([...(identity.taxNumbers || []), vkn].filter(Boolean))];
  const banks = company.bankAccounts || company.banks || [];
  const accountNumbers = [];
  for (const bank of banks) {
    const n = digitsOnly(
      bank?.accountNumber || bank?.hesapNo || bank?.accountNo || ""
    );
    if (n.length >= 6) accountNumbers.push(n);
  }
  return {
    id: String(company.id || company.companyId || ""),
    displayName: getCompanyDisplayName(company) || String(company.companyName || ""),
    cores: identity.cores || [],
    taxNumbers,
    ibans: (identity.ibans || []).map(compactIban),
    accountNumbers: [...new Set(accountNumbers)],
  };
}

function scoreProfileAgainstSignals(profile, signals) {
  const reasons = [];
  let score = 0;

  for (const tax of signals.taxNumbers || []) {
    if (profile.taxNumbers.includes(tax)) {
      score += 100;
      reasons.push("vkn_match");
    } else if (profile.taxNumbers.length && (tax.length === 10 || tax.length === 11)) {
      score -= 100;
      reasons.push("vkn_mismatch");
    }
  }

  if ((signals.ibans || []).length && profile.ibans.length) {
    const hit = signals.ibans.some((iban) => profile.ibans.includes(iban));
    if (hit) {
      score += 80;
      reasons.push("iban_match");
    } else {
      score -= 80;
      reasons.push("iban_mismatch");
    }
  }

  if ((signals.accountNumbers || []).length && profile.accountNumbers.length) {
    const hit = signals.accountNumbers.some((n) =>
      profile.accountNumbers.includes(n)
    );
    if (hit) {
      score += 40;
      reasons.push("account_match");
    } else {
      score -= 20;
      reasons.push("account_mismatch");
    }
  }

  let titleMatch = false;
  let titleMismatch = false;
  for (const core of signals.ownerCores || []) {
    if (profile.cores.some((c) => coresOverlapStrong(core, c))) {
      titleMatch = true;
    } else if (profile.cores.some((c) => coresClearlyDifferent(core, c))) {
      titleMismatch = true;
    }
  }
  if (titleMatch) {
    score += 60;
    reasons.push("title_match");
  } else if (titleMismatch) {
    score -= 60;
    reasons.push("title_mismatch");
  }

  return { score, reasons };
}

/**
 * @returns {{
 *   code: string,
 *   ok: boolean,
 *   blockPipeline: boolean,
 *   message: string,
 *   activeCompanyName: string,
 *   statementOwnerLabel: string,
 *   suggestedCompanyId: string,
 *   suggestedCompanyName: string,
 *   reasons: string[],
 *   signals: object,
 * }}
 */
export function verifyBankStatementCompanyMatch({
  sheetRows = null,
  text = "",
  fileName = "",
  selectedCompany = null,
  companies = [],
} = {}) {
  const signals = extractBankStatementCompanySignals({
    sheetRows,
    text,
    fileName,
  });
  const active = buildCompanyGuardProfile(selectedCompany);
  const activeName = active.displayName || "Aktif firma";

  const statementOwnerLabel =
    signals.ownerTitles[0] ||
    (signals.ownerCores[0]
      ? signals.ownerCores[0]
          .split(/\s+/)
          .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
          .join(" ")
      : "") ||
    "";

  if (!signals.hasAnySignal) {
    return {
      code: BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED,
      ok: false,
      blockPipeline: true,
      message:
        "Ekstredeki firma kimliği doğrulanamadı. Devam etmeden önce doğru firmayı seçtiğinizden emin olun.",
      activeCompanyName: activeName,
      statementOwnerLabel: "",
      suggestedCompanyId: "",
      suggestedCompanyName: "",
      reasons: ["no_identity_signal"],
      signals: {
        hasAnySignal: false,
        signalFingerprint: signals.signalFingerprint,
      },
    };
  }

  const activeScore = scoreProfileAgainstSignals(active, signals);

  let bestOther = null;
  for (const company of companies || []) {
    const id = String(company.id || company.companyId || "");
    if (!id || id === active.id) continue;
    const profile = buildCompanyGuardProfile(company);
    const scored = scoreProfileAgainstSignals(profile, signals);
    if (!bestOther || scored.score > bestOther.score) {
      bestOther = { profile, ...scored };
    }
  }

  const strongMismatch =
    activeScore.reasons.includes("vkn_mismatch") ||
    activeScore.reasons.includes("iban_mismatch") ||
    (activeScore.reasons.includes("title_mismatch") &&
      !activeScore.reasons.includes("title_match") &&
      !activeScore.reasons.includes("vkn_match") &&
      !activeScore.reasons.includes("iban_match"));

  const strongMatch =
    activeScore.reasons.includes("vkn_match") ||
    activeScore.reasons.includes("iban_match") ||
    (activeScore.reasons.includes("title_match") &&
      !activeScore.reasons.includes("vkn_mismatch") &&
      !activeScore.reasons.includes("iban_mismatch"));

  const otherLooksBetter =
    bestOther &&
    bestOther.score >= 60 &&
    bestOther.score - activeScore.score >= 40 &&
    (bestOther.reasons.includes("vkn_match") ||
      bestOther.reasons.includes("iban_match") ||
      bestOther.reasons.includes("title_match"));

  if (strongMismatch || otherLooksBetter) {
    const owner =
      statementOwnerLabel ||
      bestOther?.profile?.displayName ||
      "başka bir firma";
    const suggestOther =
      bestOther &&
      bestOther.score >= 40 &&
      (otherLooksBetter ||
        bestOther.reasons.includes("vkn_match") ||
        bestOther.reasons.includes("iban_match") ||
        bestOther.reasons.includes("title_match"));
    return {
      code: BANK_COMPANY_GUARD_CODE.MISMATCH,
      ok: false,
      blockPipeline: true,
      message: formatCompanyMismatchMessage({
        statementOwnerName: owner,
        activeCompanyName: activeName,
      }),
      activeCompanyName: activeName,
      statementOwnerLabel: owner,
      suggestedCompanyId: suggestOther ? bestOther.profile.id : "",
      suggestedCompanyName: suggestOther
        ? bestOther.profile.displayName
        : "",
      reasons: [
        ...activeScore.reasons,
        ...(suggestOther ? [`other:${bestOther.reasons.join("+")}`] : []),
      ],
      signals: {
        hasAnySignal: true,
        signalFingerprint: signals.signalFingerprint,
        ownerCore: signals.ownerCores[0] || "",
      },
    };
  }

  if (strongMatch) {
    return {
      code: BANK_COMPANY_GUARD_CODE.MATCH,
      ok: true,
      blockPipeline: false,
      message: "",
      activeCompanyName: activeName,
      statementOwnerLabel,
      suggestedCompanyId: "",
      suggestedCompanyName: "",
      reasons: activeScore.reasons,
      signals: {
        hasAnySignal: true,
        signalFingerprint: signals.signalFingerprint,
      },
    };
  }

  return {
    code: BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED,
    ok: false,
    blockPipeline: true,
    message:
      "Ekstredeki firma kimliği belirsiz. Doğru firmayı seçtikten sonra tekrar deneyin.",
    activeCompanyName: activeName,
    statementOwnerLabel,
    suggestedCompanyId: bestOther?.score >= 40 ? bestOther.profile.id : "",
    suggestedCompanyName:
      bestOther?.score >= 40 ? bestOther.profile.displayName : "",
    reasons: activeScore.reasons.length
      ? activeScore.reasons
      : ["ambiguous_identity"],
    signals: {
      hasAnySignal: true,
      signalFingerprint: signals.signalFingerprint,
    },
  };
}

export function formatCompanyMismatchMessage({
  statementOwnerName = "",
  activeCompanyName = "",
} = {}) {
  const owner = String(statementOwnerName || "başka bir firma").trim();
  const active = String(activeCompanyName || "aktif firma").trim();
  return `Bu ekstre ${owner} firmasına ait görünüyor. Aktif firma ${active}. İşlem durduruldu.`;
}

export function formatEmptyAccountPlanMessage() {
  return "Bu firmanın hesap planı tanımlı değil.";
}

/**
 * Salt okunur kontaminasyon özeti — silme/taşıma yapmaz.
 */
export function buildCrossCompanyContaminationReport({
  activeCompanyId = "",
  activeCompanyName = "",
  statementFingerprint = "",
  acceptanceMeta = null,
} = {}) {
  return {
    readOnly: true,
    action: "none",
    note:
      "Kullanıcı onayı olmadan Drive/DB kaydı silinmez veya taşınmaz; MARE’ye otomatik taşıma yok.",
    activeCompanyId: String(activeCompanyId || ""),
    activeCompanyName: String(activeCompanyName || ""),
    statementFingerprint: String(statementFingerprint || ""),
    acceptanceMeta: acceptanceMeta
      ? {
          hasRecord: true,
          keys: Object.keys(acceptanceMeta || {}),
        }
      : { hasRecord: false },
    deletionRequiresUserApproval: true,
  };
}

export function shouldBlockCariResolutionForCompanyGuard(guardResult = null) {
  if (!guardResult) return false;
  if (guardResult.manuallyConfirmed && !guardResult.blockPipeline) {
    return false;
  }
  return (
    guardResult.code === BANK_COMPANY_GUARD_CODE.MISMATCH ||
    guardResult.code === BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED
  );
}

/**
 * Manuel onay yalnız COMPANY_VERIFICATION_REQUIRED için.
 * COMPANY_MISMATCH asla bypass edilemez.
 */
export function canAcceptManualCompanyConfirmation(guardCode = "") {
  return String(guardCode || "") === BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED;
}

export function formatCompanyVerificationConfirmLabel(companyDisplayName = "") {
  const name = String(companyDisplayName || "").trim() || "aktif firma";
  return `Bu ekstre ${name} firmasına aittir`;
}

export const COMPANY_VERIFY_CONFIRM_BUTTON_LABEL =
  "Firmayı Onayla ve Devam Et";

/**
 * Kullanıcı açıkça onaylamadan pipeline devam etmez.
 * Onaylanan companyId oturumdaki aktif firmayla aynı olmalı.
 * @returns {{ ok: true, companyId: string } | { ok: false, code: string, message: string }}
 */
export function assertManualCompanyConfirmation({
  guardCode = "",
  checkboxChecked = false,
  confirmedCompanyId = "",
  activeCompanyId = "",
} = {}) {
  if (!canAcceptManualCompanyConfirmation(guardCode)) {
    return {
      ok: false,
      code: "MANUAL_CONFIRM_FORBIDDEN",
      message:
        "Firma uyuşmazlığında manuel onay ile devam edilemez. Doğru firmayı seçin.",
    };
  }
  if (!checkboxChecked) {
    return {
      ok: false,
      code: "CONFIRM_CHECKBOX_REQUIRED",
      message: "Devam etmek için firma onay kutusunu işaretleyin.",
    };
  }
  const active = String(activeCompanyId || "").trim();
  const confirmed = String(confirmedCompanyId || "").trim();
  if (!active) {
    return {
      ok: false,
      code: "MISSING_COMPANY_ID",
      message: "Firma seçilmedi.",
    };
  }
  if (!confirmed || confirmed !== active) {
    return {
      ok: false,
      code: "CONFIRM_COMPANY_MISMATCH",
      message:
        "Onaylanan firma, oturumdaki aktif firma ile aynı olmalıdır.",
    };
  }
  return { ok: true, companyId: active };
}

/**
 * Guard sonucu + oturum onayı: yalnızca VERIFICATION_REQUIRED + aynı companyId.
 * MISMATCH her zaman bloklanır.
 */
export function applyManualCompanyConfirmationToGuard(
  guardResult = null,
  {
    confirmedCompanyId = "",
    activeCompanyId = "",
  } = {}
) {
  if (!guardResult?.blockPipeline) return guardResult;
  if (guardResult.code === BANK_COMPANY_GUARD_CODE.MISMATCH) {
    return guardResult;
  }
  if (!canAcceptManualCompanyConfirmation(guardResult.code)) {
    return guardResult;
  }
  const check = assertManualCompanyConfirmation({
    guardCode: guardResult.code,
    checkboxChecked: true,
    confirmedCompanyId,
    activeCompanyId,
  });
  if (!check.ok) return guardResult;
  return {
    ...guardResult,
    ok: true,
    blockPipeline: false,
    manuallyConfirmed: true,
    message: "",
  };
}

/** Test / UI: unvan varyasyonu normalize karşılaştırması */
export function titlesMatchForGuard(a = "", b = "") {
  return coresOverlapStrong(normalizeCore(a), normalizeCore(b));
}

export function normalizeTitleKeyForGuard(value = "") {
  return normalizeCompanyTitleKey(value);
}
