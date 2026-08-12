/**
 * MARE / banka yeniden-analiz single-flight orchestration.
 * Hydrate + manual aynı anahtarla tek uçuş; Strict Mode / çift tıklama ikinci job açmaz.
 */

export const REANALYZE_CLICK_BUSY_TOAST =
  "Yeniden analiz zaten sürüyor veya başka bir banka işlemi devam ediyor.";

export const REANALYZE_RETRY_LABEL = "Yeniden dene";

/** @typedef {'idle'|'armed'|'running'|'completed'|'failed'} ReanalyzeFlightStatus */

/**
 * @param {{
 *   companyId?: string,
 *   sourceId?: string,
 *   sourceRevision?: string|number,
 *   planFingerprint?: string,
 * }} opts
 */
export function buildReanalyzeFlightKey({
  companyId = "",
  sourceId = "",
  sourceRevision = "1",
  planFingerprint = "",
} = {}) {
  return [
    String(companyId || "").trim() || "nocompany",
    String(sourceId || "").trim() || "nosource",
    String(sourceRevision ?? "1").trim() || "1",
    String(planFingerprint || "").trim() || "nopfp",
  ].join("|");
}

/**
 * Revision + plan + pipelineVersion — aynı kod/kaynak/plan tekrarında dedupe;
 * farklı pipelineVersion eski completed job’u reuse etmez.
 * @param {{
 *   companyId?: string,
 *   contentHash?: string,
 *   revision?: number,
 *   planFingerprint?: string,
 *   engineVersion?: string,
 *   pipelineVersion?: string,
 *   sourceId?: string,
 *   sourceRevision?: number|string,
 *   snapshotFingerprint?: string,
 * }} opts
 */
export function buildPlanAwareRevisionIdempotencyKey({
  companyId = "",
  contentHash = "",
  revision = 2,
  planFingerprint = "",
  engineVersion = "",
  pipelineVersion = "",
  sourceId = "",
  sourceRevision = "",
  snapshotFingerprint = "",
} = {}) {
  const rev = Math.max(2, Number(revision) || 2);
  const plan = String(planFingerprint || "nopfp")
    .trim()
    .slice(0, 64);
  const pipe = String(pipelineVersion || "nopipe")
    .trim()
    .slice(0, 96);
  const src = String(sourceId || "")
    .trim()
    .slice(0, 36);
  const srev = String(sourceRevision ?? "")
    .trim()
    .slice(0, 16);
  const snap = String(snapshotFingerprint || contentHash || "nosnap")
    .trim()
    .slice(0, 64);
  const baseParts = [
    String(companyId || "").trim(),
    String(contentHash || "").trim() || "nohash",
    String(engineVersion || "").trim() || "eng",
    `rev:${rev}`,
    `plan:${plan || "nopfp"}`,
    `pipe:${pipe || "nopipe"}`,
  ];
  if (src) baseParts.push(`src:${src}`);
  if (srev) baseParts.push(`srev:${srev}`);
  if (snap) baseParts.push(`snap:${snap}`);
  return baseParts.join(":");
}

/** Module-level — React Strict Mode remount’ta ikinci uçuşu keser */
const globalFlights = new Map();
const consumedHydrateKeys = new Set();

export function __resetReanalyzeOrchestrationForTests() {
  globalFlights.clear();
  consumedHydrateKeys.clear();
}

export function getReanalyzeFlight(key) {
  return globalFlights.get(String(key || "")) || null;
}

/**
 * @returns {{ action: 'start', flight: object } | { action: 'join', flight: object }}
 */
export function claimOrJoinReanalyzeFlight(key, { owner = "manual" } = {}) {
  const k = String(key || "");
  const existing = globalFlights.get(k);
  if (
    existing &&
    (existing.status === "running" || existing.status === "pending")
  ) {
    return { action: "join", flight: existing };
  }
  const flight = {
    key: k,
    status: "running",
    owner,
    startedAt: Date.now(),
    promise: null,
    result: null,
    error: null,
  };
  globalFlights.set(k, flight);
  return { action: "start", flight };
}

export function attachReanalyzeFlightPromise(key, promise) {
  const flight = globalFlights.get(String(key || ""));
  if (flight) {
    flight.promise = promise;
  }
  return promise;
}

export function completeReanalyzeFlight(key, result = null) {
  const flight = globalFlights.get(String(key || ""));
  if (!flight) return;
  flight.status = "completed";
  flight.result = result;
  flight.promise = null;
}

export function failReanalyzeFlight(key, error = null) {
  const flight = globalFlights.get(String(key || ""));
  if (!flight) return;
  flight.status = "failed";
  flight.error = error;
  flight.promise = null;
}

export function clearReanalyzeFlight(key) {
  globalFlights.delete(String(key || ""));
}

export function clearReanalyzeFlightsForCompany(companyId) {
  const prefix = `${String(companyId || "").trim()}|`;
  for (const key of [...globalFlights.keys()]) {
    if (key.startsWith(prefix)) globalFlights.delete(key);
  }
  for (const key of [...consumedHydrateKeys]) {
    if (key.startsWith(prefix)) consumedHydrateKeys.delete(key);
  }
}

export function clearAllReanalyzeFlights() {
  globalFlights.clear();
  consumedHydrateKeys.clear();
}

/**
 * Hydrate state-machine: aynı flight key için yalnız bir kez auto-start.
 * @returns {{ armed: boolean, alreadyConsumed: boolean }}
 */
export function armCanonicalHydrateReanalyze(key) {
  const k = String(key || "");
  if (!k || consumedHydrateKeys.has(k)) {
    return { armed: false, alreadyConsumed: Boolean(k && consumedHydrateKeys.has(k)) };
  }
  const running = globalFlights.get(k);
  if (running && (running.status === "running" || running.status === "pending")) {
    return { armed: false, alreadyConsumed: false };
  }
  return { armed: true, alreadyConsumed: false };
}

/**
 * Effect içinde: armed key’i tek seferde consume et.
 * @returns {boolean} true → auto start çağrılmalı
 */
export function consumeCanonicalHydrateReanalyze(key) {
  const k = String(key || "");
  if (!k) return false;
  if (consumedHydrateKeys.has(k)) return false;
  const running = globalFlights.get(k);
  if (running && (running.status === "running" || running.status === "pending")) {
    consumedHydrateKeys.add(k);
    return false;
  }
  consumedHydrateKeys.add(k);
  return true;
}

export function markHydrateReanalyzeConsumed(key) {
  const k = String(key || "");
  if (k) consumedHydrateKeys.add(k);
}

/**
 * UI: buton ne göstersin?
 * @returns {'hidden'|'loading'|'retry'|'ready'}
 */
export function resolveReanalyzeButtonMode({
  hasResultSurface = false,
  isReanalyzing = false,
  reanalyzeFailed = false,
  fromCanonicalSnapshot = false,
  isDuplicate = false,
} = {}) {
  if (isReanalyzing) return "loading";
  if (reanalyzeFailed && hasResultSurface) return "retry";
  // Hydrate otomatik çalışır; manual yalnız hata/retry veya mükerrer yüzey
  if (isDuplicate) return "ready";
  void fromCanonicalSnapshot;
  return "hidden";
}

/**
 * Loading her zaman ilk senkron adım; in-flight join yeni claim açmaz.
 */
export function claimReanalyzeClick({
  lockRef,
  isReanalyzing,
  isJobBusy,
  pipelineRunning = false,
  setIsReanalyzing,
  flightKey = "",
  owner = "manual",
} = {}) {
  let healedOrphanLock = false;
  if (
    lockRef?.current &&
    !isReanalyzing &&
    !pipelineRunning &&
    !isJobBusy
  ) {
    const existing = flightKey ? globalFlights.get(String(flightKey)) : null;
    if (!existing || existing.status !== "running") {
      lockRef.current = false;
      healedOrphanLock = true;
    }
  }

  if (flightKey) {
    const joined = claimOrJoinReanalyzeFlight(flightKey, { owner });
    if (joined.action === "join") {
      if (typeof setIsReanalyzing === "function") setIsReanalyzing(true);
      if (lockRef) lockRef.current = true;
      return {
        ok: false,
        reason: "join_in_flight",
        healedOrphanLock,
        flight: joined.flight,
      };
    }
  }

  if (lockRef?.current || isReanalyzing) {
    if (flightKey) {
      // claimOrJoin start etti ama lokal kilit başka uçuşta — geri al
      clearReanalyzeFlight(flightKey);
    }
    return { ok: false, reason: "in_flight", healedOrphanLock };
  }

  lockRef.current = true;
  if (typeof setIsReanalyzing === "function") setIsReanalyzing(true);

  if (isJobBusy || pipelineRunning) {
    if (flightKey) clearReanalyzeFlight(flightKey);
    return { ok: false, reason: "job_busy", healedOrphanLock };
  }

  return { ok: true, healedOrphanLock };
}

export function releaseReanalyzeClick({
  lockRef,
  setIsReanalyzing,
  clearOverrides,
} = {}) {
  if (typeof setIsReanalyzing === "function") {
    setIsReanalyzing(false);
  }
  if (lockRef) {
    lockRef.current = false;
  }
  if (typeof clearOverrides === "function") {
    clearOverrides();
  }
}

/**
 * 409 / COMPANY_JOB_ACTIVE → boş ekran değil, mevcut uçuşa katıl.
 */
export function shouldFollowExistingJobOnConflict(error) {
  const code = String(error?.code || error?.status || "");
  const status = Number(error?.status || 0);
  return (
    status === 409 ||
    code === "COMPANY_JOB_ACTIVE" ||
    code === "409" ||
    /zaten aktif bir işlem/i.test(String(error?.message || ""))
  );
}
