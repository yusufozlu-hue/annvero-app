import { parseGarantiEkstre } from "@/parsers/garantiParser";
import { parseVakifbankEkstre } from "@/parsers/vakifbankParser";
import { bankaKurallari } from "@/parsers/bankaKurallari";
import {
  formatParserDate,
  mapParsedRowsToStandardMovements,
  normalizeParserText,
} from "@/src/utils/bankMovementMapper";
import { enrichTebParsedRows } from "@/src/utils/tebHavaleGrouping";
import {
  bankMovementsToStandardLucaRows,
  ensureStandardLucaRowIds,
  KAYNAK_TIPI,
} from "@/src/utils/standardLucaRow";
import { applyLearningMemoryToStandardLucaRows } from "@/src/utils/bankLearningMemory";
import { buildUnrecognizedQueueItems } from "@/src/utils/bankParserLearningPipeline";
import { applyAccountMemoryV1RecordsToRows } from "@/src/utils/accountMemoryV1";
import { applySmartBankSuggestionsToRows } from "@/src/utils/bankSmartSuggestions";
import { applyDeclarationAccrualDistributionToRows } from "@/src/utils/beyannameTahakkukEngine";
import { resolveParserName } from "@/src/utils/financialSourceArchitecture";

export const BANK_PARSE_STAGES = {
  READING: "Dosya okunuyor",
  PARSING: "Parser çalışıyor",
  LUCA: "Luca satırları oluşturuluyor",
  LEARNING: "Öğrenme sistemi kontrol ediliyor",
};

export function parseMoney(value) {
  if (typeof value === "number") return value;

  const text = String(value || "")
    .replaceAll("TL", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const number = Number(text);
  return Number.isNaN(number) ? 0 : number;
}

function findHeaderRowIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return text.includes("TARIH") && text.includes("ACIKLAMA");
  });
}

function getCell(row, headers, names) {
  const list = Array.isArray(names) ? names : [names];

  for (const name of list) {
    const wanted = normalizeParserText(name).replace(/\s+/g, "");
    const index = headers.findIndex((header) =>
      normalizeParserText(header).replace(/\s+/g, "").includes(wanted)
    );

    if (index >= 0) return row[index];
  }

  return "";
}

export function parseGenericBankEkstre(sheetRows, bankaAdi) {
  if (!sheetRows || sheetRows.length === 0) return [];

  const headerIndex = findHeaderRowIndex(sheetRows);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const tarih =
        getCell(row, headers, ["TARİH", "TARIH", "İŞLEM TARİHİ", "ISLEM TARIHI"]) ||
        row[0] ||
        "";

      const aciklama =
        getCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "İŞLEM", "ISLEM"]) ||
        row[1] ||
        "";

      const unvan =
        getCell(row, headers, [
          "ÜNVAN",
          "UNVAN",
          "ALICI",
          "ALICI ÜNVAN",
          "ALICI UNVAN",
          "KARSI HESAP",
          "KARŞI HESAP",
        ]) || "";

      const dekontNo =
        getCell(row, headers, [
          "DEKONT",
          "DEKONT NO",
          "FİŞ NO",
          "FIS NO",
          "İŞLEM NO",
          "ISLEM NO",
        ]) || "";

      let borc = parseMoney(getCell(row, headers, ["BORÇ", "BORC", "ÇIKIŞ", "CIKIS"]));
      let alacak = parseMoney(getCell(row, headers, ["ALACAK", "GİRİŞ", "GIRIS"]));
      let tutar = parseMoney(getCell(row, headers, ["TUTAR", "İŞLEM TUTARI", "ISLEM TUTARI"]));

      if (!borc && !alacak && tutar) {
        if (tutar > 0) alacak = Math.abs(tutar);
        else borc = Math.abs(tutar);
      }

      if (!tutar) {
        tutar = alacak > 0 ? alacak : -borc;
      }

      const bakiye = parseMoney(getCell(row, headers, ["BAKİYE", "BAKIYE"]));
      const yon = tutar > 0 ? "GIRIS" : "CIKIS";

      if (!tarih || !aciklama || !tutar) return null;

      return {
        banka: bankaAdi,
        tarih,
        dekontNo: dekontNo || `${bankaAdi}-${index + 1}`,
        aciklama,
        unvan,
        borc: yon === "GIRIS" ? Math.abs(tutar) : 0,
        alacak: yon === "CIKIS" ? Math.abs(tutar) : 0,
        bakiye,
        tutar,
        yon,
        islemTipi: "DIGER",
      };
    })
    .filter(Boolean);
}

export function normalizeBankParsedRow(row, selectedBank) {
  const tutar = Number(row.tutar ?? row.Tutar ?? 0);
  const borc = Number(row.borc ?? row.Borc ?? 0);
  const alacak = Number(row.alacak ?? row.Alacak ?? 0);

  let yon = row.yon || row.Yon || "";

  if (!yon) {
    if (borc > 0) yon = "GIRIS";
    else if (alacak > 0) yon = "CIKIS";
    else yon = tutar > 0 ? "GIRIS" : "CIKIS";
  }

  return {
    banka: row.banka || row.Banka || selectedBank,
    tarih: row.tarih || row.Tarih || "",
    dekontNo: row.dekontNo || row.FisNo || row.Dekont || "",
    aciklama: row.aciklama || row.Aciklama || row.HamAciklama || "",
    unvan: row.unvan || row.Unvan || "",
    borc: borc || (yon === "GIRIS" ? Math.abs(tutar) : 0),
    alacak: alacak || (yon === "CIKIS" ? Math.abs(tutar) : 0),
    bakiye: row.bakiye || row.Bakiye || "",
    tutar: tutar || (yon === "GIRIS" ? Math.abs(borc) : -Math.abs(alacak)),
    yon,
    islemTipi: row.islemTipi || row.IslemTipi || "DIGER",
  };
}

export function parseRowsForBank(sheetRows, selectedBank) {
  if (selectedBank === "GARANTI") return parseGarantiEkstre(sheetRows);
  if (selectedBank === "VAKIFBANK") return parseVakifbankEkstre(sheetRows);
  if (selectedBank === "TEB") {
    return enrichTebParsedRows(parseGenericBankEkstre(sheetRows, "TEB"));
  }
  if (selectedBank === "KUVEYT") return parseGenericBankEkstre(sheetRows, "KUVEYT");
  if (selectedBank === "ZIRAAT") return parseGenericBankEkstre(sheetRows, "ZIRAAT");
  return [];
}

export function buildBankParserResult({
  parsedRows = [],
  selectedBank,
  selectedCompany,
  companyPlans,
  companyRules,
  learningMemory,
  accountMemoryRecords,
  accountingRules,
  declarationAccrualRecords,
  selectedCompanyId,
  sourceFileName = "",
  sourceFileType = "xlsx",
  sourceType = "bank",
}) {
  const normalizedRows = parsedRows.map((row) =>
    normalizeBankParsedRow(row, selectedBank)
  );

  return buildBankParserResultFromNormalizedRows({
    normalizedRows,
    selectedBank,
    selectedCompany,
    companyPlans,
    companyRules,
    learningMemory,
    accountMemoryRecords,
    accountingRules,
    declarationAccrualRecords,
    selectedCompanyId,
    sourceFileName,
    sourceFileType,
    sourceType,
  });
}

export function buildBankParserResultFromNormalizedRows({
  normalizedRows = [],
  selectedBank,
  selectedCompany,
  companyPlans,
  companyRules,
  learningMemory,
  accountMemoryRecords,
  accountingRules,
  declarationAccrualRecords,
  selectedCompanyId,
  sourceFileName = "",
  sourceFileType = "xlsx",
  sourceType = "bank",
}) {
  const movementRows = mapParsedRowsToStandardMovements(normalizedRows, {
    selectedCompany,
    companyPlans,
    companyRules,
    selectedBank,
    legacyRules: bankaKurallari,
    learningMemory,
    accountingRules,
    selectedCompanyId,
  });

  const baseRows = bankMovementsToStandardLucaRows(movementRows, {
    firmaId: selectedCompanyId,
    kaynakAdi: selectedBank,
  });

  const learningRows = applyLearningMemoryToStandardLucaRows(
    ensureStandardLucaRowIds(baseRows),
    learningMemory,
    {
      firmaId: selectedCompanyId,
      kaynakTipi: KAYNAK_TIPI.BANKA,
      kaynakAdi: selectedBank,
    }
  );

  const memoryRows = applyAccountMemoryV1RecordsToRows(
    learningRows,
    accountMemoryRecords,
    {
      firmaId: selectedCompanyId,
      kaynakAdi: selectedBank,
    }
  );

  const smartRows = applySmartBankSuggestionsToRows(memoryRows, {
    companyPlans,
    selectedBank,
    selectedCompanyId,
  });

  const declarationResult = applyDeclarationAccrualDistributionToRows(
    smartRows,
    declarationAccrualRecords,
    {
      companyId: selectedCompanyId,
      selectedBank,
    }
  );

  const standardLucaRows = declarationResult.rows;

  const unrecognizedItems = buildUnrecognizedQueueItems(standardLucaRows, {
    companyId: selectedCompanyId,
    sourceModule: "banka",
    sourceBank: selectedBank,
    learningMemory,
  });

  // NFT/dashboard worker içinde üretilmez (import crash + structured clone riski).
  // Ana thread buildBankCardOpsSideOutput ile doldurur.
  return {
    normalizedRows,
    movementRows,
    standardLucaRows,
    unrecognizedItems,
    declarationSummary: declarationResult.summary,
    financialTransactions: null,
    opsDashboard: null,
    opsMeta: {
      selectedBank,
      selectedCompanyId,
      sourceFileName,
      sourceFileType,
      sourceType,
      parserName: resolveParserName(selectedBank, sourceType),
    },
  };
}

export { formatParserDate };
