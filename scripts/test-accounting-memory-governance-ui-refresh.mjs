/**
 * Faz 7 UI hotfix — governance mutation sonrası üst/alt snapshot senkronizasyonu.
 * Run: node --test ./scripts/test-accounting-memory-governance-ui-refresh.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const panel = fs.readFileSync(
  path.join(root, "app/(annvero)/muhasebe/components/AccountMemoryV2Panel.jsx"),
  "utf8"
);
const page = fs.readFileSync(
  path.join(root, "app/(annvero)/muhasebe/ogrenen-hafiza/page.jsx"),
  "utf8"
);

test("deactivate/reactivate/rollback/resolve success ortak parent refresh kullanır", () => {
  for (const action of ["deactivate", "reactivate", "resolve", "rollback"]) {
    assert.match(panel, new RegExp(`type === "${action}"`));
  }
  assert.equal((panel.match(/onMemoryChanged\(\{ companyId, action, result \}\)/g) || []).length, 1);
  assert.match(panel, /await refreshAfterMutation\(\{[\s\S]*action: type,[\s\S]*result/);
});

test("parent callback alt listeyi yeniler; özet aynı records snapshot'ından türetilir", () => {
  assert.match(page, /onMemoryChanged=\{handleGovernanceMutationComplete\}/);
  assert.match(
    page,
    /const handleGovernanceMutationComplete = useCallback\([\s\S]*await loadRecords\(\)/
  );
  assert.match(page, /const stats = useMemo\(\(\) => getLearningMemoryStats\(records\)/);
  assert.match(page, /filterLearningMemoryRows\(records/);
});

test("mutation fail parent refresh veya sahte başarı üretmez", () => {
  const actionIndex = panel.indexOf("const runConfirmedAction = async");
  const failIndex = panel.indexOf("if (!result.ok)", actionIndex);
  const successRefreshIndex = panel.indexOf("await refreshAfterMutation");
  assert.ok(failIndex >= 0 && successRefreshIndex > failIndex);
  const failBlock = panel.slice(failIndex, successRefreshIndex);
  assert.doesNotMatch(failBlock, /onMemoryChanged/);
  assert.match(failBlock, /showToast\(formatGovernanceMutationError\(result\), "error"\)/);
});

test("stale fetch ve firma A→B cevabı yeni ekranı ezmez", () => {
  assert.match(page, /gen !== loadGenRef\.current/);
  assert.match(page, /loadGenRef\.current \+= 1/);
  assert.match(
    page,
    /if \(!companyId \|\| companyId !== currentCompanyId\) return/
  );
  assert.match(
    panel,
    /!mountedRef\.current \|\| companyIdRef\.current !== companyId/
  );
  assert.match(
    panel,
    /companyIdRef\.current !== mutationCompanyId/
  );
});

test("unmount sonrası state update ve hızlı çift tıklama korunur", () => {
  assert.match(panel, /mountedRef\.current = false/);
  assert.match(panel, /if \(mountedRef\.current\) setBusyId\(""\)/);
  assert.match(
    panel,
    /if \(!confirmAction \|\| busyId \|\| !firmId \|\| mutatingRef\.current\) return/
  );
  assert.match(panel, /mutatingRef\.current = true/);
  assert.match(panel, /disabled=\{Boolean\(busyId\)\}/);
});

test("üst ve alt refresh server başarısından sonra birlikte başlar", () => {
  assert.match(
    panel,
    /await Promise\.all\(\[[\s\S]*loadForCompany\(companyId\)[\s\S]*onMemoryChanged/
  );
  const actionIndex = panel.indexOf("const runConfirmedAction = async");
  const okGuard = panel.indexOf("if (!result.ok)", actionIndex);
  const refresh = panel.indexOf("await refreshAfterMutation");
  assert.ok(refresh > okGuard);
});

test("aktif ve pasif satırlarda revision aynı Sürüm sütununda görünür", () => {
  assert.match(panel, /<th className="px-2 py-2">Sürüm<\/th>/);
  assert.match(panel, /<td className="whitespace-nowrap px-2 py-2 font-mono">\s*r\{record\.revision\}/);
  assert.doesNotMatch(panel, /tab === "history"[\s\S]{0,120}r\{record\.revision\}/);
  assert.match(panel, /colSpan=\{10\}/);
});
