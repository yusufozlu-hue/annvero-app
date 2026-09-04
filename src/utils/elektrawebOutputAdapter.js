/**
 * Elektraweb çıktı adapter’ı (Faz 4).
 *
 * Ürün gerçeği: projede ayrı Elektraweb fiş şeması yok.
 * Elektraweb modülü (`elektraweb/page.tsx`) de StandardLuca Excel kolonlarını
 * (`standardLucaRowsToExcelRows`) yazar. Bu adapter aynı format katmanını kullanır;
 * Luca exporter’dan ayrılır: karar facade + elektraweb filePrefix/logLabel +
 * review gate. Sahte/uydurma format üretmez.
 */

import {
  applyOutputAccountingDecisionsToRows,
  evaluateOutputExportDecisionGate,
  shouldSkipOutputResolve,
} from "@/src/utils/outputAccountingDecisionFacade";
import {
  standardLucaRowsToExcelRows,
  stripStandardLucaRow,
} from "@/src/utils/standardLucaRow";

export const ELEKTRAWEB_OUTPUT_FORMAT = "standard-luca-excel-v1";
export const ELEKTRAWEB_OUTPUT_SHEET = "Elektraweb Fiş";

/**
 * Canonical satırları Elektraweb export’a hazırla (resolve yeniden yok).
 */
export function prepareElektrawebExportRows(rows = [], context = {}) {
  const companyId = context.companyId || context.firmaId || "";
  const prepared = applyOutputAccountingDecisionsToRows(rows, {
    ...context,
    companyId,
    firmaId: companyId,
  });
  const gate = evaluateOutputExportDecisionGate(prepared);
  return {
    ok: gate.allowed,
    format: ELEKTRAWEB_OUTPUT_FORMAT,
    rows: prepared,
    excelRows: standardLucaRowsToExcelRows(
      prepared.map((r) => stripStandardLucaRow(r))
    ),
    gate,
    skippedResolveCount: prepared.filter((r) =>
      shouldSkipOutputResolve(r, { companyId, firmaId: companyId })
    ).length,
  };
}

/**
 * UI → gerçek Elektra adapter → dosya.
 * Luca `exportStandardLucaExcel` ile aynı kolon şeması; farklı prefix/sheet.
 */
export async function exportElektrawebFromStandardLucaRows(
  rows = [],
  options = {}
) {
  const companyId = options.companyId || options.firmaId || "";
  const prepared = prepareElektrawebExportRows(rows, {
    companyId,
    firmaId: companyId,
    company: options.company,
    accountPlan: options.accountPlan,
    learningMemory: options.learningMemory,
    bankName: options.bankName,
  });

  if (!prepared.ok) {
    if (typeof options.onValidationFail === "function") {
      options.onValidationFail({
        hasBlockingErrors: true,
        globalErrors: [prepared.gate.message],
        blockingMessages: [prepared.gate.message],
        code: prepared.gate.code,
      });
    }
    return {
      ok: false,
      code: prepared.gate.code,
      message: prepared.gate.message,
      format: ELEKTRAWEB_OUTPUT_FORMAT,
      rowCount: 0,
    };
  }

  if (!prepared.rows.length) {
    return {
      ok: false,
      code: "NO_ROWS",
      message: "Elektraweb export için satır yok.",
      format: ELEKTRAWEB_OUTPUT_FORMAT,
      rowCount: 0,
    };
  }

  const { exportStandardLucaExcel } = await import(
    "@/src/utils/exportStandardLucaExcel"
  );
  const bankPrefix =
    options.filePrefix ||
    `${String(options.bankName || "banka").toLowerCase()}_elektraweb`;

  const result = await exportStandardLucaExcel(prepared.rows, {
    filePrefix: bankPrefix,
    logLabel: options.logLabel || "elektraweb-export",
    onValidationFail: options.onValidationFail,
    sheetName: ELEKTRAWEB_OUTPUT_SHEET,
    ignoreWarnings: Boolean(options.ignoreWarnings),
    signal: options.signal,
    onProgress: options.onProgress,
  });

  return {
    ...result,
    format: ELEKTRAWEB_OUTPUT_FORMAT,
    skippedResolveCount: prepared.skippedResolveCount,
    adapter: "elektrawebOutputAdapter",
  };
}
