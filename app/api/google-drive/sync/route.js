/**
 * POST /api/google-drive/sync
 * Firma erişimli metadata sync. force/full yalnız yönetim.
 * Token: oturum kullanıcısı değil — firma-bound connection.
 */

import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import {
  COMPANY_DRIVE_ERROR,
  COMPANY_DRIVE_USER_MESSAGES,
  resolveCompanyDriveConnection,
} from "@/src/lib/googleDrive/resolveCompanyDriveConnection";
import { runCompanyDriveSync } from "@/src/utils/cloudStorage/runCompanyDriveSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCompanyActive(company) {
  const flag = company?.data?.isActive;
  return flag !== false;
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  const limited = enforceRateLimit(request, session, "google-drive-sync", {
    limit: 12,
    windowMs: 300_000,
  });
  if (limited) return limited;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const companyId = String(body?.companyId || "").trim();
  const force = Boolean(body?.force);
  const full = Boolean(body?.full || body?.fullReconcile);

  if ((force || full) && !session.access?.isManagementUser) {
    return NextResponse.json(
      { error: "force/full senkron yalnız yönetim kullanıcılarına açıktır." },
      { status: 403 }
    );
  }

  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;

  const { supabase, guard } = getApiSupabase("google-drive-sync", "document_index");
  if (guard) return guard;

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id,data")
    .eq("id", companyId)
    .single();

  if (companyError || !company) {
    return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
  }
  if (!isCompanyActive(company)) {
    return NextResponse.json(
      { error: "Pasif firmaların Drive arşivi senkronize edilmez." },
      { status: 409 }
    );
  }

  let drive;
  try {
    drive = await resolveCompanyDriveConnection(companyId);
  } catch (error) {
    const code = error?.code || COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING;
    return NextResponse.json(
      {
        error:
          COMPANY_DRIVE_USER_MESSAGES[code] ||
          COMPANY_DRIVE_USER_MESSAGES[COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING],
        code,
      },
      { status: 409 }
    );
  }

  const result = await runCompanyDriveSync({
    supabase,
    accessToken: drive.accessToken,
    companyId,
    rootFolderId: drive.rootFolderId,
    writeSyncEvents: true,
    extraEvents: [
      {
        eventType: force || full ? "manual_full_sync" : "manual_sync",
        status: "ok",
        errorMessage: force || full ? "force_or_full" : null,
      },
    ],
  });

  return NextResponse.json({
    stats: result.stats,
  });
}
