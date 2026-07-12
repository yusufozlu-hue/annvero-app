import {
  isGarantiStatementHeaderText,
  isVakifbankStatementHeaderText,
  joinRowHeaderText,
} from "@/src/utils/bankStatementFormatGuard";

export function parseGarantiEkstre(rows) {
    if (!rows || rows.length === 0) return [];
  
    const cleanedRows = rows.filter((row) =>
      row &&
      row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")
    );
  
    const headerIndex = findHeaderRow(cleanedRows);
  
    if (headerIndex === -1) {
      throw new Error("Garanti ekstre başlık satırı bulunamadı.");
    }
  
    const headers = cleanedRows[headerIndex].map((h) =>
      normalizeText(String(h || ""))
    );
  
    const dataRows = cleanedRows.slice(headerIndex + 1);
  
    const col = {
        tarih: findColumn(headers, ["tarih"]),
        dekontNo: findColumn(headers, ["dekont"]),
        aciklama: findColumn(headers, ["açıklama", "aciklama"]),
        tutar: findColumn(headers, ["tutar"]),
        bakiye: findColumn(headers, ["bakiye"]),
      };
  
    if (col.tarih === -1 || col.aciklama === -1) {
      throw new Error("Garanti ekstresinde tarih veya açıklama kolonu bulunamadı.");
    }
  
    return dataRows
      .map((row) => {
        const tarih = parseDate(row[col.tarih]);
        const dekontNo = col.dekontNo !== -1 ? cleanCell(row[col.dekontNo]) : "";
        const aciklama = cleanCell(row[col.aciklama]);
  
        const tutar =
        col.tutar !== -1
          ? parseMoney(row[col.tutar])
          : 0;
      
          const borc = tutar > 0 ? tutar : 0;

          const alacak = tutar < 0 ? Math.abs(tutar) : 0;
        const bakiye = col.bakiye !== -1 ? parseMoney(row[col.bakiye]) : 0;
  
        if (!tarih && !aciklama) return null;
  
        return {
          banka: "Garanti",
          tarih,
          dekontNo,
          aciklama,
          borc,
          alacak,
          bakiye,
          tutar,
          yon: borc > 0 ? "GIRIS" : "CIKIS",
          islemTipi: detectGarantiIslemTipi(aciklama),
        };
      })
      .filter(Boolean);
  }
  
  function findHeaderRow(rows) {
    return rows.findIndex((row) => {
      const text = joinRowHeaderText(row);
      // Vakıfbank imzalarını açıkça reddet (İŞLEM TARİHİ, B/A, HESAP HAREKETLERİ, …)
      if (isVakifbankStatementHeaderText(text)) return false;
      return isGarantiStatementHeaderText(text);
    });
  }
  
  function findColumn(headers, possibleNames) {
    return headers.findIndex((header) =>
      possibleNames.some((name) => header.includes(normalizeText(name)))
    );
  }
  
  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ı/g, "i")
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ş/g, "s")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c")
      .replace(/\s+/g, " ")
      .trim();
  }
  
  function cleanCell(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }
  
  function parseMoney(value) {
    if (value === null || value === undefined || value === "") return 0;
  
    if (typeof value === "number") return value;
  
    let text = String(value)
      .replace("TL", "")
      .replace("TRY", "")
      .replace(/\s/g, "")
      .trim();
  
    if (text === "") return 0;
  
    if (text.includes(",") && text.includes(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else if (text.includes(",")) {
      text = text.replace(",", ".");
    }
  
    const num = Number(text);
    return Number.isNaN(num) ? 0 : num;
  }
  
  function parseDate(value) {
    if (!value) return "";
  
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
  
    if (typeof value === "number") {
      const excelEpoch = new Date(1899, 11, 30);
      excelEpoch.setDate(excelEpoch.getDate() + value);
      return excelEpoch.toISOString().slice(0, 10);
    }
  
    const text = String(value).trim();
    const parts = text.split(/[./-]/);
  
    if (parts.length === 3) {
      const [day, month, year] = parts;
  
      if (year.length === 4) {
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }
    }
  
    return text;
  }
  
  function detectGarantiIslemTipi(aciklama) {
    const text = normalizeText(aciklama);
  
    if (text.includes("eft")) return "EFT";
    if (text.includes("havale")) return "HAVALE";
    if (text.includes("swift")) return "SWIFT";
    if (text.includes("pos")) return "POS";
    if (text.includes("bsmv")) return "BSMV";
    if (text.includes("kkdf")) return "KKDF";
    if (text.includes("masraf") || text.includes("komisyon")) return "BANKA_MASRAFI";
    if (text.includes("faiz")) return "FAIZ";
    if (text.includes("vergi")) return "VERGI";
    if (text.includes("sgk")) return "SGK";
    if (text.includes("kredi")) return "KREDI";
    if (text.includes("maas") || text.includes("maaş")) return "MAAS";
  
    return "DIGER";
  }