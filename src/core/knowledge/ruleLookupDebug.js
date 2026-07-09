/**
 * Accounting rule eşleştirme tanıları — debug_trace için.
 */

export const RULE_DB_WHERE = {
  global:
    "knowledge_accounting_rules: is_global=true AND (company_id IS NULL OR company_id='')",
  company: (companyId) =>
    `knowledge_accounting_rules: company_id='${companyId || ""}'`,
};

const GOOGLE_ENTITY_ID = "a1000001-0001-4000-8000-000000000001";

export function resolveTransactionDirection(input = {}) {
  const amount = input.amount;
  if (amount == null || !Number.isFinite(Number(amount))) return "unknown";
  if (Number(amount) < 0) return "debit";
  if (Number(amount) > 0) return "credit";
  return "both";
}

export function resolveRuleLookupSourceTypes(input = {}, state = {}) {
  const types = new Set();
  if (input.source_type) types.add(input.source_type);

  const desc = `${input.raw_description || ""} ${input.counterparty_name || ""}`.toUpperCase();
  const entityFamily = String(state.matched_entity?.entity_family || "").toLowerCase();
  const entityName = String(state.matched_entity?.entity_name || "").toLowerCase();

  const cardLike =
    input.source_type === "bank" ||
    entityFamily === "tech_ads" ||
    entityName === "google" ||
    entityName === "meta" ||
    /GOOGLE|FACEBK|META ADS|ADS|REKLAM/.test(desc);

  if (cardLike) {
    types.add("credit_card");
  }

  return [...types];
}

function rulePassesInMemoryFilters(rule, input, entityId, options = {}) {
  const rejectReasons = [];

  if (entityId && rule.entity_id && rule.entity_id !== entityId) {
    rejectReasons.push(
      `entity_id mismatch (rule=${rule.entity_id}, matched_entity=${entityId})`
    );
  }

  const sourceTypes =
    options.sourceTypes ||
    input._rule_source_types ||
    [input.source_type].filter(Boolean);

  if (rule.source_type && sourceTypes.length && !sourceTypes.includes(rule.source_type)) {
    rejectReasons.push(
      `source_type mismatch (rule=${rule.source_type}, resolved_input=[${sourceTypes.join(", ")}])`
    );
  }

  return rejectReasons;
}

function transactionDirectionNote(rule, input) {
  const derivedDirection = resolveTransactionDirection(input);
  if (
    !rule.transaction_direction ||
    rule.transaction_direction === "both" ||
    derivedDirection === "unknown"
  ) {
    return null;
  }
  if (rule.transaction_direction !== derivedDirection) {
    return `transaction_direction: rule=${rule.transaction_direction}, derived_input=${derivedDirection} (engine does not filter on this yet)`;
  }
  return null;
}

function buildNoMatchReason(rejected, entityId, input, rules) {
  const entityRules = rules.filter(
    (rule) => !entityId || !rule.entity_id || rule.entity_id === entityId
  );

  if (!rules.length) {
    return "Bundle'da hiç accounting rule yüklenmedi";
  }

  if (entityId && !entityRules.length) {
    return `entity_id=${entityId} için bundle'da rule yok`;
  }

  if (!rejected.length) {
    return "Bilinmeyen — aday rule yok";
  }

  const inputSourceType = input.source_type || "";
  const sourceTypeOnlyRejects = rejected.every((row) =>
    row.reject_reasons.some((r) => r.startsWith("source_type mismatch"))
  );

  if (sourceTypeOnlyRejects && inputSourceType) {
    const ruleTypes = [
      ...new Set(
        rejected.map((r) => r.rule_source_type).filter(Boolean)
      ),
    ].join(", ");
    return `Tüm aday rule'lar source_type nedeniyle elendi: input="${inputSourceType}", rule source_type=[${ruleTypes}]`;
  }

  return `${rejected.length} rule in-memory filtreden geçemedi`;
}

function buildGoogleHint(entityId, entityName, rejected, input) {
  const isGoogle =
    entityId === GOOGLE_ENTITY_ID ||
    String(entityName || "").toLowerCase() === "google";

  if (!isGoogle) return null;

  const inputSourceType = input.source_type || "bank";
  const googleRules = rejected.filter(
    (r) => !entityId || r.entity_id === entityId || r.entity_id === GOOGLE_ENTITY_ID
  );

  if (!googleRules.length) {
    return `Google entity (${entityId || GOOGLE_ENTITY_ID}) için global rule bundle'da bulunamadı`;
  }

  const seedRule = googleRules.find((r) => r.rule_source_type === "credit_card");
  if (seedRule && inputSourceType === "bank") {
    return (
      `Google seed kuralı source_type='credit_card' iken test input source_type='${inputSourceType}'. ` +
      "CORE Test Merkezi bank hareketi gönderiyor; kural credit_card olarak seed edilmiş — bu yüzden eşleşmiyor."
    );
  }

  return googleRules[0]?.reject_reasons?.join("; ") || null;
}

/**
 * @returns {{ rule: object|null, diagnostics: object }}
 */
export function pickRuleWithDiagnostics(rules = [], input = {}, entityId = null, options = {}) {
  const sourceTypes =
    options.sourceTypes ||
    input._rule_source_types ||
    resolveRuleLookupSourceTypes(input, {
      matched_entity: {
        id: entityId,
        entity_name: options.entityName,
        entity_family: options.entitiesById?.get?.(entityId)?.entity_family,
      },
    });

  const rejected = [];
  const candidates = [];

  for (const rule of rules) {
    const rejectReasons = rulePassesInMemoryFilters(rule, input, entityId, {
      ...options,
      sourceTypes,
    });
    if (rejectReasons.length) {
      rejected.push({
        rule_id: rule.id,
        entity_id: rule.entity_id,
        rule_source_type: rule.source_type,
        rule_transaction_direction: rule.transaction_direction,
        priority: rule.priority,
        reject_reasons: rejectReasons,
        transaction_direction_note: transactionDirectionNote(rule, input),
      });
      continue;
    }

    candidates.push({
      rule,
      transaction_direction_note: transactionDirectionNote(rule, input),
    });
  }

  const sortedCandidates = candidates
    .map((entry) => entry.rule)
    .sort(
      (a, b) =>
        Number(a.priority || 100) - Number(b.priority || 100) ||
        Number(b.confidence || 0) - Number(a.confidence || 0)
    );

  const entityName =
    options.entityName ||
    (entityId && options.entitiesById?.get?.(entityId)?.entity_name) ||
    null;

  const diagnostics = {
    matched_entity_id: entityId,
    matched_entity_name: entityName,
    input_source_type: input.source_type || null,
    resolved_source_types: sourceTypes,
    transaction_direction: resolveTransactionDirection(input),
    db_where: options.dbWhere || null,
    in_memory_where:
      "entity_id match (if rule.entity_id set) AND (rule.source_type empty OR rule.source_type IN resolved_source_types)",
    rules_loaded: rules.length,
    candidate_count: sortedCandidates.length,
    rejected_rules: rejected.slice(0, 15),
    no_match_reason: sortedCandidates.length
      ? null
      : buildNoMatchReason(rejected, entityId, input, rules),
    google_rule_hint: buildGoogleHint(entityId, entityName, rejected, input),
  };

  return { rule: sortedCandidates[0] || null, diagnostics };
}

export function traceWithRuleLookup(base, diagnostics, matched) {
  return {
    ...base,
    matched_entity_id: diagnostics.matched_entity_id,
    matched_entity_name: diagnostics.matched_entity_name,
    input_source_type: diagnostics.input_source_type,
    transaction_direction: diagnostics.transaction_direction,
    db_where: diagnostics.db_where,
    in_memory_where: diagnostics.in_memory_where,
    rules_loaded: diagnostics.rules_loaded,
    candidate_count: diagnostics.candidate_count,
    rejected_rules: diagnostics.rejected_rules,
    no_match_reason: matched ? null : diagnostics.no_match_reason,
    google_rule_hint: diagnostics.google_rule_hint,
    rule_lookup: diagnostics,
  };
}
