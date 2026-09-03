/**
 * Fiş Kontrol → server accounting memory (Faz 2) regresyon.
 * Run: node --import ./scripts/_alias-loader.mjs --test ./scripts/test-fis-control-server-accounting-memory.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const {
  shouldPersistFisKontrolAccountingDecision,
  persistFisKontrolAccountingDecision,
  FIS_KONTROL_SOURCE_MODULE,
  FIS_KONTROL_LEARN_MSG,
} = await import("@/src/utils/fisKontrolAccountingMemory.js");

const {
  mapServerAccountingRowToV2,
  BANK_STATEMENT_ACCOUNTING_DOC,
} = await import("@/src/utils/accountingMemoryV1.js");

const {
  resolveAccountingDecision,
  ACCOUNTING_DECISION_SOURCE,
} = await import("@/src/utils/centralAccountingDecisionResolver.js");

const { buildSafeLearningMemoryPayload } = await import(
  "@/src/utils/learningMemorySafePayload.js"
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const PLAN = ["102.01.037", "102.10.V001", "320.01.USER", "642.01.001"];

function makeRow(overrides = {}) {
  return {
    id: "sl-1",
    hesapKodu: "102.10.V001",
    hesapAdi: "Vadesiz",
    direction: "GIRIS",
    transactionType: "FAIZ_GELIRI",
    analysisKey: "FAIZ GELIR ODEME KATEGORI",
    detayAciklama: "FAIZ GELIR ODEME KATEGORI",
    fisAciklama: "FAIZ",
    belgeTuru: "DK",
    kaynakAdi: "VAKIFBANK",
    borc: 100,
    alacak: 0,
    currency: "TRY",
    ...overrides,
  };
}

function makeCreateStore() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    createRecord: async (payload) => {
      seq += 1;
      const data = {
        id: `srv-${seq}`,
        ...payload,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      rows.push(data);
      return { data, error: null };
    },
    updateRecord: async (id, fields) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return { ok: false };
      rows[idx] = { ...rows[idx], ...fields };
      return { ok: true, data: rows[idx] };
    },
  };
}

test("1. Learn işaretli + geçerli firma + geçerli hesap → server persist", async () => {
  const api = makeCreateStore();
  const current = makeRow();
  const updated = makeRow({ hesapKodu: "320.01.USER", hesapAdi: "Cari" });
  const result = await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    company: { id: "mare", bankAccounts: [] },
    currentRow: current,
    updatedRow: updated,
    draft: {
      saveToMemory: true,
      originalAccountCode: current.hesapKodu,
      accountCode: updated.hesapKodu,
    },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
    fetchExisting: async () => ({ data: [] }),
  });
  assert.equal(result.persisted || result.learned, true);
  assert.equal(api.rows.length, 1);
  assert.equal(api.rows[0].document_type, BANK_STATEMENT_ACCOUNTING_DOC);
  assert.equal(api.rows[0].account_code, "320.01.USER");
  assert.equal(api.rows[0].company_id, "mare");
});

test("2. Learn işaretsiz → server persist çağrılmaz", async () => {
  let created = 0;
  const result = await persistFisKontrolAccountingDecision({
    learnForCompany: false,
    companyId: "mare",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: false, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: async () => {
      created += 1;
      return { data: null, error: null };
    },
    fetchExisting: async () => ({ data: [] }),
  });
  assert.equal(result.skipped, true);
  assert.equal(result.rejectReason, "remember_not_checked");
  assert.equal(created, 0);
});

test("3. Firma yok → yazılmaz", () => {
  const gate = shouldPersistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "",
    accountCode: "320.01.USER",
    accountPlanCodes: PLAN,
    direction: "GIRIS",
    descriptionOrKey: "FAIZ",
    accountChanged: true,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "missing_company");
});

test("4. Hesap planında olmayan hesap → yazılmaz", () => {
  const gate = shouldPersistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    accountCode: "999.99.999",
    accountPlanCodes: PLAN,
    direction: "GIRIS",
    descriptionOrKey: "FAIZ",
    accountChanged: true,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "account_not_in_plan");
});

test("5. Otomatik analiz → yazılmaz", () => {
  const gate = shouldPersistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    accountCode: "320.01.USER",
    accountPlanCodes: PLAN,
    direction: "GIRIS",
    descriptionOrKey: "FAIZ",
    accountChanged: true,
    autoAnalysis: true,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "auto_analysis");
});

test("6. DOCUMENT_ONLY karar firma hafızasına yazılmaz", () => {
  const gate = shouldPersistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    accountCode: "320.01.USER",
    accountPlanCodes: PLAN,
    direction: "GIRIS",
    descriptionOrKey: "FAIZ",
    accountChanged: true,
    isDocumentOnly: true,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "document_only");
});

test("7. Başarılı persist → local cache güncellenir (serverPersisted)", async () => {
  const api = makeCreateStore();
  const result = await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    company: { id: "mare" },
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
    fetchExisting: async () => ({ data: [] }),
  });
  assert.equal(Boolean(result.persisted || result.learned), true);
  assert.ok(result.localRecord || result.activeCache >= 0);
});

test("8. Server hata → satır düzeltmesi korunur, canonical başarı yok", async () => {
  const result = await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: async () => ({ data: null, error: "boom" }),
    fetchExisting: async () => ({ data: [] }),
  });
  assert.equal(result.persisted, false);
  assert.equal(result.learned, false);
  assert.equal(result.message, FIS_KONTROL_LEARN_MSG.EDIT_MEMORY_FAILED);
});

test("9. Server hata → local-only canonical öğrenme sayılmaz", async () => {
  const result = await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: async () => ({ data: null, error: "fail" }),
    fetchExisting: async () => ({ data: [] }),
  });
  assert.notEqual(result.toastKind, "saved");
  assert.equal(result.localCanonical, false);
});

test("10. Aynı karar tekrar → mükerrer aktif kayıt yok", async () => {
  const api = makeCreateStore();
  const args = {
    learnForCompany: true,
    companyId: "mare",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
  };
  const first = await persistFisKontrolAccountingDecision({
    ...args,
    existingServerRows: [],
    fetchExisting: async () => ({ data: [] }),
  });
  assert.ok(first.persisted || first.learned);
  const second = await persistFisKontrolAccountingDecision({
    ...args,
    existingServerRows: api.rows.slice(),
    fetchExisting: async () => ({ data: api.rows.slice() }),
  });
  assert.equal(api.rows.filter((r) => r.status !== "passive").length, 1);
  assert.ok(second.reused || second.persisted || second.learned);
});

test("11. Aynı scope yeni hesap → eski passive / yeni aktif", async () => {
  const api = makeCreateStore();
  const base = {
    learnForCompany: true,
    companyId: "mare",
    currentRow: makeRow(),
    accountPlanCodes: PLAN,
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
  };
  await persistFisKontrolAccountingDecision({
    ...base,
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    existingServerRows: [],
    fetchExisting: async () => ({ data: [] }),
  });
  await persistFisKontrolAccountingDecision({
    ...base,
    updatedRow: makeRow({ hesapKodu: "642.01.001" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    existingServerRows: api.rows.slice(),
    fetchExisting: async () => ({ data: api.rows.slice() }),
  });
  const active = api.rows.filter(
    (r) => String(r.status || "active") === "active"
  );
  const passive = api.rows.filter((r) => r.status === "passive");
  assert.equal(active.length, 1);
  assert.equal(active[0].account_code, "642.01.001");
  assert.ok(passive.length >= 1);
});

test("12. Firma A kararı firma B'ye taşmaz", async () => {
  const api = makeCreateStore();
  await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "firma-a",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
    fetchExisting: async () => ({ data: [] }),
  });
  assert.equal(api.rows[0].company_id, "firma-a");
  const forB = api.rows.filter((r) => r.company_id === "firma-b");
  assert.equal(forB.length, 0);
});

test("13. created_by spoof edilemez (payload sanitize)", () => {
  const safe = buildSafeLearningMemoryPayload({
    company_id: "mare",
    keyword: "bsa|x",
    account_code: "320.01.USER",
    document_type: BANK_STATEMENT_ACCOUNTING_DOC,
    created_by: "attacker",
    createdBy: "attacker",
    user_correction: JSON.stringify({ createdBy: "attacker", confidence: 95 }),
  });
  assert.equal(safe.created_by, undefined);
  assert.equal(safe.createdBy, undefined);
});

test("14. hassas ham IBAN/açıklama payload'da yok", async () => {
  const api = makeCreateStore();
  await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    currentRow: makeRow({
      analysisKey: "TR33000670100000000158018033973987 FAIZ 1500,00",
      detayAciklama: "TR33000670100000000158018033973987 FAIZ 1500,00",
    }),
    updatedRow: makeRow({
      hesapKodu: "320.01.USER",
      analysisKey: "TR33000670100000000158018033973987 FAIZ 1500,00",
      detayAciklama: "TR33000670100000000158018033973987 FAIZ 1500,00",
    }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
    fetchExisting: async () => ({ data: [] }),
  });
  const blob = JSON.stringify(api.rows[0] || {});
  assert.doesNotMatch(blob, /TR33/i);
  assert.doesNotMatch(blob, /00158018033973987/);
});

test("15. server kaydı USER_LEARNED olarak resolver'a verilebilir", async () => {
  const api = makeCreateStore();
  await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
    fetchExisting: async () => ({ data: [] }),
  });
  const v2 = mapServerAccountingRowToV2(api.rows[0]);
  assert.ok(v2);
  assert.equal(v2.companyId, "mare");
  assert.equal(v2.accountCode, "320.01.USER");

  const decision = resolveAccountingDecision({
    company: { id: "mare", bankProductMappings: [], bankAccounts: [] },
    companyId: "mare",
    accountPlan: PLAN.map((c) => ({ code: c })),
    bankName: "VAKIFBANK",
    productType: "",
    currency: "TRY",
    description: "FAIZ GELIR ODEME KATEGORI",
    direction: "GIRIS",
    transactionType: "FAIZ_GELIRI",
    learningMemory: api.rows,
  });
  assert.equal(decision.source, ACCOUNTING_DECISION_SOURCE.USER_LEARNED);
  assert.equal(decision.accountCode, "320.01.USER");
});

test("16. Fiş Kontrol wiring: showMemoryOption açık + server adapter", () => {
  const page = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/fis-kontrol/page.jsx"),
    "utf8"
  );
  assert.match(page, /persistFisKontrolAccountingDecision/);
  assert.match(page, /showMemoryOption=\{true\}/);
  assert.match(page, /Bu firma için öğren/);
  assert.match(page, /FIS_KONTROL_LEARN_MSG/);
  assert.match(page, /saveToMemory:\s*false/);
  assert.match(page, /draftRow\.saveToMemory === true/);
  assert.doesNotMatch(page, /saveAccountMemoryV2Decision\s*\(/);
});

test("17. ilk açılış / draft builder checkbox false", async () => {
  const { buildStandardLucaRowEditDraft } = await import(
    "@/src/utils/previewRowEdit.js"
  );
  const draft = buildStandardLucaRowEditDraft({
    hesapKodu: "102.10.V001",
    fisNo: "1",
  });
  assert.equal(draft.saveToMemory, false);
  assert.equal(draft.learnForCompany, false);
});

test("18. openEdit / firma değişimi / payload reset checkbox false (wiring)", () => {
  const page = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/fis-kontrol/page.jsx"),
    "utf8"
  );
  // openEdit her seferinde false zorlar
  assert.match(
    page,
    /setDraftRow\(\{[\s\S]*buildStandardLucaRowEditDraft\([\s\S]*saveToMemory:\s*false[\s\S]*learnForCompany:\s*false/
  );
  // firma değişiminde edit session temizlenir
  assert.match(
    page,
    /selectedCompanyId[\s\S]*setEditingRowId\(null\)[\s\S]*setDraftRow\(null\)/
  );
  // yeni payload / sonuçta edit session temizlenir
  assert.match(
    page,
    /applyNormalizedPayload[\s\S]*setEditingRowId\(null\)[\s\S]*setDraftRow\(null\)/
  );
  // cancelEdit draft'ı null'lar → panel kapanınca state yok
  assert.match(page, /const cancelEdit = \(\) => \{[\s\S]*setDraftRow\(null\)/);
});

test("19. learn=false → server/local memory çağrısı yok", async () => {
  let created = 0;
  const result = await persistFisKontrolAccountingDecision({
    learnForCompany: false,
    companyId: "mare",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: false, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: async () => {
      created += 1;
      return { data: { id: "x" }, error: null };
    },
    fetchExisting: async () => ({ data: [] }),
  });
  assert.equal(result.skipped, true);
  assert.equal(result.rejectReason, "remember_not_checked");
  assert.equal(created, 0);
  assert.equal(result.message, FIS_KONTROL_LEARN_MSG.EDIT_ONLY);
});

test("20. learn=true → server başarıdan sonra learned/persisted", async () => {
  const api = makeCreateStore();
  const result = await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
    fetchExisting: async () => ({ data: [] }),
  });
  assert.equal(Boolean(result.persisted || result.learned), true);
  assert.equal(result.message, FIS_KONTROL_LEARN_MSG.SAVED);
  assert.equal(api.rows.length, 1);
});

test("21. server fail → satır düzeltmesi korunur, öğrenme başarısı yok", async () => {
  const result = await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: async () => ({ data: null, error: "fail" }),
    fetchExisting: async () => ({ data: [] }),
  });
  assert.equal(result.persisted, false);
  assert.equal(result.learned, false);
  assert.notEqual(result.toastKind, "saved");
  assert.equal(result.message, FIS_KONTROL_LEARN_MSG.EDIT_MEMORY_FAILED);
});

test("22. satır aksiyonu Düzenle → openEdit + expanded panel (wiring)", () => {
  const page = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/fis-kontrol/page.jsx"),
    "utf8"
  );
  const table = fs.readFileSync(
    path.join(root, "src/components/AnnveroEditableDataTable.jsx"),
    "utf8"
  );
  assert.match(page, /onClick=\{[\s\S]*openEdit\(row\)/);
  assert.match(page, />\s*Düzenle\s*</);
  assert.doesNotMatch(page, /editingRowId === row\.id \? "Detay"/);
  assert.match(page, /renderExpandedRow=/);
  assert.match(page, /data-testid="fis-kontrol-edit-panel"/);
  assert.match(page, /resolveStandardLucaEditRowId/);
  assert.match(table, /renderExpandedRow/);
  assert.match(table, /renderExpandedRow && isEditing/);
});

test("23. openEdit session: editingRowId + draft + checkbox false + cancel", async () => {
  const {
    buildStandardLucaRowEditDraft,
    resolveStandardLucaEditRowId,
  } = await import("@/src/utils/previewRowEdit.js");

  // Simulate openEdit session state machine (no React)
  let editingRowId = null;
  let draftRow = null;
  const openEdit = (row, index = 0) => {
    const rowId = resolveStandardLucaEditRowId(row, index);
    editingRowId = rowId;
    draftRow = {
      ...buildStandardLucaRowEditDraft({ ...row, id: rowId }),
      saveToMemory: false,
      learnForCompany: false,
    };
  };
  const cancelEdit = () => {
    editingRowId = null;
    draftRow = null;
  };

  const rowA = { id: "a-1", hesapKodu: "102.01", fisNo: "1" };
  const rowB = { id: "b-2", hesapKodu: "120.01", fisNo: "1" };

  assert.doesNotThrow(() => openEdit(rowA));
  assert.equal(editingRowId, "a-1");
  assert.ok(draftRow);
  assert.equal(draftRow.saveToMemory, false);
  assert.equal(Boolean(editingRowId && draftRow), true); // panel render gate

  openEdit(rowB);
  assert.equal(editingRowId, "b-2");
  assert.equal(draftRow.saveToMemory, false);
  assert.notEqual(draftRow.accountCode, "102.01");

  cancelEdit();
  assert.equal(editingRowId, null);
  assert.equal(draftRow, null);
});

test("24. eksik row.id → stabil kimlik; panel gate açılır", async () => {
  const {
    buildStandardLucaRowEditDraft,
    resolveStandardLucaEditRowId,
  } = await import("@/src/utils/previewRowEdit.js");

  const orphan = {
    fisNo: "3",
    hesapKodu: "642.01",
    _kontrol: { rowIndex: 7, identityKey: "abc123" },
  };
  const rowId = resolveStandardLucaEditRowId(orphan, 6);
  assert.ok(rowId);
  assert.notEqual(rowId, "undefined");
  const draft = {
    ...buildStandardLucaRowEditDraft({ ...orphan, id: rowId }),
    saveToMemory: false,
  };
  assert.equal(Boolean(rowId && draft), true);
  assert.equal(draft.saveToMemory, false);

  const totallyBare = {};
  const fallbackId = resolveStandardLucaEditRowId(totallyBare, 0);
  assert.equal(fallbackId, "sl-edit-1");
});

test("25. 24 satırlık MARE benzeri payload: ilk ve son satır edit paneli açılır", async () => {
  const { bankMovementsToStandardLucaRows, ensureStandardLucaRowIds, finalizeStandardLucaRow } =
    await import("@/src/utils/standardLucaRow.js");
  const { analyzeStandardLucaRows } = await import("@/src/utils/fisKontrolMerkezi.js");
  const {
    buildStandardLucaRowEditDraft,
    resolveStandardLucaEditRowId,
  } = await import("@/src/utils/previewRowEdit.js");

  const movements = Array.from({ length: 12 }, (_, i) => ({
    id: `mare-${i}`,
    date: "15.01.2026",
    direction: i % 2 === 0 ? "GIRIS" : "CIKIS",
    amount: 1000 + i,
    accountCode: "102.10.V001",
    counterAccountCode: "120.01.001",
    documentType: "DK",
    lucaDescription: `MARE hareket ${i}`,
    description: `MARE hareket ${i}`,
    bankName: "MARE",
    warning: "",
  }));

  const lucaRows = ensureStandardLucaRowIds(
    bankMovementsToStandardLucaRows(movements, {
      firmaId: "mare-co",
      kaynakAdi: "MARE",
    }).map((row) => finalizeStandardLucaRow({ ...row, firmaId: "mare-co" }))
  );
  assert.equal(lucaRows.length, 24);

  const analysis = analyzeStandardLucaRows(lucaRows, { firmaId: "mare-co" });
  assert.equal(analysis.rows.length, 24);

  const first = analysis.rows[0];
  const last = analysis.rows[23];
  const firstId = resolveStandardLucaEditRowId(first, 0);
  const lastId = resolveStandardLucaEditRowId(last, 23);
  assert.ok(firstId);
  assert.ok(lastId);
  assert.notEqual(firstId, lastId);

  const firstDraft = {
    ...buildStandardLucaRowEditDraft({ ...first, id: firstId }),
    saveToMemory: false,
  };
  const lastDraft = {
    ...buildStandardLucaRowEditDraft({ ...last, id: lastId }),
    saveToMemory: false,
  };
  assert.equal(Boolean(firstId && firstDraft), true);
  assert.equal(Boolean(lastId && lastDraft), true);
  assert.equal(firstDraft.saveToMemory, false);
  assert.equal(lastDraft.saveToMemory, false);
  assert.doesNotThrow(() =>
    buildStandardLucaRowEditDraft(analysis.rows.find((r) => !r.id) || first)
  );
});

test("source_module FIS_KONTROL güvenli payload'da", async () => {
  const api = makeCreateStore();
  await persistFisKontrolAccountingDecision({
    learnForCompany: true,
    companyId: "mare",
    currentRow: makeRow(),
    updatedRow: makeRow({ hesapKodu: "320.01.USER" }),
    draft: { saveToMemory: true, originalAccountCode: "102.10.V001" },
    accountPlanCodes: PLAN,
    existingServerRows: [],
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
    fetchExisting: async () => ({ data: [] }),
  });
  assert.equal(api.rows[0].source_module, FIS_KONTROL_SOURCE_MODULE);
});
