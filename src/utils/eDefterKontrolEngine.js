import {
  BELGE_TARIH_FARK_GUN,
  BORC_ALACAK_TOLERANCE,
  E_DEFTER_FINDING_CODE,
  E_DEFTER_FINDING_STATUS,
  E_DEFTER_FINGERPRINT_STORAGE_KEY,
  E_DEFTER_HATA_TURU,
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
  E_DEFTER_KAYNAK,
  E_DEFTER_KONTROL_DURUM,
  E_DEFTER_KONTROL_GRUP,
  E_DEFTER_KONTROL_STATUS,
  E_DEFTER_RECORDS_STORAGE_KEY,
  E_DEFTER_REPORT_DISCLAIMER,
  E_DEFTER_RISK_LEVEL,
  E_DEFTER_SONUC_SEVIYE,
  E_DEFTER_TURU,
  KASA_BAKIYE_ESIK,
  NEAR_DATE_DAYS,
  mapLegacyLevelToSonuc,
  riskBandFromScore,
  riskLevelFromScore,
  sonucSeviyeFromScore,
} from "@/src/config/eDefterKontrolDefaults";
import { loadDeclarationAccrualRecords } from "@/src/utils/beyannameTahakkukEngine";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { normalizeParserText } from "@/src/utils/textNormalize";
import {
  EDEFTER_ERROR_CODE,
  buildContentFingerprint,
  createFingerprintSession,
  normalizePeriodKey,
  normalizeTaxId,
} from "@/src/utils/eDefterSecurity";
import {
  applyIdentityGateToSummary,
  evaluateEDefterCompanyIdentity,
  identityStatusToErrorCode,
} from "@/src/utils/eDefterCompanyIdentityGate";

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function findHeaderIndex(rows, matchers) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return matchers.every((matcher) => matcher(text));
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

function parseLedgerRow(row, headers, index, kaynak) {
  const tarih =
    getSheetCell(row, headers, ["TARİH", "TARIH", "FİŞ TARİHİ", "FIS TARIHI", "KAYIT TARIHI"]) ||
    "";

  const fisNo = String(
    getSheetCell(row, headers, ["FİŞ NO", "FIS NO", "FISNO", "YEVMIYE FIS NO"]) || ""
  ).trim();

  const yevmiyeNo = String(
    getSheetCell(row, headers, ["YEVMİYE NO", "YEVMIYE NO", "YEVMIYENO", "YEVMIYE"]) || ""
  ).trim();

  const hesapKodu = String(
    getSheetCell(row, headers, ["HESAP KODU", "HESAP KOD", "HESAP NO", "KOD"]) || ""
  ).trim();

  const hesapAdi = String(
    getSheetCell(row, headers, ["HESAP ADI", "HESAP AD", "HESAP ADI/UNVAN", "HESAP"]) || ""
  ).trim();

  const aciklama = String(
    getSheetCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "DETAY", "NOT"]) || ""
  ).trim();

  const belgeTuru = String(
    getSheetCell(row, headers, ["BELGE TÜRÜ", "BELGE TURU", "EVRAK TURU", "EVRAK TİPİ"]) || ""
  ).trim();

  const belgeNo = String(
    getSheetCell(row, headers, ["BELGE NO", "EVRAK NO", "FATURA NO"]) || ""
  ).trim();

  const belgeTarihi =
    getSheetCell(row, headers, ["BELGE TARİHİ", "BELGE TARIHI", "EVRAK TARIHI"]) || "";

  const borc = parseMoneyTR(getSheetCell(row, headers, ["BORÇ", "BORC"]));
  const alacak = parseMoneyTR(getSheetCell(row, headers, ["ALACAK"]));
  const cariUnvan = String(
    getSheetCell(row, headers, [
      "CARİ UNVAN",
      "CARI UNVAN",
      "CARİ ADI",
      "CARI ADI",
      "UNVAN",
      "MÜŞTERİ",
      "MUSTERI",
      "SATICI",
      "PAYEE",
      "PARTY",
    ]) || ""
  ).trim();

  const counterAccountCode = String(
    getSheetCell(row, headers, [
      "KARŞI HESAP",
      "KARSI HESAP",
      "KARŞI HESAP KODU",
      "KARSI HESAP KODU",
      "KARSİ HESAP",
      "COUNTER ACCOUNT",
      "COUNTERACCOUNT",
    ]) || ""
  ).trim();

  if (!tarih && !fisNo && !hesapKodu && !borc && !alacak) return null;

  return {
    id: `${kaynak}-${index + 1}`,
    kaynak,
    tarih: formatDateTR(tarih),
    fisNo,
    yevmiyeNo,
    hesapKodu,
    hesapAdi,
    aciklama,
    belgeTuru,
    belgeNo,
    belgeTarihi: belgeTarihi ? formatDateTR(belgeTarihi) : "",
    borc,
    alacak,
    cariUnvan,
    counterAccountCode,
    karsiHesapKodu: counterAccountCode,
    tutar: roundMoney(Math.max(borc, alacak)),
    kontrolDurumu: "",
    not: "",
    duzeltildiMi: false,
    disaridaBirak: false,
    manuallyEdited: false,
  };
}

function parseLedgerSheet(sheetRows = [], kaynak = E_DEFTER_KAYNAK.MUAVIN) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows, [
    (text) => text.includes("HESAP") || text.includes("BORC") || text.includes("BORÇ"),
    (text) => text.includes("TARIH") || text.includes("TARİH") || text.includes("FIS"),
  ]);

  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => parseLedgerRow(row, headers, index, kaynak))
    .filter(Boolean);
}

/** Luca muavin account header: `120.01.PDİ01 UNVAN` — Unicode letters in segments. */
const LUCA_ACCOUNT_SEGMENT_RE = "[\\p{L}\\p{N}]";
const LUCA_ACCOUNT_CODE_RE = new RegExp(
  `^(\\d{3}(?:[./]${LUCA_ACCOUNT_SEGMENT_RE}{1,8})*)\\s+(.+)$`,
  "u"
);

function preserveFisNo(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value.trim();
  return String(value);
}

function isLucaMuavinSkipLabel(rowText = "") {
  const t = compactText(rowText);
  if (!t) return true;
  if (t.includes("NAKLIYEKUNHARIC")) return true;
  if (t.includes("GENELTOPLAM")) return true;
  return false;
}

function isLucaMuavinColumnHeaderRow(row = []) {
  const cells = (row || []).map((cell) => normalizeParserText(cell));
  const hasTarih = cells.some((c) => c === "TARIH" || c.includes("TARIH"));
  const hasTip = cells.some((c) => c === "TIP" || c.includes("TIP"));
  const hasFis = cells.some((c) => c.includes("FISNO") || c.includes("FIS NO"));
  const hasBorc = cells.some((c) => c.includes("BORC"));
  const hasAlacak = cells.some((c) => c.includes("ALACAK"));
  const hasHesapCol = cells.some((c) => c.includes("HESAPKODU") || c.includes("HESAP KODU"));
  return hasTarih && hasTip && hasFis && hasBorc && hasAlacak && !hasHesapCol;
}

function buildLucaColumnMap(headerRow = []) {
  const headers = (headerRow || []).map((cell) => compactText(normalizeParserText(cell)));
  const findIndex = (matchers) =>
    headers.findIndex((header) =>
      matchers.some((matcher) => {
        const wanted = compactText(matcher);
        return header === wanted || header.includes(wanted);
      })
    );

  return {
    tarih: findIndex(["TARİH", "TARIH"]),
    tip: findIndex(["TİP", "TIP"]),
    fisNo: findIndex(["FİŞ NO", "FIS NO", "FISNO"]),
    aciklama: findIndex(["AÇIKLAMA", "ACIKLAMA"]),
    borc: findIndex(["BORÇ", "BORC"]),
    alacak: findIndex(["ALACAK"]),
    bakiye: findIndex(["BAKİYE", "BAKIYE"]),
    ba: findIndex(["B/A"]),
  };
}

function lucaCell(row, index) {
  if (index < 0 || !Array.isArray(row)) return "";
  return row[index] ?? "";
}

export function parseLucaAccountHeaderCell(cell) {
  const text = String(cell ?? "").trim();
  if (!text) return null;
  if (parseDateTR(text)) return null;

  const match = text.match(LUCA_ACCOUNT_CODE_RE);
  if (!match) return null;

  const hesapKodu = match[1].trim();
  const hesapAdi = match[2].trim();
  if (!hesapAdi) return null;

  const adiCompact = compactText(hesapAdi);
  if (adiCompact.includes("TARIH") && adiCompact.includes("FIS")) return null;

  return { hesapKodu, hesapAdi };
}

export function detectLucaMultiAccountMuavinLayout(sheetRows = []) {
  if (!Array.isArray(sheetRows) || sheetRows.length < 4) return false;

  let accountHeaders = 0;
  let columnHeaders = 0;

  for (const row of sheetRows) {
    if (!Array.isArray(row) || !row.some((cell) => String(cell ?? "").trim())) continue;
    if (parseLucaAccountHeaderCell(row[0])) accountHeaders += 1;
    if (isLucaMuavinColumnHeaderRow(row)) columnHeaders += 1;
  }

  return accountHeaders >= 1 && columnHeaders >= 1;
}

export function parseLucaMultiAccountMuavinSheet(sheetRows = []) {
  const rows = [];
  let activeAccount = { hesapKodu: "", hesapAdi: "" };
  let colMap = null;
  let movementIndex = 0;

  for (const row of sheetRows) {
    if (!Array.isArray(row) || !row.some((cell) => String(cell ?? "").trim())) continue;

    const rowText = row.map((cell) => String(cell ?? "")).join(" ");
    if (isLucaMuavinSkipLabel(rowText)) continue;

    const accountHeader = parseLucaAccountHeaderCell(row[0]);
    if (accountHeader) {
      const restHasDate = row.slice(1).some((cell) => parseDateTR(cell));
      if (!restHasDate) {
        activeAccount = accountHeader;
        continue;
      }
    }

    if (isLucaMuavinColumnHeaderRow(row)) {
      colMap = buildLucaColumnMap(row);
      continue;
    }

    if (!colMap || !activeAccount.hesapKodu) continue;

    const tarihRaw = lucaCell(row, colMap.tarih);
    if (!parseDateTR(tarihRaw)) continue;

    const borc = parseMoneyTR(lucaCell(row, colMap.borc));
    const alacak = parseMoneyTR(lucaCell(row, colMap.alacak));
    if (!borc && !alacak) continue;

    movementIndex += 1;
    const aciklama = String(lucaCell(row, colMap.aciklama) ?? "").trim();
    const tip = String(lucaCell(row, colMap.tip) ?? "").trim();

    rows.push({
      id: `${E_DEFTER_KAYNAK.MUAVIN}-luca-${movementIndex}`,
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: formatDateTR(tarihRaw),
      fisNo: preserveFisNo(lucaCell(row, colMap.fisNo)),
      yevmiyeNo: "",
      hesapKodu: activeAccount.hesapKodu,
      hesapAdi: activeAccount.hesapAdi,
      aciklama: aciklama || tip,
      belgeTuru: tip,
      belgeNo: "",
      belgeTarihi: "",
      borc,
      alacak,
      cariUnvan: "",
      counterAccountCode: "",
      karsiHesapKodu: "",
      tutar: roundMoney(Math.max(borc, alacak)),
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
    });
  }

  return rows;
}

export function parseMuavinSheet(sheetRows = []) {
  if (!sheetRows?.length) return [];
  if (detectLucaMultiAccountMuavinLayout(sheetRows)) {
    const lucaRows = parseLucaMultiAccountMuavinSheet(sheetRows);
    if (!lucaRows.length) {
      throw Object.assign(new Error("Luca muavin bloğu ayrıştırılamadı."), {
        code: "UNSUPPORTED_MUAVIN_LAYOUT",
      });
    }
    return lucaRows;
  }
  return parseLedgerSheet(sheetRows, E_DEFTER_KAYNAK.MUAVIN);
}

/** Structural yevmiye layouts — never decide by vendor/file name. */
export const YEVMIYE_LAYOUT = {
  STANDARD_COLUMN: "STANDARD_COLUMN",
  REPEATED_JOURNAL_BLOCK: "REPEATED_JOURNAL_BLOCK",
  UNKNOWN: "UNKNOWN",
};

const YEVMIYE_BLOCK_HEADER_RE =
  /^(\d+)\s*-{3,}\s*(\d+)\s*-{3,}\s*(.+?)\s*-{3,}\s*(.+)$/;

/** Luca block headers use DD/MM/YYYY with slashes — never MM/DD. */
export function formatLucaBlockHeaderDateTR(value) {
  const text = String(value ?? "").trim();
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900) {
      return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
    }
  }
  return formatDateTR(text);
}

export function parseYevmiyeBlockHeaderCell(value) {
  const text = String(value ?? "").trim();
  if (!text || !text.includes("---")) return null;
  const match = text.match(YEVMIYE_BLOCK_HEADER_RE);
  if (!match) return null;
  const tarihRaw = match[4].trim();
  const tarih = formatLucaBlockHeaderDateTR(tarihRaw);
  if (!tarih || !parseDateTR(tarih)) return null;
  return {
    fisNo: preserveFisNo(match[1]),
    yevmiyeNo: preserveFisNo(match[2]),
    fisTuru: String(match[3] || "").trim(),
    tarihRaw,
    tarih,
  };
}

function isYevmiyeBlockColumnHeaderRow(row = []) {
  const corpus = (row || [])
    .map((cell) => compactText(cell))
    .join(" ");
  return (
    corpus.includes("HESAPKODU") &&
    corpus.includes("HESAPADI") &&
    (corpus.includes("BORC") || corpus.includes("ALACAK"))
  );
}

function isYevmiyeBlockSkipRow(codeCell = "") {
  const text = String(codeCell || "").trim();
  if (!text) return true;
  const compact = compactText(text);
  return (
    compact.startsWith("TOPLAM") ||
    compact.startsWith("FISACIKLAMA") ||
    compact === "YEVMIYEDEFTERI" ||
    compact.startsWith("DONEM") ||
    compact.startsWith("TARIHARALIGI")
  );
}

/**
 * Detect yevmiye sheet structure from content only.
 * REPEATED_JOURNAL_BLOCK: `fisNo-----yevmiyeNo-----tür-----tarih` + column headers.
 */
export function detectYevmiyeLayout(sheetRows = []) {
  if (!Array.isArray(sheetRows) || sheetRows.length < 3) return YEVMIYE_LAYOUT.UNKNOWN;

  let blockHeaders = 0;
  let columnHeaders = 0;
  let standardDateHits = 0;
  let standardFisHits = 0;

  for (const row of sheetRows.slice(0, 400)) {
    if (!Array.isArray(row) || !row.some((cell) => String(cell ?? "").trim())) continue;
    if (parseYevmiyeBlockHeaderCell(row[0])) blockHeaders += 1;
    if (isYevmiyeBlockColumnHeaderRow(row)) columnHeaders += 1;

    const corpus = (row || []).map((cell) => compactText(cell)).join(" ");
    if (corpus.includes("TARIH") && (corpus.includes("FISNO") || corpus.includes("YEVMIYENO"))) {
      standardFisHits += 1;
    }
    if (row.some((cell) => parseDateTR(cell)) && row.length >= 5) {
      standardDateHits += 1;
    }
  }

  if (blockHeaders >= 1 && columnHeaders >= 1) {
    return YEVMIYE_LAYOUT.REPEATED_JOURNAL_BLOCK;
  }

  // Classic flat export: header with tarih+fiş and dated data rows.
  if (standardFisHits >= 1 && standardDateHits >= 2 && blockHeaders === 0) {
    return YEVMIYE_LAYOUT.STANDARD_COLUMN;
  }

  return YEVMIYE_LAYOUT.UNKNOWN;
}

/**
 * Luca YEVMİYE DEFTERİ repeated voucher blocks.
 * Leaf movements: leading whitespace on hesap kodu; amount in DETAY (col3),
 * side inherited from nearest ancestor that posted to BORÇ (col4) or ALACAK (col5).
 */
export function parseLucaRepeatedJournalBlockYevmiyeSheet(sheetRows = []) {
  const rows = [];
  let block = null;
  let side = null; // "B" | "A"
  let movementIndex = 0;

  for (const row of sheetRows) {
    if (!Array.isArray(row) || !row.some((cell) => String(cell ?? "").trim())) continue;

    const header = parseYevmiyeBlockHeaderCell(row[0]);
    if (header) {
      block = {
        fisNo: header.fisNo,
        yevmiyeNo: header.yevmiyeNo,
        fisTuru: header.fisTuru,
        tarih: header.tarih || formatLucaBlockHeaderDateTR(header.tarihRaw),
      };
      side = null;
      continue;
    }

    if (!block) continue;
    if (isYevmiyeBlockColumnHeaderRow(row)) continue;

    const codeCell = String(row[0] ?? "");
    if (isYevmiyeBlockSkipRow(codeCell)) continue;

    const leading = (codeCell.match(/^(\s*)/) || ["", ""])[1].length;
    const hesapKodu = codeCell.trim();
    if (!hesapKodu) continue;

    const detayAmt = parseMoneyTR(row[3]);
    const borcCol = parseMoneyTR(row[4]);
    const alacakCol = parseMoneyTR(row[5]);

    if (leading === 0) {
      // Hierarchy / rollup — establish side from BORÇ/ALACAK columns; never count as movement.
      if (borcCol > 0 && alacakCol <= 0) side = "B";
      else if (alacakCol > 0 && borcCol <= 0) side = "A";
      continue;
    }

    // Leaf detail line (indented hesap kodu).
    let borc = 0;
    let alacak = 0;
    if (detayAmt > 0) {
      if (side === "B") borc = detayAmt;
      else if (side === "A") alacak = detayAmt;
      else continue;
    } else if (borcCol > 0 && alacakCol <= 0) {
      borc = borcCol;
    } else if (alacakCol > 0 && borcCol <= 0) {
      alacak = alacakCol;
    } else {
      continue;
    }

    movementIndex += 1;
    const hesapAdi = String(row[1] ?? "").trim();
    const aciklama = String(row[2] ?? "").trim();

    rows.push({
      id: `${E_DEFTER_KAYNAK.YEVMIYE}-luca-block-${movementIndex}`,
      kaynak: E_DEFTER_KAYNAK.YEVMIYE,
      documentClass: "YEVMIYE",
      tarih: block.tarih,
      fisNo: block.fisNo,
      yevmiyeNo: block.yevmiyeNo,
      fisTuru: block.fisTuru,
      hesapKodu,
      hesapAdi,
      aciklama,
      belgeTuru: block.fisTuru,
      belgeNo: "",
      belgeTarihi: "",
      borc: roundMoney(borc),
      alacak: roundMoney(alacak),
      cariUnvan: "",
      counterAccountCode: "",
      karsiHesapKodu: "",
      tutar: roundMoney(Math.max(borc, alacak)),
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
    });
  }

  return rows;
}

export function parseYevmiyeSheet(sheetRows = []) {
  if (!sheetRows?.length) return [];
  const layout = detectYevmiyeLayout(sheetRows);
  if (layout === YEVMIYE_LAYOUT.REPEATED_JOURNAL_BLOCK) {
    return parseLucaRepeatedJournalBlockYevmiyeSheet(sheetRows);
  }
  return parseLedgerSheet(sheetRows, E_DEFTER_KAYNAK.YEVMIYE);
}

export function parseMizanSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows, [
    (text) => text.includes("HESAP"),
    (text) => text.includes("BORC") || text.includes("BORÇ") || text.includes("BAKIYE"),
  ]);

  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const hesapKodu = String(
        getSheetCell(row, headers, ["HESAP KODU", "HESAP KOD", "KOD"]) || ""
      ).trim();
      const hesapAdi = String(
        getSheetCell(row, headers, ["HESAP ADI", "HESAP AD", "HESAP"]) || ""
      ).trim();
      const borc = parseMoneyTR(
        getSheetCell(row, headers, ["BORÇ", "BORC", "BORÇ TOPLAMI", "BORC TOPLAMI"])
      );
      const alacak = parseMoneyTR(
        getSheetCell(row, headers, ["ALACAK", "ALACAK TOPLAMI"])
      );
      const bakiye = parseMoneyTR(
        getSheetCell(row, headers, ["BAKİYE", "BAKIYE", "NET BAKIYE"])
      );

      if (!hesapKodu && !borc && !alacak && !bakiye) return null;

      return {
        id: `mizan-${index + 1}`,
        kaynak: E_DEFTER_KAYNAK.MIZAN,
        tarih: "",
        fisNo: "",
        yevmiyeNo: "",
        hesapKodu,
        hesapAdi,
        aciklama: hesapAdi,
        belgeTuru: "",
        belgeNo: "",
        belgeTarihi: "",
        borc,
        alacak,
        cariUnvan: "",
        tutar: roundMoney(Math.max(borc, alacak, Math.abs(bakiye))),
        mizanBakiye: bakiye,
        kontrolDurumu: "",
        not: "",
        duzeltildiMi: false,
        disaridaBirak: false,
        manuallyEdited: false,
      };
    })
    .filter(Boolean);
}

export function parseEDefterListeSheet(sheetRows = []) {
  return parseLedgerSheet(sheetRows, E_DEFTER_KAYNAK.EDEFTER_LISTE);
}

function daysBetween(left, right) {
  const leftDate = parseDateTR(left);
  const rightDate = parseDateTR(right);
  if (!leftDate || !rightDate) return 999;
  return Math.abs(Math.round((leftDate.getTime() - rightDate.getTime()) / 86400000));
}

function extractNumeric(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

function accountPrefix(hesapKodu) {
  return String(hesapKodu || "").replace(/\./g, "").slice(0, 3);
}

function buildAccountBalanceMap(rows = []) {
  const map = new Map();

  for (const row of rows) {
    if (!row.hesapKodu || row.kaynak === E_DEFTER_KAYNAK.MIZAN) continue;
    const key = compactText(row.hesapKodu);
    const current = map.get(key) || { borc: 0, alacak: 0, hesapKodu: row.hesapKodu };
    current.borc += roundMoney(row.borc);
    current.alacak += roundMoney(row.alacak);
    map.set(key, current);
  }

  const result = new Map();
  for (const [key, item] of map.entries()) {
    result.set(key, {
      ...item,
      net: roundMoney(item.borc - item.alacak),
    });
  }

  return result;
}

/**
 * Resolve counterpart accounts only within the same voucher (fisNo) group.
 * Never invents from description/amount/date. Same-side legs are not counterparts.
 * Explicit Excel KARŞI HESAP is verified against opposite legs when available.
 */
export function resolveVoucherCounterparts(rows = []) {
  const byFis = new Map();
  const results = new Map();

  for (const row of rows) {
    if (!row || row.kaynak === E_DEFTER_KAYNAK.MIZAN) continue;
    if (
      row.kaynak === E_DEFTER_KAYNAK.TEKNIK ||
      row.kaynak === E_DEFTER_KAYNAK.VERGISEL ||
      row.kaynak === E_DEFTER_KAYNAK.CAPRAZ
    ) {
      continue;
    }
    const fisKey = compactText(row.fisNo);
    if (!fisKey) {
      results.set(row.id, {
        status: "REVIEW",
        code: E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW,
        counterAccountCode: "",
        candidates: [],
        confidence: 0,
        reason: "fis_missing",
      });
      continue;
    }
    const periodKey = compactText(row.period || row.donem || "");
    const groupKey = `${fisKey}|${compactText(row.kaynak) || "ledger"}|${periodKey}`;
    const list = byFis.get(groupKey) || [];
    list.push(row);
    byFis.set(groupKey, list);
  }

  for (const [, group] of byFis.entries()) {
    const sides = new Map();
    let totalBorc = 0;
    let totalAlacak = 0;
    const debitCodes = new Set();
    const creditCodes = new Set();
    let activeCount = 0;

    for (const row of group) {
      const borc = roundMoney(row.borc);
      const alacak = roundMoney(row.alacak);
      const zeroLeg =
        Math.abs(borc) <= BORC_ALACAK_TOLERANCE && Math.abs(alacak) <= BORC_ALACAK_TOLERANCE;
      if (zeroLeg) {
        sides.set(row.id, { zero: true, isDebit: false, isCredit: false, code: "" });
        continue;
      }
      const isDebit = borc > BORC_ALACAK_TOLERANCE && alacak <= BORC_ALACAK_TOLERANCE;
      const isCredit = alacak > BORC_ALACAK_TOLERANCE && borc <= BORC_ALACAK_TOLERANCE;
      const code = String(row.hesapKodu || "").trim();
      sides.set(row.id, { zero: false, isDebit, isCredit, code });
      activeCount += 1;
      totalBorc += borc;
      totalAlacak += alacak;
      if (isDebit && code) debitCodes.add(code);
      if (isCredit && code) creditCodes.add(code);
    }

    const balanced = Math.abs(roundMoney(totalBorc - totalAlacak)) <= BORC_ALACAK_TOLERANCE;

    for (const row of group) {
      const side = sides.get(row.id);
      if (!side || side.zero) {
        results.set(row.id, {
          status: "SKIP",
          code: "",
          counterAccountCode: "",
          candidates: [],
          confidence: 0,
          reason: "zero_amount",
        });
        continue;
      }

      const { isDebit, isCredit } = side;
      const selfCode = compactText(row.hesapKodu);
      const explicitRaw = String(row.counterAccountCode || row.karsiHesapKodu || "").trim();
      const explicit = compactText(explicitRaw);

      const oppositeCodes = [
        ...(isDebit ? creditCodes : isCredit ? debitCodes : []),
      ].filter((code) => compactText(code) !== selfCode);
      const uniqueCodes = [...new Set(oppositeCodes)];

      if (explicit) {
        if (explicit === selfCode) {
          results.set(row.id, {
            status: "ISSUE",
            code: E_DEFTER_ISSUE_CODE.COUNTERPART_SELF,
            counterAccountCode: "",
            candidates: [explicitRaw],
            confidence: 0,
            reason: "explicit_self",
          });
          continue;
        }
        if (uniqueCodes.length === 1 && compactText(uniqueCodes[0]) !== explicit) {
          results.set(row.id, {
            status: "ISSUE",
            code: E_DEFTER_ISSUE_CODE.COUNTERPART_CONFLICT,
            counterAccountCode: "",
            candidates: [explicitRaw, uniqueCodes[0]],
            confidence: 0,
            reason: "explicit_vs_computed",
            balanced,
          });
          continue;
        }
        if (uniqueCodes.length === 1 && compactText(uniqueCodes[0]) === explicit) {
          results.set(row.id, {
            status: "RESOLVED",
            code: E_DEFTER_ISSUE_CODE.COUNTERPART_VERIFIED,
            counterAccountCode: explicitRaw,
            candidates: [explicitRaw],
            confidence: 1,
            reason: "explicit_verified",
            balanced,
          });
          continue;
        }
        results.set(row.id, {
          status: "RESOLVED",
          code: "",
          counterAccountCode: explicitRaw,
          candidates: [explicitRaw],
          confidence: uniqueCodes.length ? 0.7 : 0.85,
          reason: uniqueCodes.length > 1 ? "explicit_with_multi_legs" : "explicit",
          balanced,
        });
        continue;
      }

      if (!isDebit && !isCredit) {
        results.set(row.id, {
          status: "REVIEW",
          code: E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW,
          counterAccountCode: "",
          candidates: [],
          confidence: 0,
          reason: "mixed_side_row",
        });
        continue;
      }

      if (!uniqueCodes.length) {
        let hasSameSidePeer = false;
        for (const other of group) {
          if (other.id === row.id) continue;
          const o = sides.get(other.id);
          if (!o || o.zero) continue;
          if ((isDebit && o.isDebit) || (isCredit && o.isCredit)) {
            hasSameSidePeer = true;
            break;
          }
        }
        results.set(row.id, {
          status: "ISSUE",
          code: hasSameSidePeer
            ? E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE
            : E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART,
          counterAccountCode: "",
          candidates: [],
          confidence: 0,
          reason: hasSameSidePeer ? "same_side_only" : "no_opposite",
          balanced,
        });
        continue;
      }

      if (uniqueCodes.length === 1) {
        results.set(row.id, {
          status: "RESOLVED",
          code: "",
          counterAccountCode: uniqueCodes[0],
          candidates: uniqueCodes,
          confidence: balanced ? 0.95 : 0.6,
          reason: activeCount === 2 ? "two_line_pair" : "single_opposite_code",
          balanced,
        });
        continue;
      }

      results.set(row.id, {
        status: "MULTI",
        code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
        counterAccountCode: "",
        candidates: uniqueCodes,
        confidence: 0.4,
        reason: "multi_opposite",
        balanced,
      });
    }
  }

  return results;
}

function buildFisBalanceMap(rows = []) {
  const map = new Map();

  for (const row of rows) {
    if (!row.fisNo || row.kaynak === E_DEFTER_KAYNAK.MIZAN) continue;
    const key = compactText(row.fisNo);
    const current = map.get(key) || { borc: 0, alacak: 0, fisNo: row.fisNo, tarih: row.tarih };
    current.borc += roundMoney(row.borc);
    current.alacak += roundMoney(row.alacak);
    if (row.tarih) current.tarih = row.tarih;
    map.set(key, current);
  }

  const result = new Map();
  for (const [key, item] of map.entries()) {
    result.set(key, {
      ...item,
      fark: roundMoney(item.borc - item.alacak),
    });
  }

  return result;
}

function analyzeAccountBalanceIssues(hesapKodu, net) {
  const issues = [];
  let riskScore = 0;
  const prefix = accountPrefix(hesapKodu);

  if (prefix.startsWith("100") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "Kasa hesabında olağan dışı yüksek bakiye (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 10,
    });
    riskScore += 10;
  }

  // Period e-defter packages usually lack opening balances; reverse-looking
  // period nets are review signals, not automatic unsuitability.
  if (prefix.startsWith("120") && net < -BORC_ALACAK_TOLERANCE) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "120 alıcı hesabında dönem hareketi ters bakiye görünümü (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 12,
    });
    riskScore += 12;
  }

  if (prefix.startsWith("320") && net > BORC_ALACAK_TOLERANCE) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "320 satıcı hesabında dönem hareketi ters bakiye görünümü (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 12,
    });
    riskScore += 12;
  }

  if (prefix.startsWith("191") && net < -BORC_ALACAK_TOLERANCE) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "191 indirilecek KDV hesabında dönem hareketi ters bakiye görünümü (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 12,
    });
    riskScore += 12;
  }

  if (prefix.startsWith("391") && net > BORC_ALACAK_TOLERANCE) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "391 hesaplanan KDV hesabında dönem hareketi ters bakiye görünümü (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 12,
    });
    riskScore += 12;
  }

  if (prefix.startsWith("360") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "360 ödenecek vergi hesabında olağandışı bakiye (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 10,
    });
    riskScore += 10;
  }

  if (prefix.startsWith("361") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "361 SGK/borç hesabında olağandışı bakiye (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 10,
    });
    riskScore += 10;
  }

  if (prefix.startsWith("102") && net < -BORC_ALACAK_TOLERANCE) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "102 banka hesabında dönem hareketi ters bakiye görünümü (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 10,
    });
    riskScore += 10;
  }

  if (prefix.startsWith("180") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "180 gelecek aylara ait giderlerde olağandışı bakiye (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 8,
    });
    riskScore += 8;
  }

  if (prefix.startsWith("280") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: "280 gelecek yıllara ait giderlerde olağandışı bakiye (inceleme bilgisi).",
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      riskScore: 8,
    });
    riskScore += 8;
  }

  if (prefix.startsWith("309") || prefix.startsWith("409")) {
    if (Math.abs(net) > KASA_BAKIYE_ESIK) {
      issues.push({
        code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
        message: `${prefix.slice(0, 3)} alınan/verilen çeklerde olağandışı bakiye (inceleme bilgisi).`,
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 8,
      });
      riskScore += 8;
    }
  }

  if (prefix.startsWith("335") || prefix.startsWith("195") || prefix.startsWith("196")) {
    if (Math.abs(net) > BORC_ALACAK_TOLERANCE) {
      issues.push({
        code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
        message: `${prefix.slice(0, 3)} personel/avans hesabında bakiye risk göstergesi (inceleme bilgisi).`,
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 8,
      });
      riskScore += 8;
    }
  }

  if (
    !prefix.startsWith("120") &&
    !prefix.startsWith("320") &&
    !prefix.startsWith("191") &&
    !prefix.startsWith("391") &&
    !prefix.startsWith("100") &&
    Math.abs(net) > 0.01
  ) {
    const hesap = String(hesapKodu || "");
    if (hesap.startsWith("1") && net < -BORC_ALACAK_TOLERANCE) {
      issues.push({
        code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
        message: "Aktif hesapta dönem hareketi ters bakiye görünümü (inceleme bilgisi).",
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 8,
      });
      riskScore += 8;
    }
    if (hesap.startsWith("3") && net > BORC_ALACAK_TOLERANCE) {
      issues.push({
        code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
        message: "Pasif hesapta dönem hareketi ters bakiye görünümü (inceleme bilgisi).",
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 8,
      });
      riskScore += 8;
    }
  }

  return { issues, riskScore };
}

function buildGlobalContext(rows = []) {
  const ledgerRows = rows.filter((row) => row.kaynak !== E_DEFTER_KAYNAK.MIZAN);
  const accountBalances = buildAccountBalanceMap(ledgerRows);
  const fisBalances = buildFisBalanceMap(ledgerRows);

  const problematicAccounts = new Map();
  for (const [key, balance] of accountBalances.entries()) {
    const analysis = analyzeAccountBalanceIssues(balance.hesapKodu, balance.net);
    if (analysis.issues.length) {
      problematicAccounts.set(key, analysis);
    }
  }

  const unbalancedFis = new Set();
  for (const [key, balance] of fisBalances.entries()) {
    if (Math.abs(balance.fark) > BORC_ALACAK_TOLERANCE) {
      unbalancedFis.add(key);
    }
  }

  const fisDateMap = new Map();
  for (const row of ledgerRows) {
    if (!row.fisNo || !row.tarih) continue;
    const key = compactText(row.fisNo);
    if (!fisDateMap.has(key)) {
      fisDateMap.set(key, row.tarih);
    }
  }

  const fisEntries = [...fisDateMap.entries()]
    .map(([key, tarih]) => ({
      key,
      fisNo: key,
      numeric: extractNumeric(key),
      tarih,
      dateValue: parseDateTR(tarih)?.getTime() || 0,
    }))
    .filter((item) => !Number.isNaN(item.numeric))
    .sort((a, b) => a.numeric - b.numeric);

  const fisNoGaps = [];
  for (let index = 1; index < fisEntries.length; index += 1) {
    const prev = fisEntries[index - 1].numeric;
    const current = fisEntries[index].numeric;
    if (current - prev > 1) {
      fisNoGaps.push({ from: prev, to: current });
    }
  }

  const outOfOrderFis = new Set();
  for (let index = 1; index < fisEntries.length; index += 1) {
    if (fisEntries[index].dateValue < fisEntries[index - 1].dateValue) {
      outOfOrderFis.add(fisEntries[index].key);
      outOfOrderFis.add(fisEntries[index - 1].key);
    }
  }

  const allText = ledgerRows
    .map((row) => `${row.aciklama} ${row.hesapAdi} ${row.belgeTuru}`.toLocaleLowerCase("tr-TR"))
    .join(" ");

  const fisLineCounts = new Map();
  const exactLineCounts = new Map();
  const nearKeys = new Map();

  for (const row of ledgerRows) {
    if (row.fisNo && row.kaynak !== E_DEFTER_KAYNAK.MIZAN) {
      const fk = compactText(row.fisNo);
      fisLineCounts.set(fk, (fisLineCounts.get(fk) || 0) + 1);
    }
    // True duplicate = identical line fingerprint including fis/yevmiye identity.
    // Shared belgeNo across multi-line entries is normal; Yevmiye≠Kebir (kaynak).
    if (row.belgeNo || row.hesapKodu || row.fisNo) {
      const ek = [
        compactText(row.fisNo),
        compactText(row.yevmiyeNo),
        compactText(row.belgeNo),
        compactText(row.hesapKodu),
        roundMoney(row.borc),
        roundMoney(row.alacak),
        compactText(row.tarih),
        compactText(row.kaynak),
      ].join("|");
      exactLineCounts.set(ek, (exactLineCounts.get(ek) || 0) + 1);
    }
    // Only real party names participate in similarity signals (never explanation text).
    if (row.tutar && row.cariUnvan && compactText(row.cariUnvan) !== compactText(row.aciklama)) {
      const nk = `${compactText(row.cariUnvan)}|${roundMoney(row.tutar)}`;
      const list = nearKeys.get(nk) || [];
      list.push(row);
      nearKeys.set(nk, list);
    }
  }

  return {
    accountBalances,
    problematicAccounts,
    unbalancedFis,
    fisNoGaps,
    outOfOrderFis,
    fisLineCounts,
    exactLineCounts,
    nearKeys,
    counterpartByRowId: resolveVoucherCounterparts(ledgerRows),
    hasKapanisFisi: /kapan[ıi]s|7\/a|7a|gelir tablosu kapan/.test(allText),
    hasAmortisman: /amortisman/.test(allText),
    hasKurDegerleme: /kur de[ğg]erleme|kur fark[ıi]|de[ğg]erleme fark[ıi]/.test(allText),
  };
}

const ISSUE_SEVERITY_RANK = {
  [E_DEFTER_ISSUE_SEVERITY.BILGI]: 1,
  [E_DEFTER_ISSUE_SEVERITY.UYARI]: 2,
  [E_DEFTER_ISSUE_SEVERITY.KRITIK]: 3,
};

const GROUP_PRIORITY = {
  [E_DEFTER_KONTROL_GRUP.KRITIK]: 100,
  [E_DEFTER_KONTROL_GRUP.CAPRAZ]: 95,
  [E_DEFTER_KONTROL_GRUP.MUKERRER]: 80,
  [E_DEFTER_KONTROL_GRUP.TERS_BAKIYE]: 70,
  [E_DEFTER_KONTROL_GRUP.EKSIK_BILGI]: 60,
  [E_DEFTER_KONTROL_GRUP.DONEM_SONU]: 50,
  [E_DEFTER_KONTROL_GRUP.KDV_KONTROL]: 45,
  [E_DEFTER_KONTROL_GRUP.VERGISEL]: 40,
  [E_DEFTER_KONTROL_GRUP.TEKNIK]: 35,
  [E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI]: 30,
  [E_DEFTER_KONTROL_GRUP.HATASIZ]: 0,
};

/** Structured issue factory — single contract for engine/UI/persist. */
export function createEDefterIssue({
  code = E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
  message = "",
  severity = E_DEFTER_ISSUE_SEVERITY.UYARI,
  group = E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
  blocking = false,
  source = "engine",
  riskScore = 0,
} = {}) {
  const safeMessage = String(message || "").trim() || "Tanımsız bulgu.";
  const safeSeverity =
    ISSUE_SEVERITY_RANK[severity] != null ? severity : E_DEFTER_ISSUE_SEVERITY.UYARI;
  const safeBlocking =
    Boolean(blocking) || safeSeverity === E_DEFTER_ISSUE_SEVERITY.KRITIK;
  return {
    code: String(code || E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE),
    message: safeMessage,
    severity: safeSeverity,
    group: group || E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
    blocking: safeBlocking,
    source: String(source || "engine"),
    riskScore: Math.max(0, Number(riskScore) || 0),
  };
}

/** Legacy string / unknown object → structured issue (fail-closed). */
export function normalizeEDefterIssue(raw, source = "engine") {
  if (raw && typeof raw === "object" && raw.message) {
    return createEDefterIssue({
      code: raw.code || E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: raw.message,
      severity: raw.severity || E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: raw.group || E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      blocking: raw.blocking,
      source: raw.source || source,
      riskScore: raw.riskScore,
    });
  }
  const message = String(raw || "").trim();
  if (!message) return null;
  const lower = message.toLocaleLowerCase("tr-TR");

  // Keyword fallback — never returns HATASIZ when a message exists.
  if (lower.includes("hesap planında yok")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.ACCOUNT_NOT_IN_PLAN,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 35,
    });
  }
  if (lower.includes("dönem dışı")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 30,
    });
  }
  if (lower.includes("negatif tutar")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.NEGATIVE_AMOUNT,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 40,
    });
  }
  if (lower.includes("dengesi bozuk") || lower.includes("borç/alacak")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.DEBIT_CREDIT_MISMATCH,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 45,
    });
  }
  if (lower.includes("mükerrer") || lower.includes("mukerrer") || lower.includes("tekrar")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.MUKERRER,
      blocking: false,
      source,
      riskScore: 25,
    });
  }
  if (lower.includes("açıklama boş")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.MISSING_DESCRIPTION,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
      blocking: false,
      source,
      riskScore: 10,
    });
  }
  if (
    lower.includes("hesap kodu boş") ||
    lower.includes("belge türü boş") ||
    lower.includes("yevmiye no eksik")
  ) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
      blocking: false,
      source,
      riskScore: 15,
    });
  }
  if (lower.includes("atlama") || lower.includes("tarih sırası")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.JOURNAL_SEQUENCE_GAP,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 50,
    });
  }
  if (
    lower.includes("inceleme bilgisi") ||
    lower.includes("olağandışı bakiye") ||
    lower.includes("olagan disi bakiye") ||
    lower.includes("olağan dışı yüksek bakiye")
  ) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      blocking: false,
      source,
      riskScore: 8,
    });
  }
  if (lower.includes("ters bakiye")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      blocking: false,
      source,
      riskScore: 10,
    });
  }
  if (lower.includes("kasa hesab")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      blocking: false,
      source,
      riskScore: 10,
    });
  }
  if (lower.includes("kdv")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.KDV_KONTROL,
      blocking: false,
      source,
      riskScore: 20,
    });
  }
  if (lower.includes("dönem sonu") || lower.includes("kapan") || lower.includes("amortisman")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
      blocking: false,
      source,
      riskScore: 20,
    });
  }
  if (lower.includes("yuvarlama")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      blocking: false,
      source,
      riskScore: 10,
    });
  }

  return createEDefterIssue({
    code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
    message,
    severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
    group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
    blocking: false,
    source,
    riskScore: 20,
  });
}

export function classifyEDefterIssues(rawIssues = []) {
  const issueDetails = [];
  const seen = new Set();
  for (const raw of rawIssues || []) {
    const issue = normalizeEDefterIssue(raw);
    if (!issue) continue;
    const dedupeKey = `${issue.code}|${issue.message}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    issueDetails.push(issue);
  }

  if (!issueDetails.length) {
    return {
      issueDetails: [],
      issues: [],
      primaryGroup: E_DEFTER_KONTROL_GRUP.HATASIZ,
      riskScore: 0,
      maxSeverity: null,
      hasBlocking: false,
      hasNonInfo: false,
    };
  }

  let primaryGroup = E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI;
  let bestGroupRank = -1;
  let riskScore = 0;
  let maxSeverity = E_DEFTER_ISSUE_SEVERITY.BILGI;
  let hasBlocking = false;
  let hasNonInfo = false;

  for (const issue of issueDetails) {
    riskScore += issue.riskScore || 0;
    if (issue.blocking) hasBlocking = true;
    if (issue.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI) hasNonInfo = true;
    if ((ISSUE_SEVERITY_RANK[issue.severity] || 0) > (ISSUE_SEVERITY_RANK[maxSeverity] || 0)) {
      maxSeverity = issue.severity;
    }
    const rank = GROUP_PRIORITY[issue.group] ?? GROUP_PRIORITY[E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI];
    if (rank > bestGroupRank) {
      bestGroupRank = rank;
      primaryGroup = issue.group || E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI;
    }
  }

  // Fail-closed: issues present ⇒ never HATASIZ.
  if (primaryGroup === E_DEFTER_KONTROL_GRUP.HATASIZ) {
    primaryGroup = E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI;
  }

  return {
    issueDetails,
    issues: issueDetails.map((item) => item.message),
    primaryGroup,
    riskScore: Math.max(1, Math.min(100, riskScore)),
    maxSeverity,
    hasBlocking,
    hasNonInfo,
  };
}

function buildIssues(row, _allRows = [], context = {}) {
  const raw = [];
  const fisKey = compactText(row.fisNo);
  const hesapKey = compactText(row.hesapKodu);

  if (!row.hesapKodu) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO,
        message: "Hesap kodu boş.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
        riskScore: 20,
      })
    );
  }

  if (!row.aciklama) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MISSING_DESCRIPTION,
        message: "Açıklama boş.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
        riskScore: 10,
      })
    );
  }

  if (!row.belgeTuru && row.kaynak !== E_DEFTER_KAYNAK.MIZAN) {
    // XBRL e-defter satırlarında documentType sıkça yok; uygunluğu düşürmez.
    // Muavin-only: belge türü boşluğu BİLGİ kalır; genel sonucu Uyarı yapmaz.
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO,
        message: "Belge türü boş (inceleme bilgisi).",
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 5,
      })
    );
  }

  const isMuavinRow =
    row.kaynak === E_DEFTER_KAYNAK.MUAVIN ||
    row.documentClass === "MUAVIN" ||
    context.documentClass === "MUAVIN";
  const yevmiyeEvidencePresent = Boolean(context.yevmiyeEvidencePresent);
  // Muavin FİŞ NO ≠ yevmiye no. Ayrı yevmiye dosyası yoksa bu alan doğal kapsam dışı.
  const requireYevmiyeNo =
    row.kaynak !== E_DEFTER_KAYNAK.MIZAN &&
    !(isMuavinRow && !yevmiyeEvidencePresent);
  if (!row.yevmiyeNo && requireYevmiyeNo) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO,
        message: "Yevmiye no eksik.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
        riskScore: 15,
      })
    );
  }

  if (context.unbalancedFis?.has(fisKey) && row.fisNo) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.DEBIT_CREDIT_MISMATCH,
        message: "Fiş borç/alacak dengesi bozuk.",
        severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
        group: E_DEFTER_KONTROL_GRUP.KRITIK,
        blocking: true,
        riskScore: 45,
      })
    );
  }

  const counterpart = context.counterpartByRowId?.get(row.id);
  const isMuavinOnly = isMuavinRow;
  if (counterpart?.code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART,
        message: `Birden fazla karşıt hesap adayı (${counterpart.candidates.length}) — otomatik tek karşıt uydurulmadı.`,
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 12,
      })
    );
  } else if (counterpart?.code === E_DEFTER_ISSUE_CODE.COUNTERPART_CONFLICT) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.COUNTERPART_CONFLICT,
        message: "Excel karşı hesap ile fiş bacaklarından hesaplanan karşıt çelişiyor.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 32,
      })
    );
  } else if (counterpart?.code === E_DEFTER_ISSUE_CODE.COUNTERPART_VERIFIED) {
    // Verified explicit column — no issue noise.
  } else if (counterpart?.code === E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART) {
    // Muavin is often a single-account extract; missing opposite leg is expected.
    // Full journal (yevmiye) stays fail-closed review/uyarı.
    if (!isMuavinOnly) {
      raw.push(
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART,
          message: "Aynı fişte karşıt hesap bacağı bulunamadı.",
          severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
          group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
          riskScore: 25,
        })
      );
    }
  } else if (counterpart?.code === E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE) {
    if (!isMuavinOnly) {
      raw.push(
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE,
          message: "Aynı fişte yalnız aynı yönlü satırlar var; karşıt hesap bağlanamaz.",
          severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
          group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
          riskScore: 28,
        })
      );
    }
  } else if (counterpart?.code === E_DEFTER_ISSUE_CODE.COUNTERPART_SELF) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.COUNTERPART_SELF,
        message: "Hesap kendisine karşıt olarak işaretlenmiş.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 30,
      })
    );
  } else if (counterpart?.code === E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW,
        message: "Karşıt hesap güvenli çözülemedi (fiş kimliği eksik veya belirsiz) — inceleme gerekli.",
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 10,
      })
    );
  }

  if (context.outOfOrderFis?.has(fisKey) && row.fisNo) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.JOURNAL_SEQUENCE_GAP,
        message: "Tarih sırası bozuk fiş.",
        severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
        group: E_DEFTER_KONTROL_GRUP.KRITIK,
        blocking: true,
        riskScore: 20,
      })
    );
  }

  if (row.belgeTarihi && row.tarih && daysBetween(row.belgeTarihi, row.tarih) > BELGE_TARIH_FARK_GUN) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.DOCUMENT_DATE_GAP,
        message: "Belge tarihi ile fiş tarihi arasında anlamlı fark var.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 15,
      })
    );
  }

  // Multi-line fiş is normal in e-Defter; do not treat line density as duplicate.

  const exactLineKey = [
    compactText(row.fisNo),
    compactText(row.yevmiyeNo),
    compactText(row.belgeNo),
    compactText(row.hesapKodu),
    roundMoney(row.borc),
    roundMoney(row.alacak),
    compactText(row.tarih),
    compactText(row.kaynak),
  ].join("|");
  if (
    (row.belgeNo || row.hesapKodu || row.fisNo) &&
    (context.exactLineCounts?.get(exactLineKey) || 0) > 1
  ) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY,
        message: "Birebir aynı satır tekrarı (fiş+yevmiye+belge+hesap+tutar+tarih).",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.MUKERRER,
        riskScore: 30,
      })
    );
  }

  // Similarity signal only — never auto-unsuitable. Requires real cari ≠ explanation.
  if (
    row.tutar &&
    row.cariUnvan &&
    compactText(row.cariUnvan) !== compactText(row.aciklama) &&
    context.nearKeys
  ) {
    const nk = `${compactText(row.cariUnvan)}|${roundMoney(row.tutar)}`;
    const peers = context.nearKeys.get(nk) || [];
    const nearSimilar = peers.some((item) => {
      if (item.id === row.id) return false;
      if (compactText(item.fisNo) && compactText(row.fisNo) && compactText(item.fisNo) === compactText(row.fisNo)) {
        return false; // same voucher multi-line is normal
      }
      if (compactText(item.kaynak) && compactText(row.kaynak) && compactText(item.kaynak) !== compactText(row.kaynak)) {
        return false; // Yevmiye vs Kebir views of same event
      }
      return daysBetween(item.tarih, row.tarih) <= NEAR_DATE_DAYS;
    });
    if (nearSimilar) {
      raw.push(
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY,
          message: "Benzer cari + tutar + yakın tarih (inceleme bilgisi).",
          severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
          group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
          riskScore: 8,
        })
      );
    }
  }

  if (row.tutar > 0 && row.tutar % 1000 === 0 && row.tutar >= 10000) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING,
        message: "Şüpheli yuvarlama kaydı.",
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 10,
      })
    );
  }

  if (Number(row.borc || 0) < 0 || Number(row.alacak || 0) < 0) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.NEGATIVE_AMOUNT,
        message: "Negatif tutar satırı.",
        severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
        group: E_DEFTER_KONTROL_GRUP.KRITIK,
        blocking: true,
        riskScore: 40,
      })
    );
  }

  if (
    Number(row.borc || 0) === 0 &&
    Number(row.alacak || 0) === 0 &&
    row.kaynak !== E_DEFTER_KAYNAK.MIZAN
  ) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.ZERO_AMOUNT,
        message: "Sıfır tutarlı satır.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 15,
      })
    );
  }

  if (context.accountPlanCodes instanceof Set && row.hesapKodu) {
    const code = String(row.hesapKodu).trim();
    const short = code.split(".")[0];
    const compactCode = compactText(code);
    if (
      !context.accountPlanCodes.has(code) &&
      !context.accountPlanCodes.has(compactCode) &&
      !context.accountPlanCodes.has(short)
    ) {
      raw.push(
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.ACCOUNT_NOT_IN_PLAN,
          message: "Hesap kodu hesap planında yok.",
          severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
          group: E_DEFTER_KONTROL_GRUP.KRITIK,
          blocking: true,
          riskScore: 35,
        })
      );
    }
  }

  if (context.expectedPeriodKey && row.tarih) {
    const d = parseDateTR(row.tarih);
    if (d) {
      const isMuavinRow =
        row.kaynak === E_DEFTER_KAYNAK.MUAVIN ||
        row.documentClass === "MUAVIN" ||
        context.documentClass === "MUAVIN";
      const isCumulativeYevmiyeRow =
        context.cumulativePeriod === true &&
        (row.kaynak === E_DEFTER_KAYNAK.YEVMIYE || row.documentClass === "YEVMIYE");
      const [yearStr, monthStr] = String(context.expectedPeriodKey).split("-");
      const expectedYear = Number(yearStr);
      const expectedMonth = Number(monthStr);
      const rowYear = d.getFullYear();
      const rowMonth = d.getMonth() + 1;
      const useCumulativePeriod = isMuavinRow || isCumulativeYevmiyeRow;
      const outOfPeriod = useCumulativePeriod
        ? !expectedYear ||
          !expectedMonth ||
          rowYear !== expectedYear ||
          rowMonth < 1 ||
          rowMonth > expectedMonth
        : `${rowYear}-${String(rowMonth).padStart(2, "0")}` !== context.expectedPeriodKey;

      if (outOfPeriod) {
        raw.push(
          createEDefterIssue({
            code: E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD,
            message: "Dönem dışı tarih.",
            severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
            group: E_DEFTER_KONTROL_GRUP.KRITIK,
            blocking: true,
            riskScore: 30,
          })
        );
      }
    }
  }

  // Repeated explanation text across vouchers is normal; do not mark duplicate.

  const accountIssue = context.problematicAccounts?.get(hesapKey);
  if (accountIssue?.issues?.length) {
    for (const msg of accountIssue.issues) {
      raw.push(normalizeEDefterIssue(msg, "account-balance"));
    }
  }

  return classifyEDefterIssues(raw);
}

function resolvePrimaryGroup(issues = [], row = {}) {
  const classified = classifyEDefterIssues(issues);
  if (classified.issueDetails.length > 0) return classified.primaryGroup;
  if (!row.hesapKodu || !row.aciklama || (!row.belgeTuru && row.kaynak !== E_DEFTER_KAYNAK.MIZAN)) {
    return E_DEFTER_KONTROL_GRUP.EKSIK_BILGI;
  }
  return E_DEFTER_KONTROL_GRUP.HATASIZ;
}

function resolveDurum(grup, row = {}) {
  if (row.kontrolDurumu) return row.kontrolDurumu;

  const map = {
    [E_DEFTER_KONTROL_GRUP.HATASIZ]: E_DEFTER_KONTROL_DURUM.HATASIZ,
    [E_DEFTER_KONTROL_GRUP.KRITIK]: E_DEFTER_KONTROL_DURUM.KRITIK,
    [E_DEFTER_KONTROL_GRUP.MUKERRER]: E_DEFTER_KONTROL_DURUM.MUKERRER,
    [E_DEFTER_KONTROL_GRUP.TERS_BAKIYE]: E_DEFTER_KONTROL_DURUM.TERS_BAKIYE,
    [E_DEFTER_KONTROL_GRUP.EKSIK_BILGI]: E_DEFTER_KONTROL_DURUM.EKSIK_BILGI,
    [E_DEFTER_KONTROL_GRUP.DONEM_SONU]: E_DEFTER_KONTROL_DURUM.DONEM_SONU,
    [E_DEFTER_KONTROL_GRUP.KDV_KONTROL]: E_DEFTER_KONTROL_DURUM.KDV_KONTROL,
    [E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI]: E_DEFTER_KONTROL_DURUM.INCELEME_GEREKLI,
  };

  return map[grup] || E_DEFTER_KONTROL_DURUM.INCELEME_GEREKLI;
}

function buildPeriodEndWarnings(context = {}) {
  const warnings = [];

  if (!context.hasKapanisFisi) {
    warnings.push({
      id: "donem-sonu-kapanis",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Dönem Sonu Kontrol",
      aciklama: "Kapanış fişi tespit edilemedi.",
      belgeTuru: "Bilgi",
      belgeNo: "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issueDetails: [
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
          message: "Kapanış fişi kaydı bulunamadı (inceleme bilgisi).",
          severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
          group: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
          riskScore: 8,
        }),
      ],
      issues: ["Kapanış fişi kaydı bulunamadı (inceleme bilgisi)."],
      riskScore: 8,
      riskBand: riskBandFromScore(8),
      grup: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
      durum: E_DEFTER_KONTROL_DURUM.DONEM_SONU,
      sonucSeviye: E_DEFTER_SONUC_SEVIYE.BILGI,
    });
  }

  if (!context.hasAmortisman) {
    warnings.push({
      id: "donem-sonu-amortisman",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Dönem Sonu Kontrol",
      aciklama: "Amortisman kaydı tespit edilemedi.",
      belgeTuru: "Bilgi",
      belgeNo: "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issueDetails: [
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
          message: "Amortisman gider kaydı bulunamadı (inceleme bilgisi).",
          severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
          group: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
          riskScore: 8,
        }),
      ],
      issues: ["Amortisman gider kaydı bulunamadı (inceleme bilgisi)."],
      riskScore: 8,
      riskBand: riskBandFromScore(8),
      grup: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
      durum: E_DEFTER_KONTROL_DURUM.DONEM_SONU,
      sonucSeviye: E_DEFTER_SONUC_SEVIYE.BILGI,
    });
  }

  if (!context.hasKurDegerleme) {
    warnings.push({
      id: "donem-sonu-kur",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Dönem Sonu Kontrol",
      aciklama: "Kur değerleme kaydı tespit edilemedi.",
      belgeTuru: "Bilgi",
      belgeNo: "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issueDetails: [
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
          message: "Kur değerleme / kur farkı kaydı bulunamadı (inceleme bilgisi).",
          severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
          group: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
          riskScore: 8,
        }),
      ],
      issues: ["Kur değerleme / kur farkı kaydı bulunamadı (inceleme bilgisi)."],
      riskScore: 8,
      riskBand: riskBandFromScore(8),
      grup: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
      durum: E_DEFTER_KONTROL_DURUM.DONEM_SONU,
      sonucSeviye: E_DEFTER_SONUC_SEVIYE.BILGI,
    });
  }

  for (const gap of context.fisNoGaps || []) {
    warnings.push({
      id: `fis-gap-${gap.from}-${gap.to}`,
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "",
      fisNo: `${gap.from + 1}-${gap.to - 1}`,
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Fiş No Kontrol",
      aciklama: `Fiş no atlaması: ${gap.from} ile ${gap.to} arasında eksik numara.`,
      belgeTuru: "Uyarı",
      belgeNo: "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issues: [`Fiş no atlaması (${gap.from} → ${gap.to}).`],
      riskScore: 50,
      riskBand: riskBandFromScore(50),
      grup: E_DEFTER_KONTROL_GRUP.KRITIK,
      durum: E_DEFTER_KONTROL_DURUM.KRITIK,
    });
  }

  return warnings;
}

function severityToSonucSeviye(severity) {
  if (severity === E_DEFTER_ISSUE_SEVERITY.KRITIK) return E_DEFTER_SONUC_SEVIYE.KRITIK;
  if (severity === E_DEFTER_ISSUE_SEVERITY.UYARI) return E_DEFTER_SONUC_SEVIYE.UYARI;
  if (severity === E_DEFTER_ISSUE_SEVERITY.BILGI) return E_DEFTER_SONUC_SEVIYE.BILGI;
  return E_DEFTER_SONUC_SEVIYE.UYGUN;
}

export function analyzeEDefterRow(row, allRows = [], context = {}) {
  if (row.disaridaBirak) {
    return {
      ...row,
      issues: [],
      issueDetails: [],
      riskScore: 0,
      riskBand: riskBandFromScore(0),
      riskLevel: riskLevelFromScore(0),
      sonucSeviye: E_DEFTER_SONUC_SEVIYE.UYGUN,
      hasBlockingIssue: false,
      grup: E_DEFTER_KONTROL_GRUP.HATASIZ,
      durum: row.kontrolDurumu || "Kontrol dışı",
    };
  }

  if (row.grup && row.id?.startsWith("donem-sonu")) {
    return row;
  }

  if (row.grup && row.id?.startsWith("fis-gap")) {
    return row;
  }

  const counterpartResolved = context.counterpartByRowId?.get(row.id) || null;
  const analysis = buildIssues(row, allRows, context);
  const hasIssues = analysis.issueDetails.length > 0;
  // Fail-closed: never trust HATASIZ when structured issues exist.
  const grup = hasIssues
    ? analysis.primaryGroup === E_DEFTER_KONTROL_GRUP.HATASIZ
      ? E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI
      : analysis.primaryGroup
    : resolvePrimaryGroup(analysis.issues, row);
  const durum = resolveDurum(grup, row);
  const riskScore = hasIssues
    ? Math.max(1, analysis.riskScore || 0)
    : grup === E_DEFTER_KONTROL_GRUP.HATASIZ
      ? 0
      : analysis.riskScore;
  const sonucSeviye = hasIssues
    ? severityToSonucSeviye(analysis.maxSeverity)
    : sonucSeviyeFromScore(riskScore);

  const resolvedCounterpart =
    counterpartResolved?.counterAccountCode ||
    row.counterAccountCode ||
    row.karsiHesapKodu ||
    "";

  return {
    ...row,
    borc: roundMoney(row.borc),
    alacak: roundMoney(row.alacak),
    tutar: roundMoney(row.tutar || Math.max(row.borc, row.alacak)),
    counterAccountCode: resolvedCounterpart,
    karsiHesapKodu: resolvedCounterpart,
    counterpartStatus: counterpartResolved?.status || "",
    counterpartCandidates: counterpartResolved?.candidates || [],
    counterpartConfidence: counterpartResolved?.confidence ?? null,
    issues: analysis.issues,
    issueDetails: analysis.issueDetails,
    riskScore,
    riskBand: riskBandFromScore(riskScore),
    riskLevel: riskLevelFromScore(riskScore),
    sonucSeviye,
    hasBlockingIssue: Boolean(analysis.hasBlocking),
    hataTuru: row.hataTuru || E_DEFTER_HATA_TURU.MUHASEBESEL,
    onerilenKontrol:
      row.onerilenKontrol ||
      (analysis.issues[0] ? `${analysis.issues[0]} için belge ve fiş kontrolü yapın.` : ""),
    cozumDurumu: row.cozumDurumu || E_DEFTER_FINDING_STATUS.YENI,
    smartExplanation: row.smartExplanation || buildSmartEDefterExplanation(row, analysis.issues),
    grup,
    durum,
  };
}

export function analyzeEDefterRows(rows = [], options = {}) {
  const hasYevmiyeRows = (rows || []).some(
    (row) =>
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE ||
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE_XML
  );
  const context = {
    ...buildGlobalContext(rows),
    accountPlanCodes: options.accountPlanCodes || null,
    expectedPeriodKey: options.expectedPeriod
      ? normalizePeriodKey(String(options.expectedPeriod).replace("/", "-"))
      : "",
    documentClass: options.documentClass || "",
    yevmiyeEvidencePresent:
      options.yevmiyeEvidencePresent === true ||
      (options.yevmiyeEvidencePresent !== false && hasYevmiyeRows),
    cumulativePeriod: options.cumulativePeriod === true,
  };
  const analyzed = rows.map((row) => analyzeEDefterRow(row, rows, context));
  const warnings = buildPeriodEndWarnings(context);
  return [...analyzed, ...warnings];
}

function sumDebitCredit(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.borc += roundMoney(row.borc);
      acc.alacak += roundMoney(row.alacak);
      return acc;
    },
    { borc: 0, alacak: 0 }
  );
}

/**
 * Yevmiye ↔ kebir çapraz mutabakat. Fark varsa JOURNAL_LEDGER_MISMATCH — “uygun” üretilmez.
 */
export function reconcileJournalLedger(yevmiyeRows = [], kebirRows = []) {
  const findings = [];
  if (!yevmiyeRows.length || !kebirRows.length) {
    return { findings, matched: false, skipped: true };
  }

  const yTotals = sumDebitCredit(yevmiyeRows);
  const kTotals = sumDebitCredit(kebirRows);
  const borcFark = roundMoney(yTotals.borc - kTotals.borc);
  const alacakFark = roundMoney(yTotals.alacak - kTotals.alacak);

  if (Math.abs(borcFark) > BORC_ALACAK_TOLERANCE || Math.abs(alacakFark) > BORC_ALACAK_TOLERANCE) {
    findings.push({
      code: E_DEFTER_FINDING_CODE.JOURNAL_LEDGER_MISMATCH,
      message: `Yevmiye-kebir toplam farkı: borç fark=${borcFark}, alacak fark=${alacakFark}`,
      level: E_DEFTER_SONUC_SEVIYE.KRITIK,
    });
  }

  const yMap = buildAccountBalanceMap(yevmiyeRows);
  const kMap = buildAccountBalanceMap(kebirRows);
  const allKeys = new Set([...yMap.keys(), ...kMap.keys()]);
  for (const key of allKeys) {
    const y = yMap.get(key) || { borc: 0, alacak: 0, net: 0, hesapKodu: key };
    const k = kMap.get(key) || { borc: 0, alacak: 0, net: 0, hesapKodu: key };
    if (
      Math.abs(y.borc - k.borc) > BORC_ALACAK_TOLERANCE ||
      Math.abs(y.alacak - k.alacak) > BORC_ALACAK_TOLERANCE
    ) {
      findings.push({
        code: E_DEFTER_FINDING_CODE.JOURNAL_LEDGER_MISMATCH,
        message: `Hesap bazlı yevmiye-kebir farkı: ${y.hesapKodu || k.hesapKodu}`,
        level: E_DEFTER_SONUC_SEVIYE.KRITIK,
      });
      break;
    }
  }

  return {
    findings,
    matched: findings.length === 0,
    skipped: false,
    yTotals,
    kTotals,
  };
}

export function buildCrossFindingRows(findings = [], context = {}) {
  return (findings || []).map((finding, index) => {
    const riskScore =
      mapLegacyLevelToSonuc(finding.level) === E_DEFTER_SONUC_SEVIYE.KRITIK ? 90 : 55;
    const row = {
      id: `capraz-${finding.code || index}`,
      kaynak: E_DEFTER_KAYNAK.CAPRAZ,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Çapraz Mutabakat",
      aciklama: finding.message,
      belgeTuru: "Çapraz",
      belgeNo: finding.code || "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issues: [finding.message],
      riskScore,
      riskBand: riskBandFromScore(riskScore),
      riskLevel: finding.level || riskLevelFromScore(riskScore),
      sonucSeviye: mapLegacyLevelToSonuc(finding.level),
      hataTuru: E_DEFTER_HATA_TURU.MUHASEBESEL,
      onerilenKontrol: "Yevmiye ve kebir toplamlarını hesap bazında karşılaştırın.",
      cozumDurumu: E_DEFTER_FINDING_STATUS.YENI,
      grup: E_DEFTER_KONTROL_GRUP.CAPRAZ,
      durum: E_DEFTER_KONTROL_DURUM.KRITIK,
      companyId: context.companyId || "",
      period: context.period || "",
    };
    row.smartExplanation = buildSmartEDefterExplanation(row, row.issues);
    return row;
  });
}

export function analyzeBeratMeta(beratMeta = null, packageMeta = {}, options = {}) {
  const findings = [];
  if (!beratMeta) {
    findings.push({
      code: "BERAT_ESLESMEDI",
      message: "Berat dosyası eksik veya okunamadı (inceleme bilgisi).",
      level: E_DEFTER_SONUC_SEVIYE.BILGI,
    });
    return findings;
  }

  if (options.companyTaxId && beratMeta.taxId) {
    if (normalizeTaxId(beratMeta.taxId) !== normalizeTaxId(options.companyTaxId)) {
      findings.push({
        code: EDEFTER_ERROR_CODE.COMPANY_MISMATCH,
        message: "Berat firma bilgisi seçili firma ile uyuşmuyor.",
        level: E_DEFTER_SONUC_SEVIYE.KRITIK,
      });
    }
  }

  if (options.expectedPeriod && beratMeta.period) {
    const a = normalizePeriodKey(beratMeta.period);
    const b = normalizePeriodKey(String(options.expectedPeriod).replace("/", "-"));
    if (a && b && a !== b) {
      findings.push({
        code: "BERAT_DONEM",
        message: "Berat dönemi beklenen dönem ile uyuşmuyor.",
        level: E_DEFTER_SONUC_SEVIYE.UYARI,
      });
    }
  }

  findings.push({
    code: E_DEFTER_FINDING_CODE.EXTERNAL_VERIFICATION_REQUIRED,
    message:
      "Berat varlık/tür bilgisi okundu; GİB veya mali mühür kriptografik doğrulaması yapılmadı. Harici doğrulama gerekir.",
    level: E_DEFTER_SONUC_SEVIYE.BILGI,
  });

  return findings;
}

export function resolveOverallSonuc(rows = []) {
  let worst = E_DEFTER_SONUC_SEVIYE.UYGUN;
  const rank = {
    [E_DEFTER_SONUC_SEVIYE.UYGUN]: 0,
    [E_DEFTER_SONUC_SEVIYE.BILGI]: 1,
    [E_DEFTER_SONUC_SEVIYE.UYARI]: 2,
    [E_DEFTER_SONUC_SEVIYE.KRITIK]: 3,
  };
  for (const row of rows.filter((r) => !r.disaridaBirak)) {
    const details = Array.isArray(row.issueDetails) ? row.issueDetails : [];
    const unresolved = details.filter(
      () => row.cozumDurumu !== E_DEFTER_FINDING_STATUS.COZULDU
    );
    const hasBlocking = unresolved.some((issue) => issue.blocking);
    const hasNonInfo = unresolved.some(
      (issue) => issue.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI
    );
    const legacyIssues = Array.isArray(row.issues) ? row.issues : [];
    const hasLegacyIssues =
      unresolved.length === 0 &&
      legacyIssues.length > 0 &&
      row.cozumDurumu !== E_DEFTER_FINDING_STATUS.COZULDU;

    let seviye =
      row.sonucSeviye ||
      mapLegacyLevelToSonuc(row.riskLevel) ||
      sonucSeviyeFromScore(row.riskScore || 0);

    if (hasBlocking || row.grup === E_DEFTER_KONTROL_GRUP.KRITIK || row.grup === E_DEFTER_KONTROL_GRUP.CAPRAZ) {
      worst = E_DEFTER_SONUC_SEVIYE.KRITIK;
      break;
    }
    if (hasNonInfo) {
      const fromIssues = unresolved.reduce((acc, issue) => {
        const mapped = severityToSonucSeviye(issue.severity);
        return (rank[mapped] || 0) > (rank[acc] || 0) ? mapped : acc;
      }, E_DEFTER_SONUC_SEVIYE.UYGUN);
      if ((rank[fromIssues] || 0) > (rank[seviye] || 0)) seviye = fromIssues;
      if (seviye === E_DEFTER_SONUC_SEVIYE.UYGUN) seviye = E_DEFTER_SONUC_SEVIYE.UYARI;
    } else if (hasLegacyIssues) {
      // Prefer explicit row level (e.g. missing-berat BILGI) over defaulting to UYARI.
      const legacyLevel =
        row.sonucSeviye ||
        mapLegacyLevelToSonuc(row.riskLevel) ||
        mapLegacyLevelToSonuc(legacyIssues[0]) ||
        sonucSeviyeFromScore(row.riskScore || 0);
      if ((rank[legacyLevel] || 0) > (rank[seviye] || 0)) seviye = legacyLevel;
      if (seviye === E_DEFTER_SONUC_SEVIYE.UYGUN) seviye = E_DEFTER_SONUC_SEVIYE.BILGI;
    }
    if ((rank[seviye] || 0) > (rank[worst] || 0)) worst = seviye;
    if (row.grup === E_DEFTER_KONTROL_GRUP.TEKNIK && (row.riskScore || 0) >= 70) {
      worst = E_DEFTER_SONUC_SEVIYE.KRITIK;
    }
  }
  return worst;
}

/** True only when no blocking / unresolved non-info findings remain. */
export function resolveEdefterUygun(rows = [], overallSonuc = E_DEFTER_SONUC_SEVIYE.UYGUN) {
  if (
    overallSonuc === E_DEFTER_SONUC_SEVIYE.KRITIK ||
    overallSonuc === E_DEFTER_SONUC_SEVIYE.UYARI
  ) {
    return false;
  }
  for (const row of rows.filter((r) => !r.disaridaBirak)) {
    if (row.cozumDurumu === E_DEFTER_FINDING_STATUS.COZULDU) continue;
    const details = Array.isArray(row.issueDetails) ? row.issueDetails : [];
    if (details.some((issue) => issue.blocking || issue.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI)) {
      return false;
    }
    if (
      (!details.length && Array.isArray(row.issues) && row.issues.length > 0) ||
      (row.grup &&
        row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ &&
        row.grup !== E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI)
    ) {
      // Non-info structural groups (KRITIK/MUKERRER/...) block approval.
      if (
        row.grup === E_DEFTER_KONTROL_GRUP.KRITIK ||
        row.grup === E_DEFTER_KONTROL_GRUP.CAPRAZ ||
        row.grup === E_DEFTER_KONTROL_GRUP.MUKERRER ||
        row.grup === E_DEFTER_KONTROL_GRUP.EKSIK_BILGI ||
        row.grup === E_DEFTER_KONTROL_GRUP.TERS_BAKIYE
      ) {
        return false;
      }
    }
  }
  return (
    overallSonuc === E_DEFTER_SONUC_SEVIYE.UYGUN ||
    overallSonuc === E_DEFTER_SONUC_SEVIYE.BILGI
  );
}

export function canApproveEDefterExport(overallSonuc) {
  return overallSonuc !== E_DEFTER_SONUC_SEVIYE.KRITIK;
}

/** Fiş Kontrol derin bağlantısı — çift kuyruk kopyası yok. */
export function buildFisKontrolDeepLink({ companyId = "", fisNo = "" } = {}) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  if (fisNo) params.set("fisNo", fisNo);
  params.set("from", "e-defter-kontrol");
  return `/muhasebe/fis-kontrol?${params.toString()}`;
}

/**
 * Muhasebe Hafızasına kör yazma yok. CORE > hafıza.
 * Bu yardımcı yalnızca entegrasyon meta üretir; storage yazmaz.
 */
export function buildEDefterIntegrationHooks({
  rows = [],
  companyId = "",
  coreDecision = null,
} = {}) {
  const criticalFis = rows
    .filter(
      (row) =>
        row.fisNo &&
        (row.grup === E_DEFTER_KONTROL_GRUP.KRITIK ||
          row.sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK ||
          row.riskLevel === E_DEFTER_RISK_LEVEL.KRITIK)
    )
    .map((row) => row.fisNo);

  const uniqueFis = [...new Set(criticalFis)];
  return {
    writeToAccountMemory: false,
    corePriority: true,
    coreOverridesMemory: true,
    coreDecisionSource: coreDecision?.decision_source || coreDecision?.source || null,
    fisKontrolLinks: uniqueFis.map((fisNo) =>
      buildFisKontrolDeepLink({ companyId, fisNo })
    ),
    disclaimer: E_DEFTER_REPORT_DISCLAIMER,
  };
}

export function loadEDefterFingerprintSession() {
  if (typeof window === "undefined") return createFingerprintSession();
  try {
    const raw = JSON.parse(localStorage.getItem(E_DEFTER_FINGERPRINT_STORAGE_KEY) || "[]");
    return createFingerprintSession(Array.isArray(raw) ? raw : []);
  } catch {
    return createFingerprintSession();
  }
}

export function saveEDefterFingerprintSession(session) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      E_DEFTER_FINGERPRINT_STORAGE_KEY,
      JSON.stringify(session.values?.() || [])
    );
  } catch {
    /* ignore quota */
  }
}

export function recalculateEDefterSummary(rows = []) {
  const activeRows = rows.filter((row) => !row.disaridaBirak);
  const fisSet = new Set(
    activeRows.map((row) => compactText(row.fisNo)).filter(Boolean)
  );

  let kritikHata = 0;
  let yuksekRisk = 0;
  let mukerrerRisk = 0;
  let tersBakiye = 0;
  let eksikBilgi = 0;
  let teknikHata = 0;
  let vergiselRisk = 0;
  let uyariSayisi = 0;

  for (const row of activeRows) {
    if (row.grup === E_DEFTER_KONTROL_GRUP.KRITIK || row.riskLevel === E_DEFTER_RISK_LEVEL.KRITIK) {
      kritikHata += 1;
    }
    if (row.riskScore >= 70 || row.riskLevel === E_DEFTER_RISK_LEVEL.YUKSEK) yuksekRisk += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.MUKERRER) mukerrerRisk += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.TERS_BAKIYE) tersBakiye += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.EKSIK_BILGI) eksikBilgi += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.TEKNIK || row.hataTuru === E_DEFTER_HATA_TURU.TEKNIK) {
      teknikHata += 1;
    }
    if (row.grup === E_DEFTER_KONTROL_GRUP.VERGISEL || row.hataTuru === E_DEFTER_HATA_TURU.VERGISEL) {
      vergiselRisk += 1;
    }
    if (row.riskLevel === E_DEFTER_RISK_LEVEL.ORTA || row.riskLevel === E_DEFTER_RISK_LEVEL.DUSUK) {
      uyariSayisi += 1;
    }
  }

  return {
    toplamFis: fisSet.size,
    toplamSatir: activeRows.length,
    kritikHata,
    yuksekRisk,
    mukerrerRisk,
    tersBakiye,
    eksikBilgi,
    yuklenenDefterSayisi: 0,
    teknikHata,
    vergiselRisk,
    uyariSayisi,
  };
}

export function filterEDefterRows(
  rows = [],
  { grup = "", search = "", riskLevel = "", hataTuru = "", cozumDurumu = "" } = {}
) {
  let result = rows;

  if (grup) {
    result = result.filter((row) => row.grup === grup);
  }

  if (riskLevel && riskLevel !== "Tümü") {
    result = result.filter((row) => row.riskLevel === riskLevel);
  }

  if (hataTuru && hataTuru !== "Tümü") {
    result = result.filter((row) => row.hataTuru === hataTuru);
  }

  if (cozumDurumu === "Çözüldü") {
    result = result.filter((row) => row.cozumDurumu === E_DEFTER_FINDING_STATUS.COZULDU);
  }
  if (cozumDurumu === "Çözülmedi") {
    result = result.filter(
      (row) => row.cozumDurumu !== E_DEFTER_FINDING_STATUS.COZULDU && row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ
    );
  }

  const query = search.trim().toLocaleLowerCase("tr-TR");
  if (query) {
    result = result.filter((row) =>
      [
        row.fisNo,
        row.yevmiyeNo,
        row.hesapKodu,
        row.hesapAdi,
        row.aciklama,
        row.belgeTuru,
        row.belgeNo,
        row.durum,
        row.grup,
        row.not,
        ...(row.issues || []),
      ]
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(query)
    );
  }

  return result;
}

export function groupEDefterCounts(rows = []) {
  const counts = Object.fromEntries(
    Object.values(E_DEFTER_KONTROL_GRUP).map((grup) => [grup, 0])
  );

  for (const row of rows.filter((item) => !item.disaridaBirak)) {
    counts[row.grup] = (counts[row.grup] || 0) + 1;
  }

  return Object.entries(counts).map(([grup, count]) => ({ grup, count }));
}

export function runEDefterKontrolPipeline({
  muavinRows = [],
  yevmiyeRows = [],
  mizanRows = [],
  edefterListeRows = [],
  xmlRows = [],
  technicalFindings = [],
  companyId = "",
  period = "",
  declarationRecords = [],
  accountPlanCodes = null,
  beratMeta = null,
  packageMeta = {},
  companyTaxId = "",
  coreDecision = null,
  retryToken = "",
  yevmiyeEvidencePresent,
  cumulativePeriod = false,
}) {
  const mergedRows = [
    ...muavinRows,
    ...yevmiyeRows,
    ...edefterListeRows,
    ...mizanRows,
    ...xmlRows,
  ];

  const yevmiyeOnly = mergedRows.filter(
    (row) =>
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE ||
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE_XML
  );
  const kebirOnly = mergedRows.filter((row) => row.kaynak === E_DEFTER_KAYNAK.KEBIR_XML);

  const analyzedRows = analyzeEDefterRows(mergedRows, {
    accountPlanCodes,
    expectedPeriod: period,
    yevmiyeEvidencePresent:
      yevmiyeEvidencePresent === true ||
      (yevmiyeEvidencePresent !== false && yevmiyeOnly.length > 0),
    cumulativePeriod,
  });

  const journalLedger = reconcileJournalLedger(
    yevmiyeOnly.length ? yevmiyeOnly : mergedRows.filter((r) => r.kaynak !== E_DEFTER_KAYNAK.KEBIR_XML && r.kaynak !== E_DEFTER_KAYNAK.MIZAN),
    kebirOnly
  );

  const totals = sumDebitCredit(
    mergedRows.filter((row) => row.kaynak !== E_DEFTER_KAYNAK.MIZAN)
  );
  const totalFindings = [];
  if (
    mergedRows.some((r) => r.kaynak !== E_DEFTER_KAYNAK.MIZAN) &&
    Math.abs(totals.borc - totals.alacak) > BORC_ALACAK_TOLERANCE
  ) {
    totalFindings.push({
      code: E_DEFTER_FINDING_CODE.TOPLAM_BORC_ALACAK,
      message: `Toplam borç/alacak eşit değil: borç=${totals.borc}, alacak=${totals.alacak}`,
      level: E_DEFTER_SONUC_SEVIYE.KRITIK,
    });
  }

  const beratFindings = analyzeBeratMeta(beratMeta, packageMeta, {
    companyTaxId,
    expectedPeriod: period,
  });

  const technicalRows = buildTechnicalFindingRows(
    [...technicalFindings, ...beratFindings, ...totalFindings],
    { companyId, period }
  );
  const crossRows = buildCrossFindingRows(journalLedger.findings, { companyId, period });
  const vergiselRows = buildVergiselFindingRows({
    rows: mergedRows,
    declarationRecords: declarationRecords.length
      ? declarationRecords
      : typeof window !== "undefined"
        ? loadDeclarationAccrualRecords().filter((record) => !companyId || record.companyId === companyId)
        : [],
    companyId,
    period,
  });
  const combinedRows = [...analyzedRows, ...technicalRows, ...crossRows, ...vergiselRows].map(
    (row) => ({
      ...row,
      sonucSeviye:
        row.sonucSeviye ||
        mapLegacyLevelToSonuc(row.riskLevel) ||
        sonucSeviyeFromScore(row.riskScore || 0),
    })
  );
  const summary = recalculateEDefterSummary(combinedRows);
  summary.yuklenenDefterSayisi =
    Number(Boolean(muavinRows.length)) +
    Number(Boolean(yevmiyeRows.length)) +
    Number(Boolean(mizanRows.length)) +
    Number(Boolean(xmlRows.length));
  const overallSonuc = resolveOverallSonuc(combinedRows);
  summary.overallSonuc = overallSonuc;
  summary.edefterUygun = resolveEdefterUygun(combinedRows, overallSonuc);
  summary.findingCount = combinedRows.filter(
    (row) =>
      !row.disaridaBirak &&
      ((Array.isArray(row.issueDetails) && row.issueDetails.length > 0) ||
        (Array.isArray(row.issues) && row.issues.length > 0) ||
        row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ)
  ).length;
  summary.canApproveExport = canApproveEDefterExport(overallSonuc);
  const groupCounts = groupEDefterCounts(combinedRows);
  const hooks = buildEDefterIntegrationHooks({
    rows: combinedRows,
    companyId,
    coreDecision,
  });

  return {
    rows: combinedRows,
    summary,
    groupCounts,
    overallSonuc,
    journalLedger,
    retryToken: retryToken || `retry-${Date.now()}`,
    disclaimer: E_DEFTER_REPORT_DISCLAIMER,
    integrationMeta: {
      source: "e-defter-kontrol-v3",
      fisNolar: combinedRows.map((row) => row.fisNo).filter(Boolean),
      hesapKodlari: combinedRows.map((row) => row.hesapKodu).filter(Boolean),
      belgeNolar: combinedRows.map((row) => row.belgeNo).filter(Boolean),
      kdvMatrahKontrolReady: true,
      kurDegerlemeReady: true,
      lucaAktarimKontrolReady: true,
      muavinMutabakatReady: true,
      ...hooks,
    },
  };
}

/**
 * Tek tuş pipeline: parse edilmiş XML + excel satırları → tam kontrol.
 * Firma/dönem belirsizliğinde karar: dosya meta > seçili UI; çelişkide hata.
 */
export async function runOneClickEDefterKontrol({
  parsedUpload = null,
  muavinRows = [],
  yevmiyeRows = [],
  mizanRows = [],
  edefterListeRows = [],
  companyId = "",
  companyTaxId = "",
  period = "",
  accountPlanCodes = null,
  declarationRecords = [],
  coreDecision = null,
  fingerprintSession = null,
} = {}) {
  if (parsedUpload?.duplicate) {
    return {
      duplicate: true,
      duplicateMessage: parsedUpload.duplicateMessage,
      rows: [],
      summary: {
        overallSonuc: E_DEFTER_SONUC_SEVIYE.BILGI,
        edefterUygun: false,
        canApproveExport: false,
        kritikHata: 0,
        uyariSayisi: 0,
        toplamSatir: 0,
        toplamFis: 0,
        yuklenenDefterSayisi: 0,
        teknikHata: 0,
        vergiselRisk: 0,
        yuksekRisk: 0,
        mukerrerRisk: 0,
        tersBakiye: 0,
        eksikBilgi: 0,
      },
      groupCounts: [],
      overallSonuc: E_DEFTER_SONUC_SEVIYE.BILGI,
      disclaimer: E_DEFTER_REPORT_DISCLAIMER,
    };
  }

  const fileTax = parsedUpload?.packageMeta?.taxId || "";
  const filePeriod = parsedUpload?.packageMeta?.period || "";
  const hasXmlPackage = Boolean(parsedUpload && !parsedUpload.duplicate);
  const hasExcelOnly =
    !hasXmlPackage &&
    Boolean(muavinRows.length || yevmiyeRows.length || mizanRows.length || edefterListeRows.length);
  const sourceKind = hasXmlPackage ? "xml" : hasExcelOnly ? "excel" : "unknown";

  const identity = evaluateEDefterCompanyIdentity({
    companyTaxId,
    documentTaxId: fileTax,
    companyId,
    sourceKind,
  });

  if (identity.blocking || !identity.allowAnalyze) {
    const err = new Error(identity.safeMessage);
    err.code = identityStatusToErrorCode(identity.status) || EDEFTER_ERROR_CODE.COMPANY_MISMATCH;
    err.identity = {
      status: identity.status,
      verified: identity.verified,
      matched: identity.matched,
      safeMessage: identity.safeMessage,
      safeFingerprint: identity.safeFingerprint,
    };
    throw err;
  }

  let resolvedPeriod = period;
  if (!resolvedPeriod && filePeriod) {
    resolvedPeriod = filePeriod.replace("-", "/");
  } else if (resolvedPeriod && filePeriod) {
    const a = normalizePeriodKey(resolvedPeriod.replace("/", "-"));
    const b = normalizePeriodKey(filePeriod);
    if (a && b && a !== b) {
      const err = new Error("Dosya dönemi ile seçili dönem uyuşmuyor.");
      err.code = EDEFTER_ERROR_CODE.MIXED_COMPANY_OR_PERIOD;
      throw err;
    }
  }

  if (fingerprintSession && parsedUpload?.fingerprint) {
    fingerprintSession.add(parsedUpload.fingerprint);
  }

  const result = runEDefterKontrolPipeline({
    muavinRows,
    yevmiyeRows,
    mizanRows,
    edefterListeRows,
    xmlRows: parsedUpload?.rows || [],
    technicalFindings: parsedUpload?.technicalFindings || [],
    companyId,
    period: resolvedPeriod,
    declarationRecords,
    accountPlanCodes,
    beratMeta: parsedUpload?.beratMeta || null,
    packageMeta: parsedUpload?.packageMeta || {},
    companyTaxId,
    coreDecision,
  });

  result.summary = applyIdentityGateToSummary(result.summary, identity);
  result.identity = {
    status: identity.status,
    verified: identity.verified,
    identityVerified: Boolean(identity.verified),
    matched: identity.matched,
    userConfirmed: Boolean(identity.userConfirmed),
    identityUserConfirmed: Boolean(identity.userConfirmed),
    reviewRequired: identity.reviewRequired,
    allowAnalyze: identity.allowAnalyze,
    allowPersist: identity.allowPersist,
    allowExport: identity.allowExport,
    confirmation: identity.confirmation || "",
    safeMessage: identity.safeMessage,
    safeFingerprint: identity.safeFingerprint,
    companyIdentityType: identity.companyIdentityType,
    documentIdentityType: identity.documentIdentityType,
    sourceKind: identity.sourceKind,
  };
  if (!identity.allowExport) {
    result.summary.canApproveExport = false;
  }
  return result;
}

export function recalculateEDefterRows(rows = []) {
  const preservedRows = rows.filter(
    (row) => row.id?.startsWith("teknik-") || row.id?.startsWith("vergisel-")
  );
  const ledgerRows = rows.filter(
    (row) =>
      !row.id?.startsWith("donem-sonu") &&
      !row.id?.startsWith("fis-gap") &&
      !row.id?.startsWith("teknik-") &&
      !row.id?.startsWith("vergisel-")
  );
  const context = buildGlobalContext(ledgerRows);
  const analyzed = ledgerRows.map((row) => analyzeEDefterRow(row, ledgerRows, context));
  const warnings = buildPeriodEndWarnings(context);
  const combined = [...analyzed, ...warnings, ...preservedRows];

  return {
    rows: combined,
    summary: recalculateEDefterSummary(combined),
    groupCounts: groupEDefterCounts(combined),
  };
}

function scoreFromLevel(level = "") {
  const mapped = mapLegacyLevelToSonuc(level);
  if (mapped === E_DEFTER_SONUC_SEVIYE.KRITIK || level === E_DEFTER_RISK_LEVEL.KRITIK) return 85;
  if (mapped === E_DEFTER_SONUC_SEVIYE.UYARI || level === E_DEFTER_RISK_LEVEL.YUKSEK) return 65;
  if (mapped === E_DEFTER_SONUC_SEVIYE.BILGI || level === E_DEFTER_RISK_LEVEL.ORTA) return 40;
  return 15;
}

export function buildSmartEDefterExplanation(row = {}, issues = []) {
  const issueText = issues.join(" ").toLocaleLowerCase("tr-TR");
  const why =
    issueText.includes("kdv") || issueText.includes("191") || issueText.includes("391")
      ? "KDV hesapları ile beyanname/matrah arasında tutarsızlık oluşmuş olabilir."
      : issueText.includes("kasa") || issueText.includes("100")
        ? "Nakit hareketlerinin tamamı bankaya aktarılmamış veya kayıt dışı işlem olabilir."
        : issueText.includes("mükerrer") || issueText.includes("mukerrer")
          ? "Aynı belge veya fiş birden fazla kez işlenmiş olabilir."
          : issueText.includes("xml") || issueText.includes("berat")
            ? "E-defter dosya yapısı veya berat eşleşmesinde teknik sorun olabilir."
            : "Kayıt, belge veya dönemlendirme hatası söz konusu olabilir.";

  const check =
    issueText.includes("sgk") || issueText.includes("361")
      ? "SGK tahakkuk fişi, bordro ve banka ödeme dekontunu kontrol edin."
      : issueText.includes("belge")
        ? "İlgili fatura, fiş, dekont ve yevmiye kaydını birlikte inceleyin."
        : "Muavin dökümü, yevmiye fişi ve destekleyici belgeleri karşılaştırın.";

  const effect =
    issueText.includes("kdv") || issueText.includes("vergi")
      ? "Vergi beyanı ve e-defter berat sürecinde red veya ek açıklama istenebilir."
      : issueText.includes("mükerrer") || issueText.includes("mukerrer")
        ? "Çift gider veya çift gelir beyanı riski doğabilir."
        : "E-defter berat öncesi düzeltme gerekmeden süreç tamamlanmayabilir.";

  return [
    `Sorun neden oluşmuş olabilir? ${why}`,
    `Hangi belge kontrol edilmeli? ${check}`,
    `Olası vergisel etkisi: ${effect}`,
    row.aciklama ? `Kayıt: ${row.aciklama}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTechnicalFindingRows(findings = [], context = {}) {
  return (findings || []).map((finding, index) => {
    const sonucSeviye =
      mapLegacyLevelToSonuc(finding.level) || E_DEFTER_SONUC_SEVIYE.BILGI;
    const riskScore = scoreFromLevel(finding.level);
    const issue = normalizeEDefterIssue(
      {
        code: finding.code || E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
        message: finding.message,
        severity:
          sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK
            ? E_DEFTER_ISSUE_SEVERITY.KRITIK
            : sonucSeviye === E_DEFTER_SONUC_SEVIYE.UYARI
              ? E_DEFTER_ISSUE_SEVERITY.UYARI
              : E_DEFTER_ISSUE_SEVERITY.BILGI,
        group:
          sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK
            ? E_DEFTER_KONTROL_GRUP.KRITIK
            : E_DEFTER_KONTROL_GRUP.TEKNIK,
        blocking: sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK,
        riskScore,
      },
      "technical"
    );
    const row = {
      id: `teknik-${finding.code || index}-${Date.now()}`,
      kaynak: E_DEFTER_KAYNAK.TEKNIK,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Teknik Kontrol",
      aciklama: finding.message,
      belgeTuru: "Teknik",
      belgeNo: finding.code || "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issues: [finding.message],
      issueDetails: [issue],
      riskScore,
      riskBand: riskBandFromScore(riskScore),
      riskLevel: finding.level || riskLevelFromScore(riskScore),
      sonucSeviye,
      hataTuru: E_DEFTER_HATA_TURU.TEKNIK,
      onerilenKontrol: "XML/ZIP dosyasını ve berat eşleşmesini yeniden kontrol edin.",
      cozumDurumu: E_DEFTER_FINDING_STATUS.YENI,
      grup:
        sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK
          ? E_DEFTER_KONTROL_GRUP.KRITIK
          : sonucSeviye === E_DEFTER_SONUC_SEVIYE.UYARI
            ? E_DEFTER_KONTROL_GRUP.TEKNIK
            : E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      durum:
        sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK
          ? E_DEFTER_KONTROL_DURUM.KRITIK
          : E_DEFTER_KONTROL_DURUM.INCELEME_GEREKLI,
      companyId: context.companyId || "",
      period: context.period || "",
    };
    row.smartExplanation = buildSmartEDefterExplanation(row, row.issues);
    return row;
  });
}

function sumAccountPrefix(rows = [], prefix) {
  return rows
    .filter((row) => String(row.hesapKodu || "").startsWith(prefix))
    .reduce((sum, row) => sum + roundMoney(Math.max(row.borc, row.alacak)), 0);
}

export function buildVergiselFindingRows({ rows = [], declarationRecords = [], companyId = "", period = "" }) {
  const findings = [];
  // Prefer journal (or non-kebir) movements so Yevmiye+Kebir twin packages are not double-counted.
  const taxRows = rows.some(
    (row) =>
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE ||
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE_XML
  )
    ? rows.filter(
        (row) =>
          row.kaynak === E_DEFTER_KAYNAK.YEVMIYE ||
          row.kaynak === E_DEFTER_KAYNAK.YEVMIYE_XML
      )
    : rows.filter((row) => row.kaynak !== E_DEFTER_KAYNAK.KEBIR_XML);

  const kdv191 = sumAccountPrefix(taxRows, "191");
  const kdv391 = sumAccountPrefix(taxRows, "391");
  const kdv360 = sumAccountPrefix(taxRows, "360");
  const sgk361 = sumAccountPrefix(taxRows, "361");
  const devreden190 = sumAccountPrefix(taxRows, "190");

  // Period turnovers of 191 vs 391 rarely match in a single month; review-only.
  if (Math.abs(kdv191 - kdv391) > 1000 && (kdv191 || kdv391)) {
    findings.push({
      message: `191/391 KDV dönem hareket farkı (inceleme bilgisi): 191=${kdv191.toLocaleString("tr-TR")} TL, 391=${kdv391.toLocaleString("tr-TR")} TL`,
      level: E_DEFTER_RISK_LEVEL.ORTA,
      code: "KDV_191_391",
      action: "KDV listesi ve hesap hareketlerini karşılaştırın.",
    });
  }

  if (devreden190 > KASA_BAKIYE_ESIK) {
    findings.push({
      message: `Devreden KDV süreklilik analizi (inceleme bilgisi): 190 hesabı ${devreden190.toLocaleString("tr-TR")} TL`,
      level: E_DEFTER_RISK_LEVEL.ORTA,
      code: "DEVREDEN_KDV",
      action: "KDV beyannamesi ve indirilecek KDV listesini inceleyin.",
    });
  }

  const declarationKdv = declarationRecords
    .filter((record) => record.type === "KDV")
    .filter((record) => !period || record.period === period)
    .reduce((sum, record) => sum + Number(record.totalPayment || 0), 0);
  if (declarationKdv && Math.abs(kdv360 - declarationKdv) > 1000) {
    findings.push({
      message: `Beyanname ile muhasebe farkı (KDV): mizan 360=${kdv360.toLocaleString("tr-TR")} TL, tahakkuk=${declarationKdv.toLocaleString("tr-TR")} TL`,
      level: E_DEFTER_RISK_LEVEL.KRITIK,
      code: "BEYANNAME_KDV",
      action: "KDV beyannamesi ve 360 hesap hareketlerini eşleştirin.",
    });
  }

  const declarationSgk = declarationRecords
    .filter((record) => record.type === "SGK")
    .reduce((sum, record) => sum + Number(record.totalPayment || 0), 0);
  if (declarationSgk && Math.abs(sgk361 - declarationSgk) > 1000) {
    findings.push({
      message: `SGK tahakkuk uyumu: 361=${sgk361.toLocaleString("tr-TR")} TL, tahakkuk=${declarationSgk.toLocaleString("tr-TR")} TL`,
      level: E_DEFTER_RISK_LEVEL.YUKSEK,
      code: "SGK_TAHAKKUK",
      action: "SGK tahakkuk fişi ve bordro belgelerini kontrol edin.",
    });
  }

  ["Damga Vergisi", "Konaklama Vergisi", "Turizm Payı"].forEach((type) => {
    const total = declarationRecords
      .filter((record) => record.type === type)
      .reduce((sum, record) => sum + Number(record.totalPayment || 0), 0);
    if (total > 0) {
      findings.push({
        message: `${type} tahakkuk kaydı mevcut (${total.toLocaleString("tr-TR")} TL); muhasebe eşleşmesi kontrol edilmeli (inceleme bilgisi).`,
        level: E_DEFTER_RISK_LEVEL.ORTA,
        code: type.replace(/\s+/g, "_").toUpperCase(),
        action: `${type} beyanı ve ilgili hesap hareketlerini doğrulayın.`,
      });
    }
  });

  const tevkifatRows = taxRows.filter((row) => /tevkifat|stopaj/i.test(String(row.aciklama || "")));
  if (tevkifatRows.length) {
    findings.push({
      message: `${tevkifatRows.length} tevkifat/stopaj kaydı tespit edildi; oran ve hesap eşleşmesi kontrol edilmeli (inceleme bilgisi).`,
      level: E_DEFTER_RISK_LEVEL.ORTA,
      code: "TEVKIFAT",
      action: "Tevkifat beyannamesi ve stopaj hesaplarını karşılaştırın.",
    });
  }

  const sgdpRows = taxRows.filter((row) =>
    /sgdp|sosyal g[uü]venlik destek/i.test(`${row.aciklama || ""} ${row.hesapAdi || ""}`)
  );
  if (sgdpRows.length || (sgk361 > 0 && /sgdp/i.test(taxRows.map((r) => r.aciklama).join(" ")))) {
    findings.push({
      message: "361/SGDP risk göstergesi: SGDP prim kaydı ile 361 hesabı birlikte kontrol edilmeli (inceleme bilgisi; kesin vergi hükmü değildir).",
      level: E_DEFTER_RISK_LEVEL.ORTA,
      code: "SGDP_361",
      action: "SGDP bordro/tahakkuk ile 361 hareketlerini karşılaştırın.",
    });
  }

  const kasaBanka = sumAccountPrefix(taxRows, "100") + sumAccountPrefix(taxRows, "102");
  if (kasaBanka > KASA_BAKIYE_ESIK * 2) {
    findings.push({
      message: "100/102 nakit-banka yüksek hareket risk göstergesi (inceleme bilgisi).",
      level: E_DEFTER_RISK_LEVEL.ORTA,
      code: "KASA_BANKA_100_102",
      action: "Kasa ve banka mutabakatını kontrol edin.",
    });
  }

  return findings.map((finding, index) => {
    const sonucSeviye =
      mapLegacyLevelToSonuc(finding.level) || E_DEFTER_SONUC_SEVIYE.BILGI;
    const riskScore = scoreFromLevel(finding.level);
    const issue = normalizeEDefterIssue(
      {
        code: finding.code || E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
        message: finding.message,
        severity:
          sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK
            ? E_DEFTER_ISSUE_SEVERITY.KRITIK
            : sonucSeviye === E_DEFTER_SONUC_SEVIYE.UYARI
              ? E_DEFTER_ISSUE_SEVERITY.UYARI
              : E_DEFTER_ISSUE_SEVERITY.BILGI,
        group:
          sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK
            ? E_DEFTER_KONTROL_GRUP.KRITIK
            : E_DEFTER_KONTROL_GRUP.VERGISEL,
        blocking: sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK,
        riskScore,
      },
      "vergisel"
    );
    const row = {
      id: `vergisel-${finding.code || index}`,
      kaynak: E_DEFTER_KAYNAK.VERGISEL,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Vergisel Kontrol",
      aciklama: finding.message,
      belgeTuru: "Vergisel",
      belgeNo: finding.code || "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issues: [finding.message],
      issueDetails: [issue],
      riskScore,
      riskBand: riskBandFromScore(riskScore),
      riskLevel: finding.level,
      sonucSeviye,
      hataTuru: E_DEFTER_HATA_TURU.VERGISEL,
      onerilenKontrol: finding.action,
      cozumDurumu: E_DEFTER_FINDING_STATUS.YENI,
      grup:
        sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK
          ? E_DEFTER_KONTROL_GRUP.KRITIK
          : E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      durum:
        sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK
          ? E_DEFTER_KONTROL_DURUM.KRITIK
          : E_DEFTER_KONTROL_DURUM.INCELEME_GEREKLI,
      companyId,
      period,
    };
    row.smartExplanation = buildSmartEDefterExplanation(row, row.issues);
    return row;
  });
}

export function buildEDefterUploadRecord(input = {}) {
  return {
    id: input.id || `edefter-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    companyId: input.companyId || "",
    year: String(input.year || "").trim(),
    month: String(input.month || "").trim(),
    defterType: input.defterType || E_DEFTER_TURU.YEVMIYE,
    uploadedAt: input.uploadedAt || new Date().toISOString(),
    controlStatus: input.controlStatus || E_DEFTER_KONTROL_STATUS.BEKLIYOR,
    errorCount: Number(input.errorCount || 0),
    warningCount: Number(input.warningCount || 0),
    fileName: input.fileName || "",
    period: input.period || `${input.year || ""}/${input.month || ""}`,
  };
}

export function loadEDefterKontrolRecords() {
  if (typeof window === "undefined") return [];
  try {
    // Geçici UI cache — denetim kaynağı değil; sunucu kaydı asıldır.
    return JSON.parse(localStorage.getItem(E_DEFTER_RECORDS_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveEDefterKontrolRecords(records = []) {
  if (typeof window === "undefined") return;
  // Yalnız geçici cache; başarılı sunucu kaydı sonrası temizlenir.
  localStorage.setItem(E_DEFTER_RECORDS_STORAGE_KEY, JSON.stringify(records));
}

/** Analiz sonucu için güvenli kaynak parmak izi (ham içerik yok). */
export function buildEDefterResultFingerprints({
  sourceFingerprint = "",
  journalRows = [],
  ledgerRows = [],
  companyId = "",
  period = "",
  summary = {},
} = {}) {
  const journalKey = journalRows
    .slice(0, 5000)
    .map((r) => `${r.fisNo}|${r.yevmiyeNo}|${r.hesapKodu}|${r.borc}|${r.alacak}`)
    .join(";");
  const ledgerKey = ledgerRows
    .slice(0, 5000)
    .map((r) => `${r.fisNo}|${r.yevmiyeNo}|${r.hesapKodu}|${r.borc}|${r.alacak}`)
    .join(";");
  const fallbackSource = buildContentFingerprint(
    `${companyId}|${period}|${summary.overallSonuc || ""}|${summary.toplamSatir || 0}|${summary.kritikHata || 0}|${journalKey.slice(0, 2000)}`
  );
  return {
    source: sourceFingerprint || fallbackSource,
    journal: journalKey ? buildContentFingerprint(journalKey) : "",
    ledger: ledgerKey ? buildContentFingerprint(ledgerKey) : "",
  };
}

export function runEDefterKontrolScenario() {
  const brokenXml = buildTechnicalFindingRows(
    [{ code: "XML_BOZUK", message: "Bozuk XML dosyası", level: E_DEFTER_RISK_LEVEL.KRITIK }],
    { companyId: "test", period: "2026/05" }
  );
  const missingYevmiye = buildTechnicalFindingRows(
    [{ code: "EKSIK_YEVMIYE", message: "Eksik yevmiye numarası", level: E_DEFTER_RISK_LEVEL.ORTA }],
    { companyId: "test", period: "2026/05" }
  );
  const muavinRows = [
    {
      id: "1",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "31.05.2026",
      fisNo: "101",
      yevmiyeNo: "1",
      hesapKodu: "100.01.001",
      hesapAdi: "Kasa",
      aciklama: "Kasa bakiyesi",
      belgeTuru: "FT",
      belgeNo: "A-001",
      belgeTarihi: "31.05.2026",
      borc: 120000,
      alacak: 0,
      tutar: 120000,
    },
    {
      id: "2",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "15.05.2026",
      fisNo: "102",
      yevmiyeNo: "2",
      hesapKodu: "320.01.001",
      hesapAdi: "Satıcılar",
      aciklama: "Fatura",
      belgeTuru: "FT",
      belgeNo: "A-001",
      belgeTarihi: "15.05.2026",
      borc: 5000,
      alacak: 0,
      tutar: 5000,
    },
    {
      id: "2b",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "15.05.2026",
      fisNo: "102",
      yevmiyeNo: "2b",
      hesapKodu: "320.01.001",
      hesapAdi: "Satıcılar",
      aciklama: "Fatura",
      belgeTuru: "FT",
      belgeNo: "A-001",
      belgeTarihi: "15.05.2026",
      borc: 5000,
      alacak: 0,
      tutar: 5000,
    },
    {
      id: "3",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "20.05.2026",
      fisNo: "103",
      yevmiyeNo: "3",
      hesapKodu: "191.01.001",
      hesapAdi: "İndirilecek KDV",
      aciklama: "",
      belgeTuru: "",
      belgeNo: "",
      belgeTarihi: "",
      borc: 50000,
      alacak: 0,
      tutar: 50000,
    },
  ];
  const mizanRows = [
    {
      id: "m1",
      kaynak: E_DEFTER_KAYNAK.MIZAN,
      hesapKodu: "391.01.001",
      hesapAdi: "Hesaplanan KDV",
      borc: 0,
      alacak: 30000,
      tutar: 30000,
    },
  ];
  const result = runEDefterKontrolPipeline({
    muavinRows,
    mizanRows,
    companyId: "test",
    period: "2026/05",
    declarationRecords: [{ companyId: "test", period: "2026/05", type: "KDV", totalPayment: 40000 }],
    technicalFindings: [
      { code: "XML_BOZUK", message: "Bozuk XML", level: E_DEFTER_RISK_LEVEL.KRITIK },
      { code: "EKSIK_YEVMIYE", message: "Eksik yevmiye", level: E_DEFTER_RISK_LEVEL.ORTA },
    ],
  });

  return {
    brokenXmlCount: brokenXml.length,
    missingYevmiyeCount: missingYevmiye.length,
    negativeKasaDetected: result.rows.some((row) =>
      String(row.issues || []).join(" ").includes("Kasa")
    ),
    duplicateBelgeDetected: result.rows.some((row) =>
      String(row.issues || []).join(" ").includes("Birebir aynı satır tekrarı")
    ),
    kdv191391Detected: result.rows.some((row) => row.aciklama?.includes("191/391")),
    beyannameMismatchDetected: result.rows.some((row) => row.aciklama?.includes("Beyanname ile muhasebe")),
    missingDescriptionDetected: result.rows.some((row) =>
      String(row.issues || []).join(" ").includes("Açıklama boş")
    ),
    totalFindings: result.rows.filter((row) => row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ).length,
    summary: result.summary,
  };
}
