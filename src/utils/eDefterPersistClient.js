/**
 * E-Defter kalıcı kayıt istemci yardımcıları.
 * localStorage yalnız geçici UI cache; denetim kaynağı sunucudur.
 */

import {
  E_DEFTER_ENGINE_VERSION,
  E_DEFTER_FINGERPRINT_STORAGE_KEY,
  E_DEFTER_RECORDS_STORAGE_KEY,
} from "@/src/config/eDefterKontrolDefaults";
import {
  assertNoRawDocumentLeak,
  buildSafeEdefterPersistPayload,
} from "@/src/utils/eDefterPersistSafe";

export { E_DEFTER_ENGINE_VERSION };

const LEGACY_RESULT_KEYS = [
  E_DEFTER_RECORDS_STORAGE_KEY,
  "annvero_edefter_kontrol_records",
  "annvero_edefter_kontrol_result_v1",
  "annvero_edefter_kontrol_results_v1",
  "annvero_edefter_last_result_v1",
  "annvero_edefter_history_v1",
];

export function clearEDefterLegacyLocalStorage() {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_RESULT_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export function clearEDefterUiCaches() {
  clearEDefterLegacyLocalStorage();
  if (typeof window === "undefined") return;
  try {
    // Fingerprint oturumu firma değişiminde de temizlenir (karışıklık önlemi)
    window.sessionStorage.removeItem(E_DEFTER_FINGERPRINT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function parseJsonResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return body;
}

export async function saveEDefterControlRun(payload) {
  assertNoRawDocumentLeak(payload);
  const response = await fetch("/api/edefter-control/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(body?.error || "Kontrol sonucu kaydedilemedi.");
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function listEDefterControlRuns({
  companyId,
  period = "",
  status = "",
  risk = "",
} = {}) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  if (period) params.set("period", period);
  if (status) params.set("status", status);
  if (risk) params.set("risk", risk);
  const response = await fetch(`/api/edefter-control/runs?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(body?.error || "Kontrol geçmişi alınamadı.");
    err.status = response.status;
    throw err;
  }
  return body?.data || [];
}

export async function getEDefterControlRun(runId, companyId) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  const response = await fetch(
    `/api/edefter-control/runs/${encodeURIComponent(runId)}?${params.toString()}`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(body?.error || "Kontrol detayı alınamadı.");
    err.status = response.status;
    throw err;
  }
  return body;
}

export async function updateEDefterFindingResolution({
  findingId,
  companyId,
  resolutionStatus,
} = {}) {
  const response = await fetch(
    `/api/edefter-control/findings/${encodeURIComponent(findingId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        company_id: companyId,
        resolution_status: resolutionStatus,
      }),
    }
  );
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(body?.error || "Bulgu durumu güncellenemedi.");
    err.status = response.status;
    throw err;
  }
  return body?.data;
}

/**
 * Analiz sonucundan güvenli kayıt gövdesi üret + kaydet.
 */
export function buildPersistPayloadFromAnalysis(input = {}) {
  return buildSafeEdefterPersistPayload({
    ...input,
    engineVersion: input.engineVersion || E_DEFTER_ENGINE_VERSION,
  });
}
