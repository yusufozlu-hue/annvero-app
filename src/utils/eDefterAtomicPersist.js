/**
 * E-Defter run+findings+audit atomik persist sözleşmesi.
 * Gerçek DB yazımı API → service_role RPC ile yapılır.
 * Bu modül: legacy FAIL kanıtı, idempotency anahtarı, güvenli hata metni, RPC çağrı sarmalayıcı.
 */

export const EDEFTER_ATOMIC_PERSIST_RPC = "edefter_persist_control_run_atomic";

export const EDEFTER_ATOMIC_PERSIST_UI_ERROR =
  "Kontrol sonucu kaydedilemedi. Hiçbir kısmi kayıt oluşturulmadı; yeniden deneyebilirsiniz.";

/**
 * Deterministik idempotency anahtarı — ham dosya adı/PII içermez.
 * companyId + period + source fingerprint + engineVersion (+ opsiyonel result fingerprint).
 */
export function buildEdefterPersistIdempotencyKey({
  companyId = "",
  period = "",
  sourceFingerprint = "",
  engineVersion = "",
  resultFingerprint = "",
} = {}) {
  return [
    String(companyId || "").slice(0, 120),
    String(period || "").slice(0, 32),
    String(sourceFingerprint || "").slice(0, 128),
    String(engineVersion || "").slice(0, 40),
    String(resultFingerprint || "").slice(0, 128),
  ].join("|");
}

/**
 * LEGACY (pre-atomic) çok adımlı persist — yalnız test/FAIL kanıtı.
 * Transaction yok: findings fail olsa bile run satırı store'da kalır.
 */
export function legacyMultiStepPersistSpy({
  run,
  findings = [],
  failAt = null, // null | "run" | "finding" | "finding:1" | "audit"
  audit = true,
} = {}) {
  const store = { runs: [], findings: [], audits: [] };
  const counters = {
    runInsert: 0,
    findingInsert: 0,
    auditInsert: 0,
    rpcCalls: 0,
  };

  try {
    counters.runInsert += 1;
    if (failAt === "run") {
      const err = new Error("LEGACY_RUN_INSERT_FAIL");
      err.code = "LEGACY_RUN_INSERT_FAIL";
      throw err;
    }
    const runRow = {
      id: `run-${store.runs.length + 1}`,
      ...run,
      status: run.status || "completed",
      created: true,
    };
    store.runs.push(runRow);

    for (let i = 0; i < findings.length; i += 1) {
      counters.findingInsert += 1;
      if (failAt === "finding" || failAt === `finding:${i}`) {
        const err = new Error("LEGACY_FINDING_INSERT_FAIL");
        err.code = "LEGACY_FINDING_INSERT_FAIL";
        throw err;
      }
      store.findings.push({
        id: `f-${store.findings.length + 1}`,
        run_id: runRow.id,
        company_id: run.company_id,
        ...findings[i],
      });
    }

    if (audit) {
      counters.auditInsert += 1;
      if (failAt === "audit") {
        const err = new Error("LEGACY_AUDIT_INSERT_FAIL");
        err.code = "LEGACY_AUDIT_INSERT_FAIL";
        throw err;
      }
      store.audits.push({
        id: `a-${store.audits.length + 1}`,
        run_id: runRow.id,
        company_id: run.company_id,
        event_type: "run_created",
      });
    }

    return {
      ok: true,
      created: true,
      httpStatus: 200,
      store,
      counters,
      leftoverRun: true,
    };
  } catch (error) {
    // Eski davranış: rollback yok — run satırı store'da kalır
    return {
      ok: false,
      created: store.runs.length > 0, // eski kısmi başarı riski
      httpStatus: 500,
      error,
      store,
      counters,
      leftoverRun: store.runs.length > 0,
      leftoverFindings: store.findings.length,
      leftoverAudits: store.audits.length,
    };
  }
}

/**
 * Atomik in-memory transaction simülatörü — test matrisi A–F.
 * Herhangi bir adım fail → tam rollback (0/0/0).
 */
export function simulateAtomicPersistTransaction({
  store = null,
  run,
  findings = [],
  failAt = null,
  actorId = "actor-test",
  retry = false,
} = {}) {
  const db = store || { runs: [], findings: [], audits: [] };
  const counters = {
    runInsert: 0,
    findingInsert: 0,
    auditInsert: 0,
    rpcCalls: 1,
    rollbacks: 0,
  };

  const snapshot = {
    runs: db.runs.length,
    findings: db.findings.length,
    audits: db.audits.length,
  };

  const rollback = () => {
    counters.rollbacks += 1;
    db.runs.length = snapshot.runs;
    db.findings.length = snapshot.findings;
    db.audits.length = snapshot.audits;
  };

  try {
    const existing = db.runs.find(
      (r) =>
        r.company_id === run.company_id &&
        r.source_fingerprint === run.source_fingerprint &&
        r.engine_version === run.engine_version &&
        r.status === "completed" &&
        !r.deleted_at
    );
    if (existing) {
      counters.auditInsert += 1;
      db.audits.push({
        id: `a-${db.audits.length + 1}`,
        run_id: existing.id,
        company_id: run.company_id,
        event_type: retry ? "save_retry" : "run_idempotent_hit",
      });
      return {
        ok: true,
        created: false,
        reused: true,
        idempotent: true,
        runId: existing.id,
        findingCount: db.findings.filter((f) => f.run_id === existing.id).length,
        counters,
        store: db,
      };
    }

    if (failAt === "run") {
      const err = new Error("ATOMIC_RUN_FAIL");
      err.code = "ATOMIC_RUN_FAIL";
      throw err;
    }

    counters.runInsert += 1;
    const runRow = {
      id: `run-${db.runs.length + 1}-${Math.random().toString(16).slice(2, 8)}`,
      ...run,
      status: "completed",
      created_by: actorId,
      deleted_at: null,
    };
    db.runs.push(runRow);

    for (let i = 0; i < findings.length; i += 1) {
      if (failAt === "finding" || failAt === `finding:${i}`) {
        const err = new Error("ATOMIC_FINDING_FAIL");
        err.code = "ATOMIC_FINDING_FAIL";
        throw err;
      }
      counters.findingInsert += 1;
      db.findings.push({
        id: `f-${db.findings.length + 1}`,
        run_id: runRow.id,
        company_id: run.company_id,
        ...findings[i],
      });
    }

    if (failAt === "audit") {
      const err = new Error("ATOMIC_AUDIT_FAIL");
      err.code = "ATOMIC_AUDIT_FAIL";
      throw err;
    }
    counters.auditInsert += 1;
    db.audits.push({
      id: `a-${db.audits.length + 1}`,
      run_id: runRow.id,
      company_id: run.company_id,
      event_type: "run_created",
      actor_id: actorId,
      safe_metadata: { atomic: true },
    });

    return {
      ok: true,
      created: true,
      reused: false,
      idempotent: false,
      runId: runRow.id,
      findingCount: findings.length,
      counters,
      store: db,
    };
  } catch (error) {
    rollback();
    return {
      ok: false,
      created: false,
      reused: false,
      error,
      counters,
      store: db,
      leftoverRun: false,
      leftoverFindings: 0,
      leftoverAudits: 0,
    };
  }
}

/**
 * service_role supabase.rpc çağrısı.
 * Ham SQL mesajı UI'ya iletilmez — çağıran güvenli mesaj kullanır.
 */
export async function callEdefterAtomicPersistRpc(supabase, {
  run,
  findings = [],
  actorId = "",
  retry = false,
} = {}) {
  if (!supabase || typeof supabase.rpc !== "function") {
    const err = new Error(EDEFTER_ATOMIC_PERSIST_UI_ERROR);
    err.code = "ATOMIC_RPC_UNAVAILABLE";
    err.httpStatus = 500;
    throw err;
  }

  const { data, error } = await supabase.rpc(EDEFTER_ATOMIC_PERSIST_RPC, {
    p_run: run,
    p_findings: findings,
    p_actor_id: String(actorId || ""),
    p_retry: Boolean(retry),
  });

  if (error) {
    const err = new Error(EDEFTER_ATOMIC_PERSIST_UI_ERROR);
    err.code = "ATOMIC_PERSIST_FAILED";
    err.httpStatus = 500;
    err.safeDetail = String(error.code || "rpc_error").slice(0, 40);
    throw err;
  }

  const result = data && typeof data === "object" ? data : {};
  if (result.ok === false) {
    const err = new Error(EDEFTER_ATOMIC_PERSIST_UI_ERROR);
    err.code = "ATOMIC_PERSIST_DENIED";
    err.httpStatus = 500;
    throw err;
  }

  return {
    ok: true,
    created: Boolean(result.created),
    reused: Boolean(result.reused || result.idempotent),
    idempotent: Boolean(result.idempotent || result.reused),
    runId: result.run_id || "",
    revision: Number(result.revision || 1) || 1,
    findingCount: Number(result.finding_count || 0) || 0,
    status: result.status || "completed",
    raw: result,
  };
}

/** Set-based finding payload boyutu / süre ölçümü (anonim). */
export function measureFindingsPayload(findingsCount = 0) {
  const findings = Array.from({ length: findingsCount }, (_, i) => ({
    code: `SYNTH_${i % 17}`,
    severity: i % 5 === 0 ? "critical" : "warning",
    category: "TEST",
    safe_reference: `ref-${i}`,
    summary: `anon finding ${i}`,
    occurrence_count: 1,
    resolution_status: "open",
  }));
  const started = Date.now();
  const json = JSON.stringify(findings);
  const ms = Date.now() - started;
  return {
    count: findingsCount,
    bytes: Buffer.byteLength(json, "utf8"),
    stringifyMs: ms,
  };
}
