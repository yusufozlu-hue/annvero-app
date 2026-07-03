import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryDiagnostics,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";

export const GIB_CREDENTIALS_TABLE = "company_gib_credentials";
export const GIB_QUERY_STATE_TABLE = "gib_company_query_state";
export const GIB_QUERY_SESSIONS_TABLE = "gib_query_sessions";

export function getGibSupabaseGuardResponse(context = "gib-api") {
  return getServerSupabaseAdminGuardResponse(context, GIB_CREDENTIALS_TABLE);
}

export function getGibSupabaseAdmin() {
  return getServerSupabaseAdmin({ requireServiceRole: true });
}

export function logGibSupabaseDiagnostics(context, table = GIB_CREDENTIALS_TABLE) {
  return logSupabaseQueryDiagnostics(context, table);
}

export function logGibSupabaseError(context, error, table = GIB_CREDENTIALS_TABLE) {
  logSupabaseQueryError(context, error, table);
}
