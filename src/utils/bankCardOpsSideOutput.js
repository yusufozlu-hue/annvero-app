/**
 * Banka parser sonucuna ana thread'de NFT + Muhasebe Karar Motoru + dashboard ekler.
 * Worker bundle'ına çekilmez; Excel/parser akışını bozmaz.
 */

import { buildRecognizedFinancialTransactions } from "@/src/utils/financialRecognitionPipeline";
import { applyAccountingDecisionsToTransactions } from "@/src/utils/accountingDecisionEngine";
import { buildBankCardOpsDashboard } from "@/src/utils/bankCardOpsCenter";
import { resolveParserName } from "@/src/utils/financialSourceArchitecture";
import { toPersistedFinancialTransaction } from "@/src/models/normalizedFinancialTransaction";

/**
 * Ana thread yan çıktı: NFT tanıma + Muhasebe Karar Motoru.
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

  const decisionContext = {
    companyId: selectedCompanyId,
    selectedCompanyId,
    selectedBank,
    sourceName: selectedBank,
    sourceType,
    sourceFileName,
    sourceFileType,
    parserName: meta.parserName || resolveParserName(selectedBank, sourceType),
    learningMemory: context.learningMemory || [],
    accountingRules: context.accountingRules || [],
    companyRules: context.companyRules || {},
  };

  try {
    // 1) Temel NFT + tanıma
    let financialTransactions = buildRecognizedFinancialTransactions({
      normalizedBankRows: result.normalizedRows || [],
      movementRows: result.movementRows || [],
      context: decisionContext,
    });

    // 2) Muhasebe Karar Motoru: Memory → Rule → AI(stub) → Manual
    financialTransactions = applyAccountingDecisionsToTransactions(
      financialTransactions,
      decisionContext
    ).map((tx) => toPersistedFinancialTransaction(tx));

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
