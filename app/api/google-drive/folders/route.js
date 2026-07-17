import { NextResponse } from "next/server";
import { assertCompanyAccess, getApiSupabase, requireApiSession } from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { getValidGoogleAccessToken } from "@/src/lib/googleDrive/connectionStore";
import { ensureGoogleDriveFolderTree } from "@/src/utils/cloudStorage/googleDriveAdapter";

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

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  const limited = enforceRateLimit(request, session, "google-drive-folders", { limit: 10, windowMs: 300_000 });
  if (limited) return limited;
  const { companyId } = await request.json();
  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;
  const { supabase, guard } = getApiSupabase("google-drive-folders", "company_cloud_folders");
  if (guard) return guard;
  const [{ data: company, error: companyError }, token] = await Promise.all([
    supabase.from("companies").select("id,company_name").eq("id", companyId).single(),
    getValidGoogleAccessToken(session.user.id),
  ]);
  if (companyError || !company) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
  const result = await ensureGoogleDriveFolderTree({
    accessToken: token.accessToken, companyId, companyName: company.company_name,
  });
  const { error } = await supabase.from("company_cloud_folders").upsert({
    company_id: companyId, connection_id: token.connection.id,
    root_folder_id: result.rootFolderId, root_folder_name: result.rootFolderName,
    folder_structure_version: result.folderStructureVersion, sync_status: "idle", last_error: null,
  }, { onConflict: "company_id" });
  if (error) throw error;
  return NextResponse.json({ result });
}
