import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { getValidGoogleAccessToken } from "@/src/lib/googleDrive/connectionStore";
import { verifyGoogleDriveFolderStructure } from "@/src/utils/cloudStorage/googleDriveAdapter";
import { FOLDER_STRUCTURE_VERSION } from "@/src/utils/cloudStorage/folderSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_MESSAGES = Object.freeze({
  MISSING_COMPANY_ID: "Firma seçilmedi.",
  FOLDER_BINDING_MISSING: "Önce firma Drive klasörünü oluşturun.",
  DRIVE_CONNECTION_MISSING: "Google Drive bağlantısı bulunamadı.",
  ROOT_FOLDER_INVALID: "Firma Drive kök klasörü geçersiz veya silinmiş.",
  ROOT_COMPANY_MISMATCH: "Drive kök klasörü bu firmaya bağlı değil.",
  DRIVE_API_ERROR: "Google Drive klasör yapısı okunamadı.",
  STRUCTURE_MISMATCH: "Klasör yapısı beklenen şema ile uyuşmuyor.",
  OK: "Klasör yapısı şema ile uyumlu.",
});

function jsonError(code, status = 400) {
  return NextResponse.json(
    {
      ok: false,
      code,
      message: SAFE_MESSAGES[code] || SAFE_MESSAGES.DRIVE_API_ERROR,
      schemaVersion: FOLDER_STRUCTURE_VERSION,
    },
    { status }
  );
}

/**
 * GET /api/google-drive/folders/check?companyId=...
 * Salt okunur klasör yapısı doğrulama — Drive/DB mutation yok.
 */
export async function GET(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const limited = enforceRateLimit(request, session, "google-drive-folders-check", {
    limit: 30,
    windowMs: 300_000,
  });
  if (limited) return limited;

  const companyId = String(request.nextUrl.searchParams.get("companyId") || "").trim();
  if (!companyId) return jsonError("MISSING_COMPANY_ID", 400);

  const access = assertCompanyAccess(session.access, companyId, { required: true });
  if (!access.ok) return access.response;

  const { supabase, guard } = getApiSupabase(
    "google-drive-folders-check",
    "company_cloud_folders"
  );
  if (guard) return guard;

  const { data: folder, error: folderError } = await supabase
    .from("company_cloud_folders")
    .select("root_folder_id,folder_structure_version")
    .eq("company_id", companyId)
    .maybeSingle();
  if (folderError) throw folderError;
  if (!folder?.root_folder_id) {
    return jsonError("FOLDER_BINDING_MISSING", 409);
  }

  let token;
  try {
    token = await getValidGoogleAccessToken(session.user.id);
  } catch {
    return jsonError("DRIVE_CONNECTION_MISSING", 409);
  }

  try {
    const result = await verifyGoogleDriveFolderStructure({
      accessToken: token.accessToken,
      companyId,
      rootFolderId: folder.root_folder_id,
    });

    return NextResponse.json({
      ok: result.ok,
      code: result.code,
      message: result.ok ? SAFE_MESSAGES.OK : SAFE_MESSAGES.STRUCTURE_MISMATCH,
      schemaVersion: result.schemaVersion,
      expectedCount: result.expectedCount,
      existingCount: result.existingCount,
      missingPaths: result.missingPaths,
      extraPaths: result.extraPaths,
      annveroAtRoot: result.annveroAtRoot,
    });
  } catch (error) {
    const code = error?.code;
    if (
      code === "FOLDER_BINDING_MISSING" ||
      code === "ROOT_FOLDER_INVALID" ||
      code === "ROOT_COMPANY_MISMATCH"
    ) {
      return jsonError(code, code === "ROOT_COMPANY_MISMATCH" ? 409 : 409);
    }
    return jsonError("DRIVE_API_ERROR", 502);
  }
}
