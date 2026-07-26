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
  compareCompanyFolderStructure,
  planFolderCreations,
  FOLDER_STRUCTURE_VERSION,
} from "@/src/utils/cloudStorage/folderSchema.js";
import {
  assertUploadTargetPath,
  buildUploadTargetPathList,
  DRIVE_UPLOAD_DEFAULT_FOLDER,
  DRIVE_UPLOAD_MAX_BYTES,
  sanitizeUploadFileName,
  validateUploadFileSize,
  validateUploadFileType,
} from "@/src/utils/cloudStorage/uploadPolicy.js";
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

await test("folder structure compare: tam uyumlu", () => {
  const desired = buildCompanyFolderPathList();
  const result = compareCompanyFolderStructure(desired, { annveroAtRoot: true });
  assert.equal(result.ok, true);
  assert.equal(result.code, "OK");
  assert.equal(result.schemaVersion, FOLDER_STRUCTURE_VERSION);
  assert.equal(result.expectedCount, desired.length);
  assert.equal(result.existingCount, desired.length);
  assert.deepEqual(result.missingPaths, []);
  assert.deepEqual(result.extraPaths, []);
  assert.equal(result.annveroAtRoot, true);
});

await test("folder structure compare: eksik klasör", () => {
  const desired = buildCompanyFolderPathList();
  const existing = desired.filter((p) => p !== "01 - Hesap Planı");
  const result = compareCompanyFolderStructure(existing);
  assert.equal(result.ok, false);
  assert.equal(result.code, "STRUCTURE_MISMATCH");
  assert.ok(result.missingPaths.includes("01 - Hesap Planı"));
  assert.equal(result.extraPaths.length, 0);
});

await test("folder structure compare: fazla klasör", () => {
  const desired = buildCompanyFolderPathList();
  const result = compareCompanyFolderStructure([
    ...desired,
    "98 - Diğer Evraklar/Özel",
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.extraPaths.includes("98 - Diğer Evraklar/Özel"));
  assert.equal(result.missingPaths.length, 0);
});

await test("folder structure compare: aynı isim farklı parent", () => {
  const result = compareCompanyFolderStructure([
    ANNVERO_SYSTEM_FOLDER,
    "02 - Beyannameler",
    "02 - Beyannameler/MUHSGK",
    "03 - Tahakkuk Fişleri",
  ]);
  assert.ok(result.missingPaths.includes("03 - Tahakkuk Fişleri/MUHSGK"));
  assert.ok(!result.missingPaths.includes("02 - Beyannameler/MUHSGK"));
});

await test("folder structure compare: _ANNVERO kök yok", () => {
  const desired = buildCompanyFolderPathList().filter(
    (p) => p !== ANNVERO_SYSTEM_FOLDER
  );
  const result = compareCompanyFolderStructure(desired, { annveroAtRoot: false });
  assert.equal(result.ok, false);
  assert.equal(result.annveroAtRoot, false);
  assert.ok(result.missingPaths.includes(ANNVERO_SYSTEM_FOLDER));
});

await test("upload policy: hedef path ve _ANNVERO reddi", () => {
  const targets = buildUploadTargetPathList();
  assert.ok(targets.includes(DRIVE_UPLOAD_DEFAULT_FOLDER));
  assert.ok(!targets.includes(ANNVERO_SYSTEM_FOLDER));
  assert.ok(!targets.some((p) => p.startsWith(`${ANNVERO_SYSTEM_FOLDER}/`)));
  assert.equal(assertUploadTargetPath(ANNVERO_SYSTEM_FOLDER).ok, false);
  assert.equal(assertUploadTargetPath(`${ANNVERO_SYSTEM_FOLDER}/x`).code, "SYSTEM_FOLDER_FORBIDDEN");
  assert.equal(assertUploadTargetPath("bilinmeyen/klasor").code, "INVALID_TARGET_PATH");
  assert.equal(assertUploadTargetPath("98 - Diğer Evraklar").ok, true);
  assert.equal(assertUploadTargetPath("02 - Beyannameler/MUHSGK").ok, true);
});

await test("upload policy: MIME/uzantı ve boyut", () => {
  assert.equal(validateUploadFileType({ fileName: "a.pdf", mimeType: "application/pdf" }).ok, true);
  assert.equal(validateUploadFileType({ fileName: "a.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).ok, true);
  assert.equal(validateUploadFileType({ fileName: "a.xml", mimeType: "application/xml" }).ok, true);
  assert.equal(validateUploadFileType({ fileName: "a.png", mimeType: "image/png" }).ok, true);
  assert.equal(validateUploadFileType({ fileName: "a.exe", mimeType: "application/octet-stream" }).ok, false);
  assert.equal(
    validateUploadFileType({ fileName: "a.pdf", mimeType: "image/png" }).code,
    "MIME_EXTENSION_MISMATCH"
  );
  assert.equal(validateUploadFileSize(0).code, "EMPTY_FILE");
  assert.equal(validateUploadFileSize(DRIVE_UPLOAD_MAX_BYTES + 1).status, 413);
  assert.equal(validateUploadFileSize(12).ok, true);
  assert.equal(sanitizeUploadFileName("../../x y.pdf"), "x y.pdf");
  assert.ok(!sanitizeUploadFileName("evil\\path.xlsx").includes("\\"));
});

await test("upload sonrası sync hash ile indeksler", () => {
  const remote = [
    {
      providerFileId: "up1",
      fileName: "ADH.pdf",
      fileHash: "sha-content-1",
      mimeType: "application/pdf",
      parentFolderId: "folder-98",
    },
  ];
  const pass = runMetadataSyncPass({
    companyId: "114f98b5-0411-45c5-a7c6-8061c9f06699",
    provider: "google_drive",
    remoteFiles: remote,
    existingIndex: [],
  });
  assert.equal(pass.stats.created, 1);
  assert.equal(pass.stats.remoteCount, 1);
  const dup = runMetadataSyncPass({
    companyId: "114f98b5-0411-45c5-a7c6-8061c9f06699",
    provider: "google_drive",
    remoteFiles: [
      ...remote,
      {
        providerFileId: "up2",
        fileName: "ADH-kopya.pdf",
        fileHash: "sha-content-1",
        mimeType: "application/pdf",
      },
    ],
    existingIndex: pass.created,
  });
  assert.ok(dup.stats.skippedDuplicates >= 1 || dup.skippedDuplicates?.length >= 1);
});

// Canlı sync route: hash-dedup motoru + pasif firma kilidi + _ANNVERO koruması.
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const syncSrc = fs.readFileSync(
    path.join(root, "app/api/google-drive/sync/route.js"),
    "utf8"
  );
  const foldersSrc = fs.readFileSync(
    path.join(root, "app/api/google-drive/folders/route.js"),
    "utf8"
  );
  const checkSrc = fs.readFileSync(
    path.join(root, "app/api/google-drive/folders/check/route.js"),
    "utf8"
  );
  const uploadSrc = fs.readFileSync(
    path.join(root, "app/api/google-drive/files/upload/route.js"),
    "utf8"
  );
  const adapterSrc = fs.readFileSync(
    path.join(root, "src/utils/cloudStorage/googleDriveAdapter.js"),
    "utf8"
  );
  const panelSrc = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/components/CloudStorageCompanyPanel.jsx"
    ),
    "utf8"
  );
  assert.ok(syncSrc.includes("runMetadataSyncPass"), "canlı sync hash-dedup kullanmalı");
  assert.ok(syncSrc.includes("skippedDuplicates") || syncSrc.includes("pass.stats"));
  assert.ok(syncSrc.includes("isActive"), "pasif firma sync engeli");
  assert.ok(foldersSrc.includes("isActive"), "pasif firma klasör engeli");
  assert.ok(adapterSrc.includes('child.name === "_ANNVERO"'), "_ANNVERO indeks dışı");
  assert.ok(adapterSrc.includes("renameDriveFile"), "firma adı → görünür klasör adı");
  assert.ok(
    adapterSrc.includes('ensureTextFile(accessToken, systemId, "metadata.json"'),
    "_ANNVERO sistem dosyası yalnız yoksa eklenir"
  );

  assert.ok(checkSrc.includes("assertCompanyAccess"), "check: firma erişim zorunlu");
  assert.ok(checkSrc.includes("verifyGoogleDriveFolderStructure"), "check: doğrulama");
  assert.ok(checkSrc.includes("missingPaths") && checkSrc.includes("extraPaths"));
  assert.ok(checkSrc.includes("annveroAtRoot"));
  assert.doesNotMatch(checkSrc, /\.upsert\(/, "check DB upsert yok");
  assert.doesNotMatch(checkSrc, /\.insert\(/, "check DB insert yok");
  assert.doesNotMatch(checkSrc, /\.update\(/, "check DB update yok");
  assert.doesNotMatch(checkSrc, /\.delete\(/, "check DB delete yok");
  assert.ok(!checkSrc.includes("ensureGoogleDriveFolderTree"), "check create çağırmaz");
  assert.ok(!checkSrc.includes("createFolder"), "check createFolder yok");
  assert.ok(!checkSrc.includes("renameDriveFile"), "check rename yok");

  assert.ok(adapterSrc.includes("listGoogleDriveFolderPaths"));
  assert.ok(adapterSrc.includes("verifyGoogleDriveFolderStructure"));
  assert.ok(adapterSrc.includes("annveroCompanyId"), "kök firma ID doğrulaması");
  const listFnStart = adapterSrc.indexOf(
    "export async function listGoogleDriveFolderPaths"
  );
  const listFnEnd = adapterSrc.indexOf(
    "export async function verifyGoogleDriveFolderStructure"
  );
  assert.ok(listFnStart >= 0 && listFnEnd > listFnStart);
  const listFn = adapterSrc.slice(listFnStart, listFnEnd);
  assert.ok(listFn.includes("continue"), "_ANNVERO sonrası continue");
  assert.ok(listFn.includes("annveroAtRoot = true"), "_ANNVERO kök bayrağı");
  assert.ok(
    listFn.includes("child.name === ANNVERO_SYSTEM_FOLDER"),
    "_ANNVERO yalnız kökte işaretlenir"
  );

  assert.ok(
    panelSrc.includes("/api/google-drive/folders/check"),
    "UI check endpoint çağırır"
  );
  assert.ok(panelSrc.includes("Beklenen Şemayı Göster"), "şema butonu ayrı");
  assert.ok(panelSrc.includes('busy === "check"'), "check loading engeli");

  // Upload route güvenlik / mükerrer / mutation sınırları
  assert.ok(uploadSrc.includes("assertCompanyAccess"), "upload yetki");
  assert.ok(uploadSrc.includes("isCompanyActive") || uploadSrc.includes("isActive"), "pasif firma");
  assert.ok(uploadSrc.includes("assertDriveRootBelongsToCompany"), "kök firma ID");
  assert.ok(uploadSrc.includes("assertUploadTargetPath"), "schema path");
  assert.ok(uploadSrc.includes("SYSTEM_FOLDER_FORBIDDEN") || uploadSrc.includes("assertUploadTargetPath"));
  assert.ok(uploadSrc.includes("findDriveFileByCompanyContentHash"), "hash mükerrer");
  assert.ok(uploadSrc.includes("annveroContentHash"), "appProperties hash");
  assert.ok(uploadSrc.includes("DUPLICATE_CONTENT"), "409 duplicate");
  assert.ok(uploadSrc.includes("PAYLOAD_TOO_LARGE"), "413");
  assert.ok(uploadSrc.includes("sha256") || uploadSrc.includes("createHash"), "sha256");
  assert.doesNotMatch(uploadSrc, /from\("document_index"\)[\s\S]{0,80}\.upsert/, "upload document_index yazmaz");
  assert.ok(!uploadSrc.includes("ensureGoogleDriveFolderTree"), "upload klasör oluşturmaz");
  assert.ok(uploadSrc.includes("resolveDriveFolderPathFromRoot"), "parent zinciri");
  assert.ok(adapterSrc.includes("uploadGoogleDriveBinaryFile"), "binary upload");
  assert.ok(adapterSrc.includes("findDriveFileByCompanyContentHash"));
  // Mükerrer bulunduğunda create çağrılmadan dönülür — sıra: find → upload
  const findIdx = uploadSrc.indexOf("findDriveFileByCompanyContentHash");
  const uploadIdx = uploadSrc.indexOf("uploadGoogleDriveBinaryFile");
  assert.ok(findIdx >= 0 && uploadIdx > findIdx, "hash kontrolü create'den önce");
  assert.ok(panelSrc.includes("/api/google-drive/files/upload"), "UI upload");
  assert.ok(panelSrc.includes("ANNVERO’dan Drive’a Evrak Yükle") || panelSrc.includes("ANNVERO'dan Drive'a Evrak Yükle"));
  assert.ok(panelSrc.includes("DRIVE_UPLOAD_MAX_LABEL") || panelSrc.includes("4 MB"));
  assert.ok(panelSrc.includes("runAutoSync") || panelSrc.includes("/api/google-drive/sync"));
}

if (process.exitCode) {
  console.error("\nCloud storage tests failed.");
  process.exit(1);
}
console.log("\nAll cloud storage / evrak havuzu V1 tests passed.");
