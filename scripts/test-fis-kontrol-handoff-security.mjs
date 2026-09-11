/**
 * Faz 3A — Bank→Fiş Kontrol handoff cache security.
 * Run: npm run test:fis-kontrol-handoff-security
 * (loads fake IndexedDB via --import ./scripts/_install-fake-idb.mjs)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LUCA_TRANSFER_BANK_FIS_KONTROL_TTL_MS,
  LUCA_TRANSFER_TTL_MS,
  LUCA_TRANSFER_IDB_NAME,
  resolveLucaTransferTtlMs,
  assertLucaTransferHydrateBinding,
  LUCA_TRANSFER_SCHEMA_VERSION,
  buildLucaTransferPointerKey,
  buildLucaTransferStorageKey,
  atomicallyConsumeLucaTransferDataset,
  clearLucaTransferPointerIfMatches,
} from "@/src/utils/companyCenter.js";
import {
  __resetCanonicalTransferTestState,
  __listCanonicalTransferMemory,
  publishBankParserTransfer,
  publishLucaProducerTransfer,
  consumeCanonicalFisKontrolHandoff,
  readCanonicalTransferSnapshot,
  buildCanonicalTransferSnapshot,
  CANONICAL_TRANSFER_CONSUMER,
  CANONICAL_TRANSFER_STATUS,
} from "@/src/utils/canonicalFisControlTransfer.js";

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
  "fake indexedDB installed via --import"
);

const store = new Map();
const localStorageMock = {
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
globalThis.localStorage = localStorageMock;
globalThis.window = { localStorage: localStorageMock };

function row(companyId, i = 1) {
  return {
    id: `r-${i}`,
    firmaId: companyId,
    fisNo: String(i),
    fisTarihi: "10.03.2026",
    hesapKodu: "102.01.001",
    borc: 10,
    alacak: 0,
    aciklama: "SYNTHETIC_DESC_MARKER",
    belgeTuru: "FT",
    sourceMovementId: `m-${i}`,
    lineRole: "debit",
  };
}

function dualRows(companyId) {
  return [
    row(companyId, 1),
    {
      ...row(companyId, 2),
      borc: 0,
      alacak: 10,
      lineRole: "credit",
      hesapKodu: "320.01.001",
    },
  ];
}

function resetAll() {
  __resetCanonicalTransferTestState();
  store.clear();
  globalThis.__ANNVERO_FAKE_IDB__?.__resetAll?.();
}

function idbHasKey(storageKey) {
  const map = globalThis.__ANNVERO_FAKE_IDB__?.__getStore?.(LUCA_TRANSFER_IDB_NAME);
  return Boolean(map?.has(storageKey));
}

function localStorageHasRawRows() {
  for (const [, raw] of store) {
    if (/"rows"\s*:/.test(String(raw)) && /"borc"\s*:/.test(String(raw))) {
      return true;
    }
  }
  return false;
}

resetAll();

console.log("1) TTL constants + table");
pass(
  LUCA_TRANSFER_BANK_FIS_KONTROL_TTL_MS === 1_800_000,
  "bank+fis_kontrol TTL = 1_800_000 ms (30m)"
);
pass(
  LUCA_TRANSFER_TTL_MS === 86_400_000,
  "default TTL = 86_400_000 ms (24h)"
);
pass(
  resolveLucaTransferTtlMs({ source: "bank", consumer: "fis_kontrol" }) ===
    1_800_000,
  "resolve bank+fis_kontrol → 1_800_000"
);
pass(
  resolveLucaTransferTtlMs({ source: "bank", consumer: "luca_producer" }) ===
    86_400_000,
  "resolve bank+luca_producer → 86_400_000"
);
pass(
  resolveLucaTransferTtlMs({ source: "elektraweb", consumer: "elektraweb_luca" }) ===
    86_400_000,
  "resolve elektraweb → 86_400_000"
);

const snap30 = buildCanonicalTransferSnapshot({
  companyId: "co-a",
  authUserId: "user-a",
  rows: dualRows("co-a"),
  consumer: CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
  source: "bank",
  createdAt: "2026-09-11T10:00:00.000Z",
});
pass(
  Date.parse(snap30.expiresAt) - Date.parse(snap30.createdAt) === 1_800_000,
  "expiresAt = created + 1_800_000"
);

console.log("2) happy path consume-once (IDB + memory)");
resetAll();
{
  const pub = await publishBankParserTransfer({
    companyId: "co-a",
    companyName: "A",
    bankName: "TestBank",
    rows: dualRows("co-a"),
    authUserId: "user-a",
    sourceId: "src-1",
  });
  pass(pub.ok === true, "publish ok");
  const key = buildLucaTransferStorageKey("bank", "co-a", pub.runId);
  pass(idbHasKey(key), "IDB has exact key after publish");
  pass(!localStorageHasRawRows(), "localStorage has no raw rows (pointer/meta only)");
  const first = await consumeCanonicalFisKontrolHandoff({
    companyId: "co-a",
    source: "bank",
    runId: pub.runId,
    authUserId: "user-a",
  });
  pass(first.ok === true && first.snapshot?.rows?.length === 2, "first consume payload");
  pass(__listCanonicalTransferMemory().length === 0, "memory cleared after consume");
  pass(!idbHasKey(key), "exact IDB key gone after consume");
  const second = await consumeCanonicalFisKontrolHandoff({
    companyId: "co-a",
    source: "bank",
    runId: pub.runId,
    authUserId: "user-a",
  });
  pass(second.ok === false && second.code === "NOT_FOUND", "second consume NOT_FOUND");
}

console.log("3) concurrent consume via facade (may use module gate)");
resetAll();
{
  const pub = await publishBankParserTransfer({
    companyId: "co-a",
    rows: dualRows("co-a"),
    authUserId: "user-a",
  });
  const [a, b] = await Promise.all([
    consumeCanonicalFisKontrolHandoff({
      companyId: "co-a",
      source: "bank",
      runId: pub.runId,
      authUserId: "user-a",
    }),
    consumeCanonicalFisKontrolHandoff({
      companyId: "co-a",
      source: "bank",
      runId: pub.runId,
      authUserId: "user-a",
    }),
  ]);
  const wins = [a, b].filter((x) => x.ok);
  const loses = [a, b].filter((x) => !x.ok);
  pass(wins.length === 1, "exactly one concurrent winner (facade)");
  pass(
    loses.length === 1 &&
      (loses[0].code === "NOT_FOUND" || loses[0].code === "ALREADY_CONSUMED"),
    "loser NOT_FOUND/ALREADY_CONSUMED (facade)"
  );
}

console.log("3b) REAL IDB race — two connections, atomicallyConsume only (no memory gate)");
resetAll();
{
  const pub = await publishBankParserTransfer({
    companyId: "co-a",
    rows: dualRows("co-a"),
    authUserId: "user-a",
  });
  const key = buildLucaTransferStorageKey("bank", "co-a", pub.runId);
  pass(idbHasKey(key), "pre-race IDB key present");
  // Clear module memory so only IDB holds the record; bypass consumeGates
  __resetCanonicalTransferTestState();
  pass(__listCanonicalTransferMemory().length === 0, "memory empty — IDB-only race");

  const [a, b] = await Promise.all([
    atomicallyConsumeLucaTransferDataset({
      source: "bank",
      companyId: "co-a",
      runId: pub.runId,
      authUserId: "user-a",
    }),
    atomicallyConsumeLucaTransferDataset({
      source: "bank",
      companyId: "co-a",
      runId: pub.runId,
      authUserId: "user-a",
    }),
  ]);
  const wins = [a, b].filter((x) => x.ok && x.snapshot?.rows?.length === 2);
  const loses = [a, b].filter((x) => !x.ok);
  pass(wins.length === 1, "IDB race: exactly one full consumer payload");
  pass(
    loses.length === 1 &&
      (loses[0].code === "NOT_FOUND" || loses[0].code === "ALREADY_CONSUMED"),
    "IDB race: other NOT_FOUND/ALREADY_CONSUMED"
  );
  pass(wins.length !== 2, "IDB race FAIL-guard: dual payload must not happen");
  pass(!idbHasKey(key), "IDB race: key deleted after winner");
}

console.log("4) auth fail-closed + repo search");
resetAll();
{
  const pub = await publishBankParserTransfer({
    companyId: "co-a",
    rows: dualRows("co-a"),
    authUserId: "user-a",
  });
  const noAuth = await readCanonicalTransferSnapshot({
    companyId: "co-a",
    source: "bank",
    runId: pub.runId,
  });
  pass(noAuth.ok === false && noAuth.code === "AUTH_REQUIRED", "read without auth blocked");
  const wrong = await consumeCanonicalFisKontrolHandoff({
    companyId: "co-a",
    source: "bank",
    runId: pub.runId,
    authUserId: "user-b",
  });
  pass(
    wrong.ok === false && wrong.code === "AUTH_USER_MISMATCH",
    "different user blocked"
  );
}

{
  const srcRoots = ["src", "app"].map((d) => path.join(root, d));
  let fallbackHits = 0;
  let anonHits = 0;
  const fallbackRe =
    /authUserId\s*\|\|\s*(?:textId\()?[a-zA-Z0-9_.]*(?:snapshot|baseSnapshot)\.authUserId/;
  const anonRe = /anonymous-transfer/;
  for (const dir of srcRoots) {
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "node_modules" || ent.name === ".next") continue;
          stack.push(p);
          continue;
        }
        if (!/\.(js|jsx|mjs|ts|tsx)$/.test(ent.name)) continue;
        const text = fs.readFileSync(p, "utf8");
        if (fallbackRe.test(text)) {
          fallbackHits += 1;
          console.error("  fallback hit:", path.relative(root, p));
        }
        if (anonRe.test(text)) {
          anonHits += 1;
          console.error("  anon hit:", path.relative(root, p));
        }
      }
    }
  }
  // scripts/ excluded — test file documents the forbidden pattern
  pass(fallbackHits === 0, `authUserId||snapshot.authUserId fallback hits (src+app) = ${fallbackHits}`);
  pass(anonHits === 0, `anonymous-transfer hits (src+app) = ${anonHits}`);
}

console.log("5) TTL boundaries (contract: exact expiry == expired)");
{
  const createdAt = "2026-09-11T10:00:00.000Z";
  const base = buildCanonicalTransferSnapshot({
    companyId: "co-a",
    authUserId: "user-a",
    rows: dualRows("co-a"),
    consumer: CANONICAL_TRANSFER_CONSUMER.FIS_KONTROL,
    source: "bank",
    createdAt,
  });
  const expiresMs = Date.parse(base.expiresAt);
  pass(expiresMs - Date.parse(createdAt) === 1_800_000, "30m expiresAt delta");

  const almost = assertLucaTransferHydrateBinding({
    dataset: base,
    activeCompanyId: "co-a",
    authUserId: "user-a",
    expectedSource: "bank",
    nowMs: expiresMs - 1,
    requireConsumableStatus: true,
  });
  pass(almost.ok === true, "29:59.999 valid (expiresMs - 1)");

  const atExpiry = assertLucaTransferHydrateBinding({
    dataset: base,
    activeCompanyId: "co-a",
    authUserId: "user-a",
    expectedSource: "bank",
    nowMs: expiresMs,
    requireConsumableStatus: true,
  });
  pass(
    atExpiry.ok === false && atExpiry.code === "EXPIRED",
    "30:00.000 expired (nowMs >= expiresAt)"
  );

  const luca = buildCanonicalTransferSnapshot({
    companyId: "co-a",
    authUserId: "user-a",
    rows: dualRows("co-a"),
    consumer: CANONICAL_TRANSFER_CONSUMER.LUCA_PRODUCER,
    source: "bank",
    createdAt,
  });
  const lucaExp = Date.parse(luca.expiresAt);
  pass(lucaExp - Date.parse(createdAt) === 86_400_000, "24h expiresAt delta");
  const almost24 = assertLucaTransferHydrateBinding({
    dataset: luca,
    activeCompanyId: "co-a",
    authUserId: "user-a",
    expectedSource: "bank",
    nowMs: lucaExp - 1,
    requireConsumableStatus: false,
  });
  pass(almost24.ok === true, "23:59:59.999 other flow valid");
  const at24 = assertLucaTransferHydrateBinding({
    dataset: luca,
    activeCompanyId: "co-a",
    authUserId: "user-a",
    expectedSource: "bank",
    nowMs: lucaExp,
    requireConsumableStatus: false,
  });
  pass(at24.ok === false && at24.code === "EXPIRED", "24:00:00.000 other flow expired");
}

console.log("6) status CONSUMED rejected");
{
  const base = buildCanonicalTransferSnapshot({
    companyId: "co-a",
    authUserId: "user-a",
    rows: dualRows("co-a"),
    status: CANONICAL_TRANSFER_STATUS.CONSUMED,
  });
  const r = assertLucaTransferHydrateBinding({
    dataset: base,
    activeCompanyId: "co-a",
    authUserId: "user-a",
    expectedSource: "bank",
    requireConsumableStatus: true,
  });
  pass(r.ok === false && r.code === "ALREADY_CONSUMED", "CONSUMED → ALREADY_CONSUMED");
}

console.log("7) other source TTL preserved + not consumed by FK");
resetAll();
{
  const luca = await publishLucaProducerTransfer({
    companyId: "co-a",
    rows: dualRows("co-a"),
    authUserId: "user-a",
  });
  pass(luca.ok === true, "luca producer publish");
  const mem = __listCanonicalTransferMemory();
  pass(mem.length === 1, "luca snapshot in memory");
  const lucaKey = buildLucaTransferStorageKey("bank", "co-a", luca.runId);
  pass(idbHasKey(lucaKey), "luca IDB key present");
  const fkTry = await consumeCanonicalFisKontrolHandoff({
    companyId: "co-a",
    source: "bank",
    runId: luca.runId,
    authUserId: "user-a",
  });
  pass(
    fkTry.ok === false && fkTry.code === "CONSUMER_MISMATCH",
    "FK consume does not take luca_producer runId"
  );
  pass(__listCanonicalTransferMemory().length === 1, "luca memory preserved");
  pass(idbHasKey(lucaKey), "luca IDB key preserved after FK mismatch");
}

console.log("8) company mismatch");
resetAll();
{
  const pub = await publishBankParserTransfer({
    companyId: "co-a",
    rows: dualRows("co-a"),
    authUserId: "user-a",
  });
  const r = await consumeCanonicalFisKontrolHandoff({
    companyId: "co-b",
    source: "bank",
    runId: pub.runId,
    authUserId: "user-a",
  });
  pass(r.ok === false, "company mismatch blocked");
}

console.log("9) malformed / version / clone failure does not consume");
{
  const bad = assertLucaTransferHydrateBinding({
    dataset: { rows: [], schemaVersion: 2, companyId: "co-a", authUserId: "u" },
    activeCompanyId: "co-a",
    authUserId: "u",
  });
  pass(bad.ok === false && bad.code === "MALFORMED", "empty rows MALFORMED");
  const ver = assertLucaTransferHydrateBinding({
    dataset: {
      rows: dualRows("co-a"),
      schemaVersion: 1,
      companyId: "co-a",
      authUserId: "u",
      source: "bank",
      runId: "r1",
      status: "ready",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    activeCompanyId: "co-a",
    authUserId: "u",
    expectedSource: "bank",
  });
  pass(ver.ok === false && ver.code === "VERSION_MISMATCH", "version mismatch");
}

resetAll();
{
  const pub = await publishBankParserTransfer({
    companyId: "co-a",
    rows: dualRows("co-a"),
    authUserId: "user-a",
  });
  const key = buildLucaTransferStorageKey("bank", "co-a", pub.runId);
  const map = globalThis.__ANNVERO_FAKE_IDB__.__getStore(LUCA_TRANSFER_IDB_NAME);
  const existing = map.get(key);
  // Circular graph → structuredClone + JSON.stringify fail → MALFORMED, no delete
  existing.self = existing;
  map.set(key, existing);
  __resetCanonicalTransferTestState();
  const r = await atomicallyConsumeLucaTransferDataset({
    source: "bank",
    companyId: "co-a",
    runId: pub.runId,
    authUserId: "user-a",
  });
  pass(r.ok === false && r.code === "MALFORMED", "clone failure → MALFORMED");
  pass(idbHasKey(key), "clone failure does not delete IDB record");
}

console.log("10) pointer race — re-read before clear");
{
  const pointerKey = buildLucaTransferPointerKey("bank", "co-a");
  store.clear();
  localStorage.setItem(pointerKey, JSON.stringify({ runId: "run-old" }));
  const cleared = clearLucaTransferPointerIfMatches({
    source: "bank",
    companyId: "co-a",
    runId: "run-old",
  });
  pass(cleared.cleared === true && !localStorage.getItem(pointerKey), "matching pointer cleared");

  localStorage.setItem(pointerKey, JSON.stringify({ runId: "run-old" }));
  localStorage.setItem(pointerKey, JSON.stringify({ runId: "run-new" }));
  const keep = clearLucaTransferPointerIfMatches({
    source: "bank",
    companyId: "co-a",
    runId: "run-old",
  });
  pass(keep.after === "run-new", "newer pointer preserved when clearing old run");
  pass(localStorage.getItem(pointerKey) != null, "pointer key still present for new run");
}

console.log("11) schema + keys + PII marker hygiene");
pass(LUCA_TRANSFER_SCHEMA_VERSION === 2, "schema v2");
pass(
  buildLucaTransferPointerKey("bank", "co-a").includes(":latest:co-a"),
  "pointer key company-scoped"
);
pass(
  buildLucaTransferStorageKey("bank", "co-a", "run-1").endsWith(":run-1"),
  "storage key run-scoped"
);
pass(
  !String(resolveLucaTransferTtlMs).includes("SYNTHETIC_DESC_MARKER"),
  "no synthetic PII in ttl helper"
);

console.log("12) commit-before-UI (fis-kontrol page source contract)");
{
  const page = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/fis-kontrol/page.jsx"),
    "utf8"
  );
  const consumeIdx = page.indexOf("await consumeCanonicalFisKontrolHandoff");
  const applyIdx = page.indexOf("applyNormalizedPayload(normalizeIncomingPayload(consumed.snapshot))");
  pass(consumeIdx > 0 && applyIdx > consumeIdx, "applyNormalizedPayload only after await consume");
  pass(
    /if\s*\(\s*!consumed\.ok\s*\|\|\s*!consumed\.snapshot\s*\)/.test(page),
    "UI applies only on consumed.ok + snapshot"
  );
  pass(
    /authUserId:\s*sessionAuth/.test(page) ||
      /const sessionAuth = await resolveAuthUserIdForTransfer/.test(page),
    "edit path uses session auth, not payload authority"
  );
}

console.log("ALL fis-kontrol handoff security tests passed.");
