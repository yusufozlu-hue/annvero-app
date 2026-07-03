import { NextResponse } from "next/server";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import { GIB_QUERY_STATUS } from "@/src/config/gibQueryStatuses";
import { isCompanyActive } from "@/src/utils/companies";
import { formatCompanyFromSupabaseRow } from "@/src/utils/companyNormalize";
import {
  GIB_CREDENTIALS_TABLE,
  GIB_QUERY_STATE_TABLE,
  getGibSupabaseAdmin,
  getGibSupabaseGuardResponse,
  logGibSupabaseDiagnostics,
  logGibSupabaseError,
} from "@/src/lib/supabase/gibSupabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ERROR_RESULT_STATUSES = new Set([
  GIB_QUERY_STATUS.SYSTEM_ERROR,
  GIB_QUERY_STATUS.LOGIN_ERROR,
]);

function resolvePublicLastError(state) {
  if (!state?.last_error) return null;
  if (!ERROR_RESULT_STATUSES.has(state.result_status)) return null;
  return state.last_error;
}

export async function GET() {
  const { user } = await getServerSupabaseUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  const supabaseGuard = getGibSupabaseGuardResponse("gib-tebligat:companies");
  if (supabaseGuard) return supabaseGuard;

  const supabase = getGibSupabaseAdmin();
  logGibSupabaseDiagnostics("gib-tebligat:companies", GIB_CREDENTIALS_TABLE);

  const [
    { data: companies, error: companiesError },
    { data: credentials, error: credentialsError },
    { data: queryStates, error: statesError },
  ] = await Promise.all([
    supabase.from("companies").select("*").order("created_at", { ascending: true }),
    supabase.from(GIB_CREDENTIALS_TABLE).select("*"),
    supabase.from(GIB_QUERY_STATE_TABLE).select("*"),
  ]);

  if (companiesError) {
    logGibSupabaseError("gib-tebligat:companies", companiesError, "companies");
    return NextResponse.json({ error: companiesError.message }, { status: 500 });
  }

  if (credentialsError) {
    logGibSupabaseError("gib-tebligat:companies", credentialsError, GIB_CREDENTIALS_TABLE);
    return NextResponse.json({ error: credentialsError.message }, { status: 500 });
  }

  if (statesError) {
    logGibSupabaseError("gib-tebligat:companies", statesError, GIB_QUERY_STATE_TABLE);
    return NextResponse.json({ error: statesError.message }, { status: 500 });
  }

  const credentialMap = new Map((credentials || []).map((row) => [row.company_id, row]));
  const stateMap = new Map((queryStates || []).map((row) => [row.company_id, row]));

  const rows = (companies || [])
    .map(formatCompanyFromSupabaseRow)
    .filter(Boolean)
    .filter(isCompanyActive)
    .map((company) => {
      const credential = credentialMap.get(company.id);
      const state = stateMap.get(company.id);

      return {
        companyId: company.id,
        companyName: company.companyName,
        taxNumber: company.taxNumber || "",
        hasGibCredentials:
          Boolean(credential?.gib_user_code) &&
          Boolean(credential?.encrypted_password) &&
          credential?.is_active !== false,
        gibUserCode: credential?.gib_user_code || "",
        isGibActive: credential?.is_active !== false,
        lastQueryAt: state?.last_query_at || null,
        resultStatus: state?.result_status || null,
        lastError: resolvePublicLastError(state),
      };
    });

  return NextResponse.json({ data: rows });
}
