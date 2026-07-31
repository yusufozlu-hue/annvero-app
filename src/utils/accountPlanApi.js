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
  accounts,
  contentFingerprint,
  errorCount = 0,
}) {
  const response = await fetch("/api/account-plans", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      fileName,
      accounts,
      contentFingerprint,
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
