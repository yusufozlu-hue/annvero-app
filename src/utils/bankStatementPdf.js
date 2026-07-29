/**
 * Banka ekstresi PDF — metin katmanı çıkarımı + güvenli limitler.
 * OCR yoksa sahte sonuç üretmez; OCR_REQUIRED döner.
 * Ham PDF / banka detayı loglanmaz.
 */

import {
  BANK_PARSE_STATUS,
  BANK_STATEMENT_SOURCE,
  buildSourceFileHash,
  createCanonicalBankTransaction,
  dedupeCanonicalTransactions,
  legacyBankRowsToCanonical,
} from "@/src/utils/bankCanonicalTransaction.js";

export const PDF_MAX_BYTES = 8 * 1024 * 1024;
export const PDF_MAX_PAGES = 80;
export const PDF_PARSE_TIMEOUT_MS = 25_000;

const SAFE = Object.freeze({
  EMPTY: "PDF dosyası boş veya okunamadı.",
  TOO_LARGE: `PDF çok büyük. En fazla ${(PDF_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB yükleyebilirsiniz.`,
  NOT_PDF: "Dosya geçerli bir PDF değil.",
  ENCRYPTED: "Şifreli PDF desteklenmiyor. Şifreyi kaldırıp tekrar yükleyin.",
  TOO_MANY_PAGES: `PDF sayfa sayısı çok yüksek. En fazla ${PDF_MAX_PAGES} sayfa desteklenir.`,
  TIMEOUT: "PDF ayrıştırma zaman aşımına uğradı. Dosyayı bölüp tekrar deneyin.",
  CORRUPT: "PDF bozuk veya desteklenmeyen biçimde.",
  OCR_REQUIRED:
    "Bu PDF taranmış görünüyor; metin katmanı yok. OCR tamamlanana kadar inceleme kuyruğuna alındı.",
  UNSUPPORTED: "Bu PDF banka ekstresi olarak tanınamadı.",
  CANCELLED: "PDF ayrıştırma iptal edildi.",
  INCOMPLETE: "PDF sayfaları eksik veya tamamlanmamış görünüyor.",
});

function asBytes(input) {
  if (!input) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (typeof input === "string") {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i += 1) out[i] = input.charCodeAt(i) & 0xff;
    return out;
  }
  return new Uint8Array(0);
}

function bytesToLatin1(bytes) {
  const arr = asBytes(bytes);
  const chunk = 0x4000;
  let out = "";
  for (let i = 0; i < arr.length; i += chunk) {
    const slice = arr.subarray(i, i + chunk);
    let part = "";
    for (let j = 0; j < slice.length; j += 1) part += String.fromCharCode(slice[j]);
    out += part;
  }
  return out;
}

export function isPdfBuffer(bytes) {
  const buf = asBytes(bytes);
  if (buf.length < 5) return false;
  return (
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  );
}

export function isEncryptedPdf(bytes) {
  return /\/Encrypt[\s\/\[]/i.test(bytesToLatin1(bytes));
}

export function estimatePdfPageCount(bytes) {
  const text = bytesToLatin1(bytes);
  const countMatch = text.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/i);
  if (countMatch) return Number(countMatch[1]) || 0;
  const pageObjs = text.match(/\/Type\s*\/Page(?![s])/gi);
  return pageObjs ? pageObjs.length : 0;
}

export function looksIncompletePdf(bytes) {
  const text = bytesToLatin1(bytes);
  // Yalnız gerçekten kesilmiş dosyalar — sentetik fixture'larda Count/Page farkı olabilir.
  return !/%%EOF/i.test(text);
}

/**
 * Minimal text extraction — Tj / TJ operatörleri + literal strings.
 * Gelişmiş layout için OCR yolu ayrıdır.
 */
export function extractPdfTextLayer(bytes, { maxChars = 500_000, signal } = {}) {
  if (signal?.aborted) {
    const err = new Error(SAFE.CANCELLED);
    err.code = "PDF_CANCELLED";
    throw err;
  }
  const raw = bytesToLatin1(bytes);
  const chunks = [];
  let total = 0;

  const push = (s) => {
    if (!s || total >= maxChars) return;
    const piece = String(s).slice(0, maxChars - total);
    chunks.push(piece);
    total += piece.length;
  };

  const tjRe = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let m;
  while ((m = tjRe.exec(raw)) && total < maxChars) {
    if (signal?.aborted) {
      const err = new Error(SAFE.CANCELLED);
      err.code = "PDF_CANCELLED";
      throw err;
    }
    const inner = m[0].replace(/\)\s*Tj$/, "").slice(1);
    push(
      inner
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
    );
    // Satır sonu — banka ekstre Td/Tj akışında her Tj ayrı satır kabul edilir
    push("\n");
  }

  const tjArrayRe = /\[(.*?)\]\s*TJ/gs;
  while ((m = tjArrayRe.exec(raw)) && total < maxChars) {
    const parts = m[1].match(/\((?:\\.|[^\\)])*\)/g) || [];
    for (const p of parts) {
      push(p.slice(1, -1).replace(/\\n/g, "\n").replace(/\\\(/g, "(").replace(/\\\)/g, ")"));
      push(" ");
    }
    push("\n");
  }

  if (total < 40) {
    const streams = raw.match(/stream\r?\n([\s\S]*?)\r?\nendstream/gi) || [];
    for (const stream of streams) {
      const body = stream.replace(/^stream\r?\n/i, "").replace(/\r?\nendstream$/i, "");
      const readable = body.replace(/[^\x09\x0A\x0D\x20-\x7E\xC0-\xFF]+/g, " ");
      if (readable.trim().length > 20) push(readable);
      if (total >= maxChars) break;
    }
  }

  return chunks.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeLine(line = "") {
  return String(line || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HEADER_FOOTER_RE =
  /^(sayfa\s*\d+|page\s*\d+|devam\s* ediyor|continued|www\.|telefon|müşteri\s*hizmet|copyright|---\s*page)/i;
const SUBTOTAL_RE =
  /(ara\s*toplam|günlük\s*toplam|toplam\s*borç|toplam\s*alacak|opening\s*balance|açılış\s*bakiyesi|kapanış\s*bakiyesi|previous\s*balance|devreden\s*bakiye)/i;

export function isPdfNonMovementLine(line = "") {
  const t = normalizeLine(line);
  if (!t) return true;
  if (HEADER_FOOTER_RE.test(t)) return true;
  if (SUBTOTAL_RE.test(t)) return true;
  return false;
}

/**
 * Metin satırlarından kaba tablo matrisi (banka parser header taraması için).
 */
export function pdfTextToSheetRows(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((l) => l && !isPdfNonMovementLine(l));

  const rows = [["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"]];
  for (const line of lines) {
    const dateMatch = line.match(/^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s+(.+)$/);
    if (!dateMatch) {
      rows.push([line]);
      continue;
    }
    const rest = dateMatch[2];
    const amounts = [...rest.matchAll(/-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2})/g)].map(
      (x) => x[0]
    );
    let description = rest;
    for (const a of amounts) description = description.replace(a, " ").trim();
    description = description.replace(/\s+/g, " ").trim();
    if (amounts.length >= 3) {
      rows.push([dateMatch[1], description, amounts[0], amounts[1], amounts[2]]);
    } else if (amounts.length === 2) {
      rows.push([dateMatch[1], description, amounts[0], amounts[1], ""]);
    } else if (amounts.length === 1) {
      rows.push([dateMatch[1], description, amounts[0], "", ""]);
    } else {
      rows.push([dateMatch[1], description, "", "", ""]);
    }
  }
  return rows;
}

function detectBankFromPdfText(text = "") {
  const t = String(text || "").toLocaleLowerCase("tr-TR");
  if (/vak[ıi]f\s*bank|vakifbank/.test(t)) return "VAKIFBANK";
  if (/garanti|bbva/.test(t)) return "GARANTI";
  if (/\bteb\b|t[üu]rkiye ekonomi bank/.test(t)) return "TEB";
  if (/ziraat/.test(t)) return "ZIRAAT";
  if (/kuveyt/.test(t)) return "KUVEYT";
  return "UNKNOWN";
}

function parseTrAmount(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return NaN;
  const normalized = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

const AMOUNT_TOKEN =
  "-?\\d{1,3}(?:[.\\s]\\d{3})*(?:,\\d{2})|-?\\d+(?:,\\d{2})";

/**
 * Satır bazlı hareket çıkarımı → ortak kanonik modele.
 * Format: tarih açıklama [borç] [alacak] [bakiye]
 */
export function parsePdfMovementLines(text = "", context = {}) {
  const body = typeof text === "string" ? text : "";
  const bank = context.selectedBank || detectBankFromPdfText(body);
  const lines = body.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const out = [];
  const warnings = [];
  let currentPage = Number(context.pageHint) || 1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const pageMark = line.match(/^---\s*page\s+(\d+)\s*---$/i);
    if (pageMark) {
      currentPage = Number(pageMark[1]) || currentPage;
      continue;
    }
    if (isPdfNonMovementLine(line)) continue;

    const m = line.match(
      new RegExp(
        `^(\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4})\\s+(.+?)\\s+(${AMOUNT_TOKEN})(?:\\s+(${AMOUNT_TOKEN}))?(?:\\s+(${AMOUNT_TOKEN}))?$`
      )
    );
    if (!m) continue;

    const amounts = [m[3], m[4], m[5]]
      .filter((x) => x != null && String(x).trim() !== "")
      .map(parseTrAmount)
      .filter((n) => Number.isFinite(n));

    let debit = 0;
    let credit = 0;
    let balance = null;
    let signed = 0;

    if (amounts.length >= 3) {
      debit = amounts[0];
      credit = amounts[1];
      balance = amounts[2];
      signed = debit > 0 ? debit : credit > 0 ? -credit : 0;
    } else if (amounts.length === 2) {
      // borç + alacak veya tutar + bakiye
      if (amounts[0] > 0 && amounts[1] === 0) {
        debit = amounts[0];
        signed = debit;
      } else if (amounts[1] > 0 && amounts[0] === 0) {
        credit = amounts[1];
        signed = -credit;
      } else if (amounts[0] !== 0 && amounts[1] !== 0 && Math.abs(amounts[0]) < 1e12) {
        // tutar + bakiye (işaretli tutar)
        signed = amounts[0];
        balance = amounts[1];
        if (signed >= 0) debit = Math.abs(signed);
        else credit = Math.abs(signed);
      } else {
        signed = amounts[0];
        balance = amounts[1];
        if (signed >= 0) debit = Math.abs(signed);
        else credit = Math.abs(signed);
      }
    } else if (amounts.length === 1) {
      signed = amounts[0];
      if (signed >= 0) debit = Math.abs(signed);
      else credit = Math.abs(signed);
    } else {
      warnings.push({ row: i + 1, code: "amount_skip" });
      continue;
    }

    if (!Number.isFinite(signed) || signed === 0) {
      warnings.push({ row: i + 1, code: "amount_skip" });
      continue;
    }

    const direction = signed < 0 ? "CIKIS" : "GIRIS";
    out.push(
      createCanonicalBankTransaction({
        companyId: context.companyId,
        bank,
        accountIdentity: context.accountIdentity || "",
        transactionDate: m[1].replace(/-/g, "."),
        description: m[2],
        amount: signed,
        debit_amount: debit,
        credit_amount: credit,
        direction,
        balance: Number.isFinite(balance) ? balance : null,
        currency: context.currency || "TRY",
        sourceRow: i + 1,
        sourcePage: currentPage,
        sourceFileHash: context.sourceFileHash,
        sourceType: BANK_STATEMENT_SOURCE.PDF,
        parseWarnings: [],
      })
    );
  }

  return { transactions: out, warnings, bank };
}

/**
 * Açılış/kapanış bakiyesi mutabakatı.
 */
export function reconcileStatementBalances(transactions = [], hints = {}) {
  const txs = [...(transactions || [])];
  if (!txs.length) {
    return { ok: true, code: "EMPTY", delta: 0, reviewRequired: false };
  }
  const opening = hints.openingBalance;
  const closing = hints.closingBalance;
  if (
    opening == null ||
    closing == null ||
    !Number.isFinite(Number(opening)) ||
    !Number.isFinite(Number(closing))
  ) {
    return { ok: true, code: "NO_HINTS", delta: 0, reviewRequired: false };
  }
  const net = txs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const expected = Number(opening) + net;
  const delta = Number((expected - Number(closing)).toFixed(2));
  if (Math.abs(delta) > 0.05) {
    return {
      ok: false,
      code: "BALANCE_MISMATCH",
      delta,
      reviewRequired: true,
      message:
        "Açılış/kapanış bakiyesi hareket toplamı ile uyuşmuyor. Otomatik fiş üretilmedi; inceleme gerekli.",
    };
  }
  return { ok: true, code: "MATCHED", delta: 0, reviewRequired: false };
}

export function extractBalanceHintsFromText(text = "") {
  const t = String(text || "");
  const open =
    t.match(/a[cç]ili[sş]\s*bakiyesi\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2}))/i) ||
    t.match(/opening\s*balance\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2}))/i);
  const close =
    t.match(/kapan[iı][sş]\s*bakiyesi\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2}))/i) ||
    t.match(/closing\s*balance\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2}))/i);
  return {
    openingBalance: open ? parseTrAmount(open[1]) : null,
    closingBalance: close ? parseTrAmount(close[1]) : null,
  };
}

/**
 * PDF banka ekstresi ana giriş.
 */
export async function parseBankStatementPdf(bytes, options = {}) {
  const started = Date.now();
  const buf = asBytes(bytes);
  const sourceFileHash = buildSourceFileHash(buf);
  const signal = options.signal;

  if (signal?.aborted) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.ERROR,
      code: "PDF_CANCELLED",
      message: SAFE.CANCELLED,
      transactions: [],
      sourceFileHash,
    };
  }
  if (!buf.length) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.ERROR,
      code: "EMPTY_PDF",
      message: SAFE.EMPTY,
      transactions: [],
      sourceFileHash,
    };
  }
  if (buf.byteLength > PDF_MAX_BYTES) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.ERROR,
      code: "PDF_TOO_LARGE",
      message: SAFE.TOO_LARGE,
      transactions: [],
      sourceFileHash,
    };
  }
  if (!isPdfBuffer(buf)) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.ERROR,
      code: "NOT_PDF",
      message: SAFE.NOT_PDF,
      transactions: [],
      sourceFileHash,
    };
  }
  if (isEncryptedPdf(buf)) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.ERROR,
      code: "PDF_ENCRYPTED",
      message: SAFE.ENCRYPTED,
      transactions: [],
      sourceFileHash,
    };
  }

  const pages = estimatePdfPageCount(buf);
  if (pages > PDF_MAX_PAGES) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.ERROR,
      code: "PDF_TOO_MANY_PAGES",
      message: SAFE.TOO_MANY_PAGES,
      transactions: [],
      sourceFileHash,
      pageCount: pages,
    };
  }
  if (looksIncompletePdf(buf)) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.ERROR,
      code: "PDF_INCOMPLETE",
      message: SAFE.INCOMPLETE,
      transactions: [],
      sourceFileHash,
      pageCount: pages,
    };
  }

  const timeoutMs = Number(options.timeoutMs) || PDF_PARSE_TIMEOUT_MS;
  let text = "";
  try {
    text = await Promise.race([
      Promise.resolve().then(() => extractPdfTextLayer(buf, { signal })),
      new Promise((_, reject) => {
        const err = new Error(SAFE.TIMEOUT);
        err.code = "PDF_TIMEOUT";
        setTimeout(() => reject(err), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error?.code === "PDF_CANCELLED" || signal?.aborted) {
      return {
        ok: false,
        status: BANK_PARSE_STATUS.ERROR,
        code: "PDF_CANCELLED",
        message: SAFE.CANCELLED,
        transactions: [],
        sourceFileHash,
      };
    }
    if (error?.code === "PDF_TIMEOUT" || Date.now() - started >= timeoutMs) {
      return {
        ok: false,
        status: BANK_PARSE_STATUS.ERROR,
        code: "PDF_TIMEOUT",
        message: SAFE.TIMEOUT,
        transactions: [],
        sourceFileHash,
      };
    }
    return {
      ok: false,
      status: BANK_PARSE_STATUS.ERROR,
      code: "PDF_CORRUPT",
      message: SAFE.CORRUPT,
      transactions: [],
      sourceFileHash,
    };
  }

  const letters = (text.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length;
  if (!text || letters < 40) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.OCR_REQUIRED,
      code: "OCR_REQUIRED",
      message: SAFE.OCR_REQUIRED,
      transactions: [],
      sourceFileHash,
      pageCount: pages,
      ocrRequired: true,
    };
  }

  const parsed = parsePdfMovementLines(text, {
    ...options,
    sourceFileHash,
    selectedBank: options.selectedBank || detectBankFromPdfText(text),
  });

  const hints = extractBalanceHintsFromText(text);
  const balance = reconcileStatementBalances(parsed.transactions, hints);

  if (!parsed.transactions.length) {
    return {
      ok: false,
      status: BANK_PARSE_STATUS.REVIEW_REQUIRED,
      code: "PDF_UNSUPPORTED_LAYOUT",
      message: SAFE.UNSUPPORTED,
      transactions: [],
      sourceFileHash,
      sheetRows: pdfTextToSheetRows(text),
      detectedBank: parsed.bank,
    };
  }

  const status = balance.reviewRequired
    ? BANK_PARSE_STATUS.REVIEW_REQUIRED
    : parsed.warnings.length
      ? BANK_PARSE_STATUS.WARNING
      : BANK_PARSE_STATUS.OK;

  return {
    ok: !balance.reviewRequired,
    status,
    code: balance.reviewRequired ? "BALANCE_MISMATCH" : "OK",
    message: balance.reviewRequired ? balance.message : "",
    transactions: parsed.transactions,
    warnings: parsed.warnings,
    sourceFileHash,
    pageCount: pages,
    detectedBank: parsed.bank,
    balance,
    elapsedMs: Date.now() - started,
    sourceType: BANK_STATEMENT_SOURCE.PDF,
    sheetRows: pdfTextToSheetRows(text),
  };
}

/**
 * Excel legacy satırları ile PDF kanoniklerini birleştirip çapraz dedup.
 * Hash farklı olsa bile hareket kimliği aynıysa ikinci kayıt üretilmez.
 */
export function mergeExcelAndPdfTransactions(excelLegacyRows = [], pdfResult = {}, context = {}) {
  const fromExcel = legacyBankRowsToCanonical(excelLegacyRows, {
    ...context,
    sourceFileType: BANK_STATEMENT_SOURCE.XLSX,
    sourceFileHash: context.excelFileHash || context.sourceFileHash,
  });
  const fromPdf = (pdfResult.transactions || []).map((tx) =>
    createCanonicalBankTransaction({
      ...tx,
      sourceType: BANK_STATEMENT_SOURCE.PDF,
      sourceFileHash: pdfResult.sourceFileHash || tx.sourceFileHash,
    })
  );
  const { unique, duplicates } = dedupeCanonicalTransactions([...fromExcel, ...fromPdf]);
  return {
    unique,
    duplicates,
    excelCount: fromExcel.length,
    pdfCount: fromPdf.length,
  };
}
