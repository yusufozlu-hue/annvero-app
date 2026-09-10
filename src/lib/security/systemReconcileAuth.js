/**
 * Google Drive reconcile — canonical system/cron authorization.
 * Session/tenant membership değildir; paylaşılan secret sistem yetkisidir.
 * Secret veya header değerleri loglanmaz.
 * NextResponse üretmez — çağıran route status/body’yi saranır.
 */

import { safeEqualString } from "@/src/lib/security/webhookAuth";
import { requiresStrictRuntimeSecrets } from "@/src/lib/security/envGuard";

export const SYSTEM_RECONCILE_AUTH_CODE = Object.freeze({
  SECRET_MISSING: "SECRET_MISSING",
  UNAUTHORIZED: "UNAUTHORIZED",
});

const SAFE_MESSAGES = Object.freeze({
  SECRET_MISSING: "Reconcile secret yapılandırılmamış.",
  UNAUTHORIZED: "Yetkisiz.",
});

function readEnvSecret(name) {
  return String(process.env[name] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

/**
 * Beklenen sistem secret önceliği:
 * 1) ANNVERO_RECONCILE_SECRET
 * 2) CRON_SECRET
 * İkisi de boşsa yapılandırılmamış sayılır.
 */
export function readSystemReconcileExpectedSecret() {
  return (
    readEnvSecret("ANNVERO_RECONCILE_SECRET") ||
    readEnvSecret("CRON_SECRET") ||
    ""
  );
}

function headerHasMultipleValues(raw) {
  const value = String(raw || "").trim();
  if (!value) return false;
  return value.includes(",");
}

/**
 * Authorization: Bearer <secret>  VEYA  x-annvero-reconcile-secret.
 * İkisi birden → ambiguity, fail-closed 401.
 * Virgüllü/birleştirilmiş, bozuk Bearer, boş credential → 401.
 * @returns {{ ok: true, provided: string } | { ok: false, code: string }}
 */
export function readSystemReconcileProvidedSecret(request) {
  const authRaw = String(request?.headers?.get?.("authorization") || "");
  const customRaw = String(
    request?.headers?.get?.("x-annvero-reconcile-secret") || ""
  );

  if (headerHasMultipleValues(authRaw) || headerHasMultipleValues(customRaw)) {
    return { ok: false, code: SYSTEM_RECONCILE_AUTH_CODE.UNAUTHORIZED };
  }

  let bearer = "";
  const auth = authRaw.trim();
  if (auth) {
    // Tam olarak tek Bearer credential; ek parça yok.
    const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (!match) {
      return { ok: false, code: SYSTEM_RECONCILE_AUTH_CODE.UNAUTHORIZED };
    }
    bearer = String(match[1] || "").trim();
    if (!bearer) {
      return { ok: false, code: SYSTEM_RECONCILE_AUTH_CODE.UNAUTHORIZED };
    }
  }

  const custom = customRaw.trim();

  // Ambiguity: iki header birden asla kabul edilmez (değerler eşit olsa bile).
  if (bearer && custom) {
    return { ok: false, code: SYSTEM_RECONCILE_AUTH_CODE.UNAUTHORIZED };
  }

  if (bearer) return { ok: true, provided: bearer };
  if (custom) return { ok: true, provided: custom };
  return { ok: false, code: SYSTEM_RECONCILE_AUTH_CODE.UNAUTHORIZED };
}

function unauthorizedPayload(code) {
  if (code === SYSTEM_RECONCILE_AUTH_CODE.SECRET_MISSING) {
    return {
      status: 503,
      body: {
        ok: false,
        code: SYSTEM_RECONCILE_AUTH_CODE.SECRET_MISSING,
        message: SAFE_MESSAGES.SECRET_MISSING,
      },
    };
  }
  return {
    status: 401,
    body: {
      ok: false,
      code: SYSTEM_RECONCILE_AUTH_CODE.UNAUTHORIZED,
      message: SAFE_MESSAGES.UNAUTHORIZED,
    },
  };
}

/**
 * Fail-closed system reconcile authorization.
 * Başarılıysa actor sabiti "system" (istemci alanı değil).
 * Secret değerleri payload’a yazılmaz.
 *
 * @returns {{ ok: true, actor: "system" } | { ok: false, status: number, body: object }}
 */
export function authorizeSystemReconcileRequest(request) {
  const expected = readSystemReconcileExpectedSecret();
  if (!expected) {
    const code = requiresStrictRuntimeSecrets()
      ? SYSTEM_RECONCILE_AUTH_CODE.SECRET_MISSING
      : SYSTEM_RECONCILE_AUTH_CODE.UNAUTHORIZED;
    const fail = unauthorizedPayload(code);
    return { ok: false, status: fail.status, body: fail.body };
  }

  const provided = readSystemReconcileProvidedSecret(request);
  if (!provided.ok) {
    const fail = unauthorizedPayload(SYSTEM_RECONCILE_AUTH_CODE.UNAUTHORIZED);
    return { ok: false, status: fail.status, body: fail.body };
  }

  // safeEqualString: eşit uzunlukta timingSafeEqual; aksi halde false.
  if (!safeEqualString(provided.provided, expected)) {
    const fail = unauthorizedPayload(SYSTEM_RECONCILE_AUTH_CODE.UNAUTHORIZED);
    return { ok: false, status: fail.status, body: fail.body };
  }

  return { ok: true, actor: "system" };
}
