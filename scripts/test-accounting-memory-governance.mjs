/**
 * Faz 7 — Accounting memory governance.
 * Run: node --import ./scripts/_alias-loader.mjs --test ./scripts/test-accounting-memory-governance.mjs
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  __resetAccountingMemoryGovernanceTestState,
  __listGovernanceTestRecords,
  __listGovernanceTestAudits,
  seedGovernanceTestRecord,
  deactivateGovernanceRecord,
  reactivateGovernanceRecord,
  reviseGovernanceRecord,
  resolveGovernanceConflict,
  rollbackGovernanceRecord,
  listGovernanceViewsFromServerRows,
  filterServerRowsForUserLearnedApply,
  isAutoApplicableGovernanceView,
  annotateConflicts,
  stripClientActorFields,
  assertAuditHasNoPii,
  buildGovernanceAuditEvent,
  simulateTwoTabRevisionConflict,
  MEMORY_GOVERNANCE_STATUS,
  MEMORY_GOVERNANCE_ACTION,
  toGovernanceUiRow,
  hasHardDeleteUiAction,
  isKeywordRowAutoApplicable,
} = await import("@/src/utils/accountingMemoryGovernance.js");

const {
  runAtomicGovernanceMutationTx,
  runMigration037Preflight,
  assertUniqueActiveInvariant,
  canHaveTwoActivesDifferentLegs,
  invokeLearningMemoryGovernanceRpc,
} = await import("@/src/utils/accountingMemoryGovernanceAtomic.js");

const {
  findLearningSuggestion,
} = await import("@/src/utils/transactionMemoryEngine.js");

const {
  bankMovementsToStandardLucaRows,
} = await import("@/src/utils/standardLucaRow.js");

const {
  applyOutputAccountingDecisionsToRows,
} = await import("@/src/utils/outputAccountingDecisionFacade.js");

const {
  prepareElektrawebExportRows,
} = await import("@/src/utils/elektrawebOutputAdapter.js");

const {
  shouldPersistFisKontrolAccountingDecision,
} = await import("@/src/utils/fisKontrolAccountingMemory.js");

const {
  mapServerAccountingRowToV2,
  BANK_STATEMENT_ACCOUNTING_DOC,
  buildAccountingMemorySignature,
} = await import("@/src/utils/accountingMemoryV1.js");

const COMPANY_A = "gov-co-aaaa";
const COMPANY_B = "gov-co-bbbb";
const SHARED_102 = "102.01.037";
const VADESIZ = "102.10.V001";
const FAIZ = "642.01.001";
const STOPAJ = "193.01.001";

const SIG = buildAccountingMemorySignature({
  bankId: "VAKIFBANK",
  direction: "GIRIS",
  transactionType: "HAVALE",
  currency: "TRY",
  descriptionFingerprint: "fp_gov",
  lucaLeg: "counter",
});

function makeServerRow({
  id,
  companyId,
  accountCode,
  status = "active",
  lucaLeg = "counter",
  revision = 1,
  keyword = SIG,
  conflict = false,
} = {}) {
  return {
    id,
    company_id: companyId,
    document_type: BANK_STATEMENT_ACCOUNTING_DOC,
    account_code: accountCode,
    keyword,
    status,
    is_active: status === "active",
    usage_count: 3,
    last_used_at: "2026-09-01T10:00:00.000Z",
    learned_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    user_correction: JSON.stringify({
      schemaVersion: 1,
      status: status === "passive" ? "disabled" : status,
      revision,
      lucaLeg,
      direction: "GIRIS",
      bankId: "VAKIFBANK",
      transactionType: "HAVALE",
      currency: "TRY",
      descriptionFingerprint: "fp_gov",
      conflict,
      confidence: 95,
      sourceModule: "FIS_KONTROL",
    }),
  };
}

function dualMovement(i, counter = FAIZ) {
  return {
    id: `m-${i}`,
    sourceMovementId: `m-${i}`,
    date: "2026-03-01",
    description: `H${i}`,
    amount: 1000 + i,
    direction: i % 2 === 0 ? "GIRIS" : "CIKIS",
    accountCode: SHARED_102,
    counterAccountCode: counter,
    documentType: "DK",
    lucaDescription: `H${i}`,
    matchedMemoryId: null,
    decisionSource: "safeSystemRule",
    decisionRequiresReview: false,
    missingHesapCategory: "",
  };
}

function mare12Movements() {
  const counters = [
    VADESIZ,
    FAIZ,
    STOPAJ,
    VADESIZ,
    FAIZ,
    STOPAJ,
    FAIZ,
    STOPAJ,
    VADESIZ,
    FAIZ,
    STOPAJ,
    VADESIZ,
  ];
  return counters.map((c, i) => dualMovement(i + 1, c));
}

beforeEach(() => {
  __resetAccountingMemoryGovernanceTestState();
});

describe("Faz7 accounting memory governance", () => {
  it("1) Firma A yalnız A kayıtlarını listeler", () => {
    seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
      lucaLeg: "counter",
    });
    seedGovernanceTestRecord({
      companyId: COMPANY_B,
      accountCode: STOPAJ,
      signature: SIG,
      lucaLeg: "counter",
    });
    const rows = makeServerRow({
      id: "a1",
      companyId: COMPANY_A,
      accountCode: FAIZ,
    });
    const rowsB = makeServerRow({
      id: "b1",
      companyId: COMPANY_B,
      accountCode: STOPAJ,
    });
    const listed = listGovernanceViewsFromServerRows([rows, rowsB], {
      companyId: COMPANY_A,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].companyId, COMPANY_A);
  });

  it("2) Firma A, B kaydını değiştiremez", async () => {
    const b = seedGovernanceTestRecord({
      companyId: COMPANY_B,
      accountCode: STOPAJ,
      signature: SIG,
    });
    const result = await deactivateGovernanceRecord({
      memoryId: b.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      actorId: "user-a",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_FOUND");
  });

  it("3) unauthenticated istek sözleşmesi — API auth + atomic RPC", () => {
    const route = fs.readFileSync(
      path.join(root, "app/api/accounting-memory-governance/route.js"),
      "utf8"
    );
    assert.match(route, /requireAuthenticatedApi/);
    assert.match(route, /invokeLearningMemoryGovernanceRpc/);
    assert.match(route, /learning_memory_governance_mutate|invokeLearningMemoryGovernanceRpc/);
    const mig = fs.readFileSync(
      path.join(root, "supabase/migrations/037_accounting_memory_governance.sql"),
      "utf8"
    );
    assert.match(mig, /security definer/i);
    assert.match(mig, /search_path = pg_catalog, pg_temp/);
    assert.match(mig, /grant execute[\s\S]*to service_role/i);
    assert.match(mig, /revoke[\s\S]*from anon, authenticated/i);
  });

  it("4) client createdBy/updatedBy sahteciliği kabul edilmez", () => {
    const stripped = stripClientActorFields({
      account_code: FAIZ,
      createdBy: "attacker",
      updated_by: "attacker",
      user_correction: { createdBy: "attacker", updatedBy: "x", revision: 1 },
    });
    assert.equal(stripped.createdBy, undefined);
    assert.equal(stripped.updated_by, undefined);
    assert.equal(stripped.user_correction.createdBy, undefined);
    assert.equal(stripped.user_correction.updatedBy, undefined);
  });

  it("5) active kayıt resolver’da uygulanır", () => {
    const row = makeServerRow({
      id: "act1",
      companyId: COMPANY_A,
      accountCode: FAIZ,
      status: "active",
    });
    const filtered = filterServerRowsForUserLearnedApply([row], COMPANY_A);
    assert.equal(filtered.length, 1);
    const v2 = mapServerAccountingRowToV2(row);
    assert.equal(v2.isActive, true);
  });

  it("6) passive uygulanmaz", () => {
    const row = makeServerRow({
      id: "pas1",
      companyId: COMPANY_A,
      accountCode: FAIZ,
      status: "passive",
    });
    assert.equal(filterServerRowsForUserLearnedApply([row], COMPANY_A).length, 0);
    assert.equal(mapServerAccountingRowToV2(row).isActive, false);
  });

  it("7) superseded uygulanmaz", () => {
    const row = makeServerRow({
      id: "sup1",
      companyId: COMPANY_A,
      accountCode: FAIZ,
      status: "superseded",
    });
    assert.equal(filterServerRowsForUserLearnedApply([row], COMPANY_A).length, 0);
  });

  it("8) review/conflict uygulanmaz", () => {
    const a = makeServerRow({
      id: "c1",
      companyId: COMPANY_A,
      accountCode: FAIZ,
    });
    const b = makeServerRow({
      id: "c2",
      companyId: COMPANY_A,
      accountCode: STOPAJ,
    });
    const views = listGovernanceViewsFromServerRows([a, b], { companyId: COMPANY_A });
    assert.ok(views.every((v) => v.status === MEMORY_GOVERNANCE_STATUS.REVIEW));
    assert.equal(filterServerRowsForUserLearnedApply([a, b], COMPANY_A).length, 0);
  });

  it("9) statement ve counter birbirini ezmez", () => {
    const stmtSig = buildAccountingMemorySignature({
      bankId: "VAKIFBANK",
      direction: "GIRIS",
      transactionType: "HAVALE",
      currency: "TRY",
      descriptionFingerprint: "fp_gov",
      lucaLeg: "statement",
    });
    const statement = makeServerRow({
      id: "s1",
      companyId: COMPANY_A,
      accountCode: SHARED_102,
      lucaLeg: "statement",
      keyword: stmtSig,
    });
    const counter = makeServerRow({
      id: "c1",
      companyId: COMPANY_A,
      accountCode: FAIZ,
      lucaLeg: "counter",
      keyword: SIG,
    });
    const views = listGovernanceViewsFromServerRows([statement, counter], {
      companyId: COMPANY_A,
    });
    assert.equal(views.length, 2);
    assert.ok(views.every((v) => v.status === MEMORY_GOVERNANCE_STATUS.ACTIVE));
    assert.ok(views.every((v) => !v.conflictState));
  });

  it("10) aynı signature+leg farklı hesap → conflict/review", () => {
    const a = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
      lucaLeg: "counter",
    });
    const b = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: STOPAJ,
      signature: SIG,
      lucaLeg: "counter",
    });
    const annotated = annotateConflicts([a, b]);
    assert.ok(annotated.every((v) => v.conflictState));
    assert.ok(annotated.every((v) => v.status === MEMORY_GOVERNANCE_STATUS.REVIEW));
  });

  it("11) conflict resolve → tek active revision", async () => {
    const a = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
      lucaLeg: "counter",
      status: MEMORY_GOVERNANCE_STATUS.REVIEW,
      conflictState: true,
    });
    const b = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: STOPAJ,
      signature: SIG,
      lucaLeg: "counter",
      status: MEMORY_GOVERNANCE_STATUS.REVIEW,
      conflictState: true,
    });
    const resolved = await resolveGovernanceConflict({
      companyId: COMPANY_A,
      signature: SIG,
      lucaLeg: "counter",
      chosenMemoryId: a.memoryId,
      expectedRevision: 1,
      actorId: "user-a",
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.record.status, MEMORY_GOVERNANCE_STATUS.ACTIVE);
    assert.equal(resolved.record.revision, 2);
    const other = __listGovernanceTestRecords().find((r) => r.memoryId === b.memoryId);
    assert.equal(other.status, MEMORY_GOVERNANCE_STATUS.SUPERSEDED);
  });

  it("12) edit → revision +1, eski kayıt superseded", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
    });
    const rev = await reviseGovernanceRecord({
      memoryId: base.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      nextAccountCode: STOPAJ,
      actorId: "user-a",
    });
    assert.equal(rev.ok, true);
    assert.equal(rev.record.revision, 2);
    assert.equal(rev.record.accountCode, STOPAJ);
    assert.equal(rev.superseded.status, MEMORY_GOVERNANCE_STATUS.SUPERSEDED);
    assert.equal(rev.superseded.accountCode, FAIZ);
  });

  it("13) deactivate → kayıt silinmez", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
    });
    const result = await deactivateGovernanceRecord({
      memoryId: base.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      actorId: "user-a",
    });
    assert.equal(result.ok, true);
    assert.equal(result.record.status, MEMORY_GOVERNANCE_STATUS.PASSIVE);
    assert.ok(__listGovernanceTestRecords().length >= 2);
    assert.ok(__listGovernanceTestRecords().every((r) => r.accountCode));
  });

  it("14) reactivate → güvenli yeni revision", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
      status: MEMORY_GOVERNANCE_STATUS.PASSIVE,
      revision: 2,
    });
    const result = await reactivateGovernanceRecord({
      memoryId: base.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 2,
      actorId: "user-a",
    });
    assert.equal(result.ok, true);
    assert.equal(result.record.status, MEMORY_GOVERNANCE_STATUS.ACTIVE);
    assert.equal(result.record.revision, 3);
  });

  it("15) rollback → eski veri değiştirilmez, yeni active revision", async () => {
    const old = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
      status: MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
      revision: 1,
    });
    seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: STOPAJ,
      signature: SIG,
      status: MEMORY_GOVERNANCE_STATUS.ACTIVE,
      revision: 2,
    });
    const rolled = await rollbackGovernanceRecord({
      targetMemoryId: old.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      actorId: "user-a",
    });
    assert.equal(rolled.ok, true);
    assert.equal(rolled.record.accountCode, FAIZ);
    assert.equal(rolled.record.status, MEMORY_GOVERNANCE_STATUS.ACTIVE);
    assert.equal(rolled.sourceUnchanged.accountCode, FAIZ);
    assert.equal(rolled.sourceUnchanged.memoryId, old.memoryId);
    assert.equal(rolled.sourceUnchanged.status, MEMORY_GOVERNANCE_STATUS.SUPERSEDED);
  });

  it("16) rollback audit olayı oluşur", async () => {
    const old = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
      status: MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
    });
    await rollbackGovernanceRecord({
      targetMemoryId: old.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      actorId: "user-a",
    });
    const audits = __listGovernanceTestAudits();
    assert.ok(audits.some((a) => a.action === MEMORY_GOVERNANCE_ACTION.ROLLBACK));
  });

  it("17) iki sekme aynı revision → ikincisi REVISION_CONFLICT", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
    });
    const { first, second } = await simulateTwoTabRevisionConflict(
      base,
      (rec, expected) =>
        deactivateGovernanceRecord({
          memoryId: rec.memoryId,
          companyId: COMPANY_A,
          expectedRevision: expected,
          actorId: "tab-a",
        }),
      (rec, expected) =>
        deactivateGovernanceRecord({
          memoryId: rec.memoryId,
          companyId: COMPANY_A,
          expectedRevision: expected,
          actorId: "tab-b",
        })
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.code, "REVISION_CONFLICT");
  });

  it("18) çift tıklama → tek mutation (inflight dedupe)", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
    });
    const p1 = deactivateGovernanceRecord({
      memoryId: base.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      actorId: "user-a",
    });
    const p2 = deactivateGovernanceRecord({
      memoryId: base.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      actorId: "user-a",
    });
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.record.revision, b.record.revision);
  });

  it("19) API fail → mevcut aktif kayıt zarar görmez", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
    });
    const fail = await deactivateGovernanceRecord({
      memoryId: "missing",
      companyId: COMPANY_A,
      expectedRevision: 1,
    });
    assert.equal(fail.ok, false);
    const still = __listGovernanceTestRecords().find((r) => r.memoryId === base.memoryId);
    assert.equal(still.status, MEMORY_GOVERNANCE_STATUS.ACTIVE);
    assert.equal(still.revision, 1);
  });

  it("20) audit içinde ham açıklama/IBAN/hesap numarası yok", () => {
    const event = buildGovernanceAuditEvent({
      action: "deactivate",
      companyId: COMPANY_A,
      memoryId: "m1",
      actorId: "u1",
      before: {
        memoryId: "m1",
        accountCode: FAIZ,
        status: "active",
        revision: 1,
        lucaLeg: "counter",
      },
      after: {
        memoryId: "m1",
        accountCode: FAIZ,
        status: "passive",
        revision: 2,
        lucaLeg: "counter",
      },
    });
    assert.equal(assertAuditHasNoPii(event), true);
    const dirty = {
      ...event,
      note: "TR12 0000 0000 0000 0000 0000 00",
    };
    assert.equal(assertAuditHasNoPii(dirty), false);
  });

  it("21) passive/superseded kayıt server consumer’a sızmaz", () => {
    const rows = [
      makeServerRow({ id: "1", companyId: COMPANY_A, accountCode: FAIZ, status: "passive" }),
      makeServerRow({
        id: "2",
        companyId: COMPANY_A,
        accountCode: STOPAJ,
        status: "superseded",
      }),
    ];
    assert.equal(filterServerRowsForUserLearnedApply(rows, COMPANY_A).length, 0);
  });

  it("22) Fiş Kontrol learn=true yeni revision zincirine uyumlu", () => {
    const decision = shouldPersistFisKontrolAccountingDecision({
      learnForCompany: true,
      companyId: COMPANY_A,
      accountCode: FAIZ,
      direction: "GIRIS",
      descriptionOrKey: "test",
      accountChanged: true,
    });
    assert.equal(decision.ok, true);
    const payloadPath = fs.readFileSync(
      path.join(root, "src/utils/accountingMemoryV1.js"),
      "utf8"
    );
    assert.match(payloadPath, /revision:\s*1/);
    assert.match(payloadPath, /parentRevisionId/);
  });

  it("23) learn=false server write 0", () => {
    const decision = shouldPersistFisKontrolAccountingDecision({
      learnForCompany: false,
      companyId: COMPANY_A,
      accountCode: FAIZ,
      accountChanged: true,
    });
    assert.equal(decision.ok, false);
  });

  it("24) MARE statement 102 ve counter bacakları doğru", () => {
    const rows = bankMovementsToStandardLucaRows(mare12Movements(), {
      firmaId: COMPANY_A,
      kaynakAdi: "VAKIFBANK",
    });
    assert.equal(rows.length, 24);
    const codes = [...new Set(rows.map((r) => r.hesapKodu))];
    assert.ok(codes.includes(SHARED_102));
    assert.ok(codes.includes(VADESIZ));
    assert.ok(codes.includes(FAIZ));
    assert.ok(codes.includes(STOPAJ));
  });

  it("25) Luca/Elektra paritesi korunur", () => {
    const rows = bankMovementsToStandardLucaRows(mare12Movements(), {
      firmaId: COMPANY_A,
    });
    const luca = applyOutputAccountingDecisionsToRows(rows, { companyId: COMPANY_A });
    const elektra = prepareElektrawebExportRows(rows, { companyId: COMPANY_A });
    assert.equal(elektra.ok, true);
    assert.equal(luca.length, elektra.rows.length);
  });

  it("26) UI’da hard-delete aksiyonu yok", () => {
    const panel = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/components/AccountMemoryV2Panel.jsx"),
      "utf8"
    );
    const page = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/ogrenen-hafiza/page.jsx"),
      "utf8"
    );
    assert.doesNotMatch(panel, />\s*Sil\s*</);
    assert.doesNotMatch(panel, /deleteLearningMemoryRecord\(/);
    assert.doesNotMatch(page, />\s*Sil\s*</);
    assert.match(panel, /Pasife Al/);
    assert.match(panel, /Bu sürüme dön/);
    assert.match(panel, /Çöz/);
    assert.equal(hasHardDeleteUiAction("Sil hard-delete"), true);
    assert.equal(hasHardDeleteUiAction(panel), false);
  });

  it("27) firma değişiminde önceki firmanın listesi/cache’i görünmez", () => {
    const panel = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/components/AccountMemoryV2Panel.jsx"),
      "utf8"
    );
    assert.match(panel, /setTabs\(\{ active: \[\], review: \[\], history: \[\] \}\)/);
    assert.match(panel, /companyIdRef\.current !== id/);
    assert.match(panel, /fetchGenRef/);
  });

  it("28) stale async cevap yeni firmanın ekranına yazılmaz", () => {
    const panel = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/components/AccountMemoryV2Panel.jsx"),
      "utf8"
    );
    assert.match(panel, /gen !== fetchGenRef\.current \|\| companyIdRef\.current !== id/);
  });

  it("UI satırı signature göstermez", () => {
    const view = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
    });
    const ui = toGovernanceUiRow(view);
    assert.equal(ui.signature, undefined);
    assert.ok(ui.lucaLegLabel);
    assert.ok(ui.statusLabel);
  });

  it("auto-applicable helper", () => {
    assert.equal(
      isAutoApplicableGovernanceView({
        status: "active",
        conflictState: false,
        accountCode: FAIZ,
        companyId: COMPANY_A,
      }),
      true
    );
    assert.equal(
      isAutoApplicableGovernanceView({
        status: "review",
        conflictState: true,
        accountCode: FAIZ,
        companyId: COMPANY_A,
      }),
      false
    );
  });

  it("MARE 12→24 dengeli kabul iskeleti", () => {
    const rows = bankMovementsToStandardLucaRows(mare12Movements(), {
      firmaId: COMPANY_A,
    });
    assert.equal(rows.length, 24);
    let borc = 0;
    let alacak = 0;
    for (const r of rows) {
      borc += Number(r.borc || 0);
      alacak += Number(r.alacak || 0);
    }
    assert.equal(Number(borc.toFixed(2)), Number(alacak.toFixed(2)));
  });

  it("wiring: governance API + migration additive", () => {
    assert.ok(
      fs.existsSync(path.join(root, "app/api/accounting-memory-governance/route.js"))
    );
    const mig = fs.readFileSync(
      path.join(root, "supabase/migrations/037_accounting_memory_governance.sql"),
      "utf8"
    );
    assert.match(mig, /add column if not exists revision/i);
    assert.doesNotMatch(mig, /\bdrop table\b/i);
    assert.doesNotMatch(mig, /^\s*truncate\b/im);
    assert.match(mig, /uq_learning_memory_active_signature_leg/);
    assert.match(mig, /learning_memory_governance_mutate/);
    assert.match(mig, /migration_037_preflight_conflict/);
  });
});

describe("Faz7 merge-blocker extras", () => {
  it("update + audit aynı transaction; audit fail → mutation rollback", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
    });
    const result = await runAtomicGovernanceMutationTx({
      action: "deactivate",
      companyId: COMPANY_A,
      memoryId: base.memoryId,
      expectedRevision: 1,
      actorId: "u1",
      forceAuditFail: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "AUDIT_FAILED");
    assert.equal(result.rolledBack, true);
    const still = __listGovernanceTestRecords().find((r) => r.memoryId === base.memoryId);
    assert.equal(still.status, MEMORY_GOVERNANCE_STATUS.ACTIVE);
    assert.equal(still.revision, 1);
    assert.equal(__listGovernanceTestAudits().length, 0);
  });

  it("insert fail → eski active korunur", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
      status: MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
    });
    seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: STOPAJ,
      signature: SIG,
      status: MEMORY_GOVERNANCE_STATUS.ACTIVE,
      revision: 2,
    });
    const result = await runAtomicGovernanceMutationTx({
      action: "rollback",
      companyId: COMPANY_A,
      memoryId: base.memoryId,
      expectedRevision: 1,
      actorId: "u1",
      forceInsertFail: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.rolledBack, true);
    const actives = __listGovernanceTestRecords().filter(
      (r) => r.status === MEMORY_GOVERNANCE_STATUS.ACTIVE
    );
    assert.equal(actives.length, 1);
    assert.equal(actives[0].accountCode, STOPAJ);
  });

  it("iki eşzamanlı rollback → yalnız biri başarılı", async () => {
    const old = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
      status: MEMORY_GOVERNANCE_STATUS.SUPERSEDED,
      revision: 1,
    });
    seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: STOPAJ,
      signature: SIG,
      status: MEMORY_GOVERNANCE_STATUS.ACTIVE,
      revision: 2,
    });
    const [a, b] = await Promise.all([
      rollbackGovernanceRecord({
        targetMemoryId: old.memoryId,
        companyId: COMPANY_A,
        expectedRevision: 1,
        actorId: "t1",
      }),
      rollbackGovernanceRecord({
        targetMemoryId: old.memoryId,
        companyId: COMPANY_A,
        expectedRevision: 1,
        actorId: "t2",
      }),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const fails = [a, b].filter((r) => !r.ok);
    assert.equal(oks.length, 1);
    assert.equal(fails.length, 1);
    assert.equal(fails[0].code, "REVISION_CONFLICT");
    const actives = __listGovernanceTestRecords().filter(
      (r) => r.status === MEMORY_GOVERNANCE_STATUS.ACTIVE && r.signature === SIG
    );
    assert.equal(actives.length, 1);
  });

  it("aynı expectedRevision iki mutation → ikincisi REVISION_CONFLICT", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: FAIZ,
      signature: SIG,
    });
    const first = await deactivateGovernanceRecord({
      memoryId: base.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      actorId: "a",
    });
    const second = await reactivateGovernanceRecord({
      memoryId: base.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      actorId: "b",
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.code, "REVISION_CONFLICT");
  });

  it("mevcut duplicate active migration preflight → hard delete olmadan review", () => {
    const rows = [
      {
        id: "d1",
        company_id: COMPANY_A,
        keyword: SIG,
        luca_leg: "counter",
        account_code: FAIZ,
        status: "active",
        is_active: true,
        document_type: BANK_STATEMENT_ACCOUNTING_DOC,
        updated_at: "2026-09-01T10:00:00.000Z",
        governance_ready: false,
      },
      {
        id: "d2",
        company_id: COMPANY_A,
        keyword: SIG,
        luca_leg: "counter",
        account_code: STOPAJ,
        status: "active",
        is_active: true,
        document_type: BANK_STATEMENT_ACCOUNTING_DOC,
        updated_at: "2026-09-02T10:00:00.000Z",
        governance_ready: false,
      },
    ];
    const out = runMigration037Preflight(rows);
    assert.equal(out.hardDeletes, 0);
    assert.ok(out.rows.every((r) => r.status === "review"));
    assert.ok(out.rows.every((r) => r.reason_code === "migration_037_preflight_conflict"));
    assert.ok(out.rows.every((r) => r.governance_ready === true));
  });

  it("migration ikinci çalıştırma → idempotent", () => {
    const rows = [
      {
        id: "i1",
        company_id: COMPANY_A,
        keyword: SIG,
        luca_leg: "counter",
        account_code: FAIZ,
        status: "active",
        is_active: true,
        document_type: BANK_STATEMENT_ACCOUNTING_DOC,
        updated_at: "2026-09-01T10:00:00.000Z",
        governance_ready: false,
      },
    ];
    const first = runMigration037Preflight(rows);
    const second = runMigration037Preflight(first.rows);
    assert.equal(second.changed, false);
    assert.equal(second.idempotent, true);
    assert.deepEqual(
      second.rows.map((r) => r.status),
      first.rows.map((r) => r.status)
    );
  });

  it("legacy lucaLeg belirsiz → review", () => {
    const rows = [
      {
        id: "l1",
        company_id: COMPANY_A,
        keyword: SIG,
        luca_leg: "",
        account_code: "XXX.UNKNOWN",
        status: "active",
        is_active: true,
        document_type: BANK_STATEMENT_ACCOUNTING_DOC,
        governance_ready: false,
      },
    ];
    const out = runMigration037Preflight(rows);
    assert.equal(out.rows[0].status, "review");
    assert.equal(out.rows[0].reason_code, "migration_037_ambiguous_leg");
  });

  it("unique index sonrası aynı signature+leg iki active oluşamaz", () => {
    const rows = [
      {
        id: "u1",
        company_id: COMPANY_A,
        keyword: SIG,
        luca_leg: "counter",
        account_code: FAIZ,
        status: "active",
        is_active: true,
      },
      {
        id: "u2",
        company_id: COMPANY_A,
        keyword: SIG,
        luca_leg: "counter",
        account_code: STOPAJ,
        status: "active",
        is_active: true,
      },
    ];
    const inv = assertUniqueActiveInvariant(rows);
    assert.equal(inv.ok, false);
  });

  it("farklı leg aynı signature altında birlikte active olabilir", () => {
    const rows = [
      {
        id: "f1",
        company_id: COMPANY_A,
        keyword: "shared-sig",
        luca_leg: "statement",
        account_code: SHARED_102,
        status: "active",
        is_active: true,
      },
      {
        id: "f2",
        company_id: COMPANY_A,
        keyword: "shared-sig",
        luca_leg: "counter",
        account_code: FAIZ,
        status: "active",
        is_active: true,
      },
    ];
    assert.equal(assertUniqueActiveInvariant(rows).ok, true);
    assert.equal(canHaveTwoActivesDifferentLegs(rows), true);
  });

  it("keyword listeleme governance kapısından", () => {
    const kw = {
      id: "kw1",
      company_id: COMPANY_A,
      document_type: "DK",
      account_code: "120.01",
      keyword: "EFT HAVALE",
      status: "active",
      is_active: true,
      bank_name: "ZIRAAT",
      transaction_type: "EFT",
    };
    const views = listGovernanceViewsFromServerRows([kw], { companyId: COMPANY_A });
    assert.equal(views.length, 1);
    assert.equal(views[0].kind, "keyword");
    const ui = toGovernanceUiRow(views[0]);
    assert.equal(ui.kind, "keyword");
    assert.match(ui.sourceLabel, /anahtar/i);
  });

  it("keyword deactivate/reactivate revision ve audit", async () => {
    const base = seedGovernanceTestRecord({
      companyId: COMPANY_A,
      accountCode: "120.01",
      signature: "kw|eft|havale",
      lucaLeg: "",
      kind: "keyword",
    });
    const deact = await deactivateGovernanceRecord({
      memoryId: base.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
      actorId: "u1",
    });
    assert.equal(deact.ok, true);
    assert.equal(deact.record.revision, 2);
    assert.ok(__listGovernanceTestAudits().some((a) => a.action === MEMORY_GOVERNANCE_ACTION.DEACTIVATE));
    const react = await reactivateGovernanceRecord({
      memoryId: base.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 2,
      actorId: "u1",
    });
    assert.equal(react.ok, true);
    assert.equal(react.record.status, MEMORY_GOVERNANCE_STATUS.ACTIVE);
  });

  it("pasif keyword consumer’da uygulanmaz", () => {
    const passive = {
      id: "kwp",
      company_id: COMPANY_A,
      document_type: "DK",
      account_code: "120.01",
      keyword: "EFT",
      status: "passive",
      is_active: false,
    };
    assert.equal(isKeywordRowAutoApplicable(passive), false);
    const suggestion = findLearningSuggestion(
      { companyId: COMPANY_A, keyword: "EFT", rawDescription: "EFT ödemesi" },
      [passive]
    );
    assert.equal(suggestion, null);
  });

  it("eski API’den governance status bypass edilemez", () => {
    const route = fs.readFileSync(
      path.join(root, "app/api/learning-memory/route.js"),
      "utf8"
    );
    assert.match(route, /GOVERNANCE_REQUIRED/);
    assert.match(route, /hasGovernanceLifecycleMutation/);
    assert.match(route, /DELETE_DISABLED/);
    assert.match(route, /status: 405/);
  });

  it("başka tenant memoryId varlığını sızdırmaz", async () => {
    const b = seedGovernanceTestRecord({
      companyId: COMPANY_B,
      accountCode: STOPAJ,
      signature: SIG,
    });
    const missing = await deactivateGovernanceRecord({
      memoryId: "does-not-exist",
      companyId: COMPANY_A,
      expectedRevision: 1,
    });
    const cross = await deactivateGovernanceRecord({
      memoryId: b.memoryId,
      companyId: COMPANY_A,
      expectedRevision: 1,
    });
    assert.equal(missing.code, "NOT_FOUND");
    assert.equal(cross.code, "NOT_FOUND");
  });

  it("doğrudan authenticated client mutation reddedilir", () => {
    const mig = fs.readFileSync(
      path.join(root, "supabase/migrations/037_accounting_memory_governance.sql"),
      "utf8"
    );
    assert.match(mig, /revoke insert, update, delete on table public.learning_memory from authenticated/i);
    assert.match(mig, /drop policy if exists "learning_memory_insert_authenticated"/);
    assert.match(mig, /drop policy if exists "learning_memory_update_authenticated"/);
    assert.match(mig, /drop policy if exists "learning_memory_delete_authenticated"/);
    assert.match(mig, /for select/);
  });

  it("UI kaynaklarında Sil aksiyonu yok", () => {
    const panel = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/components/AccountMemoryV2Panel.jsx"),
      "utf8"
    );
    const page = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/ogrenen-hafiza/page.jsx"),
      "utf8"
    );
    assert.doesNotMatch(panel, />\s*Sil\s*</);
    assert.doesNotMatch(page, />\s*Sil\s*</);
    assert.doesNotMatch(page, /deleteLearningMemoryRecord/);
    assert.doesNotMatch(page, /updateLearningMemoryRecord\([\s\S]*status:/);
    assert.match(page, /deactivateAccountingMemoryRecord/);
    assert.match(page, /reactivateAccountingMemoryRecord/);
  });

  it("migration yokken sahte mutation başarısı yok", async () => {
    const missing = await invokeLearningMemoryGovernanceRpc(null, {
      action: "deactivate",
      companyId: COMPANY_A,
      memoryId: "x",
      expectedRevision: 1,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "MIGRATION_REQUIRED");

    const fakeSupabase = {
      rpc: async () => ({
        data: null,
        error: { message: "Could not find the function learning_memory_governance_mutate" },
      }),
    };
    const result = await invokeLearningMemoryGovernanceRpc(fakeSupabase, {
      action: "deactivate",
      companyId: COMPANY_A,
      memoryId: "x",
      expectedRevision: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MIGRATION_REQUIRED");

    const panel = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/components/AccountMemoryV2Panel.jsx"),
      "utf8"
    );
    assert.match(panel, /MIGRATION_REQUIRED/);
    assert.match(panel, /Sahte başarı gösterilmez/);
  });
});
