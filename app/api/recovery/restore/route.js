import { NextResponse } from "next/server";
import { requireManagementApi, resolveCompanyId } from "@/src/lib/auth/apiGuard";
import { buildAuditContextFromRequest } from "@/src/lib/audit/auditEvents";
import {
  buildRestoreDryRun,
  restoreDeletedRecord,
  RESTORE_CONFIRMATION_PHRASE,
  RESTORE_ENTITY_ALLOWLIST,
  isRecoveryApiEnabled,
} from "@/src/lib/recovery/restoreDeletedRecord";
import { enforceDurableRateLimit } from "@/src/lib/security/rateLimitDurable";
import { parseJsonBodySecure, attachRequestId } from "@/src/lib/security/requestGuards";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "@/src/lib/security/requestId";
import { enforceSameOriginCsrf } from "@/src/lib/security/csrf";
import { safeErrorMessage } from "@/src/lib/security/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function recoveryDisabledResponse(requestId) {
  return NextResponse.json(
    {
      error:
        "Recovery API kapalı. Production/staging/preview için RECOVERY_API_ENABLED=true gerekir.",
      code: "RECOVERY_API_DISABLED",
      requestId,
      note: "Bu endpoint DB backup/PITR restore yapmaz; yalnız soft-delete satır geri alır.",
    },
    { status: 503, headers: { [REQUEST_ID_HEADER]: requestId } }
  );
}

/**
 * GET — dry-run özeti (veri değiştirmez)
 */
export async function GET(request) {
  const requestId = getOrCreateRequestId(request);

  if (!isRecoveryApiEnabled()) {
    return recoveryDisabledResponse(requestId);
  }

  const ctx = await requireManagementApi("recovery:restore", "companies");
  if (ctx.error) return attachRequestId(ctx.error, requestId);

  const rateLimited = await enforceDurableRateLimit(
    request,
    ctx,
    "recovery:restore",
    { limit: 30, windowMs: 300_000 },
    { supabase: ctx.supabase }
  );
  if (rateLimited) return attachRequestId(rateLimited, requestId);

  const params = request.nextUrl.searchParams;
  const table = params.get("table") || "";
  const recordId = params.get("recordId") || params.get("id") || "";
  const companyId = resolveCompanyId({
    companyId: params.get("companyId"),
  });

  const result = await buildRestoreDryRun(ctx.supabase, ctx.access, {
    table,
    recordId,
    companyId,
  });

  if (!result.ok) {
    return attachRequestId(
      NextResponse.json(
        { error: result.error, code: result.code, requestId, allowedEntities: RESTORE_ENTITY_ALLOWLIST },
        { status: 400 }
      ),
      requestId
    );
  }

  return attachRequestId(
    NextResponse.json({
      ...result,
      requestId,
      confirmationPhrase: RESTORE_CONFIRMATION_PHRASE,
      allowedEntities: RESTORE_ENTITY_ALLOWLIST,
      note: "RESTORE_CONFIRM tek başına yetki değildir; yönetim + firma erişimi zorunlu.",
    }),
    requestId
  );
}

/**
 * POST — soft-delete restore (PITR/DB backup değil)
 */
export async function POST(request) {
  const requestId = getOrCreateRequestId(request);

  if (!isRecoveryApiEnabled()) {
    return recoveryDisabledResponse(requestId);
  }

  const csrfError = enforceSameOriginCsrf(request);
  if (csrfError) return attachRequestId(csrfError, requestId);

  const parsed = await parseJsonBodySecure(request, { csrf: false });
  if (parsed.error) return parsed.error;

  const { body } = parsed;
  const ctx = await requireManagementApi("recovery:restore", "companies");
  if (ctx.error) return attachRequestId(ctx.error, requestId);

  const rateLimited = await enforceDurableRateLimit(
    request,
    ctx,
    "recovery:restore:write",
    { limit: 10, windowMs: 900_000 },
    { supabase: ctx.supabase }
  );
  if (rateLimited) return attachRequestId(rateLimited, requestId);

  const table = String(body?.table || "").trim();
  const recordId = String(body?.recordId || body?.id || "").trim();
  const companyId = resolveCompanyId(body);

  // Client privilege / SQL parçaları yok say
  if (body?.sql || body?.column || body?.query) {
    return attachRequestId(
      NextResponse.json(
        { error: "Keyfi SQL/kolon kabul edilmez.", code: "INVALID_PAYLOAD", requestId },
        { status: 400 }
      ),
      requestId
    );
  }

  try {
    const result = await restoreDeletedRecord(
      ctx.supabase,
      ctx.access,
      {
        table,
        recordId,
        companyId,
        confirm: body?.confirm === true,
        confirmPhrase: body?.confirmPhrase || body?.confirm_phrase || "",
        requestId,
      },
      buildAuditContextFromRequest(request, ctx)
    );

    if (!result.ok) {
      const status =
        result.code === "RESTORE_CONFIRMATION_REQUIRED"
          ? 409
          : result.code === "FORBIDDEN_ROLE" || result.code === "FORBIDDEN_RECORD"
            ? 403
            : 400;
      return attachRequestId(
        NextResponse.json(
          {
            error: result.error,
            code: result.code || "RESTORE_FAILED",
            confirmationPhrase: RESTORE_CONFIRMATION_PHRASE,
            allowedEntities: RESTORE_ENTITY_ALLOWLIST,
            requestId,
          },
          { status }
        ),
        requestId
      );
    }

    return attachRequestId(NextResponse.json({ ...result, requestId }), requestId);
  } catch (error) {
    return attachRequestId(
      NextResponse.json(
        { error: safeErrorMessage(error, "Restore başarısız."), requestId },
        { status: 500 }
      ),
      requestId
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
