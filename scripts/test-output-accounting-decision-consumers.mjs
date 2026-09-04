/**
 * Faz 4 — Luca / Elektraweb output consumers + merge-blocker coverage.
 * Run: node --import ./scripts/_alias-loader.mjs --test ./scripts/test-output-accounting-decision-consumers.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const {
  ACCOUNTING_DECISION_SOURCE,
  resolveAccountingDecision,
} = await import("@/src/utils/centralAccountingDecisionResolver.js");

const {
  ACCOUNTING_MEMORY_LUCA_LEG,
  consumeFirmAccountingMemory,
  BANK_STATEMENT_ACCOUNTING_DOC,
  mapServerAccountingRowToV2,
} = await import("@/src/utils/accountingMemoryV1.js");

const {
  buildAccountMemoryV2Index,
  applyAccountMemoryV2RecordsToRows,
} = await import("@/src/utils/accountMemoryV2.js");
const {
  sanitizeAccountingDecision,
  hasFrozenAccountingDecision,
  shouldSkipOutputResolve,
  stampRowAccountingDecision,
  stampManualAccountingDecision,
  stampBankMaterializedLucaRow,
  applyOutputAccountingDecisionOnce,
  applyOutputAccountingDecisionsToRows,
  assertOutputDecisionIdempotent,
  buildAccountingDecisionEnvelope,
  evaluateOutputExportDecisionGate,
  validateAccountingDecisionTrust,
  computeDecisionSignature,
} = await import("@/src/utils/outputAccountingDecisionFacade.js");

const {
  prepareElektrawebExportRows,
  ELEKTRAWEB_OUTPUT_FORMAT,
} = await import("@/src/utils/elektrawebOutputAdapter.js");

const {
  bankMovementsToStandardLucaRows,
  buildStandardLucaTransferPayload,
  stripStandardLucaRow,
  enrichElektrawebStandardLucaRow,
  buildElektrawebPreviewRows,
  KAYNAK_TIPI,
  finalizeStandardLucaRow,
  standardLucaRowsToExcelRows,
} = await import("@/src/utils/standardLucaRow.js");

const {
  applyLearningMemoryToStandardLucaRows,
} = await import("@/src/utils/bankLearningMemory.js");

const {
  applyStandardLucaRowEditDraft,
} = await import("@/src/utils/previewRowEdit.js");

const {
  persistFisKontrolAccountingDecision,
} = await import("@/src/utils/fisKontrolAccountingMemory.js");

const {
  analyzeStandardLucaRows,
} = await import("@/src/utils/fisKontrolMerkezi.js");

const COMPANY_A = "co-phase4-a";
const COMPANY_B = "co-phase4-b";

function dualMovement(i, overrides = {}) {
  return {
    id: `m-${i}`,
    amount: 1000 + i,
    direction: i % 2 === 0 ? "CIKIS" : "GIRIS",
    accountCode: "102.01.037",
    counterAccountCode: "120.01.001",
    description: `mov-${i}`,
    lucaDescription: `mov-${i}`,
    date: "15.01.2026",
    _accountingAnalyzed: true,
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

describe("Faz4 output accounting decision consumers", () => {
  it("geçerli zarf → resolve yok", () => {
    const row = stampBankMaterializedLucaRow(
      finalizeStandardLucaRow({
        firmaId: COMPANY_A,
        hesapKodu: "120.01.001",
        borc: 100,
        alacak: "",
        detayAciklama: "x",
        fisAciklama: "x",
        fisTarihi: "15.01.2026",
        belgeTuru: "DK",
      }),
      {
        bankAccountCode: "102.01.037",
        source: "USER_LEARNED",
        companyId: COMPANY_A,
        matchedMemoryId: "mem-1",
      }
    );
    assert.equal(
      shouldSkipOutputResolve(row, { companyId: COMPANY_A }),
      true
    );
    const after = applyOutputAccountingDecisionOnce(row, {
      companyId: COMPANY_A,
      learningMemory: [
        {
          id: "poison",
          company_id: COMPANY_A,
          account_code: "999.99.999",
          document_type: BANK_STATEMENT_ACCOUNTING_DOC,
          status: "active",
        },
      ],
    });
    assert.equal(after.hesapKodu, "120.01.001");
  });

  it("yanlış companyId → skip yok", () => {
    const row = stampBankMaterializedLucaRow(
      finalizeStandardLucaRow({
        firmaId: COMPANY_A,
        hesapKodu: "120.01.001",
        fisTarihi: "15.01.2026",
        belgeTuru: "DK",
        detayAciklama: "t",
      }),
      { bankAccountCode: "102.01.037", companyId: COMPANY_A }
    );
    assert.equal(
      shouldSkipOutputResolve(row, { companyId: COMPANY_B }),
      false
    );
    const trust = validateAccountingDecisionTrust(row, {
      companyId: COMPANY_B,
    });
    assert.equal(trust.reason, "tenant_mismatch");
  });

  it("hesap sonradan değişmiş → stale, skip yok", () => {
    const row = stampBankMaterializedLucaRow(
      finalizeStandardLucaRow({
        firmaId: COMPANY_A,
        hesapKodu: "120.01.001",
        fisTarihi: "15.01.2026",
        belgeTuru: "DK",
        detayAciklama: "s",
      }),
      { bankAccountCode: "102.01.037", companyId: COMPANY_A }
    );
    const stale = { ...row, hesapKodu: "340.01.010" };
    assert.equal(
      shouldSkipOutputResolve(stale, { companyId: COMPANY_A }),
      false
    );
    assert.equal(
      validateAccountingDecisionTrust(stale, { companyId: COMPANY_A }).reason,
      "stale_account_code"
    );
  });

  it("yanlış lucaLeg → skip yok", () => {
    const row = stampBankMaterializedLucaRow(
      finalizeStandardLucaRow({
        firmaId: COMPANY_A,
        hesapKodu: "120.01.001",
        fisTarihi: "15.01.2026",
        belgeTuru: "DK",
        detayAciklama: "leg",
      }),
      { bankAccountCode: "102.01.037", companyId: COMPANY_A }
    );
    const bad = {
      ...row,
      accountingDecision: {
        ...row.accountingDecision,
        lucaLeg: "statement", // 120 counter hesabı statement olamaz
        decisionSignature: computeDecisionSignature({
          ...row.accountingDecision,
          lucaLeg: "statement",
        }),
      },
    };
    assert.equal(shouldSkipOutputResolve(bad, { companyId: COMPANY_A }), false);
  });

  it("unsupported version/source → skip yok", () => {
    const row = stampBankMaterializedLucaRow(
      finalizeStandardLucaRow({
        firmaId: COMPANY_A,
        hesapKodu: "102.01.037",
        fisTarihi: "15.01.2026",
        belgeTuru: "DK",
        detayAciklama: "v",
      }),
      { bankAccountCode: "102.01.037", companyId: COMPANY_A }
    );
    const badVersion = {
      ...row,
      accountingDecision: {
        ...row.accountingDecision,
        schemaVersion: 99,
        decisionSignature: "deadbeef",
      },
    };
    assert.equal(
      shouldSkipOutputResolve(badVersion, { companyId: COMPANY_A }),
      false
    );
    const badSource = {
      ...row,
      accountingDecision: {
        ...row.accountingDecision,
        source: "HACKED_TIER",
        decisionSignature: "deadbeef",
      },
    };
    assert.equal(
      shouldSkipOutputResolve(badSource, { companyId: COMPANY_A }),
      false
    );
  });

  it("requiresReview → alt tier yok, export bloke", () => {
    const row = stampRowAccountingDecision(
      finalizeStandardLucaRow({
        firmaId: COMPANY_A,
        hesapKodu: "",
        detayAciklama: "rev",
        fisAciklama: "rev",
        fisTarihi: "15.01.2026",
        belgeTuru: "DK",
      }),
      buildAccountingDecisionEnvelope({
        matched: false,
        accountCode: null,
        source: ACCOUNTING_DECISION_SOURCE.NONE,
        requiresReview: true,
        reason: "conflict_review",
        lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
        companyId: COMPANY_A,
        resolvedAtStage: "output_facade",
      }),
      { companyId: COMPANY_A, resolvedAtStage: "output_facade" }
    );
    assert.equal(shouldSkipOutputResolve(row, { companyId: COMPANY_A }), true);
    const filled = applyLearningMemoryToStandardLucaRows(
      [row],
      [
        {
          id: "p",
          company_id: COMPANY_A,
          keyword: "rev",
          account_code: "120.01.001",
          status: "active",
        },
      ],
      { firmaId: COMPANY_A }
    );
    assert.equal(String(filled[0].hesapKodu || ""), "");
    const gate = evaluateOutputExportDecisionGate([row]);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "ACCOUNTING_DECISION_REVIEW");
    const elektra = prepareElektrawebExportRows([row], {
      companyId: COMPANY_A,
    });
    assert.equal(elektra.ok, false);
  });

  it("PII signature/evidence içinde yok", () => {
    const dirty = sanitizeAccountingDecision({
      matched: true,
      accountCode: "120.01.001",
      source: "USER_LEARNED",
      companyId: COMPANY_A,
      lucaLeg: "counter",
      resolvedAtStage: "bank_materialize",
      iban: "TR120006200000000000000000",
      accountNumber: "1234567890",
      description: "gizli uzun açıklama",
      evidence: { rawIban: "TR12", rawDescription: "secret" },
    });
    const json = JSON.stringify(dirty);
    assert.equal(json.includes("TR12"), false);
    assert.equal(json.includes("gizli"), false);
    assert.equal(dirty.evidence, undefined);
    assert.match(dirty.decisionSignature, /^[0-9a-f]{8}$/);
  });

  it("ikinci uygulama idempotent", () => {
    const rows = bankMovementsToStandardLucaRows([dualMovement(3)], {
      firmaId: COMPANY_A,
    });
    for (const row of rows) {
      const check = assertOutputDecisionIdempotent(row, {
        companyId: COMPANY_A,
      });
      assert.equal(check.ok, true);
    }
  });

  it("metadata-less satır facade üzerinden bir kez resolve + damga", () => {
    const bare = finalizeStandardLucaRow({
      firmaId: COMPANY_A,
      hesapKodu: "",
      detayAciklama: "bare",
      fisAciklama: "bare",
      fisTarihi: "15.01.2026",
      belgeTuru: "DK",
      direction: "CIKIS",
    });
    assert.equal(shouldSkipOutputResolve(bare, { companyId: COMPANY_A }), false);
    const once = applyOutputAccountingDecisionOnce(bare, {
      companyId: COMPANY_A,
    });
    assert.ok(once.accountingDecision);
    assert.equal(
      shouldSkipOutputResolve(once, { companyId: COMPANY_A }),
      true
    );
  });

  it("E2E: UI handler → Elektra adapter → çıktı satırları (Luca Excel değil wiring)", () => {
    const workbench = fs.readFileSync(
      path.join(
        root,
        "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
      ),
      "utf8"
    );
    assert.match(workbench, /exportElektrawebFromStandardLucaRows/);
    assert.match(workbench, /onDownloadElektra=\{\(\) => exportElektraweb\(\)\}/);
    assert.doesNotMatch(
      workbench,
      /onDownloadElektra=\{\(\) => exportExcel\(\)\}/
    );

    const rows = bankMovementsToStandardLucaRows(
      Array.from({ length: 4 }, (_, i) => dualMovement(i)),
      { firmaId: COMPANY_A }
    );
    const prepared = prepareElektrawebExportRows(rows, {
      companyId: COMPANY_A,
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.format, ELEKTRAWEB_OUTPUT_FORMAT);
    assert.equal(prepared.rows.length, 8);
    assert.equal(prepared.excelRows.length, 8);
    assert.ok(prepared.excelRows[0]["Hesap Kodu"]);
    // Aynı canonical hesaplar
    for (let i = 0; i < 8; i += 1) {
      assert.equal(prepared.rows[i].hesapKodu, rows[i].hesapKodu);
      assert.equal(String(prepared.rows[i].borc ?? ""), String(rows[i].borc ?? ""));
    }
    assert.ok(prepared.skippedResolveCount >= 8);
  });

  it("learn=false: server write yok; transferde manuel hesap korunur", async () => {
    let created = 0;
    const base = finalizeStandardLucaRow({
      firmaId: COMPANY_A,
      hesapKodu: "120.01.001",
      borc: 50,
      alacak: "",
      detayAciklama: "edit-me",
      fisAciklama: "edit-me",
      fisTarihi: "15.01.2026",
      belgeTuru: "DK",
      direction: "CIKIS",
      analysisKey: "EDIT ME|CIKIS",
      transactionType: "HAVALE",
      kaynakAdi: "VAKIFBANK",
    });
    const edited = applyStandardLucaRowEditDraft(base, {
      accountCode: "340.01.010",
      accountName: "Manuel",
      detayAciklama: "edit-me",
      fisAciklama: "edit-me",
      fisTarihi: "15.01.2026",
      documentType: "DK",
      borc: 50,
      alacak: "",
      learnForCompany: false,
      saveToMemory: false,
      originalAccountCode: "120.01.001",
    });
    const persist = await persistFisKontrolAccountingDecision({
      learnForCompany: false,
      companyId: COMPANY_A,
      company: { id: COMPANY_A },
      currentRow: base,
      updatedRow: edited,
      draft: {
        saveToMemory: false,
        learnForCompany: false,
        originalAccountCode: "120.01.001",
        accountCode: "340.01.010",
      },
      accountPlanCodes: ["120.01.001", "340.01.010", "102.01.037"],
      createRecord: async () => {
        created += 1;
        return { data: null, error: null };
      },
    });
    assert.equal(created, 0);
    assert.equal(persist.persisted || persist.learned, false);
    assert.equal(edited.hesapKodu, "340.01.010");
    assert.ok(edited.accountingDecision);
    const stripped = stripStandardLucaRow(edited);
    const elektra = prepareElektrawebExportRows([stripped], {
      companyId: COMPANY_A,
    });
    assert.equal(elektra.rows[0].hesapKodu, "340.01.010");
  });

  it("learn=true: persist + zarf + Luca/Elektra aynı counter + sonraki USER_LEARNED", async () => {
    const api = makeCreateStore();
    const statement = finalizeStandardLucaRow({
      firmaId: COMPANY_A,
      hesapKodu: "102.01.037",
      alacak: 1000,
      borc: "",
      detayAciklama: "FAIZ TEST ODEME",
      fisAciklama: "FAIZ",
      fisTarihi: "15.01.2026",
      belgeTuru: "DK",
      direction: "GIRIS",
      analysisKey: "FAIZ TEST ODEME|GIRIS",
      transactionType: "FAIZ_GELIRI",
      kaynakAdi: "VAKIFBANK",
      lineRole: "alacak",
      creationSource: "bank_double_entry",
    });
    const counter = finalizeStandardLucaRow({
      firmaId: COMPANY_A,
      hesapKodu: "642.01.001",
      borc: 1000,
      alacak: "",
      detayAciklama: "FAIZ TEST ODEME",
      fisAciklama: "FAIZ",
      fisTarihi: "15.01.2026",
      belgeTuru: "DK",
      direction: "GIRIS",
      analysisKey: "FAIZ TEST ODEME|GIRIS",
      transactionType: "FAIZ_GELIRI",
      kaynakAdi: "VAKIFBANK",
      lineRole: "borc",
      creationSource: "bank_double_entry",
    });
    const editedCounter = applyStandardLucaRowEditDraft(counter, {
      accountCode: "320.01.USER",
      accountName: "Cari",
      detayAciklama: "FAIZ TEST ODEME",
      fisAciklama: "FAIZ",
      fisTarihi: "15.01.2026",
      documentType: "DK",
      borc: 1000,
      alacak: "",
      learnForCompany: true,
      saveToMemory: true,
      originalAccountCode: "642.01.001",
    });
    assert.equal(editedCounter.accountingDecision.lucaLeg, "counter");

    const persist = await persistFisKontrolAccountingDecision({
      learnForCompany: true,
      companyId: COMPANY_A,
      company: { id: COMPANY_A, bankAccounts: [] },
      currentRow: counter,
      updatedRow: editedCounter,
      draft: {
        saveToMemory: true,
        learnForCompany: true,
        originalAccountCode: "642.01.001",
        accountCode: "320.01.USER",
      },
      accountPlanCodes: [
        "102.01.037",
        "642.01.001",
        "320.01.USER",
        "193.01.001",
      ],
      existingServerRows: [],
      createRecord: api.createRecord,
      updateRecord: api.updateRecord,
      fetchExisting: async () => ({ data: [] }),
    });
    assert.equal(persist.persisted || persist.learned, true);
    assert.equal(api.rows.length, 1);
    assert.equal(api.rows[0].account_code, "320.01.USER");
    assert.equal(api.rows[0].document_type, BANK_STATEMENT_ACCOUNTING_DOC);

    const queue = buildStandardLucaTransferPayload({
      firmaId: COMPANY_A,
      companyName: "A",
      kaynakTipi: KAYNAK_TIPI.BANKA,
      source: "bank",
      runId: "learn-true",
      movementCount: 1,
      rows: [statement, editedCounter],
    });
    assert.equal(queue.rows[1].hesapKodu, "320.01.USER");
    assert.ok(queue.rows[1].accountingDecision);

    const elektra = prepareElektrawebExportRows(queue.rows, {
      companyId: COMPANY_A,
    });
    assert.equal(elektra.ok, true);
    assert.equal(elektra.rows[1].hesapKodu, "320.01.USER");
    // Exporter ezmez
    const poisoned = applyLearningMemoryToStandardLucaRows(
      elektra.rows,
      [
        {
          id: "p",
          company_id: COMPANY_A,
          keyword: "FAIZ",
          account_code: "999.99.999",
          status: "active",
        },
      ],
      { firmaId: COMPANY_A }
    );
    assert.equal(poisoned[1].hesapKodu, "320.01.USER");

    // Sonraki banka analizinde USER_LEARNED (in-memory server rows → V2 index)
    const v2 = api.rows.map(mapServerAccountingRowToV2).filter(Boolean);
    const index = buildAccountMemoryV2Index(v2, COMPANY_A);
    const hit = consumeFirmAccountingMemory({
      companyId: COMPANY_A,
      bankName: "VAKIFBANK",
      direction: "GIRIS",
      transactionType: "FAIZ_GELIRI",
      currency: "TRY",
      descriptionOrKey: "FAIZ TEST ODEME",
      analysisKey: "FAIZ TEST ODEME|GIRIS",
      lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
      accountMemoryIndex: index,
      accountPlanCodes: [
        "102.01.037",
        "642.01.001",
        "320.01.USER",
        "193.01.001",
      ],
    });
    assert.equal(hit.mode, "auto");
    assert.equal(hit.record.accountCode, "320.01.USER");

    // statement leg değişmez
    assert.equal(queue.rows[0].hesapKodu, "102.01.037");
  });

  it("kapsam: doğrulanmamış zarfta LM/V2 hâlâ çalışır; doğrulanmışta skip", () => {
    const bare = finalizeStandardLucaRow({
      firmaId: COMPANY_A,
      hesapKodu: "",
      detayAciklama: "ODENECEK STOPAJ",
      fisAciklama: "STOPAJ",
      fisTarihi: "15.01.2026",
      belgeTuru: "DK",
      direction: "CIKIS",
      analysisKey: "ODENECEK STOPAJ|CIKIS",
    });
    // Untrusted fake envelope
    const fake = {
      ...bare,
      accountingDecision: {
        schemaVersion: 1,
        matched: true,
        accountCode: "193.01.001",
        source: "USER_LEARNED",
        lucaLeg: "counter",
        companyId: COMPANY_A,
        resolvedAtStage: "bank_materialize",
        decisionSignature: "00000000", // wrong
        requiresReview: false,
      },
    };
    assert.equal(shouldSkipOutputResolve(fake, { companyId: COMPANY_A }), false);

    const trusted = stampBankMaterializedLucaRow(
      finalizeStandardLucaRow({
        ...bare,
        hesapKodu: "193.01.001",
      }),
      { bankAccountCode: "102.01.037", companyId: COMPANY_A }
    );
    assert.equal(
      shouldSkipOutputResolve(trusted, { companyId: COMPANY_A }),
      true
    );
    const v2 = applyAccountMemoryV2RecordsToRows(
      [{ ...trusted, hesapKodu: "" }],
      [],
      { firmaId: COMPANY_A }
    );
    void v2;
    // Restore: trusted with hesap filled skips LM overwrite
    const lm = applyLearningMemoryToStandardLucaRows(
      [trusted],
      [
        {
          id: "p",
          company_id: COMPANY_A,
          keyword: "STOPAJ",
          account_code: "999.99.999",
          status: "active",
        },
      ],
      { firmaId: COMPANY_A }
    );
    assert.equal(lm[0].hesapKodu, "193.01.001");

    // Without decision, LM still applies (scope not closed)
    const open = applyLearningMemoryToStandardLucaRows(
      [bare],
      [
        {
          id: "p2",
          company_id: COMPANY_A,
          keyword: "ODENECEK STOPAJ",
          account_code: "193.01.001",
          status: "active",
          account_name: "Stopaj",
        },
      ],
      { firmaId: COMPANY_A }
    );
    assert.equal(open[0].hesapKodu, "193.01.001");
  });

  it("MARE parite + 12→24 + statement/counter leg", () => {
    const mare = [
      {
        id: "open",
        amount: 1000000,
        direction: "CIKIS",
        accountCode: "102.01.037",
        counterAccountCode: "102.10.V001",
        description: "open",
        lucaDescription: "open",
        date: "15.01.2026",
      },
      {
        id: "faiz",
        amount: 33931.4,
        direction: "GIRIS",
        accountCode: "102.01.037",
        counterAccountCode: "642.01.001",
        description: "faiz",
        lucaDescription: "faiz",
        date: "15.01.2026",
      },
      {
        id: "stopaj",
        amount: 5938,
        direction: "CIKIS",
        accountCode: "102.01.037",
        counterAccountCode: "193.01.001",
        description: "stopaj",
        lucaDescription: "stopaj",
        date: "15.01.2026",
      },
      {
        id: "close",
        amount: 1027993.4,
        direction: "GIRIS",
        accountCode: "102.01.037",
        counterAccountCode: "102.10.V001",
        description: "close",
        lucaDescription: "close",
        date: "15.01.2026",
      },
    ];
    const rows = bankMovementsToStandardLucaRows(mare, {
      firmaId: COMPANY_A,
    });
    assert.equal(rows.length, 8);
    const codes = [...new Set(rows.map((r) => r.hesapKodu))].sort();
    assert.deepEqual(
      codes,
      ["102.01.037", "102.10.V001", "193.01.001", "642.01.001"].sort()
    );
    const elektra = prepareElektrawebExportRows(rows, { companyId: COMPANY_A });
    assert.equal(elektra.ok, true);
    for (let i = 0; i < 8; i += 1) {
      assert.equal(elektra.rows[i].hesapKodu, rows[i].hesapKodu);
    }
    const twelve = bankMovementsToStandardLucaRows(
      Array.from({ length: 12 }, (_, i) => dualMovement(i)),
      { firmaId: COMPANY_A }
    );
    assert.equal(twelve.length, 24);
    assert.ok(
      twelve.every((r) =>
        shouldSkipOutputResolve(r, { companyId: COMPANY_A })
      )
    );
  });

  it("Fiş Kontrol Elektra link ≠ Banka Parser Elektra indir (zincir farkı)", () => {
    const fis = fs.readFileSync(
      path.join(root, "app/(annvero)/muhasebe/fis-kontrol/page.jsx"),
      "utf8"
    );
    assert.match(fis, /href="\/muhasebe\/elektraweb"/);
    assert.doesNotMatch(fis, /exportElektrawebFromStandardLucaRows/);
    const oneClick = fs.readFileSync(
      path.join(
        root,
        "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
      ),
      "utf8"
    );
    assert.match(oneClick, /ElektraWeb İndir/);
    assert.match(oneClick, /onDownloadElektra/);
  });
});
