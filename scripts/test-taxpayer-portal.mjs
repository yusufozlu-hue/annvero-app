/**
 * Mükellef portalı + Drive upload/sync sertleştirme testleri.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-taxpayer-portal.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyUploadTarget } from "@/src/utils/cloudStorage/documentClassify.js";
import { validateDocumentCompanyMatch } from "@/src/utils/cloudStorage/companyContentMatch.js";
import {
  buildUploadIdempotencyKey,
  computeSyncBackoffMs,
  shouldRetrySyncAttempt,
  SYNC_RETRY_MAX_ATTEMPTS,
  nextReviewStatusAfterMaxRetries,
} from "@/src/utils/cloudStorage/syncRetry.js";
import {
  DEFAULT_LIST_PARSE_STATUSES,
  DOCUMENT_STATUS_LABELS,
  filterDocumentsForCompanyList,
  toPublicDocumentListItem,
} from "@/src/utils/cloudStorage/documentList.js";
import { DOCUMENT_PARSE_STATUS } from "@/src/utils/cloudStorage/types.js";
import { DRIVE_UPLOAD_DEFAULT_FOLDER } from "@/src/utils/cloudStorage/uploadPolicy.js";
import { ANNVERO_ROLES, canAccessRoute } from "@/src/config/annveroRoles.js";

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

await test("classifyUploadTarget: beyanname / personel / görsel deterministic", () => {
  const byn = classifyUploadTarget({
    fileName: "KDV1_beyanname_2024.pdf",
    mimeType: "application/pdf",
  });
  assert.equal(byn.documentType, "beyanname");
  assert.ok(byn.targetFolderPath.startsWith("02 - Beyannameler"));
  assert.equal(byn.needsReview, false);

  const personel = classifyUploadTarget({
    fileName: "personel_bordro.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  assert.equal(personel.documentType, "personel");
  assert.equal(personel.targetFolderPath, "05 - Personel");

  const img = classifyUploadTarget({
    fileName: "scan.png",
    mimeType: "image/png",
  });
  assert.equal(img.documentType, "image");
  assert.equal(img.needsReview, true);
  assert.equal(img.targetFolderPath, DRIVE_UPLOAD_DEFAULT_FOLDER);
  assert.equal(img.reason, "image_ocr_unavailable");

  const same = classifyUploadTarget({
    fileName: "KDV1_beyanname_2024.pdf",
    mimeType: "application/pdf",
  });
  assert.deepEqual(same, byn);
});

await test("companyContentMatch: VKN mismatch → quarantine", () => {
  const company = {
    data: {
      companyName: "Örnek A.Ş.",
      vkn: "1234567890",
    },
  };
  // PDF-like latin1 with foreign VKN in parentheses (simple extractor)
  const foreign = Buffer.from(
    "%PDF-1.4\n(Vergi No: 9876543210)\n(Unvan: Baska Firma)\n",
    "utf8"
  );
  const mismatch = validateDocumentCompanyMatch({
    fileName: "fatura.pdf",
    mimeType: "application/pdf",
    buffer: foreign,
    company,
  });
  assert.equal(mismatch.status, "mismatch");
  assert.equal(mismatch.quarantine, true);
  assert.ok(mismatch.reasons.includes("vkn_mismatch"));
});

await test("companyContentMatch: image → pending, not fake match", () => {
  const company = {
    data: { companyName: "Örnek A.Ş.", vkn: "1234567890" },
  };
  const pending = validateDocumentCompanyMatch({
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff]),
    company,
  });
  assert.equal(pending.status, "pending");
  assert.equal(pending.quarantine, false);
  assert.equal(pending.confidence, 0);
  assert.ok(pending.reasons.includes("image_ocr_unavailable"));
});

await test("syncRetry: backoff + idempotency + max review", () => {
  const a0 = computeSyncBackoffMs(0, 1000, 60_000);
  const a3 = computeSyncBackoffMs(3, 1000, 60_000);
  assert.ok(a0 >= 1000 && a0 < 2000);
  assert.ok(a3 >= 8000);
  assert.equal(shouldRetrySyncAttempt(0), true);
  assert.equal(shouldRetrySyncAttempt(SYNC_RETRY_MAX_ATTEMPTS), false);
  assert.equal(nextReviewStatusAfterMaxRetries(), "review_required");

  const k1 = buildUploadIdempotencyKey({
    companyId: "c1",
    contentHash: "AbC",
    targetFolderPath: "98 - Diğer Evraklar",
  });
  const k2 = buildUploadIdempotencyKey({
    companyId: "c1",
    contentHash: "abc",
    targetFolderPath: "98 - Diğer Evraklar",
  });
  assert.equal(k1, k2);
  assert.ok(k1.includes("c1"));
  assert.ok(k1.includes("abc"));
});

await test("taxpayer nav: viewer office false, mukellef true", () => {
  assert.equal(canAccessRoute(ANNVERO_ROLES.VIEWER, "/muhasebe"), false);
  assert.equal(canAccessRoute(ANNVERO_ROLES.VIEWER, "/dashboard"), false);
  assert.equal(canAccessRoute(ANNVERO_ROLES.VIEWER, "/admin"), false);
  assert.equal(canAccessRoute(ANNVERO_ROLES.VIEWER, "/mukellef"), true);
  assert.equal(canAccessRoute(ANNVERO_ROLES.VIEWER, "/mukellef/evraklarim"), true);
  assert.equal(
    canAccessRoute(ANNVERO_ROLES.ACCOUNTING, "/muhasebe"),
    true
  );
});

await test("documentList: quarantine excluded; content_pending labeled", () => {
  assert.ok(
    DEFAULT_LIST_PARSE_STATUSES.includes(DOCUMENT_PARSE_STATUS.CONTENT_PENDING)
  );
  assert.ok(
    DEFAULT_LIST_PARSE_STATUSES.includes(DOCUMENT_PARSE_STATUS.REVIEW_REQUIRED)
  );
  assert.ok(
    !DEFAULT_LIST_PARSE_STATUSES.includes(DOCUMENT_PARSE_STATUS.QUARANTINE)
  );

  const companyId = "c-tax";
  const rows = [
    {
      id: "1",
      companyId,
      fileName: "ok.pdf",
      sourcePath: "98 - Diğer Evraklar/ok.pdf",
      parseStatus: "indexed",
    },
    {
      id: "2",
      companyId,
      fileName: "bad.pdf",
      sourcePath: "98 - Diğer Evraklar/bad.pdf",
      parseStatus: "quarantine",
      providerFileId: "drive-secret",
    },
    {
      id: "3",
      companyId,
      fileName: "scan.png",
      sourcePath: "98 - Diğer Evraklar/scan.png",
      parseStatus: "content_pending",
      mimeType: "image/png",
    },
    {
      id: "4",
      companyId,
      fileName: "sys.json",
      sourcePath: "_ANNVERO/metadata.json",
      parseStatus: "indexed",
    },
  ];
  const filtered = filterDocumentsForCompanyList(rows, { companyId });
  assert.equal(filtered.length, 2);
  assert.deepEqual(
    filtered.map((r) => r.id).sort(),
    ["1", "3"]
  );

  const pendingPub = toPublicDocumentListItem(rows[2], { companyId });
  assert.equal(pendingPub.statusLabel, DOCUMENT_STATUS_LABELS.content_pending);
  assert.equal(pendingPub.providerFileId, undefined);
  assert.doesNotMatch(JSON.stringify(pendingPub), /drive-secret/);
});

await test("static: upload uses classifyUploadTarget; reconcile HMAC", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const uploadSrc = fs.readFileSync(
    path.join(root, "app/api/google-drive/files/upload/route.js"),
    "utf8"
  );
  const reconcileSrc = fs.readFileSync(
    path.join(root, "app/api/google-drive/reconcile/route.js"),
    "utf8"
  );
  const syncSrc = fs.readFileSync(
    path.join(root, "app/api/google-drive/sync/route.js"),
    "utf8"
  );

  assert.ok(uploadSrc.includes("classifyUploadTarget"));
  assert.ok(uploadSrc.includes("validateDocumentCompanyMatch"));
  assert.ok(uploadSrc.includes("buildUploadIdempotencyKey"));
  assert.ok(uploadSrc.includes("runCompanyDriveSync"));
  assert.ok(uploadSrc.includes("assertCompanyAccess"));
  assert.ok(uploadSrc.includes("DRIVE_UPLOAD_DEFAULT_FOLDER"));
  assert.ok(uploadSrc.includes("quarantine") || uploadSrc.includes("QUARANTINE"));
  assert.doesNotMatch(uploadSrc, /SUPABASE_SERVICE_ROLE|client_secret|refresh_token\s*[:=]/);

  assert.ok(reconcileSrc.includes("x-annvero-reconcile-secret"));
  assert.ok(reconcileSrc.includes("ANNVERO_RECONCILE_SECRET"));
  assert.ok(reconcileSrc.includes("CRON_SECRET"));
  assert.ok(reconcileSrc.includes("requiresStrictRuntimeSecrets"));
  assert.ok(reconcileSrc.includes("runCompanyDriveSync"));
  assert.ok(reconcileSrc.includes("timingSafeEqual"));
  assert.doesNotMatch(reconcileSrc, /console\.log\([^)]*SECRET/);

  assert.ok(syncSrc.includes("isManagementUser"));
  assert.ok(syncSrc.includes("force") && syncSrc.includes("full"));
  assert.ok(syncSrc.includes("runCompanyDriveSync"));
  assert.ok(syncSrc.includes("writeSyncEvents"));
});

if (process.exitCode) {
  console.error("\nTaxpayer portal tests failed.");
  process.exit(1);
}
console.log("\nAll taxpayer portal / upload harden tests passed.");
