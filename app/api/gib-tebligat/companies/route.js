import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import { isCompanyActive } from "@/src/utils/companies";
import { formatCompanyFromSupabaseRow } from "@/src/utils/companyNormalize";

export async function GET() {
  const { user } = await getServerSupabaseUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase yapılandırılmamış." }, { status: 500 });
  }

  const [{ data: companies }, { data: credentials }, { data: queryStates }] = await Promise.all([
    supabase.from("companies").select("*").order("created_at", { ascending: true }),
    supabase.from("company_gib_credentials").select("*"),
    supabase.from("gib_company_query_state").select("*"),
  ]);

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
        lastError: state?.last_error || null,
      };
    });

  return NextResponse.json({ data: rows });
}
