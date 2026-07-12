/**
 * Smoke test: bank transaction type + accounting scenario + policy layer.
 * Run: node --experimental-strip-types --import ./scripts/_alias-loader.mjs ./scripts/smoke-accounting-scenario.mjs
 */
import { resolveBankTransactionType } from "@/src/utils/bankTransactionType.js";
import {
  resolveAccountingScenario,
  resolveCompanyAccountingPolicies,
} from "@/src/utils/bankAccountingScenarioEngine.js";
import {
  classifyMissingHesapCategory,
  MISSING_HESAP_CATEGORY,
} from "@/src/utils/previewExportValidation.js";

const plans = [
  { accountCode: "103.01", accountName: "OCAK VERILEN CEKLER", isActive: true },
  { accountCode: "101.01", accountName: "ALINAN CEKLER", isActive: true },
  { accountCode: "100.01", accountName: "KASA", isActive: true },
  { accountCode: "108.01", accountName: "POS HESABI", isActive: true },
  { accountCode: "102.01", accountName: "GARANTI TL", isActive: true },
  { accountCode: "120.01", accountName: "ABC LTD", isActive: true },
  { accountCode: "320.01", accountName: "XYZ AS", isActive: true },
];

const POS_TYPES = /^POS_/;
const DOVIZ_TYPES = /^DOVIZ_/;

let failed = 0;

function fail(name, message) {
  console.log(`FAIL  ${name}: ${message}`);
  failed += 1;
}

function pass(name) {
  console.log(`PASS  ${name}`);
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertOneOf(actual, allowed, label) {
  if (!allowed.includes(actual)) {
    throw new Error(`${label}: expected one of ${allowed.join("|")}, got ${JSON.stringify(actual)}`);
  }
}

function assertStartsWith(value, prefix, label) {
  const s = String(value || "");
  if (!s.startsWith(prefix)) {
    throw new Error(`${label}: expected to start with ${prefix}, got ${JSON.stringify(s)}`);
  }
}

function runTypeScenarioCase(name, { description, direction, typeExpect, typeOneOf, scenarioOneOf, cariRequired, counterPrefix, policies, transactionTypeOverride }) {
  try {
    const typeResult = transactionTypeOverride
      ? { transactionType: transactionTypeOverride, cariRequired: null }
      : resolveBankTransactionType(description, direction);

    const transactionType = typeResult.transactionType;
    if (typeExpect) assertEq(transactionType, typeExpect, "transactionType");
    if (typeOneOf) assertOneOf(transactionType, typeOneOf, "transactionType");
    if (typeOneOf?.some((t) => POS_TYPES.test(t)) || POS_TYPES.test(transactionType)) {
      if (!POS_TYPES.test(transactionType)) {
        throw new Error(`transactionType: expected POS_*, got ${transactionType}`);
      }
    }
    if (typeOneOf?.some((t) => DOVIZ_TYPES.test(t)) || (typeExpect && DOVIZ_TYPES.test(typeExpect))) {
      if (!DOVIZ_TYPES.test(transactionType)) {
        throw new Error(`transactionType: expected DOVIZ_*, got ${transactionType}`);
      }
    }

    if (cariRequired !== undefined && typeResult.cariRequired !== null) {
      assertEq(typeResult.cariRequired, cariRequired, "type.cariRequired");
    }

    const scenario = resolveAccountingScenario({
      transactionType,
      direction,
      description,
      companyPlans: plans,
      companyPolicies: policies || {},
      bankAccountCode: "102.01",
      date: "01.03.2026",
    });

    if (scenarioOneOf) assertOneOf(scenario.scenarioId, scenarioOneOf, "scenarioId");
    if (cariRequired !== undefined) {
      assertEq(scenario.cariRequired, cariRequired, "scenario.cariRequired");
    }
    if (counterPrefix) {
      assertStartsWith(scenario.counterAccountCode, counterPrefix, "counterAccountCode");
    }

    pass(name);
  } catch (err) {
    fail(name, err.message || String(err));
  }
}

console.log("=== smoke-accounting-scenario ===\n");

runTypeScenarioCase("CEK ODEMESI / CIKIS", {
  description: "CEK ODEMESI",
  direction: "CIKIS",
  typeExpect: "CEK_ODEMESI",
  scenarioOneOf: ["CEK_ODEMESI"],
  cariRequired: false,
  counterPrefix: "103",
});

runTypeScenarioCase("CEK TAHSILATI / GIRIS", {
  description: "CEK TAHSILATI",
  direction: "GIRIS",
  typeExpect: "CEK_TAHSILATI",
  scenarioOneOf: ["CEK_TAHSILATI"],
  cariRequired: false,
  counterPrefix: "101",
});

runTypeScenarioCase("ALINAN CEK / GIRIS", {
  description: "ALINAN CEK",
  direction: "GIRIS",
  typeExpect: "CEK_TAHSILATI",
  scenarioOneOf: ["CEK_TAHSILATI"],
  cariRequired: false,
  counterPrefix: "101",
});

runTypeScenarioCase("KASADAN YATAN / GIRIS", {
  description: "KASADAN YATAN",
  direction: "GIRIS",
  typeExpect: "KASA_BANKAYA_YATAN",
  scenarioOneOf: ["KASA_BANKAYA_YATAN"],
  cariRequired: false,
  counterPrefix: "100",
});

runTypeScenarioCase("BANKADAN KASAYA / CIKIS", {
  description: "BANKADAN KASAYA",
  direction: "CIKIS",
  typeExpect: "BANKADAN_KASAYA_CEKILEN",
  scenarioOneOf: ["BANKADAN_KASAYA_CEKILEN"],
  cariRequired: false,
  counterPrefix: "100",
});

runTypeScenarioCase("POS BATCH TAHSILATI / GIRIS", {
  description: "POS BATCH TAHSILATI",
  direction: "GIRIS",
  typeOneOf: ["POS_BATCH_TAHSILAT"],
  scenarioOneOf: ["POS_BATCH_TAHSILAT"],
  cariRequired: false,
  counterPrefix: "108",
});

runTypeScenarioCase("GOND. HVL / XYZ / CIKIS", {
  description: "GOND. HVL XYZ",
  direction: "CIKIS",
  typeOneOf: ["GIDEN_HAVALE", "TEDARIKCI_ODEME"],
  scenarioOneOf: ["GIDEN_HAVALE", "TEDARIKCI_ODEME"],
  cariRequired: true,
});

runTypeScenarioCase("GLN. HVL / ABC / GIRIS", {
  description: "GLN. HVL ABC",
  direction: "GIRIS",
  typeOneOf: ["GELEN_HAVALE", "MUSTERI_TAHSILAT"],
  scenarioOneOf: ["GELEN_HAVALE", "MUSTERI_TAHSILAT"],
  cariRequired: true,
});

runTypeScenarioCase("SGK PRIM / CIKIS", {
  description: "SGK PRIM",
  direction: "CIKIS",
  typeExpect: "SGK",
  scenarioOneOf: ["VERGI_SGK"],
  cariRequired: false,
});

runTypeScenarioCase("DOVIZ ALIS USD / CIKIS", {
  description: "DOVIZ ALIS USD",
  direction: "CIKIS",
  typeOneOf: ["DOVIZ_ALIS"],
  scenarioOneOf: ["DOVIZ"],
  cariRequired: false,
});

try {
  const policies = resolveCompanyAccountingPolicies({ useGivenChecksAccount: false });
  const scenario = resolveAccountingScenario({
    transactionType: "CEK_ODEMESI",
    direction: "CIKIS",
    description: "CEK ODEMESI",
    companyPlans: plans,
    companyPolicies: policies,
    bankAccountCode: "102.01",
    date: "01.03.2026",
  });
  assertEq(scenario.policyBlocked, true, "policyBlocked");
  assertEq(scenario.cariRequired, false, "cariRequired");
  pass("Policy useGivenChecksAccount:false blocks CEK ODEMESI");
} catch (err) {
  fail("Policy useGivenChecksAccount:false blocks CEK ODEMESI", err.message || String(err));
}

try {
  const cat = classifyMissingHesapCategory({
    transactionType: "CEK_ODEMESI",
    accountingScenario: "CEK_ODEMESI",
    hesapKodu: "",
    detayAciklama: "CEK ODEMESI",
  });
  assertEq(cat, MISSING_HESAP_CATEGORY.CEK_HESAP_EKSIK, "missing category");
  pass("classifyMissingHesapCategory CEK without hesap");
} catch (err) {
  fail("classifyMissingHesapCategory CEK without hesap", err.message || String(err));
}

console.log(`\n=== ${failed === 0 ? "ALL PASSED" : `${failed} FAILED`} ===`);
process.exit(failed === 0 ? 0 : 1);
