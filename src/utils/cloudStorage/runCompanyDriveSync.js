/**
 * Firma Drive metadata sync — sync / reconcile / upload sonrası ortak motor.
 * Upload’u çağırmaz (döngü yok).
 */

import { listGoogleDriveMetadata } from "./googleDriveAdapter.js";
import { runMetadataSyncPass } from "./syncEngine.js";
import { ANNVERO_SYSTEM_FOLDER } from "./types.js";

function rowFromDb(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    provider: row.provider,
    providerFileId: row.provider_file_id,
    parentFolderId: row.parent_folder_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    fileHash: row.file_hash,
    sourcePath: row.source_path || "",
    lastModifiedAt: row.last_modified_at,
    indexedAt: row.indexed_at,
    parseStatus: row.parse_status,
  };
}

function rowToDb(row, companyId) {
  return {
    company_id: companyId,
    provider: "google_drive",
    provider_file_id: row.providerFileId,
    parent_folder_id: row.parentFolderId || null,
    file_name: row.fileName,
    mime_type: row.mimeType || null,
    file_size: row.fileSize ?? null,
    file_hash: row.fileHash || null,
    source_path: row.sourcePath || null,
    last_modified_at: row.lastModifiedAt || null,
    indexed_at: row.indexedAt || new Date().toISOString(),
    parse_status: row.parseStatus || "indexed",
  };
}

function isAnnveroPath(sourcePath = "") {
  const p = String(sourcePath || "").trim();
  return (
    p === ANNVERO_SYSTEM_FOLDER ||
    p.startsWith(`${ANNVERO_SYSTEM_FOLDER}/`)
  );
}

/**
 * @param {object} opts
 * @param {import("@supabase/supabase-js").SupabaseClient} opts.supabase
 * @param {string} opts.accessToken
 * @param {string} opts.companyId
 * @param {string} opts.rootFolderId
 * @param {boolean} [opts.writeSyncEvents]
 * @param {{ eventType?: string, status?: string, providerFileId?: string, errorMessage?: string }[]} [opts.extraEvents]
 */
export async function runCompanyDriveSync({
  supabase,
  accessToken,
  companyId,
  rootFolderId,
  writeSyncEvents = false,
  extraEvents = [],
} = {}) {
  if (!supabase || !accessToken || !companyId || !rootFolderId) {
    const err = new Error("SYNC_PARAMS_MISSING");
    err.code = "SYNC_PARAMS_MISSING";
    throw err;
  }

  const remote = await listGoogleDriveMetadata({
    accessToken,
    rootFolderId,
  });

  const remoteFiltered = (remote || []).filter(
    (file) => !isAnnveroPath(file.sourcePath || "")
  );

  const { data: indexed, error: indexError } = await supabase
    .from("document_index")
    .select(
      "id,company_id,provider,provider_file_id,parent_folder_id,file_name,mime_type,file_size,file_hash,source_path,last_modified_at,indexed_at,parse_status"
    )
    .eq("company_id", companyId)
    .eq("provider", "google_drive");
  if (indexError) throw indexError;

  const pass = runMetadataSyncPass({
    companyId,
    provider: "google_drive",
    remoteFiles: remoteFiltered,
    existingIndex: (indexed || [])
      .map(rowFromDb)
      .filter((row) => !isAnnveroPath(row.sourcePath || "")),
  });

  const upsertRows = [...pass.created, ...pass.updated].map((row) =>
    rowToDb(row, companyId)
  );
  if (upsertRows.length) {
    const { error } = await supabase
      .from("document_index")
      .upsert(upsertRows, { onConflict: "company_id,provider_file_id" });
    if (error) throw error;
  }

  const missingIds = pass.missing.map((row) => row.providerFileId).filter(Boolean);
  if (missingIds.length) {
    const { error: missingError } = await supabase
      .from("document_index")
      .update({ parse_status: "missing" })
      .eq("company_id", companyId)
      .in("provider_file_id", missingIds);
    if (missingError) throw missingError;
  }

  const now = new Date().toISOString();
  await supabase
    .from("company_cloud_folders")
    .update({ sync_status: "ok", last_sync_at: now, last_error: null })
    .eq("company_id", companyId);

  if (writeSyncEvents) {
    const eventRows = [
      ...pass.events.map((ev) => ({
        company_id: companyId,
        provider_file_id: ev.providerFileId || null,
        event_type: String(ev.eventType || "sync").slice(0, 80),
        status: String(ev.status || "ok").slice(0, 40),
        error_message: ev.errorMessage
          ? String(ev.errorMessage).slice(0, 200)
          : null,
      })),
      ...extraEvents.map((ev) => ({
        company_id: companyId,
        provider_file_id: ev.providerFileId || null,
        event_type: String(ev.eventType || "sync").slice(0, 80),
        status: String(ev.status || "ok").slice(0, 40),
        error_message: ev.errorMessage
          ? String(ev.errorMessage).slice(0, 200)
          : null,
      })),
    ];
    if (eventRows.length) {
      // Tablo yoksa veya insert fail olursa sync sonucunu bozma.
      try {
        await supabase.from("document_sync_events").insert(eventRows);
      } catch {
        // ignore
      }
    }
  }

  return {
    stats: {
      ...pass.stats,
      skippedDuplicates: pass.stats.skippedDuplicates,
    },
    lastSyncAt: now,
    created: pass.created,
    updated: pass.updated,
    missing: pass.missing,
  };
}
