/**
 * Kanonik hesap planı hydrate — Fiş Dönüştürme / Elektraweb.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-account-plan-hydrate.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hydrateCompanyAccountPlanFromApi } from "../src/utils/accountPlanHydrate.js";
import {
  getAccountPlanForCompany,
  setCompanyAccountPlan,
} from "../src/utils/companyCenter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const sampleAccounts = [
  { accountCode: "100", accountName: "Kasa" },
  { accountCode: "102", accountName: "Bankalar" },
];

await testAsync("API dolu + storage boş → companyId anahtarına hydrate", async () => {
  let storage = {};
  const result = await hydrateCompanyAccountPlanFromApi({
    companyId: "mare-uuid",
    fetchPlan: async () => ({
      source: "api",
      accounts: sampleAccounts,
    }),
    loadStorage: () => storage,
    setPlan: setCompanyAccountPlan,
    saveStorage: (next) => {
      storage = next;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "hydrated");
  assert.equal(result.companyId, "mare-uuid");
  assert.ok(storage["mare-uuid"]);
  assert.equal(Object.keys(storage).includes("mare-uuid"), true);
  assert.doesNotMatch(JSON.stringify(Object.keys(storage)), /MARE RESORT/i);
  const fromStorage = getAccountPlanForCompany(storage, "mare-uuid");
  assert.ok(fromStorage.length >= 2);
  // Elektra fail-closed gate: plan dolu → pipeline başlayabilir
  assert.ok(fromStorage.length > 0);
});

await testAsync("API başarısız + storage dolu → mevcut plan korunur", async () => {
  let storage = setCompanyAccountPlan({}, "mare-uuid", sampleAccounts);
  const before = JSON.stringify(storage);

  const result = await hydrateCompanyAccountPlanFromApi({
    companyId: "mare-uuid",
    fetchPlan: async () => {
      throw new Error("network down");
    },
    loadStorage: () => storage,
    setPlan: setCompanyAccountPlan,
    saveStorage: (next) => {
      storage = next;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "error");
  assert.equal(JSON.stringify(storage), before);
  assert.ok(getAccountPlanForCompany(storage, "mare-uuid").length >= 2);
});

await testAsync("API unavailable + storage boş → yazılmaz (fail-closed)", async () => {
  let storage = {};
  let saved = false;
  const result = await hydrateCompanyAccountPlanFromApi({
    companyId: "mare-uuid",
    fetchPlan: async () => ({
      source: "unavailable",
      accounts: [],
    }),
    loadStorage: () => storage,
    setPlan: setCompanyAccountPlan,
    saveStorage: (next) => {
      saved = true;
      storage = next;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unavailable");
  assert.equal(saved, false);
  assert.equal(getAccountPlanForCompany(storage, "mare-uuid").length, 0);
});

await testAsync("A→B hızlı geçişte A cevabı B'yi ezmez", async () => {
  let storage = {};
  let aCancelled = false;

  const aFetch = new Promise((resolve) => {
    setTimeout(
      () =>
        resolve({
          source: "api",
          accounts: [{ accountCode: "A1", accountName: "A Plan" }],
        }),
      30
    );
  });

  const aPromise = hydrateCompanyAccountPlanFromApi({
    companyId: "company-a",
    isCancelled: () => aCancelled,
    fetchPlan: async () => aFetch,
    loadStorage: () => storage,
    setPlan: setCompanyAccountPlan,
    saveStorage: (next) => {
      storage = next;
    },
  });

  // B seçildi: A iptal
  aCancelled = true;

  const bResult = await hydrateCompanyAccountPlanFromApi({
    companyId: "company-b",
    fetchPlan: async () => ({
      source: "api",
      accounts: [{ accountCode: "B1", accountName: "B Plan" }],
    }),
    loadStorage: () => storage,
    setPlan: setCompanyAccountPlan,
    saveStorage: (next) => {
      storage = next;
    },
  });

  const aResult = await aPromise;

  assert.equal(aResult.ok, false);
  assert.equal(aResult.reason, "cancelled");
  assert.equal(bResult.ok, true);
  assert.ok(storage["company-b"]);
  assert.equal(getAccountPlanForCompany(storage, "company-b")[0]?.accountCode, "B1");
  // A yazmadıysa company-a yok; yazdıysa bile B bozulmamalı
  if (storage["company-a"]) {
    assert.equal(getAccountPlanForCompany(storage, "company-b")[0]?.accountCode, "B1");
  } else {
    assert.equal(storage["company-a"], undefined);
  }
});

await testAsync("AbortSignal iptalinde storage yazılmaz", async () => {
  let storage = setCompanyAccountPlan({}, "keep-me", sampleAccounts);
  const before = JSON.stringify(storage);
  const controller = new AbortController();
  controller.abort();

  const result = await hydrateCompanyAccountPlanFromApi({
    companyId: "other",
    signal: controller.signal,
    fetchPlan: async () => ({
      source: "api",
      accounts: [{ accountCode: "X", accountName: "Should not save" }],
    }),
    loadStorage: () => storage,
    setPlan: setCompanyAccountPlan,
    saveStorage: (next) => {
      storage = next;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "cancelled");
  assert.equal(JSON.stringify(storage), before);
});

test("UI: fis-donusturme kanonik hydrate + fail-closed gate", () => {
  const src = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/fis-donusturme/page.jsx"),
    "utf8"
  );
  assert.match(src, /hydrateCompanyAccountPlanFromApi/);
  assert.match(src, /annvero:account-plan-updated/);
  assert.match(src, /AbortController/);
  assert.match(src, /Seçili firma için hesap planı bulunamadı/);
  assert.match(
    src,
    /SOURCE_TYPES\.ELEKTRAWEB\)[\s\S]*?normalizedAccountPlan\.length === 0/
  );
});

test("UI: elektraweb aynı hydrate desenini kullanır", () => {
  const src = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/elektraweb/page.tsx"),
    "utf8"
  );
  assert.match(src, /hydrateCompanyAccountPlanFromApi/);
  assert.match(src, /annvero:account-plan-updated/);
  assert.match(src, /AbortController/);
});

test("accountPlanApi signal + fetchFull options passthrough", () => {
  const src = fs.readFileSync(
    path.join(root, "src/utils/accountPlanApi.js"),
    "utf8"
  );
  assert.match(src, /signal:\s*options\.signal/);
  assert.match(
    src,
    /fetchFullActiveAccountPlan\(companyId,\s*options\s*=\s*\{\}/
  );
});

console.log(`\n${passed} tests passed`);
