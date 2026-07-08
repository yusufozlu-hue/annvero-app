/**
 * Worker-safe bank parse core — no companyCenter, no Luca pipeline, no localStorage.
 * Only Excel→bank-specific parse→normalized rows.
 */

import { parseGarantiEkstre } from "@/parsers/garantiParser";
import { parseVakifbankEkstre } from "@/parsers/vakifbankParser";
import { normalizeParserText } from "@/src/utils/textNormalize";

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

function formatParserDateLite(dateText) {
  if (!dateText) return "";

  if (dateText instanceof Date) {
    const day = String(dateText.getDate()).padStart(2, "0");
    const month = String(dateText.getMonth() + 1).padStart(2, "0");
    const year = dateText.getFullYear();
    return `${day}.${month}.${year}`;
  }

  const text = String(dateText);

  if (text.includes("-")) {
    const [year, month, day] = text.split("-");
    return `${day}.${month}.${year}`;
  }

  return text.split(" ")[0];
}

function normalizeDekont(value) {
  return String(value || "").trim();
}

function isSyntheticDekont(dekont) {
  const text = normalizeDekont(dekont);
  if (!text) return true;
  return /^(TEB|KUVEYT|ZIRAAT|GARANTI|VAKIFBANK)-\d+$/i.test(text);
}

function extractTransactionReference(description) {
  const text = String(description || "");
  const matches = text.match(/\b(\d{6,})\b/g);
  if (!matches?.length) return "";
  return matches.sort((left, right) => right.length - left.length)[0];
}

function resolveDekontForMatching(row) {
  let dekontNo = normalizeDekont(row?.dekontNo || row?.Dekont || "");
  if (isSyntheticDekont(dekontNo)) dekontNo = "";
  if (!dekontNo) {
    const ref = extractTransactionReference(row?.aciklama || row?.description || "");
    if (ref) dekontNo = ref;
  }
  return dekontNo;
}

function isTebMasrafParsedRow(row) {
  const text = normalizeParserText(row?.aciklama || row?.description || "");
  const amount = Math.abs(Number(row?.tutar ?? row?.amount ?? 0));
  if (!amount) return false;
  if (
    text.includes("MASRAF") ||
    text.includes("UCRET") ||
    text.includes("BSMV") ||
    text.includes("KOMISYON")
  ) {
    return amount > 0 && amount <= 500;
  }
  return false;
}

/** TEB dekont/masraf enrich — bankMovementMapper bağımlılığı yok */
export function enrichTebParsedRowsLite(parsedRows = []) {
  let lastDekont = "";
  let lastDate = "";

  return parsedRows.map((row) => {
    const date = formatParserDateLite(row?.tarih || row?.date || "");
    let dekontNo = resolveDekontForMatching(row);

    if (date !== lastDate) lastDekont = "";

    if (dekontNo && !isSyntheticDekont(dekontNo)) {
      lastDekont = dekontNo;
    } else if (isTebMasrafParsedRow(row) && lastDekont && date === lastDate) {
      dekontNo = lastDekont;
    }

    lastDate = date;

    return {
      ...row,
      dekontNo,
      unvan: String(row?.unvan || row?.Unvan || "").trim(),
    };
  });
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
    iban: row.iban || "",
    hesapNo: row.hesapNo || "",
  };
}

export function parseRowsForBank(sheetRows, selectedBank) {
  if (selectedBank === "GARANTI") return parseGarantiEkstre(sheetRows);
  if (selectedBank === "VAKIFBANK") return parseVakifbankEkstre(sheetRows);
  if (selectedBank === "TEB") {
    return enrichTebParsedRowsLite(parseGenericBankEkstre(sheetRows, "TEB"));
  }
  if (selectedBank === "KUVEYT") return parseGenericBankEkstre(sheetRows, "KUVEYT");
  if (selectedBank === "ZIRAAT") return parseGenericBankEkstre(sheetRows, "ZIRAAT");
  return [];
}
