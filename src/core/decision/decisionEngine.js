/**
 * CORE karar pipeline orkestratörü.
 */

import { resolveEntity } from "../entity/entityResolver.js";
import { resolveCompanyMemory } from "../memory/memoryResolver.js";
import { resolveCompanyRules } from "../rules/ruleResolver.js";
import { resolveGlobalKnowledge, resolveAccountingRules } from "../knowledge/knowledgeResolver.js";
import { applyConfidenceEngine } from "../confidence/confidenceEngine.js";
import { applyRiskEngine } from "../risk/riskEngine.js";
import { resolveAiStub } from "./aiStub.js";
import { resolveManualQueue } from "./manualQueue.js";
import { createCoreDecisionResult } from "../types/decisionResult.js";
import { logCoreDecisionEvent } from "../audit/coreAudit.js";

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
    Object.assign(nextState, result.partial);
  }

  nextState.debug_trace = traces;
  return nextState;
}

/**
 * Tam karar pipeline'ını çalıştırır.
 * @param {object} input — normalize edilmiş input
 * @param {object} context — normalize edilmiş context
 */
export async function runDecisionPipeline(input, context) {
  let state = createCoreDecisionResult();

  const stages = [
    { fn: resolveEntity, passState: true },
    { fn: resolveCompanyMemory, passState: true },
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
      context,
      stage.passState ? state : undefined
    );
    state = applyStageResult(state, result);
  }

  const finalResult = createCoreDecisionResult(state);

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
