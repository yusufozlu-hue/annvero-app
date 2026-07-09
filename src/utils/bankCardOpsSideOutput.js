/**
 * Banka parser sonucuna ana thread'de NFT + Muhasebe Karar Motoru + dashboard ekler.
 * Worker bundle'ına çekilmez; Excel/parser akışını bozmaz.
 */

import { buildRecognizedFinancialTransactions } from "@/src/utils/financialRecognitionPipeline";
import { applyAccountingDecisionsToTransactions } from "@/src/utils/accountingDecisionEngine";
import { isAnnveroCoreEnabled } from "@/src/config/annveroCoreFlags";
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

    // 2) Muhasebe Karar Motoru — CORE etkinse movement'tan gelen karar korunur
    if (!isAnnveroCoreEnabled()) {
      financialTransactions = applyAccountingDecisionsToTransactions(
        financialTransactions,
        decisionContext
      );
    } else {
      financialTransactions = financialTransactions.map((tx, index) => {
        const movement = (result.movementRows || [])[index];
        if (!movement?._coreMatched) {
          return applyAccountingDecisionsToTransactions([tx], decisionContext)[0];
        }
        const confidencePct = Math.round((movement._coreConfidence || 0) * 100);
        return {
          ...tx,
          confidence_score: confidencePct,
          suggested_account_name:
            tx.suggested_account_name || movement._coreSuggestedAccountName || null,
          suggested_document_type:
            tx.suggested_document_type || movement.documentType || "DK",
          suggested_description:
            tx.suggested_description || movement.lucaDescription || tx.description_raw,
          suggested_vat_rate:
            tx.suggested_vat_rate ?? movement._coreVatRate ?? null,
          risk_level: movement._coreRiskLevel || tx.risk_level,
          decision_source: movement._coreDecisionSource || tx.decision_source,
          pipeline_stage: "annvero_core",
          message: "ANNVERO CORE kararı",
          _core_debug: movement._coreDebug || "",
        };
      });
    }

    financialTransactions = financialTransactions.map((tx) =>
      toPersistedFinancialTransaction(tx)
    );

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
