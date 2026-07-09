/**
 * Knowledge Builder — öğretme / kural kaydetme servisi (Görev 7).
 */

import {
  KNOWLEDGE_LEARNED_FROM,
  KNOWLEDGE_PATTERN_TYPES,
  KNOWLEDGE_RULE_SOURCES,
  KNOWLEDGE_SOURCE_TYPES,
} from "@/src/lib/knowledge-engine/constants";
import { KNOWLEDGE_AUDIT_ENTITY_TYPES } from "@/src/lib/knowledge-engine/schema";
import {
  findCompanyMemoryDuplicate,
  findGlobalEntityByName,
  findGlobalPatternDuplicate,
  findGlobalRuleDuplicate,
  insertCompanyMemoryRecord,
  insertKnowledgeAccountingRule,
  insertKnowledgeEntity,
  insertKnowledgePattern,
  updateCompanyMemoryRecord,
  updateKnowledgeAccountingRule,
  updateKnowledgeEntity,
  updateKnowledgePattern,
} from "@/src/core/db/knowledgeStore";

export { buildMovementTransactionForRerun, buildTeachFormFromMovement } from "@/src/utils/knowledgeBuilderForm";

export const KNOWLEDGE_BUILDER_MODULE = "knowledge_builder";

function normalizeKeyword(value = "") {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ");
}

function compactAccount(value = "") {
  return String(value || "").trim().replace(/\s+/g, "");
}

export function validateKnowledgeTeachPayload(payload = {}) {
  const errors = [];
  const companyId = String(payload.company_id || "").trim();
  const keyword = String(payload.keyword || "").trim();
  const accountCode = compactAccount(payload.account_code);
  const documentType = String(payload.document_type || "").trim();
  const isGlobal = Boolean(payload.is_global);

  if (!companyId) errors.push("Firma zorunludur.");
  if (!keyword) errors.push("Açıklama / keyword zorunludur.");
  if (!accountCode) errors.push("Hesap kodu zorunludur.");
  if (!documentType) errors.push("Belge türü zorunludur.");

  if (isGlobal) {
    const entityName = String(payload.entity_name || "").trim();
    if (!entityName) errors.push("Global kural için entity adı zorunludur.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

async function saveCompanyScopedMemory(supabase, payload = {}, userId = "") {
  const keyword = String(payload.keyword || "").trim();
  const normalized = normalizeKeyword(keyword);
  const existing = await findCompanyMemoryDuplicate(supabase, payload.company_id, keyword);

  const memoryPatch = {
    raw_description: keyword,
    normalized_description: normalized,
    bank_name: payload.bank_name || null,
    transaction_type: payload.transaction_type || null,
    suggested_account_code: compactAccount(payload.account_code),
    suggested_account_name: payload.account_name || null,
    suggested_counter_account_code: compactAccount(payload.counter_account_code) || null,
    suggested_cari: payload.cari || null,
    suggested_document_type: payload.document_type || null,
    suggested_description: payload.description_template || keyword,
    suggested_vat_rate:
      payload.vat_rate === "" || payload.vat_rate == null
        ? null
        : Number(payload.vat_rate),
    confidence: 1,
    learned_from: KNOWLEDGE_LEARNED_FROM.MANUAL,
    is_active: true,
    updated_by: userId,
  };

  if (existing?.id) {
    const updated = await updateCompanyMemoryRecord(supabase, existing.id, memoryPatch);
    if (!updated.ok) throw updated.error || new Error("Firma hafızası güncellenemedi.");
    return {
      action: "UPDATE",
      scope: "company",
      entityId: existing.id,
      warning: "Aynı keyword için mevcut firma hafızası güncellendi.",
      records: { memory: updated.record },
    };
  }

  const created = await insertCompanyMemoryRecord(supabase, {
    ...memoryPatch,
    company_id: payload.company_id,
    created_by: userId,
  });
  if (!created.ok) throw created.error || new Error("Firma hafızası oluşturulamadı.");

  return {
    action: "CREATE",
    scope: "company",
    entityId: created.record?.id || "",
    warning: null,
    records: { memory: created.record },
  };
}

async function saveGlobalKnowledge(supabase, payload = {}, userId = "") {
  const entityName = String(payload.entity_name || payload.keyword || "").trim();
  const keyword = String(payload.keyword || "").trim();
  const normalizedKeyword = normalizeKeyword(keyword);
  const warnings = [];

  let entity = await findGlobalEntityByName(supabase, entityName);
  let entityAction = "CREATE";

  const entityPatch = {
    entity_name: entityName,
    entity_family: payload.entity_family || "other",
    risk_level: payload.risk_level || "low",
    default_confidence: 0.85,
    is_global: true,
    company_id: null,
    updated_by: userId,
  };

  if (entity?.id) {
    entityAction = "UPDATE";
    const updatedEntity = await updateKnowledgeEntity(supabase, entity.id, entityPatch);
    if (!updatedEntity.ok) throw updatedEntity.error || new Error("Entity güncellenemedi.");
    entity = updatedEntity.record;
    warnings.push("Aynı entity adı bulundu — entity güncellendi.");
  } else {
    const createdEntity = await insertKnowledgeEntity(supabase, {
      ...entityPatch,
      created_by: userId,
    });
    if (!createdEntity.ok) throw createdEntity.error || new Error("Entity oluşturulamadı.");
    entity = createdEntity.record;
  }

  let pattern = await findGlobalPatternDuplicate(supabase, entity.id, keyword);
  let patternAction = "CREATE";
  const patternPatch = {
    entity_id: entity.id,
    company_id: null,
    pattern_type: KNOWLEDGE_PATTERN_TYPES.KEYWORD,
    pattern_value: keyword,
    normalized_value: normalizedKeyword,
    priority: 50,
    confidence: 0.85,
    is_global: true,
    updated_by: userId,
  };

  if (pattern?.id) {
    patternAction = "UPDATE";
    const updatedPattern = await updateKnowledgePattern(supabase, pattern.id, patternPatch);
    if (!updatedPattern.ok) throw updatedPattern.error || new Error("Pattern güncellenemedi.");
    pattern = updatedPattern.record;
    warnings.push("Aynı keyword pattern bulundu — pattern güncellendi.");
  } else {
    const createdPattern = await insertKnowledgePattern(supabase, {
      ...patternPatch,
      created_by: userId,
    });
    if (!createdPattern.ok) throw createdPattern.error || new Error("Pattern oluşturulamadı.");
    pattern = createdPattern.record;
  }

  const sourceType = payload.source_type || KNOWLEDGE_SOURCE_TYPES.BANK;
  let rule = await findGlobalRuleDuplicate(supabase, entity.id, sourceType);
  let ruleAction = "CREATE";

  const rulePatch = {
    entity_id: entity.id,
    company_id: null,
    source_type: sourceType,
    transaction_direction: "debit",
    debit_account_code: compactAccount(payload.account_code),
    debit_account_name: payload.account_name || null,
    credit_account_code: compactAccount(payload.counter_account_code) || "102",
    credit_account_name: payload.counter_account_code ? "Bankalar" : null,
    vat_rate:
      payload.vat_rate === "" || payload.vat_rate == null
        ? null
        : Number(payload.vat_rate),
    document_type: payload.document_type || null,
    cari_name: payload.cari || null,
    description_template: payload.description_template || keyword,
    rule_source: KNOWLEDGE_RULE_SOURCES.MANUAL,
    priority: 50,
    confidence: 0.85,
    risk_level: payload.risk_level || "low",
    is_global: true,
    updated_by: userId,
  };

  if (rule?.id) {
    ruleAction = "UPDATE";
    const updatedRule = await updateKnowledgeAccountingRule(supabase, rule.id, rulePatch);
    if (!updatedRule.ok) throw updatedRule.error || new Error("Kural güncellenemedi.");
    rule = updatedRule.record;
    warnings.push("Aynı entity + kaynak tipi kuralı bulundu — kural güncellendi.");
  } else {
    const createdRule = await insertKnowledgeAccountingRule(supabase, {
      ...rulePatch,
      created_by: userId,
    });
    if (!createdRule.ok) throw createdRule.error || new Error("Kural oluşturulamadı.");
    rule = createdRule.record;
  }

  const action =
    entityAction === "CREATE" || patternAction === "CREATE" || ruleAction === "CREATE"
      ? "CREATE"
      : "UPDATE";

  return {
    action,
    scope: "global",
    entityId: rule?.id || entity?.id || "",
    warning: warnings.length ? warnings.join(" ") : null,
    records: { entity, pattern, rule },
  };
}

/**
 * @returns {Promise<{ ok: boolean, result?: object, audit?: object, error?: string }>}
 */
export async function saveKnowledgeTeach(supabase, payload = {}, options = {}) {
  const validation = validateKnowledgeTeachPayload(payload);
  if (!validation.ok) {
    return { ok: false, error: validation.errors.join(" ") };
  }

  const userId = String(options.userId || "").trim();
  const isGlobal = Boolean(payload.is_global);

  try {
    const result = isGlobal
      ? await saveGlobalKnowledge(supabase, payload, userId)
      : await saveCompanyScopedMemory(supabase, payload, userId);

    const audit = {
      module: KNOWLEDGE_BUILDER_MODULE,
      action: result.action,
      entity_type: KNOWLEDGE_AUDIT_ENTITY_TYPES.RULE,
      entity_id: result.entityId,
      company_id: payload.company_id,
      metadata: {
        module: KNOWLEDGE_BUILDER_MODULE,
        scope: result.scope,
        keyword: payload.keyword,
        is_global: isGlobal,
        warning: result.warning,
      },
      after_state: result.records,
    };

    return { ok: true, result, audit };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Knowledge Builder kaydı başarısız.",
    };
  }
}
