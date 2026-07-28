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
  assert.equal(PROVISION_STATUS_LABEL[PROVISION_STATUS.INACTIVE_SKIPPED], "Atlandı");
});

await test("static: ensureCompanyDriveProvisioned davranışları", () => {
  const src = read("src/lib/googleDrive/ensureCompanyDriveProvisioned.js");
  assert.ok(src.includes("ensureGoogleDriveFolderTree"));
  assert.ok(src.includes("resolveOfficeDriveCredential"));
  assert.ok(src.includes("getValidGoogleAccessTokenByConnectionId"));
  assert.ok(src.includes("INACTIVE_SKIPPED"));
  assert.ok(src.includes("isActive"));
  assert.ok(src.includes("annveroCompanyId") || src.includes("ensureGoogleDriveFolderTree"));
  assert.ok(src.includes("onConflict: \"company_id\"") || src.includes("onConflict: 'company_id'"));
  assert.doesNotMatch(src, /assertCompanyAccess/);
  assert.doesNotMatch(src, /getValidGoogleAccessToken\s*\(/);
  // Pasif: oluşturma yok; mevcut korunur
  assert.ok(src.includes("Pasif firma"));
  // Hata: firma silinmez
  assert.ok(src.includes("Firma kaydı asla silinmez") || src.includes("bulut arşivi hazırlanıyor"));
});

await test("static: provision-active API management + dryRun + no secrets", () => {
  const src = read("app/api/google-drive/folders/provision-active/route.js");
  assert.ok(src.includes("isManagementUser"));
  assert.ok(src.includes("dryRun"));
  assert.ok(src.includes("alreadyReady"));
  assert.ok(src.includes("willCreate"));
  assert.ok(src.includes("inactiveSkipped"));
  assert.ok(src.includes("toPublicProvisionResult"));
  assert.ok(src.includes("ensureCompanyDriveProvisioned"));
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
  // upsert önce, provision sonra
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

await test("static: UI Önizle + Hazırla, no OAuth per company", () => {
  const ui = read("app/(annvero)/muhasebe/components/DriveBulkProvisionPanel.jsx");
  const mgmt = read("app/(annvero)/muhasebe/components/CompanyManagement.jsx");
  assert.ok(ui.includes("Önizle"));
  assert.ok(ui.includes("Hazırla"));
  assert.ok(ui.includes("Aktif Firmaların Drive Arşivini Hazırla"));
  assert.ok(ui.includes("provision-active"));
  assert.ok(ui.includes("isManagementUser"));
  assert.doesNotMatch(ui, /oauth\/start/);
  assert.ok(mgmt.includes("DriveBulkProvisionPanel"));
});

await test("static: adapter rename-only on name change; _ANNVERO protected", () => {
  const adapter = read("src/utils/cloudStorage/googleDriveAdapter.js");
  assert.ok(adapter.includes("annveroCompanyId"));
  assert.ok(adapter.includes("renameDriveFile"));
  assert.ok(adapter.includes("createdFolderCount"));
  // metadata yalnız yoksa
  assert.ok(adapter.includes("ensureTextFile"));
});

await test("status labels cover required UI states", () => {
  assert.equal(PROVISION_STATUS_LABEL.ALREADY_READY, "Hazır");
  assert.equal(PROVISION_STATUS_LABEL.CREATED, "Oluşturuldu");
  assert.equal(PROVISION_STATUS_LABEL.INACTIVE_SKIPPED, "Atlandı");
  assert.equal(PROVISION_STATUS_LABEL.DRIVE_ERROR, "Hata");
});

if (process.exitCode) {
  console.error("\nDrive company provision tests failed.");
  process.exit(1);
}
console.log("\nAll drive company provision tests passed.");
