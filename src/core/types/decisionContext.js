/**
 * CORE karar bağlamı — kullanıcı ve modül context doğrulama.
 */

function empty(value) {
  return value == null ? "" : String(value).trim();
}

export function normalizeCoreContext(raw = {}) {
  return {
    user_id: empty(raw.user_id || raw.userId),
    user_role: empty(raw.user_role || raw.userRole),
    company_access: Array.isArray(raw.company_access || raw.companyAccess)
      ? raw.company_access || raw.companyAccess
      : [],
    module: empty(raw.module),
    request_id: empty(raw.request_id || raw.requestId),
    // Server-only: API route service_role client (JSON'a serialize edilmez)
    supabase: raw.supabase || null,
  };
}

/**
 * @returns {{ ok: boolean, value?: object, error?: string }}
 */
export function validateCoreContext(raw = {}) {
  const value = normalizeCoreContext(raw);

  if (!value.user_id) {
    return { ok: false, error: "user_id zorunludur (server context)." };
  }

  if (!value.module) {
    return { ok: false, error: "module zorunludur." };
  }

  return { ok: true, value };
}

/**
 * Firma erişim kontrolü — API katmanı company_id doğruladıktan sonra çağrılır.
 */
export function assertCompanyAccessInContext(companyId, context = {}) {
  const ids = context.company_access || [];
  if (!ids.length || ids.includes("*")) return true;
  return ids.includes(companyId);
}
