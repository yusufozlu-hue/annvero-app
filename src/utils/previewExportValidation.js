import {
  analyzeStandardLucaRows,
  KONTROL_SEVIYE,
  KONTROL_TIP,
} from "@/src/utils/fisKontrolMerkezi";
import {
  analyzeDuplicateRiskForRows,
  MUKERRER_RISK_SEVIYE,
} from "@/src/utils/duplicateRiskAnalysis";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize";

export const MISSING_HESAP_CATEGORY = {
  CARI_BULUNAMADI: "Cari bulunamadı",
  PLAN_ONERI_YOK: "Hesap planında önerilen kod yok",
  KURAL_BULUNAMADI: "Kural bulunamadı",
  HAFIZA_BULUNAMADI: "Hafıza bulunamadı",
  BANKA_KARSISI: "Banka karşı hesabı bulunamadı",
  PERSONEL_BULUNAMADI: "Personel bulunamadı",
  VERGI_SGK: "Vergi/SGK türü çözülemedi",
  POS_KOMISYON: "POS/komisyon ayrımı çözülemedi",
  DIGER: "Diğer",
};

function isMissingHesapRow(row = {}) {
  const hesap = String(row.hesapKodu || "").trim();
  if (!hesap) return true;
  if (row.riskDurumu === "HESAP_EKSIK") return true;
  const note = String(row.kontrolNotu || row.uyari || row.warning || "");
  return note.includes("Hesap eşleşmesi bulunamadı");
}

export function classifyMissingHesapCategory(row = {}) {
  const note = String(
    row.kontrolNotu || row.uyari || row.warning || row.missingReason || ""
  ).toLocaleUpperCase("tr");
  const desc = String(row.detayAciklama || row.fisAciklama || "").toLocaleUpperCase(
    "tr"
  );
  const existing = String(row.missingHesapCategory || "").trim();
  if (existing && Object.values(MISSING_HESAP_CATEGORY).includes(existing)) {
    return existing;
  }

  if (note.includes("CARI HESAP BULUNAMADI") || note.includes("CARİ HESAP BULUNAMADI")) {
    return MISSING_HESAP_CATEGORY.CARI_BULUNAMADI;
  }
  if (note.includes("HESAP PLANINDA BULUNAMADI")) {
    return MISSING_HESAP_CATEGORY.PLAN_ONERI_YOK;
  }
  if (note.includes("PERSONEL") || desc.includes("MAAS") || desc.includes("ÜCRET") || desc.includes("UCRET")) {
    return MISSING_HESAP_CATEGORY.PERSONEL_BULUNAMADI;
  }
  if (
    note.includes("VERGI") ||
    note.includes("SGK") ||
    desc.includes("MUHTASAR") ||
    desc.includes("KDV") ||
    desc.includes("SGK")
  ) {
    return MISSING_HESAP_CATEGORY.VERGI_SGK;
  }
  if (desc.includes("POS") && (desc.includes("KOMISYON") || desc.includes("KOM."))) {
    return MISSING_HESAP_CATEGORY.POS_KOMISYON;
  }
  if (note.includes("KURAL BULUNAMADI")) {
    return MISSING_HESAP_CATEGORY.KURAL_BULUNAMADI;
  }
  if (note.includes("HAFIZA") && note.includes("BULUNAMADI")) {
    return MISSING_HESAP_CATEGORY.HAFIZA_BULUNAMADI;
  }
  if (!String(row.hesapKodu || "").trim()) {
    return MISSING_HESAP_CATEGORY.BANKA_KARSISI;
  }
  return MISSING_HESAP_CATEGORY.DIGER;
}

/**
 * Eksik hesap satırlarını kategorize eder.
 * Körlemesine hesap atamaz — yalnızca rapor.
 */
export function analyzeMissingHesapRows(rows = []) {
  const missing = (rows || []).filter(isMissingHesapRow);
  const byCategory = new Map();

  for (const row of missing) {
    const category = classifyMissingHesapCategory(row);
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category).push(row);
  }

  const categories = [...byCategory.entries()].map(([category, list]) => ({
    category,
    count: list.length,
    samples: list.slice(0, 10).map((row) => ({
      id: row.id,
      fisNo: row.fisNo,
      tarih: row.fisTarihi || row.evrakTarihi || "",
      tutar: Number(row.borc || 0) || Number(row.alacak || 0) || 0,
      yon: Number(row.borc || 0) > 0 ? "BORC" : "ALACAK",
      aciklama: row.detayAciklama || row.fisAciklama || "",
      suggestedHesap:
        row.accountSuggestions?.[0]?.code ||
        row.accountSuggestions?.[0]?.label ||
        "",
      cariOneri: row.cariSuggestions?.[0]?.label || row.cariSuggestions?.[0]?.code || "",
      reason: row.kontrolNotu || row.uyari || category,
      analysisKey: row.analysisKey || "",
    })),
  }));

  categories.sort((a, b) => b.count - a.count);

  return {
    totalRows: rows.length,
    missingCount: missing.length,
    readyCount: rows.length - missing.length,
    categories,
    missingRows: missing,
  };
}

export function buildMissingHesapSummaryText(report) {
  if (!report?.missingCount) return "Eksik hesap satırı yok.";
  const lines = [
    `${report.missingCount} satırda eksik hesap var (${report.readyCount} satır hazır).`,
    "",
    "Kategori dağılımı:",
  ];
  for (const item of report.categories || []) {
    lines.push(`• ${item.category}: ${item.count}`);
  }
  lines.push("");
  lines.push(
    "Tam export engellendi. Eksik hesapları inceleyin veya açıkça kısmi export seçin."
  );
  return lines.join("\n");
}

export async function downloadMissingHesapExcelReport(
  rows = [],
  filePrefix = "eksik_hesap"
) {
  if (typeof window === "undefined") return { ok: false };
  const XLSX = await import("xlsx");
  const report = analyzeMissingHesapRows(rows);
  const sheetRows = report.missingRows.map((row, index) => ({
    Sira: index + 1,
    FisNo: row.fisNo ?? "",
    Tarih: row.fisTarihi || row.evrakTarihi || "",
    Tutar: Number(row.borc || 0) || Number(row.alacak || 0) || 0,
    Yon: Number(row.borc || 0) > 0 ? "BORC" : "ALACAK",
    Aciklama: row.detayAciklama || row.fisAciklama || "",
    Kategori: classifyMissingHesapCategory(row),
    OneriHesap: row.accountSuggestions?.[0]?.code || "",
    CariOneri: row.cariSuggestions?.[0]?.label || "",
    Neden: row.kontrolNotu || row.uyari || "",
    AnalysisKey: row.analysisKey || "",
  }));
  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "EksikHesap");
  XLSX.writeFile(
    workbook,
    `${filePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
  return { ok: true, count: sheetRows.length };
}

export function getRowAnalysisKey(row = {}) {
  if (row.analysisKey) return row.analysisKey;
  const desc = row.detayAciklama || row.fisAciklama || row.description || "";
  const direction =
    Number(row.borc || 0) > 0
      ? "GIRIS"
      : Number(row.alacak || 0) > 0
        ? "CIKIS"
        : "";
  return normalizeBankAnalysisKey(desc, direction);
}

export function validatePreviewForExport(rows = []) {
  const analysis = analyzeStandardLucaRows(rows);
  const duplicateAnalysis = analyzeDuplicateRiskForRows(rows);
  const missingReport = analyzeMissingHesapRows(rows);

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

    return {
      rowId: row.id,
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

  if (missingReport.missingCount > 0) {
    globalErrors.push(
      `${missingReport.missingCount} satırda eksik hesap var. Tam export engellendi.`
    );
  }

  if (duplicateAnalysis.summary.hasCritical) {
    globalErrors.push(
      duplicateAnalysis.summary.reportLine ||
        `${duplicateAnalysis.summary.criticalCount} satırda kritik mükerrer riski tespit edildi.`
    );
  }

  const errorCategoryCounts = {
    eksikHesap: missingReport.missingCount,
    dengesizFis: analysis.summary.isBalanced
      ? 0
      : analysis.summary.unbalancedFisCount || 0,
    kritikMukerrer: duplicateAnalysis.summary.criticalCount || 0,
    eksikTarihTutar: (analysis.rows || []).filter((row) =>
      (row._kontrol?.issues || []).some(
        (issue) =>
          issue.seviye === KONTROL_SEVIYE.HATA &&
          (String(issue.message || "").includes("tarih") ||
            String(issue.message || "").includes("Tutar") ||
            String(issue.message || "").includes("tutar"))
      )
    ).length,
    gecersizBelge: (analysis.rows || []).filter((row) =>
      (row._kontrol?.issues || []).some((issue) =>
        String(issue.message || "").toLocaleLowerCase("tr").includes("belge")
      )
    ).length,
  };

  const blockingErrorCount =
    analysis.summary.hataIssueCount +
    (duplicateAnalysis.summary.hasCritical
      ? duplicateAnalysis.summary.criticalCount
      : 0) +
    (missingReport.missingCount > 0 ? missingReport.missingCount : 0);
  const warningCount =
    analysis.summary.uyariIssueCount +
    duplicateAnalysis.summary.highCount +
    duplicateAnalysis.summary.mediumCount;
  const hasBlockingErrors =
    analysis.summary.hataIssueCount > 0 ||
    !analysis.summary.isBalanced ||
    duplicateAnalysis.summary.hasCritical ||
    missingReport.missingCount > 0;
  const hasCriticalDuplicates = duplicateAnalysis.summary.hasCritical;
  const hasHighDuplicateRisk =
    duplicateAnalysis.summary.highCount > 0 ||
    duplicateAnalysis.summary.criticalCount > 0;
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
      (item) => item.warnings.length > 0 && !item.duplicateRisk?.isCritical
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
    missingReport,
    errorCategoryCounts,
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
      falsePositiveAvoided: duplicateAnalysis.summary.expectedDoubleEntryPairs || 0,
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

  if (validation?.missingReport?.missingCount) {
    lines.push(buildMissingHesapSummaryText(validation.missingReport));
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
