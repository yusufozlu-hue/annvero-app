/**
 * Worker-safe bank parse core — no companyCenter, no Luca pipeline, no localStorage.
 * Only Excel→bank-specific parse→normalized rows.
 */

import { parseGarantiEkstre } from "@/parsers/garantiParser";
import { parseVakifbankEkstre } from "@/parsers/vakifbankParser";
import { assertSelectedBankMatchesSheet } from "@/src/utils/bankStatementFormatGuard";
import { toParserBankId } from "@/src/utils/bankIdentity";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const BANK_PARSE_STAGES = {
  READING: "Dosya okunuyor",
  PARSING: "Parser çalışıyor",
  LUCA: "Luca satırları oluşturuluyor",
  LEARNING: "Öğrenme sistemi kontrol ediliyor",
};

/** TEB masraf anahtarları — tebHavaleGrouping ile parity (worker-safe kopya) */
const TEB_MASRAF_KEYWORDS = [
  "HAVALE / EFT MASRAFI",
  "HAVALE/EFT MASRAFI",
  "HAVALE MASRAF",
  "EFT MASRAF",
  "EFT MASRAFI",
  "BSMV",
  "KOMISYON",
  "KOMİSYON",
  "HAVALE UCRET",
  "HAVALE ÜCRET",
  "HAVALE UCRETI",
  "HAVALE ÜCRETİ",
  "EFT UCRET",
  "EFT ÜCRET",
  "EFT UCRETI",
  "EFT ÜCRETİ",
  "FAST UCRET",
  "FAST ÜCRET",
  "BKM UCR",
  "BKM UCRET",
  "KESINTI",
  "KESİNTİ",
];

/**
 * Para parse — numeric / TR 1.234,56 / US 1234.56 / negatif.
 * Noktalı ondalık (1234.56) binlik sanılmaz.
 */
export function parseMoney(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  let text = String(value)
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/TL/gi, "")
    .replace(/₺/g, "");

  if (!text || text === "-" || text === "—" || text === "–") return 0;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-") || text.startsWith("−")) {
    negative = true;
    text = text.slice(1);
  }
  if (!text) return 0;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // TR: 1.234,56
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      // US: 1,234.56
      text = text.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const parts = text.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      text = `${parts[0]}.${parts[1]}`;
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (lastDot !== -1) {
    const dotCount = (text.match(/\./g) || []).length;
    if (dotCount > 1) {
      // 1.234.567
      text = text.replace(/\./g, "");
    } else {
      const [, fraction = ""] = text.split(".");
      if (fraction.length === 3 && /^\d+$/.test(fraction)) {
        // 1.234 binlik
        text = text.replace(".", "");
      }
      // fraction.length <= 2 → ondalık, olduğu gibi bırak
    }
  }

  text = text.replace(/[^\d.]/g, "");
  const number = Number(text);
  if (!Number.isFinite(number) || Number.isNaN(number)) return 0;
  const signed = negative ? -Math.abs(number) : number;
  const rounded = Math.round((signed + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function findHeaderRowIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return text.includes("TARIH") && text.includes("ACIKLAMA");
  });
}

function headerNormKey(header) {
  return normalizeParserText(header).replace(/\s+/g, "");
}

/** Exact match preferred; includes as fallback (longer wanted first). */
function getCell(row, headers, names) {
  const list = Array.isArray(names) ? names : [names];
  const normHeaders = headers.map((h) => headerNormKey(h));

  for (const name of list) {
    const wanted = headerNormKey(name);
    if (!wanted) continue;
    const exact = normHeaders.findIndex((h) => h === wanted);
    if (exact >= 0) return row[exact];
  }

  const sorted = [...list].sort(
    (a, b) => headerNormKey(b).length - headerNormKey(a).length
  );
  for (const name of sorted) {
    const wanted = headerNormKey(name);
    if (!wanted) continue;
    const index = normHeaders.findIndex((h) => h.includes(wanted));
    if (index >= 0) return row[index];
  }

  return "";
}

function getCellExactOrLongest(row, headers, names) {
  return getCell(row, headers, names);
}

function isTebFourteenColumnHeaders(headers = []) {
  const u = headers.map((h) => headerNormKey(h)).join(" ");
  return (
    u.includes("TARIH") &&
    u.includes("VALOR") &&
    u.includes("SAAT") &&
    (u.includes("ISLEMIGIRENKULLANICI") || u.includes("ISLEMIGIREN")) &&
    u.includes("ACIKLAMA") &&
    u.includes("BANKA") &&
    u.includes("UNVAN") &&
    (u.includes("ALICHESAP") || (u.includes("IBAN") && u.includes("KART"))) &&
    u.includes("OZELISLEM") &&
    u.includes("EFTSORGU") &&
    u.includes("TUTAR") &&
    u.includes("BAKIYE") &&
    u.includes("DEKONT") &&
    u.includes("MUSTERIREFERANS")
  );
}

function isDevirBalanceRow(row) {
  const blob = normalizeParserText(
    (row || []).map((c) => String(c ?? "")).join(" ")
  );
  return (
    blob.includes("DEVIR BAKIYE") ||
    blob.includes("DEVIRBAKIYE") ||
    blob.includes("DEVREDEN BAKIYE") ||
    blob.includes("ONCEKI BAKIYE")
  );
}

function formatParserDateLite(dateText) {
  if (!dateText && dateText !== 0) return "";

  if (dateText instanceof Date) {
    const day = String(dateText.getDate()).padStart(2, "0");
    const month = String(dateText.getMonth() + 1).padStart(2, "0");
    const year = dateText.getFullYear();
    return `${day}.${month}.${year}`;
  }

  const text = String(dateText).trim();
  if (!text) return "";

  if (text.includes("-") && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    const [year, month, day] = text.split(/[T\s]/)[0].split("-");
    return `${day}.${month}.${year}`;
  }

  return text.split(" ")[0];
}

function formatParserTimeLite(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    const hh = String(value.getHours()).padStart(2, "0");
    const mm = String(value.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const text = String(value).trim();
  const m = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return text;
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
    TEB_MASRAF_KEYWORDS.some((keyword) =>
      text.includes(normalizeParserText(keyword))
    )
  ) {
    return true;
  }

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

/** TEB dekont/masraf enrich — bankMovementMapper bağımlılığı yok; main/worker parity */
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
      tarih: date || row?.tarih || "",
      dekontNo,
      unvan: String(row?.unvan || row?.Unvan || "").trim(),
    };
  });
}

/** @deprecated alias — parity için Lite ile aynı */
export const enrichTebParsedRows = enrichTebParsedRowsLite;

function buildLegacyAmountFields(tutar) {
  const yon = tutar > 0 ? "GIRIS" : "CIKIS";
  return {
    borc: yon === "GIRIS" ? Math.abs(tutar) : 0,
    alacak: yon === "CIKIS" ? Math.abs(tutar) : 0,
    yon,
  };
}

/**
 * TEB 14-kolon Excel ihracatı.
 * Devir bakiyesi hareket sayılmaz; openingBalanceHint döner (yan etki yok — çağıran ignore edebilir).
 */
export function parseTebFourteenColumnEkstre(sheetRows, bankaAdi = "TEB") {
  if (!sheetRows || sheetRows.length === 0) {
    return { rows: [], openingBalanceHint: null, headerIndex: -1 };
  }

  const headerIndex = findHeaderRowIndex(sheetRows);
  if (headerIndex < 0) {
    return { rows: [], openingBalanceHint: null, headerIndex: -1 };
  }
  const headers = sheetRows[headerIndex];
  if (!isTebFourteenColumnHeaders(headers)) {
    return { rows: [], openingBalanceHint: null, headerIndex };
  }

  const dataRows = sheetRows.slice(headerIndex + 1);
  let openingBalanceHint = null;
  const rows = [];
  let movementIndex = 0;

  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i];
    if (!row || !row.some((cell) => String(cell ?? "").trim())) continue;

    if (isDevirBalanceRow(row)) {
      const bal = parseMoney(
        getCell(row, headers, ["BAKİYE", "BAKIYE"]) || row[row.length - 1]
      );
      // Devir satırında tutar boş, bakiye = açılış
      const anyBal = parseMoney(
        getCell(row, headers, ["BAKİYE", "BAKIYE"]) ||
          row.find((c, idx) => idx > 0 && parseMoney(c) !== 0) ||
          ""
      );
      openingBalanceHint = bal || anyBal || openingBalanceHint;
      // Bazı ihracatlarda devir bakiyesi tek hücrede (açıklama + bakiye)
      if (!openingBalanceHint) {
        for (const cell of row) {
          const n = parseMoney(cell);
          if (n) {
            openingBalanceHint = n;
            break;
          }
        }
      }
      continue;
    }

    const tarihRaw = getCell(row, headers, [
      "TARİH",
      "TARIH",
      "İŞLEM TARİHİ",
      "ISLEM TARIHI",
    ]);
    const tarih = formatParserDateLite(tarihRaw);
    if (!tarih || !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(tarih)) continue;

    const valor = formatParserDateLite(
      getCell(row, headers, ["VALÖR", "VALOR", "VALÖRDEN", "VALORDEN"])
    );
    const saat = formatParserTimeLite(
      getCell(row, headers, ["SAAT", "İŞLEM SAATİ", "ISLEM SAATI"])
    );
    const aciklama = String(
      getCellExactOrLongest(row, headers, ["AÇIKLAMA", "ACIKLAMA"]) || ""
    ).trim();
    // "Özel İşlem Açıklaması" ACIKLAMA includes ile yakalanmasın diye exact önce
    const ozelAciklama = String(
      getCell(row, headers, [
        "ÖZEL İŞLEM AÇIKLAMASI",
        "OZEL ISLEM ACIKLAMASI",
        "ÖZEL İŞLEM",
        "OZEL ISLEM",
      ]) || ""
    ).trim();
    const karsiBanka = String(
      getCell(row, headers, ["BANKA"]) || ""
    ).trim();
    const unvan = String(
      getCell(row, headers, ["ÜNVAN", "UNVAN"]) || ""
    ).trim();
    const karsiHesap = String(
      getCell(row, headers, [
        "ALICI HESAP / IBAN / KART NO",
        "ALICI HESAP/IBAN/KART NO",
        "ALICI HESAP",
        "IBAN",
        "KART NO",
      ]) || ""
    ).trim();
    const eftSorguNo = String(
      getCell(row, headers, ["EFT SORGU NO", "EFT SORGU", "SORGU NO"]) || ""
    ).trim();
    const musteriReferansi = String(
      getCell(row, headers, [
        "MÜŞTERİ REFERANSI",
        "MUSTERI REFERANSI",
        "MÜŞTERİ REFERANS",
        "MUSTERI REFERANS",
      ]) || ""
    ).trim();
    const dekontNo = String(
      getCell(row, headers, ["DEKONT", "DEKONT NO"]) || ""
    ).trim();
    const tutar = parseMoney(
      getCell(row, headers, ["TUTAR", "İŞLEM TUTARI", "ISLEM TUTARI"])
    );
    const bakiye = parseMoney(getCell(row, headers, ["BAKİYE", "BAKIYE"]));

    if (!aciklama || !tutar) continue;

    const amounts = buildLegacyAmountFields(tutar);
    movementIndex += 1;
    rows.push({
      banka: bankaAdi,
      tarih,
      valor: valor || tarih,
      saat,
      dekontNo: dekontNo || `${bankaAdi}-${movementIndex}`,
      aciklama,
      unvan,
      karsiBanka,
      iban: karsiHesap,
      hesapNo: karsiHesap,
      ozelAciklama,
      eftSorguNo,
      musteriReferansi,
      borc: amounts.borc,
      alacak: amounts.alacak,
      bakiye,
      tutar,
      yon: amounts.yon,
      islemTipi: "DIGER",
      excelRowNumber: headerIndex + 2 + i,
      openingBalanceHint: null,
    });
  }

  return { rows, openingBalanceHint, headerIndex };
}

export function parseGenericBankEkstre(sheetRows, bankaAdi) {
  if (!sheetRows || sheetRows.length === 0) return [];

  const headerIndex = findHeaderRowIndex(sheetRows);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  // TEB 14-kolon yolu
  if (
    String(bankaAdi || "").toUpperCase() === "TEB" &&
    isTebFourteenColumnHeaders(headers)
  ) {
    const parsed = parseTebFourteenColumnEkstre(sheetRows, "TEB");
    if (parsed.openingBalanceHint != null && parsed.rows[0]) {
      parsed.rows[0] = {
        ...parsed.rows[0],
        openingBalanceHint: parsed.openingBalanceHint,
      };
    }
    return parsed.rows;
  }

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      if (isDevirBalanceRow(row)) return null;

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
    valor: row.valor || row.valueDate || row.tarih || row.Tarih || "",
    saat: row.saat || row.transactionTime || "",
    dekontNo: row.dekontNo || row.FisNo || row.Dekont || "",
    aciklama: row.aciklama || row.Aciklama || row.HamAciklama || "",
    unvan: row.unvan || row.Unvan || "",
    karsiBanka: row.karsiBanka || row.counterpartyBank || "",
    ozelAciklama: row.ozelAciklama || row.specialDescription || "",
    eftSorguNo: row.eftSorguNo || row.eftQueryNo || "",
    musteriReferansi: row.musteriReferansi || row.customerReference || "",
    borc: borc || (yon === "GIRIS" ? Math.abs(tutar) : 0),
    alacak: alacak || (yon === "CIKIS" ? Math.abs(tutar) : 0),
    bakiye: row.bakiye || row.Bakiye || "",
    tutar: tutar || (yon === "GIRIS" ? Math.abs(borc) : -Math.abs(alacak)),
    yon,
    islemTipi: row.islemTipi || row.IslemTipi || "DIGER",
    iban: row.iban || "",
    hesapNo: row.hesapNo || "",
    openingBalanceHint:
      row.openingBalanceHint == null ? null : Number(row.openingBalanceHint),
  };
}

export function parseRowsForBank(sheetRows, selectedBank) {
  const bank = toParserBankId(selectedBank) || String(selectedBank || "").trim().toUpperCase();
  assertSelectedBankMatchesSheet(sheetRows, bank);
  if (bank === "GARANTI") return parseGarantiEkstre(sheetRows);
  if (bank === "VAKIFBANK") return parseVakifbankEkstre(sheetRows);
  if (bank === "TEB") {
    return enrichTebParsedRowsLite(parseGenericBankEkstre(sheetRows, "TEB"));
  }
  if (bank === "KUVEYT") return parseGenericBankEkstre(sheetRows, "KUVEYT");
  if (bank === "ZIRAAT") return parseGenericBankEkstre(sheetRows, "ZIRAAT");
  return [];
}
