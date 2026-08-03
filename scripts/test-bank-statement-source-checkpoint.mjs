/**
 * Banka ekstresi kaynak checkpoint — firma onayı sonrası dosya kaybı regresyonları.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-statement-source-checkpoint.mjs
 */
import assert from "node:assert/strict";
import {
  buildArchiveReuseFromCheckpoint,
  clearBankStatementSourceCheckpoint,
  createBankStatementSourceCheckpoint,
  getCheckpointArrayBuffer,
  getCheckpointArrayBufferAsync,
  getCheckpointFile,
  hasUsableSourceCheckpoint,
  rememberArchiveOnCheckpoint,
  shouldBypassDedupForCompanyApproveResume,
  shouldBypassIdempotencyForCompanyApproveResume,
  shouldReuseArchiveFromCheckpoint,
  toSafeSourceCheckpointMeta,
} from "@/src/utils/bankStatementSourceCheckpoint.js";
import {
  applyManualCompanyConfirmationToGuard,
  assertManualCompanyConfirmation,
  BANK_COMPANY_GUARD_CODE,
  verifyBankStatementCompanyMatch,
} from "@/src/utils/bankStatementCompanyGuard.js";
import {
  applySessionMovementDedup,
  DUPLICATE_STATEMENT_UI_MESSAGE,
} from "@/src/utils/bankStatementDedup.js";
import { assertSameTenantReanalyze } from "@/src/utils/bankStatementReanalyze.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

const mare = {
  id: "mare-1",
  companyName: "MARE RESORT TURİZM VE OTELCİLİK TİCARET A.Ş",
  taxNumber: "9876543210",
};

await testAsync("PDF select → immutable checkpoint + hash once", async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 1, 2, 3, 4]);
  const inputFile = new File([bytes], "belirsiz-ekstre.pdf", {
    type: "application/pdf",
  });
  const cp = await createBankStatementSourceCheckpoint(inputFile);
  assert.equal(hasUsableSourceCheckpoint(cp), true);
  assert.equal(cp.fileName, "belirsiz-ekstre.pdf");
  assert.ok(cp.contentHash);
  assert.ok(cp.arrayBuffer.byteLength > 0);
  const ab1 = getCheckpointArrayBuffer(cp);
  const ab2 = getCheckpointArrayBuffer(cp);
  assert.notEqual(ab1, cp.arrayBuffer);
  assert.equal(ab1.byteLength, ab2.byteLength);
  // Slice neuter must not kill stored copy
  if (typeof ab1.transfer === "function") {
    ab1.transfer(ab1.byteLength);
  }
  const ab3 = await getCheckpointArrayBufferAsync(cp);
  assert.equal(ab3.byteLength, cp.byteLength);
  const stable = getCheckpointFile(cp);
  assert.ok(stable instanceof File);
  assert.equal(stable.name, "belirsiz-ekstre.pdf");
});

await testAsync(
  "COMPANY_VERIFICATION_REQUIRED → approve → checkpoint parse bytes intact",
  async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 9]);
    const cp = await createBankStatementSourceCheckpoint(
      new File([bytes], "belirsiz-ekstre.pdf", { type: "application/pdf" })
    );
    const guard = verifyBankStatementCompanyMatch({
      sheetRows: [
        ["Hareket", "Tutar", "B/A"],
        ["01.01.2025", "1.250,00", "B"],
        ["02.01.2025", "500,00", "A"],
      ],
      fileName: cp.fileName,
      text: "sayfa tarama metni — unvan/vkn/iban yok",
      selectedCompany: mare,
      companies: [mare],
    });
    assert.equal(guard.code, BANK_COMPANY_GUARD_CODE.VERIFICATION_REQUIRED);
    const confirm = assertManualCompanyConfirmation({
      guardCode: guard.code,
      checkboxChecked: true,
      confirmedCompanyId: mare.id,
      activeCompanyId: mare.id,
    });
    assert.equal(confirm.ok, true);
    const unlocked = applyManualCompanyConfirmationToGuard(guard, {
      confirmedCompanyId: mare.id,
      activeCompanyId: mare.id,
    });
    assert.equal(unlocked.blockPipeline, false);
    // Onay sonrası input File yok sayılır; checkpoint yeterli
    const resumeFile = getCheckpointFile(cp);
    assert.ok(resumeFile);
    const resumeBytes = await getCheckpointArrayBufferAsync(cp);
    assert.equal(resumeBytes.byteLength, bytes.byteLength);
    assert.equal(shouldBypassDedupForCompanyApproveResume(true), true);
    assert.equal(shouldBypassIdempotencyForCompanyApproveResume(true), true);
    assert.equal(shouldBypassDedupForCompanyApproveResume(false), false);
  }
);

test("approve/resume does not create second Drive file", () => {
  const cp = {
    archived: false,
    archiveSafeSummary: null,
    contentHash: "abc",
  };
  rememberArchiveOnCheckpoint(cp, {
    ok: true,
    code: "ARCHIVED",
    safeSummary: { archived: true, duplicate: false },
  });
  assert.equal(shouldReuseArchiveFromCheckpoint(cp), true);
  const reuse = buildArchiveReuseFromCheckpoint(cp);
  assert.equal(reuse.code, "CHECKPOINT_REUSE_ARCHIVE");
  assert.equal(reuse.skipped, true);
  assert.equal(reuse.safeSummary.checkpointReuse, true);
  assert.doesNotMatch(JSON.stringify(reuse), /fileId|token|driveId/i);
});

test("normal re-upload still duplicate-blocked; approve resume bypasses session dedup", () => {
  const movements = [
    { transactionId: "t1", amount: 10 },
    { transactionId: "t2", amount: 20 },
  ];
  const pass1 = applySessionMovementDedup(movements, new Set(), {
    companyId: mare.id,
    sourceFileHash: "hash-1",
  });
  assert.equal(pass1.allDuplicate, false);
  const pass2 = applySessionMovementDedup(movements, new Set(pass1.seenKeys), {
    companyId: mare.id,
    sourceFileHash: "hash-1",
  });
  assert.equal(pass2.allDuplicate, true);
  assert.equal(pass2.uiMessage, DUPLICATE_STATEMENT_UI_MESSAGE);
  // Approve resume path uses empty seen set when bypass flag on
  assert.equal(shouldBypassDedupForCompanyApproveResume(true), true);
  const approvePass = applySessionMovementDedup(movements, new Set(), {
    companyId: mare.id,
    sourceFileHash: "hash-1",
  });
  assert.equal(approvePass.allDuplicate, false);
});

test("company change clears source checkpoint fully", () => {
  let cp = { fileName: "x.pdf", arrayBuffer: new ArrayBuffer(4) };
  assert.equal(hasUsableSourceCheckpoint(cp), true);
  cp = clearBankStatementSourceCheckpoint(cp);
  assert.equal(cp, null);
  assert.equal(hasUsableSourceCheckpoint(cp), false);
});

test("cross-tenant blocked", () => {
  const cross = assertSameTenantReanalyze({
    requestCompanyId: mare.id,
    priorCompanyId: "other",
  });
  assert.equal(cross.ok, false);
  assert.equal(cross.code, "CROSS_TENANT_FORBIDDEN");
});

test("safe meta never includes raw bytes / tokens / Drive IDs", () => {
  const meta = toSafeSourceCheckpointMeta({
    fileName: "a.pdf",
    mimeType: "application/pdf",
    byteLength: 12,
    contentHash: "deadbeef",
    archived: true,
    archiveSafeSummary: { ok: true },
    arrayBuffer: new ArrayBuffer(12),
    blob: {},
    file: {},
  });
  const json = JSON.stringify(meta);
  assert.doesNotMatch(json, /arrayBuffer|blob|"file"|token|fileId|drive/i);
  assert.equal(meta.contentHash, "deadbeef");
});

test("workbench wires checkpoint + companyApproveResume", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
    ),
    "utf8"
  );
  assert.match(src, /createBankStatementSourceCheckpoint/);
  assert.match(src, /sourceCheckpointRef/);
  assert.match(src, /companyApproveResume:\s*true/);
  assert.match(src, /shouldReuseArchiveFromCheckpoint/);
  assert.match(src, /shouldBypassIdempotencyForCompanyApproveResume/);
  assert.match(src, /clearBankStatementSourceCheckpoint/);
  assert.match(src, /Güvenli yeniden deneme için oturum kaynağı/);
});

console.log("All bank-statement-source-checkpoint tests passed.");
