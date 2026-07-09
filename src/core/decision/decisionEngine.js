/**
 * CORE karar pipeline orkestratörü.
 */

import { resolveEntity } from "../entity/entityResolver.js";
import { resolveCompanyMemory } from "../memory/memoryResolver.js";
import { resolveCompanyRules } from "../rules/ruleResolver.js";
import { resolveGlobalKnowledge, resolveAccountingRules } from "../knowledge/knowledgeResolver.js";
import { resolvePatterns } from "../knowledge/patternResolver.js";
import { applyConfidenceEngine } from "../confidence/confidenceEngine.js";
import { applyRiskEngine } from "../risk/riskEngine.js";
import { resolveAiStub } from "./aiStub.js";
import { resolveManualQueue } from "./manualQueue.js";
import { createCoreDecisionResult } from "../types/decisionResult.js";
import { logCoreDecisionEvent, persistDecisionHistory } from "../audit/coreAudit.js";
import { CORE_DECISION_STATUS } from "../types/constants.js";

async function loadKnowledgeBundleSafe(context, companyId) {
  try {
    const { loadKnowledgeBundle } = await import("../db/knowledgeStore.js");
    return await loadKnowledgeBundle(context, companyId);
  } catch (error) {
    return {
      unavailable: true,
      entities: [],
      companyPatterns: [],
      globalPatterns: [],
      companyMemory: [],
      companyRules: [],
      globalRules: [],
      entitiesById: new Map(),
      error,
    };
  }
}

async function runStage(runner, input, context, state) {
  const started = Date.now();
  try {
    const result = await runner(input, context, state);
    const trace = {
      ...result.trace,
      duration_ms: Date.now() - started,
    };
    return { ...result, trace };
  } catch (error) {
    return {
      matched: false,
      partial: {},
      trace: {
        stage: "unknown",
        outcome: "error",
        detail: error?.message || "Stage failed",
        duration_ms: Date.now() - started,
      },
    };
  }
}

function applyStageResult(state, result) {
  const nextState = { ...state };
  const traces = [...(state.debug_trace || [])];

  if (result.trace) traces.push(result.trace);

  if (result.matched && result.partial) {
    const preserveMemory =
      nextState.from_company_memory && !result.partial.from_company_memory;

    if (!preserveMemory) {
      Object.assign(nextState, result.partial);
    } else if (result.partial.matched_entity && !nextState.matched_entity?.entity_name) {
      nextState.matched_entity = {
        ...nextState.matched_entity,
        ...result.partial.matched_entity,
      };
    }
  }

  nextState.debug_trace = traces;
  return nextState;
}

function hasAnyMatch(state = {}) {
  return Boolean(
    state.from_company_memory ||
      state.matched_entity?.id ||
      state.matched_entity?.entity_name ||
      state.matched_rule?.rule_id ||
      state.suggested_account_code
  );
}

/**
 * Tam karar pipeline'ını çalıştırır.
 */
export async function runDecisionPipeline(input, context) {
  const initialTrace = Array.isArray(context.debug_trace) ? [...context.debug_trace] : [];
  let state = createCoreDecisionResult({ debug_trace: initialTrace });

  let enrichedContext = { ...context };

  try {
    const bundle = await loadKnowledgeBundleSafe(context, input.company_id);
    enrichedContext = { ...context, knowledgeBundle: bundle };

    if (bundle.unavailable) {
      const probe = bundle.dbProbe || null;
      state.debug_trace.push({
        stage: "knowledge_db",
        outcome: "unavailable",
        detail: bundle.error?.message || probe?.reason || "Knowledge tables unavailable — fallback mode",
        client_type: probe?.clientType || (context.supabase ? "context_service_role" : "unknown"),
        missing_env: probe?.env?.missingEnv || null,
        probe: probe?.tables || null,
      });
    } else {
      const probe = bundle.dbProbe || null;
      state.debug_trace.push({
        stage: "knowledge_db",
        outcome: "loaded",
        detail: `entities=${bundle.entities.length} patterns=${bundle.companyPatterns.length + bundle.globalPatterns.length} rules=${(bundle.companyRules?.length || 0) + (bundle.globalRules?.length || 0)} memory=${bundle.companyMemory.length}`,
        client_type: probe?.clientType || (context.supabase ? "context_service_role" : "service_role_admin"),
        probe: probe?.tables || null,
      });
    }
  } catch (error) {
    enrichedContext = { ...context, knowledgeBundle: null };
    state.debug_trace.push({
      stage: "knowledge_db",
      outcome: "error",
      detail: error?.message || "Bundle load failed",
    });
  }

  const stages = [
    { fn: resolveCompanyMemory, passState: true },
    { fn: resolveEntity, passState: true },
    { fn: resolvePatterns, passState: true },
    { fn: resolveCompanyRules, passState: true },
    { fn: resolveGlobalKnowledge, passState: true },
    { fn: resolveAccountingRules, passState: true },
    { fn: (_i, _c, s) => Promise.resolve(applyConfidenceEngine(s)), passState: true },
    { fn: (_i, _c, s) => Promise.resolve(applyRiskEngine(s)), passState: true },
    { fn: (_i, _c, s) => Promise.resolve(resolveAiStub(s)), passState: true },
    { fn: (_i, _c, s) => Promise.resolve(resolveManualQueue(s)), passState: true },
  ];

  for (const stage of stages) {
    const result = await runStage(
      stage.fn,
      input,
      enrichedContext,
      stage.passState ? state : undefined
    );
    state = applyStageResult(state, result);
  }

  if (!hasAnyMatch(state)) {
    state.status = CORE_DECISION_STATUS.UNKNOWN;
    state.confidence_score = 0;
    state.needs_manual_review = true;
    state.debug_trace.push({
      stage: "fallback",
      outcome: "unknown",
      detail: "No knowledge match found",
    });
  }

  const finalResult = createCoreDecisionResult(state);

  await persistDecisionHistory({
    input,
    context: enrichedContext,
    result: finalResult,
  });

  void logCoreDecisionEvent({
    module: context.module,
    company_id: input.company_id,
    user_id: context.user_id,
    request_id: context.request_id,
    decision_source: finalResult.decision_source,
    status: finalResult.status,
    confidence_score: finalResult.confidence_score,
  });

  return finalResult;
}
