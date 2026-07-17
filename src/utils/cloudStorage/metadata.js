/**
 * _ANNVERO sistem metadata — yalnızca teknik bağ.
 * Firma unvanı / MERSİS vs. burada tutulmaz; tek kaynak Firma Kartı.
 */

import { FOLDER_STRUCTURE_VERSION } from "./folderSchema.js";
import { CLOUD_SYNC_STATUS } from "./types.js";

export const METADATA_SCHEMA_VERSION = 1;

/**
 * @param {object} input
 */
export function buildAnnveroDriveMetadata({
  companyId,
  driveFolderId,
  folderStructureVersion = FOLDER_STRUCTURE_VERSION,
  lastSyncAt = null,
  syncStatus = CLOUD_SYNC_STATUS.IDLE,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!companyId) throw new Error("companyId zorunlu.");
  if (!driveFolderId) throw new Error("driveFolderId zorunlu.");

  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    createdAt,
    companyId: String(companyId),
    driveFolderId: String(driveFolderId),
    folderStructureVersion: String(folderStructureVersion),
    lastSyncAt,
    syncStatus: String(syncStatus),
  };
}

/**
 * İnsan okunur sistem notu — firma PII içermez.
 */
export function buildAnnveroSystemTxt(metadata) {
  const m = metadata || {};
  return [
    "ANNVERO sistem klasörü",
    "Bu klasöre kullanıcı dosyası koymayın.",
    "Firma bilgilerinin doğruluk kaynağı: ANNVERO Firma Kartı.",
    "",
    `schemaVersion=${m.schemaVersion ?? METADATA_SCHEMA_VERSION}`,
    `companyId=${m.companyId || ""}`,
    `driveFolderId=${m.driveFolderId || ""}`,
    `folderStructureVersion=${m.folderStructureVersion || FOLDER_STRUCTURE_VERSION}`,
    `createdAt=${m.createdAt || ""}`,
    `lastSyncAt=${m.lastSyncAt || ""}`,
    `syncStatus=${m.syncStatus || CLOUD_SYNC_STATUS.IDLE}`,
    "",
  ].join("\n");
}

/** metadata.json veya txt içinde yasaklı firma alanları (sızıntı koruması) */
const FORBIDDEN_METADATA_KEYS = [
  "companyName",
  "unvan",
  "taxNumber",
  "vergiNo",
  "mersis",
  "ticaretSicil",
  "address",
  "iban",
];

export function assertTechnicalMetadataOnly(obj) {
  const keys = Object.keys(obj || {});
  for (const key of keys) {
    if (FORBIDDEN_METADATA_KEYS.includes(key)) {
      throw new Error(`Metadata firma alanı içeremez: ${key}`);
    }
  }
  return true;
}
