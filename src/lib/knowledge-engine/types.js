/**
 * Muhasebe Bilgi Motoru — JSDoc tipleri (Görev 1).
 * @module knowledge-engine/types
 */

/**
 * @typedef {Object} KnowledgeEntity
 * @property {string} id
 * @property {string} entity_name
 * @property {string} [entity_family]
 * @property {string} [entity_type]
 * @property {string[]} [aliases]
 * @property {string} [tax_no]
 * @property {string[]} [iban_list]
 * @property {string[]} [swift_codes]
 * @property {string} [country]
 * @property {string} [risk_level]
 * @property {number} [default_confidence]
 * @property {boolean} [is_global]
 * @property {string|null} [company_id]
 * @property {boolean} [is_active]
 */

/**
 * @typedef {Object} KnowledgeMatchPattern
 * @property {string} id
 * @property {string} entity_id
 * @property {string|null} [company_id]
 * @property {string} pattern_type
 * @property {string} pattern_value
 * @property {string} [normalized_value]
 * @property {number} [priority]
 * @property {number} [confidence]
 * @property {boolean} [is_global]
 * @property {boolean} [is_active]
 */

/**
 * @typedef {Object} KnowledgeAccountingRule
 * @property {string} id
 * @property {string} entity_id
 * @property {string|null} [company_id]
 * @property {string} [source_type]
 * @property {string} [transaction_direction]
 * @property {string} [debit_account_code]
 * @property {string} [debit_account_name]
 * @property {string} [credit_account_code]
 * @property {string} [credit_account_name]
 * @property {string} [vat_account_code]
 * @property {number|null} [vat_rate]
 * @property {string} [document_type]
 * @property {string} [cari_name]
 * @property {string} [description_template]
 * @property {string} [voucher_type]
 * @property {string} [rule_source]
 * @property {number} [priority]
 * @property {number} [confidence]
 * @property {string} [risk_level]
 * @property {boolean} [is_global]
 * @property {boolean} [is_active]
 */

/**
 * @typedef {Object} KnowledgeCompanyMemory
 * @property {string} id
 * @property {string} company_id
 * @property {string|null} [entity_id]
 * @property {string} [raw_description]
 * @property {string} [normalized_description]
 * @property {string} [bank_name]
 * @property {string} [suggested_account_code]
 * @property {string} [suggested_account_name]
 * @property {number} [confidence]
 * @property {string} [learned_from]
 * @property {number} [use_count]
 * @property {string|null} [last_used_at]
 */

/**
 * @typedef {Object} KnowledgeDecisionHistory
 * @property {string} id
 * @property {string|null} [company_id]
 * @property {string} [source_type]
 * @property {string} [source_record_id]
 * @property {Record<string, unknown>} [raw_input]
 * @property {string|null} [matched_entity_id]
 * @property {string|null} [matched_pattern_id]
 * @property {string|null} [matched_rule_id]
 * @property {string} [decision_source]
 * @property {string} [decision_status]
 * @property {number} [confidence]
 * @property {Record<string, unknown>} [suggested_result]
 * @property {string[]} [risk_flags]
 */

/**
 * @typedef {Object} KnowledgeRuleVersion
 * @property {string} id
 * @property {string} table_name
 * @property {string} record_id
 * @property {number} version_no
 * @property {string} change_type
 * @property {Record<string, unknown>} [before_state]
 * @property {Record<string, unknown>} [after_state]
 * @property {string|null} [changed_by]
 */

/**
 * @typedef {Object} KnowledgeDecisionResult
 * @property {string} decision_source
 * @property {string} decision_status
 * @property {number} confidence
 * @property {KnowledgeAccountingRule|null} [rule]
 * @property {KnowledgeEntity|null} [entity]
 * @property {KnowledgeCompanyMemory|null} [memory]
 * @property {Record<string, unknown>} [suggested_result]
 * @property {string[]} [risk_flags]
 */

export {};
