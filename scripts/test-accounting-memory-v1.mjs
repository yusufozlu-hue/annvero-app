/**
 * Muhasebe Hafızası V1 — firma-scoped öğrenme / persist / reuse / güvenlik.
 * Run: npm run test:accounting-memory-v1
 */
import assert from "node:assert/strict";

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const {
  BANK_STATEMENT_ACCOUNTING_DOC,
  ACCOUNTING_MEMORY_PERSIST_WARNING,
  buildSafeDescriptionFingerprint,
  buildAccountingMemorySignature,
  stripSensitiveDescriptionTokens,
  evaluateAccountingMemoryHardRules,
  buildServerAccountingMemoryPayload,
  persistUserConfirmedAccountingMemory,
  hydrateFirmAccountingMemoryCache,
  consumeFirmAccountingMemory,
  purgeAccountingMemoryCacheForUserChange,
} = await import("@/src/utils/accountingMemoryV1.js");

const {
  loadAccountMemoryV2Records,
  buildAccountMemoryV2Index,
  deleteAccountMemoryV2Record,
  persistAccountMemoryV2Records,
} = await import("@/src/utils/accountMemoryV2.js");

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else {
    console.log(`PASS  ${msg}`);
  }
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
        created_at: new Date().toISOString(),
        is_active: true,
      };
      rows.push(data);
      return { data, error: null };
    },
    updateRecord: async (id, fields) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      rows[idx] = { ...rows[idx], ...fields };
      return true;
    },
  };
}

const DESC =
  "ANONIM KATEGORI XYZ ODEME REF TR33 0001 0002 0003 0004 0005 00 TUTAR 1500,00";
const PLAN = ["320.01.ANONIM", "102.01.VAKIF", "120.01.TEST"];

// --- Signature / PII ---
{
  const cleaned = stripSensitiveDescriptionTokens(DESC);
  check(!/TR33/i.test(cleaned), "PII: IBAN strip");
  check(!/1500/.test(cleaned), "PII: tutar strip");
  const fp = buildSafeDescriptionFingerprint(DESC);
  check(/^fp:[0-9a-f]{8}$/i.test(fp), "güvenli fingerprint format");
  const sig = buildAccountingMemorySignature({
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionFingerprint: fp,
  });
  check(sig.startsWith("bsa|"), "imza prefix bsa");
  check(!/TR33|1500|ANONIM KATEGORI XYZ/i.test(sig), "imzada ham açıklama/IBAN/tutar yok");
  const payload = buildServerAccountingMemoryPayload({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    descriptionOrKey: DESC,
    accountCode: "320.01.ANONIM",
  });
  check(payload?.document_type === BANK_STATEMENT_ACCOUNTING_DOC, "doc type BANK_STATEMENT_ACCOUNTING");
  check(payload?.keyword === payload?.clean_description, "keyword=clean imza");
  check(!/1500|TR33/i.test(JSON.stringify(payload)), "server payload PII yok");
}

// --- Hard rules ---
{
  const self = evaluateAccountingMemoryHardRules({
    accountCode: "102.01.A",
    counterAccountCode: "102.01.A",
  });
  check(self.blocked && self.reasons.includes("self_counter_forbidden"), "self-counter blok");

  const planMiss = evaluateAccountingMemoryHardRules({
    accountCode: "999.99.YOK",
    accountPlanCodes: PLAN,
  });
  check(planMiss.blocked && planMiss.reasons.includes("account_not_in_plan"), "plan dışı blok");

  const foreign = evaluateAccountingMemoryHardRules({
    accountCode: "102.99.DIGER",
    company: {
      bankAccounts: [
        { lucaCode: "102.01.VAKIF", isActive: true },
        { lucaCode: "102.02.VADELI", isActive: true, accountType: "VADELI" },
      ],
    },
  });
  check(
    foreign.blocked && foreign.reasons.includes("foreign_bank_102_forbidden"),
    "yabancı banka 102 blok"
  );
}

// --- A) Server success kapısı ---
store.clear();
const api = makeCreateStore();
{
  const r1 = await persistUserConfirmedAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    analysisKey: DESC,
    accountCode: "320.01.ANONIM",
    accountPlanCodes: PLAN,
    source: "user-learn",
    rememberForCompany: true,
    existingServerRows: [],
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
  });
  check(r1.persisted === true, "A: server persist");
  check(r1.serverWriteCount === 1, "A: serverWrite=1");
  check(r1.activeCache === 1, "A: activeCache=1");
  check(r1.learned === true, "A: learned=true");
  check(api.rows.length === 1, "A: server satır 1");
  const active = loadAccountMemoryV2Records().filter(
    (r) => r.serverPersisted === true && r.status === "active"
  );
  check(active.length === 1, "A: yalnız server-confirmed active");
}

// --- Aynı signature + aynı hesap → idempotent write=0 ---
{
  const r2 = await persistUserConfirmedAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    analysisKey: DESC,
    accountCode: "320.01.ANONIM",
    accountPlanCodes: PLAN,
    source: "user-learn",
    rememberForCompany: true,
    existingServerRows: api.rows,
    createRecord: api.createRecord,
    updateRecord: api.updateRecord,
  });
  check(r2.persisted === true, "idempotent reuse ok");
  check(r2.reused === true, "idempotent reused");
  check(r2.serverWriteCount === 0, "A: ikinci serverWrite=0");
  check(api.rows.length === 1, "server satır hâlâ 1");
}

// --- Hydrate + ikinci işlem yüksek güven otomatik ---
store.clear();
{
  hydrateFirmAccountingMemoryCache(api.rows, "firma-a", { userId: "u1" });
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "firma-a");
  const hit = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    analysisKey: DESC,
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
    allowAuto: true,
    currentUserId: "u1",
    cacheUserId: "u1",
  });
  check(hit.autoApply === true, "A: ikinci işlem autoApply=true");
  check(hit.record?.accountCode === "320.01.ANONIM", "doğru hesap");
  check(hit.decisionSource === "Öğrenen Hafıza", "karar kaynağı görünür");
  check(hit.mode !== "conflict", "çelişki yok");
}

// --- Negatifler ---
store.clear();
hydrateFirmAccountingMemoryCache(api.rows, "firma-a");
{
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "firma-a");

  const giris = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "GIRIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
  });
  check(giris.autoApply !== true, "GİRİŞ → uygulanmaz");

  const otherBank = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "ZIRAAT",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
  });
  check(otherBank.autoApply !== true, "başka banka → uygulanmaz");

  const otherFirm = consumeFirmAccountingMemory({
    companyId: "firma-b",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    accountMemoryIndex: buildAccountMemoryV2Index(
      loadAccountMemoryV2Records(),
      "firma-b"
    ),
    accountPlanCodes: PLAN,
  });
  check(otherFirm.autoApply !== true, "başka firma → uygulanmaz");

  const usd = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "USD",
    descriptionOrKey: DESC,
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
  });
  check(usd.autoApply !== true, "farklı para birimi → uygulanmaz");

  const stalePlan = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    accountMemoryIndex: index,
    accountPlanCodes: ["102.01.VAKIF"], // 320 kaldırılmış
  });
  check(stalePlan.autoApply !== true, "plandan kaldırılmış → uygulanmaz");
  check(
    stalePlan.rejectReason === "account_not_in_plan" ||
      stalePlan.hardRules?.includes("account_not_in_plan"),
    "stale plan reject reason"
  );
}

// --- Çelişkili iki aktif kayıt → inceleme ---
{
  store.clear();
  const conflictApi = makeCreateStore();
  await persistUserConfirmedAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: "CONFLICT TOKEN ALPHA",
    accountCode: "320.01.ANONIM",
    accountPlanCodes: PLAN,
    rememberForCompany: true,
    createRecord: conflictApi.createRecord,
    updateRecord: conflictApi.updateRecord,
  });
  // Force two active different codes with identical analysisKey
  const conflictKey = buildAccountingMemorySignature({
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionFingerprint: buildSafeDescriptionFingerprint(
      "CONFLICT TOKEN ALPHA"
    ),
  });
  persistAccountMemoryV2Records([
    {
      id: "c1",
      analysisKey: conflictKey,
      normalizedDescription: conflictKey,
      accountCode: "320.01.ANONIM",
      direction: "CIKIS",
      bankId: "VAKIFBANK",
      currency: "TRY",
      companyId: "firma-a",
      isActive: true,
      status: "active",
      confidence: 95,
      transactionType: "GIDEN_HAVALE",
      source: "user-learn",
    },
    {
      id: "c2",
      analysisKey: conflictKey,
      normalizedDescription: conflictKey,
      accountCode: "120.01.TEST",
      direction: "CIKIS",
      bankId: "VAKIFBANK",
      currency: "TRY",
      companyId: "firma-a",
      isActive: true,
      status: "active",
      confidence: 95,
      transactionType: "GIDEN_HAVALE",
      source: "user-learn",
    },
  ]);
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "firma-a");
  const conflictHit = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: "CONFLICT TOKEN ALPHA",
    analysisKey: conflictKey,
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
  });
  check(
    conflictHit.mode === "conflict" || conflictHit.autoApply !== true,
    "çelişkili aktif → auto yok / inceleme"
  );
  check(conflictHit.mode === "conflict", "çelişki mode=conflict");
}

// --- Hard-block reddi ---
{
  const blocked = await persistUserConfirmedAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "VIRMAN",
    descriptionOrKey: "VADELI BLOCK",
    accountCode: "102.02.VADELI",
    statementAccountType: "VADELI",
    company: {
      bankAccounts: [
        {
          lucaAccountCode: "102.01.VAKIF",
          accountType: "VADESIZ",
          isActive: true,
        },
        {
          lucaAccountCode: "102.02.VADELI",
          accountType: "VADELI",
          isActive: true,
        },
      ],
    },
    rememberForCompany: true,
    createRecord: async () => ({ data: { id: "x" }, error: null }),
  });
  check(
    blocked.persisted !== true &&
      (blocked.rejectReason === "vadeli_to_vadeli_forbidden" ||
        blocked.hardRules?.includes("vadeli_to_vadeli_forbidden")),
    "vadeli↔vadeli hafıza yazımı reddedilir"
  );
}

// --- B) Server fail kapısı ---
{
  store.clear();
  let attempts = 0;
  const fail = await persistUserConfirmedAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    descriptionOrKey: "SERVER FAIL TOKEN",
    accountCode: "320.01.ANONIM",
    accountPlanCodes: PLAN,
    rememberForCompany: true,
    createRecord: async () => {
      attempts += 1;
      return { data: null, error: "simulated fail" };
    },
  });
  check(fail.persisted === false, "B: persisted false");
  check(fail.learned === false, "B: learned=false");
  check(fail.warning === ACCOUNTING_MEMORY_PERSIST_WARNING, "B: uyarı görünür");
  check(fail.serverWriteAttempt === 1, "B: serverWrite attempt=1");
  check(fail.activeCache === 0, "B: activeCache=0");
  check(attempts === 1, "B: create denendi");
  const pendingLeft = loadAccountMemoryV2Records().filter(
    (r) =>
      r.companyId === "firma-a" &&
      (r.status === "pending" ||
        (r.documentType === BANK_STATEMENT_ACCOUNTING_DOC && !r.serverPersisted))
  );
  check(pendingLeft.length === 0, "B: pending temizlendi");
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "firma-a");
  const second = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: "SERVER FAIL TOKEN",
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
  });
  check(second.autoApply !== true, "B: ikinci işlem autoApply=false");
}

// --- C) Server disabled/superseded → hydrate reconcile ---
{
  store.clear();
  // Eski local “active” sahte kayıt
  persistAccountMemoryV2Records([
    {
      id: "local-stale",
      companyId: "firma-a",
      analysisKey: buildAccountingMemorySignature({
        bankId: "VAKIFBANK",
        direction: "CIKIS",
        transactionType: "GIDEN_HAVALE",
        currency: "TRY",
        descriptionFingerprint: buildSafeDescriptionFingerprint(DESC),
      }),
      accountCode: "320.01.ANONIM",
      direction: "CIKIS",
      bankId: "VAKIFBANK",
      currency: "TRY",
      transactionType: "GIDEN_HAVALE",
      documentType: BANK_STATEMENT_ACCOUNTING_DOC,
      isActive: true,
      status: "active",
      serverPersisted: true,
      confidence: 95,
      source: "user-learn",
    },
  ]);
  // Server’da kayıt yok / disabled → local temizlenmeli
  const recon = hydrateFirmAccountingMemoryCache([], "firma-a");
  check(recon.removed >= 1, "C: hydrate local BSA temizler");
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "firma-a");
  const hit = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
  });
  check(hit.autoApply !== true, "C: disabled/eksik server → uygulanmaz");
}

// --- D) Pending / reload — sahte öğrenme yok ---
{
  store.clear();
  persistAccountMemoryV2Records([
    {
      id: "pending-1",
      companyId: "firma-a",
      analysisKey: "PENDING KEY|CIKIS",
      accountCode: "320.01.ANONIM",
      direction: "CIKIS",
      bankId: "VAKIFBANK",
      currency: "TRY",
      transactionType: "GIDEN_HAVALE",
      documentType: BANK_STATEMENT_ACCOUNTING_DOC,
      isActive: false,
      status: "pending",
      serverPersisted: false,
      confidence: 95,
      source: "user-learn",
    },
  ]);
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "firma-a");
  const pendingHit = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: "PENDING KEY",
    analysisKey: "PENDING KEY|CIKIS",
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
  });
  check(pendingHit.autoApply !== true, "D: pending uygulanmaz");
}

// --- skipServerPersist yalnız test enjeksiyonu ---
{
  const fs = await import("node:fs");
  const applySrc = fs.readFileSync(
    new URL("../src/utils/cariResolutionGroupApply.js", import.meta.url),
    "utf8"
  );
  const wbSrc = fs.readFileSync(
    new URL(
      "../app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx",
      import.meta.url
    ),
    "utf8"
  );
  check(
    applySrc.includes("__testOnly") && applySrc.includes("NODE_ENV === \"production\""),
    "skipServerPersist production’da kapalı"
  );
  check(!/skipServerPersist\s*:/.test(wbSrc), "Workbench skipServerPersist geçirmez");
  check(!/__testOnly/.test(wbSrc), "Workbench __testOnly kullanmaz");
}

// --- Server fail (legacy label) ---
{
  store.clear();
  const fail = await persistUserConfirmedAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    descriptionOrKey: "SERVER FAIL TOKEN 2",
    accountCode: "320.01.ANONIM",
    accountPlanCodes: PLAN,
    rememberForCompany: true,
    createRecord: async () => ({ data: null, error: "simulated fail" }),
  });
  check(fail.persisted === false, "server fail → persisted false");
  check(fail.warning === ACCOUNTING_MEMORY_PERSIST_WARNING, "server fail → uyarı");
  check(fail.localOk === false, "server fail → local active yok");
}

// --- Logout / user değişimi → cache uygulanmaz ---
{
  store.clear();
  hydrateFirmAccountingMemoryCache(api.rows, "firma-a", { userId: "u1" });
  const purged = purgeAccountingMemoryCacheForUserChange({
    previousUserId: "u1",
    nextUserId: "u2",
    companyId: "firma-a",
  });
  check(purged.purged >= 1, "user değişimi cache purge");
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "firma-a");
  const afterLogout = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
    cacheUserId: "u1",
    currentUserId: "u2",
  });
  check(afterLogout.autoApply !== true, "logout sonrası auto yok");
}

// --- Pasifleştir → sonraki analizde kullanılmaz ---
{
  store.clear();
  hydrateFirmAccountingMemoryCache(api.rows, "firma-a");
  const rec = loadAccountMemoryV2Records().find((r) => r.companyId === "firma-a");
  assert.ok(rec);
  deleteAccountMemoryV2Record(rec.id, { soft: true });
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "firma-a");
  const disabled = consumeFirmAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: DESC,
    accountMemoryIndex: index,
    accountPlanCodes: PLAN,
  });
  check(disabled.autoApply !== true, "pasif kayıt uygulanmaz");
}

// --- Performans: 4 hareket index 1 kez ---
{
  store.clear();
  hydrateFirmAccountingMemoryCache(api.rows, "firma-a");
  const t0 = performance.now();
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "firma-a");
  let autos = 0;
  for (let i = 0; i < 4; i += 1) {
    const hit = consumeFirmAccountingMemory({
      companyId: "firma-a",
      bankId: "VAKIFBANK",
      direction: "CIKIS",
      transactionType: "GIDEN_HAVALE",
      currency: "TRY",
      descriptionOrKey: DESC,
      accountMemoryIndex: index,
      accountPlanCodes: PLAN,
    });
    if (hit.autoApply) autos += 1;
  }
  const ms = performance.now() - t0;
  check(autos === 4, "4 hareket aynı index ile auto");
  check(ms < 200, `4 hareket hızlı (got ${ms.toFixed(1)}ms)`);
}

// --- rememberForCompany false ---
{
  const skip = await persistUserConfirmedAccountingMemory({
    companyId: "firma-a",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    descriptionOrKey: "NO REMEMBER",
    accountCode: "320.01.ANONIM",
    rememberForCompany: false,
    createRecord: async () => ({ data: { id: "n" }, error: null }),
  });
  check(skip.rejectReason === "remember_not_checked", "hatırla kapalı → yazma yok");
}

if (failed > 0) {
  console.error(`\n${failed} FAIL`);
  process.exit(1);
}
console.log("\nAll accounting-memory V1 checks passed.");
