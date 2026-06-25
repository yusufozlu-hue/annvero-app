export function parseVakifbankEkstre(sheetRows) {
    if (!sheetRows || sheetRows.length === 0) return [];
  
    const headerIndex = findHeaderRowIndex(sheetRows);
  
    if (headerIndex === -1) {
      throw new Error("Vakıfbank hareket başlık satırı bulunamadı.");
    }
  
    const headers = sheetRows[headerIndex];
    const dataRows = sheetRows.slice(headerIndex + 1);
    const topInfo = getAccountInfoFromTop(sheetRows.slice(0, headerIndex));
  
    return dataRows
      .filter((row) =>
        row && row.some((cell) => String(cell || "").trim() !== "")
      )
      .map((row) => {
        const tarih = formatDate(
          getCell(row, headers, "İŞLEM TARİHİ") ||
          getCell(row, headers, "ISLEM TARIHI") ||
          getCell(row, headers, "HAREKET TARİHİ") ||
          getCell(row, headers, "HAREKET TARIHI")
        );
  
        const aciklama =
          getCell(row, headers, "AÇIKLAMA") ||
          getCell(row, headers, "ACIKLAMA") ||
          getCell(row, headers, "İŞLEM") ||
          getCell(row, headers, "ISLEM");
  
        const dekontNo =
          getCell(row, headers, "FİŞ NO") ||
          getCell(row, headers, "FIS NO") ||
          getCell(row, headers, "İŞLEM NO") ||
          getCell(row, headers, "ISLEM NO") ||
          "";
  
        const tutarRaw = getCell(row, headers, "TUTAR");
        const tutar = parseNumber(tutarRaw);
  
        const bakiye = parseNumber(
          getCell(row, headers, "BAKİYE") ||
          getCell(row, headers, "BAKIYE")
        );
  
        const ba = normalizeText(getCell(row, headers, "B/A"));
  
        let yon = "";
        let borc = 0;
        let alacak = 0;
  
        if (ba === "A" || tutar > 0) {
          yon = "GIRIS";
          borc = Math.abs(tutar);
        } else {
          yon = "CIKIS";
          alacak = Math.abs(tutar);
        }
  
        if (!tarih || !aciklama || !tutar) return null;
  
        return {
          banka: "Vakifbank",
          tarih,
          dekontNo,
          aciklama,
          borc,
          alacak,
          bakiye,
          tutar,
          yon,
          islemTipi: detectVakifbankIslemTipi(aciklama),
          iban: topInfo.iban,
          hesapNo: topInfo.hesapNo,
        };
      })
      .filter(Boolean);
  }
  
  function findHeaderRowIndex(rows) {
    return rows.findIndex((row) => {
      const text = row.map((cell) => normalizeText(cell)).join(" ");
  
      return (
        text.includes("HESAP") &&
        text.includes("HAREKET") &&
        text.includes("ISLEM") &&
        text.includes("TUTAR")
      );
    });
  }
  
  function getCell(row, headers, wantedName) {
    const wanted = compactText(wantedName);
  
    const index = headers.findIndex((header) => {
      const current = compactText(header);
      return current === wanted || current.includes(wanted);
    });
  
    return index >= 0 ? row[index] : "";
  }
  
  function getAccountInfoFromTop(rows) {
    const text = rows.flat().map((cell) => String(cell || "")).join(" ");
  
    const ibanMatch = text.match(/TR\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}/i);
  
    return {
      iban: ibanMatch ? ibanMatch[0].replace(/\s/g, "") : "",
      hesapNo: "",
    };
  }
  
  function parseNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
  
    if (typeof value === "number") return value;
  
    let text = String(value)
      .replace("TL", "")
      .replace("TRY", "")
      .replace(/\s/g, "")
      .trim();
  
    if (text.includes(",") && text.includes(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else if (text.includes(",")) {
      text = text.replace(",", ".");
    }
  
    const num = Number(text);
    return Number.isNaN(num) ? 0 : num;
  }
  
  function formatDate(value) {
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
  
  function normalizeText(value) {
    return String(value || "")
      .toUpperCase()
      .replaceAll("İ", "I")
      .replaceAll("I", "I")
      .replaceAll("Ğ", "G")
      .replaceAll("Ü", "U")
      .replaceAll("Ş", "S")
      .replaceAll("Ö", "O")
      .replaceAll("Ç", "C")
      .trim();
  }
  
  function compactText(value) {
    return normalizeText(value).replace(/[^A-Z0-9]/g, "");
  }
  
  function detectVakifbankIslemTipi(aciklama) {
    const text = normalizeText(aciklama);
  
    if (text.includes("EFT")) return "EFT";
    if (text.includes("HAVALE")) return "HAVALE";
    if (text.includes("FAST")) return "FAST";
    if (text.includes("POS")) return "POS";
    if (text.includes("MASRAF") || text.includes("KOMISYON")) return "BANKA_MASRAFI";
    if (text.includes("SGK")) return "SGK";
    if (text.includes("VERGI")) return "VERGI";
    if (text.includes("KREDI KART")) return "KREDI_KARTI";
    if (text.includes("HGS")) return "HGS";
  
    return "DIGER";
  }