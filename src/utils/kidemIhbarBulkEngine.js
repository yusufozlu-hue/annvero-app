import {
  CALCULATION_SCOPE,
  DEFAULT_SEVERANCE_YEAR,
} from "@/src/config/severanceNoticeParameters";
import { EXIT_REASON_WARNINGS } from "@/src/config/kidemIhbarBulkDefaults";
import { calculateSeveranceNotice } from "@/src/utils/kidemIhbarHesaplama";
import { formatDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { normalizeParserText } from "@/src/utils/textNormalize";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function parseBooleanTR(value) {
  const text = normalizeParserText(value).toLocaleLowerCase("tr-TR");
  return ["evet", "e", "true", "1", "yes", "var", "kullandirildi", "kullandırıldı"].includes(
    text
  );
}

function findHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return text.includes("AD") && (text.includes("GIRIS") || text.includes("GİRİŞ"));
  });
}

function getSheetCell(row, headers, names) {
  const list = Array.isArray(names) ? names : [names];

  for (const name of list) {
    const wanted = compactText(name);
    const index = headers.findIndex((header) => {
      const current = compactText(header);
      return current === wanted || current.includes(wanted);
    });

    if (index >= 0) return row[index];
  }

  return "";
}

function parseEmployeeRow(row, headers, index) {
  const adSoyad = String(getSheetCell(row, headers, ["AD SOYAD", "ADSOYAD", "PERSONEL"]) || "").trim();
  const tcKimlikNo = String(
    getSheetCell(row, headers, ["TC KIMLIK NO", "TC NO", "TCKN", "TC"]) || ""
  ).trim();
  const iseGirisTarihi =
    getSheetCell(row, headers, ["ISE GIRIS TARIHI", "İŞE GİRİŞ TARİHİ", "GIRIS TARIHI"]) || "";
  const istenCikisTarihi =
    getSheetCell(row, headers, ["ISTEN CIKIS TARIHI", "İŞTEN ÇIKIŞ TARİHİ", "CIKIS TARIHI"]) ||
    "";

  if (!adSoyad && !iseGirisTarihi && !istenCikisTarihi) return null;

  return {
    id: `personel-${index + 1}`,
    adSoyad,
    tcKimlikNo,
    iseGirisTarihi: formatDateTR(iseGirisTarihi),
    istenCikisTarihi: formatDateTR(istenCikisTarihi),
    brutUcret: parseMoneyTR(getSheetCell(row, headers, ["BRUT UCRET", "BRÜT ÜCRET", "BRUT MAAS"])),
    yemekYardimi: parseMoneyTR(
      getSheetCell(row, headers, ["YEMEK YARDIMI", "YEMEK"])
    ),
    yolYardimi: parseMoneyTR(getSheetCell(row, headers, ["YOL YARDIMI", "YOL"])),
    duzenliYanHaklar: parseMoneyTR(
      getSheetCell(row, headers, ["DUZENLI YAN HAKLAR", "DÜZENLİ YAN HAKLAR", "YAN HAK"])
    ),
    cikisNedeni: String(
      getSheetCell(row, headers, ["CIKIS NEDENI", "ÇIKIŞ NEDENİ", "FESIH NEDENI"]) || ""
    ).trim(),
    ihbarKullandirildi: parseBooleanTR(
      getSheetCell(row, headers, ["IHBAR KULLANDIRILDI MI", "İHBAR KULLANDIRILDI MI", "IHBAR"])
    ),
    kullanilmayanIzinGunu: parseMoneyTR(
      getSheetCell(row, headers, [
        "KULLANILMAYAN YILLIK IZIN GUNU",
        "KULLANILMAYAN İZİN",
        "IZIN GUNU",
      ])
    ),
    kidemTavani: parseMoneyTR(getSheetCell(row, headers, ["KIDEM TAVANI", "KIDEM TAVAN", "TAVAN"])),
    kumulatifGvMatrahi: parseMoneyTR(
      getSheetCell(row, headers, ["KUMULATIF GV MATRAHI", "KÜMÜLATİF GV MATRAHI", "GV MATRAH"])
    ),
    manuallyEdited: false,
  };
}

export function parsePersonelBulkSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => parseEmployeeRow(row, headers, index))
    .filter(Boolean);
}

export function createEmptyPersonelRow(index = 0) {
  return {
    id: `personel-manuel-${index + 1}`,
    adSoyad: "",
    tcKimlikNo: "",
    iseGirisTarihi: "",
    istenCikisTarihi: "",
    brutUcret: 0,
    yemekYardimi: 0,
    yolYardimi: 0,
    duzenliYanHaklar: 0,
    cikisNedeni: "",
    ihbarKullandirildi: false,
    kullanilmayanIzinGunu: 0,
    kidemTavani: 0,
    kumulatifGvMatrahi: 0,
    manuallyEdited: true,
  };
}

function resolveScope(row) {
  if (row.ihbarKullandirildi) return CALCULATION_SCOPE.SEVERANCE_ONLY;
  return CALCULATION_SCOPE.BOTH;
}

function resolveExitWarnings(cikisNedeni = "") {
  const text = cikisNedeni.toLocaleLowerCase("tr-TR");
  const warnings = [];

  if (text.includes("istifa")) warnings.push(EXIT_REASON_WARNINGS.istifa);
  if (text.includes("haklı") || text.includes("hakli")) {
    warnings.push(EXIT_REASON_WARNINGS.hakli);
  }

  return warnings;
}

function mapRowToCalculationInput(row, globalParams = {}) {
  const severanceCeiling =
    row.kidemTavani > 0
      ? row.kidemTavani
      : globalParams.severancePayCeiling > 0
        ? globalParams.severancePayCeiling
        : 0;

  return {
    year: globalParams.year || DEFAULT_SEVERANCE_YEAR,
    startDate: row.iseGirisTarihi,
    endDate: row.istenCikisTarihi,
    scope: resolveScope(row),
    lastGrossSalary: row.brutUcret,
    monthlyTravelMeal: round2(row.yemekYardimi + row.yolYardimi),
    monthlyOtherBenefits: row.duzenliYanHaklar,
    annualBonus: 0,
    severanceCeiling,
    cumulativeTaxBaseBefore: row.kumulatifGvMatrahi,
    paramsOverride: globalParams.paramsOverride,
  };
}

function calculateUnusedLeavePay(row, calculation) {
  const days = Number(row.kullanilmayanIzinGunu || 0);
  if (!(days > 0) || !calculation.ok) return 0;

  const dailyWage = round2(
    (calculation.wage?.dressedGrossSalary || 0) /
      (calculation.params?.noticeDailyWageDivisor || 30)
  );

  return round2(dailyWage * days);
}

export function calculateBulkPersonelRow(row, globalParams = {}) {
  const parseErrors = [];

  if (!row.adSoyad) parseErrors.push("Ad soyad boş.");
  if (!row.iseGirisTarihi) parseErrors.push("İşe giriş tarihi boş.");
  if (!row.istenCikisTarihi) parseErrors.push("İşten çıkış tarihi boş.");
  if (!(row.brutUcret > 0)) parseErrors.push("Brüt ücret girilmelidir.");

  const input = mapRowToCalculationInput(row, globalParams);
  const calculation =
    parseErrors.length === 0 ? calculateSeveranceNotice(input) : { ok: false, errors: parseErrors };

  const unusedLeavePay = calculation.ok ? calculateUnusedLeavePay(row, calculation) : 0;

  const exitWarnings = resolveExitWarnings(row.cikisNedeni);
  const errors = calculation.ok ? [] : calculation.errors || parseErrors;
  const warnings = [...(calculation.warnings || []), ...exitWarnings];

  const totalTax = calculation.ok
    ? round2(
        (calculation.taxes?.totalIncomeTax || 0) + (calculation.taxes?.totalStampTax || 0)
      )
    : 0;

  const netPayment = calculation.ok
    ? round2((calculation.totals?.net || 0) + unusedLeavePay)
    : 0;

  return {
    ...row,
    calculation,
    errors,
    warnings,
    calismaSuresi: calculation.ok ? calculation.service?.label || "" : "",
    kidemTazminati: calculation.ok ? calculation.severance?.gross || 0 : 0,
    ihbarTazminati: calculation.ok ? calculation.notice?.gross || 0 : 0,
    damgaVergisi: calculation.ok ? calculation.taxes?.totalStampTax || 0 : 0,
    gelirVergisi: calculation.ok ? calculation.taxes?.totalIncomeTax || 0 : 0,
    toplamVergi: totalTax,
    kullanilmayanIzinUcreti: unusedLeavePay,
    netOdeme: netPayment,
    hasError: errors.length > 0,
  };
}

export function runKidemIhbarBulkPipeline(rows = [], globalParams = {}) {
  const calculatedRows = rows.map((row) => calculateBulkPersonelRow(row, globalParams));
  const summary = recalculateBulkSummary(calculatedRows);

  return {
    rows: calculatedRows,
    summary,
    integrationMeta: {
      source: "toplu-kidem-ihbar-v1",
      personelSayisi: calculatedRows.filter((row) => !row.hasError).length,
      mevzuatParametreKaynagi: globalParams.paramSource || "seed",
      severanceNoticeReady: true,
    },
  };
}

export function recalculateBulkSummary(rows = []) {
  const validRows = rows.filter((row) => !row.hasError);

  return {
    personelSayisi: rows.length,
    basariliPersonel: validRows.length,
    hataliPersonel: rows.filter((row) => row.hasError).length,
    toplamKidem: round2(validRows.reduce((sum, row) => sum + row.kidemTazminati, 0)),
    toplamIhbar: round2(validRows.reduce((sum, row) => sum + row.ihbarTazminati, 0)),
    toplamVergi: round2(validRows.reduce((sum, row) => sum + row.toplamVergi, 0)),
    toplamNetOdeme: round2(validRows.reduce((sum, row) => sum + row.netOdeme, 0)),
  };
}

export function recalculateBulkRows(rows = [], globalParams = {}) {
  const calculatedRows = rows.map((row) => calculateBulkPersonelRow(row, globalParams));
  return {
    rows: calculatedRows,
    summary: recalculateBulkSummary(calculatedRows),
  };
}

export function filterBulkRows(rows = [], search = "") {
  const query = search.trim().toLocaleLowerCase("tr-TR");
  if (!query) return rows;

  return rows.filter((row) =>
    [
      row.adSoyad,
      row.tcKimlikNo,
      row.cikisNedeni,
      row.calismaSuresi,
      ...(row.errors || []),
      ...(row.warnings || []),
    ]
      .join(" ")
      .toLocaleLowerCase("tr-TR")
      .includes(query)
  );
}
