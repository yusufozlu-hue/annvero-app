/**
 * Banka parser ↔ ANNVERO CORE köprüsü.
 *
 * Tasarım: Parser yeniden yazılmaz. Yalnızca movement mapping aşamasında
 * CORE kararı denenir; unknown/başarısız satırlar mevcut mapParsedRowToStandardMovement
 * ile legacy fallback alır (USE_ANNVERO_CORE=false → tamamen legacy).
 */

import { isAnnveroCoreEnabled, isAnnveroCoreDebugEnabled } from "@/src/config/annveroCoreFlags";
import { CORE_DECISION_STATUS } from "@/src/core/types/constants.js";
import {
  filterActiveBankParsedRows,
  mapParsedRowsToStandardMovements,
  mapSingleParsedRowToMovement,
} from "@/src/utils/bankMovementMapper";
import { resolve102BankAccount } from "@/src/utils/companyCenter";
import { bankRowToStandardTransaction } from "@/src/utils/bankStandardTransaction";

const BATCH_SIZE = 20;

function compactAccount(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
}

function isBankGlAccount(code = "") {
  const compact = compactAccount(code);
  return compact.startsWith("102");
}

export function isCoreDecisionUsable(coreResult = {}) {
  if (!coreResult || typeof coreResult !== "object") return false;
  if (coreResult.status === CORE_DECISION_STATUS.UNKNOWN) return false;
  const account = String(coreResult.suggested_account_code || "").trim();
  if (!account) return false;
  return true;
}

export function buildCoreDebugLines(description = "", coreResult = {}) {
  const entityName =
    coreResult.matched_entity?.entity_name ||
    coreResult.matched_entity?.name ||
    "—";
  const source = coreResult.decision_source || "unknown";
  const confidence = Math.round(Number(coreResult.confidence_score || 0) * 100);
  const account = coreResult.suggested_account_code || "—";
  const document = coreResult.suggested_document_type || "—";

  return [
    String(description || "—").trim(),
    "↓",
    `Entity: ${entityName}`,
    "↓",
    `Source: ${source}`,
    "↓",
    `Confidence: ${confidence}`,
    "↓",
    `Account: ${account}`,
    "↓",
    `Document: ${document}`,
  ];
}

export function formatCoreDebugText(description = "", coreResult = {}) {
  return buildCoreDebugLines(description, coreResult).join("\n");
}

function resolveCounterAccountFromCore(coreResult = {}, bankAccountCode = "102") {
  const primary = String(coreResult.suggested_account_code || "").trim();
  const secondary = String(coreResult.suggested_counter_account_code || "").trim();

  if (primary && !isBankGlAccount(primary)) return primary;
  if (secondary && !isBankGlAccount(secondary)) return secondary;
  if (primary) return primary;
  return secondary;
}

/**
 * CORE kararını banka movement satırına uygular (Luca pipeline uyumlu).
 */
export function mapCoreDecisionToMovement(coreResult = {}, rawRow = {}, context = {}) {
  const description = String(rawRow.aciklama || rawRow.description || "").trim();
  const amount = Math.abs(Number(rawRow.tutar ?? rawRow.amount ?? 0));
  const direction = rawRow.yon === "CIKIS" || rawRow.direction === "CIKIS" ? "CIKIS" : "GIRIS";
  const date = String(rawRow.tarih || rawRow.date || "");

  const { selectedCompany } = context;
  const bankLucaBase = resolve102BankAccount(
    selectedCompany?.bankAccounts || [],
    "102",
    selectedCompany?.bankAccounts?.find((b) => b.isActive !== false)?.lucaAccountCode || "102"
  );

  const counterAccountCode = resolveCounterAccountFromCore(coreResult, bankLucaBase);
  const lucaDescription =
    coreResult.suggested_description ||
    description;

  const warnings = [];
  if (!counterAccountCode) {
    warnings.push("CORE hesap önerisi eksik — legacy fallback önerilir");
  }

  const debugText = isAnnveroCoreDebugEnabled()
    ? formatCoreDebugText(description, coreResult)
    : "";

  return {
    id: `core-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    description,
    amount,
    direction,
    bankName: rawRow.banka || rawRow.bankName || context.selectedBank || "",
    rawRow,
    matchedRule: {
      source: "annvero_core",
      islem: "CORE",
      anahtar: coreResult.decision_source || "core",
      rule_id: coreResult.matched_rule?.rule_id || null,
    },
    matchedMemoryId: coreResult.matched_entity?.id || null,
    accountCode: bankLucaBase,
    counterAccountCode,
    documentType: coreResult.suggested_document_type || "DK",
    lucaDescription,
    warning: warnings.join(" | "),
    accountSuggestions: counterAccountCode
      ? [{ accountCode: counterAccountCode, accountName: coreResult.suggested_account_name || "" }]
      : [],
    accountPlanMissing: null,
    normalizedPlate: "",
    displayPlate: "",
    cariSuggestions: coreResult.suggested_cari
      ? [{ title: coreResult.suggested_cari, name: coreResult.suggested_cari }]
      : [],
    _coreMatched: true,
    _coreConfidence: Number(coreResult.confidence_score) || 0,
    _coreRiskLevel: coreResult.risk_level || "none",
    _coreDecisionSource: coreResult.decision_source || "unknown",
    _coreStatus: coreResult.status || "unknown",
    _coreSuggestedAccountName: coreResult.suggested_account_name || "",
    _coreVatRate: coreResult.suggested_vat_rate,
    _coreDebug: debugText,
    _coreDebugTrace: coreResult.debug_trace || [],
  };
}

export async function fetchCoreDecisionsBatch(transactions = [], fetchContext = {}) {
  if (!transactions.length) return [];

  const response = await fetch("/api/core/accounting-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      company_id: fetchContext.companyId || fetchContext.selectedCompanyId,
      transactions,
      include_debug: Boolean(fetchContext.includeDebug),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `CORE API ${response.status}`);
  }

  return Array.isArray(payload?.data?.decisions) ? payload.data.decisions : [];
}

async function fetchCoreDecisionsInChunks(transactions = [], fetchContext = {}) {
  const results = [];
  for (let offset = 0; offset < transactions.length; offset += BATCH_SIZE) {
    const chunk = transactions.slice(offset, offset + BATCH_SIZE);
    const chunkResults = await fetchCoreDecisionsBatch(chunk, fetchContext);
    results.push(...chunkResults);
  }
  return results;
}

/**
 * CORE öncelikli movement mapping; unknown → legacy fallback.
 */
export async function mapParsedRowsWithCoreFallback(parsedRows = [], context = {}, fetchContext = {}) {
  if (!isAnnveroCoreEnabled()) {
    return {
      movements: mapParsedRowsToStandardMovements(parsedRows, context),
      coreSummary: { enabled: false, core: 0, fallback: 0, total: 0 },
    };
  }

  const activeRows = filterActiveBankParsedRows(parsedRows);

  const standardTransactions = activeRows.map((row) =>
    bankRowToStandardTransaction(row, {
      companyId: context.selectedCompanyId,
      selectedCompanyId: context.selectedCompanyId,
      selectedBank: context.selectedBank,
      sourceType: context.sourceType || "bank",
      sourceFileName: context.sourceFileName || "",
      currency: context.currency || "TRY",
    })
  );

  let coreDecisions = [];
  let batchFailed = false;

  try {
    coreDecisions = await fetchCoreDecisionsInChunks(standardTransactions, {
      ...fetchContext,
      companyId: context.selectedCompanyId,
      includeDebug: isAnnveroCoreDebugEnabled(),
    });
  } catch (error) {
    console.warn("[bank-core] batch API failed — full legacy fallback", error);
    batchFailed = true;
  }

  if (batchFailed) {
    return {
      movements: mapParsedRowsToStandardMovements(parsedRows, context),
      coreSummary: {
        enabled: true,
        core: 0,
        fallback: activeRows.length,
        total: activeRows.length,
        batchError: true,
      },
    };
  }

  const movements = [];
  let coreCount = 0;
  let fallbackCount = 0;

  activeRows.forEach((row, index) => {
    const coreResult = coreDecisions[index] || null;

    if (isCoreDecisionUsable(coreResult)) {
      movements.push(mapCoreDecisionToMovement(coreResult, row, context));
      coreCount += 1;
      return;
    }

    movements.push({
      ...mapSingleParsedRowToMovement(row, context, index),
      _coreFallback: true,
    });
    fallbackCount += 1;
  });

  return {
    movements,
    coreSummary: {
      enabled: true,
      core: coreCount,
      fallback: fallbackCount,
      total: activeRows.length,
      batchError: false,
    },
  };
}

export { isAnnveroCoreEnabled, isAnnveroCoreDebugEnabled };
