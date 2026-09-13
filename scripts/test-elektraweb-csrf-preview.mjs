/**
 * Elektraweb CSRF/origin + preview + Luca Excel + tenant isolation.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-elektraweb-csrf-preview.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import {
  getAllowedOrigins,
  extractRequestHostOrigin,
  evaluateSameOriginCsrf,
} from "../src/lib/security/csrf.js";
import { processElektrawebWorkbook } from "../src/utils/elektrawebProcessor.js";
import { standardLucaRowsToExcelRows, LUCA_EXPORT_HEADERS } from "../src/utils/standardLucaRow.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_SITE_URL",
  "ANNVERO_ALLOWED_ORIGINS",
  "ANNVERO_TRUST_PROXY",
];

const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

function withEnv(patch, fn) {
  const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) {
    if (!(key in patch)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function mockRequest({ method = "POST", headers = {} } = {}) {
  const map = new Map(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)])
  );
  return {
    method,
    headers: {
      get(name) {
        return map.get(String(name).toLowerCase()) || null;
      },
    },
  };
}

const __queue = [];
function test(name, fn) {
  __queue.push({ name, fn });
}

// --- CSRF / origin ---

test("allowlist: production + staging + Vercel preview URLs exact", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SITE_URL: "https://www.annvero.com",
      VERCEL_URL: "annvero-app-git-feat-xyz.vercel.app",
      VERCEL_BRANCH_URL: "annvero-app-git-feat-xyz.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "www.annvero.com",
      ANNVERO_ALLOWED_ORIGINS: "https://annvero-staging.vercel.app,https://annvero.com",
    },
    () => {
      const allowed = getAllowedOrigins();
      assert.equal(allowed.has("https://www.annvero.com"), true);
      assert.equal(allowed.has("https://annvero.com"), true);
      assert.equal(allowed.has("https://annvero-staging.vercel.app"), true);
      assert.equal(allowed.has("https://annvero-app-git-feat-xyz.vercel.app"), true);
      assert.equal(allowed.has("http://localhost:3000"), false);
    }
  );
});

test("CSRF: allowlist origin accepted; foreign origin denied (negative)", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://www.annvero.com",
    },
    () => {
      const ok = evaluateSameOriginCsrf(
        mockRequest({
          headers: {
            origin: "https://www.annvero.com",
            host: "www.annvero.com",
          },
        })
      );
      assert.equal(ok.ok, true);

      const denied = evaluateSameOriginCsrf(
        mockRequest({
          headers: {
            origin: "https://evil.example",
            host: "www.annvero.com",
          },
        })
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.code, "CSRF_ORIGIN_DENIED");
      assert.match(denied.error, /origin izinli değil/);
    }
  );
});

test("CSRF: preview Host exact match when SITE_URL is production", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SITE_URL: "https://www.annvero.com",
      // VERCEL_URL bilinçli olarak farklı bırakılır; Host match kurtarır
      VERCEL_URL: "other-deployment.vercel.app",
    },
    () => {
      const previewHost = "annvero-app-abc123-yusuf.vercel.app";
      const result = evaluateSameOriginCsrf(
        mockRequest({
          headers: {
            origin: `https://${previewHost}`,
            host: previewHost,
            "x-forwarded-host": previewHost,
            "x-forwarded-proto": "https",
          },
        })
      );
      assert.equal(result.ok, true);
    }
  );
});

test("CSRF: staging Host exact match", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SITE_URL: "https://www.annvero.com",
    },
    () => {
      const result = evaluateSameOriginCsrf(
        mockRequest({
          headers: {
            origin: "https://annvero-staging.vercel.app",
            host: "annvero-staging.vercel.app",
            "x-forwarded-host": "annvero-staging.vercel.app",
            "x-forwarded-proto": "https",
          },
        })
      );
      assert.equal(result.ok, true);
    }
  );
});

test("CSRF negative: forged X-Forwarded-Host ignored without trust", () => {
  withEnv(
    {
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://www.annvero.com",
      // VERCEL yok, ANNVERO_TRUST_PROXY yok
    },
    () => {
      const hostOrigin = extractRequestHostOrigin(
        mockRequest({
          headers: {
            host: "www.annvero.com",
            "x-forwarded-host": "evil.example",
            "x-forwarded-proto": "https",
          },
        })
      );
      assert.equal(hostOrigin, "https://www.annvero.com");

      const denied = evaluateSameOriginCsrf(
        mockRequest({
          headers: {
            origin: "https://evil.example",
            host: "www.annvero.com",
            "x-forwarded-host": "evil.example",
          },
        })
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.code, "CSRF_ORIGIN_DENIED");
    }
  );
});

test("CSRF negative: no loose suffix/sibling host match", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VERCEL: "1",
      NEXT_PUBLIC_SITE_URL: "https://www.annvero.com",
      ANNVERO_ALLOWED_ORIGINS: "https://annvero-staging.vercel.app",
    },
    () => {
      const cases = [
        "https://evil-annvero.com",
        "https://www.annvero.com.evil.example",
        "https://annvero-staging.vercel.app.evil.example",
        "https://not-annvero-staging.vercel.app",
        "https://attacker.vercel.app",
      ];
      for (const origin of cases) {
        const result = evaluateSameOriginCsrf(
          mockRequest({
            headers: {
              origin,
              host: "www.annvero.com",
              "x-forwarded-host": "www.annvero.com",
              "x-forwarded-proto": "https",
            },
          })
        );
        assert.equal(result.ok, false, `should deny ${origin}`);
      }

      const src = fs.readFileSync(path.join(root, "src/lib/security/csrf.js"), "utf8");
      assert.doesNotMatch(src, /endsWith\s*\(/);
      assert.doesNotMatch(src, /\.vercel\.app['"`]\s*\)/);
      assert.doesNotMatch(src, /includes\s*\(\s*['"`]\.vercel/);
    }
  );
});

test("CSRF negative: missing Origin/Referer fail-closed in production", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://www.annvero.com",
    },
    () => {
      const result = evaluateSameOriginCsrf(
        mockRequest({
          headers: { host: "www.annvero.com" },
        })
      );
      assert.equal(result.ok, false);
      assert.equal(result.code, "CSRF_ORIGIN_MISSING");
    }
  );
});

test("elektraweb route applies CSRF before parser (static order)", () => {
  const src = fs.readFileSync(path.join(root, "app/api/elektraweb/route.ts"), "utf8");
  const csrfCall = src.indexOf("enforceSameOriginCsrf(req)");
  const parseCall = src.indexOf("processElektrawebFile(");
  const formCall = src.indexOf("await req.formData()");
  assert.ok(csrfCall > 0, "CSRF call missing");
  assert.ok(parseCall > csrfCall, "parser must run after CSRF");
  assert.ok(formCall > csrfCall, "form parse must run after CSRF");
});

// --- Elektra ön izleme (558 satır / 174 dengeli fiş) ---

function buildElektraFixtureRows() {
  const rows = [];
  // 138×3 + 36×4 = 558 satır, 174 fiş
  const plan = [
    ...Array.from({ length: 138 }, (_, i) => ({ fisNo: i + 1, lines: 3 })),
    ...Array.from({ length: 36 }, (_, i) => ({ fisNo: 139 + i, lines: 4 })),
  ];

  for (const { fisNo, lines } of plan) {
    const date = "15.03.2026";
    const aciklama = `Elektra test fiş ${fisNo}`;
    if (lines === 3) {
      rows.push(
        {
          "Fiş Numarası": String(fisNo),
          "Fiş Tarihi": date,
          "Fiş Açıklama": aciklama,
          "Detay Açıklama": `${aciklama} borç`,
          "Hesap Kodu": "100.01",
          Borç: "100,00",
          Alacak: "",
          "Belge Türü": "Fatura",
          "Belge No": `B${fisNo}`,
        },
        {
          "Fiş Numarası": String(fisNo),
          "Fiş Tarihi": date,
          "Fiş Açıklama": aciklama,
          "Detay Açıklama": `${aciklama} alacak-a`,
          "Hesap Kodu": "320.01",
          Borç: "",
          Alacak: "60,00",
          "Belge Türü": "Fatura",
          "Belge No": `B${fisNo}`,
        },
        {
          "Fiş Numarası": String(fisNo),
          "Fiş Tarihi": date,
          "Fiş Açıklama": aciklama,
          "Detay Açıklama": `${aciklama} alacak-b`,
          "Hesap Kodu": "391.01",
          Borç: "",
          Alacak: "40,00",
          "Belge Türü": "Fatura",
          "Belge No": `B${fisNo}`,
        }
      );
    } else {
      rows.push(
        {
          "Fiş Numarası": String(fisNo),
          "Fiş Tarihi": date,
          "Fiş Açıklama": aciklama,
          "Detay Açıklama": `${aciklama} borç-a`,
          "Hesap Kodu": "100.01",
          Borç: "70,00",
          Alacak: "",
          "Belge Türü": "Makbuz",
          "Belge No": `M${fisNo}`,
        },
        {
          "Fiş Numarası": String(fisNo),
          "Fiş Tarihi": date,
          "Fiş Açıklama": aciklama,
          "Detay Açıklama": `${aciklama} borç-b`,
          "Hesap Kodu": "102.01",
          Borç: "30,00",
          Alacak: "",
          "Belge Türü": "Makbuz",
          "Belge No": `M${fisNo}`,
        },
        {
          "Fiş Numarası": String(fisNo),
          "Fiş Tarihi": date,
          "Fiş Açıklama": aciklama,
          "Detay Açıklama": `${aciklama} alacak-a`,
          "Hesap Kodu": "120.01",
          Borç: "",
          Alacak: "55,00",
          "Belge Türü": "Makbuz",
          "Belge No": `M${fisNo}`,
        },
        {
          "Fiş Numarası": String(fisNo),
          "Fiş Tarihi": date,
          "Fiş Açıklama": aciklama,
          "Detay Açıklama": `${aciklama} alacak-b`,
          "Hesap Kodu": "340.01",
          Borç: "",
          Alacak: "45,00",
          "Belge Türü": "Makbuz",
          "Belge No": `M${fisNo}`,
        }
      );
    }
  }

  assert.equal(rows.length, 558);
  assert.equal(new Set(rows.map((r) => r["Fiş Numarası"])).size, 174);
  return rows;
}

test("Elektra preview: 558 rows / 174 balanced vouchers", () => {
  const rows = buildElektraFixtureRows();
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Elektra");

  const companyA = "company-tenant-a";
  const result = processElektrawebWorkbook(workbook, {
    firmaId: companyA,
    kaynakAdi: "ELEKTRAWEB",
    role: "admin",
    isAdmin: true,
    isManagementUser: true,
    accountPlan: [
      { hesapKodu: "100.01", hesapAdi: "Kasa" },
      { hesapKodu: "102.01", hesapAdi: "Banka" },
      { hesapKodu: "120.01", hesapAdi: "Alıcılar" },
      { hesapKodu: "320.01", hesapAdi: "Satıcılar" },
      { hesapKodu: "340.01", hesapAdi: "Alınan Depozito" },
      { hesapKodu: "391.01", hesapAdi: "Hesaplanan KDV" },
    ],
  });

  assert.equal(result.toplamSatir, 558);
  assert.equal(result.toplamFis, 174);
  assert.equal(result.dengeliFis, 174);
  assert.equal(result.dengesizFis, 0);
  assert.equal(result.standardLucaRows.length, 558);
  assert.ok(result.standardLucaRows.every((r) => r.firmaId === companyA));
});

test("Luca Excel export: headers + row count", () => {
  const rows = buildElektraFixtureRows();
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Elektra");
  const result = processElektrawebWorkbook(workbook, {
    firmaId: "company-tenant-a",
    kaynakAdi: "ELEKTRAWEB",
  });

  const excelRows = standardLucaRowsToExcelRows(result.standardLucaRows);
  assert.equal(excelRows.length, 558);
  assert.deepEqual(Object.keys(excelRows[0]), LUCA_EXPORT_HEADERS);
  assert.ok(excelRows.every((r) => r["Fiş No"]));
  assert.ok(excelRows.some((r) => Number(r.Borç) > 0 || Number(r.Alacak) > 0 || r.Borç || r.Alacak));

  const outSheet = XLSX.utils.json_to_sheet(excelRows);
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outSheet, "Luca Fiş");
  const buf = XLSX.write(outWb, { type: "buffer", bookType: "xlsx" });
  assert.ok(Buffer.isBuffer(buf) || buf?.byteLength > 0 || buf?.length > 0);
});

test("tenant isolation: strip client privilege claims + keep firmaId", () => {
  const routeSrc = fs.readFileSync(path.join(root, "app/api/elektraweb/route.ts"), "utf8");
  assert.match(routeSrc, /delete matchingContext\.role/);
  assert.match(routeSrc, /delete matchingContext\.isAdmin/);
  assert.match(routeSrc, /delete matchingContext\.isManagementUser/);
  assert.match(routeSrc, /requireApiSession/);

  const rows = buildElektraFixtureRows().slice(0, 3);
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Elektra");

  const tenantA = processElektrawebWorkbook(workbook, {
    firmaId: "tenant-a",
    role: "admin",
    isAdmin: true,
  });
  const tenantB = processElektrawebWorkbook(workbook, {
    firmaId: "tenant-b",
    role: "admin",
    isAdmin: true,
  });

  assert.ok(tenantA.standardLucaRows.every((r) => r.firmaId === "tenant-a"));
  assert.ok(tenantB.standardLucaRows.every((r) => r.firmaId === "tenant-b"));
  assert.notEqual(tenantA.standardLucaRows[0].firmaId, tenantB.standardLucaRows[0].firmaId);
});

restoreEnv();

for (const { name, fn } of __queue) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  console.error("\nElektraweb CSRF/preview: FAILED");
} else {
  console.log("\nElektraweb CSRF/preview: ALL PASSED");
}
