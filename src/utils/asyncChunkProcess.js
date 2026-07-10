/**
 * Ana thread'i kilitlemeden büyük dizileri işlemek için chunk + yield yardımcıları.
 */

export class ParseAbortError extends Error {
  constructor(message = "İşlem iptal edildi.") {
    super(message);
    this.name = "ParseAbortError";
    this.code = "ABORTED";
  }
}

export function yieldToMain(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertNotAborted(signal) {
  if (signal?.aborted) {
    throw new ParseAbortError();
  }
}

/**
 * Diziyi chunk'lar halinde map eder; her chunk sonrası event loop'a bırakır.
 */
export async function mapInChunksAsync(
  items = [],
  mapper,
  {
    chunkSize = 50,
    signal = null,
    onChunk = null,
  } = {}
) {
  const list = Array.isArray(items) ? items : [];
  const result = new Array(list.length);
  const size = Math.max(1, Number(chunkSize) || 50);

  for (let offset = 0; offset < list.length; offset += size) {
    assertNotAborted(signal);
    const end = Math.min(offset + size, list.length);
    for (let index = offset; index < end; index += 1) {
      result[index] = mapper(list[index], index);
    }
    onChunk?.(end, list.length);
    if (end < list.length) {
      await yieldToMain(0);
    }
  }

  return result;
}

export async function reduceInChunksAsync(
  items = [],
  reducer,
  initialValue,
  {
    chunkSize = 50,
    signal = null,
    onChunk = null,
  } = {}
) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(chunkSize) || 50);
  let acc = initialValue;

  for (let offset = 0; offset < list.length; offset += size) {
    assertNotAborted(signal);
    const end = Math.min(offset + size, list.length);
    for (let index = offset; index < end; index += 1) {
      acc = reducer(acc, list[index], index);
    }
    onChunk?.(end, list.length);
    if (end < list.length) {
      await yieldToMain(0);
    }
  }

  return acc;
}

export function createStageTimer(enabled = false) {
  const marks = Object.create(null);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

  return {
    start(name) {
      if (!enabled) return;
      marks[name] = typeof performance !== "undefined" ? performance.now() : Date.now();
    },
    end(name) {
      if (!enabled || marks[name] == null) return 0;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = Math.round(now - marks[name]);
      marks[`${name}Ms`] = elapsed;
      return elapsed;
    },
    report(label = "[bank-parser-timing]") {
      if (!enabled) return null;
      const totalMs = Math.round(
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
      );
      const payload = { ...marks, totalMs };
      console.info(label, payload);
      return payload;
    },
  };
}

export function isDevTelemetryEnabled() {
  return (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "development"
  );
}
