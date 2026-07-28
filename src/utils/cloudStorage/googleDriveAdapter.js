import "server-only";
import {
  ANNVERO_SYSTEM_FOLDER,
  buildCompanyFolderPathList,
  compareCompanyFolderStructure,
  FOLDER_STRUCTURE_VERSION,
} from "./folderSchema";
import { buildAnnveroDriveMetadata, buildAnnveroSystemTxt } from "./metadata";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function escapeQuery(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveFetch(accessToken, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
    cache: "no-store",
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`Google Drive API hatası (${body?.error?.status || response.status}).`);
  return body;
}

async function listFiles(accessToken, q, fields = "files(id,name,mimeType,parents,modifiedTime,size,md5Checksum,webViewLink)") {
  const params = new URLSearchParams({ q, fields: `nextPageToken,${fields}`, pageSize: "1000", spaces: "drive" });
  const all = [];
  let pageToken = "";
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const body = await driveFetch(accessToken, `${API}/files?${params}`);
    all.push(...(body.files || []));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return all;
}

async function findChild(accessToken, parentId, name, mimeType = "") {
  const parts = [`'${escapeQuery(parentId)}' in parents`, `name = '${escapeQuery(name)}'`, "trashed = false"];
  if (mimeType) parts.push(`mimeType = '${mimeType}'`);
  return (await listFiles(accessToken, parts.join(" and ")))[0] || null;
}

async function createFolder(accessToken, name, parentId, appProperties = undefined) {
  return driveFetch(accessToken, `${API}/files?fields=id,name,webViewLink`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined, appProperties }),
  });
}

async function ensureTextFile(accessToken, parentId, name, content, mimeType) {
  if (await findChild(accessToken, parentId, name)) return false;
  const boundary = `annvero_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [parentId] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;
  await driveFetch(accessToken, `${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body,
  });
  return true;
}

async function renameDriveFile(accessToken, fileId, name) {
  return driveFetch(accessToken, `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,webViewLink`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/**
 * Firma kökü appProperties.annveroCompanyId ile bulunur — ad değişince yalnız
 * görünen ad güncellenir; klasör kimliği korunur. _ANNVERO içeriği yazılmaz
 * (yalnız yoksa metadata/sistem dosyası eklenir).
 */
export async function ensureGoogleDriveFolderTree({ accessToken, companyId, companyName }) {
  const displayName = String(companyName || "ANNVERO Firma").slice(0, 120);
  const rootQuery = `mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='annveroCompanyId' and value='${escapeQuery(companyId)}' }`;
  let root = (await listFiles(accessToken, rootQuery, "files(id,name,webViewLink,appProperties)"))[0];
  let createdFolderCount = 0;
  if (!root) {
    root = await createFolder(accessToken, displayName, null, {
      annveroCompanyId: String(companyId), annveroFolderVersion: FOLDER_STRUCTURE_VERSION,
    });
    createdFolderCount += 1;
  } else if (root.name !== displayName) {
    // Firma adı değişti: kimlik aynı, yalnız görünür klasör adı.
    root = await renameDriveFile(accessToken, root.id, displayName);
  }
  const ids = new Map([["", root.id]]);
  for (const path of buildCompanyFolderPathList()) {
    const parts = path.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    const parentId = ids.get(parentPath) || root.id;
    let folder = await findChild(accessToken, parentId, parts.at(-1), FOLDER_MIME);
    if (!folder) {
      folder = await createFolder(accessToken, parts.at(-1), parentId);
      createdFolderCount += 1;
    }
    ids.set(path, folder.id);
  }
  const systemId = ids.get("_ANNVERO");
  const metadata = buildAnnveroDriveMetadata({ companyId, driveFolderId: root.id });
  await ensureTextFile(accessToken, systemId, "metadata.json", JSON.stringify(metadata, null, 2), "application/json");
  await ensureTextFile(accessToken, systemId, "ANNVERO_SYSTEM.txt", buildAnnveroSystemTxt(metadata), "text/plain; charset=UTF-8");
  return {
    rootFolderId: root.id, rootFolderName: root.name || displayName,
    rootFolderUrl: root.webViewLink || `https://drive.google.com/drive/folders/${root.id}`,
    folderStructureVersion: FOLDER_STRUCTURE_VERSION, createdFolderCount,
  };
}

/**
 * Metadata listesi: _ANNVERO altındaki tüm dosyalar indeks dışı.
 * Sistem dosyalarına dokunulmaz; yalnız okuma.
 * sourcePath: klasör yolu + dosya adı (Evraklar sekmesi için).
 */
export async function listGoogleDriveMetadata({ accessToken, rootFolderId }) {
  if (!rootFolderId) throw new Error("Firma Drive kök klasörü bulunamadı.");
  const queue = [{ id: rootFolderId, path: "" }];
  const systemFolderIds = new Set();
  const files = [];
  while (queue.length) {
    const { id: parentId, path } = queue.shift();
    const underSystem = systemFolderIds.has(parentId);
    const children = await listFiles(accessToken, `'${escapeQuery(parentId)}' in parents and trashed = false`);
    for (const child of children) {
      if (child.mimeType === FOLDER_MIME) {
        if (underSystem || child.name === "_ANNVERO" || child.name === ANNVERO_SYSTEM_FOLDER) {
          systemFolderIds.add(child.id);
        }
        const childPath = path ? `${path}/${child.name}` : child.name;
        queue.push({ id: child.id, path: childPath });
        continue;
      }
      if (underSystem) continue;
      if (["metadata.json", "ANNVERO_SYSTEM.txt"].includes(child.name)) continue;
      files.push({ file: child, folderPath: path });
    }
  }
  return files.map(({ file, folderPath }) => ({
    providerFileId: file.id,
    parentFolderId: file.parents?.[0] || null,
    fileName: file.name,
    mimeType: file.mimeType || null,
    fileSize: file.size ? Number(file.size) : null,
    fileHash: file.md5Checksum || null,
    lastModifiedAt: file.modifiedTime || null,
    sourcePath: folderPath ? `${folderPath}/${file.name}` : file.name,
  }));
}

/**
 * Salt okunur: kök altındaki klasör yollarını listeler.
 * `_ANNVERO` yalnız kök varlık olarak kaydedilir; içine inilmez.
 * Dosya oluşturma/silme/yeniden adlandırma yok.
 */
export async function listGoogleDriveFolderPaths({ accessToken, rootFolderId }) {
  if (!rootFolderId) throw new Error("Firma Drive kök klasörü bulunamadı.");
  const paths = new Set();
  let annveroAtRoot = false;
  const queue = [{ id: rootFolderId, path: "" }];

  while (queue.length) {
    const { id, path } = queue.shift();
    const children = await listFiles(
      accessToken,
      `'${escapeQuery(id)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
      "files(id,name,mimeType)"
    );
    for (const child of children) {
      const childPath = path ? `${path}/${child.name}` : child.name;
      if (path === "" && child.name === ANNVERO_SYSTEM_FOLDER) {
        annveroAtRoot = true;
        paths.add(childPath);
        continue;
      }
      paths.add(childPath);
      queue.push({ id: child.id, path: childPath });
    }
  }

  return {
    paths: [...paths],
    annveroAtRoot,
  };
}

/**
 * Salt okunur yapı doğrulama.
 * Kök kimliği appProperties.annveroCompanyId ile doğrulanır (ada güvenilmez).
 */
export async function verifyGoogleDriveFolderStructure({
  accessToken,
  companyId,
  rootFolderId,
}) {
  if (!rootFolderId) {
    const err = new Error("Firma Drive kök klasörü bulunamadı.");
    err.code = "FOLDER_BINDING_MISSING";
    throw err;
  }

  const root = await driveFetch(
    accessToken,
    `${API}/files/${encodeURIComponent(rootFolderId)}?fields=id,name,mimeType,trashed,appProperties`
  );

  if (!root || root.trashed || root.mimeType !== FOLDER_MIME) {
    const err = new Error("Firma Drive kök klasörü geçersiz veya silinmiş.");
    err.code = "ROOT_FOLDER_INVALID";
    throw err;
  }

  const boundCompanyId = String(root.appProperties?.annveroCompanyId || "");
  if (!boundCompanyId || boundCompanyId !== String(companyId)) {
    const err = new Error("Drive kök klasörü bu firmaya bağlı değil.");
    err.code = "ROOT_COMPANY_MISMATCH";
    throw err;
  }

  const { paths, annveroAtRoot } = await listGoogleDriveFolderPaths({
    accessToken,
    rootFolderId,
  });

  return compareCompanyFolderStructure(paths, { annveroAtRoot });
}

/**
 * Kökten parent zinciri ile klasör yolunu çözer (global isim araması yok).
 */
export async function resolveDriveFolderPathFromRoot({
  accessToken,
  rootFolderId,
  targetFolderPath,
}) {
  const parts = String(targetFolderPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (!parts.length) {
    const err = new Error("Hedef klasör yolu geçersiz.");
    err.code = "INVALID_TARGET_PATH";
    throw err;
  }
  let parentId = rootFolderId;
  for (const part of parts) {
    const child = await findChild(accessToken, parentId, part, FOLDER_MIME);
    if (!child) {
      const err = new Error("Hedef klasör Drive’da bulunamadı.");
      err.code = "TARGET_FOLDER_MISSING";
      throw err;
    }
    parentId = child.id;
  }
  return parentId;
}

/**
 * Aynı firma + içerik hash’i için mevcut Drive dosyası (appProperties).
 */
export async function findDriveFileByCompanyContentHash({
  accessToken,
  companyId,
  contentHash,
}) {
  const q = [
    "trashed = false",
    `appProperties has { key='annveroCompanyId' and value='${escapeQuery(companyId)}' }`,
    `appProperties has { key='annveroContentHash' and value='${escapeQuery(contentHash)}' }`,
  ].join(" and ");
  const files = await listFiles(
    accessToken,
    q,
    "files(id,name,mimeType,size,appProperties,modifiedTime,webViewLink)"
  );
  return files[0] || null;
}

/**
 * Binary dosyayı Drive’a yükler (multipart). App-created → drive.file görünür.
 */
export async function uploadGoogleDriveBinaryFile({
  accessToken,
  parentFolderId,
  fileName,
  mimeType,
  bytes,
  appProperties,
}) {
  const boundary = `annvero_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [parentFolderId],
    appProperties: appProperties || undefined,
  });
  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    "utf8"
  );
  const mediaHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf8"
  );
  const closer = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([
    metaPart,
    mediaHeader,
    Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    closer,
  ]);

  return driveFetch(
    accessToken,
    `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,appProperties,modifiedTime,webViewLink`,
    {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
}

/**
 * Kök klasörün firma bağını doğrular (ada güvenmez).
 */
export async function assertDriveRootBelongsToCompany({
  accessToken,
  rootFolderId,
  companyId,
}) {
  const root = await driveFetch(
    accessToken,
    `${API}/files/${encodeURIComponent(rootFolderId)}?fields=id,name,mimeType,trashed,appProperties`
  );
  if (!root || root.trashed || root.mimeType !== FOLDER_MIME) {
    const err = new Error("Firma Drive kök klasörü geçersiz veya silinmiş.");
    err.code = "ROOT_FOLDER_INVALID";
    throw err;
  }
  const bound = String(root.appProperties?.annveroCompanyId || "");
  if (!bound || bound !== String(companyId)) {
    const err = new Error("Drive kök klasörü bu firmaya bağlı değil.");
    err.code = "ROOT_COMPANY_MISMATCH";
    throw err;
  }
  return root;
}
