export function parseVakifbankEkstre(sheetRows, options = {}) {
  if (!sheetRows || sheetRows.length === 0) return [];

  const headerIndex = findHeaderRowIndex(sheetRows);

  if (headerIndex === -1) {
    throw new Error("Vakıfbank hareket başlık satırı bulunamadı.");
  }

  const headers = sheetRows[headerIndex];
  const topInfo = getAccountInfoFromTop(sheetRows.slice(0, headerIndex));
  const sourceFile = String(options.sourceFileName || options.fileName || "").trim();
  const sheetName = String(options.sheetName || "").trim();

  const out = [];

  for (let i = headerIndex + 1; i < sheetRows.length; i += 1) {
    const row = sheetRows[i];
    const excelRowNumber = i + 1; // 1-based Excel row
    if (!row || !row.some((cell) => String(cell || "").trim() !== "")) {
      continue;
    }

    const tarih = formatDate(
      getCell(row, headers, "İŞLEM TARİHİ") ||
        getCell(row, headers, "ISLEM TARIHI") ||
        getCell(row, headers, "HAREKET TARİHİ") ||
        getCell(row, headers, "HAREKET TARIHI") ||
        getCell(row, headers, "HAREKET TARIH")
    );

    const aciklama =
      getCellExact(row, headers, "AÇIKLAMA") ||
      getCellExact(row, headers, "ACIKLAMA") ||
      getCellExact(row, headers, "İŞLEM") ||
      getCellExact(row, headers, "ISLEM") ||
      "";

    const dekontNo =
      getCell(row, headers, "FİŞ NO") ||
      getCell(row, headers, "FIS NO") ||
      getCell(row, headers, "İŞLEM NO") ||
      getCell(row, headers, "ISLEM NO") ||
      "";

    const tutarRaw = getCellExact(row, headers, "TUTAR");
    const tutar = parseNumber(tutarRaw);

    const bakiye = parseNumber(
      getCell(row, headers, "BAKİYE") || getCell(row, headers, "BAKIYE")
    );

    const ba = normalizeText(getCellExact(row, headers, "B/A"));

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

    // Geçerli hareket: tarih + açıklama + sıfır olmayan tutar
    if (!tarih || !aciklama || !Number.isFinite(tutar) || tutar === 0) {
      continue;
    }

    const sourceRowId = buildSourceRowId({
      sourceFile,
      sheetName,
      excelRowNumber,
    });

    out.push({
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
      excelRowNumber,
      sourceRowId,
      sheetName: sheetName || undefined,
      sourceFileName: sourceFile || undefined,
    });
  }

  return out;
}

export function buildSourceRowId({
  sourceFile = "",
  sheetName = "",
  excelRowNumber = 0,
} = {}) {
  const file = String(sourceFile || "VAKIFBANK").trim() || "VAKIFBANK";
  const sheet = String(sheetName || "Sheet1").trim() || "Sheet1";
  const row = Number(excelRowNumber) || 0;
  return `${file}|${sheet}|${row}`;
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

/** Önce tam başlık eşleşmesi; includes yalnız tek aday varsa. */
function getCellExact(row, headers, wantedName) {
  const wanted = compactText(wantedName);
  if (!wanted) return "";

  const exactIndex = headers.findIndex(
    (header) => compactText(header) === wanted
  );
  if (exactIndex >= 0) return row[exactIndex];

  const partial = [];
  headers.forEach((header, index) => {
    const current = compactText(header);
    if (current.includes(wanted) || wanted.includes(current)) {
      partial.push(index);
    }
  });
  if (partial.length === 1) return row[partial[0]];
  return "";
}

function getCell(row, headers, wantedName) {
  return getCellExact(row, headers, wantedName);
}

function getAccountInfoFromTop(rows) {
  const text = rows.flat().map((cell) => String(cell || "")).join(" ");

  const ibanMatch = text.match(
    /TR\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}/i
  );

  return {
    iban: ibanMatch ? ibanMatch[0].replace(/\s/g, "") : "",
    hesapNo: "",
  };
}

/**
 * TR (1.850.000,00) ve US (1,850,000.00) binlik/ondalık ayrımını doğru çözer.
 */
export function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  let text = String(value)
    .replace(/TL/gi, "")
    .replace(/TRY/gi, "")
    .replace(/\s/g, "")
    .trim();

  if (!text) return 0;

  const negative = text.startsWith("-") || text.startsWith("(");
  text = text.replace(/^[-(]+|[)]+$/g, "");

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma && hasDot) {
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastDot > lastComma) {
      // US: 1,850,000.00
      text = text.replace(/,/g, "");
    } else {
      // TR: 1.850.000,00
      text = text.replace(/\./g, "").replace(",", ".");
    }
  } else if (hasComma) {
    const parts = text.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      // 1850000,50
      text = `${parts[0].replace(/\./g, "")}.${parts[1]}`;
    } else {
      // 1,850,000
      text = text.replace(/,/g, "");
    }
  } else if (hasDot) {
    const parts = text.split(".");
    if (parts.length > 2) {
      // 1.850.000
      text = text.replace(/\./g, "");
    } else if (
      parts.length === 2 &&
      parts[1].length === 3 &&
      /^\d+$/.test(parts[0]) &&
      /^\d+$/.test(parts[1])
    ) {
      // 1.850 binlik (ondalık değil)
      text = text.replace(/\./g, "");
    }
  }

  const num = Number(text);
  if (Number.isNaN(num)) return 0;
  return negative ? -Math.abs(num) : num;
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
