/**
 * Sol menü href listesi + prefetch dedup/kuyruk.
 * Navigasyon sırasında pause → contention azaltır.
 */

import { normalizeMenuPath } from "./annveroNavActiveGroup.js";

/** Development idle prefetch: en fazla bu kadar öncelikli route. */
export const DEV_IDLE_PREFETCH_LIMIT = 3;

/** Navigasyon sonrası kuyruk kilitli kalmasın. */
export const NAV_RESUME_TIMEOUT_MS = 9000;

/**
 * Nav gruplarından benzersiz pathname listesi (query düşülür).
 * @param {Array<{ href?: string, items?: Array<{ href?: string }> }>} groups
 */
export function listNavHrefs(groups = []) {
  const seen = new Set();
  const out = [];
  for (const group of groups || []) {
    const candidates = [];
    if (group?.href) candidates.push(group.href);
    for (const item of group?.items || []) {
      if (item?.href) candidates.push(item.href);
    }
    for (const href of candidates) {
      const key = normalizeMenuPath(href);
      if (!key || key === "/" || seen.has(key)) continue;
      seen.add(key);
      out.push(href);
    }
  }
  return out;
}

/**
 * Öncelik listesini mevcut grup href'leri ile kesiştir.
 * @param {{ maxItems?: number, excludePath?: string }} options
 */
export function resolveIdlePrefetchOrder(
  priorityHrefs = [],
  groups = [],
  options = {}
) {
  const maxItems =
    options.maxItems == null || !Number.isFinite(options.maxItems)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Number(options.maxItems));
  const excludeKey = normalizeMenuPath(options.excludePath || "");

  const available = new Set(
    listNavHrefs(groups).map((h) => normalizeMenuPath(h))
  );
  const ordered = [];
  const seen = new Set();

  for (const href of priorityHrefs || []) {
    if (ordered.length >= maxItems) break;
    const key = normalizeMenuPath(href);
    if (!key || !available.has(key) || seen.has(key)) continue;
    if (excludeKey && key === excludeKey) continue;
    seen.add(key);
    ordered.push(href.split("?")[0]);
  }
  return ordered;
}

/**
 * Dedup + sıralı prefetch + navigation pause/resume.
 */
export function createNavPrefetchController({
  prefetchFn,
  isDev = false,
  staggerMs = null,
  resumeTimeoutMs = NAV_RESUME_TIMEOUT_MS,
} = {}) {
  const done = new Set();
  const queued = new Set();
  /** @type {string[]} */
  let queue = [];
  let running = false;
  let paused = false;
  let navigationPending = false;
  let navigationHref = "";
  let activePath = "";
  let resumeTimer = null;
  let pumpGeneration = 0;

  const gap = staggerMs != null ? staggerMs : isDev ? 420 : 60;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clearResumeTimer() {
    if (resumeTimer != null) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  }

  function setActivePath(pathname = "") {
    activePath = normalizeMenuPath(pathname);
  }

  function pause() {
    paused = true;
    pumpGeneration += 1;
  }

  function cancelPending() {
    for (const href of queue) {
      queued.delete(normalizeMenuPath(href));
    }
    queue = [];
  }

  function prioritize(href) {
    if (!href || typeof prefetchFn !== "function") return false;
    const key = normalizeMenuPath(href);
    if (!key) return false;

    queue = queue.filter((item) => normalizeMenuPath(item) !== key);
    queued.delete(key);

    try {
      prefetchFn(href);
    } catch {
      /* ignore */
    }
    done.add(key);
    return true;
  }

  function resume() {
    clearResumeTimer();
    paused = false;
    navigationPending = false;
    navigationHref = "";
    void pump();
  }

  function beginNavigation(href, { timeoutMs = resumeTimeoutMs } = {}) {
    if (!href) return false;
    const key = normalizeMenuPath(href);
    if (!key) return false;

    pause();
    cancelPending();
    navigationPending = true;
    navigationHref = href;
    prioritize(href);

    clearResumeTimer();
    const ms = Number.isFinite(timeoutMs) ? timeoutMs : resumeTimeoutMs;
    resumeTimer = setTimeout(() => {
      if (navigationPending) {
        resume();
      }
    }, ms);

    return true;
  }

  function completeNavigation(pathname = "") {
    if (!navigationPending) return false;
    const current = normalizeMenuPath(pathname);
    const target = normalizeMenuPath(navigationHref);
    if (!target || current === target) {
      resume();
      return true;
    }
    return false;
  }

  function enqueue(href, { front = false } = {}) {
    if (!href || typeof prefetchFn !== "function") return false;
    if (paused || navigationPending) return false;

    const key = normalizeMenuPath(href);
    if (!key) return false;
    if (activePath && key === activePath) return false;
    if (done.has(key) || queued.has(key)) return false;

    queued.add(key);
    if (front) queue.unshift(href);
    else queue.push(href);
    void pump();
    return true;
  }

  function enqueueMany(hrefs = [], { front = false } = {}) {
    if (paused || navigationPending) return 0;
    let n = 0;
    const list = front ? [...hrefs].reverse() : hrefs;
    for (const href of list) {
      if (enqueue(href, { front })) n += 1;
    }
    return n;
  }

  async function pump() {
    if (running || paused) return;
    running = true;
    const gen = pumpGeneration;

    while (queue.length) {
      if (paused || gen !== pumpGeneration) break;
      const href = queue.shift();
      const key = normalizeMenuPath(href);
      queued.delete(key);
      if (!key || done.has(key)) continue;
      if (activePath && key === activePath) continue;

      done.add(key);
      try {
        prefetchFn(href);
      } catch {
        /* ignore */
      }

      if (gap > 0 && queue.length && !paused) {
        await sleep(gap);
        if (paused || gen !== pumpGeneration) break;
      }
    }

    running = false;
    if (!paused && queue.length) {
      void pump();
    }
  }

  return {
    enqueue,
    enqueueMany,
    pause,
    resume,
    prioritize,
    cancelPending,
    beginNavigation,
    completeNavigation,
    setActivePath,
    has(href) {
      return done.has(normalizeMenuPath(href));
    },
    get size() {
      return done.size;
    },
    get pending() {
      return queue.length;
    },
    get isPaused() {
      return paused;
    },
    get isNavigationPending() {
      return navigationPending;
    },
    get navigationHref() {
      return navigationHref;
    },
  };
}
