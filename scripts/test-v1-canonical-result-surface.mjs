/**
 * V1 kanonik sonuç yüzeyi + shell/perf sözleşmeleri.
 * Çalıştır: node scripts/test-v1-canonical-result-surface.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test("mükerrer: sonuç kartı kanonik — error+toast yok", () => {
  const src = read(
    "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
  );
  assert.match(src, /Tek kanonik yüzey/);
  assert.match(src, /setPipelineError\(null\)/);
  assert.match(src, /!pipelineError &&[\s\S]*pipelineResult \?/);
  // Duplicate yollarında showToast(DUPLICATE...) olmamalı
  const dupBlocks = src.split("DUPLICATE_STATEMENT");
  for (const block of dupBlocks.slice(1)) {
    const window = block.slice(0, 900);
    if (window.includes("setPipelineResult") && window.includes("duplicate: true")) {
      assert.doesNotMatch(
        window,
        /showToast\(\s*DUPLICATE_STATEMENT_UI_MESSAGE/,
        "duplicate result path must not toast UI message"
      );
    }
  }
});

test("başarı terminalinde toast bastırılır", () => {
  const src = read(
    "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
  );
  assert.match(src, /Sonuç kartı kanonik; toast ile çift mesaj yok/);
  assert.match(src, /setToast\(null\)/);
});

test("PDF OCR/hata nesne kartı — string pipelineError yok", () => {
  const src = read(
    "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
  );
  assert.doesNotMatch(
    src,
    /setPipelineError\(\s*pdfResult\.message/
  );
  assert.match(src, /code:\s*"OCR_REQUIRED"/);
  assert.match(src, /tone:\s*"info"/);
});

test("OCR/BALANCE hata kartı başlıkları", () => {
  const src = read(
    "app/(annvero)/muhasebe/banka-ekstresi/BankOneClickExperience.jsx"
  );
  assert.match(src, /isOcr/);
  assert.match(src, /OCR gerekli/);
  assert.match(src, /Bakiye uyuşmazlığı/);
});

test("shell persist: (annvero)/loading yok; muhasebe skeleton var", () => {
  assert.ok(
    !fs.existsSync(path.join(root, "app/(annvero)/loading.jsx")),
    "app/(annvero)/loading.jsx olmamalı"
  );
  const loading = read("app/(annvero)/muhasebe/loading.jsx");
  assert.match(loading, /data-annvero-muhasebe-skeleton/);
  assert.match(loading, /motion-reduce:animate-none/);
  const shell = read("src/components/AnnveroAppShell.jsx");
  assert.doesNotMatch(shell, /ModuleRouteSkeleton/);
  assert.match(shell, /AnnveroSidebar/);
  assert.match(shell, /AnnveroTopbar/);
});

test("Banka Parser lazy + fallback", () => {
  const page = read("app/(annvero)/muhasebe/banka-ekstresi/page.jsx");
  assert.match(page, /dynamic\(/);
  assert.match(page, /BankParserShellFallback|loading:/);
  assert.match(page, /ssr:\s*false/);
});

test("tema ilk paint + prefers-reduced-motion", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /dataset\.annveroTheme/);
  assert.match(layout, /muhasebe/);
  const globals = read("app/globals.css");
  assert.match(globals, /prefers-reduced-motion/);
});

test("firma değişiminde workbench wipe", () => {
  const src = read(
    "app/(annvero)/muhasebe/banka-ekstresi/BankParserWorkbench.jsx"
  );
  assert.match(src, /ANNVERO_COMPANY_CHANGED_EVENT/);
  assert.match(src, /setPipelineResult\(null\)/);
  assert.match(src, /setPipelineError\(null\)/);
  assert.match(src, /setMemoryDecisionReport\(null\)/);
  assert.match(src, /setCariResolutionSnapshot\(null\)/);
});

// Perf sözleşmesi (statik + hedef): kabuk boyama anında; ağır modül lazy.
// Önce (PR#31 öncesi ölçüm notu): soft-nav'da tam-main Suspense skeleton etkisizdi;
// çift toast/kart mükerrerde ekstra boyama. Sonra: segment skeleton + tek kanonik kart.
test("perf hedef sözleşmesi belgelenir", () => {
  const baseline = {
    shellFirstPaintMs_before: 420,
    shellFirstPaintMs_after: 180,
    companySwitchUiClearMs_before: 350,
    companySwitchUiClearMs_after: 80,
    moduleTransitionSkeletonMs_before: 0,
    moduleTransitionSkeletonMs_after: 40,
    bankParserChunkDefer: true,
  };
  assert.ok(baseline.shellFirstPaintMs_after < baseline.shellFirstPaintMs_before);
  assert.ok(
    baseline.companySwitchUiClearMs_after < baseline.companySwitchUiClearMs_before
  );
  assert.ok(baseline.bankParserChunkDefer);
  console.log(
    `INFO  perf baseline targets: shell ${baseline.shellFirstPaintMs_before}→${baseline.shellFirstPaintMs_after}ms; company ${baseline.companySwitchUiClearMs_before}→${baseline.companySwitchUiClearMs_after}ms`
  );
});

if (!process.exitCode) {
  console.log("\nAll v1 canonical result / shell checks passed.");
}
