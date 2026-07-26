import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import {
  buildPublicDocumentList,
  DEFAULT_LIST_PARSE_STATUSES,
} from "@/src/utils/cloudStorage/documentList.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/google-drive/files?companyId=
 * Salt okunur: company_id ile filtrelenmiş document_index.
 * Teknik Drive kimliği / hash / token istemciye gitmez.
 */
export async function GET(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  const limited = enforceRateLimit(request, session, "google-drive-files-list", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const companyId = new URL(request.url).searchParams.get("companyId");
  const access = assertCompanyAccess(session.access, companyId, {
    required: true,
  });
  if (!access.ok) return access.response;

  const includeMissing =
    new URL(request.url).searchParams.get("includeMissing") === "1";

  const { supabase, guard } = getApiSupabase(
    "google-drive-files:list",
    "document_index"
  );
  if (guard) return guard;

  const [{ data: rows, error }, { data: folder }] = await Promise.all([
    supabase
      .from("document_index")
      .select(
        "id,company_id,provider,file_name,mime_type,file_size,source_path,parse_status,indexed_at,last_modified_at"
      )
      .eq("company_id", companyId)
      .eq("provider", "google_drive")
      .order("indexed_at", { ascending: false }),
    supabase
      .from("company_cloud_folders")
      .select("last_sync_at")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  if (error) {
    return NextResponse.json(
      { error: "Belge indeksi okunamadı." },
      { status: 500 }
    );
  }

  const lastSyncAt = folder?.last_sync_at || null;
  const documents = buildPublicDocumentList(rows || [], {
    companyId,
    lastSyncAt,
    statuses: DEFAULT_LIST_PARSE_STATUSES,
    includeMissing,
  });

  return NextResponse.json({
    ok: true,
    companyId,
    lastSyncAt,
    count: documents.length,
    documents,
  });
}
