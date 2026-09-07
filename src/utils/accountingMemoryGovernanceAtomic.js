/**
 * Faz 7 — Atomik governance mutation (DB RPC + test transaction simulator).
 */
import {
  MEMORY_GOVERNANCE_REASON,
  __listGovernanceTestAudits,
  __listGovernanceTestRecords,
  __snapshotGovernanceTestState,
  __restoreGovernanceTestState,
  assertAuditHasNoPii,
  deactivateGovernanceRecord,
  reactivateGovernanceRecord,
  resolveGovernanceConflict,
  reviseGovernanceRecord,
  rollbackGovernanceRecord,
} from "@/src/utils/accountingMemoryGovernance";

function textId(value) {
  return value == null ? "" : String(value).trim();
}

export async function runAtomicGovernanceMutationTx({
  action = "",
  companyId = "",
  memoryId = "",
  expectedRevision = null,
  actorId = "",
  payload = {},
  forceAuditFail = false,
  forceInsertFail = false,
} = {}) {
  const snapshot = __snapshotGovernanceTestState();

  try {
    if (forceInsertFail && (action === "rollback" || action === "revise")) {
      __restoreGovernanceTestState(snapshot);
      return { ok: false, code: "INSERT_FAILED", rolledBack: true };
    }

    let result;
    if (action === "deactivate") {
      result = await deactivateGovernanceRecord({
        memoryId,
        companyId,
        expectedRevision,
        actorId,
        reasonCode: payload.reasonCode || MEMORY_GOVERNANCE_REASON.USER_DEACTIVATE,
      });
    } else if (action === "reactivate") {
      result = await reactivateGovernanceRecord({
        memoryId,
        companyId,
        expectedRevision,
        actorId,
      });
    } else if (action === "resolve_conflict") {
      const rec = __listGovernanceTestRecords().find(
        (r) => r.memoryId === textId(memoryId)
      );
      result = await resolveGovernanceConflict({
        companyId,
        signature: rec?.signature || "",
        lucaLeg: rec?.lucaLeg || "",
        chosenMemoryId: memoryId,
        expectedRevision,
        actorId,
      });
    } else if (action === "revise") {
      result = await reviseGovernanceRecord({
        memoryId,
        companyId,
        expectedRevision,
        actorId,
        nextAccountCode: payload.accountCode || "",
      });
    } else if (action === "rollback") {
      result = await rollbackGovernanceRecord({
        targetMemoryId: memoryId,
        companyId,
        expectedRevision,
        actorId,
      });
    } else {
      return { ok: false, code: "UNKNOWN_ACTION" };
    }

    if (!result?.ok) {
      return result;
    }

    if (forceAuditFail) {
      __restoreGovernanceTestState(snapshot);
      return {
        ok: false,
        code: "AUDIT_FAILED",
        rolledBack: true,
        message: "Audit yazılamadı; mutation geri alındı.",
      };
    }

    if (result.audit && !assertAuditHasNoPii(result.audit)) {
      __restoreGovernanceTestState(snapshot);
      return { ok: false, code: "AUDIT_PII", rolledBack: true };
    }

    return { ...result, atomic: true, auditCount: __listGovernanceTestAudits().length };
  } catch (err) {
    __restoreGovernanceTestState(snapshot);
    return {
      ok: false,
      code: "TX_FAILED",
      rolledBack: true,
      error: err?.message || String(err),
    };
  }
}

export async function invokeLearningMemoryGovernanceRpc(supabase, args = {}) {
  if (!supabase?.rpc) {
    return {
      ok: false,
      code: "MIGRATION_REQUIRED",
      error:
        "Governance RPC yok. Migration 037 henüz uygulanmamış olabilir; kayıt değiştirilmedi.",
    };
  }
  const { data, error } = await supabase.rpc("learning_memory_governance_mutate", {
    p_action: args.action,
    p_company_id: args.companyId,
    p_memory_id: args.memoryId,
    p_expected_revision: args.expectedRevision,
    p_actor_id: args.actorId || "",
    p_payload: args.payload || {},
  });
  if (error) {
    const msg = String(error.message || error);
    if (/function .* does not exist|schema cache|Could not find the function/i.test(msg)) {
      return {
        ok: false,
        code: "MIGRATION_REQUIRED",
        error:
          "Governance mutasyonu desteklenmiyor (migration 037 gerekli). Kayıt değiştirilmedi.",
      };
    }
    return { ok: false, code: "RPC_ERROR", error: msg };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, code: "RPC_EMPTY" };
  }
  return data;
}

export function runMigration037Preflight(rows = []) {
  let next = rows.map((r) => ({ ...r }));
  let changed = false;
  const hardDeletes = 0;

  const inferLeg = (code) => {
    const c = String(code || "").trim();
    if (!c) return null;
    if (/^102([.]|$)/.test(c)) return "statement";
    if (/^[1-9]/.test(c)) return "counter";
    return null;
  };

  next = next.map((r) => {
    if (r.document_type !== "BANK_STATEMENT_ACCOUNTING") return r;
    if (r.luca_leg || r.deleted_at) return r;
    const leg = inferLeg(r.account_code);
    if (!leg) return r;
    changed = true;
    return { ...r, luca_leg: leg };
  });

  next = next.map((r) => {
    if (r.document_type !== "BANK_STATEMENT_ACCOUNTING") return r;
    if (r.status !== "active" || r.is_active === false || r.deleted_at) return r;
    if (r.luca_leg) return r;
    changed = true;
    return {
      ...r,
      status: "review",
      is_active: false,
      reason_code: "migration_037_ambiguous_leg",
      governance_ready: true,
    };
  });

  // Scan ALL actives regardless of governance_ready
  const groups = new Map();
  for (const r of next) {
    if (r.status !== "active" || r.is_active === false || r.deleted_at) continue;
    const key = [r.company_id, r.keyword, r.luca_leg || "", r.account_code].join("\u0001");
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) =>
      String(b.updated_at || "").localeCompare(String(a.updated_at || ""))
    );
    for (let i = 1; i < list.length; i += 1) {
      changed = true;
      const id = list[i].id;
      next = next.map((r) =>
        r.id === id
          ? {
              ...r,
              status: "superseded",
              is_active: false,
              reason_code: "migration_037_duplicate_same_account",
              governance_ready: true,
            }
          : r
      );
    }
  }

  const conflictKeys = new Map();
  for (const r of next) {
    if (r.status !== "active" || r.is_active === false || r.deleted_at) continue;
    const key = [r.company_id, r.keyword, r.luca_leg || ""].join("\u0001");
    const set = conflictKeys.get(key) || new Set();
    set.add(r.account_code);
    conflictKeys.set(key, set);
  }
  for (const [key, codes] of conflictKeys.entries()) {
    if (codes.size <= 1) continue;
    const [companyId, keyword, leg] = key.split("\u0001");
    next = next.map((r) => {
      if (
        r.company_id === companyId &&
        r.keyword === keyword &&
        (r.luca_leg || "") === leg &&
        r.status === "active"
      ) {
        changed = true;
        return {
          ...r,
          status: "review",
          is_active: false,
          reason_code: "migration_037_preflight_conflict",
          governance_ready: true,
        };
      }
      return r;
    });
  }

  const beforeReady = next.some((r) => !r.governance_ready);
  next = next.map((r) => (r.governance_ready ? r : { ...r, governance_ready: true }));
  if (beforeReady) changed = true;

  const noActiveDupes = assertUniqueActiveInvariant(next).ok;
  const idempotent = !changed && noActiveDupes && next.every((r) => r.governance_ready);
  return { rows: next, changed, idempotent, hardDeletes };
}

export function assertUniqueActiveInvariant(rows = []) {
  const seen = new Map();
  for (const r of rows) {
    if (r.status !== "active" || r.is_active === false || r.deleted_at) continue;
    const key = `${r.company_id}|${r.keyword}|${r.luca_leg || ""}`;
    if (seen.has(key)) {
      return { ok: false, key, codes: [seen.get(key), r.account_code] };
    }
    seen.set(key, r.account_code);
  }
  return { ok: true };
}

export function canHaveTwoActivesDifferentLegs(rows = []) {
  const actives = rows.filter(
    (r) => r.status === "active" && r.is_active !== false && !r.deleted_at
  );
  const bySig = new Map();
  for (const r of actives) {
    const key = `${r.company_id}|${r.keyword}`;
    const list = bySig.get(key) || [];
    list.push(r.luca_leg || "");
    bySig.set(key, list);
  }
  for (const legs of bySig.values()) {
    if (new Set(legs).size > 1) return true;
  }
  return false;
}
