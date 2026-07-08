/**
 * Banka & Kart Operasyon Merkezi — tanıma / durum pipeline'ı.
 * Sıra: öğrenen hafıza → kural motoru (firma/banka/açıklama/kart) → risk / mükerrer → fişe hazır.
 */

import { normalizeParserText } from "@/src/utils/textNormalize";
import {
  RECOGNITION_STATUS,
  createNormalizedFinancialTransaction,
} from "@/src/models/normalizedFinancialTransaction";
import {
  applyMovementSuggestionsToTransaction,
  bankParsedRowsToNormalizedTransactions,
} from "@/src/utils/bankToNormalizedTransaction";

const HIGH_CONFIDENCE = 80;
const SUGGEST_CONFIDENCE = 50;

function textOf(tx) {
  return normalizeParserText(tx.description_normalized || tx.description_raw || "");
}

function matchLearningMemory(tx, learningMemory = [], context = {}) {
  const text = textOf(tx);
  if (!text) return null;

  const bankName = normalizeParserText(tx.bank_name || context.selectedBank || "");
  let best = null;
  let bestScore = 0;

  for (const record of learningMemory || []) {
    if (record?.is_active === false) continue;
    const keyword = normalizeParserText(record.keyword || record.raw_description || "");
    if (!keyword || !text.includes(keyword)) continue;

    let score = Math.min(95, 40 + keyword.length);
    const recordBank = normalizeParserText(
      record.account_name || record.bank_name || record.transaction_type || ""
    );
    if (bankName && recordBank && recordBank === bankName) score += 15;
    if (context.companyId && record.company_id === context.companyId) score += 10;

    if (score > bestScore) {
      bestScore = score;
      best = { record, score };
    }
  }

  return best;
}

/**
 * Firma / banka / açıklama / kart bazlı kural eşleştirme.
 * accountingRules (kaynakTipi Banka) + companyRules.banka + opsiyonel kart kuralları.
 */
function matchRuleEngine(tx, context = {}) {
  const text = textOf(tx);
  if (!text) return null;

  const accountingRules = context.accountingRules || [];
  const companyRules = context.companyRules || {};
  const bankRules = companyRules.banka || [];
  const cardRules = companyRules.kredi_karti || companyRules.kart || [];

  let best = null;
  let bestPriority = -Infinity;

  for (const rule of accountingRules) {
    if (rule?.isActive === false) continue;
    const kaynak = normalizeParserText(rule.kaynakTipi || "");
    if (kaynak && kaynak !== "BANKA" && kaynak !== "KREDIKARTI" && kaynak !== "KART") {
      continue;
    }
    const needle = normalizeParserText(rule.aramaMetni || "");
    if (!needle) continue;

    let matched = false;
    if (rule.useRegex) {
      try {
        matched = new RegExp(rule.aramaMetni, "i").test(tx.description_raw || "");
      } catch {
        matched = text.includes(needle);
      }
    } else {
      matched = text.includes(needle);
    }
    if (!matched) continue;

    const priority = Number(rule.oncelik ?? 0);
    if (priority >= bestPriority) {
      bestPriority = priority;
      best = {
        source: "accounting_rule",
        rule,
        accountCode: rule.hesapKodu || "",
        counterAccountCode: rule.karsiHesapKodu || "",
        documentType: rule.belgeTuru || "DK",
        score: 70 + Math.min(20, priority),
      };
    }
  }

  for (const rule of bankRules) {
    const keyword = normalizeParserText(rule.anahtar || rule.keyword || "");
    if (!keyword || !text.includes(keyword)) continue;
    const score = 60 + keyword.length;
    if (!best || score > best.score) {
      best = {
        source: "company_bank_rule",
        rule,
        accountCode: rule.hesapKodu || rule.accountCode || "",
        counterAccountCode: rule.karsiHesapKodu || "",
        documentType: rule.belgeTuru || "DK",
        score,
      };
    }
  }

  // Kart bazlı altyapı (bugün satır yoksa bile eşleştirme noktası hazır)
  if (tx.source_type === "credit_card" || text.includes("KREDIKART") || textIncludesCard(text)) {
    for (const rule of cardRules) {
      const keyword = normalizeParserText(rule.anahtar || rule.keyword || rule.cardLast4 || "");
      if (!keyword || !text.includes(keyword)) continue;
      const score = 65 + keyword.length;
      if (!best || score > best.score) {
        best = {
          source: "company_card_rule",
          rule,
          accountCode: rule.hesapKodu || rule.accountCode || "",
          counterAccountCode: rule.karsiHesapKodu || "",
          documentType: rule.belgeTuru || "DK",
          score,
        };
      }
    }
  }

  return best;
}

function textIncludesCard(text) {
  return (
    text.includes("KREDI") && text.includes("KART")
  ) || text.includes("KK ODEME") || text.includes("KREDIKARTIODEME");
}

function buildDuplicateKey(tx) {
  return [
    normalizeParserText(tx.company_id),
    normalizeParserText(tx.bank_name),
    normalizeParserText(tx.transaction_date),
    normalizeParserText(tx.document_no),
    String(tx.debit_amount || 0),
    String(tx.credit_amount || 0),
    normalizeParserText(tx.description_normalized).slice(0, 80),
  ].join("|");
}

function detectDuplicates(transactions = []) {
  const seen = new Map();
  const flagsById = new Map();

  for (const tx of transactions) {
    const key = buildDuplicateKey(tx);
    if (seen.has(key)) {
      const firstId = seen.get(key);
      flagsById.set(tx.id, [...(flagsById.get(tx.id) || []), "duplicate"]);
      flagsById.set(firstId, [...(flagsById.get(firstId) || []), "duplicate"]);
    } else {
      seen.set(key, tx.id);
    }
  }

  return flagsById;
}

function detectRiskFlags(tx) {
  const flags = [...(tx.risk_flags || [])];
  const amount = Math.max(Number(tx.debit_amount || 0), Number(tx.credit_amount || 0));

  if (!tx.description_raw || normalizeParserText(tx.description_raw).length < 3) {
    flags.push("empty_description");
  }
  if (amount <= 0) flags.push("zero_amount");
  if (tx.debit_amount > 0 && tx.credit_amount > 0) flags.push("both_debit_credit");
  if (amount >= 500000) flags.push("high_amount");

  return [...new Set(flags)];
}

function resolveStatus({ confidence, hasAccounts, riskFlags, isDuplicate }) {
  if (isDuplicate || (riskFlags || []).includes("duplicate")) {
    return RECOGNITION_STATUS.DUPLICATE;
  }
  if ((riskFlags || []).some((f) => f !== "duplicate")) {
    if (confidence < SUGGEST_CONFIDENCE) return RECOGNITION_STATUS.RISKY;
  }
  if (hasAccounts && confidence >= HIGH_CONFIDENCE) {
    return RECOGNITION_STATUS.READY_FOR_VOUCHER;
  }
  if (hasAccounts && confidence >= SUGGEST_CONFIDENCE) {
    return confidence >= HIGH_CONFIDENCE
      ? RECOGNITION_STATUS.RECOGNIZED
      : RECOGNITION_STATUS.SUGGESTED;
  }
  if (hasAccounts) return RECOGNITION_STATUS.SUGGESTED;
  if (confidence > 0) return RECOGNITION_STATUS.SUGGESTED;
  return RECOGNITION_STATUS.UNKNOWN;
}

/**
 * Tek hareketi tanır.
 */
export function recognizeFinancialTransaction(tx, context = {}) {
  let next = createNormalizedFinancialTransaction(tx);
  let confidence = 0;
  let matchSource = "";

  const memoryHit = matchLearningMemory(next, context.learningMemory, context);
  if (memoryHit) {
    const rec = memoryHit.record;
    next.suggested_account_code =
      next.suggested_account_code || rec.account_code || rec.hesap_kodu || "";
    next.suggested_counter_account_code =
      next.suggested_counter_account_code ||
      rec.counter_account_code ||
      rec.karsi_hesap_kodu ||
      "";
    next.suggested_cari = next.suggested_cari || rec.cari_name || "";
    next.suggested_document_type =
      next.suggested_document_type || rec.document_type || rec.belge_turu || "DK";
    confidence = Math.max(confidence, memoryHit.score);
    matchSource = "learning_memory";
  }

  const ruleHit = matchRuleEngine(next, context);
  if (ruleHit && ruleHit.score >= confidence) {
    next.suggested_account_code =
      next.suggested_account_code || ruleHit.accountCode || "";
    next.suggested_counter_account_code =
      next.suggested_counter_account_code || ruleHit.counterAccountCode || "";
    next.suggested_document_type =
      next.suggested_document_type || ruleHit.documentType || "DK";
    confidence = Math.max(confidence, ruleHit.score);
    matchSource = ruleHit.source;
  }

  // Mevcut movement mapper önerileri (bankParser sonucu) varsa al
  if (context.movementByLegacyIndex || context.movements) {
    // handled in batch
  }

  const riskFlags = detectRiskFlags(next);
  const hasAccounts = Boolean(
    next.suggested_account_code && next.suggested_counter_account_code
  );

  next.confidence_score = confidence;
  next.risk_flags = riskFlags;
  next._match_source = matchSource;
  next.recognition_status = resolveStatus({
    confidence,
    hasAccounts,
    riskFlags,
    isDuplicate: riskFlags.includes("duplicate"),
  });
  next.updated_at = new Date().toISOString();

  return next;
}

/**
 * Banka parse sonucu + movement satırlarından tam tanıma batch'i.
 */
export function buildRecognizedFinancialTransactions({
  normalizedBankRows = [],
  movementRows = [],
  context = {},
}) {
  let transactions = bankParsedRowsToNormalizedTransactions(normalizedBankRows, context);

  transactions = transactions.map((tx, index) => {
    const movement = movementRows[index];
    const withMovement = movement
      ? applyMovementSuggestionsToTransaction(tx, movement)
      : tx;
    return recognizeFinancialTransaction(withMovement, context);
  });

  const dupFlags = detectDuplicates(transactions);
  transactions = transactions.map((tx) => {
    const extra = dupFlags.get(tx.id) || [];
    if (!extra.length) return tx;
    const risk_flags = [...new Set([...(tx.risk_flags || []), ...extra])];
    const recognition_status = resolveStatus({
      confidence: tx.confidence_score,
      hasAccounts: Boolean(
        tx.suggested_account_code && tx.suggested_counter_account_code
      ),
      riskFlags: risk_flags,
      isDuplicate: true,
    });
    return { ...tx, risk_flags, recognition_status, updated_at: new Date().toISOString() };
  });

  // Yüksek güven + hesaplar → fişe hazır işaretini kesinleştir
  transactions = transactions.map((tx) => {
    if (
      tx.recognition_status === RECOGNITION_STATUS.RECOGNIZED &&
      tx.suggested_account_code &&
      tx.suggested_counter_account_code &&
      !(tx.risk_flags || []).includes("duplicate")
    ) {
      return {
        ...tx,
        recognition_status: RECOGNITION_STATUS.READY_FOR_VOUCHER,
      };
    }
    return tx;
  });

  return transactions;
}

/** Tanınmayanları kuyruk için filtrele */
export function filterUnknownTransactions(transactions = []) {
  return transactions.filter(
    (tx) =>
      tx.recognition_status === RECOGNITION_STATUS.UNKNOWN ||
      tx.recognition_status === RECOGNITION_STATUS.RISKY
  );
}

/** Luca fiş üreticiye aktarılabilir hareketler */
export function filterReadyForVoucherTransactions(transactions = []) {
  return transactions.filter(
    (tx) =>
      tx.recognition_status === RECOGNITION_STATUS.READY_FOR_VOUCHER ||
      (tx.recognition_status === RECOGNITION_STATUS.RECOGNIZED &&
        tx.suggested_account_code &&
        tx.suggested_counter_account_code)
  );
}
