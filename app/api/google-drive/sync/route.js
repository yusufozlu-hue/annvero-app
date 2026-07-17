import { NextResponse } from "next/server";
import { assertCompanyAccess, getApiSupabase, requireApiSession } from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { getValidGoogleAccessToken } from "@/src/lib/googleDrive/connectionStore";
import { listGoogleDriveMetadata } from "@/src/utils/cloudStorage/googleDriveAdapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  const limited = enforceRateLimit(request, session, "google-drive-sync", { limit: 12, windowMs: 300_000 });
  if (limited) return limited;
  const { companyId } = await request.json();
  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;
  const { supabase, guard } = getApiSupabase("google-drive-sync", "document_index");
  if (guard) return guard;
  const [{ accessToken }, { data: folder, error: folderError }] = await Promise.all([
    getValidGoogleAccessToken(session.user.id),
    supabase.from("company_cloud_folders").select("root_folder_id").eq("company_id", companyId).single(),
  ]);
  if (folderError || !folder?.root_folder_id) {
    return NextResponse.json({ error: "Önce firma Drive klasörünü oluşturun." }, { status: 409 });
  }
  const remote = await listGoogleDriveMetadata({ accessToken, rootFolderId: folder.root_folder_id });
  const rows = remote.map((file) => ({
    company_id: companyId, provider: "google_drive", provider_file_id: file.providerFileId,
    parent_folder_id: file.parentFolderId, file_name: file.fileName, mime_type: file.mimeType,
    file_size: file.fileSize, file_hash: file.fileHash, last_modified_at: file.lastModifiedAt,
    indexed_at: new Date().toISOString(), parse_status: "indexed",
  }));
  if (rows.length) {
    const { error } = await supabase.from("document_index").upsert(rows, { onConflict: "company_id,provider_file_id" });
    if (error) throw error;
  }
  const remoteIds = new Set(remote.map((file) => file.providerFileId));
  const { data: indexed, error: indexError } = await supabase.from("document_index")
    .select("provider_file_id").eq("company_id", companyId).eq("provider", "google_drive")
    .neq("parse_status", "soft_deleted");
  if (indexError) throw indexError;
  const missingIds = (indexed || []).map((row) => row.provider_file_id).filter((id) => !remoteIds.has(id));
  if (missingIds.length) {
    const { error: missingError } = await supabase.from("document_index")
      .update({ parse_status: "missing" }).eq("company_id", companyId).in("provider_file_id", missingIds);
    if (missingError) throw missingError;
  }
  const now = new Date().toISOString();
  await supabase.from("company_cloud_folders").update({ sync_status: "ok", last_sync_at: now, last_error: null }).eq("company_id", companyId);
  return NextResponse.json({ stats: { remoteCount: remote.length, missing: missingIds.length }, lastSyncAt: now });
}
