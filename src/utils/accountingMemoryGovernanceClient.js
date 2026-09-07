/**
 * Client helper — accounting memory governance API.
 * UI doğrudan Supabase yazmaz.
 */

async function readError(response) {
  try {
    const payload = await response.json();
    return payload?.error || payload?.code || response.statusText || "İşlem başarısız";
  } catch {
    return response.statusText || "İşlem başarısız";
  }
}

export async function fetchAccountingMemoryGovernance(companyId) {
  const id = String(companyId || "").trim();
  if (!id) {
    return { ok: false, error: "Firma seçilmedi.", tabs: null, records: [] };
  }
  try {
    const response = await fetch(
      `/api/accounting-memory-governance?companyId=${encodeURIComponent(id)}`,
      { cache: "no-store", credentials: "include" }
    );
    if (!response.ok) {
      return { ok: false, error: await readError(response), tabs: null, records: [] };
    }
    const payload = await response.json();
    return {
      ok: true,
      error: null,
      companyId: payload.companyId,
      records: payload.records || [],
      tabs: payload.tabs || { active: [], review: [], history: [] },
      stats: payload.stats || {},
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "Listeleme başarısız",
      tabs: null,
      records: [],
    };
  }
}

async function postGovernanceAction(body) {
  try {
    const response = await fetch("/api/accounting-memory-governance", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        code: payload?.code || "",
        error: payload?.error || (await readError(response)),
        requiresReview: Boolean(payload?.requiresReview),
        currentRevision: payload?.currentRevision,
      };
    }
    return { ok: true, ...payload };
  } catch (err) {
    return { ok: false, error: err?.message || "İstek başarısız" };
  }
}

export function deactivateAccountingMemoryRecord(opts = {}) {
  return postGovernanceAction({
    action: "deactivate",
    companyId: opts.companyId,
    memoryId: opts.memoryId,
    expectedRevision: opts.expectedRevision,
  });
}

export function reactivateAccountingMemoryRecord(opts = {}) {
  return postGovernanceAction({
    action: "reactivate",
    companyId: opts.companyId,
    memoryId: opts.memoryId,
    expectedRevision: opts.expectedRevision,
  });
}

export function resolveAccountingMemoryConflict(opts = {}) {
  return postGovernanceAction({
    action: "resolve_conflict",
    companyId: opts.companyId,
    memoryId: opts.memoryId,
    expectedRevision: opts.expectedRevision,
  });
}

export function rollbackAccountingMemoryRecord(opts = {}) {
  return postGovernanceAction({
    action: "rollback",
    companyId: opts.companyId,
    memoryId: opts.memoryId,
    expectedRevision: opts.expectedRevision,
  });
}

export function reviseAccountingMemoryRecord(opts = {}) {
  return postGovernanceAction({
    action: "revise",
    companyId: opts.companyId,
    memoryId: opts.memoryId,
    expectedRevision: opts.expectedRevision,
    accountCode: opts.accountCode,
    reasonCode: opts.reasonCode,
  });
}

export function formatGovernanceMutationError(result = {}) {
  const code = String(result?.code || "");
  if (code === "REVISION_CONFLICT") {
    return "Kayıt başka bir işlemle değişmiş (sürüm çakışması). Liste yenileniyor; lütfen tekrar deneyin.";
  }
  if (code === "MIGRATION_REQUIRED") {
    return (
      result.error ||
      "Governance mutasyonu henüz desteklenmiyor (migration 037 gerekli). Kayıt değiştirilmedi."
    );
  }
  if (code === "NOT_FOUND") {
    return "Kayıt bulunamadı.";
  }
  return result?.error || "İşlem başarısız; aktif kayıt korundu.";
}
