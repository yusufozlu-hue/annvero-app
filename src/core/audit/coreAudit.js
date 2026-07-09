/**
 * CORE audit — stub (Görev 2: audit_events + knowledge_decision_history).
 */

/**
 * Karar olayını loglar. Şimdilik no-op; ana akışı bozmaz.
 * @param {object} event
 * @returns {Promise<{ ok: boolean, skipped?: boolean }>}
 */
export async function logCoreDecisionEvent(event = {}) {
  if (process.env.NODE_ENV === "development") {
    console.info("[annvero-core:audit]", {
      module: event.module,
      company_id: event.company_id,
      decision_source: event.decision_source,
      status: event.status,
      request_id: event.request_id,
    });
  }

  return { ok: true, skipped: true };
}

/**
 * İleride bağlanacak: knowledge_decision_history insert.
 */
export async function persistDecisionHistory(_record) {
  return { ok: true, skipped: true };
}
