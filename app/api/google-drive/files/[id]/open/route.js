import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { isAnnveroSystemDocument } from "@/src/utils/cloudStorage/documentList.js";
import { DOCUMENT_PARSE_STATUS } from "@/src/utils/cloudStorage/types.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/google-drive/files/[id]/open?companyId=
 * Yetki kontrolünden sonra Drive web görünümüne yönlendirir.
 * provider_file_id yalnız sunucuda kullanılır; yanıt gövdesinde yok.
 */
export async function GET(request, context) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  const limited = enforceRateLimit(request, session, "google-drive-files-open", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const companyId = new URL(request.url).searchParams.get("companyId");
  const access = assertCompanyAccess(session.access, companyId, {
    required: true,
  });
  if (!access.ok) return access.response;

  const params = await context.params;
  const documentId = String(params?.id || "").trim();
  if (!documentId) {
    return NextResponse.json({ error: "Belge seçilmedi." }, { status: 400 });
  }

  const { supabase, guard } = getApiSupabase(
    "google-drive-files:open",
    "document_index"
  );
  if (guard) return guard;

  const { data: row, error } = await supabase
    .from("document_index")
    .select(
      "id,company_id,provider,provider_file_id,file_name,source_path,parse_status"
    )
    .eq("id", documentId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Belge kaydı okunamadı." },
      { status: 500 }
    );
  }
  if (!row) {
    return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });
  }
  if (row.parse_status === DOCUMENT_PARSE_STATUS.SOFT_DELETED) {
    return NextResponse.json({ error: "Belge artık listelenmiyor." }, { status: 410 });
  }
  if (isAnnveroSystemDocument(row)) {
    return NextResponse.json({ error: "Sistem belgesi açılamaz." }, { status: 403 });
  }
  if (!row.provider_file_id) {
    return NextResponse.json(
      { error: "Drive bağlantısı eksik." },
      { status: 409 }
    );
  }

  const driveUrl = `https://drive.google.com/file/d/${encodeURIComponent(
    row.provider_file_id
  )}/view`;

  return NextResponse.redirect(driveUrl, 302);
}
