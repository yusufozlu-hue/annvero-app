import { NextResponse } from "next/server";
import {
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  buildSafeEdefterMetadata,
  EDEFTER_AUDIT_EVENT_TYPES,
  EDEFTER_FINDING_RESOLUTION,
  publicEdefterFindingView,
} from "@/src/utils/eDefterPersistSafe";

const FINDINGS_TABLE = "edefter_control_findings";
const AUDIT_TABLE = "edefter_control_audit_events";

const ALLOWED = new Set(Object.values(EDEFTER_FINDING_RESOLUTION));

export async function PATCH(request, context) {
  const params = await context.params;
  const findingId = String(params?.id || "").trim();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const companyId = resolveCompanyId(body);
  const resolutionStatus = String(
    body.resolution_status || body.resolutionStatus || ""
  )
    .trim()
    .toLowerCase();

  if (!findingId) {
    return NextResponse.json({ error: "finding id zorunludur." }, { status: 400 });
  }
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }
  if (!ALLOWED.has(resolutionStatus)) {
    return NextResponse.json(
      { error: "Geçersiz resolution_status." },
      { status: 400 }
    );
  }

  const ctx = await requireAuthenticatedApi(
    "edefter-control-finding:patch",
    FINDINGS_TABLE,
    { companyId }
  );
  if (ctx.error) return ctx.error;

  const { data: existing, error: existingError } = await ctx.supabase
    .from(FINDINGS_TABLE)
    .select("*")
    .eq("id", findingId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Bulgu bulunamadı." }, { status: 404 });
  }

  const patch = {
    resolution_status: resolutionStatus,
    resolved_at:
      resolutionStatus === EDEFTER_FINDING_RESOLUTION.OPEN
        ? null
        : new Date().toISOString(),
    resolved_by:
      resolutionStatus === EDEFTER_FINDING_RESOLUTION.OPEN
        ? null
        : String(ctx.user?.id || ctx.user?.email || ""),
  };

  const { data, error } = await ctx.supabase
    .from(FINDINGS_TABLE)
    .update(patch)
    .eq("id", findingId)
    .eq("company_id", companyId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await ctx.supabase.from(AUDIT_TABLE).insert([
    {
      run_id: existing.run_id,
      company_id: companyId,
      event_type: EDEFTER_AUDIT_EVENT_TYPES.FINDING_RESOLVED,
      actor_id: String(ctx.user?.id || ""),
      safe_metadata: buildSafeEdefterMetadata({
        finding_code: existing.code,
        resolution_status: resolutionStatus,
      }),
    },
  ]);

  return NextResponse.json({ data: publicEdefterFindingView(data) });
}
