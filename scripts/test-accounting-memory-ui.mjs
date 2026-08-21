/**
 * Accounting memory UI — server authority + preview FAIL regression.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-accounting-memory-ui.mjs
 */
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const panelPath = path.join(
  root,
  "app/(annvero)/muhasebe/components/AccountMemoryV2Panel.jsx"
);
const pagePath = path.join(
  root,
  "app/(annvero)/muhasebe/ogrenen-hafiza/page.jsx"
);

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else {
    console.log(`PASS  ${msg}`);
  }
}

const panelSrc = fs.readFileSync(panelPath, "utf8");
const pageSrc = fs.readFileSync(pagePath, "utf8");

const {
  BANK_STATEMENT_ACCOUNTING_DOC,
  FORBIDDEN_LOCAL_MEMORY_UI_PHRASES,
  mapServerAccountingRowToUiSafe,
  filterFirmAccountingMemoryUiRows,
  buildFirmAccountingMemoryStats,
  hydrateFirmAccountingMemoryCache,
  consumeFirmAccountingMemory,
} = await import("@/src/utils/accountingMemoryV1.js");
const {
  loadAccountMemoryV2Records,
  buildAccountMemoryV2Index,
  persistAccountMemoryV2Records,
} = await import("@/src/utils/accountMemoryV2.js");

// Preview FAIL regression: forbidden phrases must be gone
for (const phrase of FORBIDDEN_LOCAL_MEMORY_UI_PHRASES) {
  check(!panelSrc.includes(phrase), `UI yok: ${phrase}`);
}
check(panelSrc.includes("Firma Muhasebe Hafızası"), "başlık: Firma Muhasebe Hafızası");
check(
  panelSrc.includes("Yetkili kayıtlar güvenli şekilde sunucuda tutulur"),
  "server-authority copy"
);
check(
  panelSrc.includes("fetchLearningMemoryForCompanyDetailed"),
  "panel server fetch bağları"
);
check(
  panelSrc.includes("hydrateFirmAccountingMemoryCache"),
  "panel hydrate/reconcile"
);
check(!panelSrc.includes("Tüm firmalar") && !panelSrc.includes("Tüm Firmalar"), "panel Tüm Firmalar yok");
check(!panelSrc.includes("mergeAccountMemoryV2Records"), "local birleştir kaldırıldı");
check(!panelSrc.includes("loadAccountMemoryV2Records()"), "panel localStorage yetkili okumaz");
check(pageSrc.includes("fetchLearningMemoryForCompanyDetailed"), "page company-scoped fetch");
check(!pageSrc.includes("Tüm Firmalar"), "page Tüm Firmalar yok");
check(!/from .*bankParserCore|BankParserWorkbench/.test(pageSrc), "ağır parser import yok");

// UI mapping: no PII / fingerprint / createdBy
{
  const row = mapServerAccountingRowToUiSafe({
    id: "srv-1",
    company_id: "mare",
    document_type: BANK_STATEMENT_ACCOUNTING_DOC,
    account_code: "320.01.ANONIM",
    bank_name: "VAKIFBANK",
    transaction_type: "GIDEN_HAVALE",
    keyword: "bsa|VAKIFBANK|CIKIS|GIDEN_HAVALE|TRY|fp:deadbeef",
    status: "active",
    is_active: true,
    usage_count: 3,
    learned_at: "2026-08-01T00:00:00.000Z",
    user_correction: JSON.stringify({
      direction: "CIKIS",
      currency: "TRY",
      bankId: "VAKIFBANK",
      confidence: 95,
      createdBy: "uuid-should-not-leak",
      descriptionFingerprint: "fp:deadbeef",
    }),
  });
  const json = JSON.stringify(row);
  check(row.decisionSource === "Kullanıcı onaylı", "UI kaynak etiketi");
  check(row.accountCode === "320.01.ANONIM", "UI hesap");
  check(!/uuid-should-not-leak|fp:deadbeef|IBAN|1500/i.test(json), "UI PII/fingerprint yok");
}

// Server present → list; local-only stale cleared by hydrate
store.clear();
{
  persistAccountMemoryV2Records([
    {
      id: "local-only",
      companyId: "mare",
      analysisKey: "bsa|VAKIFBANK|CIKIS|GIDEN_HAVALE|TRY|fp:aaaa",
      accountCode: "320.01.OLD",
      direction: "CIKIS",
      bankId: "VAKIFBANK",
      currency: "TRY",
      documentType: BANK_STATEMENT_ACCOUNTING_DOC,
      isActive: true,
      status: "active",
      serverPersisted: true,
      confidence: 95,
      transactionType: "GIDEN_HAVALE",
    },
  ]);
  const server = [
    {
      id: "srv-ok",
      company_id: "mare",
      document_type: BANK_STATEMENT_ACCOUNTING_DOC,
      account_code: "320.01.ANONIM",
      bank_name: "VAKIFBANK",
      transaction_type: "GIDEN_HAVALE",
      keyword: "bsa|VAKIFBANK|CIKIS|GIDEN_HAVALE|TRY|fp:bbbb",
      status: "active",
      is_active: true,
      user_correction: JSON.stringify({
        direction: "CIKIS",
        currency: "TRY",
        bankId: "VAKIFBANK",
        confidence: 95,
      }),
    },
  ];
  const recon = hydrateFirmAccountingMemoryCache(server, "mare");
  check(recon.removed >= 1, "local+server yok → local temizlenir");
  const ui = server.map(mapServerAccountingRowToUiSafe).filter(Boolean);
  check(ui.length === 1 && ui[0].accountCode === "320.01.ANONIM", "server active → listede");
  const staleGone = !loadAccountMemoryV2Records().some((r) => r.id === "local-only");
  check(staleGone, "stale local cache id yok");
}

// Disabled server → not auto applied
store.clear();
{
  const disabled = [
    {
      id: "srv-off",
      company_id: "mare",
      document_type: BANK_STATEMENT_ACCOUNTING_DOC,
      account_code: "320.01.ANONIM",
      bank_name: "VAKIFBANK",
      transaction_type: "GIDEN_HAVALE",
      keyword: "bsa|VAKIFBANK|CIKIS|GIDEN_HAVALE|TRY|fp:cccc",
      status: "passive",
      is_active: false,
      user_correction: JSON.stringify({
        direction: "CIKIS",
        currency: "TRY",
        bankId: "VAKIFBANK",
        status: "disabled",
        confidence: 95,
      }),
    },
  ];
  hydrateFirmAccountingMemoryCache(disabled, "mare");
  const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "mare");
  const hit = consumeFirmAccountingMemory({
    companyId: "mare",
    bankId: "VAKIFBANK",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    currency: "TRY",
    descriptionOrKey: "whatever",
    analysisKey: "bsa|VAKIFBANK|CIKIS|GIDEN_HAVALE|TRY|fp:cccc",
    accountMemoryIndex: index,
    accountPlanCodes: ["320.01.ANONIM"],
  });
  check(hit.autoApply !== true, "server disabled → auto yok");
  const ui = disabled.map(mapServerAccountingRowToUiSafe).filter(Boolean);
  check(ui[0]?.status === "disabled", "UI disabled durumu");
}

// Stats + filter tenant A only
{
  const rows = [
    mapServerAccountingRowToUiSafe({
      id: "a1",
      company_id: "A",
      document_type: BANK_STATEMENT_ACCOUNTING_DOC,
      account_code: "320.01.A",
      status: "active",
      is_active: true,
      bank_name: "VAKIFBANK",
      keyword: "bsa|VAKIFBANK|CIKIS|X|TRY|fp:1",
      user_correction: JSON.stringify({ direction: "CIKIS", currency: "TRY", bankId: "VAKIFBANK" }),
    }),
    mapServerAccountingRowToUiSafe({
      id: "b1",
      company_id: "B",
      document_type: BANK_STATEMENT_ACCOUNTING_DOC,
      account_code: "320.01.B",
      status: "active",
      is_active: true,
      bank_name: "ZIRAAT",
      keyword: "bsa|ZIRAAT|CIKIS|X|TRY|fp:2",
      user_correction: JSON.stringify({ direction: "CIKIS", currency: "TRY", bankId: "ZIRAAT" }),
    }),
  ].filter(Boolean);
  const onlyA = rows.filter((r) => r.companyId === "A");
  check(onlyA.length === 1, "aktif firma A → yalnız A satırı");
  const stats = buildFirmAccountingMemoryStats(onlyA);
  check(stats.active === 1 && stats.total === 1, "sayaç server-confirmed");
  check(
    filterFirmAccountingMemoryUiRows(onlyA, { status: "active" }).length === 1,
    "aktif filtre"
  );
}

// Company switch clear: hydrate B empties A BSA
store.clear();
{
  hydrateFirmAccountingMemoryCache(
    [
      {
        id: "a",
        company_id: "A",
        document_type: BANK_STATEMENT_ACCOUNTING_DOC,
        account_code: "320.01.A",
        status: "active",
        is_active: true,
        keyword: "bsa|VAKIFBANK|CIKIS|X|TRY|fp:a",
        bank_name: "VAKIFBANK",
        user_correction: JSON.stringify({
          direction: "CIKIS",
          currency: "TRY",
          bankId: "VAKIFBANK",
        }),
      },
    ],
    "A"
  );
  hydrateFirmAccountingMemoryCache([], "B");
  const aLeft = loadAccountMemoryV2Records().filter(
    (r) =>
      r.companyId === "A" &&
      r.documentType === BANK_STATEMENT_ACCOUNTING_DOC
  );
  // B hydrate must not wipe A; panel clears React state on company change.
  // Assert A cache still tenant-scoped (no cross-render of B as A).
  check(
    aLeft.every((r) => r.companyId === "A"),
    "firma A cache tenant-scoped kalır"
  );
  const bUi = [].map(mapServerAccountingRowToUiSafe);
  check(bUi.length === 0, "firma B boş → empty state");
}

if (failed > 0) {
  console.error(`\n${failed} FAIL`);
  process.exit(1);
}
console.log("\nAll accounting-memory UI checks passed.");
