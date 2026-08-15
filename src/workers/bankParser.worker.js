/**
 * Bank Excel parser — ZERO-IMPORT classic Worker.
 *
 * Turbopack new URL(..., import.meta.url) media kopyası bağımlılık
 * bundle etmez; bare npm ve path-alias import'lar evaluation'da çöker.
 * Bu dosyada import YOK: ham media olsa bile browser classic Worker çalışır.
 *
 * DUPLICATE (kaynaklar silinmedi / değiştirilmedi — senkron tut):
 * - src/utils/bankStatementFormatGuard.js (format guard helpers)
 * - parsers/garantiParser.js
 * - parsers/vakifbankParser.js
 * - src/utils/bankParserWorkerCore.js (generic TEB/KUVEYT/ZIRAAT + normalize)
 *
 * Turbopack bare module ve path-alias import'larını worker media'da
 * çözümlemez; bu yüzden bu dosyada import yok.
 *
 * Protokol:
 *   in:  { type:"parse", requestId, bankName, sheetRows, options }
 *   out: { type:"progress"|"result"|"error", ... }
 */

const BANK_PARSE_STAGES = {
  READING: "Dosya okunuyor",
  PARSING: "Parser çalışıyor",
};

// ——— DUPLICATE: textNormalize.normalizeParserText ———
function normalizeParserText(value) {
  return String(value || "")
    .replaceAll("ı", "i")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(new RegExp("[.,/()\\-_*:;]", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ——— DUPLICATE: bankStatementFormatGuard (worker-needed subset) ———
function normalizeStatementHeaderText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

function joinRowHeaderText(row) {
  if (!Array.isArray(row)) return "";
  return row.map((cell) => normalizeStatementHeaderText(cell)).join(" ");
}

function isVakifbankStatementHeaderText(text) {
  const t = normalizeStatementHeaderText(text);
  if (!t) return false;
  // Generic "hesap hareket" / hesap+hareket+tutar YETMEZ (Kuveyt false-positive)
  if (t.includes("b/a") && (t.includes("tutar") || t.includes("fis no"))) return true;
  if (t.includes("fis no") && t.includes("tutar") && (t.includes("islem") || t.includes("hesap no"))) {
    return true;
  }
  if (
    t.includes("hesap no") &&
    t.includes("fis no") &&
    (t.includes("islem") || t.includes("aciklama")) &&
    t.includes("tutar")
  ) {
    return true;
  }
  if (t.includes("hareket tarih") && t.includes("tutar") && t.includes("fis")) return true;
  if (t.includes("islem tarihi") && t.includes("b/a")) return true;
  return false;
}

function isColumnHeaderRowText(text) {
  const t = normalizeStatementHeaderText(text);
  if (!t) return false;
  const hasTarih = t.includes("tarih");
  const hasAciklama = t.includes("aciklama");
  const hasAmount =
    t.includes("tutar") ||
    t.includes("bakiye") ||
    (t.includes("borc") && t.includes("alacak")) ||
    t.includes("b/a");
  return hasTarih && hasAciklama && hasAmount;
}

function isGarantiStatementHeaderText(text) {
  const t = normalizeStatementHeaderText(text);
  if (!t || isVakifbankStatementHeaderText(t)) return false;
  const hasTarih = t.includes("tarih");
  const hasAciklama = t.includes("aciklama") || t.includes("islem aciklamasi");
  const hasAmount =
    t.includes("tutar") ||
    t.includes("bakiye") ||
    t.includes("borc") ||
    t.includes("alacak");
  const hasGarantiMarker = t.includes("dekont") || t.includes("etiket");
  return Boolean(hasTarih && hasAciklama && hasAmount && hasGarantiMarker);
}

function corpusText(sheetRows, scanLimit) {
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) return "";
  const limit = Math.min(sheetRows.length, Math.max(1, scanLimit || 40));
  const parts = [];
  for (let i = 0; i < limit; i += 1) {
    const text = joinRowHeaderText(sheetRows[i]);
    if (text) parts.push(text);
  }
  return parts.join(" | ");
}

/** Brand/IBAN için yalnız meta + kolon başlığı (hareket açıklaması hariç) */
function identityCorpusText(sheetRows, scanLimit) {
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) return "";
  const limit = Math.min(sheetRows.length, Math.max(1, scanLimit || 40));
  let headerIdx = -1;
  for (let i = 0; i < limit; i += 1) {
    if (isColumnHeaderRowText(joinRowHeaderText(sheetRows[i]))) {
      headerIdx = i;
      break;
    }
  }
  const end = headerIdx >= 0 ? headerIdx : Math.min(6, limit - 1);
  const parts = [];
  for (let i = 0; i <= end && i < limit; i += 1) {
    const text = joinRowHeaderText(sheetRows[i]);
    if (text) parts.push(text);
  }
  return parts.join(" | ");
}

const WORKER_SELECT_MIN = 45;
const WORKER_AMBIGUITY_GAP = 12;
const WORKER_AMBIGUITY_FLOOR = 35;
const WORKER_W = Object.freeze({
  brand: 42,
  iban: 36,
  bic: 30,
  formatFingerprint: 22,
  sheetName: 14,
  filename: 8,
});

function pushW(bag, code, weight) {
  bag.push({ code, weight });
}

function scoreWorkerCandidates(sheetRows, options) {
  const scanLimit = options.scanLimit || 40;
  const t = corpusText(sheetRows, scanLimit);
  const id = identityCorpusText(sheetRows, scanLimit);
  const idCompact = id.replace(/\s/g, "");
  const sheet = normalizeStatementHeaderText(options.sheetName || "");
  const file = normalizeStatementHeaderText(options.fileName || "");

  function scoreVakif() {
    const signals = [];
    if (/vakif\s*bank|vakifbank|vakiflar\s+bank/.test(id)) pushW(signals, "brand_vakifbank", WORKER_W.brand);
    if (/tr\d{2}00015/.test(idCompact)) pushW(signals, "iban_00015", WORKER_W.iban);
    if (/tvbatr2a|tvba\s*tr/.test(id)) pushW(signals, "bic_tvba", WORKER_W.bic);
    const strongNative =
      (t.includes("b/a") &&
        (t.includes("fis no") || t.includes("hesap no") || t.includes("tutar"))) ||
      (t.includes("hesap no") &&
        t.includes("fis no") &&
        t.includes("tutar") &&
        (t.includes("islem") || t.includes("aciklama"))) ||
      (t.includes("fis no") &&
        t.includes("tutar") &&
        (t.includes("islem tarih") || t.includes("hareket tarih")));
    if (strongNative) pushW(signals, "header_vakif_native", WORKER_W.formatFingerprint + 8);
    if (/vakif/.test(sheet)) pushW(signals, "sheet_name", WORKER_W.sheetName);
    if (/vakif/.test(file)) pushW(signals, "filename_hint", WORKER_W.filename);
    return { canonical: "VAKIFBANK", parser: "VAKIFBANK", score: signals.reduce((s, x) => s + x.weight, 0), signals };
  }

  function scoreGaranti() {
    const signals = [];
    if (/garanti|bbva/.test(id)) pushW(signals, "brand_garanti", WORKER_W.brand);
    if (/tr\d{2}00062/.test(idCompact)) pushW(signals, "iban_00062", WORKER_W.iban);
    if (/tgbatris|tgba\s*tr/.test(id)) pushW(signals, "bic_tgba", WORKER_W.bic);
    const looksVakif = t.includes("b/a") || (t.includes("hesap no") && t.includes("fis no"));
    const hasTarih = t.includes("tarih");
    const hasAciklama = t.includes("aciklama") || t.includes("islem aciklamasi");
    const hasAmount =
      t.includes("tutar") || t.includes("bakiye") || t.includes("borc") || t.includes("alacak");
    const hasEtiket = t.includes("etiket");
    const hasDekont = t.includes("dekont");
    const hasBorcAlacakPair = t.includes("borc") && t.includes("alacak");
    if (
      hasTarih &&
      hasAciklama &&
      hasAmount &&
      !looksVakif &&
      (hasEtiket || (hasDekont && !hasBorcAlacakPair))
    ) {
      pushW(signals, "header_garanti_export", WORKER_W.formatFingerprint + 6);
    }
    if (/garanti/.test(sheet)) pushW(signals, "sheet_name", WORKER_W.sheetName);
    if (/garanti|bbva/.test(file)) pushW(signals, "filename_hint", WORKER_W.filename);
    return { canonical: "GARANTI", parser: "GARANTI", score: signals.reduce((s, x) => s + x.weight, 0), signals };
  }

  function scoreTeb() {
    const signals = [];
    if (/\bteb\b|turkiye ekonomi bank|turkiye ekonomi|ekonomi bankasi/.test(id)) {
      pushW(signals, "brand_teb", WORKER_W.brand);
    }
    if (/tr\d{2}00032/.test(idCompact)) pushW(signals, "iban_00032", WORKER_W.iban);
    if (/tebutris|tebu\s*tr/.test(id)) pushW(signals, "bic_tebu", WORKER_W.bic);
    const hasTarih = t.includes("tarih");
    const hasAciklama = t.includes("aciklama");
    const hasBorcAlacak = t.includes("borc") && t.includes("alacak");
    const hasIslemNo = t.includes("islem no") || t.includes("islem numarasi");
    const hasBakiye = t.includes("bakiye");
    if (hasTarih && hasAciklama && hasBorcAlacak && hasIslemNo) {
      pushW(signals, "header_teb_islem_no", 30);
    } else if (hasTarih && hasAciklama && hasBorcAlacak && hasBakiye) {
      pushW(signals, "header_teb_borc_alacak", 10);
    }
    if (/\bteb\b/.test(sheet)) pushW(signals, "sheet_name", WORKER_W.sheetName);
    if (/\bteb\b/.test(file)) pushW(signals, "filename_hint", WORKER_W.filename);
    return { canonical: "TEB", parser: "TEB", score: signals.reduce((s, x) => s + x.weight, 0), signals };
  }

  function scoreZiraat() {
    const signals = [];
    if (/t\.?\s*c\.?\s*ziraat|ziraat bank|ziraat/.test(id)) pushW(signals, "brand_ziraat", WORKER_W.brand);
    if (/tr\d{2}00010/.test(idCompact)) pushW(signals, "iban_00010", WORKER_W.iban);
    if (/tczbtr|tczb\s*tr/.test(id)) pushW(signals, "bic_tczb", WORKER_W.bic);
    const hasTarih = t.includes("tarih");
    const hasAciklama = t.includes("aciklama");
    const hasBorcAlacak = t.includes("borc") && t.includes("alacak");
    const hasDekont = t.includes("dekont");
    const hasIslem = t.includes("islem no") || t.includes("islem kodu");
    if (hasTarih && hasAciklama && hasBorcAlacak && (hasDekont || hasIslem)) {
      pushW(signals, "header_ziraat_dekont", 26);
    } else if (hasTarih && hasAciklama && hasBorcAlacak) {
      pushW(signals, "header_ziraat_borc_alacak", 10);
    }
    if (/ziraat/.test(sheet)) pushW(signals, "sheet_name", WORKER_W.sheetName);
    if (/ziraat/.test(file)) pushW(signals, "filename_hint", WORKER_W.filename);
    return { canonical: "ZIRAAT", parser: "ZIRAAT", score: signals.reduce((s, x) => s + x.weight, 0), signals };
  }

  function scoreKuveyt() {
    const signals = [];
    if (/kuveyt\s*turk|kuveytturk|kuveyt/.test(id)) pushW(signals, "brand_kuveytturk", WORKER_W.brand);
    if (/tr\d{2}00205/.test(idCompact)) pushW(signals, "iban_00205", WORKER_W.iban);
    if (/kteftris|ktef\s*tr/.test(id)) pushW(signals, "bic_ktef", WORKER_W.bic);
    const hasBorcAlacak = t.includes("borc") && t.includes("alacak");
    const looksVakifNative =
      t.includes("b/a") || (t.includes("hesap no") && t.includes("fis no"));
    const hasCols =
      !looksVakifNative &&
      !hasBorcAlacak &&
      t.includes("islem tarihi") &&
      t.includes("aciklama") &&
      t.includes("tutar") &&
      t.includes("bakiye") &&
      (t.includes("islem referans") ||
        t.includes("referans numara") ||
        t.includes("referans no"));
    if (hasCols) pushW(signals, "header_kuveyt_columns", 32);
    else if (t.includes("tarih") && t.includes("aciklama") && hasBorcAlacak) {
      pushW(signals, "header_kuveyt_borc_alacak", 10);
    }
    if (/kuveyt/.test(sheet)) pushW(signals, "sheet_name", WORKER_W.sheetName);
    if (/kuveyt/.test(file)) pushW(signals, "filename_hint", WORKER_W.filename);
    return { canonical: "KUVEYTTURK", parser: "KUVEYT", score: signals.reduce((s, x) => s + x.weight, 0), signals };
  }

  return [scoreVakif(), scoreGaranti(), scoreTeb(), scoreZiraat(), scoreKuveyt()].sort(
    (a, b) => b.score - a.score
  );
}

/**
 * UI scored detector ile aynı karar (zero-import mirror).
 * Dış: selectedBank = kanonik; parserBankId = hot-path.
 * @returns {{ status: string, selectedBank: string|null, parserBankId: string|null, topScore: number }}
 */
function detectBankDecision(sheetRows, scanLimitOrOptions) {
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) {
    return {
      status: "UNKNOWN",
      selectedBank: null,
      parserBankId: null,
      topScore: 0,
    };
  }
  const options =
    typeof scanLimitOrOptions === "number"
      ? { scanLimit: scanLimitOrOptions }
      : scanLimitOrOptions || {};
  const ranked = scoreWorkerCandidates(sheetRows, options);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || top.score < WORKER_SELECT_MIN) {
    const exclusiveVakif = Boolean(
      top?.signals?.some((s) => s.code === "header_vakif_native")
    );
    if (
      !(
        exclusiveVakif &&
        top.score >= WORKER_W.formatFingerprint &&
        !(
          second &&
          second.score >= WORKER_AMBIGUITY_FLOOR &&
          top.score - second.score < WORKER_AMBIGUITY_GAP
        )
      )
    ) {
      return {
        status: "UNKNOWN",
        selectedBank: null,
        parserBankId: null,
        topScore: top?.score || 0,
      };
    }
  }
  if (
    second &&
    second.score >= WORKER_AMBIGUITY_FLOOR &&
    top.score - second.score < WORKER_AMBIGUITY_GAP
  ) {
    return {
      status: "AMBIGUOUS",
      selectedBank: null,
      parserBankId: null,
      topScore: top.score,
    };
  }
  return {
    status: "DETECTED",
    selectedBank: top.canonical,
    parserBankId: top.parser,
    topScore: top.score,
  };
}

/** Geriye uyumluluk: kanonik string veya UNKNOWN/AMBIGUOUS */
function detectKnownBankFormat(sheetRows, scanLimitOrOptions) {
  const d = detectBankDecision(sheetRows, scanLimitOrOptions);
  if (d.status === "DETECTED") return d.selectedBank;
  return d.status;
}

function banksMatch(a, b) {
  const norm = (v) => {
    const u = String(v || "").trim().toUpperCase();
    if (u === "KUVEYTTURK" || u === "KUVEYTTÜRK") return "KUVEYT";
    if (u === "VAKIF") return "VAKIFBANK";
    return u;
  };
  return norm(a) === norm(b);
}

function assertSelectedBankMatchesSheet(sheetRows, selectedBank, options) {
  const bank = String(selectedBank || "")
    .trim()
    .toUpperCase();
  if (!bank) return "UNKNOWN";
  const decision = detectBankDecision(sheetRows, options || {});
  if (decision.status === "UNKNOWN" || decision.status === "AMBIGUOUS") {
    return decision.status;
  }
  if (!banksMatch(decision.selectedBank, bank)) {
    const err = new Error(
      "Seçilen banka ile yüklenen ekstre formatı uyuşmuyor. Dosyaya uygun bankayı seçip tekrar deneyin."
    );
    err.code = "BANK_FORMAT_MISMATCH";
    err.selectedBank = bank;
    err.detectedBank = decision.selectedBank;
    throw err;
  }
  return decision.selectedBank;
}

// ——— DUPLICATE: parsers/garantiParser.js ———
function parseGarantiEkstre(rows) {
  if (!rows || rows.length === 0) return [];

  const cleanedRows = rows.filter(
    (row) =>
      row &&
      row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")
  );

  const headerIndex = cleanedRows.findIndex((row) => {
    const text = joinRowHeaderText(row);
    if (isVakifbankStatementHeaderText(text)) return false;
    return isGarantiStatementHeaderText(text);
  });

  if (headerIndex === -1) {
    throw new Error("Garanti ekstre başlık satırı bulunamadı.");
  }

  const headers = cleanedRows[headerIndex].map((h) => normalizeGarantiText(String(h || "")));
  const dataRows = cleanedRows.slice(headerIndex + 1);

  const col = {
    tarih: findGarantiColumn(headers, ["tarih"]),
    dekontNo: findGarantiColumn(headers, ["dekont"]),
    aciklama: findGarantiColumn(headers, ["açıklama", "aciklama"]),
    tutar: findGarantiColumn(headers, ["tutar"]),
    bakiye: findGarantiColumn(headers, ["bakiye"]),
  };

  if (col.tarih === -1 || col.aciklama === -1) {
    throw new Error("Garanti ekstresinde tarih veya açıklama kolonu bulunamadı.");
  }

  return dataRows
    .map((row) => {
      const tarih = parseGarantiDate(row[col.tarih]);
      const dekontNo = col.dekontNo !== -1 ? cleanGarantiCell(row[col.dekontNo]) : "";
      const aciklama = cleanGarantiCell(row[col.aciklama]);
      const tutar = col.tutar !== -1 ? parseGarantiMoney(row[col.tutar]) : 0;
      const borc = tutar > 0 ? tutar : 0;
      const alacak = tutar < 0 ? Math.abs(tutar) : 0;
      const bakiye = col.bakiye !== -1 ? parseGarantiMoney(row[col.bakiye]) : 0;

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

function findGarantiColumn(headers, possibleNames) {
  return headers.findIndex((header) =>
    possibleNames.some((name) => header.includes(normalizeGarantiText(name)))
  );
}

function normalizeGarantiText(value) {
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

function cleanGarantiCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseGarantiMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  let text = String(value).replace("TL", "").replace("TRY", "").replace(/\s/g, "").trim();
  if (text === "") return 0;
  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }
  const num = Number(text);
  return Number.isNaN(num) ? 0 : num;
}

function parseGarantiDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
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
  const text = normalizeGarantiText(aciklama);
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

// ——— DUPLICATE: parsers/vakifbankParser.js ———
function parseVakifbankEkstre(sheetRows) {
  if (!sheetRows || sheetRows.length === 0) return [];

  const headerIndex = sheetRows.findIndex((row) => {
    const text = row.map((cell) => normalizeVakifText(cell)).join(" ");
    return (
      text.includes("HESAP") &&
      text.includes("HAREKET") &&
      text.includes("ISLEM") &&
      text.includes("TUTAR")
    );
  });

  if (headerIndex === -1) {
    throw new Error("Vakıfbank hareket başlık satırı bulunamadı.");
  }

  const headers = sheetRows[headerIndex];
  const dataRows = sheetRows.slice(headerIndex + 1);
  const topInfo = getVakifAccountInfoFromTop(sheetRows.slice(0, headerIndex));

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => {
      const tarih = formatVakifDate(
        getVakifCell(row, headers, "İŞLEM TARİHİ") ||
          getVakifCell(row, headers, "ISLEM TARIHI") ||
          getVakifCell(row, headers, "HAREKET TARİHİ") ||
          getVakifCell(row, headers, "HAREKET TARIHI")
      );

      const aciklama =
        getVakifCell(row, headers, "AÇIKLAMA") ||
        getVakifCell(row, headers, "ACIKLAMA") ||
        getVakifCell(row, headers, "İŞLEM") ||
        getVakifCell(row, headers, "ISLEM");

      const dekontNo =
        getVakifCell(row, headers, "FİŞ NO") ||
        getVakifCell(row, headers, "FIS NO") ||
        getVakifCell(row, headers, "İŞLEM NO") ||
        getVakifCell(row, headers, "ISLEM NO") ||
        "";

      const tutar = parseVakifNumber(getVakifCell(row, headers, "TUTAR"));
      const bakiye = parseVakifNumber(
        getVakifCell(row, headers, "BAKİYE") || getVakifCell(row, headers, "BAKIYE")
      );
      const ba = normalizeVakifText(getVakifCell(row, headers, "B/A"));

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

function getVakifCell(row, headers, wantedName) {
  const wanted = compactVakifText(wantedName);
  const index = headers.findIndex((header) => {
    const current = compactVakifText(header);
    return current === wanted || current.includes(wanted);
  });
  return index >= 0 ? row[index] : "";
}

function getVakifAccountInfoFromTop(rows) {
  const text = rows.flat().map((cell) => String(cell || "")).join(" ");
  const ibanMatch = text.match(/TR\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}/i);
  return {
    iban: ibanMatch ? ibanMatch[0].replace(/\s/g, "") : "",
    hesapNo: "",
  };
}

function parseVakifNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  let text = String(value).replace("TL", "").replace("TRY", "").replace(/\s/g, "").trim();
  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }
  const num = Number(text);
  return Number.isNaN(num) ? 0 : num;
}

function formatVakifDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
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

function normalizeVakifText(value) {
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

function compactVakifText(value) {
  return normalizeVakifText(value).replace(/[^A-Z0-9]/g, "");
}

function detectVakifbankIslemTipi(aciklama) {
  const text = normalizeVakifText(aciklama);
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

// ——— DUPLICATE: bankParserWorkerCore (generic + normalize + TEB enrich) ———
function parseMoney(value) {
  if (typeof value === "number") return value;
  const text = String(value || "")
    .replaceAll("TL", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const number = Number(text);
  return Number.isNaN(number) ? 0 : number;
}

function findGenericHeaderRowIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return text.includes("TARIH") && text.includes("ACIKLAMA");
  });
}

function getGenericCell(row, headers, names) {
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

function enrichTebParsedRowsLite(parsedRows) {
  let lastDekont = "";
  let lastDate = "";
  return (parsedRows || []).map((row) => {
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

function parseGenericBankEkstre(sheetRows, bankaAdi) {
  if (!sheetRows || sheetRows.length === 0) return [];
  const headerIndex = findGenericHeaderRowIndex(sheetRows);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const tarih =
        getGenericCell(row, headers, ["TARİH", "TARIH", "İŞLEM TARİHİ", "ISLEM TARIHI"]) ||
        row[0] ||
        "";
      const aciklama =
        getGenericCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "İŞLEM", "ISLEM"]) ||
        row[1] ||
        "";
      const unvan =
        getGenericCell(row, headers, [
          "ÜNVAN",
          "UNVAN",
          "ALICI",
          "ALICI ÜNVAN",
          "ALICI UNVAN",
          "KARSI HESAP",
          "KARŞI HESAP",
        ]) || "";
      const dekontNo =
        getGenericCell(row, headers, [
          "DEKONT",
          "DEKONT NO",
          "FİŞ NO",
          "FIS NO",
          "İŞLEM NO",
          "ISLEM NO",
        ]) || "";

      let borc = parseMoney(getGenericCell(row, headers, ["BORÇ", "BORC", "ÇIKIŞ", "CIKIS"]));
      let alacak = parseMoney(getGenericCell(row, headers, ["ALACAK", "GİRİŞ", "GIRIS"]));
      let tutar = parseMoney(getGenericCell(row, headers, ["TUTAR", "İŞLEM TUTARI", "ISLEM TUTARI"]));

      if (!borc && !alacak && tutar) {
        if (tutar > 0) alacak = Math.abs(tutar);
        else borc = Math.abs(tutar);
      }
      if (!tutar) tutar = alacak > 0 ? alacak : -borc;

      const bakiye = parseMoney(getGenericCell(row, headers, ["BAKİYE", "BAKIYE"]));
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

function normalizeBankParsedRow(row, selectedBank) {
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

function parseRowsForBank(sheetRows, selectedBank, options) {
  let bank = String(selectedBank || "").trim().toUpperCase();
  if (bank === "KUVEYTTURK" || bank === "KUVEYTTÜRK") bank = "KUVEYT";
  if (bank === "VAKIF") bank = "VAKIFBANK";
  assertSelectedBankMatchesSheet(sheetRows, bank, options || {});
  if (bank === "GARANTI") return parseGarantiEkstre(sheetRows);
  if (bank === "VAKIFBANK") return parseVakifbankEkstre(sheetRows);
  if (bank === "TEB") {
    return enrichTebParsedRowsLite(parseGenericBankEkstre(sheetRows, "TEB"));
  }
  if (bank === "KUVEYT") return parseGenericBankEkstre(sheetRows, "KUVEYT");
  if (bank === "ZIRAAT") return parseGenericBankEkstre(sheetRows, "ZIRAAT");
  return [];
}

function yieldToWorker() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function mapInChunks(items, mapper, chunkSize, onChunk) {
  const result = [];
  const size = chunkSize || 200;
  for (let index = 0; index < items.length; index += size) {
    const chunk = items.slice(index, index + size);
    for (let i = 0; i < chunk.length; i += 1) result.push(mapper(chunk[i]));
    if (onChunk) onChunk(Math.min(index + chunk.length, items.length), items.length);
    await yieldToWorker();
  }
  return result;
}

function postProgress(stage, detail) {
  self.postMessage({ type: "progress", stage: stage || "", detail: detail || "" });
}

function postError(requestId, error, phase) {
  const errorName = error?.name || "Error";
  const errorMessage = error?.message || String(error || "Bilinmeyen worker hatası");
  const stack = error?.stack ? String(error.stack).split("\n").slice(0, 6).join("\n") : null;
  console.warn("[bankParser.worker] error", {
    phase: phase || null,
    errorName,
    errorMessage,
  });
  self.postMessage({
    type: "error",
    requestId: requestId || null,
    phase: phase || null,
    errorName,
    errorMessage,
    stack,
    // bridge geriye uyumluluk
    error: errorMessage,
    stage: phase || null,
  });
}

self.onmessage = async function onBankParserMessage(event) {
  const data = event.data || {};
  const requestId = data.requestId || null;
  const startedAt = Date.now();
  let phase = "boot";

  try {
    if (data.type && data.type !== "parse") {
      throw new Error(`Desteklenmeyen mesaj tipi: ${data.type}`);
    }

    const bankName = String(data.bankName || data.context?.selectedBank || "")
      .trim()
      .toUpperCase();
    const sheetRows = data.sheetRows;

    if (!bankName) {
      phase = "validate";
      throw new Error("Banka seçimi (bankName) worker'a ulaşmadı.");
    }
    if (!Array.isArray(sheetRows)) {
      phase = "validate";
      throw new Error("sheetRows worker'a ulaşmadı (ana thread XLSX okuması gerekli).");
    }

    phase = BANK_PARSE_STAGES.PARSING;
    postProgress(phase, `${sheetRows.length} ham satır taranıyor (${bankName})`);
    await yieldToWorker();

    const parseStarted = Date.now();
    const detectOpts = {
      sheetName: data.sheetName || data.options?.sheetName || "",
      fileName: data.fileName || data.options?.fileName || data.options?.sourceFileName || "",
      scanLimit: data.options?.scanLimit || 40,
    };
    const parsedRows = parseRowsForBank(sheetRows, bankName, detectOpts);
    const parseMs = Date.now() - parseStarted;

    postProgress(phase, `${parsedRows.length} satır normalize ediliyor`);

    const normalizeStarted = Date.now();
    const normalizedRows = await mapInChunks(
      parsedRows,
      function mapRow(row) {
        return normalizeBankParsedRow(row, bankName);
      },
      200,
      function onChunk(done, total) {
        postProgress(phase, `${done}/${total} hareket hazırlandı`);
      }
    );
    const normalizeMs = Date.now() - normalizeStarted;

    let parserBankId = bankName;
    if (parserBankId === "KUVEYTTURK" || parserBankId === "KUVEYTTÜRK") {
      parserBankId = "KUVEYT";
    }
    if (parserBankId === "VAKIF") parserBankId = "VAKIFBANK";
    const selectedCanonical =
      parserBankId === "KUVEYT" ? "KUVEYTTURK" : parserBankId;

    self.postMessage({
      type: "result",
      requestId,
      normalizedRows,
      parseMode: "worker",
      rawCount: sheetRows.length,
      selectedBank: selectedCanonical,
      parserBankId,
      timings: {
        parseMs,
        normalizeMs,
        totalMs: Date.now() - startedAt,
        rowCount: normalizedRows.length,
      },
    });
  } catch (error) {
    postError(requestId, error, phase);
  }
};

self.addEventListener("error", function onWorkerError(event) {
  console.warn("[bankParser.worker] uncaught", {
    message: event?.message || null,
    filename: event?.filename || null,
    lineno: event?.lineno ?? null,
    colno: event?.colno ?? null,
    errorName: event?.error?.name || null,
    errorMessage: event?.error?.message || null,
  });
  postError(
    null,
    event?.error || new Error(event?.message || "Worker script hatası"),
    "uncaught"
  );
});

self.addEventListener("unhandledrejection", function onUnhandled(event) {
  console.warn("[bankParser.worker] unhandledrejection", {
    reason:
      event?.reason?.message ||
      (typeof event?.reason === "string" ? event.reason : null) ||
      String(event?.reason || "unknown"),
  });
  postError(null, event?.reason, "unhandledrejection");
});
