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
import { enforceDurableRateLimit } from "@/src/lib/security/rateLimitDurable";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "@/src/lib/security/requestId";
import { safeErrorMessage } from "@/src/lib/security/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const requestId = getOrCreateRequestId(request);

  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });

  if (!companyId) {
    return NextResponse.json(
      { error: "companyId zorunludur.", requestId },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  const ctx = await requireManagementApi("backup:company-export", "companies");
  if (ctx.error) {
    ctx.error.headers.set(REQUEST_ID_HEADER, requestId);
    return ctx.error;
  }

  const rateLimited = await enforceDurableRateLimit(
    request,
    ctx,
    "backup:company-export",
    { limit: 5, windowMs: 900_000 },
    { supabase: ctx.supabase }
  );
  if (rateLimited) {
    rateLimited.headers.set(REQUEST_ID_HEADER, requestId);
    return rateLimited;
  }

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
      requestId,
      result: "success",
      afterState: {
        version: envelope.version,
        row_counts: envelope.metadata?.row_counts,
        redacted: envelope.metadata?.redacted === true,
      },
      metadata: {
        exported_by: envelope.exported_by,
        skipped_tables: envelope.metadata?.skipped_tables || [],
        requestId,
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
            redacted: true,
            request_id: requestId,
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
        [REQUEST_ID_HEADER]: requestId,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error, "Export oluşturulamadı."), requestId },
      { status: 500, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }
}
