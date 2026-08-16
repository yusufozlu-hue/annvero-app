/**
 * Firma bağlamıyla Excel banka çözümü.
 * Sıra: güçlü kimlik → hesap eşleşmesi → firma schema memory → benzersiz format → onay.
 */

import {
  canonicalizeBankId,
  toParserBankId,
} from "@/src/utils/bankIdentity";
import {
  detectExcelBank,
  BANK_EXCEL_DETECTOR_VERSION,
} from "@/src/utils/bankExcelAutoDetect";
import { extractBankStatementCompanySignals } from "@/src/utils/bankStatementCompanyGuard";
import {
  buildBankStatementSchemaFingerprint,
} from "@/src/utils/bankStatementSchemaFingerprint";
import {
  findConfirmedStatementFormatMemory,
  loadCompanyStatementFormatMemory,
  STATEMENT_FORMAT_CONFIRMATION_SOURCE,
} from "@/src/utils/bankStatementFormatMemory";

export const BANK_RESOLUTION_SOURCE = Object.freeze({
  STRONG_STATEMENT_IDENTITY: "strong_statement_identity",
  COMPANY_ACCOUNT_MATCH: "company_account_match",
  COMPANY_SCHEMA_MEMORY: "company_schema_memory",
  UNIQUE_FORMAT_FINGERPRINT: "unique_format_fingerprint",
  REQUIRES_CONFIRMATION: "requires_confirmation",
  UNKNOWN: "unknown",
});

const IBAN_BANK_CODE_TO_CANONICAL = Object.freeze({
  "00010": "ZIRAAT",
  "00015": "VAKIFBANK",
  "00032": "TEB",
  "00062": "GARANTI",
  "00205": "KUVEYTTURK",
});

const STRONG_SIGNAL_PREFIXES = ["brand_", "iban_", "bic_"];
const EXCLUSIVE_FORMAT_CODES = new Set([
  "header_vakif_native",
  "header_ziraat_export",
]);

function compactIban(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function ibanBankCode(iban = "") {
  const compact = compactIban(iban);
  if (!/^TR\d{24}$/.test(compact)) return "";
  return compact.slice(4, 9);
}

function hasStrongIdentitySignals(diagnostics = {}) {
  const signals = diagnostics.matchedSignals || [];
  return signals.some((code) =>
    STRONG_SIGNAL_PREFIXES.some((p) => String(code).startsWith(p))
  );
}

function hasExclusiveFormatSignal(diagnostics = {}) {
  const signals = diagnostics.matchedSignals || [];
  return signals.some((code) => EXCLUSIVE_FORMAT_CODES.has(code));
}

function buildDetectedResult({
  canonicalBankId,
  confidence = "high",
  resolutionSource,
  diagnostics = null,
  base = null,
}) {
  const canonical = canonicalizeBankId(canonicalBankId);
  const parserBankId = toParserBankId(canonical) || null;
  const conf =
    String(confidence || "high").toLowerCase() === "high" ? "high" : confidence;
  return {
    status: "detected",
    confidence: conf,
    bankId: canonical,
    parserBankId,
    canonicalBankId: canonical,
    selectedBank: canonical,
    detected: canonical,
    resolutionSource,
    diagnostics: {
      ...(diagnostics || base?.diagnostics || {}),
      selectedBank: canonical,
      parserBankId,
      canonicalBankId: canonical,
      confidence: conf,
      status: "DETECTED",
      resolutionSource,
      detectorVersion:
        diagnostics?.detectorVersion ||
        base?.diagnostics?.detectorVersion ||
        BANK_EXCEL_DETECTOR_VERSION,
    },
  };
}

function buildConfirmationResult({ base = null, fingerprint = null, reason = "" } = {}) {
  return {
    status: "requires_confirmation",
    confidence: "unknown",
    bankId: null,
    parserBankId: null,
    canonicalBankId: null,
    selectedBank: null,
    detected: "REQUIRES_CONFIRMATION",
    resolutionSource: BANK_RESOLUTION_SOURCE.REQUIRES_CONFIRMATION,
    fingerprint,
    diagnostics: {
      ...(base?.diagnostics || {}),
      status: "REQUIRES_CONFIRMATION",
      selectedBank: null,
      parserBankId: null,
      canonicalBankId: null,
      confidence: "unknown",
      resolutionSource: BANK_RESOLUTION_SOURCE.REQUIRES_CONFIRMATION,
      ambiguityReason: reason || base?.diagnostics?.ambiguityReason || "needs_user_confirmation",
      detectorVersion:
        base?.diagnostics?.detectorVersion || BANK_EXCEL_DETECTOR_VERSION,
    },
  };
}

/**
 * Ekstre sinyallerini firma bankAccounts / 102 yapraklarıyla eşleştir.
 * Gerçek IBAN/hesap değerleri döndürülmez — yalnız kanonik banka + maskeli özet.
 */
export function matchStatementAccountToCompanyBanks({
  sheetRows = [],
  fileName = "",
  bankAccounts = [],
  accountPlan102 = [],
} = {}) {
  const signals = extractBankStatementCompanySignals({ sheetRows, fileName });
  const activeBanks = (bankAccounts || []).filter((b) => b && b.isActive !== false);

  const hits = [];

  for (const bank of activeBanks) {
    const canonical = canonicalizeBankId(
      bank.bankName || bank.bank || bank.accountName || ""
    );
    if (!canonical) continue;

    const companyIban = compactIban(bank.iban || bank.IBAN || "");
    const companyAcct = digitsOnly(
      bank.accountNumber || bank.hesapNo || bank.accountNo || ""
    );

    let matched = false;
    let matchKind = "";

    if (companyIban && (signals.ibans || []).includes(companyIban)) {
      matched = true;
      matchKind = "iban_exact";
    } else if (
      companyAcct.length >= 6 &&
      (signals.accountNumbers || []).some(
        (n) => n === companyAcct || n.endsWith(companyAcct) || companyAcct.endsWith(n)
      )
    ) {
      matched = true;
      matchKind = "account_number";
    }

    if (matched) {
      hits.push({
        canonicalBankId: canonical,
        matchKind,
        maskedIban: companyIban
          ? `iban:${companyIban.slice(0, 4)}…${companyIban.slice(-4)}`
          : "",
      });
    }
  }

  // 102 yaprak: hesap adında banka + ekstre IBAN banka kodu tek aday
  if (!hits.length && (signals.ibans || []).length && (accountPlan102 || []).length) {
    for (const iban of signals.ibans) {
      const code = ibanBankCode(iban);
      const fromCode = IBAN_BANK_CODE_TO_CANONICAL[code];
      if (!fromCode) continue;
      const leafHits = (accountPlan102 || []).filter((row) => {
        const name = String(
          row.accountName || row.hesapAdi || row.name || ""
        );
        return canonicalizeBankId(name) === fromCode;
      });
      if (leafHits.length === 1) {
        hits.push({
          canonicalBankId: fromCode,
          matchKind: "plan102_iban_bank_code",
          maskedIban: `iban:${compactIban(iban).slice(0, 4)}…${compactIban(iban).slice(-4)}`,
        });
      }
    }
  }

  const unique = [...new Set(hits.map((h) => h.canonicalBankId))];
  if (unique.length === 1) {
    return {
      status: "unique",
      canonicalBankId: unique[0],
      matchKind: hits[0].matchKind,
      hitCount: hits.length,
      hasStatementIdentity: Boolean(
        (signals.ibans || []).length || (signals.accountNumbers || []).length
      ),
    };
  }
  if (unique.length > 1) {
    return {
      status: "ambiguous",
      canonicalBankId: null,
      candidates: unique,
      hitCount: hits.length,
      hasStatementIdentity: true,
    };
  }
  return {
    status: "none",
    canonicalBankId: null,
    hitCount: 0,
    hasStatementIdentity: Boolean(
      (signals.ibans || []).length || (signals.accountNumbers || []).length
    ),
  };
}

/**
 * @param {unknown[][]} sheetRows
 * @param {object} [options]
 */
export function resolveExcelBankWithCompanyContext(sheetRows, options = {}) {
  const base = detectExcelBank(sheetRows, {
    fileName: options.fileName || "",
    sheetName: options.sheetName || "",
    scanLimit: options.scanLimit,
  });

  const fingerprint = buildBankStatementSchemaFingerprint(sheetRows, {
    sheetName: options.sheetName || "",
    currency: options.currency || "TRY",
  });

  // A — güçlü statement identity
  if (
    base.status === "detected" &&
    base.bankId &&
    hasStrongIdentitySignals(base.diagnostics)
  ) {
    return buildDetectedResult({
      canonicalBankId: base.bankId,
      confidence: "HIGH",
      resolutionSource: BANK_RESOLUTION_SOURCE.STRONG_STATEMENT_IDENTITY,
      diagnostics: base.diagnostics,
      base,
    });
  }

  // B — firma banka hesabı kesin eşleşme
  const companyId = String(options.companyId || "").trim();
  const accountMatch = matchStatementAccountToCompanyBanks({
    sheetRows,
    fileName: options.fileName || "",
    bankAccounts: options.bankAccounts || [],
    accountPlan102: options.accountPlan102 || [],
  });

  if (accountMatch.status === "unique" && accountMatch.canonicalBankId) {
    return buildDetectedResult({
      canonicalBankId: accountMatch.canonicalBankId,
      confidence: "HIGH",
      resolutionSource: BANK_RESOLUTION_SOURCE.COMPANY_ACCOUNT_MATCH,
      diagnostics: {
        ...(base.diagnostics || {}),
        accountMatchKind: accountMatch.matchKind,
      },
      base,
    });
  }

  // C — firma-scoped doğrulanmış schema memory
  if (companyId) {
    const memoryRecords =
      options.formatMemoryRecords != null
        ? options.formatMemoryRecords
        : loadCompanyStatementFormatMemory(companyId);
    const memory = findConfirmedStatementFormatMemory({
      companyId,
      schemaFingerprint: fingerprint.schemaFingerprint,
      currency: fingerprint.currency,
      directionModel: fingerprint.directionModel,
      records: memoryRecords,
    });
    if (memory?.canonicalBankId) {
      return buildDetectedResult({
        canonicalBankId: memory.canonicalBankId,
        confidence: "HIGH",
        resolutionSource: BANK_RESOLUTION_SOURCE.COMPANY_SCHEMA_MEMORY,
        diagnostics: {
          ...(base.diagnostics || {}),
          schemaFingerprint: fingerprint.schemaFingerprint,
          confirmationSource: memory.confirmationSource,
        },
        base,
      });
    }
  }

  // D — güçlü ve benzersiz format fingerprint (Ziraat/Vakıf exclusive)
  if (
    base.status === "detected" &&
    base.bankId &&
    hasExclusiveFormatSignal(base.diagnostics)
  ) {
    return buildDetectedResult({
      canonicalBankId: base.bankId,
      confidence: base.confidence || "high",
      resolutionSource: BANK_RESOLUTION_SOURCE.UNIQUE_FORMAT_FINGERPRINT,
      diagnostics: base.diagnostics,
      base,
    });
  }

  // Ham detect DETECTED ama yalnız zayıf format → onay iste (global Garanti seçme)
  if (base.status === "detected" && base.bankId) {
    // Brand/IBAN/BIC yok, exclusive yok → güvenli değil
    if (
      !hasStrongIdentitySignals(base.diagnostics) &&
      !hasExclusiveFormatSignal(base.diagnostics)
    ) {
      return buildConfirmationResult({
        base,
        fingerprint,
        reason: "weak_format_without_identity",
      });
    }
    return buildDetectedResult({
      canonicalBankId: base.bankId,
      confidence: base.confidence || "medium",
      resolutionSource: BANK_RESOLUTION_SOURCE.UNIQUE_FORMAT_FINGERPRINT,
      diagnostics: base.diagnostics,
      base,
    });
  }

  // Ambiguous / unknown / TEB↔Garanti çakışması → onay
  if (base.status === "ambiguous" || accountMatch.status === "ambiguous") {
    return buildConfirmationResult({
      base,
      fingerprint,
      reason: "ambiguous_candidates",
    });
  }

  return buildConfirmationResult({
    base,
    fingerprint,
    reason: base.diagnostics?.ambiguityReason || "no_strong_signal",
  });
}

export { STATEMENT_FORMAT_CONFIRMATION_SOURCE };
