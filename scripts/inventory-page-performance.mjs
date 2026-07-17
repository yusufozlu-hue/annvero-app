/**
 * Statik ANNVERO route performans envanteri (kaynak düzeyi).
 * Çalıştır: node scripts/inventory-page-performance.mjs
 *
 * Ölçüm: page + 1 seviye relative/@/app|@/src component import boyutu + risk bayrakları.
 * Runtime süre ölçmez; diğer sayfaları değiştirmez.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROUTES = [
  ["Dashboard", "/dashboard", "app/(annvero)/dashboard/page.tsx"],
  ["Firma Yönetimi", "/muhasebe/firma-yonetimi", "app/(annvero)/muhasebe/firma-yonetimi/page.jsx"],
  ["Hesap Planı", "/muhasebe/hesap-plani", "app/(annvero)/muhasebe/hesap-plani/page.jsx"],
  ["Kural Motoru", "/muhasebe/kural-motoru", "app/(annvero)/muhasebe/kural-motoru/page.jsx"],
  ["Banka Parser", "/muhasebe/banka-ekstresi", "app/(annvero)/muhasebe/banka-ekstresi/page.jsx"],
  ["Fiş Üretim / Dönüştürme", "/muhasebe/fis-donusturme", "app/(annvero)/muhasebe/fis-donusturme/page.jsx"],
  ["Luca Dönüştürücü", "/muhasebe/luca-donusturucu", "app/(annvero)/muhasebe/luca-donusturucu/page.jsx"],
  ["Fiş Kontrol Merkezi", "/muhasebe/fis-kontrol", "app/(annvero)/muhasebe/fis-kontrol/page.jsx"],
  ["Banka & Kart Operasyon", "/muhasebe/banka-kart-operasyon", "app/(annvero)/muhasebe/banka-kart-operasyon/page.jsx"],
  ["Banka Mutabakat", "/muhasebe/banka-mutabakat", "app/(annvero)/muhasebe/banka-mutabakat/page.jsx"],
  ["Mali Yükümlülük", "/muhasebe/mali-yukumluluk", "app/(annvero)/muhasebe/mali-yukumluluk/page.jsx"],
  ["Beyanname / Tahakkuk", "/muhasebe/beyanname-tahakkuk", "app/(annvero)/muhasebe/beyanname-tahakkuk/page.jsx"],
  ["Poliçe Giderleştirme", "/muhasebe/police-giderlestirme", "app/(annvero)/muhasebe/police-giderlestirme/page.jsx"],
  ["E-Defter Kontrol", "/muhasebe/e-defter-kontrol", "app/(annvero)/muhasebe/e-defter-kontrol/page.jsx"],
  ["Luca Aktarım Kontrol", "/muhasebe/luca-aktarim-kontrol", "app/(annvero)/muhasebe/luca-aktarim-kontrol/page.jsx"],
  ["Adat Hesaplama", "/muhasebe/adat-hesaplama", "app/(annvero)/muhasebe/adat-hesaplama/page.jsx"],
  ["Kur Değerleme", "/muhasebe/kur-degerleme", "app/(annvero)/muhasebe/kur-degerleme/page.jsx"],
  ["Finansman Gider", "/muhasebe/finansman-gider-kisitlamasi", "app/(annvero)/muhasebe/finansman-gider-kisitlamasi/page.jsx"],
  ["Personel / İK", "/ik-personel", "app/ik-personel/page.jsx"],
  ["Ticaret Sicil", "/ticaret-sicil", "app/ticaret-sicil/page.jsx"],
  ["Resmi Bildirimler", "/dashboard/ofis-takip/resmi-bildirimler", "app/(annvero)/dashboard/ofis-takip/resmi-bildirimler/page.jsx"],
  ["Hesaplama Araçları", "/platform/hesaplama-araclari", "app/(annvero)/platform/hesaplama-araclari/page.jsx"],
  ["Maaş Hesaplama", "/platform/hesaplama-araclari/maas-hesaplama", "app/(annvero)/platform/hesaplama-araclari/maas-hesaplama/page.jsx"],
  ["Öğrenen Hafıza", "/muhasebe/ogrenen-hafiza", "app/(annvero)/muhasebe/ogrenen-hafiza/page.jsx"],
  ["İşlem Hafızası", "/muhasebe/islem-hafizasi", "app/(annvero)/muhasebe/islem-hafizasi/page.jsx"],
  ["Risk Denetim", "/muhasebe/risk-denetim-merkezi", "app/(annvero)/muhasebe/risk-denetim-merkezi/page.jsx"],
  ["AI Kontrol", "/muhasebe/ai-kontrol", "app/(annvero)/muhasebe/ai-kontrol/page.jsx"],
  ["AI Ofis Asistanı", "/ai-ofis-asistani", "app/(annvero)/ai-ofis-asistani/page.jsx"],
  ["Otomasyon", "/otomasyon", "app/(annvero)/otomasyon/page.jsx"],
  ["ElektraWeb", "/muhasebe/elektraweb", "app/(annvero)/muhasebe/elektraweb/page.tsx"],
  ["KDV Matrah", "/muhasebe/kdv-matrah-kontrol", "app/(annvero)/muhasebe/kdv-matrah-kontrol/page.jsx"],
  ["Toplu Kıdem İhbar", "/muhasebe/toplu-kidem-ihbar", "app/(annvero)/muhasebe/toplu-kidem-ihbar/page.jsx"],
];

const HEAVY = [
  [/xlsx|file-saver|jszip|jspdf|exceljs|pdf-lib/i, "export-lib"],
  [/bankParserCore/, "bank-parser-core"],
  [/employeeExcel|exportStandardLucaExcel|readSheetRows|XLSX/, "excel-util"],
  [/taxObligation/, "tax-obligation"],
  [/beyannameTahakkuk|beyanname/, "beyanname-engine"],
  [/OCR|tesseract|pdfjs/i, "ocr-pdf"],
  [/recharts|chart\.js|from ["']d3/i, "charts"],
  [/localStorage|sessionStorage|indexedDB/i, "storage-read"],
  [/fetchCompanies\(/, "fetch-companies"],
  [/useOptionalCompanyWorkspace|useCompanyWorkspace|CompanyWorkspaceContext/, "workspace-hook"],
  [/useCompanyList/, "company-list-hook"],
  [/next\/dynamic|dynamic\(/, "has-dynamic"],
  [/ssr:\s*false/, "ssr-false"],
];

function resolveImport(fromFile, spec) {
  let rel;
  if (spec.startsWith("@/")) rel = spec.slice(2);
  else if (spec.startsWith(".")) {
    rel = path.join(path.dirname(fromFile), spec).replace(/\\/g, "/");
  } else return null;

  for (const ext of ["", ".jsx", ".js", ".tsx", ".ts", "/index.jsx", "/index.js"]) {
    const candidate = rel + ext;
    const abs = path.join(root, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate.replace(/\\/g, "/");
  }
  return null;
}

function analyzePage(label, href, pagePath) {
  const abs = path.join(root, pagePath);
  if (!fs.existsSync(abs)) {
    return { label, href, pagePath, missing: true, score: 0, priority: "Düşük", risks: ["missing"] };
  }

  const src = fs.readFileSync(abs, "utf8");
  const pageBytes = fs.statSync(abs).size;
  const pageLines = src.split(/\n/).length;
  const flags = {};
  for (const [re, key] of HEAVY) flags[key] = re.test(src);

  const localImports = [];
  const importRe = /from\s+["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(src))) {
    const resolved = resolveImport(pagePath, m[1]);
    if (!resolved) continue;
    if (!resolved.startsWith("app/") && !resolved.startsWith("src/")) continue;
    // Skip tiny design tokens / nav / pure config to reduce noise
    if (
      /annveroDesign|annveroNavConfig|annveroCoreFlags|companyNormalize|companies\.js$/.test(
        resolved
      )
    ) {
      continue;
    }
    const childAbs = path.join(root, resolved);
    const st = fs.statSync(childAbs);
    const childSrc = fs.readFileSync(childAbs, "utf8");
    localImports.push({
      path: resolved,
      bytes: st.size,
      lines: childSrc.split(/\n/).length,
      hasDynamic: /dynamic\(/.test(childSrc),
      exportLib: /xlsx|file-saver|jszip/i.test(childSrc),
      storage: /localStorage|sessionStorage/.test(childSrc),
      fetchCompanies: /fetchCompanies\(/.test(childSrc),
      workspace:
        /CompanyWorkspace|useOptionalCompanyWorkspace|useCompanyList|useCompanyWorkspace/.test(
          childSrc
        ),
    });
    for (const [re, key] of HEAVY) {
      if (re.test(childSrc)) flags[key] = true;
    }
  }

  const childBytes = localImports.reduce((a, c) => a + c.bytes, 0);
  const childLines = localImports.reduce((a, c) => a + c.lines, 0);
  const maxChild =
    localImports.slice().sort((a, b) => b.bytes - a.bytes)[0] || null;
  const shellLike =
    /dynamic\(/.test(src) &&
    pageBytes < 9000 &&
    /Hazırlanıyor|loading:/.test(src);

  let score = 0;
  const risks = [];
  const payload = pageBytes + childBytes;
  if (payload > 120_000) {
    score += 4;
    risks.push("very-large-payload");
  } else if (payload > 80_000) {
    score += 3;
    risks.push("large-payload");
  } else if (payload > 40_000) {
    score += 2;
    risks.push("medium-payload");
  }

  if (!flags["has-dynamic"] && payload > 25_000) {
    score += 2;
    risks.push("no-code-split");
  }
  if (flags["export-lib"] || flags["excel-util"]) {
    score += 2;
    risks.push("export-static");
  }
  if (
    flags["bank-parser-core"] ||
    flags["tax-obligation"] ||
    flags["beyanname-engine"] ||
    flags["ocr-pdf"]
  ) {
    score += 2;
    risks.push("heavy-engine-static");
  }
  const hasWorkspace =
    flags["workspace-hook"] ||
    flags["company-list-hook"] ||
    localImports.some((i) => i.workspace);
  if (flags["fetch-companies"] && !hasWorkspace) {
    score += 1;
    risks.push("refetch-companies-risk");
  }
  if (flags["storage-read"]) {
    score += 1;
    risks.push("storage-in-module-graph");
  }
  if (flags["charts"]) {
    score += 1;
    risks.push("charts");
  }
  if (shellLike) {
    score -= 3;
    risks.push("thin-shell-applied");
  }

  let priority = "Düşük";
  if (score >= 6) priority = "Kritik";
  else if (score >= 4) priority = "Yüksek";
  else if (score >= 2) priority = "Orta";

  return {
    label,
    href,
    pagePath,
    pageBytes,
    pageLines,
    childCount: localImports.length,
    childBytes,
    childLines,
    payloadKB: Math.round(payload / 1024),
    maxChild: maxChild
      ? {
          path: maxChild.path,
          kb: Math.round(maxChild.bytes / 1024),
          lines: maxChild.lines,
          hasDynamic: maxChild.hasDynamic,
        }
      : null,
    shellLike,
    flags,
    risks,
    score,
    priority,
  };
}

const rows = ROUTES.map(([l, h, p]) => analyzePage(l, h, p));
rows.sort((a, b) => b.score - a.score || b.payloadKB - a.payloadKB);

const byPriority = { Kritik: [], Yüksek: [], Orta: [], Düşük: [] };
for (const r of rows) byPriority[r.priority].push(r);

console.log("ANNVERO Page Performance Inventory (static)\n");
for (const p of ["Kritik", "Yüksek", "Orta", "Düşük"]) {
  console.log(`\n=== ${p} (${byPriority[p].length}) ===`);
  for (const r of byPriority[p]) {
    const child = r.maxChild
      ? ` max=${r.maxChild.path}(${r.maxChild.kb}KB${r.maxChild.hasDynamic ? "+dyn" : ""})`
      : "";
    console.log(
      `- ${r.label} ${r.href} | ${r.payloadKB}KB page+1hop | score=${r.score} | ${r.risks.join(",")}${child}`
    );
  }
}

const outPath = path.join(root, "scripts", "inventory-page-performance.json");
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
console.log(`\nJSON: ${outPath}`);
