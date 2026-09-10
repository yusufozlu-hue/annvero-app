/**
 * Sistem/cron Google Drive reconcile — production route’un çekirdeği.
 * NextResponse üretmez; { status, body } döner (test edilebilir DI sınırı).
 * Varsayılan bağımlılıklar lazy yüklenir — test tam deps verdiğinde next çekilmez.
 */

import { ANNVERO_SYSTEM_FOLDER } from "@/src/utils/cloudStorage/types.js";
import {
  RECONCILE_MAX_COMPANIES_PER_RUN,
  reconcileTimeRemaining,
  sliceReconcileBatch,
} from "@/src/utils/cloudStorage/reconcileBatch.js";
import {
  classifySyncFailure,
  enqueueSyncRetry,
  isSyncRetryDue,
  parseSyncRetryState,
  shouldRetrySyncAttempt,
  clearSyncRetry,
} from "@/src/utils/cloudStorage/syncRetry.js";

const SAFE = Object.freeze({
  SYNC_FAILED: "Senkron başarısız.",
  INVALID_JSON: "Geçersiz JSON gövdesi.",
});

const DEP_KEYS = [
  "authorizeSystemReconcileRequest",
  "enforceRateLimit",
  "parseReconcileRequestBody",
  "getApiSupabase",
  "resolveCompanyDriveConnection",
  "ensureCompanyDriveProvisioned",
  "runCompanyDriveSync",
];

async function loadDefaultDeps() {
  const [
    { authorizeSystemReconcileRequest },
    { enforceRateLimit },
    { parseReconcileRequestBody },
    { getApiSupabase },
    { resolveCompanyDriveConnection, COMPANY_DRIVE_ERROR },
    { ensureCompanyDriveProvisioned, PROVISION_STATUS },
    { runCompanyDriveSync },
  ] = await Promise.all([
    import("@/src/lib/security/systemReconcileAuth.js"),
    import("@/src/lib/security/rateLimit.js"),
    import("@/src/utils/cloudStorage/reconcileRequestBody.js"),
    import("@/src/lib/auth/apiGuard.js"),
    import("@/src/lib/googleDrive/resolveCompanyDriveConnection.js"),
    import("@/src/lib/googleDrive/ensureCompanyDriveProvisioned.js"),
    import("@/src/utils/cloudStorage/runCompanyDriveSync.js"),
  ]);
  return {
    authorizeSystemReconcileRequest,
    enforceRateLimit,
    parseReconcileRequestBody,
    getApiSupabase,
    resolveCompanyDriveConnection,
    ensureCompanyDriveProvisioned,
    runCompanyDriveSync,
    COMPANY_DRIVE_ERROR,
    PROVISION_STATUS,
  };
}

async function resolveDeps(overrides = {}) {
  const missing = DEP_KEYS.some((key) => typeof overrides[key] !== "function");
  if (!missing) {
    // Tam DI: next/apiGuard yüklenmez. Sabit stringler kaynaklarla aynı.
    return {
      COMPANY_DRIVE_ERROR: {
        FOLDER_BINDING_MISSING: "FOLDER_BINDING_MISSING",
        OFFICE_CONNECTION_PENDING: "OFFICE_CONNECTION_PENDING",
      },
      PROVISION_STATUS: {
        CREATED: "CREATED",
        ALREADY_READY: "ALREADY_READY",
        INACTIVE_SKIPPED: "INACTIVE_SKIPPED",
        DUPLICATE_NAME_SKIPPED: "DUPLICATE_NAME_SKIPPED",
      },
      ...overrides,
    };
  }
  const defaults = await loadDefaultDeps();
  return { ...defaults, ...overrides };
}

function isCompanyActive(company) {
  return company?.data?.isActive !== false;
}

function isDuplicateRecord(company) {
  const data =
    company?.data && typeof company.data === "object" ? company.data : {};
  return Boolean(data.duplicate_of || data.duplicateOf);
}

async function syncResolved(supabase, companyId, drive, deps) {
  const result = await deps.runCompanyDriveSync({
    supabase,
    accessToken: drive.accessToken,
    companyId,
    rootFolderId: drive.rootFolderId,
    writeSyncEvents: true,
    extraEvents: [
      {
        eventType: "reconcile",
        status: "ok",
        errorMessage: null,
      },
    ],
  });
  await clearSyncRetry(supabase, companyId);
  return {
    companyId,
    ok: true,
    code: "OK",
    stats: result.stats,
    lastSyncAt: result.lastSyncAt,
  };
}

async function reconcileOneCompany(supabase, companyId, deps) {
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id,data")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError || !company) {
    return { companyId, code: "COMPANY_NOT_FOUND", ok: false };
  }
  if (!isCompanyActive(company) || isDuplicateRecord(company)) {
    return { companyId, code: "COMPANY_INACTIVE", ok: false, skipped: true };
  }

  let drive;
  try {
    drive = await deps.resolveCompanyDriveConnection(companyId);
  } catch (error) {
    const code = error?.code;
    if (
      code === deps.COMPANY_DRIVE_ERROR.FOLDER_BINDING_MISSING ||
      code === deps.COMPANY_DRIVE_ERROR.OFFICE_CONNECTION_PENDING
    ) {
      const provision = await deps.ensureCompanyDriveProvisioned(companyId, {
        dryRun: false,
      });
      if (
        provision.status === deps.PROVISION_STATUS.CREATED ||
        provision.status === deps.PROVISION_STATUS.ALREADY_READY
      ) {
        try {
          drive = await deps.resolveCompanyDriveConnection(companyId);
        } catch {
          return {
            companyId,
            code: "PROVISION_PENDING",
            ok: false,
            skipped: true,
          };
        }
      } else if (
        provision.status === deps.PROVISION_STATUS.INACTIVE_SKIPPED
      ) {
        return { companyId, code: "COMPANY_INACTIVE", ok: false, skipped: true };
      } else if (
        provision.status === deps.PROVISION_STATUS.DUPLICATE_NAME_SKIPPED
      ) {
        return { companyId, code: "COMPANY_INACTIVE", ok: false, skipped: true };
      } else {
        return {
          companyId,
          code: "PROVISION_PENDING",
          ok: false,
          skipped: true,
        };
      }
    } else {
      return { companyId, code: "CONNECTION_MISSING", ok: false, skipped: true };
    }
  }

  try {
    return await syncResolved(supabase, companyId, drive, deps);
  } catch (error) {
    const kind = classifySyncFailure(error);
    if (kind.retryable && shouldRetrySyncAttempt(1)) {
      await enqueueSyncRetry(supabase, companyId, { attempt: 1 });
    }
    return { companyId, code: "SYNC_FAILED", ok: false };
  }
}

async function processSyncRetryDue(supabase, folders, startMs, deps) {
  const results = [];
  for (const row of folders || []) {
    if (reconcileTimeRemaining(startMs) < 5000) break;
    const companyId = String(row.company_id || "").trim();
    if (!companyId) continue;
    if (!isSyncRetryDue(row.last_error)) continue;

    const state = parseSyncRetryState(row.last_error);
    if (!state || !shouldRetrySyncAttempt(state.attempt)) continue;

    let drive;
    try {
      drive = await deps.resolveCompanyDriveConnection(companyId);
    } catch {
      continue;
    }

    try {
      const synced = await syncResolved(supabase, companyId, drive, deps);
      results.push({ ...synced, kind: "sync_retry" });
    } catch (error) {
      const kind = classifySyncFailure(error);
      if (kind.retryable && shouldRetrySyncAttempt(state.attempt + 1)) {
        await enqueueSyncRetry(supabase, companyId, {
          attempt: state.attempt + 1,
        });
      }
      results.push({
        companyId,
        ok: false,
        code: "SYNC_FAILED",
        kind: "sync_retry",
      });
    }
  }
  return results;
}

/**
 * @param {Request} request
 * @param {object} [deps]
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function runSystemReconcile(request, deps = {}) {
  const d = await resolveDeps(deps);

  // 1) system authorization — service_role / Drive / DB öncesi zorunlu
  const auth = d.authorizeSystemReconcileRequest(request);
  if (!auth.ok) {
    return { status: auth.status, body: auth.body };
  }

  // 2) rate limit
  const limited = d.enforceRateLimit(request, null, "google-drive-reconcile", {
    limit: 12,
    windowMs: 300_000,
  });
  if (limited) {
    if (typeof limited.status === "number" && limited.body) {
      return { status: limited.status, body: limited.body };
    }
    if (typeof limited.json === "function") {
      const body = await limited.json();
      return { status: limited.status || 429, body };
    }
    return {
      status: 429,
      body: { ok: false, code: "RATE_LIMITED", message: "Çok fazla istek." },
    };
  }

  // 3) method/body validation
  const parsed = await d.parseReconcileRequestBody(request);
  if (!parsed.ok) {
    return {
      status: parsed.status || 400,
      body: {
        ok: false,
        code: parsed.code,
        message: parsed.message || SAFE.INVALID_JSON,
      },
    };
  }

  const { companyId: singleCompanyId, cursor, limit } = parsed.value;

  // 4) service_role — yalnız system auth sonrası
  const { supabase, guard } = d.getApiSupabase(
    "google-drive-reconcile",
    "document_index"
  );
  if (guard) {
    if (typeof guard.status === "number" && guard.body) {
      return { status: guard.status, body: guard.body };
    }
    if (typeof guard.json === "function") {
      const body = await guard.json();
      return { status: guard.status || 500, body };
    }
    return {
      status: 500,
      body: { ok: false, code: "SYNC_FAILED", message: SAFE.SYNC_FAILED },
    };
  }

  const startMs = Date.now();

  if (singleCompanyId) {
    const result = await reconcileOneCompany(supabase, singleCompanyId, d);
    return {
      status: 200,
      body: {
        ok: result.ok,
        code: result.code,
        results: [result],
        skippedSystemFolder: ANNVERO_SYSTEM_FOLDER,
      },
    };
  }

  const [{ data: folders, error: foldersError }, { data: companies, error: companiesError }] =
    await Promise.all([
      supabase
        .from("company_cloud_folders")
        .select("company_id,root_folder_id,connection_id,last_error,sync_status"),
      supabase.from("companies").select("id,data"),
    ]);

  if (foldersError || companiesError) {
    return {
      status: 500,
      body: { ok: false, code: "SYNC_FAILED", message: SAFE.SYNC_FAILED },
    };
  }

  const retryResults = await processSyncRetryDue(supabase, folders, startMs, d);

  const folderById = new Map(
    (folders || []).map((f) => [String(f.company_id), f])
  );

  const companyIds = new Set();
  for (const f of folders || []) {
    const id = String(f.company_id || "").trim();
    if (id) companyIds.add(id);
  }
  for (const company of companies || []) {
    if (!isCompanyActive(company) || isDuplicateRecord(company)) continue;
    const id = String(company.id || "").trim();
    if (!id) continue;
    const folder = folderById.get(id);
    const ready =
      Boolean(folder?.root_folder_id) &&
      Boolean(String(folder?.connection_id || "").trim());
    if (!ready) companyIds.add(id);
  }

  const { batch, nextCursor, total, done } = sliceReconcileBatch(
    [...companyIds],
    { cursor, limit: limit || RECONCILE_MAX_COMPANIES_PER_RUN }
  );

  const results = [...retryResults];
  let okCount = retryResults.filter((r) => r.ok).length;
  let skipCount = 0;
  let failCount = retryResults.filter((r) => !r.ok).length;

  for (const companyId of batch) {
    if (reconcileTimeRemaining(startMs) < 3000) break;
    const result = await reconcileOneCompany(supabase, companyId, d);
    results.push({
      companyId: result.companyId,
      ok: result.ok,
      code: result.code,
      skipped: Boolean(result.skipped),
      stats: result.stats || undefined,
    });
    if (result.ok) okCount += 1;
    else if (result.skipped) skipCount += 1;
    else failCount += 1;
  }

  const timeBudgetExceeded = reconcileTimeRemaining(startMs) < 3000;

  return {
    status: 200,
    body: {
      ok: failCount === 0,
      code: "BATCH_DONE",
      summary: {
        okCount,
        skipCount,
        failCount,
        total,
        processed: results.length,
        timeBudgetExceeded,
      },
      cursor: timeBudgetExceeded || !done ? nextCursor : "",
      done: done && !timeBudgetExceeded,
      results,
      skippedSystemFolder: ANNVERO_SYSTEM_FOLDER,
    },
  };
}
