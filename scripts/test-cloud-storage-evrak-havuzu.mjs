/**
 * Cloud Storage / Evrak Havuzu V1 — birim testler
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cloud-storage-evrak-havuzu.mjs
 */
import assert from "node:assert/strict";
import {
  ANNVERO_SYSTEM_FOLDER,
  TAHAKKUK_SUBFOLDERS,
  BEYANNAME_SUBFOLDERS,
  buildCompanyFolderPathList,
  buildCompanyFolderTree,
  planFolderCreations,
  FOLDER_STRUCTURE_VERSION,
} from "@/src/utils/cloudStorage/folderSchema.js";
import {
  buildStandardDocumentFileName,
  parseStandardDocumentFileName,
} from "@/src/utils/cloudStorage/fileNaming.js";
import {
  buildAnnveroDriveMetadata,
  buildAnnveroSystemTxt,
  assertTechnicalMetadataOnly,
} from "@/src/utils/cloudStorage/metadata.js";
import {
  findDuplicateDocument,
  normalizeDocumentIndexRow,
} from "@/src/utils/cloudStorage/documentIndex.js";
import {
  runMetadataSyncPass,
  softDeleteIndexedFile,
} from "@/src/utils/cloudStorage/syncEngine.js";
import {
  mockDriveAdapter,
  resetMockDriveStoreForTests,
} from "@/src/utils/cloudStorage/mockDriveAdapter.js";
import {
  assertNoSecretInPayload,
  sanitizeConnectionPublicView,
  TOKEN_STORAGE_RULES,
} from "@/src/lib/googleDrive/tokenPolicy.js";
import {
  connectCloudStorageDemo,
  createCompanyDriveFolders,
  disconnectCloudStorage,
  refreshCloudStorageSync,
  getCloudStoragePublicState,
} from "@/src/utils/cloudStorage/companyCloudActions.js";
import { emptyCompany, normalizeCompany } from "@/src/utils/companyNormalize.js";

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result
        .then(() => console.log(`PASS ${name}`))
        .catch((error) => {
          console.error(`FAIL ${name}`);
          console.error(error);
          process.exitCode = 1;
        });
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await test("1. firma klasör ağacı üretimi", () => {
  const paths = buildCompanyFolderPathList();
  assert.ok(paths.includes(ANNVERO_SYSTEM_FOLDER));
  assert.ok(paths.includes("02 - Beyannameler/MUHSGK"));
  assert.ok(paths.includes("03 - Tahakkuk Fişleri/SGK"));
  assert.ok(paths.includes("03 - Tahakkuk Fişleri/SGDP"));
  assert.ok(!paths.some((p) => /MTV|Emlak/i.test(p)));
  assert.equal(BEYANNAME_SUBFOLDERS.length, 9);
  assert.equal(TAHAKKUK_SUBFOLDERS.length, 11);
  assert.ok(buildCompanyFolderTree().length >= 14);
});

await test("2. _ANNVERO metadata teknik-only", () => {
  const meta = buildAnnveroDriveMetadata({
    companyId: "c1",
    driveFolderId: "fld1",
  });
  assert.equal(meta.schemaVersion, 1);
  assert.equal(meta.folderStructureVersion, FOLDER_STRUCTURE_VERSION);
  assert.ok(!("companyName" in meta));
  assertTechnicalMetadataOnly(meta);
  const txt = buildAnnveroSystemTxt(meta);
  assert.ok(txt.includes("Firma Kartı"));
  assert.ok(!txt.includes("MERSİS"));
  assert.throws(() => assertTechnicalMetadataOnly({ companyName: "X" }));
});

await test("3. iki firmada ayrı klasör ID", async () => {
  resetMockDriveStoreForTests();
  await mockDriveAdapter.connectDemo({ companyId: "a", accountEmail: "a@x" });
  await mockDriveAdapter.connectDemo({ companyId: "b", accountEmail: "b@x" });
  const fa = await mockDriveAdapter.ensureCompanyFolderTree({
    companyId: "a",
    companyDisplayName: "Firma A",
  });
  const fb = await mockDriveAdapter.ensureCompanyFolderTree({
    companyId: "b",
    companyDisplayName: "Firma B",
  });
  assert.notEqual(fa.rootFolderId, fb.rootFolderId);
  assert.equal(fa.rootFolderName, "Firma A");
  assert.equal(fb.rootFolderName, "Firma B");
});

await test("4. aynı dosya aynı firmada mükerrer", () => {
  const existing = [
    normalizeDocumentIndexRow({
      id: "1",
      companyId: "c1",
      providerFileId: "f1",
      fileHash: "abc",
      fileName: "MUHSGK_Byn_202605.pdf",
    }),
  ];
  const dupId = findDuplicateDocument(existing, {
    companyId: "c1",
    providerFileId: "f1",
    fileHash: "zzz",
  });
  assert.equal(dupId.type, "provider_file_id");
  const dupHash = findDuplicateDocument(existing, {
    companyId: "c1",
    providerFileId: "f2",
    fileHash: "abc",
  });
  assert.equal(dupHash.type, "file_hash");
});

await test("5. aynı hash farklı firmada mükerrer değil", () => {
  const existing = [
    normalizeDocumentIndexRow({
      id: "1",
      companyId: "c1",
      providerFileId: "f1",
      fileHash: "samehash",
      fileName: "x.pdf",
    }),
  ];
  const dup = findDuplicateDocument(existing, {
    companyId: "c2",
    providerFileId: "f9",
    fileHash: "samehash",
  });
  assert.equal(dup, null);
});

await test("6. manuel sync yalnız değişen/yeni indeksler", () => {
  const existing = [
    normalizeDocumentIndexRow({
      id: "1",
      companyId: "c1",
      providerFileId: "f1",
      fileHash: "h1",
      fileName: "MUHSGK_Byn_202605.pdf",
      lastModifiedAt: "2026-01-01",
    }),
  ];
  const remote = [
    {
      providerFileId: "f1",
      fileHash: "h1",
      fileName: "MUHSGK_Byn_202605.pdf",
      lastModifiedAt: "2026-01-01",
    },
    {
      providerFileId: "f2",
      fileHash: "h2",
      fileName: "MUHSGK_Thk_202605.pdf",
      lastModifiedAt: "2026-02-01",
    },
  ];
  const pass = runMetadataSyncPass({
    companyId: "c1",
    provider: "google_drive",
    remoteFiles: remote,
    existingIndex: existing,
  });
  assert.equal(pass.stats.created, 1);
  assert.equal(pass.stats.updated, 0);
  assert.equal(pass.created[0].providerFileId, "f2");
});

await test("7. silinen drive dosyası missing", () => {
  const existing = [
    normalizeDocumentIndexRow({
      id: "1",
      companyId: "c1",
      providerFileId: "gone",
      fileHash: "h",
      fileName: "a.pdf",
    }),
  ];
  const pass = runMetadataSyncPass({
    companyId: "c1",
    remoteFiles: [],
    existingIndex: existing,
  });
  assert.equal(pass.stats.missing, 1);
  assert.equal(pass.missing[0].parseStatus, "missing");
});

await test("8. firma kartı bağlantı durumu", async () => {
  resetMockDriveStoreForTests();
  let company = normalizeCompany({
    ...emptyCompany,
    id: "c-card",
    companyName: "Demo A.Ş.",
  });
  assert.equal(getCloudStoragePublicState(company).binding.connectionStatus, "disconnected");
  company = await connectCloudStorageDemo(company, {
    accountEmail: "demo@annvero.local",
  });
  assert.equal(company.cloudStorage.connectionStatus, "connected");
  assert.equal(company.cloudStorage.accountEmail, "demo@annvero.local");
});

await test("9. bağlantı kaldırma", async () => {
  resetMockDriveStoreForTests();
  let company = normalizeCompany({ id: "c-dis", companyName: "X" });
  company = await connectCloudStorageDemo(company);
  const { company: withFolder } = await createCompanyDriveFolders(company);
  company = await disconnectCloudStorage(withFolder);
  assert.equal(company.cloudStorage.connectionStatus, "disconnected");
  assert.equal(company.cloudStorage.rootFolderId, "");
});

await test("10. token/secret UI ve payload sızıntısı yok", () => {
  assert.equal(TOKEN_STORAGE_RULES.allowLocalStorage, false);
  const view = sanitizeConnectionPublicView({
    status: "connected",
    accountEmail: "a@b.com",
    access_token: "SECRET",
    refresh_token: "SECRET2",
  });
  assert.ok(!("access_token" in view));
  assert.throws(() =>
    assertNoSecretInPayload({ access_token: "x", refresh_token: "y" })
  );
  assertNoSecretInPayload(view);
});

await test("11. klasör oluşturma idempotent", async () => {
  resetMockDriveStoreForTests();
  await mockDriveAdapter.connectDemo({ companyId: "c-idem" });
  const first = await mockDriveAdapter.ensureCompanyFolderTree({
    companyId: "c-idem",
    companyDisplayName: "Idem",
  });
  const second = await mockDriveAdapter.ensureCompanyFolderTree({
    companyId: "c-idem",
    companyDisplayName: "Idem",
  });
  assert.equal(first.rootFolderId, second.rootFolderId);
  assert.equal(second.createdFolderCount, 0);
  assert.ok(second.skippedFolderCount > 0);
  const plan = planFolderCreations(first.paths);
  assert.equal(plan.toCreate.length, 0);
});

await test("isimlendirme standardı", () => {
  assert.equal(
    buildStandardDocumentFileName({
      obligationCode: "MUHSGK",
      kind: "Byn",
      periodKey: "202605",
    }),
    "MUHSGK_Byn_202605.pdf"
  );
  assert.equal(
    buildStandardDocumentFileName({
      obligationCode: "SGK",
      kind: "Thk",
      periodKey: "202605",
      sgkVariant: "5510",
    }),
    "SGK_Thk_202605_5510.pdf"
  );
  assert.equal(
    buildStandardDocumentFileName({
      obligationCode: "MUHSGK",
      kind: "Byn",
      periodKey: "202601",
      revisionNo: 1,
    }),
    "MUHSGK_Byn_202601_Duzeltme01.pdf"
  );
  const parsed = parseStandardDocumentFileName("SGK_Thk_202605_SGDP.pdf");
  assert.equal(parsed.sgkVariant, "SGDP");
});

await test("soft-delete index", () => {
  const rows = softDeleteIndexedFile(
    [
      normalizeDocumentIndexRow({
        id: "1",
        companyId: "c1",
        providerFileId: "f1",
        fileName: "a.pdf",
      }),
    ],
    "c1",
    "f1"
  );
  assert.equal(rows[0].parseStatus, "soft_deleted");
});

await test("sync + company actions entegrasyonu", async () => {
  resetMockDriveStoreForTests();
  let company = normalizeCompany({ id: "c-sync", companyName: "Sync Co" });
  company = await connectCloudStorageDemo(company);
  const created = await createCompanyDriveFolders(company);
  company = created.company;
  await mockDriveAdapter.seedRemoteFile({
    companyId: "c-sync",
    providerFileId: "pf1",
    fileName: "MUHSGK_Byn_202605.pdf",
    fileHash: "hash1",
  });
  const { company: synced, pass } = await refreshCloudStorageSync(company, []);
  assert.equal(pass.stats.created, 1);
  assert.equal(synced.cloudStorage.indexedDocumentCount, 1);
  await mockDriveAdapter.removeRemoteFile({
    companyId: "c-sync",
    providerFileId: "pf1",
  });
  const second = await refreshCloudStorageSync(synced, pass.index);
  assert.equal(second.pass.stats.missing, 1);
});

if (process.exitCode) {
  console.error("\nCloud storage tests failed.");
  process.exit(1);
}
console.log("\nAll cloud storage / evrak havuzu V1 tests passed.");
