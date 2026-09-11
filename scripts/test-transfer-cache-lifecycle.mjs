/**
 * Faz 3B — transfer cache logout / company-switch lifecycle.
 * Run: npm run test:transfer-cache-lifecycle
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LUCA_TRANSFER_IDB_NAME,
  buildLucaTransferPointerKey,
  buildLucaTransferStorageKey,
  saveLucaTransferDataset,
  PENDING_LUCA_ROWS_STORAGE_KEY,
  ACCOUNT_PLAN_STORAGE_KEY,
} from "@/src/utils/companyCenter.js";
import {
  __resetCanonicalTransferTestState,
  __listCanonicalTransferMemory,
  publishBankParserTransfer,
} from "@/src/utils/canonicalFisControlTransfer.js";
import {
  __resetTransferCacheFenceForTests,
  captureTransferWriteFence,
  getTransferAuthEpoch,
  isTransferWriteFenceStale,
} from "@/src/utils/transferCacheFence.js";
import {
  clearAllTransferCache,
  clearCompanyTransferCache,
  handleAuthenticatedUserTransition,
  retryPendingTransferCleanupIfNeeded,
  synchronouslyFenceAllTransfers,
  synchronouslyFenceCompanyTransfers,
  __getTransferCleanupPendingForTests,
  __setTransferCleanupPendingForTests,
} from "@/src/utils/transferCacheLifecycle.js";

function pass(cond, label) {
  if (!cond) {
    console.error(`FAIL  ${label}`);
    process.exit(1);
  }
  console.log(`PASS  ${label}`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
pass(
  typeof globalThis.indexedDB?.open === "function",
  "fake indexedDB installed"
);

const store = new Map();
const sessionStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  get length() {
    return store.size;
  },
  key(i) {
    return [...store.keys()][i] ?? null;
  },
};
globalThis.sessionStorage = {
  getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
  setItem: (k, v) => sessionStore.set(k, String(v)),
  removeItem: (k) => sessionStore.delete(k),
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  sessionStorage: globalThis.sessionStorage,
  setTimeout: globalThis.setTimeout.bind(globalThis),
};

function dualRows(companyId) {
  return [
    {
      id: "r-1",
      firmaId: companyId,
      fisNo: "1",
      fisTarihi: "10.03.2026",
      hesapKodu: "102.01.001",
      borc: 10,
      alacak: 0,
      aciklama: "SYNTHETIC_DESC_MARKER",
      belgeTuru: "FT",
      sourceMovementId: "m-1",
      lineRole: "debit",
    },
    {
      id: "r-2",
      firmaId: companyId,
      fisNo: "1",
      fisTarihi: "10.03.2026",
      hesapKodu: "320.01.001",
      borc: 0,
      alacak: 10,
      aciklama: "SYNTHETIC_DESC_MARKER",
      belgeTuru: "FT",
      sourceMovementId: "m-2",
      lineRole: "credit",
    },
  ];
}

function resetAll() {
  __resetCanonicalTransferTestState();
  __resetTransferCacheFenceForTests();
  __setTransferCleanupPendingForTests(null);
  store.clear();
  sessionStore.clear();
  globalThis.__ANNVERO_FAKE_IDB__?.__resetAll?.();
}

function idbHasKey(key) {
  const map = globalThis.__ANNVERO_FAKE_IDB__?.__getStore?.(LUCA_TRANSFER_IDB_NAME);
  return Boolean(map?.has(key));
}

function idbCountForCompany(companyId) {
  const map = globalThis.__ANNVERO_FAKE_IDB__?.__getStore?.(LUCA_TRANSFER_IDB_NAME);
  if (!map) return 0;
  let n = 0;
  for (const entry of map.values()) {
    if (String(entry?.companyId || "") === companyId) n += 1;
  }
  return n;
}

async function seedCompany(companyId, authUserId = "user-a") {
  const pub = await publishBankParserTransfer({
    companyId,
    rows: dualRows(companyId),
    authUserId,
  });
  pass(pub.ok === true, `seed ${companyId} publish`);
  return pub;
}

resetAll();

console.log("1) wiring — no localStorage.clear / deleteDatabase");
{
  const life = fs.readFileSync(
    path.join(root, "src/utils/transferCacheLifecycle.js"),
    "utf8"
  );
  const center = fs.readFileSync(
    path.join(root, "src/utils/companyCenter.js"),
    "utf8"
  );
  const logout = fs.readFileSync(
    path.join(root, "src/lib/auth/performClientLogout.js"),
    "utf8"
  );
  pass(!/localStorage\.clear\(/.test(life + center + logout), "no localStorage.clear");
  pass(!/deleteDatabase\(/.test(life + center + logout), "no indexedDB.deleteDatabase");
  pass(
    fs
      .readFileSync(path.join(root, "src/components/AuthUserBar.jsx"), "utf8")
      .includes("performClientLogout"),
    "topbar uses performClientLogout"
  );
  pass(
    fs
      .readFileSync(
        path.join(root, "app/(annvero)/mukellef/profil/page.tsx"),
        "utf8"
      )
      .includes("performClientLogout"),
    "profil uses performClientLogout"
  );
  pass(
    fs
      .readFileSync(path.join(root, "src/components/AuthGate.jsx"), "utf8")
      .includes("handleAuthenticatedUserTransition"),
    "AuthGate safety net"
  );
  const fis = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/fis-kontrol/page.jsx"),
    "utf8"
  );
  pass(!fis.includes("clearAllLucaTransferDatasets"), "fis-kontrol no IDB wipe");
  pass(/event !== "SIGNED_OUT"/.test(fis), "fis-kontrol UI-only SIGNED_OUT");
}

console.log("2) logout clearAll — IDB/pointer/memory/gates");
resetAll();
{
  store.set(ACCOUNT_PLAN_STORAGE_KEY, JSON.stringify({ keep: true }));
  store.set("annvero_unrelated_pref", "1");
  const pub = await seedCompany("co-a");
  const key = buildLucaTransferStorageKey("bank", "co-a", pub.runId);
  pass(idbHasKey(key), "pre-clear IDB key");
  pass(__listCanonicalTransferMemory().length >= 1, "pre-clear memory");
  const r = await clearAllTransferCache();
  pass(r.ok === true, "clearAll ok");
  pass(!idbHasKey(key), "IDB cleared");
  pass(__listCanonicalTransferMemory().length === 0, "memory cleared");
  pass(
    !store.get(buildLucaTransferPointerKey("bank", "co-a")),
    "pointer cleared"
  );
  pass(
    store.get(ACCOUNT_PLAN_STORAGE_KEY) === JSON.stringify({ keep: true }),
    "account plan preserved"
  );
  pass(store.get("annvero_unrelated_pref") === "1", "unrelated LS preserved");
  pass(!store.get(PENDING_LUCA_ROWS_STORAGE_KEY), "pending luca cleared");
}

console.log("3) auth transition matrix");
resetAll();
{
  pass(
    (await handleAuthenticatedUserTransition("", "user-a")).code ===
      "noop_login",
    "null→A no wipe"
  );
  pass(
    (await handleAuthenticatedUserTransition("user-a", "user-a")).code ===
      "noop_same_user",
    "A→A no wipe"
  );
  resetAll();
  const pub = await seedCompany("co-a");
  const k = buildLucaTransferStorageKey("bank", "co-a", pub.runId);
  const signedOut = await handleAuthenticatedUserTransition("user-a", "");
  pass(signedOut.ok === true, "A→null wipe ok");
  pass(!idbHasKey(k), "SIGNED_OUT cleared IDB");
  resetAll();
  const pub2 = await seedCompany("co-a");
  const k2 = buildLucaTransferStorageKey("bank", "co-a", pub2.runId);
  const ab = await handleAuthenticatedUserTransition("user-a", "user-b");
  pass(ab.ok === true, "A→B wipe ok");
  pass(!idbHasKey(k2), "A→B cleared A cache");
}

console.log("4) company A→B scoped clear");
resetAll();
{
  const a = await seedCompany("co-a");
  const b = await seedCompany("co-b");
  const keyA = buildLucaTransferStorageKey("bank", "co-a", a.runId);
  const keyB = buildLucaTransferStorageKey("bank", "co-b", b.runId);
  synchronouslyFenceCompanyTransfers("co-a");
  const r = await clearCompanyTransferCache("co-a");
  pass(r.ok === true, "company clear ok");
  pass(!idbHasKey(keyA), "A IDB gone");
  pass(idbHasKey(keyB), "B IDB preserved");
  pass(idbCountForCompany("co-b") === 1, "B count 1");
  pass(
    !store.get(buildLucaTransferPointerKey("bank", "co-a")),
    "A pointer gone"
  );
  pass(
    Boolean(store.get(buildLucaTransferPointerKey("bank", "co-b"))),
    "B pointer kept"
  );
}

console.log("5) late-write fence vs logout");
resetAll();
{
  const pub = await seedCompany("co-a");
  const token = captureTransferWriteFence({
    companyId: "co-a",
    authUserId: "user-a",
    source: "bank",
    runId: pub.runId,
  });
  synchronouslyFenceAllTransfers();
  pass(isTransferWriteFenceStale(token), "pre-fence token stale after fence");
  // In-flight write: capture then fence mid-save via hook
  globalThis.__ANNVERO_TRANSFER_SAVE_HOOK__ = async () => {
    synchronouslyFenceAllTransfers();
  };
  const late = await saveLucaTransferDataset({
    source: "bank",
    companyId: "co-a",
    runId: `late-${Date.now()}`,
    authUserId: "user-a",
    consumer: "fis_kontrol",
    rows: dualRows("co-a"),
  });
  globalThis.__ANNVERO_TRANSFER_SAVE_HOOK__ = undefined;
  pass(late.ok === false && late.error === "transfer_fence_stale", "in-flight write blocked");
  // New epoch write allowed
  const fresh = await saveLucaTransferDataset({
    source: "bank",
    companyId: "co-a",
    runId: "fresh-after-fence",
    authUserId: "user-a",
    consumer: "fis_kontrol",
    rows: dualRows("co-a"),
  });
  pass(fresh.ok === true, "post-fence new-epoch write ok");
  await clearAllTransferCache();
  pass(idbCountForCompany("co-a") === 0, "after clear empty");
}

console.log("5b) exact-delete — same key/run newer epoch preserved");
resetAll();
{
  const sharedRun = "shared-run-epoch-race";
  const sharedKey = buildLucaTransferStorageKey("bank", "co-a", sharedRun);
  globalThis.__ANNVERO_TRANSFER_AFTER_PUT_HOOK__ = async () => {
    globalThis.__ANNVERO_TRANSFER_AFTER_PUT_HOOK__ = undefined;
    synchronouslyFenceAllTransfers();
    const newer = await saveLucaTransferDataset({
      source: "bank",
      companyId: "co-a",
      runId: sharedRun,
      authUserId: "user-a",
      consumer: "fis_kontrol",
      rows: dualRows("co-a"),
    });
    pass(newer.ok === true, "newer same-key write ok");
  };
  const stale = await saveLucaTransferDataset({
    source: "bank",
    companyId: "co-a",
    runId: sharedRun,
    authUserId: "user-a",
    consumer: "fis_kontrol",
    rows: dualRows("co-a"),
  });
  globalThis.__ANNVERO_TRANSFER_AFTER_PUT_HOOK__ = undefined;
  pass(
    stale.ok === false && stale.error === "transfer_fence_stale",
    "stale writer reports stale"
  );
  pass(idbHasKey(sharedKey), "newer epoch record survives exact-delete");
  const map = globalThis.__ANNVERO_FAKE_IDB__?.__getStore?.(LUCA_TRANSFER_IDB_NAME);
  const rec = map?.get(sharedKey);
  pass(
    Number(rec?.writeFence?.authEpoch) === getTransferAuthEpoch(),
    "surviving record has current auth epoch"
  );
}

console.log("5c) logout+A stale + concurrent valid B write");
resetAll();
{
  const keyB = buildLucaTransferStorageKey("bank", "co-b", "valid-b");
  globalThis.__ANNVERO_TRANSFER_AFTER_PUT_HOOK__ = async ({ companyId }) => {
    if (companyId !== "co-a") return;
    globalThis.__ANNVERO_TRANSFER_AFTER_PUT_HOOK__ = undefined;
    synchronouslyFenceAllTransfers();
    const okB = await saveLucaTransferDataset({
      source: "bank",
      companyId: "co-b",
      runId: "valid-b",
      authUserId: "user-a",
      consumer: "fis_kontrol",
      rows: dualRows("co-b"),
    });
    pass(okB.ok === true, "concurrent B write after logout fence ok");
  };
  const lateA = await saveLucaTransferDataset({
    source: "bank",
    companyId: "co-a",
    runId: "stale-logout-a",
    authUserId: "user-a",
    consumer: "fis_kontrol",
    rows: dualRows("co-a"),
  });
  globalThis.__ANNVERO_TRANSFER_AFTER_PUT_HOOK__ = undefined;
  pass(lateA.ok === false, "logout-stale A write rejected");
  pass(idbHasKey(keyB), "valid B remains after A exact-delete");
  pass(
    !idbHasKey(buildLucaTransferStorageKey("bank", "co-a", "stale-logout-a")),
    "stale A record deleted by matching fence"
  );
}

console.log("5d) company-switch+A stale + valid B write");
resetAll();
{
  await seedCompany("co-b");
  globalThis.__ANNVERO_TRANSFER_AFTER_PUT_HOOK__ = async ({ companyId }) => {
    if (companyId !== "co-a") return;
    globalThis.__ANNVERO_TRANSFER_AFTER_PUT_HOOK__ = undefined;
    synchronouslyFenceCompanyTransfers("co-a");
    const okB = await saveLucaTransferDataset({
      source: "bank",
      companyId: "co-b",
      runId: "company-switch-b",
      authUserId: "user-a",
      consumer: "fis_kontrol",
      rows: dualRows("co-b"),
    });
    pass(okB.ok === true, "B write during A company fence ok");
  };
  const lateA = await saveLucaTransferDataset({
    source: "bank",
    companyId: "co-a",
    runId: "company-stale-a",
    authUserId: "user-a",
    consumer: "fis_kontrol",
    rows: dualRows("co-a"),
  });
  globalThis.__ANNVERO_TRANSFER_AFTER_PUT_HOOK__ = undefined;
  pass(lateA.ok === false, "company-stale A rejected");
  pass(
    idbHasKey(buildLucaTransferStorageKey("bank", "co-b", "company-switch-b")),
    "B kept after company A exact-delete"
  );
}

console.log("6) company fence — A write blocked mid-flight, B write ok");
resetAll();
{
  await seedCompany("co-a");
  await seedCompany("co-b");
  globalThis.__ANNVERO_TRANSFER_SAVE_HOOK__ = async ({ companyId }) => {
    if (companyId === "co-a") synchronouslyFenceCompanyTransfers("co-a");
  };
  const lateA = await saveLucaTransferDataset({
    source: "bank",
    companyId: "co-a",
    runId: "stale-a",
    authUserId: "user-a",
    consumer: "fis_kontrol",
    rows: dualRows("co-a"),
  });
  globalThis.__ANNVERO_TRANSFER_SAVE_HOOK__ = undefined;
  pass(lateA.ok === false, "A write after company fence blocked");
  const okB = await saveLucaTransferDataset({
    source: "bank",
    companyId: "co-b",
    runId: "fresh-b",
    authUserId: "user-a",
    consumer: "fis_kontrol",
    rows: dualRows("co-b"),
  });
  pass(okB.ok === true, "B write still allowed");
  await clearCompanyTransferCache("co-a");
  pass(idbHasKey(buildLucaTransferStorageKey("bank", "co-b", "fresh-b")), "B kept");
}

console.log("6b) substring companyId — benzer firma yanlış silinmez");
resetAll();
{
  await seedCompany("co-a");
  await seedCompany("co-a-extra");
  await clearCompanyTransferCache("co-a");
  pass(idbCountForCompany("co-a") === 0, "exact co-a cleared");
  pass(idbCountForCompany("co-a-extra") === 1, "co-a-extra preserved (no substring)");
}

console.log("7) concurrent clear + in-flight put (fake IDB order)");
resetAll();
{
  globalThis.__ANNVERO_TRANSFER_SAVE_HOOK__ = async () => {
    synchronouslyFenceAllTransfers();
    await clearAllTransferCache();
  };
  const result = await saveLucaTransferDataset({
    source: "bank",
    companyId: "co-race",
    runId: "race-1",
    authUserId: "user-a",
    consumer: "fis_kontrol",
    rows: dualRows("co-race"),
  });
  globalThis.__ANNVERO_TRANSFER_SAVE_HOOK__ = undefined;
  const key = buildLucaTransferStorageKey("bank", "co-race", "race-1");
  pass(result.ok === false || !idbHasKey(key), "race write did not stick");
  pass(!idbHasKey(key), "race key absent after cleanup");
}

console.log("8) idempotent double clear + retry pending (no companyId/PII)");
resetAll();
{
  await seedCompany("co-a");
  pass((await clearAllTransferCache()).ok, "first clear");
  pass((await clearAllTransferCache()).ok, "second clear idempotent");
  __setTransferCleanupPendingForTests({
    type: "all",
    authEpoch: getTransferAuthEpoch(),
    at: Date.now(),
  });
  pass(Boolean(__getTransferCleanupPendingForTests()), "pending set");
  const pendingRaw = JSON.stringify(__getTransferCleanupPendingForTests());
  pass(!/"companyId"/.test(pendingRaw), "pending has no companyId");
  pass(!/"userId"/.test(pendingRaw), "pending has no userId");
  pass(!/"runId"/.test(pendingRaw), "pending has no runId");
  const retry = await retryPendingTransferCleanupIfNeeded();
  pass(retry.ok === true, "retry ok");
  pass(!__getTransferCleanupPendingForTests(), "pending cleared");
}

console.log("8b) pending marked before cleanup; clearClientSessionCaches does not wipe it");
resetAll();
{
  const logoutSrc = fs.readFileSync(
    path.join(root, "src/lib/auth/performClientLogout.js"),
    "utf8"
  );
  const markIdx = logoutSrc.indexOf("markTransferCleanupRetryPending");
  const cleanupIdx = logoutSrc.indexOf("awaitTransferCleanup");
  pass(markIdx > 0 && markIdx < cleanupIdx, "retry pending before cleanup starts");
  __setTransferCleanupPendingForTests({ type: "all", at: Date.now() });
  const clearSession = fs.readFileSync(
    path.join(root, "src/lib/auth/clearClientSession.js"),
    "utf8"
  );
  pass(
    !clearSession.includes("TRANSFER_CLEANUP_PENDING_KEY") &&
      !clearSession.includes("transfer_cleanup_pending"),
    "clearClientSessionCaches does not target retry flag"
  );
  pass(
    Boolean(__getTransferCleanupPendingForTests()),
    "retry flag still present after simulated session clear keys"
  );
}

console.log("9) stale pointer / orphan + PII hygiene");
resetAll();
{
  store.set(
    buildLucaTransferPointerKey("bank", "co-orphan"),
    JSON.stringify({ runId: "gone", companyId: "co-orphan" })
  );
  await clearCompanyTransferCache("co-orphan");
  pass(
    !store.get(buildLucaTransferPointerKey("bank", "co-orphan")),
    "stale pointer removed"
  );
  const life = fs.readFileSync(
    path.join(root, "src/utils/transferCacheLifecycle.js"),
    "utf8"
  );
  pass(!life.includes("SYNTHETIC_DESC_MARKER"), "no PII marker in lifecycle");
}

console.log("10) AuthGate / CompanyWorkspace source contracts");
{
  const gate = fs.readFileSync(
    path.join(root, "src/components/AuthGate.jsx"),
    "utf8"
  );
  pass(gate.includes("TOKEN_REFRESHED"), "TOKEN_REFRESHED handled");
  pass(gate.includes("SIGNED_OUT"), "SIGNED_OUT handled");
  pass(
    !/event === "SIGNED_OUT" \|\| !session/.test(gate),
    "AuthGate no !session wipe shortcut"
  );
  pass(gate.includes("enterAuthenticated"), "enterAuthenticated helper");
  const retryIdx = gate.indexOf("retryPendingTransferCleanupIfNeeded");
  const applyIdx = gate.indexOf('applyStatus("authenticated")', retryIdx);
  pass(
    retryIdx > 0 && applyIdx > retryIdx,
    "retry-before-hydrate: retry awaited before authenticated apply"
  );
  pass(
    !/onAuthStateChange[\s\S]{0,1200}supabase\.auth\.(signOut|getSession|getUser)/.test(
      gate
    ),
    "no Supabase auth call inside onAuthStateChange body"
  );
  const ws = fs.readFileSync(
    path.join(root, "src/contexts/CompanyWorkspaceContext.jsx"),
    "utf8"
  );
  pass(ws.includes("schedulePreviousCompanyTransferCleanup"), "company cleanup");
  pass(ws.includes('addEventListener("storage"'), "storage event company switch");
  pass(ws.includes("previousCompanyIdRef"), "previousCompanyId tracked");
  pass(ws.includes("markTransferCleanupRetryPending"), "company marks retry pending");
}

console.log("ALL transfer-cache lifecycle tests passed.");
