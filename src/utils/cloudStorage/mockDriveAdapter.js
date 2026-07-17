/**
 * Yerel/mock Google Drive adapter — gerçek OAuth yok.
 * Token saklamaz. Klasör ağacı + dosya metadata bellekte (process) tutulur.
 * UI demosu ve birim testler için.
 */

import {
  buildCompanyFolderPathList,
  FOLDER_STRUCTURE_VERSION,
  planFolderCreations,
} from "./folderSchema.js";
import {
  buildAnnveroDriveMetadata,
  buildAnnveroSystemTxt,
} from "./metadata.js";
import { CLOUD_CONNECTION_STATUS, CLOUD_PROVIDER, CLOUD_SYNC_STATUS } from "./types.js";

/** @type {Map<string, { connection: object, folders: Map<string,string>, files: Map<string,object>, systemWritten: boolean }>} */
const STORE = new Map();

function companyKey(companyId) {
  return String(companyId || "");
}

function getOrInit(companyId) {
  const key = companyKey(companyId);
  if (!STORE.has(key)) {
    STORE.set(key, {
      connection: {
        provider: CLOUD_PROVIDER.GOOGLE_DRIVE,
        status: CLOUD_CONNECTION_STATUS.DISCONNECTED,
        accountEmail: "",
        connectedAt: null,
      },
      folders: new Map(), // path -> folderId
      files: new Map(), // providerFileId -> meta
      systemWritten: false,
      rootFolderId: "",
      rootFolderName: "",
    });
  }
  return STORE.get(key);
}

export function resetMockDriveStoreForTests() {
  STORE.clear();
}

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMockDriveAdapter() {
  return {
    provider: CLOUD_PROVIDER.GOOGLE_DRIVE,

    /** OAuth yerine demo bağlantı — token üretilmez/saklanmaz */
    async connectDemo({ companyId, accountEmail = "demo@annvero.local" } = {}) {
      const state = getOrInit(companyId);
      state.connection = {
        provider: CLOUD_PROVIDER.GOOGLE_DRIVE,
        status: CLOUD_CONNECTION_STATUS.CONNECTED,
        accountEmail: String(accountEmail),
        connectedAt: new Date().toISOString(),
        /** güvenlik: token alanları yok */
      };
      return { ...state.connection };
    },

    async disconnect({ companyId } = {}) {
      const state = getOrInit(companyId);
      state.connection = {
        provider: CLOUD_PROVIDER.GOOGLE_DRIVE,
        status: CLOUD_CONNECTION_STATUS.DISCONNECTED,
        accountEmail: "",
        connectedAt: null,
      };
      state.folders.clear();
      state.files.clear();
      state.systemWritten = false;
      state.rootFolderId = "";
      state.rootFolderName = "";
      return { ...state.connection };
    },

    getConnection({ companyId } = {}) {
      return { ...getOrInit(companyId).connection };
    },

    /**
     * Idempotent klasör ağacı + _ANNVERO metadata.
     */
    async ensureCompanyFolderTree({
      companyId,
      companyDisplayName = "Firma",
    } = {}) {
      const state = getOrInit(companyId);
      if (state.connection.status !== CLOUD_CONNECTION_STATUS.CONNECTED) {
        throw new Error("Önce Google Drive bağlantısı gerekli.");
      }

      if (!state.rootFolderId) {
        state.rootFolderId = newId("root");
        state.rootFolderName = String(companyDisplayName || "Firma").slice(0, 120);
        state.folders.set("", state.rootFolderId);
      }

      const existingPaths = [...state.folders.keys()].filter(Boolean);
      const plan = planFolderCreations(existingPaths);
      let created = 0;
      for (const path of plan.toCreate) {
        state.folders.set(path, newId("fld"));
        created += 1;
      }

      const metadata = buildAnnveroDriveMetadata({
        companyId,
        driveFolderId: state.rootFolderId,
        folderStructureVersion: FOLDER_STRUCTURE_VERSION,
        syncStatus: CLOUD_SYNC_STATUS.IDLE,
      });
      const systemTxt = buildAnnveroSystemTxt(metadata);
      state.systemWritten = true;

      // Sistem dosyalarını indekslenmeyecek şekilde ayırt et (path under _ANNVERO)
      const systemFolderId = state.folders.get("_ANNVERO");

      return {
        rootFolderId: state.rootFolderId,
        rootFolderName: state.rootFolderName,
        folderStructureVersion: FOLDER_STRUCTURE_VERSION,
        createdFolderCount: created,
        skippedFolderCount: plan.skipped.length,
        totalFolderCount: buildCompanyFolderPathList().length,
        paths: [...state.folders.keys()].filter(Boolean).sort(),
        systemFolderId,
        metadata,
        systemTxt,
        /** secrets yok */
        hasTokens: false,
      };
    },

    async listFolderStructure({ companyId } = {}) {
      const state = getOrInit(companyId);
      return {
        rootFolderId: state.rootFolderId,
        rootFolderName: state.rootFolderName,
        paths: [...state.folders.keys()].filter(Boolean).sort(),
        folderIds: Object.fromEntries(state.folders),
      };
    },

    /** Test/demo: Drive’a dosya metadata ekle (içerik yok) */
    async seedRemoteFile({
      companyId,
      providerFileId,
      fileName,
      fileHash,
      parentPath = "98 - Diğer Evraklar",
      mimeType = "application/pdf",
      fileSize = 1024,
      lastModifiedAt = new Date().toISOString(),
    } = {}) {
      const state = getOrInit(companyId);
      if (!state.folders.has(parentPath) && parentPath) {
        state.folders.set(parentPath, newId("fld"));
      }
      const id = String(providerFileId || newId("file"));
      const meta = {
        providerFileId: id,
        fileName,
        fileHash: String(fileHash || "").toLowerCase(),
        parentFolderId: state.folders.get(parentPath) || state.rootFolderId,
        sourcePath: parentPath ? `${parentPath}/${fileName}` : fileName,
        mimeType,
        fileSize,
        lastModifiedAt,
      };
      state.files.set(id, meta);
      return meta;
    },

    async removeRemoteFile({ companyId, providerFileId } = {}) {
      getOrInit(companyId).files.delete(String(providerFileId));
    },

    /** Metadata list — PDF byte indirme yok */
    async listRemoteFileMetadata({ companyId } = {}) {
      const state = getOrInit(companyId);
      return [...state.files.values()].map((f) => ({ ...f }));
    },

    openFolderUrl({ companyId } = {}) {
      const state = getOrInit(companyId);
      if (!state.rootFolderId) return null;
      // Mock URL — gerçek Drive linki değil
      return `https://drive.google.com/drive/folders/${state.rootFolderId}?usp=annvero_mock`;
    },
  };
}

export const mockDriveAdapter = createMockDriveAdapter();
