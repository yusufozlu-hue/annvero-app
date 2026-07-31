import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireAuthenticatedApi,
  requireManagementApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import {
  diffAccountPlanVersions,
  fingerprintAccountPlanAccounts,
  normalizeAccountPlanRowInput,
} from "@/src/utils/accountPlanUpload";
import {
  countAccountsForUpload,
  loadAllAccountsForUpload,
  queryAccountsPage,
} from "@/src/utils/accountPlanQuery";

const UPLOADS = "company_account_plan_uploads";
const ACCOUNTS = "company_account_plan_accounts";

function isMissingRelation(error) {
  const msg = String(error?.message || error?.code || "");
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist|Could not find the table/i.test(msg)
  );
}

function schemaMissingResponse() {
  return NextResponse.json(
    {
      error: "Hesap planı tabloları henüz uygulanmadı.",
      code: "SCHEMA_MISSING",
      migration: "029_account_plan_uploads_and_user_notifications.sql",
    },
    { status: 503 }
  );
}

function publicUpload(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    fileName: row.file_name,
    originalFileName: row.original_file_name || row.file_name || "",
    contentFingerprint: row.content_fingerprint,
    fileContentHash: row.file_content_hash || "",
    uploadedBy: row.uploaded_by_label || row.uploaded_by || "",
    uploadedAt: row.created_at,
    status: row.status,
    isActive: Boolean(row.is_active),
    totalRows: row.total_rows,
    addedCount: row.added_count,
    updatedCount: row.updated_count,
    skippedCount: row.skipped_count,
    errorCount: row.error_count,
    safeErrorSummary: row.safe_error_summary || "",
    activatedAt: row.activated_at,
    archiveStatus: row.archive_status || "none",
    archivedAt: row.archived_at || null,
  };
}

function publicAccount(row) {
  return {
    id: row.id,
    accountCode: row.account_code,
    accountName: row.account_name,
    currency: row.currency || "TL",
    isActive: row.is_active !== false,
    uploadId: row.upload_id,
  };
}

async function loadActiveUpload(supabase, companyId) {
  const { data, error } = await supabase
    .from(UPLOADS)
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadAccountsForUpload(supabase, companyId, uploadId) {
  return loadAllAccountsForUpload(supabase, ACCOUNTS, companyId, uploadId);
}

/** 030 kolonları yoksa sessizce atlanır — aktif plan bozulmaz. */
async function patchUploadArchiveMeta(supabase, uploadId, patch) {
  if (!uploadId || !patch) return;
  const { error } = await supabase.from(UPLOADS).update(patch).eq("id", uploadId);
  if (error && !/column|schema cache/i.test(String(error.message || ""))) {
    throw error;
  }
}

async function reloadUpload(supabase, uploadId) {
  const { data, error } = await supabase
    .from(UPLOADS)
    .select("*")
    .eq("id", uploadId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunlu." }, { status: 400 });
  }

  const ctx = await requireAuthenticatedApi("account-plans:get", UPLOADS, {
    companyId,
  });
  if (ctx.error) return ctx.error;

  try {
    const upload = await loadActiveUpload(ctx.supabase, companyId);
    if (!upload) {
      return NextResponse.json({
        accounts: [],
        upload: null,
        source: "api",
        pagination: {
          total: 0,
          page: 1,
          pageSize: 50,
          pageCount: 1,
          activeCount: 0,
          inactiveCount: 0,
          planTotal: 0,
          planActiveCount: 0,
          planInactiveCount: 0,
        },
      });
    }

    const planCounts = await countAccountsForUpload(
      ctx.supabase,
      ACCOUNTS,
      companyId,
      upload.id
    );

    const wantAll = request.nextUrl.searchParams.get("all") === "1";
    if (wantAll) {
      // Bank Parser / Eksik Hesap — tam plan (1000+). Sayfalı döngü.
      const rows = await loadAccountsForUpload(
        ctx.supabase,
        companyId,
        upload.id
      );
      const mapped = rows.map(publicAccount);
      return NextResponse.json({
        accounts: mapped,
        upload: publicUpload(upload),
        source: "api",
        pagination: {
          total: planCounts.total,
          page: 1,
          pageSize: planCounts.total || 1,
          pageCount: 1,
          activeCount: planCounts.activeCount,
          inactiveCount: planCounts.inactiveCount,
          planTotal: planCounts.total,
          planActiveCount: planCounts.activeCount,
          planInactiveCount: planCounts.inactiveCount,
        },
      });
    }

    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") || 50);
    const q = request.nextUrl.searchParams.get("q") || "";
    const pageResult = await queryAccountsPage(ctx.supabase, ACCOUNTS, {
      companyId,
      uploadId: upload.id,
      page,
      pageSize,
      query: q,
    });

    return NextResponse.json({
      accounts: pageResult.rows.map(publicAccount),
      upload: publicUpload(upload),
      source: "api",
      pagination: {
        total: pageResult.total,
        page: pageResult.page,
        pageSize: pageResult.pageSize,
        pageCount: pageResult.pageCount,
        // Rozetler: gerçek plan sayıları (sayfa/arama kesiti değil)
        activeCount: planCounts.activeCount,
        inactiveCount: planCounts.inactiveCount,
        planTotal: planCounts.total,
        planActiveCount: planCounts.activeCount,
        planInactiveCount: planCounts.inactiveCount,
        filteredTotal: pageResult.total,
      },
    });
  } catch (error) {
    if (isMissingRelation(error)) return schemaMissingResponse();
    return NextResponse.json(
      { error: error?.message || "Hesap planı okunamadı." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const mgmt = await requireManagementApi("account-plans:post", UPLOADS);
  if (mgmt.error) return mgmt.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const companyId = resolveCompanyId(body);
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunlu." }, { status: 400 });
  }
  const accessCheck = assertCompanyAccess(mgmt.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const fileName = String(body.fileName || body.file_name || "")
    .replace(/[^\w.\- \u00C0-\u024F]/g, "")
    .slice(0, 180);
  const originalFileName = String(body.originalFileName || fileName || "")
    .replace(/[^\w.\- \u00C0-\u024F]/g, "")
    .slice(0, 180);
  const fileContentHash = String(body.fileContentHash || body.contentHash || "")
    .trim()
    .toLowerCase()
    .slice(0, 128);
  const rawAccounts = Array.isArray(body.accounts) ? body.accounts : [];
  const accounts = rawAccounts
    .map((row) => normalizeAccountPlanRowInput(row))
    .filter(Boolean);
  const clientErrorCount = Math.max(0, Number(body.errorCount) || 0);

  if (!accounts.length) {
    // Failed upload — do not change active version
    const { supabase, guard } = getApiSupabase("account-plans:post-fail", UPLOADS);
    if (guard) return guard;
    try {
      const { data, error } = await supabase
        .from(UPLOADS)
        .insert({
          company_id: companyId,
          file_name: fileName || "unknown.xlsx",
          content_fingerprint: "",
          uploaded_by: mgmt.user?.id || "",
          uploaded_by_label: mgmt.user?.email || "",
          status: "failed",
          is_active: false,
          total_rows: 0,
          error_count: Math.max(1, clientErrorCount),
          safe_error_summary: "Geçerli hesap satırı bulunamadı.",
        })
        .select("*")
        .single();
      if (error) throw error;
      await patchUploadArchiveMeta(supabase, data.id, {
        original_file_name: originalFileName || fileName || "unknown.xlsx",
        file_content_hash: fileContentHash,
        archive_status: "none",
      });
      const refreshed = await reloadUpload(supabase, data.id);
      return NextResponse.json({
        ok: false,
        duplicate: false,
        upload: publicUpload(refreshed || data),
        message: "Yükleme başarısız; aktif sürüm değiştirilmedi.",
      });
    } catch (error) {
      if (isMissingRelation(error)) return schemaMissingResponse();
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const fingerprint =
    String(body.contentFingerprint || "").trim() ||
    (await fingerprintAccountPlanAccounts(accounts));

  const { supabase, guard } = getApiSupabase("account-plans:post", UPLOADS);
  if (guard) return guard;

  try {
    const active = await loadActiveUpload(supabase, companyId);
    if (active?.content_fingerprint && active.content_fingerprint === fingerprint) {
      const { data: dup, error: dupErr } = await supabase
        .from(UPLOADS)
        .insert({
          company_id: companyId,
          file_name: fileName || "duplicate.xlsx",
          content_fingerprint: fingerprint,
          uploaded_by: mgmt.user?.id || "",
          uploaded_by_label: mgmt.user?.email || "",
          status: "duplicate",
          is_active: false,
          total_rows: accounts.length,
          added_count: 0,
          updated_count: 0,
          skipped_count: accounts.length,
          error_count: clientErrorCount,
          safe_error_summary: "Mükerrer yükleme — yeniden işlenmedi",
        })
        .select("*")
        .single();
      if (dupErr) throw dupErr;
      await patchUploadArchiveMeta(supabase, dup.id, {
        original_file_name: originalFileName || fileName || "duplicate.xlsx",
        file_content_hash: fileContentHash,
        archive_status: fileContentHash ? "duplicate_archived" : "none",
      });
      const refreshedDup = await reloadUpload(supabase, dup.id);
      return NextResponse.json({
        ok: true,
        duplicate: true,
        upload: publicUpload(refreshedDup || dup),
        message: "Mükerrer yükleme — yeniden işlenmedi",
        accounts: [],
      });
    }

    let previousAccounts = [];
    if (active?.id) {
      previousAccounts = await loadAccountsForUpload(supabase, companyId, active.id);
    }
    const diff = diffAccountPlanVersions(
      previousAccounts.map(publicAccount),
      accounts
    );

    // Insert as pending first — only activate after accounts inserted
    const { data: uploadRow, error: uploadErr } = await supabase
      .from(UPLOADS)
      .insert({
        company_id: companyId,
        file_name: fileName || "plan.xlsx",
        content_fingerprint: fingerprint,
        uploaded_by: mgmt.user?.id || "",
        uploaded_by_label: mgmt.user?.email || "",
        status: "pending",
        is_active: false,
        total_rows: accounts.length,
        added_count: diff.addedCount,
        updated_count: diff.updatedCount,
        skipped_count: diff.skippedCount,
        error_count: clientErrorCount,
      })
      .select("*")
      .single();
    if (uploadErr) throw uploadErr;

    await patchUploadArchiveMeta(supabase, uploadRow.id, {
      original_file_name: originalFileName || fileName || "plan.xlsx",
      file_content_hash: fileContentHash,
      archive_status: "none",
    });

    const accountRows = accounts.map((a) => ({
      company_id: companyId,
      upload_id: uploadRow.id,
      account_code: a.accountCode,
      account_name: a.accountName,
      currency: a.currency || "TL",
      is_active: a.isActive !== false,
    }));

    // Chunk insert
    const chunkSize = 500;
    for (let i = 0; i < accountRows.length; i += chunkSize) {
      const chunk = accountRows.slice(i, i + chunkSize);
      const { error: accErr } = await supabase.from(ACCOUNTS).insert(chunk);
      if (accErr) {
        await supabase
          .from(UPLOADS)
          .update({
            status: "failed",
            is_active: false,
            safe_error_summary: "Hesap satırları kaydedilemedi; aktif sürüm korundu.",
          })
          .eq("id", uploadRow.id);
        throw accErr;
      }
    }

    if (active?.id) {
      await supabase
        .from(UPLOADS)
        .update({ is_active: false, status: "superseded" })
        .eq("id", active.id)
        .eq("company_id", companyId);
    }

    const { data: activated, error: actErr } = await supabase
      .from(UPLOADS)
      .update({
        is_active: true,
        status: "active",
        activated_at: new Date().toISOString(),
      })
      .eq("id", uploadRow.id)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (actErr) throw actErr;

    // Drive arşivi ayrı adım; başarısız olursa archive_pending — aktif plan bozulmaz
    await patchUploadArchiveMeta(supabase, activated.id, {
      archive_status: "archive_pending",
    });
    const refreshed = await reloadUpload(supabase, activated.id);

    return NextResponse.json({
      ok: true,
      duplicate: false,
      upload: publicUpload(refreshed || activated),
      message: "Hesap planı yüklendi.",
      stats: diff,
    });
  } catch (error) {
    if (isMissingRelation(error)) return schemaMissingResponse();
    return NextResponse.json(
      { error: error?.message || "Yükleme başarısız." },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  const mgmt = await requireManagementApi("account-plans:patch", ACCOUNTS);
  if (mgmt.error) return mgmt.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const companyId = resolveCompanyId(body);
  const accountId = String(body.accountId || body.id || "");
  if (!companyId || !accountId) {
    return NextResponse.json(
      { error: "companyId ve accountId zorunlu." },
      { status: 400 }
    );
  }
  const accessCheck = assertCompanyAccess(mgmt.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const { supabase, guard } = getApiSupabase("account-plans:patch", ACCOUNTS);
  if (guard) return guard;

  try {
    if (body.delete === true) {
      const { error } = await supabase
        .from(ACCOUNTS)
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: mgmt.user?.id || "",
        })
        .eq("id", accountId)
        .eq("company_id", companyId)
        .is("deleted_at", null);
      if (error) throw error;
      return NextResponse.json({ ok: true, deleted: true });
    }

    if (typeof body.isActive === "boolean") {
      const { data, error } = await supabase
        .from(ACCOUNTS)
        .update({ is_active: body.isActive })
        .eq("id", accountId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "Hesap bulunamadı." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, account: publicAccount(data) });
    }

    return NextResponse.json({ error: "Güncelleme alanı yok." }, { status: 400 });
  } catch (error) {
    if (isMissingRelation(error)) return schemaMissingResponse();
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
