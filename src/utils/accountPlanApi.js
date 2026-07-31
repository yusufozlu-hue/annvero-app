/**
 * Hesap planı API istemcisi — kanonik aktif plan + yükleme geçmişi.
 */

function companyQuery(companyId) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  return params;
}

export async function fetchActiveAccountPlan(companyId, options = {}) {
  if (!companyId) {
    return { accounts: [], upload: null, source: "none" };
  }
  const params = companyQuery(companyId);
  if (options.q) params.set("q", options.q);
  if (options.page) params.set("page", String(options.page));
  if (options.pageSize) params.set("pageSize", String(options.pageSize));
  if (options.all) params.set("all", "1");
  const response = await fetch(`/api/account-plans?${params}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (response.status === 404 || response.status === 503) {
    return {
      accounts: [],
      upload: null,
      source: "unavailable",
      status: response.status,
    };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Hesap planı yüklenemedi.");
  }
  const body = await response.json();
  return {
    accounts: Array.isArray(body.accounts) ? body.accounts : [],
    upload: body.upload || null,
    pagination: body.pagination || null,
    source: body.source || "api",
  };
}

/**
 * Bank Parser / Eksik Hesap — tam aktif plan (1000+ satır dahil).
 * İstemci tarafında ek sayfalama gerekmez; sunucu range döngüsü yapar.
 */
export async function fetchFullActiveAccountPlan(companyId) {
  return fetchActiveAccountPlan(companyId, { all: true });
}

export async function fetchAccountPlanUploads(companyId) {
  if (!companyId) return [];
  const params = companyQuery(companyId);
  const response = await fetch(`/api/account-plans/uploads?${params}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 404 || response.status === 503) return [];
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Yükleme geçmişi alınamadı.");
  }
  const body = await response.json();
  return Array.isArray(body.data) ? body.data : [];
}

export async function uploadAccountPlan({
  companyId,
  fileName,
  originalFileName,
  accounts,
  contentFingerprint,
  fileContentHash,
  errorCount = 0,
}) {
  const response = await fetch("/api/account-plans", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      fileName,
      originalFileName: originalFileName || fileName,
      accounts,
      contentFingerprint,
      fileContentHash: fileContentHash || "",
      contentHash: fileContentHash || "",
      errorCount,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.error || "Yükleme başarısız.");
    err.code = body.code || response.status;
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * Orijinal Excel’i “01 - Hesap Planı” klasörüne arşivler.
 * Drive id/token dönmez. Başarısızlık aktif planı bozmaz.
 */
export async function archiveAccountPlanFile({ companyId, uploadId, file }) {
  if (!companyId || !uploadId || !file) {
    return { ok: false, skipped: true, code: "MISSING_INPUT" };
  }
  const form = new FormData();
  form.set("companyId", companyId);
  form.set("uploadId", uploadId);
  form.set("file", file, file.name || "hesap-plani.xlsx");
  const response = await fetch("/api/account-plans/archive", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 502) {
    return {
      ok: false,
      archiveStatus: body.archiveStatus || "archive_pending",
      code: body.code || response.status,
      message: body.message || body.error || "Arşiv başarısız.",
    };
  }
  return body;
}

export async function activateAccountPlanUpload({ companyId, uploadId }) {
  const response = await fetch("/api/account-plans/activate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId, uploadId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Sürüm etkinleştirilemedi.");
  }
  return body;
}

export async function patchAccountPlanAccount({
  companyId,
  accountId,
  isActive,
  delete: shouldDelete,
}) {
  const response = await fetch("/api/account-plans", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      accountId,
      isActive,
      delete: shouldDelete === true,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Hesap güncellenemedi.");
  }
  return body;
}
