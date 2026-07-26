import { NextResponse } from "next/server";
import { assertCompanyAccess, getApiSupabase, requireApiSession } from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { getValidGoogleAccessToken } from "@/src/lib/googleDrive/connectionStore";
import { listGoogleDriveMetadata } from "@/src/utils/cloudStorage/googleDriveAdapter";
import { runMetadataSyncPass } from "@/src/utils/cloudStorage/syncEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rowFromDb(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    provider: row.provider,
    providerFileId: row.provider_file_id,
    parentFolderId: row.parent_folder_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    fileHash: row.file_hash,
    lastModifiedAt: row.last_modified_at,
    indexedAt: row.indexed_at,
    parseStatus: row.parse_status,
  };
}

function rowToDb(row, companyId) {
  return {
    company_id: companyId,
    provider: "google_drive",
    provider_file_id: row.providerFileId,
    parent_folder_id: row.parentFolderId || null,
    file_name: row.fileName,
    mime_type: row.mimeType || null,
    file_size: row.fileSize ?? null,
    file_hash: row.fileHash || null,
    last_modified_at: row.lastModifiedAt || null,
    indexed_at: row.indexedAt || new Date().toISOString(),
    parse_status: row.parseStatus || "indexed",
  };
}

function isCompanyActive(company) {
  const flag = company?.data?.isActive;
  return flag !== false;
}

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

  const [{ accessToken }, { data: company, error: companyError }, { data: folder, error: folderError }] =
    await Promise.all([
      getValidGoogleAccessToken(session.user.id),
      supabase.from("companies").select("id,data").eq("id", companyId).single(),
      supabase.from("company_cloud_folders").select("root_folder_id").eq("company_id", companyId).single(),
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
    return NextResponse.json({ error: "Önce firma Drive klasörünü oluşturun." }, { status: 409 });
  }

  const remote = await listGoogleDriveMetadata({
    accessToken,
    rootFolderId: folder.root_folder_id,
  });

  const { data: indexed, error: indexError } = await supabase
    .from("document_index")
    .select(
      "id,company_id,provider,provider_file_id,parent_folder_id,file_name,mime_type,file_size,file_hash,last_modified_at,indexed_at,parse_status"
    )
    .eq("company_id", companyId)
    .eq("provider", "google_drive");
  if (indexError) throw indexError;

  const pass = runMetadataSyncPass({
    companyId,
    provider: "google_drive",
    remoteFiles: remote,
    existingIndex: (indexed || []).map(rowFromDb),
  });

  const upsertRows = [...pass.created, ...pass.updated].map((row) =>
    rowToDb(row, companyId)
  );
  if (upsertRows.length) {
    const { error } = await supabase
      .from("document_index")
      .upsert(upsertRows, { onConflict: "company_id,provider_file_id" });
    if (error) throw error;
  }

  const missingIds = pass.missing.map((row) => row.providerFileId).filter(Boolean);
  if (missingIds.length) {
    const { error: missingError } = await supabase
      .from("document_index")
      .update({ parse_status: "missing" })
      .eq("company_id", companyId)
      .in("provider_file_id", missingIds);
    if (missingError) throw missingError;
  }

  const now = new Date().toISOString();
  await supabase
    .from("company_cloud_folders")
    .update({ sync_status: "ok", last_sync_at: now, last_error: null })
    .eq("company_id", companyId);

  return NextResponse.json({
    stats: {
      ...pass.stats,
      skippedDuplicates: pass.stats.skippedDuplicates,
    },
    lastSyncAt: now,
  });
}
