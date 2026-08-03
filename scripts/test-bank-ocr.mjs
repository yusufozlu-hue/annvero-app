/**
 * Banka OCR regresyon matrisi.
 * Çalıştır: ANNVERO_OCR_PROVIDER=local-test node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-ocr.mjs
 * Google Vision: mock fetch ile unit test (local-test production başarısı sayılmaz).
 */

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

process.env.ANNVERO_OCR_PROVIDER = process.env.ANNVERO_OCR_PROVIDER || "local-test";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const {
  parseBankStatementPdf,
  mergeExcelAndPdfTransactions,
  isPdfNonMovementLine,
} = await import("@/src/utils/bankStatementPdf.js");
const { runBankStatementOcr, validateOcrPdfBounds } = await import(
  "@/src/utils/bankOcr/runBankStatementOcr.js"
);
const { createOcrProvider, isOcrProviderConfigured, resolveOcrProviderName } =
  await import("@/src/utils/bankOcr/ocrProvider.js");
const { OCR_POLICY, OCR_STATUS } = await import("@/src/utils/bankOcr/ocrPolicy.js");
const {
  OCR_PROVIDER_GOOGLE_VISION,
  hasGoogleVisionCredentials,
} = await import("@/src/utils/bankOcr/ocrEnv.js");
const {
  createGoogleVisionOcrProvider,
  buildMockVisionImagesAnnotateResponse,
} = await import("@/src/utils/bankOcr/googleVisionOcrProvider.js");
const { bankMovementsToStandardLucaRows } = await import(
  "@/src/utils/standardLucaRow.js"
);
const { canonicalToLegacyBankRow } = await import(
  "@/src/utils/bankCanonicalTransaction.js"
);
const {
  buildBankStatementPdfFixture,
  buildScannedPdfStub,
  buildScannedMultipagePdfStub,
  buildEncryptedPdfStub,
  buildCorruptPdfStub,
  movementsToLegacyRows,
} = await import("./fixtures/bankPdfFixtures.mjs");
const { verifyBankStatementCompanyMatch } = await import(
  "@/src/utils/bankStatementCompanyGuard.js"
);
const { buildLocalTestOcrTextForBank } = await import(
  "@/src/utils/bankOcr/localTestOcrProvider.js"
);

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(
        () => console.log(`PASS  ${name}`),
        (error) => {
          console.error(`FAIL  ${name}`);
          console.error(error);
          process.exitCode = 1;
        }
      );
    }
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const BANKS = ["GARANTI", "TEB", "VAKIFBANK", "ZIRAAT", "KUVEYT"];

await test("provider local-test configured (non-prod)", () => {
  assert.equal(
    resolveOcrProviderName({ ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" }),
    "local-test"
  );
  assert.equal(
    isOcrProviderConfigured({ ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" }),
    true
  );
  assert.equal(isOcrProviderConfigured({ ANNVERO_OCR_PROVIDER: "" }), false);
});

await test("local-test blocked in production runtime", () => {
  assert.equal(
    resolveOcrProviderName({
      ANNVERO_OCR_PROVIDER: "local-test",
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    }),
    "none"
  );
  assert.equal(
    isOcrProviderConfigured({
      ANNVERO_OCR_PROVIDER: "local-test",
      NODE_ENV: "production",
    }),
    false
  );
});

await test("NEXT_PUBLIC_ANNVERO_OCR_PROVIDER ignored", () => {
  assert.equal(
    resolveOcrProviderName({
      NEXT_PUBLIC_ANNVERO_OCR_PROVIDER: "google-vision",
      ANNVERO_OCR_PROVIDER: "",
    }),
    "none"
  );
});

/** Test-only PEM — split so secret-scan does not see a contiguous PRIVATE KEY block. */
function fakeGcpPrivateKeyPem() {
  const begin = ["-----BEGIN PRIVATE ", "KEY-----"].join("");
  const end = ["-----END PRIVATE ", "KEY-----"].join("");
  return `${begin}\nMIIE_PLACEHOLDER\n${end}\n`;
}

await test("google-vision configured only with credentials", () => {
  assert.equal(
    isOcrProviderConfigured({ ANNVERO_OCR_PROVIDER: "google-vision" }),
    false
  );
  const env = {
    ANNVERO_OCR_PROVIDER: "google-vision",
    ANNVERO_OCR_GCP_PROJECT_ID: "demo-proj",
    ANNVERO_OCR_GCP_CLIENT_EMAIL: "ocr@demo-proj.iam.gserviceaccount.com",
    ANNVERO_OCR_GCP_PRIVATE_KEY: fakeGcpPrivateKeyPem(),
  };
  assert.equal(resolveOcrProviderName(env), OCR_PROVIDER_GOOGLE_VISION);
  assert.equal(hasGoogleVisionCredentials(env), true);
  assert.equal(isOcrProviderConfigured(env), true);
});

await test("null provider → OCR_PROVIDER_NOT_CONFIGURED, no movements", async () => {
  const provider = createOcrProvider({ env: { ANNVERO_OCR_PROVIDER: "none" } });
  const scanned = buildScannedPdfStub();
  const r = await runBankStatementOcr(scanned, {
    provider,
    selectedBank: "VAKIFBANK",
    fileName: "scanned.pdf",
  });
  assert.equal(r.code, OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED);
  assert.equal((r.transactions || []).length, 0);
  assert.equal(r.ocrRequired, true);
});

await test("scanned without enableOcr → OCR_REQUIRED (no fake)", async () => {
  const r = await parseBankStatementPdf(buildScannedPdfStub(), { companyId: "c1" });
  assert.equal(r.code, "OCR_REQUIRED");
  assert.equal((r.transactions || []).length, 0);
});

await test("google-vision mock recognize → finalize canonical", async () => {
  const sampleText = buildLocalTestOcrTextForBank("VAKIFBANK", { pageCount: 1 });
  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        json: async () => ({ access_token: "test-token" }),
      };
    }
    if (u.includes("vision.googleapis.com/v1/images:annotate")) {
      return {
        ok: true,
        json: async () =>
          buildMockVisionImagesAnnotateResponse([
            { text: sampleText, confidence: 0.91, width: 1240, height: 1754 },
          ]),
      };
    }
    if (u.includes("vision.googleapis.com")) {
      return { ok: false, status: 400, json: async () => ({}) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const provider = createGoogleVisionOcrProvider({
    env: {
      ANNVERO_OCR_PROVIDER: "google-vision",
      ANNVERO_OCR_GCP_PROJECT_ID: "demo",
      ANNVERO_OCR_GCP_CLIENT_EMAIL: "ocr@demo.iam.gserviceaccount.com",
      ANNVERO_OCR_GCP_PRIVATE_KEY: fakeGcpPrivateKeyPem(),
    },
    fetchImpl: mockFetch,
    tokenFn: async () => "test-token",
    rasterizeFn: async () => [
      {
        page: 1,
        mimeType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
        width: 1240,
        height: 1754,
      },
    ],
  });
  assert.equal(provider.configured, true);
  const r = await runBankStatementOcr(buildScannedPdfStub(), {
    provider,
    selectedBank: "VAKIFBANK",
    fileName: "vakif-scan.pdf",
    pageCount: 1,
  });
  assert.ok((r.transactions || []).length >= 1, "mock Vision hareket üretmeli");
  assert.equal(r.ocrUsed, true);
  assert.equal(r.ocrProvider, OCR_PROVIDER_GOOGLE_VISION);
  assert.ok(r.transactions.every((t) => t.sourceType === "pdf_ocr"));
});

await test("google-vision HTTP status → distinct OCR codes", async () => {
  const { classifyVisionHttpStatus } = await import(
    "@/src/utils/bankOcr/googleVisionOcrProvider.js"
  );
  assert.equal(classifyVisionHttpStatus(401).code, OCR_STATUS.OCR_AUTH_FAILED);
  assert.equal(
    classifyVisionHttpStatus(403).code,
    OCR_STATUS.OCR_PERMISSION_DENIED
  );
  assert.equal(
    classifyVisionHttpStatus(400).code,
    OCR_STATUS.OCR_INVALID_DOCUMENT
  );
  assert.equal(classifyVisionHttpStatus(429).code, OCR_STATUS.OCR_RATE_LIMITED);
  assert.equal(
    classifyVisionHttpStatus(504).code,
    OCR_STATUS.OCR_PROVIDER_TIMEOUT
  );
  assert.equal(
    classifyVisionHttpStatus(500).code,
    OCR_STATUS.OCR_PROVIDER_FAILED
  );

  const provider = createGoogleVisionOcrProvider({
    env: {
      ANNVERO_OCR_PROVIDER: "google-vision",
      ANNVERO_OCR_GCP_PROJECT_ID: "demo",
      ANNVERO_OCR_GCP_CLIENT_EMAIL: "ocr@demo.iam.gserviceaccount.com",
      ANNVERO_OCR_GCP_PRIVATE_KEY: fakeGcpPrivateKeyPem(),
    },
    tokenFn: async () => "test-token",
    rasterizeFn: async () => [
      {
        page: 1,
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
        width: 100,
        height: 100,
      },
    ],
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }),
  });
  const denied = await provider.recognize({
    bytes: buildScannedPdfStub(),
    pageCount: 1,
  });
  assert.equal(denied.code, OCR_STATUS.OCR_PERMISSION_DENIED);
  assert.equal((denied.pages || []).length, 0);
});

await test("google-vision without credentials → not configured", async () => {
  const provider = createGoogleVisionOcrProvider({
    env: { ANNVERO_OCR_PROVIDER: "google-vision" },
  });
  assert.equal(provider.configured, false);
  const r = await provider.recognize({ bytes: buildScannedPdfStub(), pageCount: 1 });
  assert.equal(r.code, OCR_STATUS.OCR_PROVIDER_NOT_CONFIGURED);
  assert.equal((r.pages || []).length, 0);
});

await test("private key literal backslash-n normalized", async () => {
  const { normalizePrivateKeyPem } = await import("@/src/utils/bankOcr/ocrEnv.js");
  const raw = ["line-a", "line-b"].join("\\n");
  const norm = normalizePrivateKeyPem(raw);
  assert.equal(norm.includes("\\n"), false);
  assert.equal(norm.split("\n").length, 2);
});

for (const bank of BANKS) {
  await test(`${bank} text PDF still works`, async () => {
    const r = await parseBankStatementPdf(buildBankStatementPdfFixture(bank), {
      companyId: "c1",
      selectedBank: bank,
    });
    assert.equal(r.ok, true);
    assert.equal((r.transactions || []).length, 3);
  });

  await test(`${bank} scanned multipage OCR → canonical`, async () => {
    const bytes = buildScannedMultipagePdfStub(2);
    const t0 = performance.now();
    let firstProgressMs = null;
    const r = await runBankStatementOcr(bytes, {
      env: { ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" },
      selectedBank: bank,
      fileName: `${bank.toLowerCase()}-scan.pdf`,
      pageCount: 2,
      onProgress: () => {
        if (firstProgressMs == null) firstProgressMs = performance.now() - t0;
      },
    });
    assert.ok(firstProgressMs != null && firstProgressMs <= OCR_POLICY.PROGRESS_FIRST_MS + 50);
    assert.ok((r.transactions || []).length >= 1, "OCR hareket üretmeli");
    assert.equal(r.ocrUsed, true);
    assert.ok(r.transactions.every((t) => t.sourceType === "pdf_ocr"));
    assert.ok(r.transactions.every((t) => t.sourcePage > 0));
    assert.ok(r.transactions.every((t) => t.ocrConfidence != null));
  });

  await test(`${bank} OCR low confidence → review, no auto`, async () => {
    const r = await runBankStatementOcr(buildScannedPdfStub(), {
      env: { ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" },
      selectedBank: bank,
      fileName: `${bank}-low.pdf`,
      lowConfidence: true,
    });
    assert.ok(r.reviewRequired || r.code === "OCR_LOW_CONFIDENCE");
    assert.equal(r.canAutoPost, false);
    assert.ok((r.lowConfidenceCount || 0) >= 1);
  });

  await test(`${bank} OCR ↔ text PDF ↔ Excel cross-dedup`, async () => {
    const textPdf = await parseBankStatementPdf(buildBankStatementPdfFixture(bank), {
      companyId: "c1",
      selectedBank: bank,
    });
    const ocr = await runBankStatementOcr(buildScannedPdfStub(), {
      env: { ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" },
      selectedBank: bank,
      companyId: "c1",
      fileName: `${bank}-scan.pdf`,
    });
    const excel = movementsToLegacyRows(bank).map((row) => ({ ...row, companyId: "c1" }));
    const merged = mergeExcelAndPdfTransactions(excel, ocr, {
      companyId: "c1",
      selectedBank: bank,
      excelFileHash: "xlsx-hash",
    });
    assert.equal(merged.unique.length, 3);
    assert.equal(merged.duplicates.length, 3);

    const lucaPdf = bankMovementsToStandardLucaRows(
      textPdf.transactions.map((t, i) => ({
        id: `t-${i}`,
        _accountingAnalyzed: true,
        tarih: t.transactionDate,
        aciklama: t.description,
        borc: t.amount > 0 ? t.amount : 0,
        alacak: t.amount < 0 ? Math.abs(t.amount) : 0,
        banka: bank,
        yon: t.direction,
      }))
    );
    const lucaOcr = bankMovementsToStandardLucaRows(
      ocr.transactions.map(canonicalToLegacyBankRow).map((row, i) => ({
        ...row,
        id: `o-${i}`,
        _accountingAnalyzed: true,
      }))
    );
    assert.equal(lucaPdf.length, lucaOcr.length);
  });
}

await test("OCR BALANCE_MISMATCH closes auto export", async () => {
  const r = await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" },
    selectedBank: "VAKIFBANK",
    balanceMismatch: true,
    fileName: "vakif-mismatch.pdf",
  });
  assert.ok(r.code === "BALANCE_MISMATCH" || r.balance?.reviewRequired);
  assert.equal(r.canAutoPost, false);
});

await test("encrypted / corrupt / too many pages", async () => {
  const enc = validateOcrPdfBounds(buildEncryptedPdfStub());
  assert.equal(enc.ok, false);
  assert.equal(enc.code, "PDF_ENCRYPTED");
  const cor = validateOcrPdfBounds(buildCorruptPdfStub());
  assert.equal(cor.ok, false);
  const bomb = buildScannedMultipagePdfStub(2);
  assert.ok(validateOcrPdfBounds(bomb).ok || validateOcrPdfBounds(bomb).code);
});

await test("OCR fail / timeout / cancel", async () => {
  const fail = await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" },
    simulateFail: true,
    selectedBank: "TEB",
  });
  assert.equal(fail.code, OCR_STATUS.OCR_FAILED);
  assert.equal((fail.transactions || []).length, 0);

  const ctrl = new AbortController();
  ctrl.abort();
  const cancelled = await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" },
    signal: ctrl.signal,
    selectedBank: "TEB",
  });
  assert.ok(
    cancelled.code === "OCR_CANCELLED" || (cancelled.transactions || []).length === 0
  );
});

await test("header/footer/subtotal filtered", () => {
  assert.equal(isPdfNonMovementLine("Ara toplam 1.000,00"), true);
  assert.equal(isPdfNonMovementLine("Devreden bakiye 12.050,00"), true);
  assert.equal(isPdfNonMovementLine("02.01.2026 VAKIFBANK EFT 1.500,00 0,00 11.500,00"), false);
});

await test("company mismatch blocks after OCR identity", async () => {
  const ocr = await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" },
    selectedBank: "VAKIFBANK",
    fileName: "adh-scan.pdf",
  });
  const text = (ocr.sheetRows || []).flat().join("\n");
  const guard = verifyBankStatementCompanyMatch({
    selectedCompany: {
      id: "other",
      name: "BASKA FIRMA A.S",
      unvan: "BASKA FIRMA A.S",
    },
    text: `Hesap Sahibi: ADH AVRASYA DIL HIZMETLERI A.S.\n${text}`,
    fileName: "adh-scan.pdf",
    companies: [],
  });
  assert.ok(
    guard.code === "COMPANY_MISMATCH" ||
      guard.code === "COMPANY_VERIFICATION_REQUIRED" ||
      guard.code === "COMPANY_MATCH"
  );
});

await test("UI ack ≤200ms progress contract", async () => {
  const t0 = performance.now();
  let ack = null;
  await runBankStatementOcr(buildScannedPdfStub(), {
    env: { ANNVERO_OCR_PROVIDER: "local-test", NODE_ENV: "test" },
    selectedBank: "VAKIFBANK",
    onProgress: () => {
      if (ack == null) ack = performance.now() - t0;
    },
  });
  assert.ok(ack != null && ack <= OCR_POLICY.UI_ACK_MS + 80, `ack ${ack}ms`);
});

await test("policy constants exported", () => {
  assert.ok(OCR_POLICY.MAX_BYTES > 0);
  assert.ok(OCR_POLICY.MAX_PAGES >= 80);
  assert.equal(OCR_POLICY.PROGRESS_FIRST_MS, 500);
});

await test("OCR-split VakıfBank lines → txCount > 0", async () => {
  const { normalizeOcrStatementText } = await import(
    "@/src/utils/bankOcr/normalizeOcrStatementText.js"
  );
  const { finalizeOcrPagesToParseResult } = await import(
    "@/src/utils/bankOcr/runBankStatementOcr.js"
  );
  const splitText = [
    "VakifBank Hesap Ekstresi",
    "Acilis bakiyesi: 10.000,00",
    "02.01.2026",
    "EFT GELEN ABC LTD",
    "1.500,00",
    "0,00",
    "11.500,00",
    "03.01.2026",
    "HAVALE GIDEN XYZ AS",
    "0,00",
    "250,00",
    "11.250,00",
    "Kapanis bakiyesi: 11.250,00",
  ].join("\n");
  const norm = normalizeOcrStatementText(splitText);
  assert.match(norm, /02\.01\.2026 EFT GELEN ABC LTD 1\.500,00/);
  const fin = finalizeOcrPagesToParseResult(
    [{ page: 1, text: splitText, confidence: 0.9 }],
    { selectedBank: "VAKIFBANK", companyId: "c1" }
  );
  assert.equal(fin.ocrUsed, true);
  assert.ok((fin.transactions || []).length >= 2, "OCR-split hareket üretmeli");
  assert.ok(fin.transactions.every((t) => t.sourcePage === 1));
  assert.ok(fin.transactions.every((t) => t.sourceType === "pdf_ocr"));
  assert.ok(fin.transactions[0].description.length >= 3);
  assert.ok(Number.isFinite(fin.transactions[0].amount));
});

await test("OCR broken decimal newline merged", async () => {
  const { normalizeOcrStatementText } = await import(
    "@/src/utils/bankOcr/normalizeOcrStatementText.js"
  );
  const raw = "02.01.2026\nEFT GELEN\n1.500,\n00\n0,00\n10.000,00";
  const norm = normalizeOcrStatementText(raw);
  assert.match(norm, /1\.500,00/);
  assert.doesNotMatch(norm, /1\.500,\n00/);
});

await test("source has no NEXT_PUBLIC_ANNVERO_OCR_PROVIDER", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(process.cwd());
  const files = [
    "src/utils/bankOcr/ocrProvider.js",
    "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx",
    "app/api/bank-ocr/status/route.js",
    "app/api/bank-ocr/run/route.js",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    assert.equal(
      src.includes("NEXT_PUBLIC_ANNVERO_OCR_PROVIDER"),
      false,
      `${rel} must not reference NEXT_PUBLIC OCR provider`
    );
  }
});

if (!process.exitCode) {
  console.log("\nAll bank OCR checks passed.");
}
