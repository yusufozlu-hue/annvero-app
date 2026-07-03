import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_LABEL = "docker-playwright";
export const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.61.1-jammy";

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_PROOF_PATH = join(__dirname, "..", "build-proof.json");

let cachedDiagnostics = null;

function readBuildProof() {
  try {
    const raw = readFileSync(BUILD_PROOF_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      builder: "unknown",
      proof: "build-proof.json missing — image may not be Docker-built",
      from: null,
    };
  }
}

async function runChromiumLaunchTest() {
  if (process.env.GIB_AUTOMATION_MOCK === "1") {
    return {
      ok: true,
      skipped: true,
      reason: "GIB_AUTOMATION_MOCK=1",
    };
  }

  const startedAt = Date.now();

  try {
    const { chromium } = await import("playwright");
    const executablePath = chromium.executablePath();

    const browser = await chromium.launch({
      headless: process.env.GIB_PLAYWRIGHT_HEADLESS !== "0",
    });
    await browser.close();

    return {
      ok: true,
      executablePath,
      launched: true,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    let executablePath = null;
    try {
      const { chromium } = await import("playwright");
      executablePath = chromium.executablePath();
    } catch {
      executablePath = null;
    }

    return {
      ok: false,
      executablePath,
      launched: false,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
    };
  }
}

export async function collectRuntimeDiagnostics({ refreshLaunchTest = false } = {}) {
  if (cachedDiagnostics && !refreshLaunchTest) {
    return cachedDiagnostics;
  }

  const buildProof = readBuildProof();
  const launchTest = await runChromiumLaunchTest();

  let playwrightVersion = null;
  try {
    playwrightVersion = require("playwright/package.json").version;
  } catch {
    playwrightVersion = null;
  }

  const diagnostics = {
    ok: launchTest.ok,
    service: "gib-automation",
    verified: launchTest.ok && buildProof.builder === "DOCKERFILE",
    runtime: RUNTIME_LABEL,
    image: PLAYWRIGHT_IMAGE,
    deploy: {
      builder: buildProof.builder || "DOCKERFILE",
      dockerfile: "Dockerfile",
      proof: buildProof.proof || `Built from ${PLAYWRIGHT_IMAGE}`,
      from: buildProof.from || PLAYWRIGHT_IMAGE,
      builtAt: buildProof.builtAt || null,
      gitCommit: buildProof.gitCommit || null,
    },
    playwright: {
      version: playwrightVersion,
      browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || null,
      skipBrowserDownload: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1",
      executablePath: launchTest.executablePath || null,
      launchTest,
    },
    node: process.version,
    commit:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT ||
      buildProof.gitCommit ||
      "local",
    startedAt: new Date().toISOString(),
  };

  cachedDiagnostics = diagnostics;
  return diagnostics;
}

export function logStartupDiagnostics(diagnostics) {
  const lines = [
    "============================================================",
    "[gib-automation] startup diagnostics",
    `runtime: ${diagnostics.runtime}`,
    `image: ${diagnostics.image}`,
    `deploy.builder: ${diagnostics.deploy.builder}`,
    `deploy.proof: ${diagnostics.deploy.proof}`,
    `deploy.from: ${diagnostics.deploy.from}`,
    `playwright.version: ${diagnostics.playwright.version || "unknown"}`,
    `playwright.browsersPath: ${diagnostics.playwright.browsersPath || "unknown"}`,
    `playwright.executablePath: ${diagnostics.playwright.executablePath || "unknown"}`,
    `playwright.launchTest.ok: ${diagnostics.playwright.launchTest.ok}`,
    `playwright.launchTest.error: ${diagnostics.playwright.launchTest.error || "none"}`,
    `verified: ${diagnostics.verified}`,
    "============================================================",
  ];

  for (const line of lines) {
    console.log(line);
  }
}
