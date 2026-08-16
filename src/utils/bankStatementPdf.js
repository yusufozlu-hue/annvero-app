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
import {
  BALANCE_EVIDENCE_MISSING,
  BALANCE_MISMATCH,
  MISSING_CLOSING_BALANCE,
  MISSING_OPENING_BALANCE,
  reconcileStatementBalances,
} from "@/src/utils/bankBalanceReconcile.js";
import { normalizeOcrStatementText } from "@/src/utils/bankOcr/normalizeOcrStatementText.js";

export { reconcileStatementBalances } from "@/src/utils/bankBalanceReconcile.js";

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

function countStatementDates(text = "") {
  return (String(text || "").match(/\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}/g) || [])
    .length;
}

function countStatementAmounts(text = "") {
  return (
    String(text || "").match(
      /-?\d{1,3}(?:[.\s']\d{3})*(?:,\d{2})|-?\d+(?:,\d{2})/g
    ) || []
  ).length;
}

const DATE_LINE_START_RE = /^\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}\b/;
const AMOUNT_TOKEN_RE =
  /-?\d{1,3}(?:[.\s']\d{3})*(?:,\d{2})|-?\d+(?:,\d{2})/;

/**
 * Eski (P0-bug) skor — yalnızca regresyon testleri için.
 * Uzun latin1 çöpü letter tavanı + sahte tarihlerle daha kısa ama yapısal pdfjs’i yenebiliyordu.
 */
export function scoreExtractedStatementTextLegacy(text = "") {
  const t = String(text || "");
  const dates = countStatementDates(t);
  const amounts = countStatementAmounts(t);
  const letters = (t.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length;
  if (dates === 0) return Math.min(letters, 20);
  return dates * 20 + amounts * 5 + Math.min(letters, 400);
}

/**
 * Hafif yapısal + parse kalite ölçümü (tam pipeline değil).
 * Uzunluk / banka adı tek başına kazanamaz.
 */
export function probeExtractCandidate(text = "", { name = "unknown" } = {}) {
  const t = String(text || "");
  const lines = t
    .split(/\r?\n/)
    .map((line) => String(line || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const dateCount = countStatementDates(t);
  const amountCount = countStatementAmounts(t);
  const letterCount = (t.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length;
  let controlChars = 0;
  let replacementLike = 0;
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 0x7f || c === 0xfffd) controlChars += 1;
  }
  replacementLike = (t.match(/\uFFFD|Ã.|Â./g) || []).length;
  const dateStartLines = lines.filter((line) => DATE_LINE_START_RE.test(line)).length;
  const structuredTxLines = lines.filter(
    (line) => DATE_LINE_START_RE.test(line) && AMOUNT_TOKEN_RE.test(line)
  ).length;
  const longMergedLines = lines.filter((line) => line.length > 160).length;
  const avgLineLen = lines.length
    ? Math.round(lines.reduce((sum, line) => sum + line.length, 0) / lines.length)
    : 0;
  const controlRatio = t.length ? controlChars / t.length : 0;
  const replacementRatio = t.length ? replacementLike / t.length : 0;
  const longMergedRatio = lines.length ? longMergedLines / lines.length : 0;

  // Sınırlı parse probe — normalize yalnız yapısal adaylarda (uzun birleşmiş çöpte yok).
  let parsedTx = 0;
  let withDirection = 0;
  let withBalance = 0;
  let dupRate = 0;
  let usedNormalizeProbe = false;
  if (t && (structuredTxLines > 0 || dateStartLines > 0 || dateCount > 0)) {
    let parsed = parsePdfMovementLines(t, {});
    let txs = parsed.transactions || [];
    if (
      !txs.length &&
      dateStartLines > 0 &&
      t.length <= 100_000 &&
      longMergedRatio < 0.25 &&
      controlRatio < 0.02
    ) {
      const normalized = normalizeOcrStatementText(t);
      if (normalized && normalized !== t) {
        const retry = parsePdfMovementLines(normalized, {});
        if ((retry.transactions || []).length > 0) {
          parsed = retry;
          txs = retry.transactions || [];
          usedNormalizeProbe = true;
        }
      }
    }
    parsedTx = txs.length;
    withDirection = txs.filter((tx) => tx.direction === "GIRIS" || tx.direction === "CIKIS")
      .length;
    withBalance = txs.filter((tx) => Number.isFinite(Number(tx.balance))).length;
    if (txs.length > 1) {
      const keys = new Set();
      let dups = 0;
      for (const tx of txs) {
        const key = [
          tx.transactionDate || "",
          tx.direction || "",
          Number(tx.debit) || 0,
          Number(tx.credit) || 0,
          String(tx.description || "").slice(0, 48),
        ].join("|");
        if (keys.has(key)) dups += 1;
        else keys.add(key);
      }
      dupRate = dups / txs.length;
    }
  }

  const unparsedRate =
    dateStartLines > 0 ? Math.max(0, dateStartLines - parsedTx) / dateStartLines : 1;

  return {
    name: String(name || "unknown"),
    textLen: t.length,
    lineCount: lines.length,
    dateCount,
    amountCount,
    letterCount,
    dateStartLines,
    structuredTxLines,
    longMergedLines,
    avgLineLen,
    controlRatio,
    replacementRatio,
    longMergedRatio,
    parsedTx,
    withDirection,
    withBalance,
    dupRate,
    unparsedRate,
    usedNormalizeProbe,
    bank: detectBankFromPdfText(t),
  };
}

/**
 * Öncelik: A yapı → B parse → C bakiye → D metin kalitesi.
 * Length/bank adı tek başına yetmez; geçerli pdfjs corrupt latin1’i yener.
 */
export function scoreExtractCandidate(probe = {}) {
  const p = probe && typeof probe === "object" ? probe : {};
  const structured = Number(p.structuredTxLines) || 0;
  const dateStarts = Number(p.dateStartLines) || 0;
  const parsedTx = Number(p.parsedTx) || 0;
  const withDirection = Number(p.withDirection) || 0;
  const withBalance = Number(p.withBalance) || 0;
  const dates = Number(p.dateCount) || 0;
  const amounts = Number(p.amountCount) || 0;

  if (!p.textLen && !dates && !parsedTx) return 0;

  // A — yapısal geçerlilik
  let score = 0;
  score += Math.min(structured, 80) * 50;
  score += Math.min(dateStarts, 80) * 12;
  score += Math.min(amounts, 120) * 2;
  // Serbest tarih tokenları (satır başı olmayan) düşük ağırlık — latin1 çöpü şişirmesin
  score += Math.min(dates, 40) * 2;

  // B — parse sonucu (baskın)
  score += Math.min(parsedTx, 200) * 120;
  score += Math.min(withDirection, 200) * 15;
  score -= Math.round((Number(p.unparsedRate) || 0) * 250);
  score -= Math.round((Number(p.dupRate) || 0) * 180);

  // C — bakiye kanıtı
  score += Math.min(withBalance, 200) * 25;

  // D — metin kalitesi cezaları + anlamsız uzunluk
  score -= Math.round((Number(p.controlRatio) || 0) * 900);
  score -= Math.round((Number(p.replacementRatio) || 0) * 700);
  score -= Math.round((Number(p.longMergedRatio) || 0) * 500);
  if (structured === 0 && parsedTx === 0 && (Number(p.textLen) || 0) > 4000) {
    score -= Math.min(900, Math.floor((Number(p.textLen) || 0) / 80));
  }
  if ((Number(p.avgLineLen) || 0) > 200 && structured < 2) {
    score -= 180;
  }
  // Letter bonus neredeyse yok (eski bug kaynağı)
  score += Math.min(Number(p.letterCount) || 0, 40);

  return Math.round(score);
}

/**
 * Adaylar arasından kazananı seç. İkisi de çürükse OCR_REQUIRED.
 * @returns {{ decision: 'use'|'OCR_REQUIRED', winner: object|null, ranked: object[], reason: string }}
 */
export function selectBestExtractCandidate(candidates = [], { preferNames = ["pdfjs", "native"] } = {}) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && typeof c === "object")
    .map((c) => {
      const probe =
        c.probe && typeof c.probe === "object"
          ? c.probe
          : probeExtractCandidate(c.text || "", { name: c.name || "unknown" });
      const score = Number.isFinite(Number(c.score))
        ? Number(c.score)
        : scoreExtractCandidate(probe);
      return {
        name: String(c.name || probe.name || "unknown"),
        text: String(c.text || ""),
        probe,
        score,
      };
    })
    .filter((c) => c.text.length > 0 || (c.probe?.parsedTx || 0) > 0);

  if (!list.length) {
    return {
      decision: "OCR_REQUIRED",
      winner: null,
      ranked: [],
      reason: "no_extract_candidates",
    };
  }

  const prefer = new Set((preferNames || []).map(String));
  list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aPref = prefer.has(a.name) ? 1 : 0;
    const bPref = prefer.has(b.name) ? 1 : 0;
    if (bPref !== aPref) return bPref - aPref;
    // Eşitlikte daha az birleşmiş / daha kısa metin (çöp değil yapı)
    const aMerge = Number(a.probe?.longMergedRatio) || 0;
    const bMerge = Number(b.probe?.longMergedRatio) || 0;
    if (aMerge !== bMerge) return aMerge - bMerge;
    return (Number(a.probe?.textLen) || 0) - (Number(b.probe?.textLen) || 0);
  });

  const best = list[0];
  const second = list[1];
  const bestUsable =
    (best.probe?.parsedTx || 0) > 0 ||
    (best.probe?.structuredTxLines || 0) >= 1 ||
    ((best.probe?.dateStartLines || 0) >= 1 && (best.probe?.amountCount || 0) >= 1);

  if (!bestUsable) {
    return {
      decision: "OCR_REQUIRED",
      winner: null,
      ranked: list,
      reason: "all_candidates_unusable",
    };
  }

  // İkinci aday parse’ta açık ara öndeyse (nadir tie-break) — zaten sort skorla yönetir.
  let reason = "highest_structural_parse_score";
  if (second && best.score === second.score && prefer.has(best.name)) {
    reason = "tie_prefer_native_pdfjs";
  } else if ((best.probe?.parsedTx || 0) > (second?.probe?.parsedTx || 0)) {
    reason = "more_parsed_transactions";
  } else if ((best.probe?.structuredTxLines || 0) > (second?.probe?.structuredTxLines || 0)) {
    reason = "better_structured_tx_lines";
  }

  return {
    decision: "use",
    winner: best,
    ranked: list,
    reason,
  };
}

/** @deprecated Eski formül; yeni seçim selectBestExtractCandidate kullanır. */
export function scoreExtractedStatementText(text = "") {
  return scoreExtractCandidate(probeExtractCandidate(text));
}

function buildExtractDiagnostics({
  extractPath = "none",
  pdfjsOk = false,
  pdfjsErrorCode = "",
  textLen = 0,
  dateCount = 0,
  letterCount = 0,
  selectionReason = "",
  candidateScores = undefined,
} = {}) {
  return {
    extractPath,
    pdfjsOk: Boolean(pdfjsOk),
    pdfjsErrorCode: pdfjsErrorCode ? String(pdfjsErrorCode).slice(0, 64) : undefined,
    textLen: Number(textLen) || 0,
    dateCount: Number(dateCount) || 0,
    letterCount: Number(letterCount) || 0,
    selectionReason: selectionReason ? String(selectionReason).slice(0, 96) : undefined,
    candidateScores: Array.isArray(candidateScores) ? candidateScores : undefined,
  };
}

function rebuildLinesFromPdfJsItems(items = []) {
  const mapped = (items || [])
    .filter((it) => it && typeof it.str === "string" && it.str.trim())
    .map((it) => {
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      return {
        str: String(it.str),
        x: Number(tr[4]) || 0,
        y: Number(tr[5]) || 0,
        h: Math.abs(Number(tr[3]) || 10) || 10,
      };
    });
  if (!mapped.length) return [];
  // PDF user-space: y yukarı; satırları yukarıdan aşağı oku
  mapped.sort((a, b) => (Math.abs(a.y - b.y) < 1.5 ? a.x - b.x : b.y - a.y));
  const lines = [];
  let cur = null;
  for (const it of mapped) {
    const band = Math.max(6, (cur?.h || it.h) * 0.65);
    if (!cur || Math.abs(it.y - cur.y) > band) {
      if (cur) {
        cur.parts.sort((a, b) => a.x - b.x);
        const row = cur.parts
          .map((p) => p.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (row) lines.push(row);
      }
      cur = { y: it.y, h: it.h, parts: [it] };
    } else {
      cur.parts.push(it);
      const n = cur.parts.length;
      cur.y = (cur.y * (n - 1) + it.y) / n;
      cur.h = (cur.h * (n - 1) + it.h) / n;
    }
  }
  if (cur) {
    cur.parts.sort((a, b) => a.x - b.x);
    const row = cur.parts
      .map((p) => p.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (row) lines.push(row);
  }
  return lines;
}

/**
 * pdf.js getTextContent + Y geometrisi — VakıfBank tablo satırlarını korur.
 * Latin1 Tj fallback’tan önce tercih edilir (çöp stream metni hareket kırar).
 */
export async function extractPdfTextLayerPdfJs(
  bytes,
  { maxChars = 500_000, signal, maxPages = PDF_MAX_PAGES } = {}
) {
  if (signal?.aborted) {
    const err = new Error(SAFE.CANCELLED);
    err.code = "PDF_CANCELLED";
    throw err;
  }
  const data = asBytes(bytes);
  if (!data.length) return "";

  // Independent copy — transferable/detached views break getDocument on some runtimes.
  const copy =
    typeof Buffer !== "undefined"
      ? new Uint8Array(Buffer.from(data))
      : (() => {
          const out = new Uint8Array(data.byteLength);
          out.set(data);
          return out;
        })();

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let task;
  try {
    task = getDocument({
      data: copy,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });
  } catch (e) {
    const err = new Error("PDFJS_GETDOCUMENT");
    err.code = "PDFJS_GETDOCUMENT";
    err.cause = e;
    throw err;
  }
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    const err = new Error("PDFJS_LOAD");
    err.code = String(e?.name || e?.code || "PDFJS_LOAD").slice(0, 64);
    throw err;
  }
  const total = Math.min(Number(pdf.numPages) || 0, maxPages);
  const out = [];
  let chars = 0;
  for (let p = 1; p <= total; p += 1) {
    if (signal?.aborted) {
      const err = new Error(SAFE.CANCELLED);
      err.code = "PDF_CANCELLED";
      throw err;
    }
    const page = await pdf.getPage(p);
    const content = await page.getTextContent({
      // Geometry items only — no marked content / extra deps
      includeMarkedContent: false,
    });
    const lines = rebuildLinesFromPdfJsItems(content?.items || []);
    if (total > 1) {
      const mark = `--- page ${p} ---`;
      out.push(mark);
      chars += mark.length + 1;
    }
    for (const line of lines) {
      if (chars >= maxChars) break;
      const piece = line.slice(0, maxChars - chars);
      out.push(piece);
      chars += piece.length + 1;
    }
    if (chars >= maxChars) break;
  }
  try {
    await pdf.destroy?.();
  } catch {
    /* ignore */
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
  /(ara\s*toplam|g[uü]nl[uü]k\s*toplam|toplam\s*bor[cç]|toplam\s*alacak|opening\s*balance|a[cç][iı]l[iı][sş]\s*bakiyesi|kapan[iı][sş]\s*bakiyesi|previous\s*balance|closing\s*balance|devreden\s*bakiye)/i;

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
  const normalized = s
    .replace(/\s/g, "")
    .replace(/'/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

const AMOUNT_TOKEN =
  "-?\\d{1,3}(?:[.\\s']\\d{3})*(?:,\\d{2})|-?\\d+(?:,\\d{2})";

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
  const sourceType =
    context.sourceType ||
    (context.ocrUsed ? BANK_STATEMENT_SOURCE.PDF_OCR : BANK_STATEMENT_SOURCE.PDF);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const pageMark = line.match(/^---\s*page\s+(\d+)\s*---$/i);
    if (pageMark) {
      currentPage = Number(pageMark[1]) || currentPage;
      continue;
    }
    if (isPdfNonMovementLine(line)) continue;

    // OCR sonrası birleşik satır: tarih + açıklama + 1–3 tutar
    // Boş kolon / tire → 0,00 kabul (OCR tablo boşluğu)
    const ocrLine = line
      .replace(/\s+[-–—]\s+/g, " 0,00 ")
      .replace(/\s+[-–—]$/g, " 0,00");
    const strictMatch = ocrLine.match(
      new RegExp(
        `^(\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4})\\s+(.+?)\\s+(${AMOUNT_TOKEN})(?:\\s+(${AMOUNT_TOKEN}))?(?:\\s+(${AMOUNT_TOKEN}))?$`
      )
    );
    let transactionDate = "";
    let descriptionText = "";
    let amountTokens = [];
    if (strictMatch) {
      transactionDate = strictMatch[1];
      descriptionText = strictMatch[2];
      amountTokens = [strictMatch[3], strictMatch[4], strictMatch[5]].filter(
        (x) => x != null && String(x).trim() !== ""
      );
    } else {
      // VakıfBank metin katmanında tutar kolonları açıklamanın ortasında kalabilir.
      // Satır tarih ile başlamalı; yalnız satır içindeki gerçek para tokenları alınır.
      const flexible = ocrLine.match(
        /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s+(.+)$/
      );
      if (!flexible) continue;
      transactionDate = flexible[1];
      const rest = flexible[2];
      const matches = [...rest.matchAll(new RegExp(AMOUNT_TOKEN, "g"))];
      if (!matches.length) continue;
      amountTokens = matches.map((match) => match[0]);
      descriptionText = rest;
      for (const token of amountTokens) {
        descriptionText = descriptionText.replace(token, " ");
      }
    }
    const amounts = amountTokens
      .map(parseTrAmount)
      .filter((n) => Number.isFinite(n));

    let debit = 0;
    let credit = 0;
    let balance = null;
    let signed = 0;

    if (amounts.length >= 3) {
      debit = Math.abs(amounts[0]) > 0 && amounts[0] !== 0 ? Math.abs(amounts[0]) : 0;
      credit = Math.abs(amounts[1]) > 0 && amounts[1] !== 0 ? Math.abs(amounts[1]) : 0;
      // OCR bazen borç/alacak kolonlarını ters okur — yalnız biri doluysa onu kullan
      if (amounts[0] !== 0 && amounts[1] === 0) {
        debit = Math.abs(amounts[0]);
        credit = 0;
        signed = debit;
      } else if (amounts[1] !== 0 && amounts[0] === 0) {
        credit = Math.abs(amounts[1]);
        debit = 0;
        signed = -credit;
      } else if (amounts[0] !== 0 && amounts[1] !== 0) {
        // İkisi de dolu: borç/alacak modeli
        debit = Math.abs(amounts[0]);
        credit = Math.abs(amounts[1]);
        signed = debit > 0 ? debit : credit > 0 ? -credit : 0;
      }
      balance = amounts[2];
      if (!signed) {
        signed = debit > 0 ? debit : credit > 0 ? -credit : 0;
      }
    } else if (amounts.length === 2) {
      if (amounts[0] > 0 && amounts[1] === 0) {
        debit = amounts[0];
        signed = debit;
      } else if (amounts[1] > 0 && amounts[0] === 0) {
        credit = amounts[1];
        signed = -credit;
      } else if (amounts[0] < 0 && amounts[1] !== 0) {
        signed = amounts[0];
        credit = Math.abs(amounts[0]);
        balance = amounts[1];
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
    const description = String(descriptionText || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!description || description.length < 2) {
      warnings.push({ row: i + 1, code: "desc_skip" });
      continue;
    }

    out.push(
      createCanonicalBankTransaction({
        companyId: context.companyId,
        bank,
        accountIdentity: context.accountIdentity || "",
        transactionDate: transactionDate.replace(/-/g, ".").replace(/\//g, "."),
        description,
        amount: signed,
        debit_amount: debit,
        credit_amount: credit,
        direction,
        balance: Number.isFinite(balance) ? balance : null,
        currency: context.currency || "TRY",
        sourceRow: i + 1,
        sourcePage: currentPage,
        sourceFileHash: context.sourceFileHash,
        sourceType,
        parseWarnings: [],
        reviewRequired: Boolean(context.forceReview),
      })
    );
  }

  return { transactions: out, warnings, bank };
}

export function extractBalanceHintsFromText(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  let currentPage = 1;
  let pageLine = 0;
  let openingBalance = null;
  let closingBalance = null;
  let openingEvidence = null;
  let closingEvidence = null;

  for (const raw of lines) {
    const pageMark = String(raw || "").match(/^---\s*page\s+(\d+)\s*---$/i);
    if (pageMark) {
      currentPage = Number(pageMark[1]) || currentPage;
      pageLine = 0;
      continue;
    }
    pageLine += 1;
    const line = normalizeLine(raw);
    if (!line) continue;
    const open =
      line.match(
        /a[cç][iı]l[iı][sş]\s*bakiyesi\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2}))/i
      ) ||
      line.match(
        /opening\s*balance\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2}))/i
      );
    const close =
      line.match(
        /kapan[iı][sş]\s*bakiyesi\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2}))/i
      ) ||
      line.match(
        /closing\s*balance\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2}))/i
      ) ||
      line.match(
        /son\s*bakiye\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2}))/i
      );
    if (open) {
      const value = parseTrAmount(open[1]);
      if (Number.isFinite(value)) {
        openingBalance = value;
        openingEvidence = {
          source: "explicit_label",
          sourcePage: currentPage,
          sourceLine: pageLine,
          confidence: 0.98,
        };
      }
    }
    if (close) {
      const value = parseTrAmount(close[1]);
      if (Number.isFinite(value)) {
        closingBalance = value;
        closingEvidence = {
          source: "explicit_label",
          sourcePage: currentPage,
          sourceLine: pageLine,
          confidence: 0.98,
        };
      }
    }
  }

  return {
    openingBalance,
    closingBalance,
    openingEvidence,
    closingEvidence,
    source:
      openingBalance != null || closingBalance != null ? "explicit_label" : null,
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
  let extractDiag = buildExtractDiagnostics();
  try {
    const raced = await Promise.race([
      (async () => {
        let pdfjsText = "";
        let pdfjsOk = false;
        let pdfjsErrorCode = "";
        try {
          pdfjsText = await extractPdfTextLayerPdfJs(buf, {
            signal,
            maxPages: PDF_MAX_PAGES,
          });
          pdfjsOk = Boolean(pdfjsText && pdfjsText.length > 0);
          if (!pdfjsOk) pdfjsErrorCode = "PDFJS_EMPTY";
        } catch (e) {
          pdfjsText = "";
          pdfjsOk = false;
          pdfjsErrorCode = String(e?.code || e?.name || "PDFJS_THROW").slice(0, 64);
        }
        const latinText = extractPdfTextLayer(buf, { signal });
        const candidates = [];
        if (pdfjsText) candidates.push({ name: "pdfjs", text: pdfjsText });
        if (latinText) candidates.push({ name: "latin1", text: latinText });
        const selection = selectBestExtractCandidate(candidates);
        const candidateScores = (selection.ranked || []).map((c) => ({
          name: c.name,
          score: c.score,
          parsedTx: c.probe?.parsedTx || 0,
          structuredTxLines: c.probe?.structuredTxLines || 0,
          textLen: c.probe?.textLen || 0,
          longMergedRatio: Number(c.probe?.longMergedRatio || 0),
        }));

        if (selection.decision === "OCR_REQUIRED" || !selection.winner) {
          return {
            text: "",
            forceOcr: true,
            diag: buildExtractDiagnostics({
              extractPath: "none",
              pdfjsOk,
              pdfjsErrorCode: pdfjsErrorCode || "EXTRACT_UNUSABLE",
              textLen: 0,
              dateCount: 0,
              letterCount: 0,
              selectionReason: selection.reason || "all_candidates_unusable",
              candidateScores,
            }),
          };
        }

        const chosen = selection.winner.text || "";
        const winnerName = selection.winner.name;
        let extractPath = winnerName;
        if (winnerName === "pdfjs" && !pdfjsOk) extractPath = "pdfjs-weak";
        if (winnerName === "latin1" && countStatementDates(latinText) < 1) {
          extractPath = pdfjsOk ? "pdfjs-weak" : "none";
        }
        return {
          text: chosen,
          diag: buildExtractDiagnostics({
            extractPath,
            pdfjsOk,
            pdfjsErrorCode,
            textLen: String(chosen || "").length,
            dateCount: countStatementDates(chosen),
            letterCount: (String(chosen || "").match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || [])
              .length,
            selectionReason: selection.reason,
            candidateScores,
          }),
        };
      })(),
      new Promise((_, reject) => {
        const err = new Error(SAFE.TIMEOUT);
        err.code = "PDF_TIMEOUT";
        setTimeout(() => reject(err), timeoutMs);
      }),
    ]);
    text = raced?.text || "";
    extractDiag = raced?.diag || extractDiag;
    if (raced?.forceOcr) {
      // Metin adayı vardı ama yapısal/parse açısından kullanılamadı → layoutFallback OCR.
      const hadTextLayer = (extractDiag?.candidateScores || []).some(
        (c) => (Number(c?.textLen) || 0) > 0
      );
      return {
        ok: false,
        status: BANK_PARSE_STATUS.OCR_REQUIRED,
        code: "OCR_REQUIRED",
        message: SAFE.OCR_REQUIRED,
        transactions: [],
        sourceFileHash,
        pageCount: pages,
        ocrRequired: true,
        layoutFallback: hadTextLayer || undefined,
        priorCode: hadTextLayer ? "PDF_UNSUPPORTED_LAYOUT" : undefined,
        extractDiagnostics: extractDiag,
      };
    }
  } catch (error) {
    if (error?.code === "PDF_CANCELLED" || signal?.aborted) {
      return {
        ok: false,
        status: BANK_PARSE_STATUS.ERROR,
        code: "PDF_CANCELLED",
        message: SAFE.CANCELLED,
        transactions: [],
        sourceFileHash,
        extractDiagnostics: extractDiag,
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
        extractDiagnostics: extractDiag,
      };
    }
    return {
      ok: false,
      status: BANK_PARSE_STATUS.ERROR,
      code: "PDF_CORRUPT",
      message: SAFE.CORRUPT,
      transactions: [],
      sourceFileHash,
      extractDiagnostics: extractDiag,
    };
  }

  const letters = (text.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length;
  const dateCount = countStatementDates(text);
  // Tarih yoksa Latin1 çöpü “metin katmanı var” sayılmaz → OCR’a düş.
  if (!text || letters < 40 || dateCount < 1) {
    // OCR sunucu round-trip / runBankStatementOcr ile yapılır; client bundle’a Vision/canvas çekilmez.
    return {
      ok: false,
      status: BANK_PARSE_STATUS.OCR_REQUIRED,
      code: "OCR_REQUIRED",
      message: SAFE.OCR_REQUIRED,
      transactions: [],
      sourceFileHash,
      pageCount: pages,
      ocrRequired: true,
      extractDiagnostics: extractDiag,
    };
  }

  let workingText = text;
  let parsed = parsePdfMovementLines(workingText, {
    ...options,
    sourceFileHash,
    selectedBank: options.selectedBank || detectBankFromPdfText(workingText),
  });

  // pdf.js satırları çoğu zaman tarih/açıklama/tutarı ayrı satırda bırakır —
  // OCR normalizer’ı aynı birleştirme kurallarını uygular (sahte hareket yok).
  if (!(parsed.transactions || []).length) {
    const normalized = normalizeOcrStatementText(workingText);
    const retry = parsePdfMovementLines(normalized, {
      ...options,
      sourceFileHash,
      selectedBank: options.selectedBank || detectBankFromPdfText(normalized),
    });
    if ((retry.transactions || []).length > 0) {
      parsed = retry;
      workingText = normalized;
    }
  }

  const hints = extractBalanceHintsFromText(workingText);
  const balance = reconcileStatementBalances(parsed.transactions, hints);

  if (!parsed.transactions.length) {
    // Metin katmanı var ama hareket çıkarılamadı → OCR fallback zorunlu.
    // PDF_UNSUPPORTED_LAYOUT kullanıcıya OCR denenmeden dönmez.
    return {
      ok: false,
      status: BANK_PARSE_STATUS.OCR_REQUIRED,
      code: "OCR_REQUIRED",
      message: SAFE.OCR_REQUIRED,
      transactions: [],
      sourceFileHash,
      pageCount: pages,
      ocrRequired: true,
      layoutFallback: true,
      priorCode: "PDF_UNSUPPORTED_LAYOUT",
      sheetRows: pdfTextToSheetRows(workingText),
      detectedBank: parsed.bank || detectBankFromPdfText(workingText) || undefined,
      extractDiagnostics: extractDiag,
      txCount: 0,
    };
  }

  text = workingText;

  const status = balance.reviewRequired
    ? BANK_PARSE_STATUS.REVIEW_REQUIRED
    : parsed.warnings.length
      ? BANK_PARSE_STATUS.WARNING
      : BANK_PARSE_STATUS.OK;

  let code = "OK";
  if (
    balance.reviewRequired ||
    balance.code === BALANCE_MISMATCH ||
    balance.code === MISSING_CLOSING_BALANCE ||
    balance.code === MISSING_OPENING_BALANCE
  ) {
    code = balance.code;
  } else if (balance.code === BALANCE_EVIDENCE_MISSING) {
    code = balance.code;
  }

  return {
    ok: !balance.reviewRequired,
    status,
    code,
    message: balance.reviewRequired
      ? balance.message
      : balance.code === BALANCE_EVIDENCE_MISSING
        ? balance.message || ""
        : "",
    transactions: parsed.transactions,
    warnings: parsed.warnings,
    sourceFileHash,
    pageCount: pages,
    detectedBank: parsed.bank,
    balance,
    elapsedMs: Date.now() - started,
    sourceType: BANK_STATEMENT_SOURCE.PDF,
    sheetRows: pdfTextToSheetRows(text),
    extractDiagnostics: extractDiag,
    txCount: parsed.transactions.length,
    ocrUsed: false,
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

/** Metin parse başarısız / taranmış PDF → OCR fallback tetiklenmeli. */
export function shouldTriggerPdfOcrFallback(result = {}) {
  if (!result || typeof result !== "object") return false;
  if (result.ocrRequired || result.code === "OCR_REQUIRED") return true;
  if (result.code === "PDF_UNSUPPORTED_LAYOUT") return true;
  if (result.layoutFallback && !(result.transactions || []).length) return true;
  return false;
}
