/**
 * MARE otomatik hesap eşleme testi.
 * Run:
 *   node --import ./scripts/_alias-loader.mjs ./scripts/test-mare-account-auto-detect.mjs
 * Optional plan path:
 *   MARE_PLAN="C:\\Users\\yusuf.ozlu\\Desktop\\mare hesap planı.xlsx"
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import {
  MAPPING_STATUS,
  bootstrapCompanyAccountMappings,
  resolveMappedAccountFromCompany,
} from "@/src/utils/companyAccountAutoDetect.js";
import { resolveAccountingScenario } from "@/src/utils/bankAccountingScenarioEngine.js";
import { ACCOUNTING_SCENARIO } from "@/src/utils/bankAccountingScenarioEngine.js";

const DEFAULT_PLAN = path.join(
  process.env.USERPROFILE || "",
  "Desktop",
  "mare hesap planı.xlsx"
);
const PLAN_PATH = process.env.MARE_PLAN || DEFAULT_PLAN;

const MARE_SIGNALS = {
  bankName: "VAKIFBANK",
  iban: "TR820001500158007308428449",
  accountNumber: "00158007308428449",
  posMerchantNo: "57700001130449",
  posNo: "01670904",
  cardLast4List: ["4682", "6725"],
};

const EXPECT = [
  {
    label: "BEACH KASA",
    code: "100.10.003",
    statusOneOf: [MAPPING_STATUS.AUTO_APPLIED],
  },
  {
    label: "OTEL KASA",
    code: "100.01.010",
    statusOneOf: [MAPPING_STATUS.AUTO_APPLIED],
  },
  {
    labelIncludes: "ANA BANKA",
    code: "102.10.V001",
    statusOneOf: [MAPPING_STATUS.AUTO_APPLIED, MAPPING_STATUS.NEEDS_APPROVAL],
  },
  {
    labelIncludes: "VERILEN CEK",
    bankHint: "VAKIF",
    code: "103.01.002",
    statusOneOf: [MAPPING_STATUS.AUTO_APPLIED, MAPPING_STATUS.NEEDS_APPROVAL],
  },
  {
    label: "SGK",
    code: "361.01.001",
    statusOneOf: [MAPPING_STATUS.AUTO_APPLIED, MAPPING_STATUS.NEEDS_APPROVAL],
  },
  {
    label: "POS TAHSILAT",
    codesOneOf: ["108.01.027", "108.01.028"],
    statusOneOf: [
      MAPPING_STATUS.NEEDS_APPROVAL,
      MAPPING_STATUS.CONFLICT,
      MAPPING_STATUS.AUTO_APPLIED,
    ],
    requireCandidates: ["108.01.027", "108.01.028"],
  },
  {
    label: "KK 4682",
    code: "309.01.001",
    statusOneOf: [MAPPING_STATUS.AUTO_APPLIED],
  },
  {
    label: "KK 6725",
    statusOneOf: [MAPPING_STATUS.MISSING, MAPPING_STATUS.NEEDS_APPROVAL],
    allowEmptyCode: true,
  },
];

function loadPlan(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Plan bulunamadı: ${filePath}`);
  }
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return rows
    .map((row, idx) => {
      const accountCode = String(row[0] || "").trim();
      const accountName = String(row[1] || "").trim();
      const currency = String(row[2] || "TL").trim() || "TL";
      if (!accountCode || !accountName) return null;
      return {
        id: `row-${idx}`,
        accountCode,
        accountName,
        currency,
        isActive: true,
      };
    })
    .filter(Boolean);
}

function findMapping(mappings, rule) {
  return mappings.find((m) => {
    if (rule.label && m.label === rule.label) return true;
    if (rule.labelIncludes && String(m.label).includes(rule.labelIncludes)) {
      if (rule.bankHint) {
        return String(m.label).toUpperCase().includes(rule.bankHint);
      }
      return true;
    }
    return false;
  });
}

let failed = 0;
function pass(msg) {
  console.log(`PASS  ${msg}`);
}
function fail(msg) {
  console.log(`FAIL  ${msg}`);
  failed += 1;
}

const started = Date.now();
console.log(`MARE plan: ${PLAN_PATH}`);
const plan = loadPlan(PLAN_PATH);
console.log(`Plan satır: ${plan.length}`);

const { mappings, summary, scan } = bootstrapCompanyAccountMappings({
  accountPlan: plan,
  signals: MARE_SIGNALS,
  company: { name: "MARE", id: "mare-test" },
});

console.log("\n=== ÖZET ===");
console.log(
  JSON.stringify(
    {
      autoApplied: summary.autoApplied,
      needsApproval: summary.needsApproval,
      missing: summary.missing,
      conflict: summary.conflict,
      total: summary.total,
      elapsedMs: summary.elapsedMs,
      planAccountCount: summary.planAccountCount,
      scannedGroups: Object.fromEntries(
        Object.entries(scan.byGroup || {}).map(([k, v]) => [k, v.length])
      ),
    },
    null,
    2
  )
);

console.log("\n=== ADAYLAR ===");
for (const m of mappings) {
  console.log(
    [
      m.status.padEnd(16),
      String(m.confidence).padStart(3),
      (m.recommendedAccountCode || "-").padEnd(14),
      m.label.padEnd(28),
      m.reason.slice(0, 80),
    ].join(" | ")
  );
}

console.log("\n=== BEKLENTİ KONTROL ===");
for (const rule of EXPECT) {
  const m = findMapping(mappings, rule);
  const name = rule.label || rule.labelIncludes || "?";
  if (!m) {
    fail(`${name}: mapping yok`);
    continue;
  }
  if (!rule.statusOneOf.includes(m.status)) {
    fail(`${name}: status=${m.status}, expected ${rule.statusOneOf.join("|")}`);
  } else {
    pass(`${name}: status=${m.status} conf=${m.confidence}`);
  }
  if (rule.code) {
    if (m.recommendedAccountCode !== rule.code) {
      fail(`${name}: code=${m.recommendedAccountCode}, expected ${rule.code}`);
    } else {
      pass(`${name}: code=${m.recommendedAccountCode}`);
    }
  }
  if (rule.codesOneOf) {
    if (!rule.codesOneOf.includes(m.recommendedAccountCode) && !rule.allowEmptyCode) {
      // onay kuyruğunda top candidate biri olmalı
      const candCodes = (m.candidates || []).map((c) => c.accountCode);
      const hit = rule.codesOneOf.some((c) => candCodes.includes(c));
      if (!hit && !rule.codesOneOf.includes(m.recommendedAccountCode)) {
        fail(`${name}: candidates missing ${rule.codesOneOf.join("/")}`);
      } else {
        pass(`${name}: candidates include expected POS accounts`);
      }
    } else {
      pass(`${name}: top=${m.recommendedAccountCode || "-"}`);
    }
  }
  if (rule.requireCandidates) {
    const candCodes = (m.candidates || []).map((c) => c.accountCode);
    const ok = rule.requireCandidates.every((c) => candCodes.includes(c));
    if (!ok) fail(`${name}: requireCandidates ${rule.requireCandidates.join(",")}`);
    else pass(`${name}: dual POS candidates present`);
  }
  if (rule.allowEmptyCode && !m.recommendedAccountCode) {
    pass(`${name}: eşleşme yok (beklenen)`);
  }
}

// Karar motoru bağlantısı (otomatik alanlar company fields'a uygulandıktan sonra)
const { applyMappingsToCompanyFields } = await import(
  "@/src/utils/companyAccountAutoDetect.js"
);
const company = applyMappingsToCompanyFields(
  { id: "mare-test", name: "MARE" },
  mappings
);

const beach = resolveMappedAccountFromCompany(company, {
  scenarioType: ACCOUNTING_SCENARIO.KASA_BANKAYA_YATAN,
  description: "TARİHLİ BEACH KASA YATIRISI",
});
if (beach.accountCode === "100.10.003") pass(`engine Beach → ${beach.accountCode}`);
else fail(`engine Beach → ${beach.accountCode || "yok"}`);

const cek = resolveAccountingScenario({
  transactionType: "CEK_ODEMESI",
  direction: "CIKIS",
  description: "CEK ODEME",
  company,
  bankName: "VAKIFBANK",
  companyPlans: plan,
});
if (cek.counterAccountCode === "103.01.002" || cek.counterAccountCode?.startsWith("103")) {
  pass(`engine CEK_ODEMESI → ${cek.counterAccountCode} (src=${cek.mappingSource || "plan"})`);
} else {
  fail(`engine CEK_ODEMESI → ${cek.counterAccountCode || "yok"}`);
}

const elapsed = Date.now() - started;
console.log(`\nSüre: ${elapsed}ms`);
console.log(failed === 0 ? "\nALL PASSED" : `\nFAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
