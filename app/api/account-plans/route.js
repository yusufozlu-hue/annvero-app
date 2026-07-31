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
  paginateAccountPlanRows,
} from "@/src/utils/accountPlanUpload";

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
    contentFingerprint: row.content_fingerprint,
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
  const { data, error } = await supabase
    .from(ACCOUNTS)
    .select("id, company_id, upload_id, account_code, account_name, currency, is_active")
    .eq("company_id", companyId)
    .eq("upload_id", uploadId)
    .is("deleted_at", null)
    .order("account_code", { ascending: true });
  if (error) throw error;
  return data || [];
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
        },
      });
    }

    const rows = await loadAccountsForUpload(ctx.supabase, companyId, upload.id);
    const mapped = rows.map(publicAccount);
    const wantAll = request.nextUrl.searchParams.get("all") === "1";
    if (wantAll) {
      return NextResponse.json({
        accounts: mapped,
        upload: publicUpload(upload),
        source: "api",
        pagination: {
          total: mapped.length,
          page: 1,
          pageSize: mapped.length || 1,
          pageCount: 1,
          activeCount: mapped.filter((r) => r.isActive !== false).length,
          inactiveCount: mapped.filter((r) => r.isActive === false).length,
        },
      });
    }

    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") || 50);
    const q = request.nextUrl.searchParams.get("q") || "";
    const pagination = paginateAccountPlanRows(mapped, { page, pageSize, query: q });

    return NextResponse.json({
      accounts: pagination.rows,
      upload: publicUpload(upload),
      source: "api",
      pagination: {
        total: pagination.total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        pageCount: pagination.pageCount,
        activeCount: pagination.activeCount,
        inactiveCount: pagination.inactiveCount,
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
      return NextResponse.json({
        ok: false,
        duplicate: false,
        upload: publicUpload(data),
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
      return NextResponse.json({
        ok: true,
        duplicate: true,
        upload: publicUpload(dup),
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

    return NextResponse.json({
      ok: true,
      duplicate: false,
      upload: publicUpload(activated),
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
