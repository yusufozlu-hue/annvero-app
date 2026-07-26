import "server-only";
import { buildCompanyFolderPathList, FOLDER_STRUCTURE_VERSION } from "./folderSchema";
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
 */
export async function listGoogleDriveMetadata({ accessToken, rootFolderId }) {
  if (!rootFolderId) throw new Error("Firma Drive kök klasörü bulunamadı.");
  const queue = [rootFolderId];
  const systemFolderIds = new Set();
  const files = [];
  while (queue.length) {
    const parentId = queue.shift();
    const underSystem = systemFolderIds.has(parentId);
    const children = await listFiles(accessToken, `'${escapeQuery(parentId)}' in parents and trashed = false`);
    for (const child of children) {
      if (child.mimeType === FOLDER_MIME) {
        if (underSystem || child.name === "_ANNVERO") {
          systemFolderIds.add(child.id);
        }
        queue.push(child.id);
        continue;
      }
      if (underSystem) continue;
      if (["metadata.json", "ANNVERO_SYSTEM.txt"].includes(child.name)) continue;
      files.push(child);
    }
  }
  return files.map((file) => ({
    providerFileId: file.id, parentFolderId: file.parents?.[0] || null,
    fileName: file.name, mimeType: file.mimeType || null,
    fileSize: file.size ? Number(file.size) : null, fileHash: file.md5Checksum || null,
    lastModifiedAt: file.modifiedTime || null,
  }));
}
