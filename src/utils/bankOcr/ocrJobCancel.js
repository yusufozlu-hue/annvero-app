/**
 * OCR iptal durumu — client-safe (native/canvas bağımlılığı yok).
 */

let activeWorker = null;
let activeAbort = null;

export function setOcrJobHandles(partial = {}) {
  if ("worker" in partial) activeWorker = partial.worker;
  if ("abort" in partial) activeAbort = partial.abort;
}

export function getOcrJobHandles() {
  return { worker: activeWorker, abort: activeAbort };
}

export function cancelBankOcrJob(reason = "cancelled") {
  if (activeAbort) {
    try {
      activeAbort.abort();
    } catch {
      /* ignore */
    }
    activeAbort = null;
  }
  if (activeWorker) {
    try {
      activeWorker.terminate();
    } catch {
      /* ignore */
    }
    activeWorker = null;
  }
  return { cancelled: true, reason };
}
