/**
 * Firma/oturum bazlı learning_memory okuma cache’i (Faz 3).
 * Aynı firma için gereksiz ikinci GET’i engeller; firma değişiminde epoch artar.
 */

import { fetchLearningMemoryForCompany } from "@/src/utils/learningMemory";

const byCompany = new Map();
const inflight = new Map();
/** Firma değişimi / boş firma: stale yanıtları geçersiz kılar */
let epoch = 0;

export function getAccountingLearningMemoryEpoch() {
  return epoch;
}

export function bumpAccountingLearningMemoryEpoch() {
  epoch += 1;
  return epoch;
}

export function clearAccountingLearningMemorySession(companyId = "") {
  const id = String(companyId || "").trim();
  if (!id) {
    byCompany.clear();
    inflight.clear();
    bumpAccountingLearningMemoryEpoch();
    return;
  }
  byCompany.delete(id);
  inflight.delete(id);
}

export function peekAccountingLearningMemorySession(companyId = "") {
  const id = String(companyId || "").trim();
  if (!id) return null;
  const hit = byCompany.get(id);
  return hit ? hit.rows : null;
}

/**
 * Tenant-safe company fetch with in-flight dedupe + session cache.
 * Fetch failure: returns [] and does not poison cache (caller fail-soft).
 * Stale epoch (firma değişti): sonucu cache’e yazmaz, [] döner.
 */
export async function loadAccountingLearningMemoryForCompany(
  companyId = "",
  {
    force = false,
    fetchFn = fetchLearningMemoryForCompany,
    includeInactive = false,
    expectedEpoch = null,
  } = {}
) {
  const id = String(companyId || "").trim();
  if (!id) return [];

  const epochAtStart =
    expectedEpoch == null ? epoch : Number(expectedEpoch);

  if (!force) {
    const cached = byCompany.get(id);
    if (cached && (expectedEpoch == null || cached.epoch === epochAtStart)) {
      return cached.rows;
    }
    if (inflight.has(id)) {
      const rows = await inflight.get(id);
      if (expectedEpoch != null && epoch !== epochAtStart) return [];
      return rows;
    }
  }

  const run = (async () => {
    try {
      const rows = await fetchFn(id, { includeInactive });
      const list = Array.isArray(rows) ? rows : [];
      // Stale: başka firma/epoch — cache’e yazma, sızdırma
      if (epoch !== epochAtStart) {
        return [];
      }
      byCompany.set(id, {
        rows: list,
        fetchedAt: Date.now(),
        epoch: epochAtStart,
        companyId: id,
      });
      return list;
    } catch {
      if (epoch === epochAtStart) {
        byCompany.delete(id);
      }
      return [];
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, run);
  return run;
}

/**
 * Analiz öncesi: mevcut inflight/cache’i await et; sonucu epoch+company ile doğrula.
 */
export async function ensureAccountingLearningMemoryForCompany(
  companyId = "",
  options = {}
) {
  const id = String(companyId || "").trim();
  const epochAtStart =
    options.expectedEpoch == null ? epoch : Number(options.expectedEpoch);
  if (!id) {
    return {
      rows: [],
      companyId: "",
      epoch: epochAtStart,
      stale: false,
      ok: true,
    };
  }

  const rows = await loadAccountingLearningMemoryForCompany(id, {
    ...options,
    expectedEpoch: epochAtStart,
  });

  const stale = epoch !== epochAtStart;
  if (stale) {
    return {
      rows: [],
      companyId: id,
      epoch: epochAtStart,
      stale: true,
      ok: false,
    };
  }

  return {
    rows: Array.isArray(rows) ? rows : [],
    companyId: id,
    epoch: epochAtStart,
    stale: false,
    ok: true,
  };
}
