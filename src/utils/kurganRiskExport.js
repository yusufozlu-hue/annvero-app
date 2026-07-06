import * as XLSX from "xlsx";

function findingToRow(finding = {}) {
  return [
    finding.companyName || "",
    finding.period || "",
    finding.type || "",
    finding.level || "",
    finding.amount ?? 0,
    finding.description || "",
    finding.recommendedAction || "",
    finding.status || "",
    finding.source || "",
    finding.smartExplanation || "",
  ];
}

const HEADERS = [
  "Firma",
  "Dönem",
  "Risk Türü",
  "Risk Seviyesi",
  "Tespit Edilen Tutar",
  "Açıklama",
  "Önerilen Kontrol",
  "Durum",
  "Kaynak",
  "Akıllı Açıklama",
];

export function buildKurganRiskSheetRows(findings = []) {
  return [HEADERS, ...findings.map(findingToRow)];
}

export function buildKurganRiskSummaryRows(summary = {}, meta = {}) {
  return [
    ["KURGAN / Vergisel Risk Kontrol Özeti"],
    ["Firma", meta.companyName || ""],
    ["Dönem", meta.period || ""],
    ["Analiz Tarihi", meta.analyzedAt || ""],
    [],
    ["Toplam Risk", summary.totalRisks ?? 0],
    ["Kritik Risk", summary.criticalRisks ?? 0],
    ["Yüksek Risk", summary.highRisks ?? 0],
    ["Kontrol Bekleyen", summary.pendingReviews ?? 0],
  ];
}

export function exportKurganRiskReportWorkbook({
  findings = [],
  summary = {},
  meta = {},
  fileName = "kurgan-risk-denetim",
}) {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKurganRiskSummaryRows(summary, meta)),
    "Özet"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKurganRiskSheetRows(findings)),
    "Risk Bulguları"
  );

  const criticalRows = findings.filter((item) => item.level === "Kritik" || item.level === "Yüksek");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildKurganRiskSheetRows(criticalRows)),
    "Kritik ve Yüksek"
  );

  XLSX.writeFile(workbook, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function prepareKurganRiskPdfReport() {
  return {
    ready: false,
    message: "PDF rapor üretimi sonraki aşamada eklenecek.",
  };
}
