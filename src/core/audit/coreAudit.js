/**
 * CORE audit — knowledge_decision_history + geliştirme logu.
 */

/**
 * Karar olayını loglar.
 */
export async function logCoreDecisionEvent(event = {}) {
  if (process.env.NODE_ENV === "development") {
    console.info("[annvero-core:audit]", {
      module: event.module,
      company_id: event.company_id,
      decision_source: event.decision_source,
      status: event.status,
      confidence_score: event.confidence_score,
      request_id: event.request_id,
    });
  }

  return { ok: true };
}

/**
 * knowledge_decision_history tablosuna karar yazar.
 */
export async function persistDecisionHistory({ input = {}, context = {}, result = {} }) {
  try {
    const { insertDecisionHistory, resolveKnowledgeSupabase } = await import("../db/knowledgeStore.js");
    const supabase = await resolveKnowledgeSupabase(context);
    if (!supabase) return { ok: false, skipped: true };

    return await insertDecisionHistory(supabase, {
      company_id: input.company_id,
      source_type: input.source_type,
      source_record_id: context.request_id || "",
      raw_input: input,
      matched_entity_id: result.matched_entity?.id || null,
      matched_pattern_id: result.matched_pattern_id || result.matched_entity?.pattern_id || null,
      matched_rule_id: result.matched_rule?.rule_id || null,
      decision_source: result.decision_source,
      decision_status: result.status,
      confidence: result.confidence_score,
      suggested_result: {
        suggested_account_code: result.suggested_account_code,
        suggested_account_name: result.suggested_account_name,
        suggested_counter_account_code: result.suggested_counter_account_code,
        suggested_cari: result.suggested_cari,
        suggested_document_type: result.suggested_document_type,
        suggested_vat_rate: result.suggested_vat_rate,
        suggested_description: result.suggested_description,
        risk_level: result.risk_level,
        needs_manual_review: result.needs_manual_review,
      },
      risk_flags: result.risk_flags,
      created_by: context.user_id || null,
    });
  } catch (error) {
    console.warn("[annvero-core:audit] decision history skipped", error?.message);
    return { ok: false, skipped: true, error };
  }
}
