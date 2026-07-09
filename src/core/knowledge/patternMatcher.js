/**
 * Knowledge Engine pattern eşleştirme.
 */

import { KNOWLEDGE_PATTERN_TYPES } from "../../lib/knowledge-engine/constants.js";

export function normalizeMatchText(value = "") {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ");
}

function safeRegexTest(pattern, haystack) {
  try {
    const re = new RegExp(pattern, "i");
    return re.test(haystack);
  } catch {
    return false;
  }
}

function normalizeIban(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

/**
 * @param {object} input — normalize edilmiş CORE input
 * @param {object} pattern — knowledge_match_patterns satırı
 */
export function patternMatchesInput(input, pattern) {
  const type = String(pattern.pattern_type || "").toLowerCase();
  const patternValue = String(pattern.pattern_value || "");
  const normalizedPattern =
    pattern.normalized_value || normalizeMatchText(patternValue);

  const description = normalizeMatchText(input.raw_description);
  const counterparty = normalizeMatchText(input.counterparty_name);
  const bankName = normalizeMatchText(input.bank_name);
  const haystack = `${description} ${counterparty}`.trim();
  const sourceType = normalizeMatchText(input.source_type);

  switch (type) {
    case KNOWLEDGE_PATTERN_TYPES.KEYWORD:
    case "keyword":
      return (
        haystack.includes(normalizedPattern) ||
        haystack.includes(normalizeMatchText(patternValue))
      );

    case KNOWLEDGE_PATTERN_TYPES.DESCRIPTION_CONTAINS:
    case "description_contains":
      return haystack.includes(normalizedPattern);

    case KNOWLEDGE_PATTERN_TYPES.REGEX:
    case "regex":
      return safeRegexTest(patternValue, haystack);

    case KNOWLEDGE_PATTERN_TYPES.IBAN:
    case "iban": {
      const inputIban = normalizeIban(input.iban);
      const patternIban = normalizeIban(patternValue);
      return Boolean(inputIban && patternIban && inputIban.includes(patternIban));
    }

    case KNOWLEDGE_PATTERN_TYPES.TAX_NO:
    case "tax_no": {
      const inputTax = String(input.tax_no || "").replace(/\D/g, "");
      const patternTax = patternValue.replace(/\D/g, "");
      return Boolean(inputTax && patternTax && inputTax === patternTax);
    }

    case KNOWLEDGE_PATTERN_TYPES.BANK_NAME:
    case "bank_name":
      return bankName.includes(normalizedPattern);

    case KNOWLEDGE_PATTERN_TYPES.TRANSACTION_TYPE:
    case "transaction_type":
      return sourceType === normalizedPattern || sourceType.includes(normalizedPattern);

    case KNOWLEDGE_PATTERN_TYPES.SWIFT:
    case "swift": {
      const swiftHaystack = `${haystack} ${input.raw_description || ""}`.toUpperCase();
      return swiftHaystack.includes(patternValue.toUpperCase());
    }

    default:
      return haystack.includes(normalizedPattern);
  }
}

/**
 * Pattern listesinden en iyi eşleşmeyi seçer (öncelik: priority asc, confidence desc).
 */
export function findBestPatternMatch(input, patterns = [], entitiesById = new Map()) {
  const matches = [];

  for (const pattern of patterns) {
    if (!patternMatchesInput(input, pattern)) continue;
    const entity = pattern.entity_id ? entitiesById.get(pattern.entity_id) : null;
    matches.push({ pattern, entity });
  }

  if (!matches.length) return null;

  matches.sort((left, right) => {
    const priorityDiff = Number(left.pattern.priority || 100) - Number(right.pattern.priority || 100);
    if (priorityDiff !== 0) return priorityDiff;
    return Number(right.pattern.confidence || 0) - Number(left.pattern.confidence || 0);
  });

  return matches[0];
}

export function entityMatchesInput(input, entity) {
  if (!entity) return false;

  const haystack = normalizeMatchText(
    [input.raw_description, input.counterparty_name, input.bank_name].join(" ")
  );
  const names = [
    entity.entity_name,
    ...(Array.isArray(entity.aliases) ? entity.aliases : []),
  ]
    .map(normalizeMatchText)
    .filter(Boolean);

  return names.some((name) => haystack.includes(name));
}

export function findBestEntityMatch(input, entities = []) {
  for (const entity of entities) {
    if (entityMatchesInput(input, entity)) return entity;
  }
  return null;
}

export function matchCompanyMemoryRecord(input, memories = []) {
  const haystack = normalizeMatchText(
    [input.raw_description, input.counterparty_name, input.bank_name, input.iban].join(" ")
  );

  if (!haystack) return null;

  for (const memory of memories) {
    const candidates = [
      memory.normalized_description,
      memory.raw_description,
      memory.counterparty_name,
      memory.bank_name,
      memory.iban,
    ]
      .map(normalizeMatchText)
      .filter(Boolean);

    const hit = candidates.some(
      (candidate) => haystack.includes(candidate) || candidate.includes(haystack)
    );

    if (hit) return memory;
  }

  return null;
}

export function mapEntityToMatched(entity, pattern = null) {
  if (!entity) return null;

  return {
    id: entity.id,
    entity_name: entity.entity_name,
    entity_family: entity.entity_family,
    entity_type: entity.entity_type,
    risk_level: entity.risk_level,
    default_confidence: Number(entity.default_confidence) || 0.7,
    match_type: pattern ? pattern.pattern_type : "entity_alias",
    pattern_id: pattern?.id || null,
    is_global: entity.is_global,
  };
}

export function mapAccountingRuleToPartial(rule, source = "accounting_rule") {
  if (!rule) return {};

  const isExample =
    Number(rule.confidence) < 0.55 ||
    String(rule.description_template || "").toLowerCase().includes("örnek global kural");

  return {
    matched_rule: {
      rule_id: rule.id,
      entity_id: rule.entity_id,
      rule_source: rule.rule_source,
      source_type: rule.source_type,
      description: rule.description_template,
      is_example: isExample,
    },
    suggested_account_code: rule.debit_account_code || null,
    suggested_account_name: rule.debit_account_name || null,
    suggested_counter_account_code: rule.credit_account_code || null,
    suggested_cari: rule.cari_name || null,
    suggested_document_type: rule.document_type || null,
    suggested_vat_rate: rule.vat_rate == null ? null : Number(rule.vat_rate),
    suggested_description: rule.description_template || "",
    confidence_score: Number(rule.confidence) || 0.8,
    risk_flags: isExample ? ["example_global_rule"] : [],
  };
}

export function mapCompanyMemoryToPartial(memory) {
  if (!memory) return {};

  return {
    from_company_memory: true,
    matched_memory_id: memory.id,
    matched_entity: memory.entity_id ? { id: memory.entity_id } : null,
    suggested_account_code: memory.suggested_account_code || null,
    suggested_account_name: memory.suggested_account_name || null,
    suggested_counter_account_code: memory.suggested_counter_account_code || null,
    suggested_cari: memory.suggested_cari || null,
    suggested_document_type: memory.suggested_document_type || null,
    suggested_vat_rate:
      memory.suggested_vat_rate == null ? null : Number(memory.suggested_vat_rate),
    suggested_description: memory.suggested_description || memory.raw_description || "",
    confidence_score: Math.max(Number(memory.confidence) || 1, 0.95),
  };
}
