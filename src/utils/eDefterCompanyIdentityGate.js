/**
 * E-Defter company ↔ document tax identity gate.
 * Fail-closed: missing/invalid identity is never treated as matched/verified.
 * Raw VKN/TCKN is never returned in UI/persist-facing fields.
 *
 * XML/ZIP: document identity required; errors are blocking (no user bypass).
 * Excel: document identity often N/A → analyze ok, auto verified=false;
 *        persist/export only after scoped user confirmation.
 */

import { digitsOnly, isValidVkn } from "@/src/utils/companyIdentity";

export const EDEFTER_IDENTITY_STATUS = Object.freeze({
  MATCHED: "MATCHED",
  MISMATCH: "MISMATCH",
  COMPANY_IDENTITY_MISSING: "COMPANY_IDENTITY_MISSING",
  DOCUMENT_IDENTITY_MISSING: "DOCUMENT_IDENTITY_MISSING",
  DOCUMENT_IDENTITY_MISSING_REVIEW: "DOCUMENT_IDENTITY_MISSING_REVIEW",
  IDENTITY_INVALID: "IDENTITY_INVALID",
  IDENTITY_AMBIGUOUS: "IDENTITY_AMBIGUOUS",
  IDENTITY_TYPE_CONFLICT: "IDENTITY_TYPE_CONFLICT",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

export const EDEFTER_IDENTITY_TYPE = Object.freeze({
  VKN: "VKN",
  TCKN: "TCKN",
  UNKNOWN: "UNKNOWN",
  EMPTY: "EMPTY",
});

export const IDENTITY_CONFIRMATION = Object.freeze({
  NONE: "",
  AUTO_MATCHED: "AUTO_MATCHED",
  USER_CONFIRMED: "USER_CONFIRMED",
  UNVERIFIED: "UNVERIFIED",
  BLOCKED: "BLOCKED",
});

export const IDENTITY_CONFIRMATION_ALLOWLIST = Object.freeze([
  IDENTITY_CONFIRMATION.NONE,
  IDENTITY_CONFIRMATION.AUTO_MATCHED,
  IDENTITY_CONFIRMATION.USER_CONFIRMED,
  IDENTITY_CONFIRMATION.UNVERIFIED,
  IDENTITY_CONFIRMATION.BLOCKED,
]);

/** @returns {string|null} allowlisted value or null if unknown (reject) */
export function normalizeIdentityConfirmationValue(value = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return IDENTITY_CONFIRMATION.NONE;
  const upper = raw.toUpperCase();
  if (IDENTITY_CONFIRMATION_ALLOWLIST.includes(upper)) return upper;
  if (IDENTITY_CONFIRMATION_ALLOWLIST.includes(raw)) return raw;
  return null;
}

const BLOCKING_IDENTITY_STATUSES = Object.freeze([
  EDEFTER_IDENTITY_STATUS.MISMATCH,
  EDEFTER_IDENTITY_STATUS.COMPANY_IDENTITY_MISSING,
  EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING,
  EDEFTER_IDENTITY_STATUS.IDENTITY_INVALID,
  EDEFTER_IDENTITY_STATUS.IDENTITY_AMBIGUOUS,
  EDEFTER_IDENTITY_STATUS.IDENTITY_TYPE_CONFLICT,
]);

const EXCEL_REVIEW_IDENTITY_STATUSES = Object.freeze([
  EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW,
  EDEFTER_IDENTITY_STATUS.NOT_APPLICABLE,
]);

function documentTypesLookLikeXmlZip(documentTypes = []) {
  return (Array.isArray(documentTypes) ? documentTypes : []).some((t) =>
    /xml|zip/i.test(String(t || ""))
  );
}

/**
 * Server persist gate — client confirmation is not a tenant grant.
 * Unknown confirmation / XML USER_CONFIRMED spoof / blocking status → throw.
 */
export function assertEdefterPersistIdentityGate({
  resultSummary = {},
  documentTypes = [],
} = {}) {
  const summary =
    resultSummary && typeof resultSummary === "object" ? resultSummary : {};
  const status = String(summary.identity_status || "").trim();
  const confirmation = normalizeIdentityConfirmationValue(
    summary.identity_confirmation
  );
  if (confirmation === null) {
    const err = new Error("Geçersiz identity_confirmation değeri.");
    err.code = "IDENTITY_CONFIRMATION_INVALID";
    err.httpStatus = 400;
    throw err;
  }

  const verified = Boolean(summary.identity_verified);
  const userConfirmed = Boolean(summary.identity_user_confirmed);

  if (verified && userConfirmed) {
    const err = new Error(
      "identityVerified ile identityUserConfirmed birlikte olamaz."
    );
    err.code = "IDENTITY_FLAG_CONFLICT";
    err.httpStatus = 400;
    throw err;
  }

  if (BLOCKING_IDENTITY_STATUSES.includes(status) || confirmation === IDENTITY_CONFIRMATION.BLOCKED) {
    const err = new Error("Engelleyici kimlik durumunda kayıt oluşturulamaz.");
    err.code = "IDENTITY_BLOCKED";
    err.httpStatus = 403;
    throw err;
  }

  if (confirmation === IDENTITY_CONFIRMATION.USER_CONFIRMED) {
    if (verified) {
      const err = new Error("USER_CONFIRMED otomatik doğrulama iddiası taşıyamaz.");
      err.code = "IDENTITY_FLAG_CONFLICT";
      err.httpStatus = 400;
      throw err;
    }
    if (!userConfirmed) {
      const err = new Error("USER_CONFIRMED için identity_user_confirmed zorunlu.");
      err.code = "IDENTITY_CONFIRMATION_MISMATCH";
      err.httpStatus = 400;
      throw err;
    }
    if (!EXCEL_REVIEW_IDENTITY_STATUSES.includes(status)) {
      const err = new Error(
        "USER_CONFIRMED yalnız kimlik taşımayan Excel incelemesi için geçerlidir."
      );
      err.code = "USER_CONFIRMED_NOT_ALLOWED";
      err.httpStatus = 403;
      throw err;
    }
    if (documentTypesLookLikeXmlZip(documentTypes)) {
      const err = new Error(
        "XML/ZIP girdide USER_CONFIRMED ile kayıt bypass edilemez."
      );
      err.code = "USER_CONFIRMED_XML_FORBIDDEN";
      err.httpStatus = 403;
      throw err;
    }
    return { ok: true, confirmation, allowPersist: true };
  }

  if (EXCEL_REVIEW_IDENTITY_STATUSES.includes(status)) {
    const err = new Error(
      "Excel kimlik incelemesi kullanıcı onayı olmadan kaydedilemez."
    );
    err.code = "IDENTITY_REVIEW_REQUIRED";
    err.httpStatus = 403;
    throw err;
  }

  if (status === EDEFTER_IDENTITY_STATUS.MATCHED) {
    if (!verified) {
      const err = new Error("MATCHED için identity_verified zorunlu.");
      err.code = "IDENTITY_FLAG_CONFLICT";
      err.httpStatus = 400;
      throw err;
    }
    if (
      confirmation !== IDENTITY_CONFIRMATION.AUTO_MATCHED &&
      confirmation !== IDENTITY_CONFIRMATION.NONE
    ) {
      const err = new Error("MATCHED için geçersiz identity_confirmation.");
      err.code = "IDENTITY_CONFIRMATION_MISMATCH";
      err.httpStatus = 400;
      throw err;
    }
    return { ok: true, confirmation: IDENTITY_CONFIRMATION.AUTO_MATCHED, allowPersist: true };
  }

  if (!status) {
    // Legacy/empty identity fields: fail-closed for new posts
    const err = new Error("Kimlik durumu olmadan kayıt oluşturulamaz.");
    err.code = "IDENTITY_STATUS_REQUIRED";
    err.httpStatus = 400;
    throw err;
  }

  const err = new Error("Kimlik doğrulanmadan kayıt oluşturulamaz.");
  err.code = "IDENTITY_PERSIST_DENIED";
  err.httpStatus = 403;
  throw err;
}

const SAFE_MESSAGES = Object.freeze({
  [EDEFTER_IDENTITY_STATUS.MATCHED]: "Firma ve belge kimliği eşleşiyor.",
  [EDEFTER_IDENTITY_STATUS.MISMATCH]:
    "Belge kimliği seçili firma ile uyuşmuyor. Analiz ve kayıt durduruldu.",
  [EDEFTER_IDENTITY_STATUS.COMPANY_IDENTITY_MISSING]:
    "Seçili firmanın vergi kimliği eksik. Firma kimliği tanımlanmadan devam edilemez.",
  [EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING]:
    "Belgede vergi kimliği bulunamadı. Kimlik doğrulanmadan sonuç onaylı sayılamaz.",
  [EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW]:
    "Excel girdide belge kimliği yok; analiz devam eder, kayıt için kullanıcı onayı gerekir.",
  [EDEFTER_IDENTITY_STATUS.IDENTITY_INVALID]:
    "Vergi kimliği geçersiz veya eksik uzunlukta. Analiz durduruldu.",
  [EDEFTER_IDENTITY_STATUS.IDENTITY_AMBIGUOUS]:
    "Pakette birden fazla farklı firma kimliği tespit edildi. Analiz durduruldu.",
  [EDEFTER_IDENTITY_STATUS.IDENTITY_TYPE_CONFLICT]:
    "Firma ve belge kimlik türleri uyuşmuyor (VKN/TCKN). Analiz durduruldu.",
  [EDEFTER_IDENTITY_STATUS.NOT_APPLICABLE]:
    "Bu girdi için belge kimliği beklenmiyor; kimlik doğrulanmış sayılmaz.",
});

const USER_CONFIRMED_SAFE_MESSAGE = "Firma kullanıcı tarafından doğrulandı";

/** TEST_ONLY synthetic identities — not real persons/companies. */
export const EDEFTER_TEST_ONLY_IDENTITIES = Object.freeze({
  VKN_A: "1111111111",
  VKN_B: "2222222222",
  VKN_INVALID_SHORT: "12345",
  TCKN_A: "10000000146",
  TCKN_B: "10000000154",
});

export function normalizeIdentityDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

export function classifyTaxIdentityType(value = "") {
  const d = normalizeIdentityDigits(value);
  if (!d) return EDEFTER_IDENTITY_TYPE.EMPTY;
  if (d.length === 10) return EDEFTER_IDENTITY_TYPE.VKN;
  if (d.length === 11) return EDEFTER_IDENTITY_TYPE.TCKN;
  return EDEFTER_IDENTITY_TYPE.UNKNOWN;
}

export function isValidTaxIdentityDigits(value = "") {
  const d = normalizeIdentityDigits(value);
  if (d.length === 10) return isValidVkn(d);
  if (d.length === 11) return /^\d{11}$/.test(d);
  return false;
}

export function maskTaxIdSafe(value = "") {
  const d = normalizeIdentityDigits(value);
  if (!d) return "";
  if (d.length <= 4) return `****${d.slice(-2)}`;
  return `${"*".repeat(Math.max(0, d.length - 4))}${d.slice(-4)}`;
}

/**
 * Tenant-bound fingerprint — not reversible across companies.
 */
export function fingerprintTaxIdentity(value = "", companyId = "") {
  const d = normalizeIdentityDigits(value);
  if (!d) return "";
  const salt = String(companyId || "annvero-edefter").slice(0, 80);
  const type = classifyTaxIdentityType(d);
  let h = 2166136261;
  const material = `${salt}|${type}|len:${d.length}|tail:${d.slice(-2)}`;
  for (let i = 0; i < material.length; i += 1) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let h2 = 0x811c9dc5;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    h2 ^= d.charCodeAt(i) + salt.charCodeAt(i % Math.max(salt.length, 1));
    h2 = Math.imul(h2, 16777619);
  }
  return `eid_${type.toLowerCase()}_${(h >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

function decision({
  status,
  matched = false,
  verified = false,
  userConfirmed = false,
  blocking = false,
  reviewRequired = false,
  allowAnalyze = true,
  allowPersist = false,
  allowExport = false,
  companyType = EDEFTER_IDENTITY_TYPE.EMPTY,
  documentType = EDEFTER_IDENTITY_TYPE.EMPTY,
  companyId = "",
  companyTaxId = "",
  documentTaxId = "",
  sourceKind = "xml",
  confirmation = IDENTITY_CONFIRMATION.NONE,
}) {
  const verifiedOk = Boolean(verified);
  const userOk = Boolean(userConfirmed);
  const identityOk = verifiedOk || userOk;
  let resolvedConfirmation = confirmation || IDENTITY_CONFIRMATION.NONE;
  if (userOk) {
    resolvedConfirmation = IDENTITY_CONFIRMATION.USER_CONFIRMED;
  } else if (verifiedOk) {
    resolvedConfirmation = IDENTITY_CONFIRMATION.AUTO_MATCHED;
  } else if (blocking) {
    resolvedConfirmation = IDENTITY_CONFIRMATION.BLOCKED;
  } else if (reviewRequired) {
    resolvedConfirmation = IDENTITY_CONFIRMATION.UNVERIFIED;
  }
  return {
    code: status,
    status,
    matched: Boolean(matched),
    /** Yalnız otomatik, geçerli belge↔firma eşleşmesi */
    verified: verifiedOk,
    identityVerified: verifiedOk,
    /** Yalnız kimlik taşımayan Excel için kullanıcı onayı */
    userConfirmed: userOk,
    identityUserConfirmed: userOk,
    blocking: Boolean(blocking),
    reviewRequired: Boolean(reviewRequired),
    allowAnalyze: Boolean(allowAnalyze),
    allowPersist: Boolean(allowPersist) && identityOk && !blocking,
    allowExport: Boolean(allowExport) && identityOk && !blocking,
    confirmation: resolvedConfirmation,
    confirmedScope: null,
    safeMessage: SAFE_MESSAGES[status] || "Kimlik doğrulaması tamamlanamadı.",
    safeFingerprint: fingerprintTaxIdentity(documentTaxId || companyTaxId || "", companyId),
    companyIdentityType: companyType,
    documentIdentityType: documentType,
    companyMask: maskTaxIdSafe(companyTaxId),
    documentMask: maskTaxIdSafe(documentTaxId),
    sourceKind,
    skipped: false,
  };
}

/**
 * @param {{
 *   companyTaxId?: string,
 *   documentTaxId?: string,
 *   documentTaxIds?: string[],
 *   companyId?: string,
 *   sourceKind?: "xml"|"zip"|"excel"|"unknown",
 * }} input
 */
export function evaluateEDefterCompanyIdentity(input = {}) {
  const companyId = String(input.companyId || "").slice(0, 80);
  const sourceKind = String(input.sourceKind || "xml").toLowerCase();
  const expectsDocumentIdentity = sourceKind === "xml" || sourceKind === "zip";

  const companyRaw = normalizeIdentityDigits(input.companyTaxId);
  const multi = Array.isArray(input.documentTaxIds)
    ? [...new Set(input.documentTaxIds.map((x) => normalizeIdentityDigits(x)).filter(Boolean))]
    : [];
  const documentRaw =
    multi.length === 1
      ? multi[0]
      : multi.length > 1
        ? ""
        : normalizeIdentityDigits(input.documentTaxId);

  const companyType = classifyTaxIdentityType(companyRaw);
  const documentType = classifyTaxIdentityType(documentRaw);

  if (multi.length > 1) {
    return decision({
      status: EDEFTER_IDENTITY_STATUS.IDENTITY_AMBIGUOUS,
      blocking: true,
      allowAnalyze: false,
      companyType,
      documentType: EDEFTER_IDENTITY_TYPE.UNKNOWN,
      companyId,
      companyTaxId: companyRaw,
      sourceKind,
    });
  }

  if (companyRaw && !isValidTaxIdentityDigits(companyRaw)) {
    return decision({
      status: EDEFTER_IDENTITY_STATUS.IDENTITY_INVALID,
      blocking: true,
      allowAnalyze: false,
      companyType,
      documentType,
      companyId,
      companyTaxId: companyRaw,
      documentTaxId: documentRaw,
      sourceKind,
    });
  }

  if (documentRaw && !isValidTaxIdentityDigits(documentRaw)) {
    return decision({
      status: EDEFTER_IDENTITY_STATUS.IDENTITY_INVALID,
      blocking: true,
      allowAnalyze: false,
      companyType,
      documentType,
      companyId,
      companyTaxId: companyRaw,
      documentTaxId: documentRaw,
      sourceKind,
    });
  }

  if (!companyRaw && documentRaw) {
    return decision({
      status: EDEFTER_IDENTITY_STATUS.COMPANY_IDENTITY_MISSING,
      blocking: true,
      allowAnalyze: false,
      companyType,
      documentType,
      companyId,
      companyTaxId: companyRaw,
      documentTaxId: documentRaw,
      sourceKind,
    });
  }

  if (companyRaw && !documentRaw) {
    if (!expectsDocumentIdentity) {
      return decision({
        status: EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW,
        matched: false,
        verified: false,
        blocking: false,
        reviewRequired: true,
        allowAnalyze: true,
        allowPersist: false,
        allowExport: false,
        companyType,
        documentType,
        companyId,
        companyTaxId: companyRaw,
        sourceKind,
      });
    }
    return decision({
      status: EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING,
      blocking: true,
      allowAnalyze: false,
      companyType,
      documentType,
      companyId,
      companyTaxId: companyRaw,
      sourceKind,
    });
  }

  if (!companyRaw && !documentRaw) {
    if (!expectsDocumentIdentity) {
      return decision({
        status: EDEFTER_IDENTITY_STATUS.NOT_APPLICABLE,
        matched: false,
        verified: false,
        blocking: false,
        reviewRequired: true,
        allowAnalyze: true,
        allowPersist: false,
        allowExport: false,
        companyType,
        documentType,
        companyId,
        companyTaxId: companyRaw,
        sourceKind,
      });
    }
    return decision({
      status: EDEFTER_IDENTITY_STATUS.COMPANY_IDENTITY_MISSING,
      blocking: true,
      allowAnalyze: false,
      companyType,
      documentType,
      companyId,
      companyTaxId: companyRaw,
      sourceKind,
    });
  }

  if (
    companyType !== documentType &&
    companyType !== EDEFTER_IDENTITY_TYPE.EMPTY &&
    documentType !== EDEFTER_IDENTITY_TYPE.EMPTY &&
    companyType !== EDEFTER_IDENTITY_TYPE.UNKNOWN &&
    documentType !== EDEFTER_IDENTITY_TYPE.UNKNOWN
  ) {
    return decision({
      status: EDEFTER_IDENTITY_STATUS.IDENTITY_TYPE_CONFLICT,
      blocking: true,
      allowAnalyze: false,
      companyType,
      documentType,
      companyId,
      companyTaxId: companyRaw,
      documentTaxId: documentRaw,
      sourceKind,
    });
  }

  if (companyRaw !== documentRaw) {
    return decision({
      status: EDEFTER_IDENTITY_STATUS.MISMATCH,
      blocking: true,
      allowAnalyze: false,
      companyType,
      documentType,
      companyId,
      companyTaxId: companyRaw,
      documentTaxId: documentRaw,
      sourceKind,
    });
  }

  return decision({
    status: EDEFTER_IDENTITY_STATUS.MATCHED,
    matched: true,
    verified: true,
    blocking: false,
    allowAnalyze: true,
    allowPersist: true,
    allowExport: true,
    companyType,
    documentType,
    companyId,
    companyTaxId: companyRaw,
    documentTaxId: documentRaw,
    sourceKind,
  });
}

export function identityStatusToErrorCode(status) {
  switch (status) {
    case EDEFTER_IDENTITY_STATUS.MISMATCH:
      return "COMPANY_MISMATCH";
    case EDEFTER_IDENTITY_STATUS.IDENTITY_AMBIGUOUS:
      return "MIXED_COMPANY_OR_PERIOD";
    case EDEFTER_IDENTITY_STATUS.COMPANY_IDENTITY_MISSING:
      return "COMPANY_IDENTITY_MISSING";
    case EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING:
    case EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW:
      return "DOCUMENT_IDENTITY_MISSING";
    case EDEFTER_IDENTITY_STATUS.IDENTITY_INVALID:
      return "IDENTITY_INVALID";
    case EDEFTER_IDENTITY_STATUS.IDENTITY_TYPE_CONFLICT:
      return "IDENTITY_TYPE_CONFLICT";
    default:
      return status || "IDENTITY_GATE";
  }
}

export function buildIdentityConfirmationScope({
  companyId = "",
  fingerprint = "",
  period = "",
} = {}) {
  return {
    companyId: String(companyId || ""),
    fingerprint: String(fingerprint || ""),
    period: String(period || ""),
  };
}

export function identityConfirmationScopesEqual(a, b) {
  if (!a || !b) return false;
  return (
    String(a.companyId || "") === String(b.companyId || "") &&
    String(a.fingerprint || "") === String(b.fingerprint || "") &&
    String(a.period || "") === String(b.period || "")
  );
}

/** Excel kimlik-taşımayan review: onay kutusu gösterilebilir mi? */
export function canOfferExcelIdentityConfirmation(identity) {
  if (!identity || typeof identity !== "object") return false;
  if (identity.blocking) return false;
  if (identity.verified || identity.identityVerified) return false;
  if (String(identity.sourceKind || "").toLowerCase() !== "excel") return false;
  const status = identity.status;
  return (
    status === EDEFTER_IDENTITY_STATUS.NOT_APPLICABLE ||
    status === EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING_REVIEW ||
    status === EDEFTER_IDENTITY_STATUS.DOCUMENT_IDENTITY_MISSING
  );
}

/**
 * Kullanıcı onayı — yalnız mevcut scope için.
 * verified kalır false; allowPersist/export açılır. Analiz tekrarlanmaz.
 * XML/ZIP mismatch/ambiguous için no-op (bypass yok).
 */
export function applyUserIdentityConfirmation(identity, scope = {}) {
  // XML/ZIP mismatch/ambiguous/MATCHED: no-op — confirmation cannot bypass.
  if (!canOfferExcelIdentityConfirmation(identity)) {
    return identity;
  }
  const confirmedScope = buildIdentityConfirmationScope(scope);
  return {
    ...identity,
    verified: false,
    identityVerified: false,
    matched: false,
    userConfirmed: true,
    identityUserConfirmed: true,
    reviewRequired: false,
    allowAnalyze: true,
    allowPersist: true,
    allowExport: true,
    blocking: false,
    confirmation: IDENTITY_CONFIRMATION.USER_CONFIRMED,
    confirmedScope,
    safeMessage: USER_CONFIRMED_SAFE_MESSAGE,
  };
}

/** Scope değişiminde veya uncheck: onay sıfırlanır. */
export function clearUserIdentityConfirmation(identity) {
  if (!identity || typeof identity !== "object") return identity;
  if (String(identity.sourceKind || "").toLowerCase() !== "excel") return identity;
  if (!canOfferExcelIdentityConfirmation({ ...identity, userConfirmed: false })) {
    return identity;
  }
  const status = identity.status;
  return {
    ...identity,
    verified: false,
    identityVerified: false,
    userConfirmed: false,
    identityUserConfirmed: false,
    reviewRequired: true,
    allowPersist: false,
    allowExport: false,
    confirmation: IDENTITY_CONFIRMATION.NONE,
    confirmedScope: null,
    safeMessage:
      SAFE_MESSAGES[status] ||
      "Excel girdide belge kimliği yok; kayıt için kullanıcı onayı gerekir.",
  };
}

/**
 * edefterUygun muhasebe/teknik sonucu olarak kalır.
 * Blocking identity → uygun/ready olamaz.
 * Export: identity allowExport kapalıysa canApproveExport false.
 */
export function applyIdentityGateToSummary(summary = {}, identity = null) {
  const next = { ...(summary || {}) };
  if (!identity) return next;
  next.identityStatus = identity.status;
  next.identityVerified = Boolean(identity.verified || identity.identityVerified);
  next.identityUserConfirmed = Boolean(
    identity.userConfirmed || identity.identityUserConfirmed
  );
  next.identityMatched = Boolean(identity.matched);
  next.identityReviewRequired = Boolean(identity.reviewRequired);
  next.identityConfirmation =
    identity.confirmation ||
    (next.identityUserConfirmed
      ? IDENTITY_CONFIRMATION.USER_CONFIRMED
      : next.identityVerified
        ? IDENTITY_CONFIRMATION.AUTO_MATCHED
        : identity.blocking
          ? IDENTITY_CONFIRMATION.BLOCKED
          : identity.reviewRequired
            ? IDENTITY_CONFIRMATION.UNVERIFIED
            : "");
  next.identityFingerprint = identity.safeFingerprint || "";
  next.identityMessage = identity.safeMessage || "";
  next.identityAllowAnalyze = Boolean(identity.allowAnalyze);
  next.identityAllowPersist = Boolean(identity.allowPersist);
  next.identityAllowExport = Boolean(identity.allowExport);

  if (identity.blocking) {
    next.edefterUygun = false;
    next.canApproveExport = false;
  }
  if (!identity.allowExport) {
    next.canApproveExport = false;
  }
  return next;
}

export { digitsOnly };
