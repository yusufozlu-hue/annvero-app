/**
 * Firma-bound Google Drive credential çözümü.
 * Oturum kullanıcısının kişisel OAuth’u kullanılmaz; company_cloud_folders.connection_id
 * üzerinden kurumsal bağlantı çözülür.
 */

import { getServerSupabaseAdmin } from "@/src/lib/supabase/serverAdmin";
import { getValidGoogleAccessTokenByConnectionId } from "@/src/lib/googleDrive/connectionStore";
import { assertDriveRootBelongsToCompany } from "@/src/utils/cloudStorage/googleDriveAdapter";

export const COMPANY_DRIVE_ERROR = Object.freeze({
  FOLDER_BINDING_MISSING: "FOLDER_BINDING_MISSING",
  OFFICE_CONNECTION_PENDING: "OFFICE_CONNECTION_PENDING",
  ROOT_FOLDER_INVALID: "ROOT_FOLDER_INVALID",
  ROOT_COMPANY_MISMATCH: "ROOT_COMPANY_MISMATCH",
  CONNECTION_FOREIGN: "CONNECTION_FOREIGN",
});

export const COMPANY_DRIVE_USER_MESSAGES = Object.freeze({
  [COMPANY_DRIVE_ERROR.FOLDER_BINDING_MISSING]:
    "Ofis bağlantısı hazırlanıyor. Lütfen muhasebe ofisinizle iletişime geçin.",
  [COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING]:
    "Ofis bağlantısı hazırlanıyor. Lütfen muhasebe ofisinizle iletişime geçin.",
  [COMPANY_DRIVE_ERROR.ROOT_FOLDER_INVALID]:
    "Ofis bağlantısı hazırlanıyor. Lütfen muhasebe ofisinizle iletişime geçin.",
  [COMPANY_DRIVE_ERROR.ROOT_COMPANY_MISMATCH]:
    "Firma depolama bağlantısı bu kayıtla eşleşmiyor.",
  [COMPANY_DRIVE_ERROR.CONNECTION_FOREIGN]:
    "Firma depolama bağlantısı bu kayıtla eşleşmiyor.",
});

function driveError(code, cause) {
  const err = new Error(COMPANY_DRIVE_USER_MESSAGES[code] || code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

/**
 * @param {string} companyId
 * @param {{ skipRootAssert?: boolean }} [options]
 * @returns {Promise<{
 *   companyId: string,
 *   rootFolderId: string,
 *   connectionId: string,
 *   accessToken: string,
 *   connection: { id: string, status: string, account_email?: string|null },
 * }>}
 */
export async function resolveCompanyDriveConnection(
  companyId,
  { skipRootAssert = false } = {}
) {
  const id = String(companyId || "").trim();
  if (!id) {
    throw driveError(COMPANY_DRIVE_ERROR.FOLDER_BINDING_MISSING);
  }

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!supabase) {
    throw driveError(COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING);
  }

  const { data: folder, error: folderError } = await supabase
    .from("company_cloud_folders")
    .select("company_id,root_folder_id,connection_id")
    .eq("company_id", id)
    .maybeSingle();

  if (folderError || !folder?.root_folder_id) {
    throw driveError(COMPANY_DRIVE_ERROR.FOLDER_BINDING_MISSING);
  }

  const connectionId = String(folder.connection_id || "").trim();
  if (!connectionId) {
    throw driveError(COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING);
  }

  let token;
  try {
    token = await getValidGoogleAccessTokenByConnectionId(connectionId);
  } catch (cause) {
    throw driveError(COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING, cause);
  }

  if (!token?.accessToken || !token?.connection?.id) {
    throw driveError(COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING);
  }

  if (String(token.connection.id) !== connectionId) {
    throw driveError(COMPANY_DRIVE_ERROR.CONNECTION_FOREIGN);
  }

  if (!skipRootAssert) {
    try {
      await assertDriveRootBelongsToCompany({
        accessToken: token.accessToken,
        rootFolderId: folder.root_folder_id,
        companyId: id,
      });
    } catch (cause) {
      const code = cause?.code;
      if (code === "ROOT_COMPANY_MISMATCH") {
        throw driveError(COMPANY_DRIVE_ERROR.ROOT_COMPANY_MISMATCH, cause);
      }
      if (code === "ROOT_FOLDER_INVALID") {
        throw driveError(COMPANY_DRIVE_ERROR.ROOT_FOLDER_INVALID, cause);
      }
      throw driveError(COMPANY_DRIVE_ERROR.ROOT_FOLDER_INVALID, cause);
    }
  }

  return {
    companyId: id,
    rootFolderId: String(folder.root_folder_id),
    connectionId,
    accessToken: token.accessToken,
    connection: {
      id: token.connection.id,
      status: token.connection.status,
      account_email: token.connection.account_email || null,
    },
  };
}

/**
 * Public DTO — token/connection sırları sızdırılmaz.
 */
export function publicCompanyDriveBindingStatus(resolvedOrNull) {
  if (!resolvedOrNull) {
    return { ready: false, code: COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING };
  }
  return {
    ready: true,
    companyId: resolvedOrNull.companyId,
    // Teknik kimlikler istemciye verilmez.
  };
}
