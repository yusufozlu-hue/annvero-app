/**
 * Node worker_threads stand-in for eDefterAnalyze.worker.js message contract.
 * Proves analyze can leave the main event loop (heartbeat stays alive).
 */
import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import {
  EDEFTER_ANALYZE_PROTOCOL,
  executeEDefterAnalyzePayload,
  sanitizeAnalyzeResult,
} from "@/src/utils/eDefterAnalyzeContract.js";

parentPort.on("message", async (data = {}) => {
  const requestId = data?.requestId;
  const identity = {
    requestId,
    generation: data?.generation ?? 0,
    fileKind: data?.fileKind || "analysis",
  };
  const protocolVersion = Number(data?.protocolVersion || 0);
  const payload =
    data?.payload && typeof data.payload === "object" && !Array.isArray(data.payload)
      ? data.payload
      : null;

  try {
    if (!requestId) {
      parentPort.postMessage({
        type: "error",
        ...identity,
        error: "Analyze requestId zorunlu.",
        code: "ANALYZE_REQUEST_ID_MISSING",
      });
      return;
    }
    if (protocolVersion && protocolVersion !== EDEFTER_ANALYZE_PROTOCOL) {
      parentPort.postMessage({
        type: "error",
        ...identity,
        error: "Analyze worker protokol sürümü uyuşmuyor.",
        code: "ANALYZE_PROTOCOL_MISMATCH",
      });
      return;
    }
    if (!payload) {
      parentPort.postMessage({
        type: "error",
        ...identity,
        error: "Analyze payload zorunlu.",
        code: "ANALYZE_PAYLOAD_MISSING",
      });
      return;
    }

    const started = performance.now();
    const raw = await executeEDefterAnalyzePayload(payload);
    const result = sanitizeAnalyzeResult(raw, {
      execution: "worker",
      engineInvocations: 1,
      elapsedMs: Math.round(performance.now() - started),
      thread: "worker_threads",
    });
    parentPort.postMessage({ type: "success", ...identity, result, ...result });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      ...identity,
      error: error?.message || "worker failed",
      code: error?.code || "ANALYZE_WORKER_FAILED",
    });
  }
});
