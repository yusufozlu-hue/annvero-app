/**
 * TEB PDF layout adapter — jsPDF landscape A4 hesap hareketleri.
 * Koordinat bantları ile kolon ayrımı; wrap satırları önceki harekete bağlanır.
 * Layout doğrulanamazsa caller fail-closed (TEB_PDF_LAYOUT_UNSUPPORTED) kullanır —
 * generic parser'a sessiz düşülmez.
 */

import { createCanonicalBankTransaction } from "@/src/utils/bankCanonicalTransaction.js";
import { BANK_STATEMENT_SOURCE } from "@/src/utils/bankCanonicalTransaction.js";
import {
  BANK_PDF_DOCUMENT_TYPE,
  parseTrAmountToken,
} from "@/src/utils/bankPdf/ziraatPdfLayout.js";

const DATE_ONLY_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/;
const TIME_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const AMOUNT_CELL_RE =
  /^-?\d{1,3}(?:\.\d{3})*(?:,\d{2})|-?\d+(?:,\d{2})$/;

const FOOTER_RE =
  /^(sayfa\s*\d+|page\s*\d+|www\.|telefon|m[uü][sş]teri\s*hizmet|copyright|devam\s* ediyor|bu\s*belge)/i;
const HEADER_LABEL_RE =
  /^(tarih|val[oö]r|saat|a[cç][iı]klama|banka|[uü]nvan|tutar|bakiye|dekont|eft|m[uü][sş]teri|al[iı]c[iı]|[oö]zel|i[sş]lemi\s*giren)/i;
const DEVIR_RE =
  /devir\s*bakiy|devreden\s*bakiye|[oö]nceki\s*bakiye/i;

/** Landscape A4 varsayılan kolon başlangıç X (sayfa 2+ TEB jsPDF) */
const DEFAULT_COL_X = Object.freeze({
  tarih: 45,
  valor: 86,
  saat: 126,
  islemGiren: 152,
  aciklama: 197,
  banka: 282,
  unvan: 363,
  alici: 420,
  ozel: 519,
  eft: 604,
  tutar: 638,
  bakiye: 688,
  dekont: 737,
  referans: 768,
});

export const TEB_PDF_LAYOUT_UNSUPPORTED = "TEB_PDF_LAYOUT_UNSUPPORTED";

function normalizeSpaces(s = "") {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normKey(s = "") {
  return normalizeSpaces(s)
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

export function looksLikeTebBankBrand(text = "") {
  const t = normKey(text);
  return /\bteb\b|turkiye ekonomi bank|turkiye ekonomi/.test(t);
}

export function looksLikeTebPdfLayout(text = "") {
  const t = normKey(text);
  if (!t) return false;
  const hasCols =
    t.includes("tarih") &&
    t.includes("valor") &&
    t.includes("saat") &&
    t.includes("tutar") &&
    t.includes("bakiye") &&
    t.includes("dekont") &&
    (t.includes("eft sorgu") || t.includes("musteri referans") || t.includes("ozel islem"));
  const hasBrand = looksLikeTebBankBrand(t);
  const dateLines = String(text || "")
    .split(/\r?\n/)
    .filter((l) => DATE_ONLY_RE.test(normalizeSpaces(l).split(/\s+/)[0] || "")).length;
  return hasCols && (hasBrand || dateLines >= 5);
}

export function classifyTebPdfDocument(text = "") {
  if (looksLikeTebPdfLayout(text) || looksLikeTebBankBrand(text)) {
    if (looksLikeTebPdfLayout(text)) return BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT;
  }
  return BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
}

function isAmountCell(str = "") {
  const t = normalizeSpaces(str);
  return Boolean(t && AMOUNT_CELL_RE.test(t));
}

function clusterRows(items = []) {
  const mapped = (items || [])
    .filter((it) => it && typeof it.str === "string" && normalizeSpaces(it.str))
    .map((it) => ({
      str: normalizeSpaces(it.str),
      x: Number(it.x) || 0,
      y: Number(it.y) || 0,
      w: Number(it.w) || Math.max(4, String(it.str || "").length * 4),
      h: Number(it.h) || 10,
    }));
  mapped.sort((a, b) => (Math.abs(a.y - b.y) < 1.5 ? a.x - b.x : b.y - a.y));
  const rows = [];
  let cur = null;
  for (const it of mapped) {
    const band = Math.max(5.5, (cur?.h || it.h) * 0.65);
    if (!cur || Math.abs(it.y - cur.y) > band) {
      if (cur) {
        cur.cells.sort((a, b) => a.x - b.x);
        rows.push(cur);
      }
      cur = { y: it.y, h: it.h, cells: [it] };
    } else {
      cur.cells.push(it);
      const n = cur.cells.length;
      cur.y = (cur.y * (n - 1) + it.y) / n;
      cur.h = (cur.h * (n - 1) + it.h) / n;
    }
  }
  if (cur) {
    cur.cells.sort((a, b) => a.x - b.x);
    rows.push(cur);
  }
  return rows;
}

function detectHeaderBands(rows = []) {
  for (const row of rows) {
    const joined = normKey(row.cells.map((c) => c.str).join(" "));
    if (
      joined.includes("tarih") &&
      joined.includes("valor") &&
      joined.includes("saat") &&
      joined.includes("tutar") &&
      joined.includes("bakiye")
    ) {
      const bands = { ...DEFAULT_COL_X };
      for (const cell of row.cells) {
        const k = normKey(cell.str);
        if (k === "tarih") bands.tarih = cell.x;
        else if (k.startsWith("valor") || k === "valor") bands.valor = cell.x;
        else if (k === "saat") bands.saat = cell.x;
        else if (k.includes("islemi giren") || k.includes("islem giren"))
          bands.islemGiren = cell.x;
        else if (k === "aciklama") bands.aciklama = cell.x;
        else if (k === "banka") bands.banka = cell.x;
        else if (k === "unvan") bands.unvan = cell.x;
        else if (k.includes("alici")) bands.alici = cell.x;
        else if (k.includes("ozel")) bands.ozel = cell.x;
        else if (k.includes("eft")) bands.eft = cell.x;
        else if (k === "tutar") bands.tutar = cell.x;
        else if (k === "bakiye") bands.bakiye = cell.x;
        else if (k.startsWith("dekont")) bands.dekont = cell.x;
        else if (k.includes("referans")) bands.referans = cell.x;
      }
      return bands;
    }
  }
  return null;
}

/**
 * Sol kenar kolon ataması — uzun text item merkez X ile sonraki kolona kaymasın.
 * Hücre, start'ı x'ten sola en yakın (≤ x+tol) kolona aittir.
 */
function colOf(x, bands, { tol = 8 } = {}) {
  const keys = [
    "tarih",
    "valor",
    "saat",
    "islemGiren",
    "aciklama",
    "banka",
    "unvan",
    "alici",
    "ozel",
    "eft",
    "tutar",
    "bakiye",
    "dekont",
    "referans",
  ];
  let chosen = keys[0];
  for (const k of keys) {
    if (bands[k] - tol <= x) chosen = k;
    else break;
  }
  return chosen;
}

function isHeaderOrFooterRow(row = {}) {
  const text = normalizeSpaces((row.cells || []).map((c) => c.str).join(" "));
  if (!text) return true;
  if (FOOTER_RE.test(text)) return true;
  if (HEADER_LABEL_RE.test(text.split(/\s+/)[0] || "") && /tutar|bakiye|valor/i.test(text)) {
    return true;
  }
  const nk = normKey(text);
  if (
    nk.includes("tarih") &&
    nk.includes("valor") &&
    nk.includes("saat") &&
    nk.includes("tutar")
  ) {
    return true;
  }
  return false;
}

function isMovementStartRow(row = {}) {
  const cells = row.cells || [];
  if (cells.length < 3) return false;
  const first = cells[0]?.str || "";
  if (!DATE_ONLY_RE.test(first)) return false;
  // ikinci hücre valör tarihi veya saat olabilir
  const second = cells[1]?.str || "";
  const third = cells[2]?.str || "";
  if (DATE_ONLY_RE.test(second) || TIME_RE.test(second) || TIME_RE.test(third)) {
    return true;
  }
  // tutar+bakiye varlığı
  const amounts = cells.filter((c) => isAmountCell(c.str));
  return amounts.length >= 1;
}

function parseMovementRow(row, bands) {
  const bucket = {
    tarih: "",
    valor: "",
    saat: "",
    aciklama: [],
    banka: [],
    unvan: [],
    alici: [],
    ozel: [],
    eft: [],
    tutar: "",
    bakiye: "",
    dekont: [],
    referans: [],
  };

  const cells = [...(row.cells || [])].sort((a, b) => a.x - b.x);

  for (const cell of cells) {
    const col = colOf(cell.x, bands);
    const s = cell.str;

    if (col === "tarih" && DATE_ONLY_RE.test(s) && !bucket.tarih) bucket.tarih = s;
    else if (col === "valor" && DATE_ONLY_RE.test(s) && !bucket.valor) bucket.valor = s;
    else if (col === "saat" && TIME_RE.test(s) && !bucket.saat) {
      bucket.saat = s.slice(0, 5);
    } else if (col === "tutar" && isAmountCell(s) && !bucket.tutar) bucket.tutar = s;
    else if (col === "bakiye" && isAmountCell(s) && !bucket.bakiye) bucket.bakiye = s;
    else if (col === "aciklama") bucket.aciklama.push(s);
    else if (col === "banka") bucket.banka.push(s);
    else if (col === "unvan") bucket.unvan.push(s);
    else if (col === "alici") bucket.alici.push(s);
    else if (col === "ozel") bucket.ozel.push(s);
    else if (col === "eft") bucket.eft.push(s);
    else if (col === "dekont") bucket.dekont.push(s);
    else if (col === "referans") bucket.referans.push(s);
    else if (col === "islemGiren") {
      /* skip — işlem giren kolonunu açıklamaya karıştırma */
    } else if (isAmountCell(s)) {
      if (!bucket.tutar && cell.x < bands.bakiye - 10) bucket.tutar = s;
      else if (!bucket.bakiye) bucket.bakiye = s;
    }
  }

  if (!bucket.tarih) {
    const d = cells.find((c) => DATE_ONLY_RE.test(c.str));
    if (d) bucket.tarih = d.str;
  }
  if (!bucket.valor) {
    const dates = cells.filter((c) => DATE_ONLY_RE.test(c.str));
    if (dates[1]) bucket.valor = dates[1].str;
  }
  if (!bucket.saat) {
    const t = cells.find((c) => TIME_RE.test(c.str));
    if (t) bucket.saat = t.str.slice(0, 5);
  }
  if (!bucket.tutar || !bucket.bakiye) {
    const amts = cells.filter((c) => isAmountCell(c.str));
    if (!bucket.tutar && amts[0]) bucket.tutar = amts[0].str;
    if (!bucket.bakiye && amts.length >= 2) bucket.bakiye = amts[amts.length - 1].str;
  }

  return bucket;
}

/** Wrap satırında yalnızca tek-etiket başlık hücrelerini atla ("Banka havalesi" yutulmasın). */
const HEADER_EXACT_LABEL_RE =
  /^(tarih|val[oö]r|saat|a[cç][iı]klama|banka|[uü]nvan|tutar|bakiye|dekont|eft(\s*sorgu(\s*no)?)?|m[uü][sş]teri(\s*referans(ı|i)?)?|al[iı]c[iı](\s*hesap)?|[oö]zel(\s*[iı][sş]lem(\s*a[cç][iı]klama(sı|si)?)?)?|i[sş]lemi?\s*giren)$/i;

function appendWrap(bucket, row, bands) {
  for (const cell of row.cells || []) {
    const s = cell.str;
    if (FOOTER_RE.test(s)) continue;
    if (HEADER_EXACT_LABEL_RE.test(s)) continue;
    if (isAmountCell(s) || DATE_ONLY_RE.test(s) || TIME_RE.test(s)) {
      continue;
    }
    const col = colOf(cell.x, bands);
    if (col === "islemGiren") continue;
    if (col === "aciklama") bucket.aciklama.push(s);
    else if (col === "banka") bucket.banka.push(s);
    else if (col === "unvan") bucket.unvan.push(s);
    else if (col === "alici") bucket.alici.push(s);
    else if (col === "ozel") bucket.ozel.push(s);
    else if (col === "eft") bucket.eft.push(s);
    else if (col === "dekont") bucket.dekont.push(s);
    else if (col === "referans") bucket.referans.push(s);
    else if (cell.x >= bands.aciklama - 5 && cell.x < bands.banka - 5) {
      bucket.aciklama.push(s);
    }
  }
}

function joinParts(parts = []) {
  return normalizeSpaces(parts.filter(Boolean).join(" "));
}

function parseSignedAmount(raw = "") {
  const t = normalizeSpaces(raw);
  if (!t) return 0;
  const neg = t.startsWith("-") || t.startsWith("−") || /^\(.*\)$/.test(t);
  const abs = parseTrAmountToken(t);
  if (!Number.isFinite(abs)) return 0;
  const signed = neg ? -Math.abs(abs) : Math.abs(abs);
  const rounded = Math.round((signed + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function sourceTypeOf(context = {}) {
  return (
    context.sourceType ||
    (context.ocrUsed ? BANK_STATEMENT_SOURCE.PDF_OCR : BANK_STATEMENT_SOURCE.PDF)
  );
}

/**
 * @param {{ text?: string, pagesItems?: Array<{page:number,items:object[]}>, context?: object }} args
 */
export function parseTebPdfLayout({ text = "", pagesItems = null, context = {} } = {}) {
  const warnings = [];
  const probeText = String(text || "");
  if (!looksLikeTebPdfLayout(probeText) && !(pagesItems || []).length) {
    return {
      ok: false,
      code: TEB_PDF_LAYOUT_UNSUPPORTED,
      bank: "TEB",
      transactions: [],
      warnings: [{ code: TEB_PDF_LAYOUT_UNSUPPORTED }],
      winner: "teb_unsupported",
      openingBalanceHint: null,
    };
  }

  const pages = Array.isArray(pagesItems) ? pagesItems : [];
  if (!pages.length) {
    return {
      ok: false,
      code: TEB_PDF_LAYOUT_UNSUPPORTED,
      bank: "TEB",
      transactions: [],
      warnings: [{ code: "teb_pdf_items_required" }],
      winner: "teb_unsupported",
      openingBalanceHint: null,
    };
  }

  let bands = { ...DEFAULT_COL_X };
  let layoutConfirmed = false;
  let openingBalanceHint = null;
  const movements = [];
  let openBucket = null;
  let openPage = 1;
  let sourceRow = 0;

  const flush = () => {
    if (!openBucket || !openBucket.tarih) {
      openBucket = null;
      return;
    }
    const tutar = parseSignedAmount(openBucket.tutar);
    const bakiye = parseSignedAmount(openBucket.bakiye);
    const description = joinParts(openBucket.aciklama);
    if (!description || !Number.isFinite(tutar) || Math.abs(tutar) < 0.005) {
      warnings.push({ code: "teb_row_skip", page: openPage });
      openBucket = null;
      return;
    }
    sourceRow += 1;
    const direction = tutar < 0 ? "CIKIS" : "GIRIS";
    const tx = createCanonicalBankTransaction({
      bank: "TEB",
      companyId: context.companyId || "",
      transactionDate: openBucket.tarih,
      valueDate: openBucket.valor || openBucket.tarih,
      transactionTime: openBucket.saat || "",
      description,
      amount: tutar,
      direction,
      balance: Number.isFinite(bakiye) ? bakiye : null,
      documentNo: joinParts(openBucket.dekont) || `TEB-${sourceRow}`,
      counterpartyBank: joinParts(openBucket.banka),
      counterpartyName: joinParts(openBucket.unvan),
      counterAccount: joinParts(openBucket.alici),
      specialDescription: joinParts(openBucket.ozel),
      eftQueryNo: joinParts(openBucket.eft),
      customerReference: joinParts(openBucket.referans),
      accountIdentity: context.accountNo || "",
      sourcePage: openPage,
      sourceRow,
      sourceFileHash: context.sourceFileHash || "",
      sourceType: sourceTypeOf(context),
    });
    movements.push(tx);
    openBucket = null;
  };

  for (const pageEntry of pages) {
    const pageNo = Number(pageEntry?.page || pageEntry?.pageNumber || 0) || 1;
    const items = pageEntry?.items || pageEntry?.cells || [];
    const rows = clusterRows(items);
    const pageBands = detectHeaderBands(rows);
    if (pageBands) {
      bands = pageBands;
      layoutConfirmed = true;
    }

    for (const row of rows) {
      const rowText = normalizeSpaces((row.cells || []).map((c) => c.str).join(" "));
      if (isHeaderOrFooterRow(row)) continue;

      if (DEVIR_RE.test(rowText)) {
        const amts = (row.cells || []).filter((c) => isAmountCell(c.str));
        if (amts.length) {
          openingBalanceHint = parseSignedAmount(amts[amts.length - 1].str);
        }
        continue;
      }

      if (isMovementStartRow(row)) {
        flush();
        openBucket = parseMovementRow(row, bands);
        openPage = pageNo;
        continue;
      }

      // wrap / continuation
      if (openBucket) {
        appendWrap(openBucket, row, bands);
      }
    }
  }
  flush();

  if (!layoutConfirmed && movements.length < 10) {
    return {
      ok: false,
      code: TEB_PDF_LAYOUT_UNSUPPORTED,
      bank: "TEB",
      transactions: [],
      warnings: [{ code: TEB_PDF_LAYOUT_UNSUPPORTED }],
      winner: "teb_unsupported",
      openingBalanceHint: null,
    };
  }

  return {
    ok: movements.length > 0,
    bank: "TEB",
    transactions: movements,
    warnings,
    winner: "teb_coords",
    openingBalanceHint,
    documentType: BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT,
  };
}
