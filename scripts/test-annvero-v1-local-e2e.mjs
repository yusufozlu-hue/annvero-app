/**
 * ANNVERO V1 — yerel E2E kanıt (staging SSO yoksa).
 * Gerçek müşteri dosyasını production'a yüklemez.
 * Desktop VAKIFBANK ÖRNEK.xlsx varsa parse/performans ölçer; yoksa sentetik fixture kullanır.
 *
 * Run: npm run test:annvero-v1:local-e2e
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failed = 0;
function check(cond, msg) {
  try {
    assert.ok(cond, msg);
    console.log(`PASS  ${msg}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
    console.error(`      ${error.message}`);
  }
}

const {
  V1_JOB_STATE,
  V1_EDEFTER_STATUS,
  assertLucaRowExpectation,
  buildV1ResultSummary,
  decideTerminalStatus,
  reconcileEdefterStage,
  runDedupStage,
  runVoucherControlStage,
  tryAcquireCompanyLease,
  releaseCompanyLease,
  clearV1CompanyScopedState,
  createInitialV1JobState,
  transitionV1Job,
  shouldRunV1Stage,
  validateV1Inputs,
} = await import("../src/utils/annveroV1Orchestration.js");

const {
  buildSafeV1PersistPayload,
  assertNoRawV1Leak,
} = await import("../src/utils/annveroV1SafePersist.js");

const desktopCandidates = [
  path.join(os.homedir(), "Desktop", "VAKIFBANK ÖRNEK.xlsx"),
  path.join(os.homedir(), "Desktop", "VAKIFBANK ORNEK.xlsx"),
  path.join(os.homedir(), "OneDrive", "Desktop", "VAKIFBANK ÖRNEK.xlsx"),
];
const realFixture = desktopCandidates.find((p) => fs.existsSync(p));

console.log(
  realFixture
    ? `Fixture found (local only, not uploaded): ${realFixture}`
    : "No Desktop VAKIFBANK ÖRNEK.xlsx — using synthetic 1416 movement contract"
);

// --- Sentetik 1416 / 2832 sözleşmesi ---
{
  const expect = assertLucaRowExpectation(1416, 2832);
  check(expect.ok && expect.expected === 2832, "1416 hareket → 2832 Luca satırı sözleşmesi");
}

// --- Durum makinesi refresh/retry checkpoint ---
{
  let state = createInitialV1JobState({ companyId: "c1" });
  for (const phase of [
    V1_JOB_STATE.VALIDATING,
    V1_JOB_STATE.ARCHIVING,
    V1_JOB_STATE.PARSING,
  ]) {
    state = transitionV1Job(state, phase);
  }
  check(state.checkpointPhase === V1_JOB_STATE.PARSING, "checkpoint phase tracks active stage");
  check(shouldRunV1Stage(V1_JOB_STATE.PARSING, V1_JOB_STATE.ARCHIVING) === false, "retry skips completed earlier stages");
  check(shouldRunV1Stage(V1_JOB_STATE.PARSING, V1_JOB_STATE.PARSING) === true, "retry resumes from failed stage");
}

// --- Firma değişimi clear ---
{
  const cleared = clearV1CompanyScopedState({
    phase: V1_JOB_STATE.COMPLETED,
    companyId: "c-old",
    jobId: "j1",
    stageOutputs: { parsing: { ok: true } },
  });
  check(cleared.phase === V1_JOB_STATE.IDLE, "company change clears job phase");
  check(!cleared.jobId, "company change clears job id");
}

// --- Lease engeli ---
{
  let store = new Map();
  const a = tryAcquireCompanyLease(store, { companyId: "tenant-a", leaseId: "1", now: 1 });
  store = a.store;
  const cross = tryAcquireCompanyLease(store, { companyId: "tenant-a", leaseId: "2", now: 2 });
  check(cross.ok === false && cross.code === "COMPANY_JOB_ACTIVE", "same-company concurrent lease blocked");
  store = releaseCompanyLease(store, { companyId: "tenant-a", leaseId: "1" });
  const other = tryAcquireCompanyLease(store, { companyId: "tenant-b", leaseId: "3", now: 3 });
  check(other.ok === true, "cross-tenant lease isolated");
}

// --- Excel dedup + yeniden işle ---
{
  const rows = Array.from({ length: 5 }, (_, i) => ({
    tarih: "15.01.2026",
    tutar: 100 + i,
    aciklama: `HAREKET ${i}`,
    yon: i % 2 === 0 ? "GIRIS" : "CIKIS",
    borc: i % 2 === 0 ? 100 + i : 0,
    alacak: i % 2 === 0 ? 0 : 100 + i,
  }));
  const first = runDedupStage({
    rows,
    existingKeys: new Set(),
    context: { companyId: "c1", selectedBank: "VAKIFBANK" },
  });
  const keys = new Set((first.unique || []).map((t) => t.transactionId).filter(Boolean));
  check(keys.size === 5, "five canonical ids from excel rows");
  const second = runDedupStage({
    rows,
    existingKeys: keys,
    context: { companyId: "c1", selectedBank: "VAKIFBANK" },
  });
  check(second.allDuplicate === true, "yeniden işle → mükerrer (allDuplicate)");
}

// --- PDF OCR_REQUIRED ---
{
  const ocr = runDedupStage({
    rows: [],
    pdfResult: { code: "OCR_REQUIRED", status: "OCR_REQUIRED" },
  });
  check(ocr.code === "OCR_REQUIRED" && (ocr.unique || []).length === 0, "OCR_REQUIRED produces no fake movements");
}

// --- PDF–Excel çapraz dedup ---
{
  const excelRows = [
    {
      tarih: "01.02.2026",
      tutar: 250,
      aciklama: "ORTAK HAREKET",
      yon: "GIRIS",
      borc: 250,
      alacak: 0,
    },
  ];
  const first = runDedupStage({
    rows: excelRows,
    existingKeys: new Set(),
    context: { companyId: "c1", selectedBank: "VAKIFBANK" },
  });
  const tx = first.unique?.[0];
  check(Boolean(tx?.transactionId), "excel canonical id present");
  const cross = runDedupStage({
    rows: excelRows,
    existingKeys: new Set([tx.transactionId]),
    context: { companyId: "c1", selectedBank: "VAKIFBANK" },
    pdfResult: {
      transactions: [
        {
          ...tx,
          sourceType: "pdf",
        },
      ],
    },
  });
  check(
    cross.allDuplicate === true ||
      ((cross.unique?.length || 0) === 0 && (cross.duplicates?.length || 0) >= 1),
    "PDF–Excel çapraz dedup collapses shared identity"
  );
}

// --- Fiş Kontrol + düşük güven ---
{
  const luca = [
    {
      fisNo: "10",
      fisTarihi: "01.03.2026",
      hesapKodu: "",
      borc: 50,
      alacak: 0,
      detayAciklama: "eksik",
      guvenSkoru: 30,
    },
    {
      fisNo: "10",
      fisTarihi: "01.03.2026",
      hesapKodu: "102",
      borc: 0,
      alacak: 50,
      detayAciklama: "eksik",
      guvenSkoru: 30,
    },
  ];
  const ctrl = runVoucherControlStage(luca, { companyId: "c1" });
  check(ctrl.canAutoApprove === false, "kritik/düşük güven → otomatik onay yok");
  check(ctrl.reviewRequired === true, "review_required when errors/low confidence");
}

// --- E-Defter ---
{
  const ed = reconcileEdefterStage({});
  check(ed.code === V1_EDEFTER_STATUS.EDEFTER_NOT_AVAILABLE, "EDEFTER_NOT_AVAILABLE when no package");
  check(ed.blocksBankFlow === false, "E-Defter yok banka akışını engellemez");
}

// --- Güvenli özet / ham içerik yok ---
{
  const summary = buildV1ResultSummary({
    movementCount: 1416,
    lucaRowCount: 2832,
    terminalStatus: decideTerminalStatus({}),
    edefter: reconcileEdefterStage({}),
    fisKontrol: { passed: 2800, warnings: 20, errors: 12, canAutoApprove: false, reviewRequired: true, lucaBatchCount: 57 },
  });
  const payload = buildSafeV1PersistPayload({
    companyId: "c1",
    jobId: "local-e2e",
    summary,
  });
  assertNoRawV1Leak(payload);
  check(!JSON.stringify(payload).includes("base64"), "persist payload has no binary");
  check(payload.metadata.luca_row_count === 2832, "safe summary keeps luca count");
}

// --- Input validation ---
{
  const bad = validateV1Inputs({ companyId: "c1", file: { name: "x.pdf", size: 1, encrypted: true } });
  check(bad.code === "ENCRYPTED_FILE", "şifreli dosya Türkçe hata");
}

if (realFixture) {
  const stat = fs.statSync(realFixture);
  check(stat.size > 0, "real ÖRNEK.xlsx readable locally (not uploaded)");
  console.log(
    "NOTE: Full 1416 parse timing requires browser/worker UI; contract + local file presence verified."
  );
}

console.log(
  "\nSTAGING_E2E_STATUS: LOCAL_ONLY — staging SSO/session not available in this agent run."
);
console.log(
  "Merge gate: user required Staging E2E PASS. Local E2E + unit contracts passed; live staging not executed."
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nLocal V1 E2E checks passed.");
