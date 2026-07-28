import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  jsonForbidden,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import {
  ensureCompanyDriveProvisioned,
  PROVISION_STATUS,
  toPublicProvisionResult,
} from "@/src/lib/googleDrive/ensureCompanyDriveProvisioned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  const companyId = String(request.nextUrl.searchParams.get("companyId") || "");
  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;
  const { supabase, guard } = getApiSupabase("google-drive-folders:get", "company_cloud_folders");
  if (guard) return guard;
  const { data, error } = await supabase.from("company_cloud_folders")
    .select("root_folder_id,root_folder_name,folder_structure_version,sync_status,last_sync_at,last_error")
    .eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  return NextResponse.json({ folder: data || null });
}

/**
 * POST — tek firma klasör hazırlığı (management).
 * Credential: ofis company-bound connection (session-user OAuth değil).
 */
export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  if (!session.access?.isManagementUser) {
    return jsonForbidden("Bu işlem için yönetim yetkisi gerekli.");
  }
  const limited = enforceRateLimit(request, session, "google-drive-folders", {
    limit: 10,
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
  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;

  const provision = await ensureCompanyDriveProvisioned(companyId, {
    dryRun: false,
  });

  if (provision.status === PROVISION_STATUS.COMPANY_NOT_FOUND) {
    return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
  }
  if (provision.status === PROVISION_STATUS.INACTIVE_SKIPPED) {
    return NextResponse.json(
      { error: "Pasif firmalar için Drive klasörü oluşturulmaz." },
      { status: 409 }
    );
  }
  if (
    provision.status === PROVISION_STATUS.OFFICE_CONNECTION_PENDING ||
    provision.status === PROVISION_STATUS.DRIVE_ERROR
  ) {
    return NextResponse.json(
      {
        error:
          provision.message ||
          "Ofis bağlantısı hazırlanıyor. Lütfen muhasebe ofisinizle iletişime geçin.",
        code: provision.status,
        provision: toPublicProvisionResult(provision),
      },
      { status: 409 }
    );
  }

  // Management UI bağlama kartı için kök meta (token yok).
  return NextResponse.json({
    result: {
      rootFolderId: provision._rootFolderId || null,
      rootFolderName: provision.companyName || null,
      folderStructureVersion: "v1",
      createdFolderCount: provision.createdFolderCount || 0,
    },
    provision: toPublicProvisionResult(provision),
  });
}
