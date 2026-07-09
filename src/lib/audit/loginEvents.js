/**
 * Oturum / login event altyapısı — Güvenlik Faz 2.
 */

import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";

export const LOGIN_EVENTS_TABLE = "login_events";

export const LOGIN_EVENT_TYPES = {
  LOGIN: "login",
  OAUTH_CALLBACK: "oauth_callback",
  SESSION_REFRESH: "session_refresh",
  LOGOUT: "logout",
  FAILED: "login_failed",
};

function sanitizeMetadata(value) {
  if (value == null) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { raw: String(value) };
  }
}

/**
 * Login event yazar (service_role). Ana akışı bozmaz.
 */
export async function writeLoginEvent(partial = {}) {
  const guard = getServerSupabaseAdminGuardResponse("login-events:write", LOGIN_EVENTS_TABLE);
  if (guard) {
    console.warn("[login-events] service role unavailable, event skipped");
    return { ok: false, skipped: true };
  }

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!supabase) {
    return { ok: false, skipped: true };
  }

  const payload = {
    user_id: String(partial.userId || partial.user_id || "").trim(),
    email: String(partial.email || "").trim().toLowerCase(),
    ip_address: partial.ipAddress || partial.ip_address || null,
    user_agent: partial.userAgent || partial.user_agent || null,
    event_type: String(partial.eventType || partial.event_type || LOGIN_EVENT_TYPES.LOGIN).trim(),
    success: partial.success !== false,
    metadata: sanitizeMetadata(partial.metadata),
  };

  const { data, error } = await supabase
    .from(LOGIN_EVENTS_TABLE)
    .insert([payload])
    .select("id")
    .maybeSingle();

  if (error) {
    logSupabaseQueryError("login-events:write", error, LOGIN_EVENTS_TABLE);
    return { ok: false, error };
  }

  return { ok: true, id: data?.id || null };
}

export function buildLoginEventContextFromRequest(request, user = {}) {
  const headers = request?.headers;
  return {
    userId: user?.id || "",
    email: user?.email || "",
    ipAddress: headers?.get?.("x-forwarded-for")?.split(",")?.[0]?.trim() || "",
    userAgent: headers?.get?.("user-agent") || "",
  };
}
