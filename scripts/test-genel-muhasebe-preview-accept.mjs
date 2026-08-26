#!/usr/bin/env node
/**
 * Preview browser acceptance — Genel Muhasebe Kontrol + real muavin_mare.xlsx.
 *
 * Auth: staging Supabase service role generates magic link (no password in repo).
 * Env: ../annvero-app/.env.staging.local
 *
 * Usage:
 *   node --import ./scripts/_alias-loader.mjs ./scripts/test-genel-muhasebe-preview-accept.mjs [previewOrigin]
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import {
  ANNVERO_KNOWN_PROJECT_REFS,
  extractSupabaseProjectRef,
} from "../src/lib/security/envGuard.js";

const EXPECTED_MIN_ROWS = 545;
const PERIOD = "2026/03";
const ADMIN_EMAIL = "yusufozlu@gmail.com";
const EXCEL_CANDIDATES = [
  resolve(process.env.USERPROFILE || "", "Desktop", "muavin_mare.xlsx"),
  resolve(process.env.USERPROFILE || "", "Downloads", "muavin_mare.xlsx"),
];

function loadEnvFile(filePath) {
  try {
    const raw = readFileSync(resolve(process.cwd(), filePath), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* ignore */
  }
}

loadEnvFile("../annvero-app/.env.staging.local");

const previewOrigin = String(
  process.argv[2] ||
    process.env.ANNVERO_PREVIEW_ORIGIN ||
    "https://annvero-staging-git-fix-luca-mu-8caf3b-yusufozlu-4225s-projects.vercel.app"
)
  .trim()
  .replace(/\/$/, "");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const projectRef = extractSupabaseProjectRef(supabaseUrl);
const excelPath = EXCEL_CANDIDATES.find((p) => existsSync(p));

if (!excelPath) {
  console.error("FAIL  muavin_mare.xlsx not found on Desktop/Downloads");
  process.exit(1);
}
if (!supabaseUrl || !serviceRole) {
  console.error("FAIL  staging Supabase env missing (.env.staging.local)");
  process.exit(1);
}
if (projectRef === ANNVERO_KNOWN_PROJECT_REFS.production) {
  console.error("FAIL  production Supabase ref blocked");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: ADMIN_EMAIL,
  options: {
    redirectTo: `${previewOrigin}/muhasebe/genel-muhasebe-kontrol`,
  },
});

if (linkError || !linkData?.properties?.action_link) {
  console.error("FAIL  magic link:", linkError?.message || "no action_link");
  process.exit(1);
}

const consoleLogs = [];
const networkErrors = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on("console", (msg) => {
  const text = msg.text();
  if (text.includes("[excel-sheet-read]") || text.includes("[genel-muhasebe-kontrol]")) {
    consoleLogs.push(text);
  }
});
page.on("pageerror", (err) => networkErrors.push(String(err.message || err)));
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("excelSheet.worker") && response.status() >= 400) {
    networkErrors.push(`worker ${response.status()} ${url}`);
  }
});

await page.goto(linkData.properties.action_link, { waitUntil: "networkidle", timeout: 120_000 });
await page.goto(`${previewOrigin}/muhasebe/genel-muhasebe-kontrol`, {
  waitUntil: "networkidle",
  timeout: 120_000,
});

if (page.url().includes("/login")) {
  console.error("FAIL  still on login after magic link");
  await browser.close();
  process.exit(1);
}

const companySelect = page.locator('select').first();
await companySelect.waitFor({ state: "visible", timeout: 30_000 });
const options = companySelect.locator("option");
const optionCount = await options.count();
let picked = false;
for (let i = 0; i < optionCount; i += 1) {
  const value = await options.nth(i).getAttribute("value");
  if (value) {
    await companySelect.selectOption(value);
    picked = true;
    break;
  }
}
assert.ok(picked, "company selected");

await page.getByPlaceholder("2026/05").fill(PERIOD);
await page.locator('input[type="file"]').first().setInputFiles(excelPath);

const startButton = page.getByRole("button", { name: /Kontrol/i });
await startButton.click();

await page.getByText("Toplam satır").waitFor({ state: "visible", timeout: 300_000 });

const errorBox = page.locator(".text-red-700");
if (await errorBox.count()) {
  const errText = await errorBox.first().textContent();
  console.error("FAIL  UI error:", errText);
  console.error("console:", consoleLogs.join("\n"));
  console.error("network:", networkErrors.join("\n"));
  await browser.close();
  process.exit(1);
}

const statCards = page.locator(".rounded-xl.border");
let toplamSatir = null;
const cardCount = await statCards.count();
for (let i = 0; i < cardCount; i += 1) {
  const label = await statCards.nth(i).locator(".text-xs").textContent();
  if (label?.includes("Toplam satır")) {
    toplamSatir = Number(await statCards.nth(i).locator(".text-sm.font-semibold").textContent());
    break;
  }
}

assert.ok(Number.isFinite(toplamSatir), "Toplam satır visible");
assert.ok(toplamSatir >= EXPECTED_MIN_ROWS, `Toplam satır >= ${EXPECTED_MIN_ROWS} (got ${toplamSatir})`);

const buildBadge = await page.locator("text=/build:/i").first().textContent().catch(() => "");
console.log(
  JSON.stringify(
    {
      previewOrigin,
      excelPath,
      toplamSatir,
      buildBadge: buildBadge || null,
      excelConsole: consoleLogs,
      workerNetworkErrors: networkErrors,
    },
    null,
    2
  )
);

await browser.close();
console.log("PASS  preview browser acceptance");
