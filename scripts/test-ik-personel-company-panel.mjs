/**
 * Firma Yönetimi İK sekmeleri (IkPersonelCompanyPanel) regresyon testi.
 *
 * - Panelde kullanılan her IK_* sabiti import edilmiş olmalı (eksik import → ReferenceError → error boundary).
 * - Beş görünüm (personnel, movements, leaves, sgk, risks) boş, dolu ve bozuk veriyle çökmeden render olmalı.
 * - Bir firmanın hareket/izin kayıtları başka firmada görünmemeli.
 *
 * Yalnız sentetik veri kullanır; ağ ve gerçek localStorage yoktur.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const panelPath = path.join(root, "src", "components", "IkPersonelCompanyPanel.jsx");

const MOVEMENTS_KEY = "annvero_ik_personel_movements_v1";
const LEAVES_KEY = "annvero_ik_personel_leaves_v1";
const PROFILES_KEY = "annvero_ik_personel_profiles_v1";
const VIEWS = ["personnel", "movements", "leaves", "sgk", "risks"];

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await test("panelde kullanılan her IK_* sabiti import edilmiş", () => {
  const source = fs.readFileSync(panelPath, "utf8");
  const importBlock = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)]
    .map((match) => match[1])
    .join(",");
  const imported = new Set(importBlock.split(",").map((name) => name.trim()).filter(Boolean));
  const body = source.replace(/import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/g, "");
  const used = new Set(body.match(/\bIK_[A-Z0-9_]+\b/g) || []);
  const missing = [...used].filter((name) => !imported.has(name));
  assert.deepEqual(missing, [], `import edilmemiş sabitler: ${missing.join(", ")}`);
});

const stubPlugin = {
  name: "ik-panel-stubs",
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(root, args.path.slice(2));
      for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}.ts`, `${base}.tsx`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return { path: candidate };
      }
      return undefined;
    });
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "stub" }));
    build.onResolve({ filter: /ikPersonelExcel$/ }, () => ({ path: "ik-excel", namespace: "stub" }));
    build.onLoad({ filter: /^next-link$/, namespace: "stub" }, () => ({
      contents:
        'import { createElement } from "react"; export default function Link({ href, children, onClick, ...rest }) { return createElement("a", { href, ...rest }, children); }',
      loader: "js",
      resolveDir: root,
    }));
    build.onLoad({ filter: /^ik-excel$/, namespace: "stub" }, () => ({
      contents:
        "export function downloadIkPersonelTemplate() {} export async function parseIkPersonelExcelFile() { return []; }",
      loader: "js",
    }));
  },
};

const cacheDir = path.join(root, "node_modules", ".cache");
fs.mkdirSync(cacheDir, { recursive: true });
const outDir = fs.mkdtempSync(path.join(cacheDir, "ik-panel-test-"));
const outfile = path.join(outDir, "panel.mjs");
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [panelPath],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".js": "jsx", ".jsx": "jsx" },
  external: ["react", "react-dom", "react/jsx-runtime"],
  plugins: [stubPlugin],
  logLevel: "error",
});

const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: IkPersonelCompanyPanel } = await import(pathToFileURL(outfile).href);

function render(props) {
  return renderToStaticMarkup(createElement(IkPersonelCompanyPanel, { setCompany: () => {}, ...props }));
}

function resetStorage(entries = {}) {
  store.clear();
  for (const [key, value] of Object.entries(entries)) store.set(key, value);
}

const companyA = {
  id: "company-a",
  companyName: "Sentetik A",
  employees: [
    { id: "emp-1", fullName: "Test Personel Bir", hireDate: "2020-01-15", department: "Muhasebe", position: "Uzman", isActive: true },
    { id: "emp-2", fullName: "Test Personel İki", hireDate: "01.03.2024", isActive: false },
  ],
};
const companyB = { id: "company-b", companyName: "Sentetik B", employees: [] };

const filledStorage = {
  [MOVEMENTS_KEY]: JSON.stringify([
    { id: "mv-a", companyId: "company-a", employeeId: "emp-1", employeeName: "Test Personel Bir", type: "İşe giriş", effectiveDate: "2020-01-15" },
    { id: "mv-b", companyId: "company-b", employeeId: "emp-x", employeeName: "Diğer Firma Personeli", type: "İşten çıkış", effectiveDate: "2025-01-01" },
  ]),
  [LEAVES_KEY]: JSON.stringify([
    { id: "lv-a", companyId: "company-a", employeeId: "emp-1", employeeName: "Test Personel Bir", type: "Yıllık izin", startDate: "2026-01-05", endDate: "2026-01-06", days: 2, usedDays: 2 },
    { id: "lv-b", companyId: "company-b", employeeId: "emp-x", employeeName: "Diğer Firma İzni", type: "Yıllık izin", startDate: "2026-02-01", endDate: "2026-02-01", days: 1 },
  ]),
};

for (const view of VIEWS) {
  await test(`${view}: boş firma verisiyle çökmez`, () => {
    resetStorage();
    const html = render({ company: { ...companyB }, view });
    assert.ok(html.length > 0);
  });
}

await test("movements: boş veride empty-state ve hareket türleri listelenir", () => {
  resetStorage();
  const html = render({ company: companyB, view: "movements" });
  assert.match(html, /Hareket kaydı yok\./);
  assert.match(html, /<option value="İşe giriş"/);
  assert.match(html, /<option value="Yıllık izin"/);
});

await test("leaves: boş veride çökmez ve İzin Ekle görünür", () => {
  resetStorage();
  const html = render({ company: companyB, view: "leaves" });
  assert.match(html, /İzin Ekle/);
});

await test("personnel: çalışma türleri seçenekleri render edilir", () => {
  resetStorage();
  const html = render({ company: companyA, view: "personnel" });
  assert.match(html, /Test Personel Bir/);
  assert.match(html, /<option value="Tam zamanlı"/);
});

await test("movements/leaves: dolu veride yalnız aktif firmanın kayıtları görünür", () => {
  resetStorage(filledStorage);
  const movementsHtml = render({ company: companyA, view: "movements" });
  assert.match(movementsHtml, /Test Personel Bir · 2020-01-15/);
  assert.doesNotMatch(movementsHtml, /Diğer Firma Personeli/);

  const leavesHtml = render({ company: companyA, view: "leaves" });
  assert.match(leavesHtml, /Kullanılan: 2/);
  assert.doesNotMatch(leavesHtml, /Diğer Firma İzni/);
});

await test("firma değişiminde önceki firmanın kayıtları görünmez", () => {
  resetStorage(filledStorage);
  const movementsHtml = render({ company: companyB, view: "movements" });
  assert.match(movementsHtml, /Diğer Firma Personeli/);
  assert.doesNotMatch(movementsHtml, /Test Personel Bir/);

  const leavesHtml = render({ company: companyB, view: "leaves" });
  assert.match(leavesHtml, /Diğer Firma İzni/);
  assert.doesNotMatch(leavesHtml, /Test Personel Bir/);
});

const brokenStorages = {
  "null": "null",
  "obje": "{}",
  "bozuk JSON": "{not json",
  "null/primitive eleman": JSON.stringify([null, 5, "x", { id: "mv-ok", companyId: "company-a", type: "Rapor" }]),
};
for (const [label, raw] of Object.entries(brokenStorages)) {
  for (const view of VIEWS) {
    await test(`${view}: localStorage ${label} olsa da çökmez`, () => {
      resetStorage({ [MOVEMENTS_KEY]: raw, [LEAVES_KEY]: raw, [PROFILES_KEY]: raw });
      render({ company: companyA, view });
    });
  }
}

const brokenCompanies = {
  "employees null": { id: "company-a", employees: null },
  "employees obje": { id: "company-a", employees: {} },
  "null/eksik alanlı personel": {
    id: "company-a",
    employees: [null, undefined, 7, { id: "emp-n" }, { id: "emp-m", fullName: null, hireDate: "geçersiz-tarih" }],
  },
};
for (const [label, company] of Object.entries(brokenCompanies)) {
  for (const view of VIEWS) {
    await test(`${view}: ${label} ile çökmez`, () => {
      resetStorage(filledStorage);
      render({ company, view });
    });
  }
}

for (const view of VIEWS) {
  await test(`${view}: firma null/seçilmemişken güvenli mesaj gösterir`, () => {
    resetStorage();
    assert.match(render({ company: null, view }), /önce firma seçin/);
    assert.match(render({ company: {}, view }), /önce firma seçin/);
  });
}

await test("sekmeler arasında art arda geçişte her görünüm render olur", () => {
  resetStorage(filledStorage);
  for (let round = 0; round < 3; round += 1) {
    for (const view of VIEWS) render({ company: round % 2 ? companyB : companyA, view });
  }
});

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\n${passed} test geçti.`);
