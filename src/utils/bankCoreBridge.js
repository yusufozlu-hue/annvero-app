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
  mapSingleParsedRowToMovement,
} from "@/src/utils/bankMovementMapper";
import { extractCorePreviewFields } from "@/src/utils/bankCorePreview";
import { resolve102BankAccount } from "@/src/utils/companyCenter";
import { bankRowToStandardTransaction } from "@/src/utils/bankStandardTransaction";

const BATCH_SIZE = 20;
/** Batch başına CORE API bekleme süresi (ms) */
export const CORE_BATCH_TIMEOUT_MS = 10_000;
/** Tüm CORE aşaması için üst süre (ms) */
export const CORE_TOTAL_BUDGET_MS = 45_000;
export const DEFAULT_CORE_PREVIEW_LIMIT = 100;

const CORE_PARTIAL_USER_WARNING =
  "Bazı satırlar CORE tarafından değerlendirilemedi, unknown olarak işaretlendi.";

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

  const preview = extractCorePreviewFields(coreResult);

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
    ...preview,
    corePreview: preview,
  };
}

function withCorePreview(movement, coreResult, extra = {}) {
  const preview = extractCorePreviewFields(coreResult, { ...movement, ...extra });
  return {
    ...movement,
    ...extra,
    ...preview,
    corePreview: preview,
  };
}

function normalizeCoreMatchKey(transaction = {}) {
  const desc = String(transaction.raw_description || "")
    .replaceAll("ı", "i")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/[.,/()\-_*:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const direction = String(transaction?.raw_payload?.direction || "").toUpperCase();
  return `${desc}|${direction}`;
}

function buildUnknownCoreStub(reason = "unknown") {
  return {
    status: CORE_DECISION_STATUS.UNKNOWN || "unknown",
    decision_source: reason,
    confidence_score: 0,
    suggested_account_code: "",
  };
}

/**
 * Tek CORE batch — AbortController timeout + parent signal.
 * Sonsuza kadar beklemez; { status, decisions } döner.
 */
export async function fetchCoreDecisionsBatch(transactions = [], fetchContext = {}) {
  if (!transactions.length) {
    return { status: "success", decisions: [] };
  }

  const timeoutMs = Number(fetchContext.batchTimeoutMs) || CORE_BATCH_TIMEOUT_MS;
  const parentSignal = fetchContext.signal || null;

  if (parentSignal?.aborted) {
    return { status: "aborted", decisions: [] };
  }

  const controller = new AbortController();
  const onParentAbort = () => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  };

  if (parentSignal) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  try {
    const response = await fetch("/api/core/accounting-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({
        company_id: fetchContext.companyId || fetchContext.selectedCompanyId,
        transactions,
        include_debug: Boolean(fetchContext.includeDebug),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "error",
        decisions: [],
        errorCode: response.status,
      };
    }

    return {
      status: "success",
      decisions: Array.isArray(payload?.data?.decisions) ? payload.data.decisions : [],
    };
  } catch (error) {
    if (parentSignal?.aborted) {
      return { status: "aborted", decisions: [] };
    }
    if (error?.name === "AbortError" || controller.signal.aborted) {
      return { status: "timeout", decisions: [] };
    }
    return { status: "error", decisions: [] };
  } finally {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  }
}

/**
 * Unique açıklama anahtarlarıyla CORE batch'leri.
 * Timeout/hata olan batch atlanır; sonraki batch'lere devam edilir.
 */
async function fetchCoreDecisionsInChunks(transactions = [], fetchContext = {}) {
  const { yieldToMain, assertNotAborted, ParseAbortError } = await import(
    "@/src/utils/asyncChunkProcess"
  );

  const startedAt = Date.now();
  const totalBudgetMs = Number(fetchContext.totalBudgetMs) || CORE_TOTAL_BUDGET_MS;
  const onProgress = fetchContext.onProgress || null;

  const decisionsByIndex = new Array(transactions.length).fill(null);
  const decisionCache = new Map();
  const batchReports = [];

  // Unique normalized description → representative + row indices
  const uniqueOrder = [];
  const uniqueByKey = new Map();

  transactions.forEach((tx, index) => {
    const key = normalizeCoreMatchKey(tx);
    let entry = uniqueByKey.get(key);
    if (!entry) {
      entry = { key, sample: tx, indices: [] };
      uniqueByKey.set(key, entry);
      uniqueOrder.push(entry);
    }
    entry.indices.push(index);
  });

  let successBatches = 0;
  let timeoutBatches = 0;
  let errorBatches = 0;
  let skippedByBudget = 0;
  let uniqueRequested = 0;

  for (let offset = 0; offset < uniqueOrder.length; offset += BATCH_SIZE) {
    if (fetchContext.signal?.aborted) {
      throw new ParseAbortError();
    }
    assertNotAborted(fetchContext.signal);

    const elapsed = Date.now() - startedAt;
    if (elapsed >= totalBudgetMs) {
      skippedByBudget = uniqueOrder.length - offset;
      break;
    }

    const slice = uniqueOrder.slice(offset, offset + BATCH_SIZE);
    const chunkTxs = slice.map((entry) => entry.sample);
    uniqueRequested += chunkTxs.length;

    onProgress?.({
      stage: "Öğrenme sistemi kontrol ediliyor",
      detail: `CORE batch ${Math.floor(offset / BATCH_SIZE) + 1}/${Math.ceil(uniqueOrder.length / BATCH_SIZE) || 1}`,
      percent: 35 + Math.round((offset / Math.max(uniqueOrder.length, 1)) * 10),
    });

    const remainingBudget = totalBudgetMs - elapsed;
    const batchTimeoutMs = Math.min(
      Number(fetchContext.batchTimeoutMs) || CORE_BATCH_TIMEOUT_MS,
      Math.max(1_000, remainingBudget)
    );

    const batchResult = await fetchCoreDecisionsBatch(chunkTxs, {
      ...fetchContext,
      batchTimeoutMs,
    });

    batchReports.push({
      offset,
      size: chunkTxs.length,
      status: batchResult.status,
    });

    if (batchResult.status === "aborted") {
      throw new ParseAbortError();
    }

    if (batchResult.status === "success") {
      successBatches += 1;
      slice.forEach((entry, i) => {
        const decision = batchResult.decisions[i] || buildUnknownCoreStub("unknown");
        decisionCache.set(entry.key, decision);
        for (const rowIndex of entry.indices) {
          decisionsByIndex[rowIndex] = decision;
        }
      });
    } else if (batchResult.status === "timeout") {
      timeoutBatches += 1;
      const stub = buildUnknownCoreStub("core_timeout");
      slice.forEach((entry) => {
        decisionCache.set(entry.key, stub);
        for (const rowIndex of entry.indices) {
          decisionsByIndex[rowIndex] = stub;
        }
      });
    } else {
      errorBatches += 1;
      const stub = buildUnknownCoreStub("core_error");
      slice.forEach((entry) => {
        decisionCache.set(entry.key, stub);
        for (const rowIndex of entry.indices) {
          decisionsByIndex[rowIndex] = stub;
        }
      });
    }

    await yieldToMain(0);
  }

  // Bütçe nedeniyle hiç istenmeyen unique'ler → unknown
  if (skippedByBudget > 0) {
    const stub = buildUnknownCoreStub("core_budget");
    for (let i = uniqueOrder.length - skippedByBudget; i < uniqueOrder.length; i += 1) {
      const entry = uniqueOrder[i];
      if (decisionCache.has(entry.key)) continue;
      decisionCache.set(entry.key, stub);
      for (const rowIndex of entry.indices) {
        decisionsByIndex[rowIndex] = stub;
      }
    }
  }

  const partial =
    timeoutBatches > 0 || errorBatches > 0 || skippedByBudget > 0;

  return {
    decisionsByIndex,
    batchReports,
    meta: {
      uniqueDescriptions: uniqueOrder.length,
      uniqueRequested,
      successBatches,
      timeoutBatches,
      errorBatches,
      skippedByBudget,
      partial,
      elapsedMs: Date.now() - startedAt,
      batchTimeoutMs: Number(fetchContext.batchTimeoutMs) || CORE_BATCH_TIMEOUT_MS,
      totalBudgetMs,
    },
  };
}

/**
 * CORE öncelikli movement mapping; unknown → legacy fallback.
 * CORE API timeout/hata tüm önizlemeyi bloke etmez.
 */
export async function mapParsedRowsWithCoreFallback(parsedRows = [], context = {}, fetchContext = {}) {
  if (!isAnnveroCoreEnabled()) {
    const { mapParsedRowsToStandardMovementsAsync } = await import(
      "@/src/utils/bankMovementMapper"
    );
    const legacyMovements = await mapParsedRowsToStandardMovementsAsync(
      parsedRows,
      context,
      {
        chunkSize: 40,
        signal: fetchContext.signal || null,
      }
    );
    return {
      movements: legacyMovements.map((m) =>
        withCorePreview(m, null, { _coreFallback: true })
      ),
      coreSummary: { enabled: false, core: 0, fallback: 0, total: 0, coreLimit: 0 },
    };
  }

  const { mapInChunksAsync, assertNotAborted, yieldToMain, ParseAbortError } = await import(
    "@/src/utils/asyncChunkProcess"
  );

  const activeRows = filterActiveBankParsedRows(parsedRows);
  const coreRowLimit =
    fetchContext.coreRowLimit === Infinity || fetchContext.coreRowLimit === "all"
      ? activeRows.length
      : fetchContext.coreRowLimit != null
        ? Math.max(0, Number(fetchContext.coreRowLimit) || 0)
        : Math.min(DEFAULT_CORE_PREVIEW_LIMIT, activeRows.length);

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

  const transactionsForCore = standardTransactions.slice(0, coreRowLimit);
  let decisionsByIndex = new Array(coreRowLimit).fill(null);
  let fetchMeta = {
    uniqueDescriptions: 0,
    uniqueRequested: 0,
    successBatches: 0,
    timeoutBatches: 0,
    errorBatches: 0,
    skippedByBudget: 0,
    partial: false,
    elapsedMs: 0,
    batchTimeoutMs: CORE_BATCH_TIMEOUT_MS,
    totalBudgetMs: CORE_TOTAL_BUDGET_MS,
  };

  if (transactionsForCore.length > 0) {
    try {
      const fetched = await fetchCoreDecisionsInChunks(transactionsForCore, {
        ...fetchContext,
        companyId: context.selectedCompanyId,
        includeDebug: isAnnveroCoreDebugEnabled(),
      });
      decisionsByIndex = fetched.decisionsByIndex;
      fetchMeta = { ...fetchMeta, ...fetched.meta };
    } catch (error) {
      if (error instanceof ParseAbortError || error?.name === "ParseAbortError") {
        throw error;
      }
      // Beklenmeyen hata: tüm CORE satırları unknown stub; önizleme devam eder
      console.warn("[bank-core] CORE fetch failed — unknown fallback", error?.message || error);
      const stub = buildUnknownCoreStub("core_error");
      decisionsByIndex = transactionsForCore.map(() => stub);
      fetchMeta = {
        ...fetchMeta,
        partial: true,
        errorBatches: 1,
      };
    }
  }

  let coreCount = 0;
  let fallbackCount = 0;
  let skippedCount = 0;
  let unknownFromCore = 0;

  const built = await mapInChunksAsync(
    activeRows,
    (row, index) => {
      if (index >= coreRowLimit) {
        skippedCount += 1;
        fallbackCount += 1;
        return withCorePreview(mapSingleParsedRowToMovement(row, context, index), null, {
          _coreSkipped: true,
          _coreFallback: true,
        });
      }

      const coreResult = decisionsByIndex[index] || buildUnknownCoreStub("unknown");

      if (isCoreDecisionUsable(coreResult)) {
        coreCount += 1;
        return mapCoreDecisionToMovement(coreResult, row, context);
      }

      fallbackCount += 1;
      if (
        coreResult?.decision_source === "core_timeout" ||
        coreResult?.decision_source === "core_error" ||
        coreResult?.decision_source === "core_budget"
      ) {
        unknownFromCore += 1;
      }

      return withCorePreview(mapSingleParsedRowToMovement(row, context, index), coreResult, {
        _coreFallback: true,
        _coreDecisionSource: coreResult?.decision_source || "unknown",
        _coreStatus: coreResult?.status || "unknown",
        _coreConfidence: Number(coreResult?.confidence_score) || 0,
        _coreRiskLevel: coreResult?.risk_level || "none",
      });
    },
    {
      chunkSize: 40,
      signal: fetchContext.signal || null,
      onChunk: () => {
        assertNotAborted(fetchContext.signal);
      },
    }
  );

  await yieldToMain(0);

  const partial = Boolean(fetchMeta.partial) || unknownFromCore > 0;

  return {
    movements: built,
    coreSummary: {
      enabled: true,
      core: coreCount,
      fallback: fallbackCount,
      total: activeRows.length,
      coreLimit: coreRowLimit,
      skipped: skippedCount,
      unknownFromCore,
      partial,
      userWarning: partial ? CORE_PARTIAL_USER_WARNING : "",
      batchTimeoutMs: fetchMeta.batchTimeoutMs,
      totalBudgetMs: fetchMeta.totalBudgetMs,
      coreElapsedMs: fetchMeta.elapsedMs,
      uniqueDescriptions: fetchMeta.uniqueDescriptions,
      uniqueRequested: fetchMeta.uniqueRequested,
      successBatches: fetchMeta.successBatches,
      timeoutBatches: fetchMeta.timeoutBatches,
      errorBatches: fetchMeta.errorBatches,
      skippedByBudget: fetchMeta.skippedByBudget,
      batchError: false,
    },
  };
}

export { isAnnveroCoreEnabled, isAnnveroCoreDebugEnabled };
