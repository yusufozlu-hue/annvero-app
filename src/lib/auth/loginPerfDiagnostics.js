/**
 * Staging-only login performans ölçümü.
 * Varsayılan kapalı. Production host'ta (annvero.com) asla aktif olmaz.
 * Hassas veri yok: yalnız stage adı, süre, route, ok/hata türü.
 */

export const AUTH_PERF_QUERY = "auth_perf";
export const AUTH_PERF_STORAGE_KEY = "annvero_auth_perf_run";
export const AUTH_PERF_ARMED_KEY = "annvero_auth_perf_armed";
export const AUTH_PERF_EVENT = "annvero:auth-perf-updated";

const MAX_MARKS = 40;

function randomId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID().slice(0, 8);
    }
  } catch {
    // fall through
  }
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function safeHost() {
  try {
    return String(window.location.hostname || "").toLowerCase();
  } catch {
    return "";
  }
}

function isProductionAnnveroHost(host) {
  return host === "annvero.com" || host === "www.annvero.com";
}

function isAllowedStagingHost(host) {
  return (
    host.includes("annvero-staging") ||
    host.endsWith(".vercel.app") ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
}

/** UI/ölçüm yalnız staging(+local) ve açık debug anahtarıyla. */
export function isAuthPerfDiagnosticsEnabled() {
  if (typeof window === "undefined") return false;
  try {
    const host = safeHost();
    if (isProductionAnnveroHost(host)) return false;
    if (!isAllowedStagingHost(host)) return false;

    const params = new URLSearchParams(window.location.search);
    if (params.get(AUTH_PERF_QUERY) === "1") return true;
    return window.sessionStorage.getItem(AUTH_PERF_ARMED_KEY) === "1";
  } catch {
    return false;
  }
}

/** ?auth_perf=1 görüldüğünde navigation sonrası da açık kalsın. */
export function armAuthPerfDiagnosticsFromQuery() {
  if (typeof window === "undefined") return false;
  try {
    const host = safeHost();
    if (isProductionAnnveroHost(host) || !isAllowedStagingHost(host)) {
      window.sessionStorage.removeItem(AUTH_PERF_ARMED_KEY);
      return false;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get(AUTH_PERF_QUERY) === "1") {
      window.sessionStorage.setItem(AUTH_PERF_ARMED_KEY, "1");
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function readRun() {
  try {
    const raw = window.sessionStorage.getItem(AUTH_PERF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.id || !parsed.t0) {
      return null;
    }
    if (!Array.isArray(parsed.marks)) parsed.marks = [];
    return parsed;
  } catch {
    return null;
  }
}

function writeRun(run) {
  try {
    window.sessionStorage.setItem(AUTH_PERF_STORAGE_KEY, JSON.stringify(run));
    window.dispatchEvent(new CustomEvent(AUTH_PERF_EVENT));
  } catch {
    // ignore
  }
}

function emitSummary(run) {
  if (!run?.marks?.length) return;
  const rows = buildAuthPerfRows(run);
  try {
    console.info(`[annvero-auth-perf] id=${run.id} route=${run.route || "-"}`);
    console.table(rows);
  } catch {
    // ignore
  }
}

export function buildAuthPerfRows(run) {
  if (!run?.marks?.length) return [];
  const t0 = Number(run.t0) || 0;
  return run.marks.map((mark, index) => {
    const prevT = index === 0 ? t0 : Number(run.marks[index - 1].t) || t0;
    const t = Number(mark.t) || t0;
    return {
      stage: String(mark.stage || ""),
      ms_from_start: Math.max(0, Math.round(t - t0)),
      ms_step: Math.max(0, Math.round(t - prevT)),
      ok: mark.ok !== false,
      err: mark.err || "",
      route: mark.route || run.route || "",
    };
  });
}

export function getAuthPerfDurations(run) {
  const rows = buildAuthPerfRows(run);
  const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]));
  const last = rows[rows.length - 1];
  const pick = (name) => byStage[name]?.ms_step ?? null;
  const fromStart = (name) => byStage[name]?.ms_from_start ?? null;

  return {
    id: run?.id || "",
    supabase_login_ms: pick("supabase_login"),
    return_to_ms: pick("return_to"),
    navigation_ms: pick("document_load"),
    auth_gate_ms: pick("auth_gate_ready"),
    shell_ms: pick("shell_ready"),
    companies_ms: pick("companies_ready"),
    total_ms: last?.ms_from_start ?? null,
    supabase_login_at: fromStart("supabase_login"),
    return_to_at: fromStart("return_to"),
    document_load_at: fromStart("document_load"),
    auth_gate_at: fromStart("auth_gate_ready"),
    shell_at: fromStart("shell_ready"),
    companies_at: fromStart("companies_ready"),
  };
}

export function startAuthPerfRun({ route = "" } = {}) {
  if (!isAuthPerfDiagnosticsEnabled()) return null;
  const run = {
    id: randomId(),
    t0: Date.now(),
    route: typeof route === "string" ? route.slice(0, 80) : "",
    marks: [{ stage: "login_submit", t: Date.now(), ok: true, route: "" }],
  };
  writeRun(run);
  return run.id;
}

export function markAuthPerf(
  stage,
  { ok = true, err = "", route = "", once = false } = {}
) {
  if (!isAuthPerfDiagnosticsEnabled()) return;
  if (!stage || typeof stage !== "string") return;
  const run = readRun();
  if (!run) return;
  if (once && run.marks.some((m) => m.stage === stage)) return;

  const safeErr =
    typeof err === "string" && err && !/token|password|email|bearer|cookie/i.test(err)
      ? err.slice(0, 40)
      : err
        ? "error"
        : "";

  run.marks.push({
    stage: stage.slice(0, 48),
    t: Date.now(),
    ok: ok !== false,
    err: safeErr,
    route: typeof route === "string" ? route.slice(0, 80) : "",
  });
  if (run.marks.length > MAX_MARKS) {
    run.marks = run.marks.slice(-MAX_MARKS);
  }
  if (route && !run.route) {
    run.route = String(route).slice(0, 80);
  }
  writeRun(run);

  if (
    stage === "shell_ready" ||
    stage === "companies_ready" ||
    stage === "auth_perf_done"
  ) {
    emitSummary(run);
  }
}

/** Hard navigation öncesi: run'ı sakla (zaten sessionStorage). */
export function markAuthPerfNavigationStart(route) {
  markAuthPerf("navigation_start", { route });
}

export function markAuthPerfDocumentLoad(route) {
  if (!isAuthPerfDiagnosticsEnabled()) return;
  const run = readRun();
  if (!run) return;
  if (run.marks.some((m) => m.stage === "document_load")) return;

  let navMs = null;
  try {
    const nav = performance.getEntriesByType?.("navigation")?.[0];
    if (nav && typeof nav.duration === "number") {
      navMs = Math.round(nav.duration);
    }
  } catch {
    // ignore
  }

  markAuthPerf("document_load", { route });
  if (navMs != null) {
    // Ek bilgi: yalnız süre; URL query yok.
    markAuthPerf("nav_timing", {
      ok: true,
      err: `d=${navMs}`,
      route,
      once: true,
    });
  }
}

export function readAuthPerfRun() {
  if (typeof window === "undefined") return null;
  if (!isAuthPerfDiagnosticsEnabled()) return null;
  return readRun();
}

export function clearAuthPerfRun() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(AUTH_PERF_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_PERF_ARMED_KEY);
    window.dispatchEvent(new CustomEvent(AUTH_PERF_EVENT));
  } catch {
    // ignore
  }
}
