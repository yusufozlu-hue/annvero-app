/**
 * Normalize tahakkuk localStorage + hash mükerrer + kontrollü kuyruk.
 * Ağır OCR yok; belge bir kez parse → sakla.
 */
import { buildObligationAccrual } from "./normalize.js";

export const OBLIGATION_ACCRUALS_STORAGE_KEY = "annvero_obligation_accruals_v1";
export const OBLIGATION_QUEUE_STORAGE_KEY = "annvero_obligation_parse_queue_v1";

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function loadObligationAccruals() {
  if (typeof window === "undefined") return [];
  return safeParse(
    window.localStorage.getItem(OBLIGATION_ACCRUALS_STORAGE_KEY) || "[]",
    []
  );
}

export function saveObligationAccruals(records = []) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    OBLIGATION_ACCRUALS_STORAGE_KEY,
    JSON.stringify(records)
  );
}

export function findAccrualByFileHash(records = [], hash = "", companyId = "") {
  const h = String(hash || "").trim().toLowerCase();
  if (!h) return null;
  const cid = String(companyId || "").trim();
  return (
    (records || []).find((r) => {
      if (String(r.source_file_hash || "").toLowerCase() !== h) return false;
      // Aynı hash yalnız aynı firma içinde mükerrer
      if (cid && String(r.company_id || "").trim() !== cid) return false;
      return true;
    }) || null
  );
}

/**
 * Aynı belgeyi (hash) yeniden işleme — mevcut kaydı döner.
 * Mükerrer = aynı company_id + aynı source_file_hash.
 */
export function upsertObligationAccrual(records = [], accrualInput = {}) {
  const accrual = buildObligationAccrual(accrualInput);
  const list = [...(records || [])];

  if (accrual.source_file_hash) {
    const dup = findAccrualByFileHash(
      list,
      accrual.source_file_hash,
      accrual.company_id
    );
    if (dup) {
      return {
        records: list,
        accrual: dup,
        duplicate: true,
        created: false,
      };
    }
  }

  // Aynı zincir anahtarı + aynı document: güncelle (silme/kör iptal yok)
  const existingIdx = list.findIndex((r) => r.chain_key === accrual.chain_key);
  if (existingIdx >= 0) {
    const prev = list[existingIdx];
    const merged = {
      ...accrual,
      id: prev.id,
      created_at: prev.created_at,
      updated_at: new Date().toISOString(),
    };
    list[existingIdx] = merged;
    return { records: list, accrual: merged, duplicate: false, created: false };
  }

  list.push(accrual);
  return { records: list, accrual, duplicate: false, created: true };
}

export function loadParseQueue() {
  if (typeof window === "undefined") return [];
  return safeParse(
    window.localStorage.getItem(OBLIGATION_QUEUE_STORAGE_KEY) || "[]",
    []
  );
}

export function saveParseQueue(jobs = []) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    OBLIGATION_QUEUE_STORAGE_KEY,
    JSON.stringify(jobs)
  );
}

export function enqueueParseJobs(existing = [], files = [], { companyId = "" } = {}) {
  const jobs = [...(existing || [])];
  for (const file of files || []) {
    jobs.push({
      id: `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      companyId,
      fileName: file.name || file.fileName || "",
      fileSize: Number(file.size || file.fileSize || 0),
      source_provider: file.source_provider || "upload",
      status: "queued",
      progress: 0,
      error: "",
      accrualId: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return jobs;
}

export function updateParseJob(jobs = [], jobId, patch = {}) {
  return (jobs || []).map((j) =>
    j.id === jobId
      ? { ...j, ...patch, updatedAt: new Date().toISOString() }
      : j
  );
}

/**
 * Basit SHA-256 (Web Crypto) — Node testlerinde fallback.
 */
export async function hashFileBytes(bytes) {
  if (typeof crypto !== "undefined" && crypto.subtle && bytes) {
    const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Node / fallback — hafif hash
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let h = 2166136261;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i];
    h = Math.imul(h, 16777619);
  }
  return `fnv1a-${(h >>> 0).toString(16)}-len${arr.length}`;
}

export function hashUtf8String(text = "") {
  const str = String(text || "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a-${(h >>> 0).toString(16)}-len${str.length}`;
}
