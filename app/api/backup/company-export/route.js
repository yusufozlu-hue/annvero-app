import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  requireCompaniesRecordAccess,
  requireManagementApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  buildAuditContextFromRequest,
  writeAuditEvent,
} from "@/src/lib/audit/auditEvents";
import { buildCompanyExportEnvelope } from "@/src/lib/backup/companyExport";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });

  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }

  const ctx = await requireManagementApi("backup:company-export", "companies");
  if (ctx.error) return ctx.error;

  const rateLimited = enforceRateLimit(request, ctx, "backup:company-export", {
    limit: 5,
    windowMs: 900_000,
  });
  if (rateLimited) return rateLimited;

  const accessCheck = assertCompanyAccess(ctx.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const companyCheck = await requireCompaniesRecordAccess(ctx.supabase, companyId, ctx.access);
  if (!companyCheck.ok) return companyCheck.response;

  try {
    const envelope = await buildCompanyExportEnvelope(ctx.supabase, {
      companyId,
      actor: { email: ctx.user?.email },
    });

    void writeAuditEvent({
      ...buildAuditContextFromRequest(request, ctx),
      companyId,
      entityType: AUDIT_ENTITY_TYPES.COMPANY_BACKUP,
      entityId: companyId,
      action: AUDIT_ACTIONS.EXPORT,
      afterState: {
        version: envelope.version,
        row_counts: envelope.metadata?.row_counts,
      },
      metadata: {
        exported_by: envelope.exported_by,
        skipped_tables: envelope.metadata?.skipped_tables || [],
      },
    });

    try {
      await ctx.supabase.from("company_backup_runs").insert([
        {
          company_id: companyId,
          exported_by: envelope.exported_by,
          export_version: envelope.version,
          row_counts: envelope.metadata?.row_counts || {},
          metadata: {
            skipped_tables: envelope.metadata?.skipped_tables || [],
          },
        },
      ]);
    } catch {
      // metadata tablosu yoksa export yine döner
    }

    const filename = `annvero-backup-${companyId}-${envelope.exported_at.slice(0, 10)}.json`;

    return new NextResponse(JSON.stringify(envelope, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Export oluşturulamadı." },
      { status: 500 }
    );
  }
}
