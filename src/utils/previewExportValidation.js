import {
  analyzeStandardLucaRows,
  KONTROL_SEVIYE,
} from "@/src/utils/fisKontrolMerkezi";

export function validatePreviewForExport(rows = []) {
  const analysis = analyzeStandardLucaRows(rows);
  const rowErrors = analysis.rows.map((row) => ({
    rowId: row.id,
    rowIndex: row._kontrol?.rowIndex || 0,
    fisNo: row.fisNo ?? "—",
    errors: (row._kontrol?.issues || [])
      .filter((issue) => issue.seviye === KONTROL_SEVIYE.HATA)
      .map((issue) => issue.message),
    warnings: (row._kontrol?.issues || [])
      .filter((issue) => issue.seviye === KONTROL_SEVIYE.UYARI)
      .map((issue) => issue.message),
  }));

  const globalErrors = [];
  if (!analysis.summary.isBalanced) {
    globalErrors.push(
      `${analysis.summary.unbalancedFisCount} fişte borç/alacak toplamı eşit değil.`
    );
  }

  const blockingErrorCount = analysis.summary.hataIssueCount;
  const ok = blockingErrorCount === 0 && analysis.summary.isBalanced;

  return {
    ok,
    analysis,
    rowErrors,
    globalErrors,
    blockingErrorCount,
    message: ok
      ? ""
      : [
          ...globalErrors,
          ...rowErrors
            .filter((item) => item.errors.length > 0)
            .flatMap((item) =>
              item.errors.map(
                (error) => `Satır ${item.rowIndex} (Fiş ${item.fisNo}): ${error}`
              )
            ),
        ].join("\n"),
  };
}
