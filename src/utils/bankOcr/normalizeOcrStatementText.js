/**
 * OCR banka ekstresi metin normalizasyonu.
 * Vision satır/kırık alanlarını tek satırlık hareket formatına birleştirir.
 * Ham metin / IBAN / VKN loglanmaz.
 */

const DATE_ONLY_RE = /^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$/;
const DATE_PREFIX_RE = /^(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b(.*)$/;
const AMOUNT_RE = /-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2})/g;
const PAGE_MARK_RE = /^---\s*page\s+\d+\s*---$/i;
const HEADER_FOOTER_RE =
  /^(sayfa\s*\d+|page\s*\d+|devam\s* ediyor|continued|www\.|telefon|m[uü][sş]teri\s*hizmet|copyright|tarih\s+a[cç][iı]klama|bor[cç]\s+alacak\s+bakiye)/i;
const SUBTOTAL_RE =
  /(ara\s*toplam|g[uü]nl[uü]k\s*toplam|toplam\s*bor[cç]|toplam\s*alacak|a[cç][iı]l[iı][sş]\s*bakiyesi|kapan[iı][sş]\s*bakiyesi|devreden\s*bakiye|previous\s*balance|opening\s*balance|closing\s*balance)/i;

function normalizeSpaces(line = "") {
  return String(line || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isNoiseLine(line = "") {
  const t = normalizeSpaces(line);
  if (!t) return true;
  if (PAGE_MARK_RE.test(t)) return false;
  if (HEADER_FOOTER_RE.test(t)) return true;
  if (SUBTOTAL_RE.test(t)) return true;
  return false;
}

function extractAmounts(line = "") {
  const t = normalizeSpaces(line);
  return [...t.matchAll(AMOUNT_RE)].map((m) => m[0]);
}

function isAmountHeavyLine(line = "") {
  const t = normalizeSpaces(line);
  if (!t) return false;
  const amounts = extractAmounts(t);
  if (!amounts.length) return false;
  let stripped = t;
  for (const a of amounts) stripped = stripped.replace(a, " ");
  stripped = stripped.replace(/[.\-_/|]+/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length <= 4 || amounts.length >= 2;
}

function formatDate(d, m, y) {
  const yy = String(y).length === 2 ? `20${y}` : String(y);
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${yy}`;
}

function flushMovement(buf, out) {
  if (!buf?.date) return;
  const desc = normalizeSpaces(buf.description || "");
  const amounts = (buf.amounts || []).slice(0, 3);
  if (!desc || amounts.length < 1) {
    if (desc || amounts.length) {
      out.push(
        normalizeSpaces([buf.date, desc, ...amounts].filter(Boolean).join(" "))
      );
    }
    return;
  }
  out.push(normalizeSpaces([buf.date, desc, ...amounts].join(" ")));
}

/**
 * OCR metnini parser’ın beklediği tek satırlık hareket biçimine dönüştür.
 * @param {string} text
 * @returns {string}
 */
export function normalizeOcrStatementText(text = "") {
  const raw = String(text || "")
    .replace(/(\d),[\r\n]+(\d{2})\b/g, "$1,$2")
    .replace(/(\d)\.[\r\n]+(\d{3},\d{2})\b/g, "$1.$2")
    .replace(
      /(\d{1,2})[./\-](\d{1,2})[./\-]?[\r\n]+(\d{2,4})\b/g,
      "$1.$2.$3"
    );

  const lines = raw.split(/\r?\n/).map(normalizeSpaces);
  const out = [];
  let buf = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    if (PAGE_MARK_RE.test(line)) {
      flushMovement(buf, out);
      buf = null;
      out.push(line);
      continue;
    }

    if (isNoiseLine(line)) {
      flushMovement(buf, out);
      buf = null;
      out.push(line);
      continue;
    }

    const dateOnly = line.match(DATE_ONLY_RE);
    if (dateOnly) {
      flushMovement(buf, out);
      buf = {
        date: formatDate(dateOnly[1], dateOnly[2], dateOnly[3]),
        description: "",
        amounts: [],
      };
      continue;
    }

    const datePrefix = line.match(DATE_PREFIX_RE);
    if (datePrefix) {
      flushMovement(buf, out);
      const rest = normalizeSpaces(datePrefix[2] || "");
      const amounts = extractAmounts(rest);
      let desc = rest;
      for (const a of amounts) desc = desc.replace(a, " ");
      desc = normalizeSpaces(desc);
      buf = {
        date: datePrefix[1].replace(/[-/]/g, "."),
        description: desc,
        amounts,
      };
      if (amounts.length >= 1 && desc) {
        flushMovement(buf, out);
        buf = null;
      }
      continue;
    }

    if (buf) {
      if (isAmountHeavyLine(line)) {
        buf.amounts.push(...extractAmounts(line));
        if (buf.amounts.length >= 3 && buf.description) {
          flushMovement(buf, out);
          buf = null;
        }
        continue;
      }
      // Tutarlar geldikten sonra gelen metin yeni blok sayılır
      if (buf.amounts.length >= 1) {
        flushMovement(buf, out);
        buf = null;
        out.push(line);
        continue;
      }
      buf.description = normalizeSpaces(`${buf.description} ${line}`);
      continue;
    }

    out.push(line);
  }

  flushMovement(buf, out);
  return out.join("\n");
}

/**
 * OCR sayfa dizisini normalize et (sayfa gövdeleri).
 */
export function normalizeOcrPages(pages = []) {
  return (pages || []).map((p) => ({
    ...p,
    text: normalizeOcrStatementText(String(p.text || "")),
  }));
}
