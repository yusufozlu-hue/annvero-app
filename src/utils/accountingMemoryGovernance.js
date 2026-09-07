/**
 * Faz 7 — Muhasebe hafızası governance facade.
 *
 * Hard delete yok. Revision + CAS. Tenant zorunlu.
 * UI/API bu modül üzerinden geçer; client createdBy/updatedBy güvenilmez.
 * PII (ham açıklama / IBAN / hesap no) audit ve özetlere yazılmaz.
 */

import {
  BANK_STATEMENT_ACCOUNTING_DOC,
  buildAccountingMemorySignature,
  isAccountingMemoryServerRow,
  mapServerAccountingRowToV2,
  parseAccountingMemorySignature,
  parseUserCorrectionMeta,
  resolveAccountingMemoryLucaLeg,
} from "@/src/utils/accountingMemoryV1";

export const MEMORY_GOVERNANCE_STATUS = Object.freeze({
  ACTIVE: "active",
  PASSIVE: "passive",
  SUPERSEDED: "superseded",
  REVIEW: "review",
});

export const MEMORY_GOVERNANCE_ACTION = Object.freeze({
  CREATE: "create",
  UPDATE: "update",
  DEACTIVATE: "deactivate",
  REACTIVATE: "reactivate",
  CONFLICT_RESOLVE: "conflict_resolve",
  ROLLBACK: "rollback",
});

export const MEMORY_GOVERNANCE_REASON = Object.freeze({
  USER_DEACTIVATE: "user_deactivate",
  USER_REACTIVATE: "user_reactivate",
  USER_EDIT: "user_edit",
  CONFLICT_RESOLVE: "conflict_resolve",
  ROLLBACK: "rollback",
  SUPERSEDED_BY_LEARN: "superseded_by_learn",
  CONFLICT_DETECTED: "conflict_detected",
});

const REASON_TR = Object.freeze({
  user_deactivate: "Kullanıcı kaydı pasife aldı",
  user_reactivate: "Kullanıcı kaydı yeniden etkinleştirdi",
  user_edit: "Kullanıcı hesabı veya eşleşmeyi güncelledi",
  conflict_resolve: "Çakışma kullanıcı seçimiyle çözüldü",
  rollback: "Önceki sürüme dönüldü",
  superseded_by_learn: "Yeni öğrenme ile önceki sürüm geçersiz kılındı",
  conflict_detected: "Aynı imza ve bacak için birden fazla aktif hesap",
});

const PII_AUDIT_RE =
  /\bTR\d{2}\s?\d{4}|IBAN|iban|\d{10,26}\b|hesap\s*no|account\s*number/i;

/** Test store — Node ortamında API yokken governance mantığı */
const testStore = {
  records: new Map(),
  audits: [],
  inflight: new Map(),
};

export function __resetAccountingMemoryGovernanceTestState() {
  testStore.records.clear();
  testStore.audits = [];
  testStore.inflight.clear();
}

export function __listGovernanceTestRecords() {
  return [...testStore.records.values()].map((r) => ({ ...r }));
}

export function __listGovernanceTestAudits() {
  return testStore.audits.map((a) => ({ ...a }));
}

export function __snapshotGovernanceTestState() {
  return {
    records: __listGovernanceTestRecords(),
    audits: __listGovernanceTestAudits(),
  };
}

export function __restoreGovernanceTestState(snapshot = {}) {
  testStore.records.clear();
  testStore.audits = [];
  testStore.inflight.clear();
  for (const r of snapshot.records || []) {
    testStore.records.set(r.memoryId, { ...r });
  }
  testStore.audits = (snapshot.audits || []).map((a) => ({ ...a }));
}

function textId(value) {
  return value == null ? "" : String(value).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "mem") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function reasonCodeToTurkish(reasonCode = "") {
  const key = textId(reasonCode).toLowerCase();
  return REASON_TR[key] || "Kullanıcı işlemi";
}

export function lucaLegToTurkish(leg = "") {
  const v = textId(leg).toLowerCase();
  if (v === "statement") return "Ekstre (banka) hesabı";
  if (v === "counter") return "Karşı hesap";
  return "Hesap bacağı";
}

export function statusToTurkish(status = "") {
  const v = textId(status).toLowerCase();
  if (v === "active") return "Aktif";
  if (v === "passive" || v === "disabled") return "Pasif";
  if (v === "superseded") return "Geçmiş sürüm";
  if (v === "review" || v === "conflict") return "İnceleme gerekli";
  return v || "—";
}

/**
 * Canonical view — BSA veya keyword (DK/MM/…) satırları.
 */
export function buildCanonicalGovernanceView(row = {}, { conflict = false } = {}) {
  if (!row) return null;

  // Test store / already-canonical
  if (row?.memoryId && row?.companyId && row?.accountCode && !row.company_id) {
    return sanitizeCanonicalView(row, conflict);
  }

  const companyId = textId(row.company_id || row.companyId);
  const accountCode = textId(row.account_code || row.accountCode);
  if (!companyId || !accountCode) return null;

  const docType = textId(row.document_type || row.documentType).toUpperCase();
  const kind =
    docType === BANK_STATEMENT_ACCOUNTING_DOC || isAccountingMemoryServerRow(row)
      ? "bsa"
      : "keyword";

  let lucaLeg = "";
  let signature = textId(row.keyword || "");
  let bankId = textId(row.bank_name || row.bankName || "");
  let direction = "";
  let transactionType = textId(row.transaction_type || "");
  let currency = "TRY";
  let confidence = 95;
  let source = textId(row.source_module || "LEARNING_MEMORY");
  const meta = parseUserCorrectionMeta(row);
  const revision = Math.max(1, Number(row.revision || meta.revision || 1) || 1);

  if (kind === "bsa") {
    const v2 = mapServerAccountingRowToV2(row);
    if (!v2) return null;
    lucaLeg = v2.lucaLeg || textId(row.luca_leg) || "";
    signature = v2.analysisKey?.startsWith("bsa|")
      ? v2.analysisKey
      : buildAccountingMemorySignature({
          bankId: v2.bankId,
          direction: v2.direction,
          transactionType: v2.transactionType,
          currency: v2.currency,
          descriptionFingerprint: v2.descriptionFingerprint,
          lucaLeg,
        });
    bankId = v2.bankId;
    direction = v2.direction;
    transactionType = v2.transactionType;
    currency = v2.currency;
    confidence = v2.confidence;
    source = meta.sourceModule || row.source_module || "USER_LEARNED";
  } else {
    lucaLeg = textId(row.luca_leg || meta.lucaLeg || "");
    direction = textId(meta.direction || "");
    currency = textId(meta.currency || "TRY") || "TRY";
    confidence = Number(meta.confidence) || Number(row.confidence) || 80;
  }

  let status = MEMORY_GOVERNANCE_STATUS.ACTIVE;
  const statusRaw = String(row.status || meta.status || "active").toLowerCase();
  if (
    row.is_active === false ||
    row.deleted_at ||
    statusRaw === "passive" ||
    statusRaw === "disabled" ||
    statusRaw === "deleted"
  ) {
    status = MEMORY_GOVERNANCE_STATUS.PASSIVE;
  } else if (statusRaw === "superseded") {
    status = MEMORY_GOVERNANCE_STATUS.SUPERSEDED;
  } else if (statusRaw === "review" || statusRaw === "conflict" || meta.conflict === true) {
    status = MEMORY_GOVERNANCE_STATUS.REVIEW;
  }

  if (conflict && status === MEMORY_GOVERNANCE_STATUS.ACTIVE) {
    status = MEMORY_GOVERNANCE_STATUS.REVIEW;
  }

  const usageRaw = row.usage_count ?? row.match_count;
  const lastUsedRaw = row.last_used_at || row.last_matched_at || null;

  return sanitizeCanonicalView(
    {
      memoryId: textId(row.id),
      companyId,
      kind,
      documentType: docType || (kind === "bsa" ? BANK_STATEMENT_ACCOUNTING_DOC : "DK"),
      signature,
      lucaLeg,
      accountCode,
      bankId,
      direction,
      transactionType,
      currency,
      source,
      status,
      confidence,
      revision,
      parentRevisionId: textId(
        row.parent_revision_id || meta.parentRevisionId || meta.parent_revision_id || ""
      ),
      supersedesId: textId(
        row.supersedes_id || meta.supersedesId || meta.supersedes_id || ""
      ),
      createdAt: row.learned_at || row.created_at || null,
      createdBy: null,
      updatedAt: row.updated_at || null,
      updatedBy: null,
      reasonCode: textId(row.reason_code || meta.reasonCode || meta.auditReason || ""),
      userNote: textId(meta.userNote || "").slice(0, 200),
      usageCount:
        usageRaw == null || usageRaw === "" ? null : Number(usageRaw) || 0,
      lastUsedAt: lastUsedRaw || null,
      conflictState: Boolean(conflict || status === MEMORY_GOVERNANCE_STATUS.REVIEW),
      keyword: textId(row.keyword || signature),
      governanceReady: Boolean(row.governance_ready),
    },
    conflict
  );
}

function sanitizeCanonicalView(view, conflict = false) {
  const out = {
    memoryId: textId(view.memoryId),
    companyId: textId(view.companyId),
    kind: textId(view.kind) || "bsa",
    documentType: textId(view.documentType),
    signature: textId(view.signature),
    lucaLeg: textId(view.lucaLeg),
    accountCode: textId(view.accountCode),
    bankId: textId(view.bankId),
    direction: textId(view.direction),
    transactionType: textId(view.transactionType),
    currency: textId(view.currency) || "TRY",
    source: textId(view.source) || "USER_LEARNED",
    status: textId(view.status) || MEMORY_GOVERNANCE_STATUS.ACTIVE,
    confidence: Number(view.confidence) || 0,
    revision: Math.max(1, Number(view.revision) || 1),
    parentRevisionId: textId(view.parentRevisionId) || null,
    supersedesId: textId(view.supersedesId) || null,
    createdAt: view.createdAt || null,
    createdBy: view.createdBy || null,
    updatedAt: view.updatedAt || null,
    updatedBy: view.updatedBy || null,
    reasonCode: textId(view.reasonCode),
    userNote: textId(view.userNote).slice(0, 200),
    usageCount: view.usageCount == null ? null : Number(view.usageCount) || 0,
    lastUsedAt: view.lastUsedAt || null,
    conflictState: Boolean(conflict || view.conflictState),
    keyword: textId(view.keyword),
    governanceReady: Boolean(view.governanceReady),
  };
  return out;
}

/** UI satırı — signature/hash yok */
export function toGovernanceUiRow(view) {
  if (!view) return null;
  return {
    memoryId: view.memoryId,
    companyId: view.companyId,
    kind: view.kind || "bsa",
    documentType: view.documentType,
    bankId: view.bankId || "—",
    lucaLeg: view.lucaLeg,
    lucaLegLabel:
      view.kind === "keyword"
        ? "Anahtar kelime"
        : lucaLegToTurkish(view.lucaLeg),
    accountCode: view.accountCode,
    direction: view.direction || "—",
    transactionType: view.transactionType || "—",
    currency: view.currency || "TRY",
    status: view.status,
    statusLabel: statusToTurkish(view.status),
    confidence: view.confidence,
    revision: view.revision,
    source: view.source,
    sourceLabel:
      view.kind === "keyword"
        ? "Öğrenen anahtar"
        : view.source === "FIS_KONTROL"
          ? "Fiş Kontrol"
          : "Kullanıcı onayı",
    updatedAt: view.updatedAt || view.createdAt,
    reasonLabel: reasonCodeToTurkish(view.reasonCode),
    usageCount: view.usageCount,
    lastUsedAt: view.lastUsedAt,
    conflictState: Boolean(view.conflictState),
    governanceReady: Boolean(view.governanceReady),
    canDeactivate: view.status === MEMORY_GOVERNANCE_STATUS.ACTIVE,
    canReactivate:
      view.status === MEMORY_GOVERNANCE_STATUS.PASSIVE ||
      view.status === MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
    canResolve: view.status === MEMORY_GOVERNANCE_STATUS.REVIEW || view.conflictState,
    canRollback:
      view.status === MEMORY_GOVERNANCE_STATUS.SUPERSEDED ||
      view.status === MEMORY_GOVERNANCE_STATUS.PASSIVE,
  };
}

export function conflictKey(view) {
  return `${textId(view.companyId)}|${textId(view.signature)}|${textId(view.lucaLeg)}`;
}

/**
 * Aynı company + signature + lucaLeg için birden fazla farklı aktif hesap → conflict.
 */
export function annotateConflicts(views = []) {
  const groups = new Map();
  for (const v of views) {
    if (!v || v.status !== MEMORY_GOVERNANCE_STATUS.ACTIVE) continue;
    const key = conflictKey(v);
    const list = groups.get(key) || [];
    list.push(v);
    groups.set(key, list);
  }
  const conflictIds = new Set();
  for (const list of groups.values()) {
    const codes = new Set(list.map((x) => x.accountCode));
    if (codes.size > 1) {
      list.forEach((x) => conflictIds.add(x.memoryId));
    }
  }
  return views.map((v) => {
    if (!conflictIds.has(v.memoryId)) return { ...v, conflictState: false };
    return {
      ...v,
      status: MEMORY_GOVERNANCE_STATUS.REVIEW,
      conflictState: true,
      reasonCode: v.reasonCode || MEMORY_GOVERNANCE_REASON.CONFLICT_DETECTED,
    };
  });
}

export function listGovernanceViewsFromServerRows(rows = [], { companyId = "" } = {}) {
  const company = textId(companyId);
  const mapped = (rows || [])
    .filter((r) => textId(r.account_code || r.accountCode))
    .filter((r) => !company || textId(r.company_id || r.companyId) === company)
    .map((r) => buildCanonicalGovernanceView(r))
    .filter(Boolean);
  return annotateConflicts(mapped);
}

/** Keyword consumer: passive/superseded/review uygulanmaz */
export function isKeywordRowAutoApplicable(row = {}) {
  const view = buildCanonicalGovernanceView(row);
  return isAutoApplicableGovernanceView(view);
}

export function partitionGovernanceTabs(views = []) {
  const active = [];
  const review = [];
  const history = [];
  for (const v of views) {
    if (v.status === MEMORY_GOVERNANCE_STATUS.REVIEW || v.conflictState) {
      review.push(v);
    } else if (v.status === MEMORY_GOVERNANCE_STATUS.ACTIVE) {
      active.push(v);
    } else {
      history.push(v);
    }
  }
  return { active, review, history };
}

/**
 * Resolver için: yalnız active + çakışmasız.
 * passive / superseded / review uygulanmaz.
 */
export function isAutoApplicableGovernanceView(view) {
  if (!view) return false;
  if (view.conflictState) return false;
  if (view.status !== MEMORY_GOVERNANCE_STATUS.ACTIVE) return false;
  return Boolean(view.accountCode && view.companyId);
}

export function filterServerRowsForUserLearnedApply(rows = [], companyId = "") {
  const views = listGovernanceViewsFromServerRows(rows, { companyId });
  const allowedIds = new Set(
    views.filter(isAutoApplicableGovernanceView).map((v) => v.memoryId)
  );
  return (rows || []).filter((r) => allowedIds.has(textId(r.id)));
}

export function stripClientActorFields(payload = {}) {
  const next = { ...payload };
  delete next.createdBy;
  delete next.created_by;
  delete next.updatedBy;
  delete next.updated_by;
  delete next.actorId;
  delete next.actor_id;
  if (next.user_correction) {
    try {
      const meta =
        typeof next.user_correction === "string"
          ? JSON.parse(next.user_correction)
          : { ...next.user_correction };
      delete meta.createdBy;
      delete meta.created_by;
      delete meta.updatedBy;
      delete meta.updated_by;
      next.user_correction = meta;
    } catch {
      /* ignore */
    }
  }
  return next;
}

export function buildGovernanceAuditEvent({
  action = "",
  companyId = "",
  memoryId = "",
  actorId = "",
  fromRevision = null,
  toRevision = null,
  before = null,
  after = null,
  reasonCode = "",
} = {}) {
  const event = {
    action: textId(action),
    companyId: textId(companyId),
    memoryId: textId(memoryId),
    actorId: textId(actorId),
    fromRevision: fromRevision == null ? null : Number(fromRevision),
    toRevision: toRevision == null ? null : Number(toRevision),
    reasonCode: textId(reasonCode),
    before: before
      ? {
          memoryId: before.memoryId,
          accountCode: before.accountCode,
          status: before.status,
          revision: before.revision,
          lucaLeg: before.lucaLeg,
        }
      : null,
    after: after
      ? {
          memoryId: after.memoryId,
          accountCode: after.accountCode,
          status: after.status,
          revision: after.revision,
          lucaLeg: after.lucaLeg,
        }
      : null,
    createdAt: nowIso(),
  };
  return event;
}

export function assertAuditHasNoPii(event = {}) {
  const blob = JSON.stringify(event || {});
  return !PII_AUDIT_RE.test(blob);
}

function putTestRecord(record) {
  testStore.records.set(record.memoryId, { ...record });
  return record;
}

function getTestRecord(memoryId) {
  return testStore.records.get(textId(memoryId)) || null;
}

function pushAudit(event) {
  testStore.audits.push(event);
  return event;
}

/**
 * Test / pure ops: seed canonical record into store.
 */
export function seedGovernanceTestRecord(partial = {}) {
  const companyId = textId(partial.companyId);
  const lucaLeg = textId(partial.lucaLeg) || "counter";
  const signature =
    textId(partial.signature) ||
    buildAccountingMemorySignature({
      bankId: partial.bankId || "VAKIFBANK",
      direction: partial.direction || "GIRIS",
      transactionType: partial.transactionType || "HAVALE",
      currency: partial.currency || "TRY",
      descriptionFingerprint: partial.descriptionFingerprint || "fp_test",
      lucaLeg,
    });
  const record = sanitizeCanonicalView({
    memoryId: textId(partial.memoryId) || newId("mem"),
    companyId,
    kind: textId(partial.kind) || "bsa",
    signature,
    lucaLeg,
    accountCode: textId(partial.accountCode),
    bankId: textId(partial.bankId) || "VAKIFBANK",
    direction: textId(partial.direction) || "GIRIS",
    transactionType: textId(partial.transactionType) || "HAVALE",
    currency: textId(partial.currency) || "TRY",
    source: textId(partial.source) || "USER_LEARNED",
    status: textId(partial.status) || MEMORY_GOVERNANCE_STATUS.ACTIVE,
    confidence: Number(partial.confidence) || 95,
    revision: Math.max(1, Number(partial.revision) || 1),
    parentRevisionId: partial.parentRevisionId || null,
    supersedesId: partial.supersedesId || null,
    createdAt: partial.createdAt || nowIso(),
    updatedAt: partial.updatedAt || nowIso(),
    reasonCode: partial.reasonCode || "",
    userNote: partial.userNote || "",
    usageCount: partial.usageCount == null ? 0 : partial.usageCount,
    lastUsedAt: partial.lastUsedAt || null,
    conflictState: Boolean(partial.conflictState),
    keyword: signature,
  });
  return putTestRecord(record);
}

function requireTenant(record, companyId) {
  if (!record) return { ok: false, code: "NOT_FOUND" };
  // Varlık sızdırmaz: yanlış tenant → NOT_FOUND
  if (textId(companyId) && textId(record.companyId) !== textId(companyId)) {
    return { ok: false, code: "NOT_FOUND" };
  }
  return { ok: true };
}

function checkCas(record, expectedRevision) {
  if (expectedRevision == null) return { ok: true };
  if (Number(record.revision) !== Number(expectedRevision)) {
    return {
      ok: false,
      code: "REVISION_CONFLICT",
      requiresReview: true,
      currentRevision: record.revision,
      expectedRevision: Number(expectedRevision),
    };
  }
  return { ok: true };
}

/**
 * Pasife al — silmez. CAS.
 */
export async function deactivateGovernanceRecord({
  memoryId = "",
  companyId = "",
  expectedRevision = null,
  actorId = "",
  reasonCode = MEMORY_GOVERNANCE_REASON.USER_DEACTIVATE,
  store = "test",
} = {}) {
  const inflightKey = `deact:${memoryId}:${expectedRevision}`;
  if (store === "test" && testStore.inflight.has(inflightKey)) {
    return testStore.inflight.get(inflightKey);
  }

  const work = (async () => {
    const record = store === "test" ? getTestRecord(memoryId) : null;
    const tenant = requireTenant(record, companyId);
    if (!tenant.ok) return tenant;
    const cas = checkCas(record, expectedRevision);
    if (!cas.ok) return cas;

    const next = {
      ...record,
      status: MEMORY_GOVERNANCE_STATUS.PASSIVE,
      revision: Number(record.revision) + 1,
      parentRevisionId: record.memoryId,
      updatedAt: nowIso(),
      updatedBy: textId(actorId) || null,
      reasonCode,
      conflictState: false,
    };
    // Eski sürüm superseded olarak ayrı kayıt (tarihçe silinmez)
    const archived = {
      ...record,
      memoryId: newId("rev"),
      status: MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
      supersedesId: null,
      parentRevisionId: record.parentRevisionId,
      updatedAt: nowIso(),
      reasonCode,
    };
    putTestRecord(archived);
    putTestRecord(next);
    const audit = pushAudit(
      buildGovernanceAuditEvent({
        action: MEMORY_GOVERNANCE_ACTION.DEACTIVATE,
        companyId,
        memoryId: next.memoryId,
        actorId,
        fromRevision: record.revision,
        toRevision: next.revision,
        before: record,
        after: next,
        reasonCode,
      })
    );
    return { ok: true, record: next, archived, audit };
  })();

  if (store === "test") {
    testStore.inflight.set(inflightKey, work);
    try {
      return await work;
    } finally {
      testStore.inflight.delete(inflightKey);
    }
  }
  return work;
}

/**
 * Etkinleştir — yeni revision; eski passive/superseded korunur.
 */
export async function reactivateGovernanceRecord({
  memoryId = "",
  companyId = "",
  expectedRevision = null,
  actorId = "",
  reasonCode = MEMORY_GOVERNANCE_REASON.USER_REACTIVATE,
} = {}) {
  const record = getTestRecord(memoryId);
  const tenant = requireTenant(record, companyId);
  if (!tenant.ok) return tenant;
  const cas = checkCas(record, expectedRevision);
  if (!cas.ok) return cas;

  // Aynı signature+leg üzerindeki diğer active’leri superseded yap
  for (const other of testStore.records.values()) {
    if (other.memoryId === record.memoryId) continue;
    if (other.companyId !== record.companyId) continue;
    if (other.signature !== record.signature || other.lucaLeg !== record.lucaLeg) continue;
    if (other.status === MEMORY_GOVERNANCE_STATUS.ACTIVE) {
      putTestRecord({
        ...other,
        status: MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
        updatedAt: nowIso(),
        reasonCode: MEMORY_GOVERNANCE_REASON.SUPERSEDED_BY_LEARN,
      });
    }
  }

  const next = {
    ...record,
    status: MEMORY_GOVERNANCE_STATUS.ACTIVE,
    revision: Number(record.revision) + 1,
    parentRevisionId: record.memoryId,
    updatedAt: nowIso(),
    updatedBy: textId(actorId) || null,
    reasonCode,
    conflictState: false,
  };
  putTestRecord(next);
  const audit = pushAudit(
    buildGovernanceAuditEvent({
      action: MEMORY_GOVERNANCE_ACTION.REACTIVATE,
      companyId,
      memoryId: next.memoryId,
      actorId,
      fromRevision: record.revision,
      toRevision: next.revision,
      before: record,
      after: next,
      reasonCode,
    })
  );
  return { ok: true, record: next, audit };
}

/**
 * Edit → revision +1; eski superseded.
 */
export async function reviseGovernanceRecord({
  memoryId = "",
  companyId = "",
  expectedRevision = null,
  actorId = "",
  nextAccountCode = "",
  reasonCode = MEMORY_GOVERNANCE_REASON.USER_EDIT,
} = {}) {
  const record = getTestRecord(memoryId);
  const tenant = requireTenant(record, companyId);
  if (!tenant.ok) return tenant;
  const cas = checkCas(record, expectedRevision);
  if (!cas.ok) return cas;

  const accountCode = textId(nextAccountCode) || record.accountCode;
  const archived = {
    ...record,
    memoryId: newId("rev"),
    status: MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
    updatedAt: nowIso(),
    reasonCode: MEMORY_GOVERNANCE_REASON.SUPERSEDED_BY_LEARN,
  };
  putTestRecord(archived);

  const next = {
    ...record,
    accountCode,
    status: MEMORY_GOVERNANCE_STATUS.ACTIVE,
    revision: Number(record.revision) + 1,
    parentRevisionId: record.memoryId,
    supersedesId: archived.memoryId,
    updatedAt: nowIso(),
    updatedBy: textId(actorId) || null,
    reasonCode,
    conflictState: false,
  };
  putTestRecord(next);
  const audit = pushAudit(
    buildGovernanceAuditEvent({
      action: MEMORY_GOVERNANCE_ACTION.UPDATE,
      companyId,
      memoryId: next.memoryId,
      actorId,
      fromRevision: record.revision,
      toRevision: next.revision,
      before: record,
      after: next,
      reasonCode,
    })
  );
  return { ok: true, record: next, superseded: archived, audit };
}

/**
 * Conflict resolve — seçilen hesap active; diğerleri superseded/passive.
 */
export async function resolveGovernanceConflict({
  companyId = "",
  signature = "",
  lucaLeg = "",
  chosenMemoryId = "",
  actorId = "",
  expectedRevision = null,
} = {}) {
  const company = textId(companyId);
  const sig = textId(signature);
  const leg = textId(lucaLeg);
  const chosen = getTestRecord(chosenMemoryId);
  const tenant = requireTenant(chosen, company);
  if (!tenant.ok) return tenant;
  if (chosen.signature !== sig || chosen.lucaLeg !== leg) {
    return { ok: false, code: "SIGNATURE_MISMATCH" };
  }
  const cas = checkCas(chosen, expectedRevision);
  if (!cas.ok) return cas;

  const siblings = [...testStore.records.values()].filter(
    (r) =>
      r.companyId === company &&
      r.signature === sig &&
      r.lucaLeg === leg &&
      (r.status === MEMORY_GOVERNANCE_STATUS.ACTIVE ||
        r.status === MEMORY_GOVERNANCE_STATUS.REVIEW)
  );

  for (const sib of siblings) {
    if (sib.memoryId === chosen.memoryId) continue;
    putTestRecord({
      ...sib,
      status: MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
      updatedAt: nowIso(),
      reasonCode: MEMORY_GOVERNANCE_REASON.CONFLICT_RESOLVE,
      conflictState: false,
    });
  }

  const next = {
    ...chosen,
    status: MEMORY_GOVERNANCE_STATUS.ACTIVE,
    revision: Number(chosen.revision) + 1,
    parentRevisionId: chosen.memoryId,
    updatedAt: nowIso(),
    updatedBy: textId(actorId) || null,
    reasonCode: MEMORY_GOVERNANCE_REASON.CONFLICT_RESOLVE,
    conflictState: false,
  };
  putTestRecord(next);
  const audit = pushAudit(
    buildGovernanceAuditEvent({
      action: MEMORY_GOVERNANCE_ACTION.CONFLICT_RESOLVE,
      companyId: company,
      memoryId: next.memoryId,
      actorId,
      fromRevision: chosen.revision,
      toRevision: next.revision,
      before: chosen,
      after: next,
      reasonCode: MEMORY_GOVERNANCE_REASON.CONFLICT_RESOLVE,
    })
  );
  return { ok: true, record: next, audit, deactivatedCount: siblings.length - 1 };
}

/**
 * Rollback — eski veri değiştirilmez; seçilen sürümden yeni active revision.
 */
export async function rollbackGovernanceRecord({
  targetMemoryId = "",
  companyId = "",
  expectedRevision = null,
  actorId = "",
} = {}) {
  const target = getTestRecord(targetMemoryId);
  const tenant = requireTenant(target, companyId);
  if (!tenant.ok) return tenant;

  // Aynı signature+leg üzerinde eşzamanlı rollback → tek kazanan
  const lockKey = `rollback:${target.companyId}:${target.signature}:${target.lucaLeg}`;
  if (testStore.inflight.has(lockKey)) {
    await testStore.inflight.get(lockKey);
    return {
      ok: false,
      code: "REVISION_CONFLICT",
      requiresReview: true,
      currentRevision: getTestRecord(targetMemoryId)?.revision,
      expectedRevision: Number(expectedRevision),
    };
  }

  let resolveLock;
  const lockPromise = new Promise((resolve) => {
    resolveLock = resolve;
  });
  testStore.inflight.set(lockKey, lockPromise);

  try {
    // Yield so concurrent callers observe the lock before we mutate
    await Promise.resolve();

    const fresh = getTestRecord(targetMemoryId);
    const cas = checkCas(fresh, expectedRevision);
    if (!cas.ok) return cas;

    // Signature üzerinde zaten yeni active oluşmuşsa (başka rollback) → conflict
    const existingActive = [...testStore.records.values()].find(
      (r) =>
        r.companyId === fresh.companyId &&
        r.signature === fresh.signature &&
        r.lucaLeg === fresh.lucaLeg &&
        r.status === MEMORY_GOVERNANCE_STATUS.ACTIVE &&
        r.reasonCode === MEMORY_GOVERNANCE_REASON.ROLLBACK &&
        r.memoryId !== fresh.memoryId
    );
    if (existingActive) {
      return {
        ok: false,
        code: "REVISION_CONFLICT",
        requiresReview: true,
        currentRevision: fresh.revision,
        expectedRevision: Number(expectedRevision),
      };
    }

    for (const other of testStore.records.values()) {
      if (other.memoryId === fresh.memoryId) continue;
      if (other.companyId !== fresh.companyId) continue;
      if (other.signature !== fresh.signature || other.lucaLeg !== fresh.lucaLeg) {
        continue;
      }
      if (other.status === MEMORY_GOVERNANCE_STATUS.ACTIVE) {
        putTestRecord({
          ...other,
          status: MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
          updatedAt: nowIso(),
          reasonCode: MEMORY_GOVERNANCE_REASON.ROLLBACK,
        });
      }
    }

    const restored = {
      ...fresh,
      memoryId: newId("mem"),
      status: MEMORY_GOVERNANCE_STATUS.ACTIVE,
      revision: Number(fresh.revision) + 1,
      parentRevisionId: fresh.memoryId,
      supersedesId: fresh.memoryId,
      updatedAt: nowIso(),
      updatedBy: textId(actorId) || null,
      reasonCode: MEMORY_GOVERNANCE_REASON.ROLLBACK,
      conflictState: false,
      createdAt: nowIso(),
    };
    putTestRecord(restored);
    putTestRecord({ ...fresh });

    const audit = pushAudit(
      buildGovernanceAuditEvent({
        action: MEMORY_GOVERNANCE_ACTION.ROLLBACK,
        companyId,
        memoryId: restored.memoryId,
        actorId,
        fromRevision: fresh.revision,
        toRevision: restored.revision,
        before: fresh,
        after: restored,
        reasonCode: MEMORY_GOVERNANCE_REASON.ROLLBACK,
      })
    );
    return { ok: true, record: restored, sourceUnchanged: getTestRecord(targetMemoryId), audit };
  } finally {
    resolveLock?.(true);
    testStore.inflight.delete(lockKey);
  }
}

/**
 * Persist path için revision meta — silent overwrite yok.
 */
export function buildRevisionMetaPatch(existingMeta = {}, {
  revision = 1,
  reasonCode = "",
  parentRevisionId = "",
  supersedesId = "",
  status = "active",
} = {}) {
  return {
    ...existingMeta,
    revision: Math.max(1, Number(revision) || 1),
    reasonCode: textId(reasonCode),
    parentRevisionId: textId(parentRevisionId) || undefined,
    supersedesId: textId(supersedesId) || undefined,
    status,
    schemaVersion: existingMeta.schemaVersion || 1,
  };
}

/**
 * Server PATCH payload’ları — actor alanları yok.
 */
export function buildDeactivateServerPatch(row = {}, { reasonCode = MEMORY_GOVERNANCE_REASON.USER_DEACTIVATE } = {}) {
  const meta = parseUserCorrectionMeta(row);
  const revision = Math.max(1, Number(meta.revision || 1)) + 1;
  return stripClientActorFields({
    status: "passive",
    is_active: false,
    user_correction: JSON.stringify(
      buildRevisionMetaPatch(meta, {
        revision,
        reasonCode,
        parentRevisionId: textId(row.id),
        status: "disabled",
      })
    ),
  });
}

export function buildReactivateServerPatch(row = {}, { reasonCode = MEMORY_GOVERNANCE_REASON.USER_REACTIVATE } = {}) {
  const meta = parseUserCorrectionMeta(row);
  const revision = Math.max(1, Number(meta.revision || 1)) + 1;
  return stripClientActorFields({
    status: "active",
    is_active: true,
    deleted_at: null,
    user_correction: JSON.stringify(
      buildRevisionMetaPatch(meta, {
        revision,
        reasonCode,
        parentRevisionId: textId(row.id),
        status: "active",
      })
    ),
  });
}

export function buildRollbackServerCreatePayload(row = {}, { companyId = "", actorId = "" } = {}) {
  const meta = parseUserCorrectionMeta(row);
  const revision = Math.max(1, Number(meta.revision || 1)) + 1;
  void actorId; // session-derived on API; never from client
  return stripClientActorFields({
    company_id: companyId || row.company_id,
    keyword: row.keyword,
    account_code: row.account_code || row.accountCode,
    account_name: row.account_name || "",
    counter_account_code: row.counter_account_code || "",
    document_type: BANK_STATEMENT_ACCOUNTING_DOC,
    transaction_type: row.transaction_type || meta.transactionType || "",
    source_module: "GOVERNANCE_ROLLBACK",
    bank_name: row.bank_name || meta.bankId || "",
    status: "active",
    is_active: true,
    user_correction: JSON.stringify(
      buildRevisionMetaPatch(meta, {
        revision,
        reasonCode: MEMORY_GOVERNANCE_REASON.ROLLBACK,
        parentRevisionId: textId(row.id),
        supersedesId: textId(row.id),
        status: "active",
      })
    ),
  });
}

export function simulateTwoTabRevisionConflict(record, mutateA, mutateB) {
  const expected = Number(record.revision);
  return (async () => {
    const first = await mutateA({ ...record }, expected);
    const second = await mutateB({ ...record }, expected);
    return { first, second };
  })();
}

export function hasHardDeleteUiAction(sourceText = "") {
  return /\bSil\b|hard.?delete|deleteLearningMemoryRecord\(/i.test(String(sourceText || ""));
}

export function resolveLucaLegLabelFromAccount(accountCode = "") {
  const resolved = resolveAccountingMemoryLucaLeg({
    accountCode,
    allowInfer: true,
  });
  return lucaLegToTurkish(resolved.leg);
}

export function parseSignatureSafe(keyword = "") {
  return parseAccountingMemorySignature(keyword);
}
