import {
  analyzeStandardLucaRows,
  KONTROL_SEVIYE,
  KONTROL_TIP,
} from "@/src/utils/fisKontrolMerkezi";
import {
  analyzeDuplicateRiskForRows,
  MUKERRER_RISK_SEVIYE,
} from "@/src/utils/duplicateRiskAnalysis";

export function validatePreviewForExport(rows = []) {
  const analysis = analyzeStandardLucaRows(rows);
  const duplicateAnalysis = analyzeDuplicateRiskForRows(rows);

  const rowErrors = analysis.rows.map((row) => {
    const duplicate = duplicateAnalysis.byRowId.get(row.id);
    const kontrolWarnings = (row._kontrol?.issues || [])
      .filter((issue) => issue.seviye === KONTROL_SEVIYE.UYARI)
      .filter((issue) => {
        if (!duplicate || duplicate.riskScore < 31) return true;
        return (
          issue.type !== KONTROL_TIP.MUKERRER_HAREKET &&
          issue.type !== KONTROL_TIP.MUKERRER_EVRAK
        );
      })
      .map((issue) => issue.message);

    return {      rowId: row.id,
      rowIndex: row._kontrol?.rowIndex || duplicate?.rowIndex || 0,
      fisNo: row.fisNo ?? "—",
      errors: [
        ...(row._kontrol?.issues || [])
          .filter((issue) => issue.seviye === KONTROL_SEVIYE.HATA)
          .map((issue) => issue.message),
        ...(duplicate?.isCritical ? duplicate.messages || [] : []),
      ],
      warnings: [
        ...kontrolWarnings,
        ...(duplicate?.isCritical ? [] : duplicate?.messages || []),
      ],
      duplicateRisk: duplicate
        ? {
            score: duplicate.riskScore,
            level: duplicate.riskLevel,
            isCritical: duplicate.isCritical,
            messages: duplicate.messages,
          }
        : {
            score: 0,
            level: MUKERRER_RISK_SEVIYE.DUSUK,
            isCritical: false,
            messages: [],
          },
    };
  });

  const globalErrors = [];
  if (!analysis.summary.isBalanced) {
    globalErrors.push(
      `${analysis.summary.unbalancedFisCount} fişte borç/alacak toplamı eşit değil.`
    );
  }

  if (duplicateAnalysis.summary.hasCritical) {
    globalErrors.push(
      duplicateAnalysis.summary.reportLine ||
        `${duplicateAnalysis.summary.criticalCount} satırda kritik mükerrer riski tespit edildi.`
    );
  } else if (
    duplicateAnalysis.summary.suspiciousCount > 0 ||
    duplicateAnalysis.summary.expectedDoubleEntryPairs > 0
  ) {
    // Bilgi amaçlı — engellemez
  }

  const blockingErrorCount =
    analysis.summary.hataIssueCount +
    (duplicateAnalysis.summary.hasCritical ? duplicateAnalysis.summary.criticalCount : 0);
  const warningCount =
    analysis.summary.uyariIssueCount +
    duplicateAnalysis.summary.highCount +
    duplicateAnalysis.summary.mediumCount;
  const hasBlockingErrors =
    analysis.summary.hataIssueCount > 0 ||
    !analysis.summary.isBalanced ||
    duplicateAnalysis.summary.hasCritical;
  const hasCriticalDuplicates = duplicateAnalysis.summary.hasCritical;
  const hasHighDuplicateRisk =
    duplicateAnalysis.summary.highCount > 0 || duplicateAnalysis.summary.criticalCount > 0;
  const hasMediumDuplicateRisk = duplicateAnalysis.summary.mediumCount > 0;
  const hasWarnings =
    analysis.summary.uyariIssueCount > 0 ||
    duplicateAnalysis.summary.highCount > 0 ||
    duplicateAnalysis.summary.mediumCount > 0;
  const canExportWithWarnings = !hasBlockingErrors;
  const ok = !hasBlockingErrors && !hasWarnings;

  const blockingMessages = [
    ...globalErrors,
    ...rowErrors
      .filter((item) => item.errors.length > 0)
      .flatMap((item) =>
        item.errors.map(
          (error) => `Satır ${item.rowIndex} (Fiş ${item.fisNo}): ${error}`
        )
      ),
  ];

  const warningMessages = rowErrors
    .filter(
      (item) =>
        item.warnings.length > 0 &&
        !item.duplicateRisk?.isCritical
    )
    .flatMap((item) =>
      item.warnings.map(
        (warning) => `Satır ${item.rowIndex} (Fiş ${item.fisNo}): ${warning}`
      )
    );

  return {
    ok,
    analysis,
    duplicateAnalysis,
    rowErrors,
    globalErrors,
    blockingErrorCount,
    warningCount,
    hasBlockingErrors,
    hasWarnings,
    hasCriticalDuplicates,
    hasHighDuplicateRisk,
    hasMediumDuplicateRisk,
    canExportWithWarnings,
    blockingMessages,
    warningMessages,
    duplicateReport: {
      critical: duplicateAnalysis.summary.criticalCount || 0,
      suspicious: duplicateAnalysis.summary.suspiciousCount || 0,
      expectedPairs: duplicateAnalysis.summary.expectedDoubleEntryPairs || 0,
      reportLine: duplicateAnalysis.summary.reportLine || "",
      criticalRows: duplicateAnalysis.criticalRows || [],
    },
    message: ok
      ? ""
      : hasBlockingErrors
        ? blockingMessages.join("\n")
        : warningMessages.join("\n"),
  };
}

export function buildExportWarningConfirmMessage(validation) {
  const lines = [];
  const report = validation?.duplicateReport;

  if (report?.reportLine) {
    lines.push(report.reportLine);
  }

  if (validation?.hasHighDuplicateRisk) {
    lines.push("Yüksek şüpheli benzer kayıtlar var (export engellenmez).");
  }

  if (validation?.hasMediumDuplicateRisk) {
    lines.push("Orta şüpheli benzer kayıtlar var (export engellenmez).");
  }

  for (const item of validation?.rowErrors || []) {
    if (item.duplicateRisk?.isCritical) continue;

    for (const warning of item.warnings || []) {
      lines.push(`Satır ${item.rowIndex} (Fiş ${item.fisNo}): ${warning}`);
    }
  }

  if (!lines.length) {
    return "Uyarılar var. Yine de Excel oluşturmak istiyor musunuz?";
  }

  const preview = lines.slice(0, 12).join("\n");
  const suffix =
    lines.length > 12 ? `\n... ve ${lines.length - 12} uyarı daha` : "";

  return `${lines.length} uyarı bulundu:\n\n${preview}${suffix}\n\nYine de Excel oluşturmak istiyor musunuz?`;
}
