/**
 * Firma Drive arşivi provisioning — management/reconcile sunucu akışları.
 * Oturum kullanıcısı tenant-kapısı burada yok; çağıran yönetim/reconcile yetkisini doğrular.
 * Credential: ofis company-bound connection (mevcut binding’lerden veya bağlı office OAuth).
 */

import { getServerSupabaseAdmin } from "@/src/lib/supabase/serverAdmin";
import { getValidGoogleAccessTokenByConnectionId } from "@/src/lib/googleDrive/connectionStore";
import { ensureGoogleDriveFolderTree } from "@/src/utils/cloudStorage/googleDriveAdapter";
import { FOLDER_STRUCTURE_VERSION } from "@/src/utils/cloudStorage/folderSchema";
import {
  buildAmbiguousSameNameCompanyIdSet,
  formatCompanyDisplayName,
  normalizeCompanyTitleKey,
} from "@/src/utils/companyIdentity";

export const PROVISION_STATUS = Object.freeze({
  ALREADY_READY: "ALREADY_READY",
  /** Dry-run: henüz oluşturulmadı */
  WILL_CREATE: "WILL_CREATE",
  /** Execute sonrası gerçekten oluşturuldu */
  CREATED: "CREATED",
  INACTIVE_SKIPPED: "INACTIVE_SKIPPED",
  /**
   * Aynı unvan + kimlikle ayrılamayan mükerrer adayı.
   * Farklı geçerli VKN/MERSIS → bu duruma düşmez.
   */
  DUPLICATE_NAME_SKIPPED: "DUPLICATE_NAME_SKIPPED",
  COMPANY_NOT_FOUND: "COMPANY_NOT_FOUND",
  OFFICE_CONNECTION_PENDING: "OFFICE_CONNECTION_PENDING",
  DRIVE_ERROR: "DRIVE_ERROR",
});

export const PROVISION_STATUS_LABEL = Object.freeze({
  [PROVISION_STATUS.ALREADY_READY]: "Hazır",
  [PROVISION_STATUS.WILL_CREATE]: "Oluşturulacak",
  [PROVISION_STATUS.CREATED]: "Oluşturuldu",
  [PROVISION_STATUS.INACTIVE_SKIPPED]: "Pasif Atlandı",
  [PROVISION_STATUS.DUPLICATE_NAME_SKIPPED]: "Mükerrer İnceleme",
  [PROVISION_STATUS.COMPANY_NOT_FOUND]: "Hata",
  [PROVISION_STATUS.OFFICE_CONNECTION_PENDING]: "Hata",
  [PROVISION_STATUS.DRIVE_ERROR]: "Hata",
});

function isCompanyActive(company) {
  return company?.data?.isActive !== false;
}

export function normalizeCompanyNameForProvision(name) {
  return normalizeCompanyTitleKey(name);
}

function companyDisplayName(company, peers = []) {
  return formatCompanyDisplayName(company, peers);
}

/**
 * Aynı unvan altında kimlikle ayrılamayan company_id’ler.
 * Geçerli farklı VKN/MERSIS’li firmalar sete girmez.
 */
export function buildDuplicateNameCompanyIdSet(companies = []) {
  return buildAmbiguousSameNameCompanyIdSet(companies);
}

/**
 * Public DTO — token / Drive ID / connection ID istemciye gitmez.
 */
export function toPublicProvisionResult(result) {
  const status = result?.status || PROVISION_STATUS.DRIVE_ERROR;
  return {
    companyId: result?.companyId ? String(result.companyId) : "",
    companyName: String(result?.companyName || "").slice(0, 200),
    status,
    label: PROVISION_STATUS_LABEL[status] || "Hata",
    message: result?.message || null,
  };
}

/**
 * Ofis Drive credential: önce mevcut firma binding’leri, sonra bağlı office connection.
 * @returns {Promise<{ connectionId: string, accessToken: string } | null>}
 */
export async function resolveOfficeDriveCredential(supabase) {
  const { data: bound, error: boundError } = await supabase
    .from("company_cloud_folders")
    .select("connection_id,updated_at")
    .not("connection_id", "is", null)
    .order("updated_at", { ascending: false });

  if (boundError) throw boundError;

  const tried = new Set();
  for (const row of bound || []) {
    const id = String(row.connection_id || "").trim();
    if (!id || tried.has(id)) continue;
    tried.add(id);
    try {
      const token = await getValidGoogleAccessTokenByConnectionId(id);
      if (token?.accessToken) {
        return { connectionId: id, accessToken: token.accessToken };
      }
    } catch {
      // sonraki aday
    }
  }

  const { data: connected, error: connError } = await supabase
    .from("cloud_storage_connections")
    .select("id,connected_at")
    .eq("provider", "google_drive")
    .eq("status", "connected")
    .order("connected_at", { ascending: false });

  if (connError) throw connError;

  for (const row of connected || []) {
    const id = String(row.id || "").trim();
    if (!id || tried.has(id)) continue;
    tried.add(id);
    try {
      const token = await getValidGoogleAccessTokenByConnectionId(id);
      if (token?.accessToken) {
        return { connectionId: id, accessToken: token.accessToken };
      }
    } catch {
      // sonraki
    }
  }

  return null;
}

/**
 * Tek firma için idempotent Drive arşiv hazırlığı.
 * @param {string} companyId
 * @param {{ dryRun?: boolean }} [options]
 */
export async function ensureCompanyDriveProvisioned(
  companyId,
  { dryRun = false } = {}
) {
  const id = String(companyId || "").trim();
  if (!id) {
    return {
      status: PROVISION_STATUS.COMPANY_NOT_FOUND,
      companyId: "",
      companyName: "",
      message: "Firma seçilmedi.",
    };
  }

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!supabase) {
    return {
      status: PROVISION_STATUS.OFFICE_CONNECTION_PENDING,
      companyId: id,
      companyName: "",
      message: "Ofis bağlantısı hazırlanıyor.",
    };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id,company_name,data")
    .eq("id", id)
    .maybeSingle();

  if (companyError || !company) {
    return {
      status: PROVISION_STATUS.COMPANY_NOT_FOUND,
      companyId: id,
      companyName: "",
      message: "Firma bulunamadı.",
    };
  }

  const name = companyDisplayName(company);
  const active = isCompanyActive(company);

  const { data: folder, error: folderError } = await supabase
    .from("company_cloud_folders")
    .select(
      "company_id,root_folder_id,root_folder_name,connection_id,folder_structure_version,sync_status,last_error"
    )
    .eq("company_id", id)
    .maybeSingle();

  if (folderError) {
    return {
      status: PROVISION_STATUS.DRIVE_ERROR,
      companyId: id,
      companyName: name,
      message: "Klasör kaydı okunamadı.",
    };
  }

  const hasRoot = Boolean(folder?.root_folder_id);
  const hasConnection = Boolean(String(folder?.connection_id || "").trim());

  if (!active) {
    return {
      status: PROVISION_STATUS.INACTIVE_SKIPPED,
      companyId: id,
      companyName: name,
      message: hasRoot
        ? "Pasif firma — mevcut arşiv korundu."
        : "Pasif firma — klasör oluşturulmaz.",
      // internal only — stripped by toPublicProvisionResult
      _rootFolderId: folder?.root_folder_id || null,
      _connectionId: folder?.connection_id || null,
    };
  }

  if (hasRoot && hasConnection) {
    if (dryRun) {
      return {
        status: PROVISION_STATUS.ALREADY_READY,
        companyId: id,
        companyName: name,
        message: "Drive arşivi hazır.",
        _rootFolderId: folder.root_folder_id,
        _connectionId: folder.connection_id,
      };
    }

    try {
      const token = await getValidGoogleAccessTokenByConnectionId(
        folder.connection_id
      );
      const tree = await ensureGoogleDriveFolderTree({
        accessToken: token.accessToken,
        companyId: id,
        companyName: name,
      });

      // Root ID korunmalı; yalnız görünen ad / sync meta güncellenir.
      await supabase
        .from("company_cloud_folders")
        .update({
          root_folder_name: tree.rootFolderName,
          folder_structure_version:
            tree.folderStructureVersion || FOLDER_STRUCTURE_VERSION,
          sync_status: "idle",
          last_error: null,
        })
        .eq("company_id", id)
        .eq("root_folder_id", folder.root_folder_id);

      return {
        status: PROVISION_STATUS.ALREADY_READY,
        companyId: id,
        companyName: name,
        message:
          tree.createdFolderCount > 0
            ? "Eksik alt klasörler tamamlandı."
            : "Drive arşivi hazır.",
        createdFolderCount: tree.createdFolderCount || 0,
        _rootFolderId: folder.root_folder_id,
        _connectionId: folder.connection_id,
      };
    } catch (cause) {
      try {
        await supabase
          .from("company_cloud_folders")
          .update({
            sync_status: "error",
            last_error: "Drive arşivi doğrulanamadı.",
          })
          .eq("company_id", id);
      } catch {
        // ignore
      }
      return {
        status: PROVISION_STATUS.DRIVE_ERROR,
        companyId: id,
        companyName: name,
        message: "Ofis bağlantısı hazırlanıyor / Drive hatası.",
        _rootFolderId: folder.root_folder_id,
        _connectionId: folder.connection_id,
        causeCode: cause?.code || null,
      };
    }
  }

  // Aktif + eksik binding → oluşturulacak (kimlikle ayrılamayan mükerrer; fail-closed)
  const { data: namePeers, error: peerError } = await supabase
    .from("companies")
    .select("id,company_name,data");
  if (peerError) {
    return {
      status: PROVISION_STATUS.DRIVE_ERROR,
      companyId: id,
      companyName: name,
      message: "Mükerrer inceleme kontrolü yapılamadı.",
    };
  }
  const peers = namePeers || [];
  const displayName = companyDisplayName(company, peers);
  const dupSet = buildDuplicateNameCompanyIdSet(peers);
  if (dupSet.has(id)) {
    return {
      status: PROVISION_STATUS.DUPLICATE_NAME_SKIPPED,
      companyId: id,
      companyName: displayName,
      message: "Mükerrer İnceleme — aynı unvan kimlikle ayrılamadı.",
    };
  }

  if (dryRun) {
    return {
      status: PROVISION_STATUS.WILL_CREATE,
      companyId: id,
      companyName: displayName,
      message: "Drive arşivi oluşturulacak.",
      willCreate: true,
    };
  }

  let office;
  try {
    office = await resolveOfficeDriveCredential(supabase);
  } catch {
    office = null;
  }
  if (!office?.accessToken || !office?.connectionId) {
    return {
      status: PROVISION_STATUS.OFFICE_CONNECTION_PENDING,
      companyId: id,
      companyName: displayName,
      message: "Ofis bağlantısı hazırlanıyor.",
    };
  }

  try {
    const tree = await ensureGoogleDriveFolderTree({
      accessToken: office.accessToken,
      companyId: id,
      companyName: displayName,
    });

    // Mevcut root varsa (yalnız connection eksik) Drive ID korunur.
    const rootFolderId = hasRoot
      ? String(folder.root_folder_id)
      : String(tree.rootFolderId);

    const upsertRow = {
      company_id: id,
      connection_id: office.connectionId,
      root_folder_id: rootFolderId,
      root_folder_name: tree.rootFolderName,
      folder_structure_version:
        tree.folderStructureVersion || FOLDER_STRUCTURE_VERSION,
      sync_status: "idle",
      last_error: null,
    };

    const { error: upsertError } = await supabase
      .from("company_cloud_folders")
      .upsert(upsertRow, { onConflict: "company_id" });

    if (upsertError) {
      return {
        status: PROVISION_STATUS.DRIVE_ERROR,
        companyId: id,
        companyName: displayName,
        message: "Klasör kaydı yazılamadı.",
      };
    }

    return {
      status: hasRoot
        ? PROVISION_STATUS.ALREADY_READY
        : PROVISION_STATUS.CREATED,
      companyId: id,
      companyName: displayName,
      message: hasRoot
        ? "Bağlantı güncellendi; kök korundu."
        : "Drive arşivi oluşturuldu.",
      createdFolderCount: hasRoot ? 0 : tree.createdFolderCount || 0,
      _rootFolderId: rootFolderId,
      _connectionId: office.connectionId,
    };
  } catch {
    try {
      if (hasRoot) {
        await supabase
          .from("company_cloud_folders")
          .update({
            sync_status: "error",
            last_error: "Drive arşivi hazırlanıyor.",
          })
          .eq("company_id", id);
      }
    } catch {
      // Firma kaydı asla silinmez.
    }
    return {
      status: PROVISION_STATUS.DRIVE_ERROR,
      companyId: id,
      companyName: displayName,
      message: "Firma kaydedildi, bulut arşivi hazırlanıyor.",
    };
  }
}

/**
 * Saf sınıflandırma (DB yok) — test ve classifyCompaniesForProvision için.
 * Öncelik: pasif → hazır (ADH/kök korunur) → kimliksiz mükerrer unvan → oluşturulacak.
 * Farklı geçerli VKN/MERSIS’li aynı unvanlar willCreate’e girebilir.
 * Otomatik merge/silme yok.
 */
export function partitionCompaniesForProvision(companies = [], folders = []) {
  const folderByCompany = new Map(
    (folders || []).map((f) => [String(f.company_id), f])
  );
  const list = companies || [];
  const duplicateIds = buildDuplicateNameCompanyIdSet(list);

  const alreadyReady = [];
  const willCreate = [];
  const inactiveSkipped = [];
  const duplicateSkipped = [];
  const failed = [];

  for (const company of list) {
    const id = String(company.id);
    const name = companyDisplayName(company, list);
    const folder = folderByCompany.get(id);
    const ready =
      Boolean(folder?.root_folder_id) &&
      Boolean(String(folder?.connection_id || "").trim());

    if (!isCompanyActive(company)) {
      inactiveSkipped.push(
        toPublicProvisionResult({
          status: PROVISION_STATUS.INACTIVE_SKIPPED,
          companyId: id,
          companyName: name,
        })
      );
      continue;
    }

    if (ready) {
      // Mevcut kök/binding korunur (ADH dahil); yeniden oluşturma yok.
      alreadyReady.push(
        toPublicProvisionResult({
          status: PROVISION_STATUS.ALREADY_READY,
          companyId: id,
          companyName: name,
        })
      );
      continue;
    }

    if (duplicateIds.has(id)) {
      duplicateSkipped.push(
        toPublicProvisionResult({
          status: PROVISION_STATUS.DUPLICATE_NAME_SKIPPED,
          companyId: id,
          companyName: name,
          message: "Mükerrer İnceleme — aynı unvan kimlikle ayrılamadı.",
        })
      );
      continue;
    }

    willCreate.push(
      toPublicProvisionResult({
        status: PROVISION_STATUS.WILL_CREATE,
        companyId: id,
        companyName: name,
        message: "Drive arşivi oluşturulacak.",
      })
    );
  }

  return {
    alreadyReady,
    willCreate,
    inactiveSkipped,
    duplicateSkipped,
    failed,
  };
}

/**
 * Tüm firmaları sınıflandır (dry-run toplu).
 * Aynı unvanlı distinct company_id grubundaki üyeler otomatik oluşturulmaz.
 */
export async function classifyCompaniesForProvision(supabase) {
  const [{ data: companies, error: companiesError }, { data: folders, error: foldersError }] =
    await Promise.all([
      supabase.from("companies").select("id,company_name,data").order("company_name"),
      supabase
        .from("company_cloud_folders")
        .select("company_id,root_folder_id,connection_id"),
    ]);

  if (companiesError) throw companiesError;
  if (foldersError) throw foldersError;

  return partitionCompaniesForProvision(companies || [], folders || []);
}
