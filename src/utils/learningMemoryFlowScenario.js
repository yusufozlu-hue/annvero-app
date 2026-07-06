import { applyLearningMemoryToStandardLucaRows } from "@/src/utils/bankLearningMemory";
import { applySmartBankSuggestionsToRows } from "@/src/utils/bankSmartSuggestions";
import {
  collectUnrecognizedFromStandardRows,
  extractTransactionKeyword,
} from "@/src/utils/transactionMemoryEngine";
import { finalizeStandardLucaRow, KAYNAK_TIPI } from "@/src/utils/standardLucaRow";

export const LEARNING_MEMORY_TEST_DESCRIPTION = "TEST MARKET POS KOMISYON";

function buildScenarioRow(overrides = {}) {
  return finalizeStandardLucaRow({
    id: "test-market-pos-komisyon",
    firmaId: "test-company",
    kaynakTipi: KAYNAK_TIPI.BANKA,
    kaynakAdi: "VAKIFBANK",
    fisNo: "1",
    fisTarihi: "06.07.2026",
    fisAciklama: LEARNING_MEMORY_TEST_DESCRIPTION,
    detayAciklama: LEARNING_MEMORY_TEST_DESCRIPTION,
    belgeTuru: "",
    hesapKodu: "",
    hesapAdi: "",
    borc: 100,
    alacak: 0,
    riskDurumu: "HESAP_EKSIK",
    ...overrides,
  });
}

export function runLearningMemoryFlowScenario() {
  const firstRows = applySmartBankSuggestionsToRows([buildScenarioRow()], {
    companyPlans: [],
    selectedBank: "VAKIFBANK",
    selectedCompanyId: "test-company",
  });
  const firstUnknown = collectUnrecognizedFromStandardRows(firstRows, {
    companyId: "test-company",
    sourceModule: "banka",
    sourceBank: "VAKIFBANK",
  });

  const learnedMemory = [
    {
      id: "memory-test-market-pos-komisyon",
      company_id: "test-company",
      bank_name: "VAKIFBANK",
      keyword: extractTransactionKeyword(LEARNING_MEMORY_TEST_DESCRIPTION),
      raw_description: LEARNING_MEMORY_TEST_DESCRIPTION,
      clean_description: LEARNING_MEMORY_TEST_DESCRIPTION,
      account_code: "760",
      account_name: "Pazarlama Satış Dağıtım Giderleri",
      document_type: "DK",
      cari_name: "TEST MARKET",
      transaction_type: KAYNAK_TIPI.BANKA,
      status: "active",
    },
  ];

  const learnedRows = applyLearningMemoryToStandardLucaRows(
    [buildScenarioRow()],
    learnedMemory,
    {
      firmaId: "test-company",
      kaynakTipi: KAYNAK_TIPI.BANKA,
      kaynakAdi: "VAKIFBANK",
    }
  );
  const afterLearnUnknown = collectUnrecognizedFromStandardRows(learnedRows, {
    companyId: "test-company",
    sourceModule: "banka",
    sourceBank: "VAKIFBANK",
  });

  return {
    description: LEARNING_MEMORY_TEST_DESCRIPTION,
    firstLoadUnknownCount: firstUnknown.length,
    learnedAccountCode: learnedRows[0]?.hesapKodu || "",
    learnedMemoryMatchCount: learnedRows.filter((row) => row.memory_match).length,
    secondLoadUnknownCount: afterLearnUnknown.length,
    highConfidenceMatches: learnedRows.filter(
      (row) => row.memory_match && Number(row.confidence_score || 0) >= 85
    ).length,
  };
}
