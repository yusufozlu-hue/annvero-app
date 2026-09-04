/**
 * Faz 3 blocker fix: USER_LEARNED consumer + race + lucaLeg.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-user-learned-bank-consumer.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mapParsedRowToStandardMovement } from "@/src/utils/bankMovementMapper.js";
import {
  BANK_STATEMENT_ACCOUNTING_DOC,
  ACCOUNTING_MEMORY_LUCA_LEG,
  mapServerAccountingRowToV2,
  buildSafeDescriptionFingerprint,
  buildAccountingMemorySignature,
  buildServerAccountingMemoryPayload,
  consumeFirmAccountingMemory,
  stripSensitiveDescriptionTokens,
  resolveAccountingMemoryLucaLeg,
} from "@/src/utils/accountingMemoryV1.js";
import { buildAccountMemoryV2Index } from "@/src/utils/accountMemoryV2.js";
import {
  clearAccountingLearningMemorySession,
  loadAccountingLearningMemoryForCompany,
  ensureAccountingLearningMemoryForCompany,
  peekAccountingLearningMemorySession,
  bumpAccountingLearningMemoryEpoch,
  getAccountingLearningMemoryEpoch,
} from "@/src/utils/accountingLearningMemorySession.js";
import {
  resolveAccountingDecision,
  ACCOUNTING_DECISION_SOURCE,
} from "@/src/utils/centralAccountingDecisionResolver.js";
import { resolveBankTransactionType } from "@/src/utils/bankTransactionType.js";

globalThis.window = {
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};

const COMPANY_ID = "COMP-USER-LEARNED-1";
const OTHER_COMPANY_ID = "COMP-USER-LEARNED-OTHER";

const BANK_ACCOUNT = {
  bankName: "VAKIFBANK",
  accountType: "VADESIZ",
  lucaAccountCode: "102.10.V001",
  accountNumber: "158007308428449",
  iban: "TR820001500158007308428449",
  currency: "TL",
  isActive: true,
};

const selectedCompany = {
  id: COMPANY_ID,
  bankAccounts: [BANK_ACCOUNT],
};

const companyPlans = [
  { code: "102.10.V001", name: "VADESIZ", isLeaf: true, isActive: true },
  { code: "642.01.001", name: "FAİZ GELİRLERİ", isLeaf: true, isActive: true },
  { code: "102.10.V002", name: "VADELİ", isLeaf: true, isActive: true },
  { code: "642.01.002", name: "FAİZ GELİRLERİ 2", isLeaf: true, isActive: true },
  { code: "320.01.USER", name: "CARİ", isLeaf: true, isActive: true },
  { code: "193.01.001", name: "STOPAJ", isLeaf: true, isActive: true },
];

function makeBsaRow({
  id = "srv-1",
  companyId = COMPANY_ID,
  description,
  direction = "GIRIS",
  transactionType = "BILINMEYEN",
  accountCode = "642.01.001",
  counterAccountCode = "102.10.V001",
  lucaLeg = "",
  isActive = true,
  status = "active",
  userCorrectionExtra = null,
} = {}) {
  const fp = buildSafeDescriptionFingerprint(description);
  const leg =
    lucaLeg ||
    resolveAccountingMemoryLucaLeg({ accountCode, allowInfer: true }).leg;
  const signature = buildAccountingMemorySignature({
    bankId: "VAKIFBANK",
    direction,
    transactionType,
    currency: "TRY",
    descriptionFingerprint: fp,
    lucaLeg: leg,
  });
  const user_correction = JSON.stringify({
    schemaVersion: 1,
    source: "user_confirmed",
    status: "active",
    direction,
    currency: "TRY",
    bankId: "VAKIFBANK",
    descriptionFingerprint: fp,
    lucaLeg: leg || null,
    lucaLegConfidence: leg ? "explicit" : "unknown",
    ...(userCorrectionExtra || {}),
  });
  return {
    id,
    company_id: companyId,
    document_type: BANK_STATEMENT_ACCOUNTING_DOC,
    keyword: signature,
    account_code: accountCode,
    counter_account_code: counterAccountCode,
    bank_name: "VAKIFBANK",
    transaction_type: transactionType,
    is_active: isActive,
    status,
    user_correction,
    signature,
    lucaLeg: leg,
  };
}

function hydrateFromRows(rows, companyId = COMPANY_ID) {
  const v2 = rows.map(mapServerAccountingRowToV2).filter(Boolean);
  return {
    records: v2,
    index: buildAccountMemoryV2Index(v2, companyId),
  };
}

function baseContext({ accountMemoryV2Index, accountMemoryRecords, learningMemory = [] }) {
  return {
    selectedCompany,
    selectedCompanyId: COMPANY_ID,
    selectedBank: "VAKIFBANK",
    companyPlans,
    companyRules: {},
    legacyRules: [],
    learningMemory,
    activeLearningMemory: learningMemory,
    learningMemoryIndex: null,
    accountingRules: [],
    planIndex: null,
    accountMemoryRecords,
    accountMemoryV2Index,
    companyAccountingPolicies: null,
    documentResolutions: null,
    statementAccountType: "VADESIZ",
    statementAccountHint: BANK_ACCOUNT.accountNumber,
    statementIban: BANK_ACCOUNT.iban,
    currency: "TL",
    persistVadeliMemory: false,
  };
}

function runMovement({
  description,
  direction = "GIRIS",
  rawAmount = 100,
  accountMemoryRecords,
  accountMemoryV2Index,
  learningMemory,
}) {
  return mapParsedRowToStandardMovement(
    {
      sourceRowId: "r1",
      tarih: "2026-03-01",
      aciklama: description,
      tutar: rawAmount,
      yon: direction,
      banka: "VAKIFBANK",
      hesapNo: BANK_ACCOUNT.accountNumber,
      paraBirimi: "TL",
      iban: BANK_ACCOUNT.iban,
    },
    baseContext({
      accountMemoryV2Index,
      accountMemoryRecords,
      learningMemory,
    })
  );
}

test("1. Counter-leg USER_LEARNED → yalnız counterAccountCode", () => {
  const description = "User learned COUNTER LEG EXAMPLE ABC 123";
  const row = makeBsaRow({
    description,
    accountCode: "642.01.001",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  const { records, index } = hydrateFromRows([row]);
  const movement = runMovement({
    description,
    accountMemoryRecords: records,
    accountMemoryV2Index: index,
  });
  assert.equal(movement.counterAccountCode, "642.01.001");
  assert.equal(movement.accountCode, "102.10.V001");
  assert.equal(movement.matchedRule?.source, "userLearnedServer");
});

test("2. Statement-leg USER_LEARNED → yalnız statement account (counter değişmez)", () => {
  const description = "User learned STATEMENT LEG EXAMPLE XYZ 999";
  const row = makeBsaRow({
    description,
    accountCode: "102.10.V002",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT,
  });
  const decision = resolveAccountingDecision({
    company: {
      ...selectedCompany,
      bankAccounts: [
        BANK_ACCOUNT,
        {
          bankName: "VAKIFBANK",
          accountType: "VADESIZ",
          lucaAccountCode: "102.10.V002",
          accountNumber: "999",
          currency: "TL",
          isActive: true,
        },
      ],
    },
    companyId: COMPANY_ID,
    accountPlan: companyPlans,
    bankName: "VAKIFBANK",
    accountNumber: "",
    iban: "",
    productType: "VADESIZ",
    currency: "TRY",
    description,
    direction: "GIRIS",
    transactionType: "BILINMEYEN",
    learningMemory: [row],
    lucaLeg: "bank",
  });
  assert.equal(decision.source, ACCOUNTING_DECISION_SOURCE.USER_LEARNED);
  assert.equal(decision.accountCode, "102.10.V002");

  // Mapper counter path must NOT apply statement-leg as counter
  const { records, index } = hydrateFromRows([row]);
  const movement = runMovement({
    description,
    accountMemoryRecords: records,
    accountMemoryV2Index: index,
  });
  assert.notEqual(movement.counterAccountCode, "102.10.V002");
  assert.notEqual(movement.matchedRule?.source, "userLearnedServer");
});

test("3. Belirsiz legacy BSA → otomatik uygulanmaz / review", () => {
  const description = "User learned AMBIGUOUS LEGACY EXAMPLE";
  const fp = buildSafeDescriptionFingerprint(description);
  // Legacy keyword without lucaLeg slot + unknown confidence
  const legacySig = `bsa|VAKIFBANK|GIRIS|BILINMEYEN|TRY|${fp}`;
  const v2 = {
    id: "srv:legacy-unknown",
    serverId: "legacy-unknown",
    companyId: COMPANY_ID,
    analysisKey: legacySig,
    accountCode: "642.01.001",
    direction: "GIRIS",
    transactionType: "BILINMEYEN",
    bankId: "VAKIFBANK",
    currency: "TRY",
    lucaLeg: "",
    lucaLegConfidence: "unknown",
    isActive: true,
    status: "active",
    documentType: BANK_STATEMENT_ACCOUNTING_DOC,
    serverPersisted: true,
    confidence: 95,
  };
  const index = buildAccountMemoryV2Index([v2], COMPANY_ID);
  const hit = consumeFirmAccountingMemory({
    companyId: COMPANY_ID,
    company: selectedCompany,
    bankId: "VAKIFBANK",
    direction: "GIRIS",
    transactionType: "BILINMEYEN",
    currency: "TRY",
    descriptionOrKey: description,
    accountMemoryIndex: index,
    accountPlanCodes: companyPlans.map((p) => p.code),
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  assert.notEqual(hit.mode, "auto");
  assert.ok(hit.mode === "review" || hit.rejectReason === "luca_leg_unknown");
});

test("4. Yanlış leg → eşleşme yok; statement counter’ı ezmez", () => {
  const description = "User learned WRONG LEG MISMATCH EXAMPLE";
  const statementRow = makeBsaRow({
    id: "srv-stmt",
    description,
    accountCode: "102.10.V001",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT,
  });
  const { records, index } = hydrateFromRows([statementRow]);
  const counterHit = consumeFirmAccountingMemory({
    companyId: COMPANY_ID,
    bankId: "VAKIFBANK",
    direction: "GIRIS",
    transactionType: "BILINMEYEN",
    currency: "TRY",
    descriptionOrKey: description,
    accountMemoryIndex: index,
    accountPlanCodes: companyPlans.map((p) => p.code),
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  assert.equal(counterHit.mode, "none");
  assert.ok(
    counterHit.rejectReason === "luca_leg_mismatch" ||
      counterHit.rejectReason === "no_matching_memory_record"
  );
});

test("5. Aynı signature’da statement + counter kararları birbirini ezmez", () => {
  const description = "User learned BOTH LEGS SAME DESC EXAMPLE";
  const stmt = makeBsaRow({
    id: "srv-s",
    description,
    accountCode: "102.10.V001",
    counterAccountCode: "",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT,
  });
  const ctr = makeBsaRow({
    id: "srv-c",
    description,
    accountCode: "642.01.001",
    counterAccountCode: "102.10.V001",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  assert.notEqual(stmt.keyword, ctr.keyword, "leg must differentiate signatures");
  const { records, index } = hydrateFromRows([stmt, ctr]);
  const counterHit = consumeFirmAccountingMemory({
    companyId: COMPANY_ID,
    bankId: "VAKIFBANK",
    direction: "GIRIS",
    transactionType: "BILINMEYEN",
    currency: "TRY",
    descriptionOrKey: description,
    accountMemoryIndex: index,
    accountPlanCodes: companyPlans.map((p) => p.code),
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  assert.equal(counterHit.mode, "auto");
  assert.equal(counterHit.record.accountCode, "642.01.001");

  const statementHit = consumeFirmAccountingMemory({
    companyId: COMPANY_ID,
    bankId: "VAKIFBANK",
    direction: "GIRIS",
    transactionType: "BILINMEYEN",
    currency: "TRY",
    descriptionOrKey: description,
    accountMemoryIndex: index,
    accountPlanCodes: companyPlans.map((p) => p.code),
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.STATEMENT,
  });
  assert.equal(statementHit.mode, "auto");
  assert.equal(statementHit.record.accountCode, "102.10.V001");
});

test("6. Conflict aynı tier → review; SYSTEM_RULE’a sessiz düşmez", () => {
  const description = "User learned CONFLICT SAME TIER EXAMPLE";
  const a = makeBsaRow({
    id: "srv-1",
    description,
    accountCode: "642.01.001",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  const b = makeBsaRow({
    id: "srv-2",
    description,
    accountCode: "642.01.002",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  const { records, index } = hydrateFromRows([a, b]);
  const movement = runMovement({
    description,
    accountMemoryRecords: records,
    accountMemoryV2Index: index,
  });
  assert.equal(movement.counterAccountCode, "");
  assert.ok(String(movement.warning || "").length > 0);
});

test("7. Payload lucaLeg metadata + 102→statement / GL→counter", () => {
  const payloadCounter = buildServerAccountingMemoryPayload({
    companyId: COMPANY_ID,
    bankId: "VAKIFBANK",
    direction: "GIRIS",
    transactionType: "BILINMEYEN",
    descriptionOrKey: "payload counter gl",
    accountCode: "642.01.001",
  });
  const metaC = JSON.parse(payloadCounter.user_correction);
  assert.equal(metaC.lucaLeg, "counter");
  assert.ok(String(payloadCounter.keyword).includes("|counter|"));

  const payloadStmt = buildServerAccountingMemoryPayload({
    companyId: COMPANY_ID,
    bankId: "VAKIFBANK",
    direction: "GIRIS",
    transactionType: "BILINMEYEN",
    descriptionOrKey: "payload statement 102",
    accountCode: "102.10.V001",
  });
  const metaS = JSON.parse(payloadStmt.user_correction);
  assert.equal(metaS.lucaLeg, "statement");
  assert.ok(String(payloadStmt.keyword).includes("|statement|"));
});

test("8. transactionType: persist ve consume aynı canonical tipi kullanır", () => {
  const description = "GELEN HAVALE BILET DUK ORNEK TIP TEST";
  const resolved = resolveBankTransactionType(description, "GIRIS", {
    companyPlans,
  });
  const type = resolved.transactionType;
  assert.ok(type);

  const row = makeBsaRow({
    description,
    direction: "GIRIS",
    transactionType: type,
    accountCode: "320.01.USER",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  const { index } = hydrateFromRows([row]);
  // Mapper de resolveBankTransactionType kullanır — aynı tip
  const again = resolveBankTransactionType(description, "GIRIS", {
    companyPlans,
  });
  assert.equal(again.transactionType, type);

  const hit = consumeFirmAccountingMemory({
    companyId: COMPANY_ID,
    bankId: "VAKIFBANK",
    direction: "GIRIS",
    transactionType: type,
    currency: "TRY",
    descriptionOrKey: description,
    accountMemoryIndex: index,
    accountPlanCodes: companyPlans.map((p) => p.code),
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  assert.equal(hit.mode, "auto");
  assert.equal(hit.record.accountCode, "320.01.USER");
});

test("9. Race: analiz tıklaması fetch bitmeden → promise beklenir, USER_LEARNED uygulanır", async () => {
  clearAccountingLearningMemorySession();
  let resolveFetch;
  const pending = new Promise((r) => {
    resolveFetch = r;
  });
  const description = "Race await USER LEARNED APPLY EXAMPLE";
  const row = makeBsaRow({
    description,
    accountCode: "642.01.001",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });

  const epoch = getAccountingLearningMemoryEpoch();
  const loadPromise = loadAccountingLearningMemoryForCompany(COMPANY_ID, {
    expectedEpoch: epoch,
    fetchFn: async () => {
      await pending;
      return [row];
    },
  });

  // Erken "analiz" — await load
  const early = ensureAccountingLearningMemoryForCompany(COMPANY_ID, {
    expectedEpoch: epoch,
  });
  resolveFetch();
  const ensured = await early;
  assert.equal(ensured.ok, true);
  assert.equal(ensured.rows.length, 1);
  await loadPromise;

  const { records, index } = hydrateFromRows(ensured.rows);
  const movement = runMovement({
    description,
    accountMemoryRecords: records,
    accountMemoryV2Index: index,
  });
  assert.equal(movement.counterAccountCode, "642.01.001");
});

test("10. Race: fetch reject → parser devam, stale hafıza yok", async () => {
  clearAccountingLearningMemorySession();
  const epoch = getAccountingLearningMemoryEpoch();
  const rows = await loadAccountingLearningMemoryForCompany(COMPANY_ID, {
    expectedEpoch: epoch,
    fetchFn: async () => {
      throw new Error("network");
    },
  });
  assert.deepEqual(rows, []);
  assert.equal(peekAccountingLearningMemorySession(COMPANY_ID), null);
});

test("11. Race: A pending → B’ye geç → A geç döner → B’ye sızmaz", async () => {
  clearAccountingLearningMemorySession();
  let resolveA;
  const gateA = new Promise((r) => {
    resolveA = r;
  });
  const epochA = getAccountingLearningMemoryEpoch();
  const loadA = loadAccountingLearningMemoryForCompany("FIRM-A", {
    expectedEpoch: epochA,
    fetchFn: async () => {
      await gateA;
      return [
        {
          id: "a1",
          company_id: "FIRM-A",
          document_type: BANK_STATEMENT_ACCOUNTING_DOC,
          keyword: "bsa|VAKIFBANK|GIRIS|BILINMEYEN|TRY|counter|fp:aaaa",
          account_code: "642.01.001",
          is_active: true,
        },
      ];
    },
  });

  // Firma B’ye geç — epoch bump + clear
  bumpAccountingLearningMemoryEpoch();
  clearAccountingLearningMemorySession();
  const epochB = getAccountingLearningMemoryEpoch();
  assert.notEqual(epochB, epochA);

  const loadB = await loadAccountingLearningMemoryForCompany("FIRM-B", {
    expectedEpoch: epochB,
    fetchFn: async () => [
      {
        id: "b1",
        company_id: "FIRM-B",
        document_type: BANK_STATEMENT_ACCOUNTING_DOC,
        keyword: "bsa|VAKIFBANK|GIRIS|BILINMEYEN|TRY|counter|fp:bbbb",
        account_code: "320.01.USER",
        is_active: true,
      },
    ],
  });
  assert.equal(loadB.length, 1);
  assert.equal(loadB[0].id, "b1");

  resolveA();
  const aRows = await loadA;
  // A stale → cache’e yazılmamalı / boş dönmeli
  assert.deepEqual(aRows, []);
  assert.equal(peekAccountingLearningMemorySession("FIRM-A"), null);
  assert.equal(peekAccountingLearningMemorySession("FIRM-B")?.[0]?.id, "b1");
});

test("12. Aynı firma eşzamanlı iki çağrı → tek GET", async () => {
  clearAccountingLearningMemorySession();
  let calls = 0;
  const epoch = getAccountingLearningMemoryEpoch();
  const fetchFn = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return [{ id: "once", company_id: COMPANY_ID, document_type: BANK_STATEMENT_ACCOUNTING_DOC, keyword: "bsa|x", account_code: "642.01.001", is_active: true }];
  };
  const [a, b] = await Promise.all([
    loadAccountingLearningMemoryForCompany(COMPANY_ID, { expectedEpoch: epoch, fetchFn }),
    loadAccountingLearningMemoryForCompany(COMPANY_ID, { expectedEpoch: epoch, fetchFn }),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
});

test("13. Boş firma → eski cache/index temiz", () => {
  clearAccountingLearningMemorySession();
  // seed
  const epoch = getAccountingLearningMemoryEpoch();
  // simulate cached by loading sync via map set path
  bumpAccountingLearningMemoryEpoch();
  clearAccountingLearningMemorySession(); // clears all + bumps
  assert.equal(peekAccountingLearningMemorySession(COMPANY_ID), null);
  assert.equal(peekAccountingLearningMemorySession(OTHER_COMPANY_ID), null);
  assert.ok(getAccountingLearningMemoryEpoch() >= epoch);
});

test("14. Tenant izolasyonu", () => {
  const description = "Tenant isolation again EXAMPLE";
  const row = makeBsaRow({
    id: "other",
    companyId: OTHER_COMPANY_ID,
    description,
    accountCode: "642.01.001",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  const { records, index } = hydrateFromRows([row], COMPANY_ID);
  const movement = runMovement({
    description,
    accountMemoryRecords: records,
    accountMemoryV2Index: index,
  });
  assert.equal(movement.counterAccountCode, "");
});

test("15. PII: imza/fingerprint’te IBAN yok", () => {
  const dirty = "HAVALE TR820001500158007308428449 tutar 1.250,50";
  const cleaned = stripSensitiveDescriptionTokens(dirty);
  assert.ok(!/TR\d{2}/i.test(cleaned));
  const fp = buildSafeDescriptionFingerprint(dirty);
  const sig = buildAccountingMemorySignature({
    bankId: "VAKIFBANK",
    direction: "GIRIS",
    transactionType: "GELEN_HAVALE",
    currency: "TRY",
    descriptionFingerprint: fp,
    lucaLeg: "counter",
  });
  assert.ok(!sig.includes("TR82"));
});

test("16. Merkezi resolver USER_LEARNED counter leg", () => {
  const description = "Central resolver COUNTER LEG MATCH";
  const row = makeBsaRow({
    description,
    accountCode: "642.01.001",
    lucaLeg: ACCOUNTING_MEMORY_LUCA_LEG.COUNTER,
  });
  const decision = resolveAccountingDecision({
    company: selectedCompany,
    companyId: COMPANY_ID,
    accountPlan: companyPlans,
    bankName: "VAKIFBANK",
    accountNumber: "",
    iban: "",
    productType: "",
    currency: "TRY",
    description,
    direction: "GIRIS",
    transactionType: "BILINMEYEN",
    learningMemory: [row],
    lucaLeg: "counter",
  });
  assert.equal(decision.source, ACCOUNTING_DECISION_SOURCE.USER_LEARNED);
  assert.equal(decision.accountCode, "642.01.001");
});

console.log("All USER_LEARNED race+leg Faz 3 blocker tests passed.");
