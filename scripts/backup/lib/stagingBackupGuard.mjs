/**
 * Staging Storage backup — project ref kilidi.
 * Production ref her zaman fail-closed (override yok).
 * Secret değer basılmaz.
 */

export const STAGING_PROJECT_REF = "bveipjvbopbkvojfdpmo";
export const PRODUCTION_PROJECT_REF = "ttxigznwcjvrlzuppbro";

export const BACKUP_RETENTION = Object.freeze({
  daily_days: 35,
  weekly_weeks: 12,
  monthly_months: 12,
  note: "Retention silme yalnız BACKUP_DELETE_CONFIRM=1 + yaş filtresi ile; kaynak Storage objelerine dokunulmaz.",
});

/** Drill-only bucket öneki — kullanıcı bucket'ları asla hedef alınmaz. */
export const DRILL_BUCKET_PREFIX = "annvero-auto-storage-backup-";

export function normalize(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

export function extractSupabaseProjectRef(supabaseUrl = "") {
  try {
    const host = new URL(supabaseUrl).hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}

/**
 * Canlı / dry-run hedef doğrulama.
 * - production ref → her zaman reddedilir
 * - live mode → yalnız staging ref
 * - dry-run → sentetik; URL yoksa da ok; URL varsa production hâlâ reddedilir
 */
export function assertStagingOnlyBackupTarget({
  supabaseUrl = "",
  projectRef = "",
  mode = "dry-run",
} = {}) {
  const ref =
    normalize(projectRef).toLowerCase() ||
    extractSupabaseProjectRef(supabaseUrl);
  const normalizedMode = normalize(mode).toLowerCase() || "dry-run";

  if (ref === PRODUCTION_PROJECT_REF) {
    return {
      ok: false,
      blocked: true,
      code: "PRODUCTION_REF_FORBIDDEN",
      projectRef: ref,
      mode: normalizedMode,
      message:
        "Production Supabase project ref yasak (ttxigznwcjvrlzuppbro). Staging-only backup durdu.",
    };
  }

  if (normalizedMode === "live") {
    if (!ref) {
      return {
        ok: false,
        blocked: true,
        code: "STAGING_REF_REQUIRED",
        projectRef: "",
        mode: normalizedMode,
        message:
          "Live backup için staging project ref gerekli (bveipjvbopbkvojfdpmo).",
      };
    }
    if (ref !== STAGING_PROJECT_REF) {
      return {
        ok: false,
        blocked: true,
        code: "NON_STAGING_REF_FORBIDDEN",
        projectRef: ref,
        mode: normalizedMode,
        message: `Live backup yalnız staging ref kabul eder (beklenen ${STAGING_PROJECT_REF}, gelen ${ref}).`,
      };
    }
  }

  if (ref && ref !== STAGING_PROJECT_REF && normalizedMode !== "dry-run") {
    return {
      ok: false,
      blocked: true,
      code: "UNEXPECTED_REF",
      projectRef: ref,
      mode: normalizedMode,
      message: `Beklenmeyen project ref: ${ref}`,
    };
  }

  return {
    ok: true,
    blocked: false,
    projectRef: ref || (normalizedMode === "dry-run" ? "(synthetic)" : ""),
    mode: normalizedMode,
    staging: STAGING_PROJECT_REF,
  };
}

/** Log / hata metninden olası secret sızıntısını maskele. */
export function redactSecrets(text = "") {
  return String(text)
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "sb_secret_[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT_REDACTED]")
    .replace(/(service_role|apikey|authorization)["']?\s*[:=]\s*["'][^"']+/gi, "$1=[REDACTED]");
}
