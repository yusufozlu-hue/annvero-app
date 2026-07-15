/**
 * BANK_INTERNAL_TRANSFER / Virman motoru — kesin vs aday
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-internal-transfer.mjs
 */
import assert from "node:assert/strict";
import {
  BANK_INTERNAL_TRANSFER,
  VIRMAN_STATUS,
  VIRMAN_CANDIDATE_LABEL,
  detectAndClassifyBankInternalTransfer,
  evaluateOwnAccountVirmanTransfer,
  isProtectedFromVirmanReclass,
  isVirmanCandidateTransfer,
  resolveVirman102Pair,
} from "@/src/utils/bankInternalTransfer.js";
import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType.js";
import { resolveAccountingScenario } from "@/src/utils/bankAccountingScenarioEngine.js";
import {
  buildCariResolutionGroups,
  isCariMissingRow,
} from "@/src/utils/cariMissingResolutionGroups.js";
import {
  classifyMissingHesapCategory,
  MISSING_HESAP_CATEGORY,
} from "@/src/utils/previewExportValidation.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const OWN_IBAN = "TR330001500158000000000001";
const OTHER_OWN_IBAN = "TR440001000123000000000002";
const FOREIGN_IBAN = "TR110006400000011112223344";

function mareCompany() {
  return {
    companyName: "MARE RESORT OTEL AS",
    bankAccounts: [
      {
        bankName: "VAKIFBANK",
        iban: OWN_IBAN,
        accountNumber: "1580000001",
        lucaAccountCode: "102.01.001",
        isActive: true,
      },
      {
        bankName: "ZIRAAT",
        iban: OTHER_OWN_IBAN,
        accountNumber: "1230000002",
        lucaAccountCode: "102.02.001",
        isActive: true,
      },
    ],
  };
}

test("1) ekstre IBAN her satırda olsa bile virman kanıtı sayılmaz", () => {
  const company = mareCompany();
  const det = detectAndClassifyBankInternalTransfer({
    description: "Çay ödemesi tedarikçi",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    bankAccountCode: "102.01.001",
    rawRow: {
      aciklama: "Çay ödemesi tedarikçi",
      iban: OWN_IBAN,
      hesapNo: "1580000001",
    },
  });
  assert.equal(det.shouldReclassify, false);
  assert.equal(det.isVirmanCandidate, false);
});

test("2) maskeli IBAN + unvan → yalnız virman adayı", () => {
  const company = mareCompany();
  const det = detectAndClassifyBankInternalTransfer({
    description:
      "Sedat / TR33 0001 5001 58** **** **00 01 nolu MARE RESORT OTEL AS hesabından TR11 0006 4000 0001 1112 2233 44",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    bankAccountCode: "102.01.001",
  });
  assert.equal(det.shouldReclassify, false);
  assert.equal(det.isVirmanCandidate, true);
  assert.equal(det.pair.status, VIRMAN_STATUS.CANDIDATE);
});

test("3) tam karşı IBAN + company.bankAccounts → kesin virman 102↔102", () => {
  const company = mareCompany();
  const det = detectAndClassifyBankInternalTransfer({
    description: `GÖND. HVL / MARE RESORT OTEL AS ${OTHER_OWN_IBAN}`,
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    bankAccountCode: "102.01.001",
  });
  assert.equal(det.shouldReclassify, true);
  assert.equal(det.classification, BANK_INTERNAL_TRANSFER);
  assert.equal(det.transactionType, BANK_TRANSACTION_TYPE.BANKA_ICI_VIRMAN);
  assert.equal(det.pair.complete, true);
  assert.equal(det.pair.target102, "102.02.001");
});

test("4) karşı 102 yok → otomatik fiş / VIRMAN_HESAP_EKSIK yok", () => {
  const company = {
    companyName: "MARE RESORT OTEL AS",
    bankAccounts: [
      {
        bankName: "VAKIFBANK",
        iban: OWN_IBAN,
        lucaAccountCode: "102.01.001",
        isActive: true,
      },
      {
        bankName: "ZIRAAT",
        iban: OTHER_OWN_IBAN,
        lucaAccountCode: "", // 102 yok
        isActive: true,
      },
    ],
  };
  const det = detectAndClassifyBankInternalTransfer({
    description: `VIRMAN / ${OTHER_OWN_IBAN}`,
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    bankAccountCode: "102.01.001",
  });
  assert.equal(det.shouldReclassify, false);
  assert.equal(det.isVirmanCandidate, true);
  assert.equal(det.pair.complete, false);

  const scenario = resolveAccountingScenario({
    transactionType: BANK_TRANSACTION_TYPE.BANKA_ICI_VIRMAN,
    direction: "CIKIS",
    description: `VIRMAN / ${OTHER_OWN_IBAN}`,
    bankAccountCode: "102.01.001",
    company,
    bankName: "VAKIFBANK",
  });
  assert.equal(scenario.virmanCandidate, true);
  assert.equal(scenario.missingHesapCategory, "");
  assert.equal(scenario.legs, null);
  assert.equal(scenario.bankInternalTransfer, false);
});

test("5) unvan + foreign IBAN → müşteri korunur (virman değil)", () => {
  const company = mareCompany();
  const det = detectAndClassifyBankInternalTransfer({
    description: `GLN. HVL / MARE RESORT OTEL AS ${FOREIGN_IBAN}`,
    direction: "GIRIS",
    transactionType: "GELEN_HAVALE",
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    bankAccountCode: "102.01.001",
  });
  assert.equal(det.shouldReclassify, false);
  // Unvan + yabancı IBAN tek başına maskeli ekstre değilse aday da olmamalı
  // (açıklamada own masked yok)
  assert.equal(det.isVirmanCandidate, false);
});

test("6) masraf/BSMV korumalı", () => {
  assert.equal(
    isProtectedFromVirmanReclass(BANK_TRANSACTION_TYPE.BANKA_MASRAFI),
    true
  );
  const company = mareCompany();
  const det = detectAndClassifyBankInternalTransfer({
    description: `HAVALE MASRAF ${OTHER_OWN_IBAN}`,
    direction: "CIKIS",
    transactionType: BANK_TRANSACTION_TYPE.BANKA_MASRAFI,
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    bankAccountCode: "102.01.001",
  });
  assert.equal(det.shouldReclassify, false);
});

test("7) kesin virman cari merkezde yok; aday ayrı", () => {
  const company = mareCompany();
  const definite = {
    id: "def",
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    transactionType: "BANKA_ICI_VIRMAN",
    bankInternalTransfer: true,
    cariRequired: false,
    detayAciklama: `VIRMAN ${OTHER_OWN_IBAN}`,
    borc: 10,
    alacak: 0,
    analysisKey: "def|CIKIS",
  };
  // Complete pair would not be missing — simulate candidate with label
  const candidate = {
    id: "cand",
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    transactionType: "GIDEN_HAVALE",
    virmanCandidate: true,
    cariRequired: true,
    missingHesapCategory: "",
    detayAciklama: `TR33 0001 5001 58** **** **00 01 nolu MARE RESORT OTEL AS hesabından`,
    kontrolNotu: VIRMAN_CANDIDATE_LABEL,
    borc: 20,
    alacak: 0,
    analysisKey: "cand|CIKIS",
  };
  const cust = {
    id: "cust",
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
    transactionType: "GIDEN_HAVALE",
    cariRequired: true,
    missingHesapCategory: "Cari bulunamadı",
    detayAciklama: `GÖND / DIS TEDARIKCI ${FOREIGN_IBAN}`,
    borc: 30,
    alacak: 0,
    analysisKey: "cust|CIKIS",
  };

  assert.equal(
    classifyMissingHesapCategory(candidate),
    MISSING_HESAP_CATEGORY.VIRMAN_ADAY
  );
  assert.equal(isVirmanCandidateTransfer(candidate, { selectedCompany: company }), true);
  assert.equal(isCariMissingRow(candidate, { selectedCompany: company }), false);

  const snap = buildCariResolutionGroups(
    [candidate, cust],
    { selectedCompany: company, selectedBank: "VAKIFBANK" },
    { initialCandidateGroups: false }
  );
  assert.equal(snap.groupCount, 1);
  assert.ok(snap.groups.every((g) => g.id.includes("cust")));
  assert.ok(snap.virmanCandidateCount >= 1);
});

test("8) karsiIban yapılandırılmış alan ile kesin virman", () => {
  const company = mareCompany();
  const det = detectAndClassifyBankInternalTransfer({
    description: "GÖND. HVL / hesaplar arası",
    direction: "CIKIS",
    transactionType: "GIDEN_HAVALE",
    selectedCompany: company,
    selectedBank: "VAKIFBANK",
    bankAccountCode: "102.01.001",
    rawRow: {
      aciklama: "GÖND. HVL / hesaplar arası",
      iban: OWN_IBAN,
      karsiIban: OTHER_OWN_IBAN,
    },
  });
  assert.equal(det.shouldReclassify, true);
  assert.equal(det.pair.complete, true);
});

test("9) yalnız unvan yetersiz", () => {
  const company = mareCompany();
  const v = evaluateOwnAccountVirmanTransfer(
    { detayAciklama: "GÖND. HVL / MARE RESORT OTEL AS fatura" },
    { selectedCompany: company, selectedBank: "VAKIFBANK" }
  );
  assert.equal(v.status, VIRMAN_STATUS.NONE);
  assert.equal(v.isVirmanCandidate, false);
});

console.log("\nAll bank internal transfer tests passed.");
