/**
 * Banka parser worker sonucuna ana thread'de NFT + dashboard ekler.
 * Worker bundle'ına bankCardOpsCenter / recognition pipeline çekilmez.
 */

import { buildRecognizedFinancialTransactions } from "@/src/utils/financialRecognitionPipeline";
import { buildBankCardOpsDashboard } from "@/src/utils/bankCardOpsCenter";
import { resolveParserName } from "@/src/utils/financialSourceArchitecture";
import { toPersistedFinancialTransaction } from "@/src/models/normalizedFinancialTransaction";

/**
 * Worker sonucuna ops merkezi yan çıktısını güvenli şekilde ekler.
 * Hata olursa eski preview alanları korunur.
 */
export function buildBankCardOpsSideOutput(result = {}, context = {}) {
  const meta = result.opsMeta || {};
  const selectedBank = context.selectedBank || meta.selectedBank || "";
  const selectedCompanyId =
    context.selectedCompanyId || meta.selectedCompanyId || "";
  const sourceFileName = context.sourceFileName || meta.sourceFileName || "";
  const sourceFileType = context.sourceFileType || meta.sourceFileType || "xlsx";
  const sourceType = context.sourceType || meta.sourceType || "bank";

  try {
    const financialTransactions = buildRecognizedFinancialTransactions({
      normalizedBankRows: result.normalizedRows || [],
      movementRows: result.movementRows || [],
      context: {
        companyId: selectedCompanyId,
        selectedCompanyId,
        selectedBank,
        sourceName: selectedBank,
        sourceType,
        sourceFileName,
        sourceFileType,
        parserName:
          meta.parserName || resolveParserName(selectedBank, sourceType),
        learningMemory: context.learningMemory || [],
        accountingRules: context.accountingRules || [],
        companyRules: context.companyRules || {},
      },
    }).map((tx) => toPersistedFinancialTransaction(tx));

    const opsDashboard = buildBankCardOpsDashboard(financialTransactions, {
      companyId: selectedCompanyId,
      bankName: selectedBank,
      sourceFileName,
    });

    return {
      ...result,
      financialTransactions,
      opsDashboard,
    };
  } catch (error) {
    console.error("[bankCardOpsSideOutput] side output failed", error);
    return {
      ...result,
      financialTransactions: [],
      opsDashboard: null,
      opsSideOutputError: error?.message || String(error),
    };
  }
}
