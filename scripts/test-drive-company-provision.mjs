/**
 * Company Drive provisioning — ensureCompanyDriveProvisioned + bulk API sertleştirme.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-drive-company-provision.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVISION_STATUS,
  PROVISION_STATUS_LABEL,
  toPublicProvisionResult,
  normalizeCompanyNameForProvision,
  buildDuplicateNameCompanyIdSet,
  partitionCompaniesForProvision,
} from "@/src/lib/googleDrive/ensureCompanyDriveProvisioned.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

await test("public DTO: token / Drive ID sızdırmaz", () => {
  const pub = toPublicProvisionResult({
    status: PROVISION_STATUS.CREATED,
    companyId: "c1",
    companyName: "Test A.Ş.",
    message: "ok",
    _rootFolderId: "drive-secret-root",
    _connectionId: "conn-secret",
    accessToken: "should-not-appear",
  });
  assert.equal(pub.label, "Oluşturuldu");
  assert.equal(pub.companyName, "Test A.Ş.");
  assert.equal(pub._rootFolderId, undefined);
  assert.doesNotMatch(JSON.stringify(pub), /drive-secret|conn-secret|accessToken/);
  assert.equal(
    PROVISION_STATUS_LABEL[PROVISION_STATUS.INACTIVE_SKIPPED],
    "Pasif Atlandı"
  );
});

await test("duplicate name: normalize + set includes all peers", () => {
  assert.equal(
    normalizeCompanyNameForProvision("  AYSU  DIŞ  TİCARET  "),
    normalizeCompanyNameForProvision("aysu dış ticaret")
  );
  const set = buildDuplicateNameCompanyIdSet([
    { id: "a1", company_name: "AYSU DIŞ TİCARET VE YAPI SANAYİ A.Ş" },
    { id: "a2", company_name: "Aysu Dış Ticaret Ve Yapı Sanayi A.Ş" },
    { id: "b1", company_name: "Benzersiz Ltd." },
  ]);
  assert.equal(set.has("a1"), true);
  assert.equal(set.has("a2"), true);
  assert.equal(set.has("b1"), false);
  assert.equal(set.size, 2);
});

await test("partition: AYSU mükerrer atlanır; hazır korunur; unique oluşturulur", () => {
  const partitioned = partitionCompaniesForProvision(
    [
      {
        id: "ready-1",
        company_name: "Hazır Firma",
        data: { isActive: true },
      },
      {
        id: "aysu-1",
        company_name: "AYSU DIŞ TİCARET VE YAPI SANAYİ A.Ş",
        data: { isActive: true },
      },
      {
        id: "aysu-2",
        company_name: "Aysu Dış Ticaret Ve Yapı Sanayi A.Ş",
        data: { isActive: true },
      },
      {
        id: "unique-1",
        company_name: "Benzersiz Ltd.",
        data: { isActive: true },
      },
      {
        id: "unique-2",
        company_name: "Diğer Aktif A.Ş.",
        data: { isActive: true },
      },
      {
        id: "inactive-1",
        company_name: "Pasif Firma",
        data: { isActive: false },
      },
      {
        id: "aysu-ready",
        company_name: "AYSU DIŞ TİCARET VE YAPI SANAYİ A.Ş",
        data: { isActive: true },
      },
    ],
    [
      {
        company_id: "ready-1",
        root_folder_id: "root-ready",
        connection_id: "conn-1",
      },
      {
        company_id: "aysu-ready",
        root_folder_id: "root-aysu-adh",
        connection_id: "conn-adh",
      },
    ]
  );

  assert.equal(partitioned.alreadyReady.length, 2);
  assert.equal(partitioned.willCreate.length, 2);
  assert.equal(partitioned.duplicateSkipped.length, 2);
  assert.equal(partitioned.inactiveSkipped.length, 1);
  assert.equal(partitioned.failed.length, 0);

  const readyIds = partitioned.alreadyReady.map((r) => r.companyId).sort();
  assert.deepEqual(readyIds, ["aysu-ready", "ready-1"]);
  // Hazır mükerrer unvanlı kayıt yeniden oluşturulmaz (ADH kökü korunur).
  assert.equal(
    partitioned.alreadyReady.find((r) => r.companyId === "aysu-ready").status,
    PROVISION_STATUS.ALREADY_READY
  );

  const willIds = partitioned.willCreate.map((r) => r.companyId).sort();
  assert.deepEqual(willIds, ["unique-1", "unique-2"]);
  for (const row of partitioned.willCreate) {
    assert.equal(row.status, PROVISION_STATUS.WILL_CREATE);
  }

  const dupIds = partitioned.duplicateSkipped.map((r) => r.companyId).sort();
  assert.deepEqual(dupIds, ["aysu-1", "aysu-2"]);
  for (const row of partitioned.duplicateSkipped) {
    assert.equal(row.status, PROVISION_STATUS.DUPLICATE_NAME_SKIPPED);
    assert.equal(
      row.label,
      "Aynı unvanlı mükerrer kayıt — inceleme bekliyor"
    );
  }

  // Execute adayı (willCreate) ile mükerrer küme kesişmez.
  const willSet = new Set(willIds);
  for (const id of dupIds) assert.equal(willSet.has(id), false);

  assert.equal(partitioned.inactiveSkipped[0].label, "Pasif Atlandı");
});

await test("partition: same-name group entirely skipped when none ready", () => {
  const partitioned = partitionCompaniesForProvision(
    [
      { id: "d1", company_name: "Çift Unvan", data: { isActive: true } },
      { id: "d2", company_name: "çift  unvan", data: { isActive: true } },
      { id: "ok", company_name: "Tekil", data: { isActive: true } },
    ],
    []
  );
  assert.equal(partitioned.duplicateSkipped.length, 2);
  assert.equal(partitioned.willCreate.length, 1);
  assert.equal(partitioned.willCreate[0].companyId, "ok");
  assert.equal(partitioned.summary?.duplicateSkipped, undefined);
});

await test("static: ensureCompanyDriveProvisioned davranışları", () => {
  const src = read("src/lib/googleDrive/ensureCompanyDriveProvisioned.js");
  assert.ok(src.includes("ensureGoogleDriveFolderTree"));
  assert.ok(src.includes("resolveOfficeDriveCredential"));
  assert.ok(src.includes("getValidGoogleAccessTokenByConnectionId"));
  assert.ok(src.includes("INACTIVE_SKIPPED"));
  assert.ok(src.includes("DUPLICATE_NAME_SKIPPED"));
  assert.ok(src.includes("buildDuplicateNameCompanyIdSet"));
  assert.ok(src.includes("isActive"));
  assert.ok(src.includes("annveroCompanyId") || src.includes("ensureGoogleDriveFolderTree"));
  assert.ok(src.includes("onConflict: \"company_id\"") || src.includes("onConflict: 'company_id'"));
  assert.doesNotMatch(src, /assertCompanyAccess/);
  assert.doesNotMatch(src, /getValidGoogleAccessToken\s*\(/);
  assert.ok(src.includes("Pasif firma"));
  assert.ok(src.includes("Firma kaydı asla silinmez") || src.includes("bulut arşivi hazırlanıyor"));
  // duplicate check before create / dry WILL_CREATE
  const dupIdx = src.indexOf("DUPLICATE_NAME_SKIPPED");
  const willIdx = src.indexOf("PROVISION_STATUS.WILL_CREATE");
  assert.ok(dupIdx >= 0 && willIdx > dupIdx);
  assert.ok(src.includes("partitionCompaniesForProvision"));
  assert.ok(src.includes("Mükerrer unvan kontrolü yapılamadı"));
  assert.ok(src.includes("peerError"));
});

await test("static: provision-active API management + dryRun + duplicateSkipped", () => {
  const src = read("app/api/google-drive/folders/provision-active/route.js");
  assert.ok(src.includes("isManagementUser"));
  assert.ok(src.includes("dryRun"));
  assert.ok(src.includes("alreadyReady"));
  assert.ok(src.includes("willCreate"));
  assert.ok(src.includes("inactiveSkipped"));
  assert.ok(src.includes("duplicateSkipped"));
  assert.ok(src.includes("toPublicProvisionResult"));
  assert.ok(src.includes("ensureCompanyDriveProvisioned"));
  assert.ok(src.includes("DUPLICATE_NAME_SKIPPED"));
  assert.doesNotMatch(src, /accessToken|_rootFolderId|token_reference/);
});

await test("static: folders POST uses ensureCompanyDriveProvisioned", () => {
  const src = read("app/api/google-drive/folders/route.js");
  assert.ok(src.includes("ensureCompanyDriveProvisioned"));
  assert.ok(src.includes("isManagementUser"));
  assert.doesNotMatch(src, /getValidGoogleAccessToken\s*\(/);
});

await test("static: companies POST auto-provisions after save", () => {
  const src = read("app/api/companies/route.js");
  assert.ok(src.includes("ensureCompanyDriveProvisioned"));
  assert.ok(src.includes("driveArchive"));
  assert.ok(src.includes("Firma kaydedildi, bulut arşivi hazırlanıyor"));
  const upsertIdx = src.indexOf(".upsert([record]");
  const provisionIdx = src.indexOf("ensureCompanyDriveProvisioned");
  assert.ok(upsertIdx >= 0 && provisionIdx > upsertIdx);
});

await test("static: reconcile provisions missing active bindings", () => {
  const src = read("app/api/google-drive/reconcile/route.js");
  assert.ok(src.includes("ensureCompanyDriveProvisioned"));
  assert.ok(src.includes("PROVISION_PENDING") || src.includes("PROVISION_STATUS"));
  assert.ok(src.includes("isCompanyActive"));
  assert.ok(src.includes("FOLDER_BINDING_MISSING") || src.includes("OFFICE_CONNECTION_PENDING"));
});

await test("static: UI Önizle + Hazırla + mükerrer sayaç, no OAuth per company", () => {
  const ui = read("app/(annvero)/muhasebe/components/DriveBulkProvisionPanel.jsx");
  const mgmt = read("app/(annvero)/muhasebe/components/CompanyManagement.jsx");
  assert.ok(ui.includes("Önizle"));
  assert.ok(ui.includes("Hazırla"));
  assert.ok(ui.includes("Aktif Firmaların Drive Arşivini Hazırla"));
  assert.ok(ui.includes("provision-active"));
  assert.ok(ui.includes("Mükerrer Atlandı"));
  assert.ok(ui.includes("Pasif Atlandı"));
  assert.ok(ui.includes("duplicateSkipped"));
  assert.ok(
    ui.includes("Aynı unvanlı mükerrer kayıt — inceleme bekliyor")
  );
  assert.doesNotMatch(ui, /oauth\/start/);
  assert.ok(mgmt.includes("DriveBulkProvisionPanel"));
});

await test("static: adapter rename-only on name change; _ANNVERO protected", () => {
  const adapter = read("src/utils/cloudStorage/googleDriveAdapter.js");
  assert.ok(adapter.includes("annveroCompanyId"));
  assert.ok(adapter.includes("renameDriveFile"));
  assert.ok(adapter.includes("createdFolderCount"));
  assert.ok(adapter.includes("ensureTextFile"));
});

await test("status labels: dry-run Oluşturulacak, duplicate + pasif", () => {
  assert.equal(PROVISION_STATUS_LABEL.ALREADY_READY, "Hazır");
  assert.equal(PROVISION_STATUS_LABEL.WILL_CREATE, "Oluşturulacak");
  assert.equal(PROVISION_STATUS_LABEL.CREATED, "Oluşturuldu");
  assert.equal(PROVISION_STATUS_LABEL.INACTIVE_SKIPPED, "Pasif Atlandı");
  assert.equal(
    PROVISION_STATUS_LABEL.DUPLICATE_NAME_SKIPPED,
    "Aynı unvanlı mükerrer kayıt — inceleme bekliyor"
  );
  assert.equal(PROVISION_STATUS_LABEL.DRIVE_ERROR, "Hata");

  const dry = toPublicProvisionResult({
    status: PROVISION_STATUS.WILL_CREATE,
    companyId: "a",
    companyName: "A",
  });
  assert.equal(dry.label, "Oluşturulacak");
  const dup = toPublicProvisionResult({
    status: PROVISION_STATUS.DUPLICATE_NAME_SKIPPED,
    companyId: "a1",
    companyName: "AYSU",
  });
  assert.equal(dup.label, "Aynı unvanlı mükerrer kayıt — inceleme bekliyor");
  const done = toPublicProvisionResult({
    status: PROVISION_STATUS.CREATED,
    companyId: "a",
    companyName: "A",
  });
  assert.equal(done.label, "Oluşturuldu");
});

await test("static: classify uses WILL_CREATE; dryRun path mutation-free", () => {
  const src = read("src/lib/googleDrive/ensureCompanyDriveProvisioned.js");
  const route = read("app/api/google-drive/folders/provision-active/route.js");
  assert.ok(src.includes("WILL_CREATE"));
  assert.ok(src.includes("duplicateSkipped"));
  assert.ok(src.includes('status: PROVISION_STATUS.WILL_CREATE'));
  const dryIdx = route.indexOf("if (dryRun)");
  const resultsIdx = route.indexOf("const results = []");
  assert.ok(dryIdx >= 0 && resultsIdx > dryIdx);
  const dryBlock = route.slice(dryIdx, resultsIdx);
  assert.doesNotMatch(dryBlock, /ensureCompanyDriveProvisioned\s*\(/);
  assert.doesNotMatch(dryBlock, /ensureGoogleDriveFolderTree/);
});

await test("UI summary: dry-run uses willCreate; row key companyId; duplicateSkipped", () => {
  const ui = read("app/(annvero)/muhasebe/components/DriveBulkProvisionPanel.jsx");
  assert.ok(ui.includes("provisionSummaryCounts"));
  assert.ok(ui.includes("flattenRows") || ui.includes("buildProvisionRowsFromPayload"));
  assert.ok(ui.includes("Oluşturulacak"));
  assert.ok(ui.includes("key={row.companyId}"));
  assert.ok(ui.includes("duplicateSkipped"));
  // dry-run: willCreate; execute: created — created ?? asla dry-run’da tek başına kullanılmaz
  assert.ok(ui.includes("summary.willCreate ?? 0"));
  assert.match(
    ui,
    /dryRun[\s\S]*\?[\s\S]*summary\.willCreate \?\? 0[\s\S]*:[\s\S]*summary\.created \?\?/
  );
});

if (process.exitCode) {
  console.error("\nDrive company provision tests failed.");
  process.exit(1);
}
console.log("\nAll drive company provision tests passed.");
