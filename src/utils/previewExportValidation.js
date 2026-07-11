import {
  analyzeStandardLucaRows,
  KONTROL_SEVIYE,
  KONTROL_TIP,
} from "@/src/utils/fisKontrolMerkezi";
import {
  analyzeDuplicateRiskForRows,
  MUKERRER_RISK_SEVIYE,
} from "@/src/utils/duplicateRiskAnalysis";
import { normalizeBankAnalysisKey, normalizeParserText } from "@/src/utils/textNormalize";
import { isLikelyBankGlAccount } from "@/src/utils/transactionMemoryEngine";
import { groupUnresolvedCariRows } from "@/src/utils/cariAccountMatcher";

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

/** Ham 102 — firma alt hesabı yok */
export function isBareBank102Account(code = "") {
  const compact = String(code || "")
    .trim()
    .replace(/\s+/g, "");
  return compact === "102";
}

const PERSONEL_SIGNAL_RE =
  /\b(MAAS|MAAŞ|BORDRO|PERSONEL|PERSONELE|UCRET ODEME|ÜCRET ODEME|MAAS ODEME|MAAŞ ÖDEME|PERSONEL AVANS|MAAS AVANS|MAAŞ AVANS)\b/i;

const CARI_CONTEXT_RE =
  /\b(KONAKLAMA|REZERVASYON|OTEL|RESORT|MUSTERI|MÜŞTERİ|CARI|FATURA|GECELIK|GECELİK|ODA|CHECK[\s-]?IN|CHECK[\s-]?OUT|TURIZM|SEYAHAT)\b/i;

const HAVALE_DESC_RE = /\b(GLN\.?\s*HVL|GOND\.?\s*HVL|GÖND\.?\s*HVL|GELEN HAVALE|GIDEN HAVALE|GELEN EFT|GONDERILEN)\b/i;

function rowDescription(row = {}) {
  return `${row.detayAciklama || ""} ${row.fisAciklama || ""} ${row.aciklama || ""}`;
}

function rowNote(row = {}) {
  return `${row.kontrolNotu || ""} ${row.uyari || ""} ${row.warning || ""} ${row.missingReason || ""}`;
}

/**
 * Gerçek personel işlemi sinyali.
 * Kişi adı tek başına yeterli değil; konaklama/cari bağlamı personeli ezer.
 */
export function hasStrictPersonelSignal(row = {}) {
  const desc = normalizeParserText(rowDescription(row));
  const note = normalizeParserText(rowNote(row));
  const haystack = `${desc} ${note}`;

  if (CARI_CONTEXT_RE.test(haystack) || CARI_CONTEXT_RE.test(desc)) {
    return false;
  }

  // Uyarıdaki "cari/personel" veya "cari eşleşmesi" personel sayılmaz
  if (
    /CARI\s*\/\s*PERSONEL|CARI ESLESMESI|CARI HESAP BULUNAMADI/.test(note) &&
    !PERSONEL_SIGNAL_RE.test(desc)
  ) {
    return false;
  }

  if (PERSONEL_SIGNAL_RE.test(desc)) return true;

  // Notta açık personel bulma uyarısı (geçmiş motor)
  if (
    /\bPERSONEL BULUNAMADI\b/.test(note) ||
    /\bPERSONEL HESABI\b/.test(note)
  ) {
    return true;
  }

  return false;
}

export function hasCariHavaleSignal(row = {}) {
  const desc = rowDescription(row);
  const note = normalizeParserText(rowNote(row));
  if (hasStrictPersonelSignal(row)) return false;
  if (/CARI HESAP BULUNAMADI|CARI ESLESMESI GEREKLI/.test(note)) return true;
  if (HAVALE_DESC_RE.test(desc)) return true;
  if (CARI_CONTEXT_RE.test(normalizeParserText(desc))) return true;
  return false;
}

export function isMissingHesapRow(row = {}) {
  const hesap = String(row.hesapKodu || "").trim();
  if (!hesap) return true;
  if (row.riskDurumu === "HESAP_EKSIK") return true;

  // Banka GL bacağı (102 / 102.xx dahil) karşı hesap sorununu temsil etmez.
  // Ham "102" firma uyarısıdır; satırı eksik hesaba düşürmez.
  if (isLikelyBankGlAccount(hesap)) {
    return false;
  }

  const note = rowNote(row);
  return note.includes("Hesap eşleşmesi bulunamadı");
}

export function classifyMissingHesapCategory(row = {}) {
  const note = normalizeParserText(rowNote(row));
  const desc = normalizeParserText(rowDescription(row));
  const hesap = String(row.hesapKodu || "").trim();
  const existing = String(row.missingHesapCategory || "").trim();
  if (existing && Object.values(MISSING_HESAP_CATEGORY).includes(existing)) {
    return existing;
  }

  // Açık banka karşı hesabı uyarısı — yalnızca bu satır gerçekten eksikse
  // (banka GL bacakları isMissingHesapRow'da zaten elenir)
  if (/BANKA KARSI HESABI BULUNAMADI/.test(note) && !isLikelyBankGlAccount(hesap)) {
    return MISSING_HESAP_CATEGORY.BANKA_KARSISI;
  }

  // 2) Cari (havale / konaklama / açık cari uyarısı) — personelden ÖNCE
  if (
    /CARI HESAP BULUNAMADI/.test(note) ||
    hasCariHavaleSignal(row)
  ) {
    if (!hasStrictPersonelSignal(row)) {
      return MISSING_HESAP_CATEGORY.CARI_BULUNAMADI;
    }
  }

  if (/HESAP PLANINDA BULUNAMADI|HESAP PLANINDA KARSILIGI YOK/.test(note)) {
    return MISSING_HESAP_CATEGORY.PLAN_ONERI_YOK;
  }

  // 3) Gerçek personel sinyalleri
  if (hasStrictPersonelSignal(row)) {
    return MISSING_HESAP_CATEGORY.PERSONEL_BULUNAMADI;
  }

  // 4) Vergi / SGK
  if (
    /\b(VERGI|SGK|MUHSGK|MUHTASAR|KDV2|\bKDV\b|GIB|IVD|DAMGA|STOPAJ)\b/.test(
      `${desc} ${note}`
    )
  ) {
    return MISSING_HESAP_CATEGORY.VERGI_SGK;
  }

  if (/\bPOS\b/.test(desc) && /\b(KOMISYON|KOM\.)\b/.test(desc)) {
    return MISSING_HESAP_CATEGORY.POS_KOMISYON;
  }

  if (/KURAL BULUNAMADI/.test(note)) {
    return MISSING_HESAP_CATEGORY.KURAL_BULUNAMADI;
  }

  if (/HAFIZA/.test(note) && /BULUNAMADI/.test(note)) {
    return MISSING_HESAP_CATEGORY.HAFIZA_BULUNAMADI;
  }

  if (!hesap) {
    // Boş karşı hesap + havale açıklaması → cari; aksi diğer
    if (HAVALE_DESC_RE.test(rowDescription(row)) || CARI_CONTEXT_RE.test(desc)) {
      return MISSING_HESAP_CATEGORY.CARI_BULUNAMADI;
    }
    return MISSING_HESAP_CATEGORY.DIGER;
  }

  return MISSING_HESAP_CATEGORY.DIGER;
}

export function classifyPersonelMissingSubtype(row = {}) {
  const desc = normalizeParserText(rowDescription(row));
  if (!hasStrictPersonelSignal(row)) {
    if (CARI_CONTEXT_RE.test(desc)) return "Personel adına cari/konaklama (yanlış)";
    if (/GLN|GELEN/.test(desc)) return "Gelen havale olup personel sanılan (yanlış)";
    if (/GOND|GÖND|GIDEN/.test(desc)) return "Giden havale olup personel sanılan (yanlış)";
    return "Diğer yanlış sınıflandırma";
  }
  if (/\b(MAAS AVANS|MAAŞ AVANS|PERSONEL AVANS|AVANS)\b/.test(desc) && /\b(MAAS|PERSONEL|BORDRO)\b/.test(desc)) {
    return "Gerçek maaş avansı";
  }
  if (/\b(MAAS|BORDRO|UCRET ODEME|PERSONEL UCRET)\b/.test(desc)) {
    return "Gerçek maaş ödemesi";
  }
  if (/\b(MASRAF IADE|PERSONEL MASRAF|HARCIRAH)\b/.test(desc)) {
    return "Personel masraf iadesi";
  }
  return "Gerçek personel (diğer)";
}

export function classifyVergiSgkSubtype(row = {}) {
  const text = normalizeParserText(rowDescription(row) + " " + rowNote(row));
  if (/\bMUHSGK\b/.test(text)) return "MUHSGK";
  if (/\bSGK\b/.test(text)) return "SGK";
  if (/\bKDV2\b/.test(text)) return "KDV2";
  if (/\bKDV\b/.test(text)) return "KDV";
  if (/\bMTV\b/.test(text)) return "MTV";
  if (/\b(VERGI CEZA|CEZA)\b/.test(text) && /\bVERGI\b/.test(text)) return "vergi cezası";
  if (/\b(GECIKME ZAMMI|GECIKME)\b/.test(text)) return "gecikme zammı";
  return "diğer";
}

export function groupOtherMissingRows(rows = [], limit = 20) {
  const other = (rows || []).filter(
    (row) => classifyMissingHesapCategory(row) === MISSING_HESAP_CATEGORY.DIGER
  );
  const groups = new Map();
  for (const row of other) {
    const key = getRowAnalysisKey(row) || "unknown";
    if (!groups.has(key)) {
      groups.set(key, {
        analysisKey: key,
        count: 0,
        samples: [],
        suggestedType: "İnceleme",
      });
    }
    const group = groups.get(key);
    group.count += 1;
    if (group.samples.length < 5) {
      group.samples.push(String(rowDescription(row)).slice(0, 140));
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
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
      cariConfidence: row.cariSuggestions?.[0]?.confidence ?? row.cariMatchConfidence ?? "",
      cariMatchReason:
        row.cariSuggestions?.[0]?.matchReason || row.cariMatchReason || "",
      reason: row.kontrolNotu || row.uyari || category,
      analysisKey: row.analysisKey || "",
      subtype:
        category === MISSING_HESAP_CATEGORY.PERSONEL_BULUNAMADI
          ? classifyPersonelMissingSubtype(row)
          : category === MISSING_HESAP_CATEGORY.VERGI_SGK
            ? classifyVergiSgkSubtype(row)
            : "",
    })),
  }));

  categories.sort((a, b) => b.count - a.count);

  const personelRows =
    byCategory.get(MISSING_HESAP_CATEGORY.PERSONEL_BULUNAMADI) || [];
  const personelSubtypeCounts = {};
  for (const row of personelRows) {
    const subtype = classifyPersonelMissingSubtype(row);
    personelSubtypeCounts[subtype] = (personelSubtypeCounts[subtype] || 0) + 1;
  }

  const vergiRows = byCategory.get(MISSING_HESAP_CATEGORY.VERGI_SGK) || [];
  const vergiSubtypeCounts = {};
  for (const row of vergiRows) {
    const subtype = classifyVergiSgkSubtype(row);
    vergiSubtypeCounts[subtype] = (vergiSubtypeCounts[subtype] || 0) + 1;
  }

  return {
    totalRows: rows.length,
    missingCount: missing.length,
    readyCount: rows.length - missing.length,
    categories,
    missingRows: missing,
    personelSubtypeCounts,
    vergiSubtypeCounts,
    otherGroups: groupOtherMissingRows(missing, 20),
    cariGroups: groupUnresolvedCariRows(missing, {}),
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
