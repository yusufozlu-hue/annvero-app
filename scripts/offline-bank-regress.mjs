#!/usr/bin/env node
/**
 * Offline bank decision engine regression (no UI).
 * Run: node --experimental-strip-types --import ./scripts/_alias-loader.mjs ./scripts/offline-bank-regress.mjs
 */
import * as XLSX from "xlsx";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { parseVakifbankEkstre } from "@/parsers/vakifbankParser.js";
import { parseGarantiEkstre } from "@/parsers/garantiParser.js";
import {
  filterActiveBankParsedRows,
  mapParsedRowsToStandardMovements,
  buildParserOnlyMovements,
} from "@/src/utils/bankMovementMapper.js";
import { buildLearningMemoryIndex } from "@/src/utils/bankMovementMapper.js";
import { bankaKurallari } from "@/parsers/bankaKurallari.js";
import { buildAccountPlanCodeSet, buildAccountPlanIndex } from "@/src/utils/accountPlanSuggestions.js";
import { buildCariMatchIndex } from "@/src/utils/cariAccountMatcher.js";

function buildMovementMappingContext(options = {}) {
  const companyPlans = options.companyPlans || [];
  const learningMemory = options.learningMemory || [];
  const selectedCompanyId = options.selectedCompanyId || "";
  const planIndex = options.planIndex || buildAccountPlanIndex(companyPlans);
  const cariIndex = options.cariIndex || buildCariMatchIndex(companyPlans);
  const learningMemoryIndex =
    options.learningMemoryIndex ||
    buildLearningMemoryIndex(learningMemory, selectedCompanyId);
  return {
    selectedCompany: options.selectedCompany,
    companyPlans,
    companyRules: options.companyRules,
    selectedBank: options.selectedBank,
    learningMemory,
    activeLearningMemory: learningMemoryIndex.active || [],
    learningMemoryIndex,
    accountingRules: options.accountingRules || [],
    selectedCompanyId,
    sourceFileName: options.sourceFileName,
    sourceType: options.sourceType || "bank",
    currency: options.currency || "TRY",
    legacyRules: bankaKurallari,
    planIndex,
    planCodeSet:
      options.planCodeSet || planIndex.codeSet || buildAccountPlanCodeSet(companyPlans),
    cariIndex,
  };
}
import {
  missingCategoryForTransactionType,
} from "@/src/utils/bankTransactionType.js";
import {
  analyzeMissingHesapRows,
  classifyMissingHesapCategory,
  MISSING_HESAP_CATEGORY,
} from "@/src/utils/previewExportValidation.js";
import { bankMovementsToStandardLucaRows } from "@/src/utils/standardLucaRow.js";

const BUCKET_LABELS = [
  "Cari bulunamadı",
  "POS",
  "Vergi/SGK",
  "Finans",
  "Personel",
  "Çek",
  "Kasa",
  "Diğer",
];

const VAKIF_BASELINE = { movements: 1416, missingTotalMin: 629, missingTotalMax: 648 };

function emptyBuckets() {
  return Object.fromEntries(BUCKET_LABELS.map((k) => [k, 0]));
}

function rollupBucket(rawLabel = "") {
  const label = String(rawLabel || "").trim();
  if (!label) return "Diğer";
  if (label === MISSING_HESAP_CATEGORY.CARI_BULUNAMADI || /cari bulunamad/i.test(label)) {
    return "Cari bulunamadı";
  }
  if (/pos/i.test(label)) return "POS";
  if (/vergi|sgk/i.test(label)) return "Vergi/SGK";
  if (/finans/i.test(label)) return "Finans";
  if (/personel/i.test(label)) return "Personel";
  if (/çek|cek|101\/103/i.test(label)) return "Çek";
  if (/kasa|100 eksik/i.test(label)) return "Kasa";
  return "Diğer";
}

function readSheetMatrix(filePath) {
  const wb = XLSX.read(readFileSync(filePath));
  return wb.SheetNames.map((sheetName) => ({
    sheetName,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" }),
  }));
}

function parseBankFile(filePath, bank) {
  const sheets = readSheetMatrix(filePath);
  let best = { count: 0, rows: [], sheetName: "" };
  for (const sheet of sheets) {
    try {
      const parsed =
        bank === "VAKIFBANK"
          ? parseVakifbankEkstre(sheet.rows)
          : parseGarantiEkstre(sheet.rows);
      const active = filterActiveBankParsedRows(parsed);
      if (active.length > best.count) {
        best = { count: active.length, rows: active, sheetName: sheet.sheetName };
      }
    } catch {
      // try next sheet
    }
  }
  if (!best.count) {
    throw new Error(`${bank} parse başarısız: ${filePath}`);
  }
  return best;
}

function loadCompanyPlansFromXlsx(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  const sheets = readSheetMatrix(filePath);
  const plans = [];
  for (const { rows } of sheets) {
    const headerIndex = rows.findIndex((row) =>
      (row || []).some((cell) => /HESAP\s*KODU/i.test(String(cell || "")))
    );
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map((c) => String(c || "").trim());
    const codeIdx = headers.findIndex((h) => /HESAP\s*KODU/i.test(h));
    const nameIdx = headers.findIndex((h) => /HESAP\s*ADI/i.test(h));
    if (codeIdx < 0) continue;
    for (const row of rows.slice(headerIndex + 1)) {
      const accountCode = String(row?.[codeIdx] || "").trim();
      if (!accountCode) continue;
      plans.push({
        accountCode,
        accountName: nameIdx >= 0 ? String(row?.[nameIdx] || "").trim() : "",
        isActive: true,
      });
    }
  }
  return plans;
}

function discoverFixturePlan() {
  const candidates = [
    "fixtures/company-plan-mare.json",
    "scripts/fixtures/company-plan-mare.json",
    "C:/Users/yusuf.ozlu/Downloads/hesap_plani_listesi_mare.xlsx",
    "C:/Users/yusuf.ozlu/Desktop/mare hesap planı.xlsx",
  ];
  for (const candidate of candidates) {
    const abs = candidate.includes(":")
      ? candidate
      : join(process.cwd(), candidate);
    if (!existsSync(abs)) continue;
    if (abs.endsWith(".json")) {
      try {
        const json = JSON.parse(readFileSync(abs, "utf8"));
        if (Array.isArray(json)) return { source: abs, plans: json };
        if (Array.isArray(json.companyPlans)) {
          return { source: abs, plans: json.companyPlans };
        }
      } catch {
        continue;
      }
    }
    if (abs.endsWith(".xlsx")) {
      const plans = loadCompanyPlansFromXlsx(abs);
      if (plans.length) return { source: abs, plans };
    }
  }
  return { source: null, plans: [] };
}

function walkXlsx(root, depth = 0, out = []) {
  if (depth > 6) return out;
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith("~$")) continue;
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!["node_modules", ".git", ".next", "annvero-app"].includes(name)) {
        walkXlsx(full, depth + 1, out);
      }
    } else if (/\.xlsx$/i.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function scoreVakifPath(path) {
  const u = path.toUpperCase();
  let score = 0;
  if (/MARE/.test(u)) score += 4;
  if (/VAKIF/.test(u)) score += 4;
  if (/8449/.test(u)) score += 4;
  if (/ÖRNEK|ORNEK/.test(u)) score += 2;
  if (/EKSTRE/.test(u)) score += 1;
  return score;
}

function discoverVakifFile(paths) {
  const ranked = [];
  for (const p of paths) {
    if (!/vakif|8449|VAKIFBANK/i.test(p)) continue;
    try {
      const parsed = parseBankFile(p, "VAKIFBANK");
      ranked.push({ path: p, ...parsed, score: scoreVakifPath(p) });
    } catch {
      // skip
    }
  }
  ranked.sort((a, b) => b.score - a.score || b.count - a.count);
  const preferred = ranked.find((r) => r.score >= 8) || ranked.find((r) => /ÖRNEK|ORNEK/.test(r.path)) || ranked[0];
  return preferred || null;
}

function discoverGarantiFile(paths) {
  const ranked = [];
  for (const p of paths) {
    if (!/garanti/i.test(p)) continue;
    try {
      const parsed = parseBankFile(p, "GARANTI");
      ranked.push({ path: p, ...parsed, delta57: Math.abs(parsed.count - 57) });
    } catch {
      // skip
    }
  }
  ranked.sort((a, b) => a.delta57 - b.delta57 || b.count - a.count);
  return ranked[0] || null;
}

function movementToPreviewRow(movement, index, context) {
  const lucaRows = bankMovementsToStandardLucaRows([movement], index + 1, {
    kaynakAdi: context.selectedBank,
    bankAccounts: context.selectedCompany?.bankAccounts || [],
  });
  const row = lucaRows[0] || {};
  return {
    ...row,
    transactionType: movement.transactionType,
    accountingScenario: movement.accountingScenario,
    cariRequired: movement.cariRequired,
    missingHesapCategory: movement.missingHesapCategory,
    detayAciklama: movement.description || row.detayAciklama,
    fisAciklama: movement.lucaDescription || row.fisAciklama,
    kontrolNotu: movement.warning || row.kontrolNotu,
    hesapKodu: movement.counterAccountCode || row.hesapKodu || "",
  };
}

function summarizeMovements(movements, context, totalAnalysisMs) {
  const buckets = emptyBuckets();
  let missingCounter = 0;

  for (const movement of movements) {
    if (!String(movement.counterAccountCode || "").trim()) {
      missingCounter += 1;
      const label =
        movement.missingHesapCategory ||
        missingCategoryForTransactionType(movement.transactionType);
      const bucket = rollupBucket(label);
      buckets[bucket] += 1;
    }
  }

  const previewRows = movements.map((m, i) => movementToPreviewRow(m, i, context));
  const missingAnalysis = analyzeMissingHesapRows(previewRows);
  const classifyBuckets = emptyBuckets();
  for (const row of missingAnalysis.missingRows) {
    const cat = classifyMissingHesapCategory(row);
    classifyBuckets[rollupBucket(cat)] += 1;
  }

  return {
    movementCount: movements.length,
    missingCounterAccountCode: missingCounter,
    missingByCategory: buckets,
    missingByCategoryClassify: classifyBuckets,
    missingHesapAnalysisCount: missingAnalysis.missingCount,
    totalAnalysisMs,
  };
}

function garantiDescriptionNotes(movements) {
  const gln = [];
  const gond = [];
  for (const m of movements) {
    const text = `${m.description || ""} ${m.lucaDescription || ""}`.toUpperCase();
    if (/GLN\.?\s*HVL/.test(text)) gln.push(m.lucaDescription || m.description);
    if (/GOND\.?\s*HVL|GÖND\.?\s*HVL/.test(text)) gond.push(m.lucaDescription || m.description);
  }
  return {
    glnHvlCount: gln.length,
    gondHvlCount: gond.length,
    glnSample: gln.slice(0, 3),
    gondSample: gond.slice(0, 3),
  };
}

function runBankCase({ label, filePath, bank, planInfo, company }) {
  const started = Date.now();
  const parsed = parseBankFile(filePath, bank);
  const parserOnly = buildParserOnlyMovements(parsed.rows, {
    selectedBank: bank,
    sourceFileName: basename(filePath),
  });
  const context = buildMovementMappingContext({
    selectedBank: bank,
    selectedCompany: company,
    companyPlans: planInfo.plans,
    companyRules: company?.accountingRules || {},
    sourceFileName: basename(filePath),
  });
  const movements = mapParsedRowsToStandardMovements(parsed.rows, context);
  const totalAnalysisMs = Date.now() - started;
  const summary = summarizeMovements(movements, context, totalAnalysisMs);

  const result = {
    bank: label,
    filePath,
    sheetName: parsed.sheetName,
    parsedRows: parsed.count,
    parserOnlyMovements: parserOnly.length,
    planSource: planInfo.source,
    planCount: planInfo.plans.length,
    ...summary,
  };

  if (bank === "GARANTI") {
    result.garanti = {
      movementCountNear57: Math.abs(summary.movementCount - 57) <= 3,
      ...garantiDescriptionNotes(movements),
    };
  }

  if (bank === "VAKIFBANK" && summary.movementCount === VAKIF_BASELINE.movements) {
    const totalMissing = summary.missingCounterAccountCode;
    result.baselineCompare = {
      expectedMovements: VAKIF_BASELINE.movements,
      expectedMissingRange: [VAKIF_BASELINE.missingTotalMin, VAKIF_BASELINE.missingTotalMax],
      actualMissing: totalMissing,
      withinBaseline:
        totalMissing >= VAKIF_BASELINE.missingTotalMin &&
        totalMissing <= VAKIF_BASELINE.missingTotalMax,
    };
  }

  return result;
}

function parseArgs(argv) {
  const args = { vakif: null, garanti: null, roots: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--vakif") args.vakif = argv[++i];
    else if (token === "--garanti") args.garanti = argv[++i];
    else if (token === "--root") args.roots.push(argv[++i]);
  }
  if (!args.roots.length) {
    args.roots = [
      "C:/Users/yusuf.ozlu/Desktop",
      "C:/Users/yusuf.ozlu/Downloads",
    ];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const allPaths = args.roots.flatMap((root) => walkXlsx(root));
  const planInfo = discoverFixturePlan();
  const company = {
    id: "mare-offline-regress",
    name: "Mare Deluxe Residence",
    bankAccounts: [
      { bankName: "VAKIFBANK", lucaCode: "102.01", currency: "TRY", isActive: true },
      { bankName: "GARANTI", lucaCode: "102.02", currency: "TRY", isActive: true },
    ],
    accountingRules: {},
  };

  const output = {
    generatedAt: new Date().toISOString(),
    planSource: planInfo.source,
    planCount: planInfo.plans.length,
    cases: [],
    filesNotFound: [],
    exitCode: 0,
  };

  const vakifPath = args.vakif || discoverVakifFile(allPaths)?.path || null;
  const garantiPath = args.garanti || discoverGarantiFile(allPaths)?.path || null;

  if (!vakifPath) {
    output.filesNotFound.push("VAKIFBANK");
  } else {
    try {
      output.cases.push(
        runBankCase({
          label: "VAKIFBANK",
          filePath: vakifPath,
          bank: "VAKIFBANK",
          planInfo,
          company,
        })
      );
    } catch (err) {
      output.cases.push({ bank: "VAKIFBANK", filePath: vakifPath, error: err.message });
      output.exitCode = 1;
    }
  }

  if (!garantiPath) {
    output.filesNotFound.push("GARANTI");
  } else {
    try {
      output.cases.push(
        runBankCase({
          label: "GARANTI",
          filePath: garantiPath,
          bank: "GARANTI",
          planInfo,
          company,
        })
      );
      const g = output.cases.at(-1);
      if (g.garanti && !g.garanti.movementCountNear57) {
        g.garanti.note = `movement count ${g.movementCount} (expected ~57)`;
      }
    } catch (err) {
      output.cases.push({ bank: "GARANTI", filePath: garantiPath, error: err.message });
      output.exitCode = 1;
    }
  }

  if (output.filesNotFound.length === output.cases.length && output.cases.every((c) => c.error)) {
    output.exitCode = 1;
  }

  console.log(JSON.stringify(output, null, 2));
  process.exit(output.exitCode);
}

main().catch((err) => {
  console.log(JSON.stringify({ fatal: err.message, exitCode: 1 }, null, 2));
  process.exit(1);
});


