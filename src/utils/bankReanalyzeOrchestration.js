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
 * Tamamlanmış / hataya düşmüş / promise'siz uçuşlar canlı sayılmaz.
 */
export function isLiveReanalyzeFlight(flight = null) {
  if (!flight || typeof flight !== "object") return false;
  const status = String(flight.status || "");
  if (status !== "running" && status !== "pending") return false;
  if (flight.promise == null) return false;
  return true;
}

/**
 * Firma için stale uçuşları temizle; canlı busy bilgisini döndür.
 */
export function healStaleReanalyzeFlights({
  companyId = "",
  activeFlightKey = "",
} = {}) {
  let healed = 0;
  const prefix = `${String(companyId || "").trim()}|`;
  for (const [key, flight] of [...globalFlights.entries()]) {
    if (
      companyId &&
      !key.startsWith(prefix) &&
      key !== String(activeFlightKey || "")
    ) {
      continue;
    }
    const status = String(flight?.status || "");
    if (status === "completed" || status === "failed" || status === "idle") {
      globalFlights.delete(key);
      healed += 1;
      continue;
    }
    if (
      (status === "running" || status === "pending") &&
      flight?.promise == null
    ) {
      globalFlights.delete(key);
      healed += 1;
    }
  }
  const active = activeFlightKey
    ? globalFlights.get(String(activeFlightKey))
    : null;
  const live =
    isLiveReanalyzeFlight(active) ||
    [...globalFlights.values()].some((f) => isLiveReanalyzeFlight(f));
  return { healed, isLiveBusy: live };
}

/**
 * claim öncesi: ölü kilit + ölü uçuş temizliği.
 */
export function prepareReanalyzeClaimGuards({
  lockRef,
  isReanalyzing = false,
  pipelineRunning = false,
  reactJobBusy = false,
  bankJobBlocking = false,
  flightKey = "",
  companyId = "",
  activeFlightKey = "",
  resetBankJobState = null,
} = {}) {
  const flightHeal = healStaleReanalyzeFlights({
    companyId,
    activeFlightKey: activeFlightKey || flightKey,
  });
  let healedOrphanLock = false;
  let healedBankJob = false;

  if (
    bankJobBlocking &&
    !pipelineRunning &&
    !reactJobBusy &&
    !flightHeal.isLiveBusy
  ) {
    if (typeof resetBankJobState === "function") {
      resetBankJobState();
      healedBankJob = true;
    }
  }

  if (
    lockRef?.current &&
    !isReanalyzing &&
    !pipelineRunning &&
    !reactJobBusy &&
    !flightHeal.isLiveBusy
  ) {
    lockRef.current = false;
    healedOrphanLock = true;
  }

  return {
    healedOrphanLock,
    healedBankJob,
    healedFlights: flightHeal.healed,
    isLiveBusy:
      Boolean(pipelineRunning) ||
      Boolean(reactJobBusy) ||
      flightHeal.isLiveBusy,
  };
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
  companyId = "",
  activeFlightKey = "",
  bankJobBlocking = false,
  reactJobBusy = false,
  resetBankJobState = null,
} = {}) {
  const prep = prepareReanalyzeClaimGuards({
    lockRef,
    isReanalyzing,
    pipelineRunning,
    reactJobBusy: reactJobBusy || (isJobBusy && !pipelineRunning),
    bankJobBlocking: bankJobBlocking || Boolean(isJobBusy),
    flightKey,
    companyId,
    activeFlightKey,
    resetBankJobState,
  });
  let healedOrphanLock = prep.healedOrphanLock || prep.healedBankJob;

  if (
    lockRef?.current &&
    !isReanalyzing &&
    !pipelineRunning &&
    !prep.isLiveBusy
  ) {
    const existing = flightKey ? globalFlights.get(String(flightKey)) : null;
    if (!isLiveReanalyzeFlight(existing)) {
      lockRef.current = false;
      healedOrphanLock = true;
    }
  }

  if (flightKey) {
    const joined = claimOrJoinReanalyzeFlight(flightKey, { owner });
    if (joined.action === "join") {
      if (!isLiveReanalyzeFlight(joined.flight)) {
        clearReanalyzeFlight(flightKey);
        // stale join → fresh start below
      } else {
        if (typeof setIsReanalyzing === "function") setIsReanalyzing(true);
        if (lockRef) lockRef.current = true;
        return {
          ok: false,
          reason: "join_in_flight",
          healedOrphanLock,
          flight: joined.flight,
          isLiveBusy: true,
        };
      }
    }
  }

  if (lockRef?.current || isReanalyzing) {
    const existing = flightKey ? globalFlights.get(String(flightKey)) : null;
    if (
      !isReanalyzing &&
      !prep.isLiveBusy &&
      !isLiveReanalyzeFlight(existing)
    ) {
      // Ölü lokal kilit (UI idle) — iyileştir ve devam
      if (lockRef) lockRef.current = false;
      healedOrphanLock = true;
    } else {
      if (flightKey && !isLiveReanalyzeFlight(existing)) {
        clearReanalyzeFlight(flightKey);
      }
      return {
        ok: false,
        reason: isLiveReanalyzeFlight(existing) ? "join_in_flight" : "in_flight",
        healedOrphanLock,
        isLiveBusy: true,
        flight: existing || undefined,
      };
    }
  }

  lockRef.current = true;
  if (typeof setIsReanalyzing === "function") setIsReanalyzing(true);

  const stillBusy = prep.isLiveBusy || Boolean(pipelineRunning);
  if (stillBusy) {
    if (flightKey) clearReanalyzeFlight(flightKey);
    return {
      ok: false,
      reason: "job_busy",
      healedOrphanLock,
      isLiveBusy: true,
    };
  }

  // Stale isJobBusy / bankJobState healed → continue
  return { ok: true, healedOrphanLock, isLiveBusy: false };
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
