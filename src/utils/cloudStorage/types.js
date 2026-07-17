/**
 * Ortak bulut / evrak havuzu domain sabitleri (sağlayıcıdan bağımsız çekirdek).
 * Google Drive V1 ilk sağlayıcı; OneDrive bu turda yok.
 */

export const CLOUD_PROVIDER = {
  GOOGLE_DRIVE: "google_drive",
};

export const CLOUD_CONNECTION_STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTED: "connected",
  ERROR: "error",
  PENDING: "pending",
};

export const CLOUD_SYNC_STATUS = {
  IDLE: "idle",
  SYNCING: "syncing",
  OK: "ok",
  ERROR: "error",
};

export const DOCUMENT_PARSE_STATUS = {
  PENDING: "pending",
  INDEXED: "indexed",
  MISSING: "missing",
  SOFT_DELETED: "soft_deleted",
  ERROR: "error",
};

export const DOCUMENT_CATEGORY = {
  BEYANNAME: "beyanname",
  TAHAKKUK: "tahakkuk",
  PERSONEL: "personel",
  TICARET_SICIL: "ticaret_sicil",
  DIGER: "diger",
  SISTEM: "sistem",
};

export const DOCUMENT_KIND = {
  BYN: "Byn",
  THK: "Thk",
};

/** MTV / Emlak — tahakkuk klasörü oluşturulmaz */
export const TAHAKKUK_EXCLUDED_OBLIGATIONS = Object.freeze(["MTV", "EMLAK"]);

export const FOLDER_STRUCTURE_VERSION = "v1";

export const ANNVERO_SYSTEM_FOLDER = "_ANNVERO";

export const emptyCloudStorageBinding = () => ({
  provider: null,
  connectionStatus: CLOUD_CONNECTION_STATUS.DISCONNECTED,
  accountEmail: "",
  rootFolderId: "",
  rootFolderName: "",
  folderStructureVersion: "",
  lastSyncAt: null,
  syncStatus: CLOUD_SYNC_STATUS.IDLE,
  lastError: "",
  indexedDocumentCount: 0,
});
