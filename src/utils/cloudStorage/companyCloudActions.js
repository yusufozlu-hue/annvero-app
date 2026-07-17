/**
 * Firma kartı — Bulut Depolama aksiyon orkestrasyonu (mock adapter).
 * Gerçek Google SDK bu turda yüklenmez.
 */

import {
  CLOUD_CONNECTION_STATUS,
  CLOUD_SYNC_STATUS,
  emptyCloudStorageBinding,
  mockDriveAdapter,
  runMetadataSyncPass,
} from "@/src/utils/cloudStorage";
import {
  assertNoSecretInPayload,
  sanitizeConnectionPublicView,
} from "@/src/lib/googleDrive/tokenPolicy";

function mergeBinding(company, patch) {
  const prev = {
    ...emptyCloudStorageBinding(),
    ...(company?.cloudStorage || {}),
  };
  return { ...prev, ...patch };
}

export function getCloudStoragePublicState(company) {
  const binding = {
    ...emptyCloudStorageBinding(),
    ...(company?.cloudStorage || {}),
  };
  const connection = mockDriveAdapter.getConnection({
    companyId: company?.id,
  });
  const view = {
    binding,
    connection: sanitizeConnectionPublicView(connection),
    folderReady: Boolean(binding.rootFolderId),
  };
  assertNoSecretInPayload(view);
  return view;
}

export async function connectCloudStorageDemo(company, { accountEmail } = {}) {
  if (!company?.id) throw new Error("Firma seçili değil.");
  const connection = await mockDriveAdapter.connectDemo({
    companyId: company.id,
    accountEmail,
  });
  const next = {
    ...company,
    cloudStorage: mergeBinding(company, {
      provider: connection.provider,
      connectionStatus: CLOUD_CONNECTION_STATUS.CONNECTED,
      accountEmail: connection.accountEmail,
      lastError: "",
    }),
  };
  assertNoSecretInPayload(next.cloudStorage);
  return next;
}

export async function disconnectCloudStorage(company) {
  if (!company?.id) throw new Error("Firma seçili değil.");
  await mockDriveAdapter.disconnect({ companyId: company.id });
  return {
    ...company,
    cloudStorage: emptyCloudStorageBinding(),
  };
}

export async function createCompanyDriveFolders(company) {
  if (!company?.id) throw new Error("Firma seçili değil.");
  const result = await mockDriveAdapter.ensureCompanyFolderTree({
    companyId: company.id,
    companyDisplayName: company.companyName || "Firma",
  });
  assertNoSecretInPayload(result);
  const next = {
    ...company,
    cloudStorage: mergeBinding(company, {
      connectionStatus: CLOUD_CONNECTION_STATUS.CONNECTED,
      rootFolderId: result.rootFolderId,
      rootFolderName: result.rootFolderName,
      folderStructureVersion: result.folderStructureVersion,
      lastError: "",
      syncStatus: CLOUD_SYNC_STATUS.IDLE,
    }),
  };
  return { company: next, result };
}

export async function refreshCloudStorageSync(company, existingIndex = []) {
  if (!company?.id) throw new Error("Firma seçili değil.");
  const remoteFiles = await mockDriveAdapter.listRemoteFileMetadata({
    companyId: company.id,
  });
  const pass = runMetadataSyncPass({
    companyId: company.id,
    provider: company.cloudStorage?.provider || "google_drive",
    remoteFiles,
    existingIndex,
  });
  assertNoSecretInPayload({
    stats: pass.stats,
    created: pass.created.length,
  });
  const next = {
    ...company,
    cloudStorage: mergeBinding(company, {
      lastSyncAt: new Date().toISOString(),
      syncStatus: CLOUD_SYNC_STATUS.OK,
      indexedDocumentCount: pass.index.filter(
        (r) =>
          String(r.companyId) === String(company.id) &&
          r.parseStatus !== "soft_deleted" &&
          r.parseStatus !== "missing"
      ).length,
      lastError: "",
    }),
  };
  return { company: next, pass };
}

export function getOpenFolderUrl(company) {
  return mockDriveAdapter.openFolderUrl({ companyId: company?.id });
}
