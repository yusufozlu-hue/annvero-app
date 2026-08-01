/**
 * ANNVERO V1 — istemci API sarmalayıcıları (lease / checkpoint / persist).
 */

export async function requestV1Lease(companyId, leaseId) {
  const response = await fetch("/api/annvero-v1/jobs", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "lease",
      companyId,
      leaseId,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.message || "Lease alınamadı.");
    err.code = body.code || "LEASE_FAILED";
    err.status = response.status;
    throw err;
  }
  return body;
}

export async function releaseV1Lease(companyId, leaseId) {
  try {
    await fetch("/api/annvero-v1/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "release",
        companyId,
        leaseId,
      }),
    });
  } catch {
    /* lease release best-effort */
  }
}

export async function persistV1JobSummary({
  companyId,
  jobId,
  leaseId,
  idempotencyKey,
  summary,
  checkpointPhase = null,
  action = "persist",
  reanalyze = false,
  revisionOf = "",
  revision = null,
  supersedesJobId = "",
} = {}) {
  try {
    const response = await fetch("/api/annvero-v1/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        companyId,
        jobId,
        leaseId,
        idempotencyKey,
        summary,
        checkpointPhase,
        reanalyze: Boolean(reanalyze),
        revisionOf: revisionOf || "",
        revision,
        supersedesJobId: supersedesJobId || revisionOf || "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, ...body };
  } catch {
    return { ok: false, skipped: true, code: "PERSIST_NETWORK" };
  }
}

export async function listV1JobHistory(companyId, limit = 20) {
  const response = await fetch(
    `/api/annvero-v1/jobs?companyId=${encodeURIComponent(companyId)}&limit=${limit}`,
    { credentials: "include" }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, runs: [], lease: { active: false } };
  }
  return body;
}
