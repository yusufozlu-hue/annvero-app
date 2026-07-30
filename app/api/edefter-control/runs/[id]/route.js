import { NextResponse } from "next/server";
import {
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  publicEdefterFindingView,
  publicEdefterRunView,
} from "@/src/utils/eDefterPersistSafe";

const RUNS_TABLE = "edefter_control_runs";
const FINDINGS_TABLE = "edefter_control_findings";

export async function GET(request, context) {
  const params = await context.params;
  const runId = String(params?.id || "").trim();
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });

  if (!runId) {
    return NextResponse.json({ error: "run id zorunludur." }, { status: 400 });
  }
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }

  const ctx = await requireAuthenticatedApi("edefter-control-run:get", RUNS_TABLE, {
    companyId,
  });
  if (ctx.error) return ctx.error;

  const { data: run, error } = await ctx.supabase
    .from(RUNS_TABLE)
    .select("*")
    .eq("id", runId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!run) {
    return NextResponse.json({ error: "Kayıt bulunamadı." }, { status: 404 });
  }

  const { data: findings, error: findingsError } = await ctx.supabase
    .from(FINDINGS_TABLE)
    .select("*")
    .eq("run_id", runId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (findingsError) {
    return NextResponse.json({ error: findingsError.message }, { status: 500 });
  }

  return NextResponse.json({
    data: publicEdefterRunView(run),
    findings: (findings || []).map(publicEdefterFindingView),
  });
}
