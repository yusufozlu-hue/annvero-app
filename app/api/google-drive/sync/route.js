/**
 * POST /api/google-drive/sync
 * Firma erişimli metadata sync. force/full yalnız yönetim.
 */

import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { getValidGoogleAccessToken } from "@/src/lib/googleDrive/connectionStore";
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

  const [{ accessToken }, { data: company, error: companyError }, { data: folder, error: folderError }] =
    await Promise.all([
      getValidGoogleAccessToken(session.user.id),
      supabase.from("companies").select("id,data").eq("id", companyId).single(),
      supabase
        .from("company_cloud_folders")
        .select("root_folder_id")
        .eq("company_id", companyId)
        .single(),
    ]);

  if (companyError || !company) {
    return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
  }
  if (!isCompanyActive(company)) {
    return NextResponse.json(
      { error: "Pasif firmaların Drive arşivi senkronize edilmez." },
      { status: 409 }
    );
  }
  if (folderError || !folder?.root_folder_id) {
    return NextResponse.json(
      { error: "Önce firma Drive klasörünü oluşturun." },
      { status: 409 }
    );
  }

  const result = await runCompanyDriveSync({
    supabase,
    accessToken,
    companyId,
    rootFolderId: folder.root_folder_id,
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
    lastSyncAt: result.lastSyncAt,
  });
}
