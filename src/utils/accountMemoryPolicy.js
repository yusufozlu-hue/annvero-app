/**
 * Muhasebe hafızası politika katmanı — tek doğruluk kaynağı (eşikler + öncelik + gerekçe).
 * UI bileşenlerine gömülü eşik kullanılmaz; buradan import edilir.
 */

/** Yüksek güven: otomatik uygula */
export const MEMORY_AUTO_APPLY_MIN_CONFIDENCE = 90;
/** Orta güven: öneri / onay bekle */
export const MEMORY_SUGGEST_MIN_CONFIDENCE = 70;
/** Düzeltme oranı ≥ bu → otomatik uygulama kapanır */
export const MEMORY_AUTO_DISABLE_CORRECTION_RATIO = 0.35;

export const MEMORY_DECISION_CODE = Object.freeze({
  AUTO_APPLIED: "MEMORY_AUTO_APPLIED",
  SUGGEST: "MEMORY_SUGGEST",
  REVIEW: "MEMORY_REVIEW",
  CONFLICT: "MEMORY_CONFLICT",
  CORE_OVERRIDE: "MEMORY_CORE_BLOCKED",
  IDEMPOTENT: "MEMORY_IDEMPOTENT",
  TENANT_DENIED: "MEMORY_TENANT_DENIED",
});

/**
 * Öncelik sırası (yüksek → düşük):
 * 1 CORE mevzuat  2 firma kesin kullanıcı  3 firma öğrenilmiş  4 genel sistem  5 inceleme
 */
export const MEMORY_PRIORITY = Object.freeze({
  CORE_MEVZUAT: 100,
  FIRM_USER_RULE: 80,
  FIRM_LEARNED: 60,
  SYSTEM_HINT: 40,
  REVIEW: 0,
});

export function resolveConfidenceBand(confidence = 0) {
  const c = Number(confidence) || 0;
  if (c >= MEMORY_AUTO_APPLY_MIN_CONFIDENCE) return "high";
  if (c >= MEMORY_SUGGEST_MIN_CONFIDENCE) return "medium";
  return "low";
}

/**
 * Güvenli, kullanıcıya gösterilebilir gerekçe — ham açıklama/IBAN yok.
 */
export function buildMemoryApplyReason({
  tier = "",
  confidence = 0,
  usageCount = 0,
  successCount = 0,
  mode = "",
  conflict = false,
  coreBlocked = false,
} = {}) {
  if (coreBlocked) {
    return {
      code: MEMORY_DECISION_CODE.CORE_OVERRIDE,
      text: "Zorunlu mevzuat/CORE kuralı hafıza önerisini engelledi.",
    };
  }
  if (conflict || mode === "conflict") {
    return {
      code: MEMORY_DECISION_CODE.CONFLICT,
      text: "Aynı işlem için çelişkili aktif hafıza kuralları var; otomatik uygulanmadı.",
    };
  }
  const band = resolveConfidenceBand(confidence);
  const usage = Number(usageCount) || 0;
  const success = Number(successCount) || 0;

  if (band === "high" && /ANALYSIS_KEY|exact/i.test(String(tier))) {
    return {
      code: MEMORY_DECISION_CODE.AUTO_APPLIED,
      text: "Kesin işlem fingerprint’i eşleşti; yüksek güvenle otomatik uygulandı.",
    };
  }
  if (band === "high" && usage >= 3) {
    return {
      code: MEMORY_DECISION_CODE.AUTO_APPLIED,
      text: `Bu firma için daha önce ${success || usage} kez onaylandı; yüksek güvenle otomatik uygulandı.`,
    };
  }
  if (band === "high") {
    return {
      code: MEMORY_DECISION_CODE.AUTO_APPLIED,
      text: "Benzer açıklama ve aynı işlem yönü; yüksek güvenle otomatik uygulandı.",
    };
  }
  if (band === "medium") {
    return {
      code: MEMORY_DECISION_CODE.SUGGEST,
      text: "Benzer açıklama ve aynı işlem yönü; orta güven — kullanıcı onayı bekleniyor.",
    };
  }
  return {
    code: MEMORY_DECISION_CODE.REVIEW,
    text: "Düşük güven — kullanıcı incelemesi gerekli; otomatik hesap atanmadı.",
  };
}

/**
 * CORE / mevzuat — hafıza bunu geçersiz kılamaz.
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function evaluateCoreMemoryOverride({
  transactionType = "",
  description = "",
  accountCode = "",
  documentType = "",
} = {}) {
  const text = String(description || "").toUpperCase();
  const code = String(accountCode || "").trim();
  const tt = String(transactionType || "").toUpperCase();
  const bel = String(documentType || "").toUpperCase();

  if (/SGDP/i.test(text) && code.startsWith("361") && !/SGDP/i.test(code)) {
    return {
      blocked: true,
      reason: "SGDP yalnızca SGDP 361 paylarına bağlanmalıdır.",
    };
  }
  if (
    /GECIKME|GECİKME|CEZA/i.test(text) &&
    (code.startsWith("360") || code.startsWith("361")) &&
    !/689|780|770/.test(code)
  ) {
    return {
      blocked: true,
      reason: "Gecikme zammı/cezası ana vergi veya prim hesabına karıştırılamaz.",
    };
  }
  if (/GIB|MDA|E[- ]?ARŞIV|EARSIV/i.test(text) && bel && bel !== "EA") {
    return {
      blocked: true,
      reason: "GİB/MDA belgeleri için belge türü EA zorunludur.",
    };
  }
  if (
    (/MAAS|MAAŞ/i.test(text) && !/AVANS/i.test(text) && code && !code.startsWith("335")) ||
    (/MAAS\s*AVANS|MAAŞ\s*AVANS/i.test(text) && code && !code.startsWith("196")) ||
    (/IS\s*AVANS|İŞ\s*AVANS/i.test(text) && code && !code.startsWith("195"))
  ) {
    // Uyarı seviyesinde blok değil — CORE soft prefer; hard block yalnız açık mevzuat
  }
  if (tt.includes("CLOSED_PERIOD")) {
    return { blocked: true, reason: "Kapanmış döneme hafıza ile kayıt açılamaz." };
  }
  return { blocked: false };
}

export function buildMemoryIdempotencyKey({
  companyId = "",
  ruleKey = "",
  scope = "firm",
} = {}) {
  return `${String(companyId).trim()}|${String(scope).trim()}|${String(ruleKey).trim()}`;
}
