/**
 * Firma-scoped TEB format çözümü + server learning_memory kalıcılık sözleşmesi.
 * Gerçek müşteri verisi yok; Desktop gerçek dosya yalnız salt-okunur opsiyonel smoke.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { detectExcelBank } from "../src/utils/bankExcelAutoDetect.js";
import {
  resolveExcelBankWithCompanyContext,
} from "../src/utils/bankStatementFormatGuard.js";
import {
  matchStatementAccountToCompanyBanks,
  BANK_RESOLUTION_SOURCE,
} from "../src/utils/bankStatementCompanyBankResolve.js";
import {
  extractStatementFormatMemoryFromLearning,
  findConfirmedStatementFormatMemory,
  loadCompanyStatementFormatMemory,
  mergeStatementFormatMemorySources,
  persistConfirmedStatementFormatMemory,
  syncLocalStatementFormatCacheFromServer,
  __setStatementFormatMemoryStoreForTests,
  __resetStatementFormatMemoryStoreForTests,
  __clearLocalStatementFormatCacheForTests,
  STATEMENT_FORMAT_DOCUMENT_TYPE,
  STATEMENT_FORMAT_PERSIST_WARNING,
} from "../src/utils/bankStatementFormatMemory.js";
import { buildBankStatementSchemaFingerprint } from "../src/utils/bankStatementSchemaFingerprint.js";
import { canStartFullPipeline } from "../src/utils/bankOneClickPipeline.js";
import {
  FIXTURE_TEB_SEVEN_COLUMN_ANON,
  FIXTURE_TEB_FOURTEEN_COLUMN_ANON,
  FIXTURE_TEB_FILENAME_WEAK_DEKONT,
  FIXTURE_TEB_XLSX_ROWS,
  FIXTURE_ZIRAAT_REAL_EXPORT_ANON,
  FIXTURE_GARANTI_ROWS,
  FIXTURE_KUVEYTTURK_XLSX_ROWS,
  FIXTURE_VAKIF_ROWS,
} from "./fixtures/bank-excel/sheetRows.mjs";

const require = createRequire(import.meta.url);

/** Schema-memory / persist akışları için TEB 7-kolon (eski “garanti-like” ad) */
const TEB_SEVEN = FIXTURE_TEB_SEVEN_COLUMN_ANON.rows;
const TEB_FILE = FIXTURE_TEB_SEVEN_COLUMN_ANON.fileName;
const TEB_SHEET = FIXTURE_TEB_SEVEN_COLUMN_ANON.sheetName;
const TEB_GARANTI_LIKE = TEB_SEVEN;

async function withMemoryStore(fn) {
  __setStatementFormatMemoryStoreForTests({});
  try {
    return await fn();
  } finally {
    __resetStatementFormatMemoryStoreForTests();
  }
}

function makeServerStore() {
  const rows = [];
  return {
    rows,
    createCount: 0,
    updateCount: 0,
    async create(payload) {
      this.createCount += 1;
      const row = {
        id: `lm-${this.createCount}`,
        ...payload,
        company_id: payload.company_id,
        learned_at: payload.learned_at || new Date().toISOString(),
      };
      rows.push(row);
      return { data: row, error: null };
    },
    async update(id, fields) {
      this.updateCount += 1;
      const idx = rows.findIndex((r) => String(r.id) === String(id));
      if (idx < 0) return { data: null, error: "missing" };
      rows[idx] = { ...rows[idx], ...fields, id };
      return { data: rows[idx], error: null };
    },
    async createFail() {
      this.createCount += 1;
      return { data: null, error: "server_unavailable" };
    },
  };
}

console.log("\n=== company context + schema memory ===");

await withMemoryStore(async () => {
  // Hesap eşleşmesi
  const rowsWithIban = [
    ["IBAN", "TR330003200000000000000099"],
    ...TEB_GARANTI_LIKE,
  ];
  const accountHit = matchStatementAccountToCompanyBanks({
    sheetRows: rowsWithIban,
    bankAccounts: [
      {
        bankName: "TEB",
        iban: "TR330003200000000000000099",
        accountNumber: "320000000000000099",
        isActive: true,
      },
    ],
  });
  assert.equal(accountHit.status, "unique");
  assert.equal(accountHit.canonicalBankId, "TEB");
  const detectedViaAccount = resolveExcelBankWithCompanyContext(rowsWithIban, {
    companyId: "co-teb-1",
    bankAccounts: [
      {
        bankName: "TEB",
        iban: "TR330003200000000000000099",
        isActive: true,
      },
    ],
    fileName: "ekstre.xlsx",
    sheetName: TEB_SHEET,
  });
  assert.equal(detectedViaAccount.status, "detected");
  assert.equal(detectedViaAccount.bankId, "TEB");
  assert.ok(
    [
      BANK_RESOLUTION_SOURCE.COMPANY_ACCOUNT_MATCH,
      BANK_RESOLUTION_SOURCE.STRONG_STATEMENT_IDENTITY,
      BANK_RESOLUTION_SOURCE.UNIQUE_FORMAT_FINGERPRINT,
    ].includes(detectedViaAccount.resolutionSource),
    `unexpected source ${detectedViaAccount.resolutionSource}`
  );
  console.log("OK — company account match → TEB");

  // A) İlk kullanıcı TEB: server write tam 1 + local cache + pipeline devam
  const serverA = makeServerStore();
  const persistA = await persistConfirmedStatementFormatMemory({
    companyId: "co-learn",
    sheetRows: TEB_GARANTI_LIKE,
    bankId: "TEB",
    sheetName: TEB_SHEET,
    existingLearningRecords: [],
    createRecord: (p) => serverA.create(p),
    updateRecord: (id, f) => serverA.update(id, f),
  });
  assert.equal(persistA.persisted, true);
  assert.equal(persistA.serverWriteCount, 1);
  assert.equal(serverA.createCount, 1);
  assert.equal(serverA.rows.length, 1);
  assert.equal(serverA.rows[0].document_type, STATEMENT_FORMAT_DOCUMENT_TYPE);
  assert.equal(serverA.rows[0].bank_name, "TEB");
  assert.ok(String(serverA.rows[0].keyword || "").startsWith("sf:"));
  assert.doesNotMatch(
    JSON.stringify(serverA.rows[0]),
    /TR\d{2}|iban|tutar|bakiye|aciklama|GERCEK/i
  );
  assert.equal(loadCompanyStatementFormatMemory("co-learn").length, 1);
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "co-learn",
      selectedBank: "TEB",
      selectedFile: { name: TEB_FILE },
      isJobBusy: false,
      pipelinePhase: "IDLE",
    }),
    true
  );
  console.log("OK — A server write once + local cache + pipeline gate");

  // E) Aynı company + fingerprint ikinci onay → upsert/reuse, duplicate yok
  const persistE = await persistConfirmedStatementFormatMemory({
    companyId: "co-learn",
    sheetRows: TEB_GARANTI_LIKE,
    bankId: "TEB",
    sheetName: TEB_SHEET,
    existingLearningRecords: serverA.rows,
    createRecord: (p) => serverA.create(p),
    updateRecord: (id, f) => serverA.update(id, f),
  });
  assert.equal(persistE.persisted, true);
  assert.equal(persistE.reused, true);
  assert.equal(serverA.rows.length, 1);
  assert.equal(serverA.createCount, 1);
  assert.equal(serverA.updateCount, 1);
  console.log("OK — E upsert/reuse no duplicate");

  // B) Local cache temiz + server hydrate → otomatik TEB
  __clearLocalStatementFormatCacheForTests("co-learn");
  assert.equal(loadCompanyStatementFormatMemory("co-learn").length, 0);
  const serverHydrated = extractStatementFormatMemoryFromLearning(
    serverA.rows,
    "co-learn"
  );
  assert.equal(serverHydrated.length, 1);
  syncLocalStatementFormatCacheFromServer("co-learn", serverHydrated);
  const merged = mergeStatementFormatMemorySources({
    companyId: "co-learn",
    serverRecords: serverHydrated,
    localRecords: [],
  });
  const viaServerOnly = resolveExcelBankWithCompanyContext(TEB_GARANTI_LIKE, {
    companyId: "co-learn",
    bankAccounts: [],
    fileName: TEB_FILE,
    sheetName: TEB_SHEET,
    formatMemoryRecords: merged,
  });
  assert.equal(viaServerOnly.status, "detected");
  assert.equal(viaServerOnly.bankId, "TEB");
  assert.equal(viaServerOnly.parserBankId, "TEB");
  assert.equal(
    viaServerOnly.resolutionSource,
    BANK_RESOLUTION_SOURCE.COMPANY_SCHEMA_MEMORY
  );
  console.log("OK — B local empty + server hydrate → auto TEB");

  // C) Server write hata → warning, persisted false, pipeline yine başlayabilir
  const serverFail = makeServerStore();
  const persistFail = await persistConfirmedStatementFormatMemory({
    companyId: "co-fail",
    sheetRows: TEB_GARANTI_LIKE,
    bankId: "TEB",
    sheetName: TEB_SHEET,
    existingLearningRecords: [],
    createRecord: () => serverFail.createFail(),
  });
  assert.equal(persistFail.persisted, false);
  assert.equal(persistFail.serverWriteCount, 0);
  assert.equal(persistFail.warning, STATEMENT_FORMAT_PERSIST_WARNING);
  assert.ok(persistFail.memory);
  assert.equal(persistFail.memory.serverPersisted, false);
  assert.equal(
    canStartFullPipeline({
      selectedCompanyId: "co-fail",
      selectedBank: "TEB",
      selectedFile: { name: TEB_FILE },
      isJobBusy: false,
      pipelinePhase: "IDLE",
    }),
    true
  );
  console.log("OK — C server fail warning + pipeline continues");

  // D) Başka companyId — server memory uygulanmaz; exclusive TEB7 yine içerikten TEB
  const otherCo = resolveExcelBankWithCompanyContext(TEB_GARANTI_LIKE, {
    companyId: "co-other",
    bankAccounts: [{ bankName: "TEB", isActive: true }],
    fileName: TEB_FILE,
    sheetName: TEB_SHEET,
    formatMemoryRecords: extractStatementFormatMemoryFromLearning(
      serverA.rows,
      "co-other"
    ),
  });
  assert.equal(otherCo.status, "detected");
  assert.equal(otherCo.bankId, "TEB");
  assert.equal(
    otherCo.resolutionSource,
    BANK_RESOLUTION_SOURCE.UNIQUE_FORMAT_FINGERPRINT
  );
  const leakExtract = extractStatementFormatMemoryFromLearning(
    serverA.rows,
    "co-stranger"
  );
  assert.equal(leakExtract.length, 0);
  const leakFind = findConfirmedStatementFormatMemory({
    companyId: "co-stranger",
    schemaFingerprint: serverHydrated[0].schemaFingerprint,
    currency: serverHydrated[0].currency,
    directionModel: serverHydrated[0].directionModel,
    records: serverHydrated,
  });
  assert.equal(leakFind, null);
  console.log("OK — D tenant isolation / exclusive TEB7 without leaked memory");

  // Filename alone ≠ TEB (zayıf dekont kolonları)
  const fileOnly = detectExcelBank(FIXTURE_TEB_FILENAME_WEAK_DEKONT.rows, {
    fileName: FIXTURE_TEB_FILENAME_WEAK_DEKONT.fileName,
    sheetName: FIXTURE_TEB_FILENAME_WEAK_DEKONT.sheetName,
  });
  assert.notEqual(fileOnly.bankId, "TEB");
  assert.equal(fileOnly.status, "unknown");
  const fileOnlyCtx = resolveExcelBankWithCompanyContext(
    FIXTURE_TEB_FILENAME_WEAK_DEKONT.rows,
    {
      companyId: "co-fn",
      fileName: FIXTURE_TEB_FILENAME_WEAK_DEKONT.fileName,
      sheetName: FIXTURE_TEB_FILENAME_WEAK_DEKONT.sheetName,
    }
  );
  assert.equal(fileOnlyCtx.status, "requires_confirmation");
  assert.equal(fileOnlyCtx.bankId, null);
  console.log("OK — filename alone ≠ TEB");

  // Zayıf Garanti kolonları + TEB+Garanti hesap → confirmation
  const ambiguousCo = resolveExcelBankWithCompanyContext(
    FIXTURE_TEB_FILENAME_WEAK_DEKONT.rows,
    {
      companyId: "co-both",
      bankAccounts: [
        { bankName: "TEB", isActive: true },
        { bankName: "Garanti", isActive: true },
      ],
      fileName: FIXTURE_TEB_FILENAME_WEAK_DEKONT.fileName,
      sheetName: FIXTURE_TEB_FILENAME_WEAK_DEKONT.sheetName,
    }
  );
  assert.equal(ambiguousCo.status, "requires_confirmation");
  console.log("OK — weak dekont + TEB+Garanti accounts → confirmation");
});

// Brand TEB / Ziraat / Garanti / Kuveyt / Vakıf regresyon
{
  const strong = resolveExcelBankWithCompanyContext(FIXTURE_TEB_XLSX_ROWS, {
    companyId: "co-x",
    fileName: "teb.xlsx",
  });
  assert.equal(strong.status, "detected");
  assert.equal(strong.bankId, "TEB");
  console.log("OK — strong TEB identity preserved");
}

{
  const teb14 = resolveExcelBankWithCompanyContext(
    FIXTURE_TEB_FOURTEEN_COLUMN_ANON.rows,
    {
      companyId: "co-teb14",
      fileName: FIXTURE_TEB_FOURTEEN_COLUMN_ANON.fileName,
      sheetName: FIXTURE_TEB_FOURTEEN_COLUMN_ANON.sheetName,
      bankAccounts: [],
      formatMemoryRecords: [],
    }
  );
  assert.equal(teb14.status, "detected");
  assert.equal(teb14.bankId, "TEB");
  assert.ok(
    (teb14.diagnostics?.matchedSignals || []).includes(
      "header_teb_fourteen_column"
    )
  );
  assert.equal(
    teb14.resolutionSource,
    BANK_RESOLUTION_SOURCE.UNIQUE_FORMAT_FINGERPRINT
  );
  console.log("OK — TEB 14-column exclusive → detected (no confirmation)");
}

{
  const teb7 = resolveExcelBankWithCompanyContext(FIXTURE_TEB_SEVEN_COLUMN_ANON.rows, {
    companyId: "co-teb7",
    fileName: "neutral-export.xlsx",
    sheetName: FIXTURE_TEB_SEVEN_COLUMN_ANON.sheetName,
    bankAccounts: [],
    formatMemoryRecords: [],
  });
  assert.equal(teb7.status, "detected");
  assert.equal(teb7.bankId, "TEB");
  assert.ok(
    (teb7.diagnostics?.matchedSignals || []).includes("header_teb_seven_column")
  );
  assert.equal(
    teb7.resolutionSource,
    BANK_RESOLUTION_SOURCE.UNIQUE_FORMAT_FINGERPRINT
  );
  console.log("OK — TEB 7-column exclusive → detected (no confirmation)");
}

{
  const z = resolveExcelBankWithCompanyContext(FIXTURE_ZIRAAT_REAL_EXPORT_ANON.rows, {
    companyId: "co-z",
    fileName: FIXTURE_ZIRAAT_REAL_EXPORT_ANON.fileName,
    sheetName: FIXTURE_ZIRAAT_REAL_EXPORT_ANON.sheetName,
  });
  assert.equal(z.status, "detected");
  assert.equal(z.bankId, "ZIRAAT");
  console.log("OK — Ziraat regression");
}

for (const [name, rows, bank] of [
  ["Garanti", FIXTURE_GARANTI_ROWS, "GARANTI"],
  ["Kuveyt", FIXTURE_KUVEYTTURK_XLSX_ROWS, "KUVEYTTURK"],
  ["Vakıf", FIXTURE_VAKIF_ROWS, "VAKIFBANK"],
]) {
  const r = resolveExcelBankWithCompanyContext(rows, {
    companyId: "co-reg",
    fileName: `${name}.xlsx`,
  });
  assert.equal(r.status, "detected", name);
  assert.equal(r.bankId, bank, name);
  console.log(`OK — ${name} regression`);
}

// Opsiyonel: Desktop’taki yerel TEB*.xlsx (salt-okunur; repoya kopyalanmaz)
function findOptionalDesktopTebWorkbook() {
  const desk = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(desk)) return null;
  const hit = fs
    .readdirSync(desk)
    .find((n) => /^teb.*\.xlsx$/i.test(n) && !/ornek|örnek|sample|fixture/i.test(n));
  return hit ? path.join(desk, hit) : null;
}

const desktopTeb = findOptionalDesktopTebWorkbook();
if (desktopTeb) {
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch {
    XLSX = null;
  }
  if (XLSX) {
    const wb = XLSX.read(fs.readFileSync(desktopTeb), { type: "buffer", raw: false });
    const sn = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {
      header: 1,
      defval: "",
      raw: false,
    });
    const fp = buildBankStatementSchemaFingerprint(rows, { sheetName: sn });
    assert.ok(fp.schemaFingerprint.startsWith("sf:"));

    await withMemoryStore(async () => {
      const first = resolveExcelBankWithCompanyContext(rows, {
        companyId: "co-desktop-teb",
        fileName: "teb-local.xlsx",
        sheetName: sn,
      });
      // TEB 7-kolon exclusive fingerprint → confirmation gerekmez
      assert.equal(first.status, "detected");
      assert.equal(first.bankId, "TEB");

      const store = makeServerStore();
      const persisted = await persistConfirmedStatementFormatMemory({
        companyId: "co-desktop-teb",
        sheetRows: rows,
        bankId: "TEB",
        sheetName: sn,
        existingLearningRecords: [],
        createRecord: (p) => store.create(p),
      });
      assert.equal(persisted.persisted, true);
      assert.equal(store.createCount, 1);

      __clearLocalStatementFormatCacheForTests("co-desktop-teb");
      const hydrated = extractStatementFormatMemoryFromLearning(
        store.rows,
        "co-desktop-teb"
      );
      const second = resolveExcelBankWithCompanyContext(rows, {
        companyId: "co-desktop-teb",
        fileName: "teb-local.xlsx",
        sheetName: sn,
        formatMemoryRecords: hydrated,
      });
      assert.equal(second.status, "detected");
      assert.equal(second.bankId, "TEB");
      assert.equal(second.parserBankId, "TEB");
    });
    console.log("OK — Desktop TEB local smoke (masked) exclusive detect + memory");
  }
}

console.log("\nALL PASS — bank statement company context / format memory");
