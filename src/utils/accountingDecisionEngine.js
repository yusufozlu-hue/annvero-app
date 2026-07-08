/**
 * Muhasebe Karar Motoru
 * Pipeline: Memory → Rule Engine → AI (stub) → Manual
 * Mevcut bank parser / Luca akışını bozmaz; NFT üzerine karar yazar.
 */

import { normalizeParserText } from "@/src/utils/textNormalize";
import { RECOGNITION_STATUS } from "@/src/models/normalizedFinancialTransaction";
import {
  ACCOUNTING_DECISION_PIPELINE,
  DECISION_SOURCE,
  RISK_LEVEL,
  createAccountingDecision,
} from "@/src/models/accountingDecision";

const MEMORY_HIGH = 85;
const RULE_HIGH = 75;

/** Yerleşik banka açıklama kuralları (kural motoru boşsa yedek) */
export const BUILTIN_BANK_DECISION_RULES = [
  {
    id: "builtin-pos",
    keywords: ["POS", "POS KOMISYON", "POS KOMİSYON", "BKM"],
    suggested_account_code: "108",
    suggested_counter_account: "780",
    suggested_document_type: "DK",
    suggested_vat_rate: null,
    suggested_description: "POS tahsilat / komisyon",
    suggested_rule: "POS → 108 / masraf",
    score: 78,
  },
  {
    id: "builtin-sgk",
    keywords: ["SGK", "SOSYAL GUVENLIK", "SOSYAL GÜVENLİK", "PRIM"],
    suggested_account_code: "361",
    suggested_counter_account: "102",
    suggested_document_type: "DK",
    suggested_description: "SGK ödeme / tahakkuk kontrolü",
    suggested_rule: "SGK → 361 Tahakkuk/Ödeme",
    score: 82,
  },
  {
    id: "builtin-muhsgk",
    keywords: ["MUHSGK", "MUHTASAR", "SGK MUHTASAR"],
    suggested_account_code: "360",
    suggested_counter_account: "102",
    suggested_document_type: "DK",
    suggested_description: "MUHSGK / muhtasar — alt hesap öner",
    suggested_rule: "MUHSGK → 360 alt hesap",
    score: 80,
  },
  {
    id: "builtin-kdv",
    keywords: ["KDV", "KATMA DEGER", "KATMA DEĞER"],
    suggested_account_code: "360",
    suggested_counter_account: "191",
    suggested_document_type: "DK",
    suggested_vat_rate: 20,
    suggested_description: "KDV — ilgili dönem",
    suggested_rule: "KDV → 360 / dönem",
    score: 80,
  },
  {
    id: "builtin-google-ads",
    keywords: ["GOOGLE ADS", "GOOGLE ADWORDS", "GOOGLE"],
    suggested_account_code: "770.03",
    suggested_counter_account: "320",
    suggested_cari: "GOOGLE",
    suggested_document_type: "DK",
    suggested_description: "Google Ads reklam gideri",
    suggested_rule: "GOOGLE ADS → 770.03 / 320",
    score: 70,
  },
];

function textOf(tx) {
  return normalizeParserText(tx?.description_normalized || tx?.description_raw || "");
}

function amountOf(tx) {
  return Math.max(Number(tx?.debit_amount || 0), Number(tx?.credit_amount || 0));
}

function withinMonths(dateText, months = 18) {
  if (!dateText) return true;
  const d = new Date(String(dateText).includes(".")
    ? String(dateText).split(".").reverse().join("-")
    : dateText);
  if (Number.isNaN(d.getTime())) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return d >= cutoff;
}

/**
 * 1) Öğrenen hafıza — son 18 ay tercihli
 */
export function decideFromMemory(tx, learningMemory = [], context = {}) {
  const text = textOf(tx);
  if (!text) return null;

  const bankName = normalizeParserText(tx.bank_name || context.selectedBank || "");
  let best = null;
  let bestScore = 0;

  for (const record of learningMemory || []) {
    if (record?.is_active === false) continue;
    const keyword = normalizeParserText(
      record.keyword || record.clean_description || record.raw_description || ""
    );
    if (!keyword || !text.includes(keyword)) continue;

    const lastMatched = record.last_matched_at || record.updated_at || record.created_at;
    const recentBoost = withinMonths(lastMatched, 18) ? 12 : 0;

    let score = Math.min(99, 45 + Math.min(40, keyword.length) + recentBoost);
    const recordBank = normalizeParserText(
      record.account_name || record.bank_name || record.transaction_type || ""
    );
    if (bankName && recordBank && recordBank === bankName) score += 8;
    if (context.companyId && record.company_id === context.companyId) score += 6;
    if (Number(record.match_count || 0) > 0) {
      score = Math.min(99, score + Math.min(10, Number(record.match_count)));
    }

    if (score > bestScore) {
      bestScore = score;
      best = { record, score };
    }
  }

  if (!best) return null;

  const rec = best.record;
  const accountCode = rec.account_code || rec.hesap_kodu || "";
  const counter = rec.counter_account_code || rec.karsi_hesap_kodu || "191";

  return createAccountingDecision({
    recognition_status:
      best.score >= MEMORY_HIGH
        ? RECOGNITION_STATUS.RECOGNIZED
        : RECOGNITION_STATUS.SUGGESTED,
    confidence_score: Math.min(99, best.score),
    suggested_account_code: accountCode || null,
    suggested_account_name: rec.account_name || rec.hesap_adi || null,
    suggested_counter_account: counter || null,
    suggested_cari: rec.cari_name || null,
    suggested_document_type: rec.document_type || rec.belge_turu || "DK",
    suggested_vat_rate: rec.vat_rate ?? null,
    suggested_vat_amount: rec.vat_amount ?? null,
    suggested_description:
      rec.description_format ||
      rec.clean_description ||
      tx.description_raw ||
      "",
    suggested_voucher_type: rec.document_type || rec.belge_turu || "DK",
    suggested_rule: `Memory: ${rec.keyword || keywordOrEmpty(rec)}`,
    risk_level: RISK_LEVEL.NONE,
    decision_source: DECISION_SOURCE.MEMORY,
    pipeline_stage: DECISION_SOURCE.MEMORY,
    message: "Öğrenen hafızadan eşleşti",
  });
}

function keywordOrEmpty(rec) {
  return rec?.raw_description || "";
}

/**
 * 2) Kural motoru — accountingRules + companyRules + yerleşik kurallar
 */
export function decideFromRules(tx, context = {}) {
  const text = textOf(tx);
  if (!text) return null;

  let best = null;

  for (const rule of context.accountingRules || []) {
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

    const score = 70 + Math.min(20, Number(rule.oncelik ?? 0));
    if (!best || score > best.score) {
      best = {
        score,
        accountCode: rule.hesapKodu || rule.accountCode || "",
        counter: rule.karsiHesapKodu || "",
        name: "",
        cari: "",
        documentType: rule.belgeTuru || "DK",
        description: rule.fisAciklamaSablonu || tx.description_raw || "",
        ruleLabel: `Kural: ${rule.aramaMetni}`,
        vatRate: null,
      };
    }
  }

  for (const rule of context.companyRules?.banka || []) {
    const keyword = normalizeParserText(rule.anahtar || rule.keyword || "");
    if (!keyword || !text.includes(keyword)) continue;
    const score = 65 + Math.min(15, keyword.length);
    if (!best || score > best.score) {
      best = {
        score,
        accountCode: rule.hesapKodu || rule.accountCode || rule.borcHesabi || "",
        counter: rule.karsiHesapKodu || rule.alacakHesabi || "",
        name: "",
        cari: "",
        documentType: rule.belgeTuru || "DK",
        description: rule.aciklama || tx.description_raw || "",
        ruleLabel: `Firma kuralı: ${rule.anahtar || rule.keyword}`,
        vatRate: null,
      };
    }
  }

  for (const rule of BUILTIN_BANK_DECISION_RULES) {
    const hit = (rule.keywords || []).some((kw) =>
      text.includes(normalizeParserText(kw))
    );
    if (!hit) continue;
    if (!best || rule.score > best.score) {
      best = {
        score: rule.score,
        accountCode: rule.suggested_account_code,
        counter: rule.suggested_counter_account,
        name: "",
        cari: rule.suggested_cari || "",
        documentType: rule.suggested_document_type || "DK",
        description: rule.suggested_description || tx.description_raw || "",
        ruleLabel: rule.suggested_rule,
        vatRate: rule.suggested_vat_rate,
      };
    }
  }

  if (!best) return null;

  return createAccountingDecision({
    recognition_status:
      best.score >= RULE_HIGH
        ? RECOGNITION_STATUS.RECOGNIZED
        : RECOGNITION_STATUS.SUGGESTED,
    confidence_score: Math.min(95, best.score),
    suggested_account_code: best.accountCode || null,
    suggested_account_name: best.name || null,
    suggested_counter_account: best.counter || null,
    suggested_cari: best.cari || null,
    suggested_document_type: best.documentType || "DK",
    suggested_vat_rate: best.vatRate,
    suggested_vat_amount: null,
    suggested_description: best.description || "",
    suggested_voucher_type: best.documentType || "DK",
    suggested_rule: best.ruleLabel,
    risk_level: RISK_LEVEL.NONE,
    decision_source: DECISION_SOURCE.RULE,
    pipeline_stage: DECISION_SOURCE.RULE,
    message: "Kural motorundan eşleşti",
  });
}

/**
 * 3) AI stub — çağrı yok, yalnızca gelecek entegrasyon noktası
 */
export async function decideFromAiStub(_tx, _context = {}) {
  return createAccountingDecision({
    recognition_status: RECOGNITION_STATUS.UNKNOWN,
    confidence_score: 0,
    decision_source: DECISION_SOURCE.AI,
    pipeline_stage: DECISION_SOURCE.AI,
    ai_ready: true,
    ai_invoked: false,
    message: "AI katmanı hazır — bu sprintte çağrı yapılmıyor",
  });
}

function riskLevelFromFlags(flags = [], amount = 0) {
  if (flags.includes("duplicate")) return RISK_LEVEL.CRITICAL;
  if (flags.includes("high_amount") || amount >= 500000) return RISK_LEVEL.HIGH;
  if (flags.includes("empty_description") || flags.includes("missing_account")) {
    return RISK_LEVEL.MEDIUM;
  }
  if (flags.length) return RISK_LEVEL.LOW;
  return RISK_LEVEL.NONE;
}

/**
 * 4) Manuel / bilinmeyen — UNKNOWN confidence 0
 */
export function decideManualUnknown(tx, extras = {}) {
  const flags = extras.risk_flags || tx.risk_flags || [];
  return createAccountingDecision({
    recognition_status: RECOGNITION_STATUS.UNKNOWN,
    confidence_score: 0,
    suggested_account_code: null,
    suggested_account_name: null,
    suggested_counter_account: null,
    suggested_cari: null,
    suggested_document_type: "DK",
    suggested_vat_rate: null,
    suggested_vat_amount: null,
    suggested_description: tx.description_raw || "",
    suggested_voucher_type: "DK",
    suggested_rule: null,
    risk_level: riskLevelFromFlags(flags, amountOf(tx)),
    decision_source: DECISION_SOURCE.MANUAL,
    pipeline_stage: DECISION_SOURCE.MANUAL,
    message: "Hesap eşleşmesi bulunamadı — tanınmayan kuyruk",
    ai_ready: true,
    ai_invoked: false,
  });
}

/**
 * Tam pipeline: Memory → Rule → AI(stub skip) → Manual
 */
export function runAccountingDecisionPipeline(tx, context = {}) {
  const memoryDecision = decideFromMemory(tx, context.learningMemory, context);
  if (
    memoryDecision &&
    memoryDecision.suggested_account_code &&
    memoryDecision.confidence_score > 0
  ) {
    return memoryDecision;
  }

  const ruleDecision = decideFromRules(tx, context);
  if (
    ruleDecision &&
    ruleDecision.suggested_account_code &&
    ruleDecision.confidence_score > 0
  ) {
    return ruleDecision;
  }

  // AI stub: çağrı yok; bilinmeyene düş
  // (ileride: const ai = await decideFromAiStub(tx, context))
  void ACCOUNTING_DECISION_PIPELINE;
  void decideFromAiStub;

  return decideManualUnknown(tx, {
    risk_flags: tx.risk_flags,
  });
}

/**
 * NFT satırına muhasebe kararını uygular.
 */
export function applyAccountingDecisionToTransaction(tx, context = {}) {
  if (!tx) return tx;

  // Mevcut tanıma sonucu zaten güçlüyse (movement mapper / önceki katman) koru
  const existingCode = tx.suggested_account_code;
  const existingCounter = tx.suggested_counter_account_code;
  const existingScore = Number(tx.confidence_score || 0);
  const existingSource = tx._match_source || "";

  let decision = runAccountingDecisionPipeline(tx, context);

  // Önceki memory/rule eşleşmesi varsa decision ile birleştir
  if (existingCode && existingScore >= decision.confidence_score) {
    const source =
      existingSource.includes("memory") || existingSource === "learning_memory"
        ? DECISION_SOURCE.MEMORY
        : existingSource.includes("rule") || existingSource.includes("accounting")
          ? DECISION_SOURCE.RULE
          : decision.decision_source;

    decision = createAccountingDecision({
      ...decision,
      recognition_status:
        existingScore >= MEMORY_HIGH
          ? RECOGNITION_STATUS.RECOGNIZED
          : RECOGNITION_STATUS.SUGGESTED,
      confidence_score: existingScore,
      suggested_account_code: existingCode,
      suggested_counter_account: existingCounter || decision.suggested_counter_account,
      suggested_cari: tx.suggested_cari || decision.suggested_cari,
      suggested_document_type: tx.suggested_document_type || decision.suggested_document_type,
      suggested_description: tx.description_raw || decision.suggested_description,
      decision_source: source,
      pipeline_stage: source,
      message: "Önceki tanıma katmanı + karar motoru",
    });
  }

  if (tx.recognition_status === RECOGNITION_STATUS.DUPLICATE) {
    decision = {
      ...decision,
      recognition_status: RECOGNITION_STATUS.DUPLICATE,
      risk_level: RISK_LEVEL.CRITICAL,
      message: "Mükerrer şüpheli",
    };
  } else if (
    (tx.risk_flags || []).length &&
    decision.recognition_status !== RECOGNITION_STATUS.UNKNOWN
  ) {
    decision.risk_level = riskLevelFromFlags(tx.risk_flags, amountOf(tx));
    if (
      decision.risk_level === RISK_LEVEL.HIGH ||
      decision.risk_level === RISK_LEVEL.CRITICAL
    ) {
      decision.recognition_status = RECOGNITION_STATUS.RISKY;
    }
  }

  if (
    !decision.suggested_account_code ||
    decision.confidence_score <= 0
  ) {
    decision = decideManualUnknown(tx, { risk_flags: tx.risk_flags });
  }

  return {
    ...tx,
    recognition_status: decision.recognition_status,
    confidence_score: decision.confidence_score,
    suggested_account_code: decision.suggested_account_code,
    suggested_account_name: decision.suggested_account_name,
    suggested_counter_account_code: decision.suggested_counter_account,
    suggested_counter_account: decision.suggested_counter_account,
    suggested_cari: decision.suggested_cari,
    suggested_document_type: decision.suggested_document_type,
    suggested_vat_rate: decision.suggested_vat_rate,
    suggested_vat_amount: decision.suggested_vat_amount,
    suggested_description: decision.suggested_description,
    suggested_voucher_type: decision.suggested_voucher_type,
    suggested_rule: decision.suggested_rule,
    risk_level: decision.risk_level,
    decision_source: decision.decision_source,
    pipeline_stage: decision.pipeline_stage,
    message: decision.message,
    accounting_decision: decision,
    updated_at: new Date().toISOString(),
  };
}

export function applyAccountingDecisionsToTransactions(transactions = [], context = {}) {
  return (transactions || []).map((tx) => {
    try {
      return applyAccountingDecisionToTransaction(tx, context);
    } catch (error) {
      console.error("[accountingDecisionEngine] row failed", {
        id: tx?.id,
        error: error?.message || String(error),
      });
      return {
        ...tx,
        ...decideManualUnknown(tx),
        message: `Karar hatası: ${error?.message || "unknown"}`,
      };
    }
  });
}
