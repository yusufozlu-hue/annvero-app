/**
 * OCR banka ekstresi metin normalizasyonu.
 * Vision satır/kırık alanlarını tek satırlık hareket formatına birleştirir.
 * Ham metin / IBAN / VKN loglanmaz.
 */

const DATE_ONLY_RE = /^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$/;
const DATE_PREFIX_RE = /^(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b(.*)$/;
const DATE_TOKEN_RE = /\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}/g;
const AMOUNT_RE = /-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:,\d{2})/g;
const PAGE_MARK_RE = /^---\s*page\s+\d+\s*---$/i;
const HEADER_FOOTER_RE =
  /^(sayfa\s*\d+|page\s*\d+|devam\s* ediyor|continued|www\.|telefon|m[uü][sş]teri\s*hizmet|copyright|tarih\s+a[cç][iı]klama|bor[cç]\s+alacak\s+bakiye|i[sş]lem\s*tarihi|hesap\s*no|para\s*birimi)/i;
const SUBTOTAL_RE =
  /(ara\s*toplam|g[uü]nl[uü]k\s*toplam|toplam\s*bor[cç]|toplam\s*alacak|a[cç][iı]l[iı][sş]\s*bakiyesi|kapan[iı][sş]\s*bakiyesi|devreden\s*bakiye|previous\s*balance|opening\s*balance|closing\s*balance)/i;
const EMPTY_AMOUNT_RE = /^(?:[-–—]|)$/;

function normalizeSpaces(line = "") {
  return String(line || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Tarih/tutar OCR gürültüsü: aralıklı ayırıcılar, O/0 karışması (yalnız rakam bağlamı).
 */
export function preprocessOcrNoise(text = "") {
  let t = String(text || "");
  // Önce tarih adaylarındaki O/o/l/I → 0 (boşluklu veya bitişik)
  t = t.replace(
    /\b([0-3OolI]{1,2})\s*[./\-]\s*([0-1OolI]{1,2})\s*[./\-]\s*([12OolI][0-9OolI]{1,3})\b/g,
    (_, d, m, y) => {
      const fix = (s) => String(s).replace(/[OolI]/g, "0");
      return `${fix(d)}.${fix(m)}.${fix(y)}`;
    }
  );
  // Aralıklı tarih: 02 . 01 . 2026
  t = t.replace(
    /(\d{1,2})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{2,4})/g,
    "$1.$2.$3"
  );
  // Kırık ondalık satır sonları
  t = t.replace(/(\d),[\r\n]+(\d{2})\b/g, "$1,$2");
  t = t.replace(/(\d)\.[\r\n]+(\d{3},\d{2})\b/g, "$1.$2");
  // Binlik boşluğu: "1 500,00" → "1.500,00" — ama ",00 250,00" birleştirilmez
  t = t.replace(/(^|[^\d,])(\d{1,3})\s+(\d{3},\d{2})\b/g, "$1$2.$3");
  t = t.replace(/(\d)\s*,\s*(\d{2})\b/g, "$1,$2");
  // Satır ortasında yeni tarih → satır kır
  t = t.replace(
    /([^\n\d./\-])\s+(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b/g,
    "$1\n$2"
  );
  return t;
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
  if (EMPTY_AMOUNT_RE.test(t)) return ["0,00"];
  return [...t.matchAll(AMOUNT_RE)].map((m) => m[0]);
}

function isAmountHeavyLine(line = "") {
  const t = normalizeSpaces(line);
  if (!t) return false;
  if (EMPTY_AMOUNT_RE.test(t)) return true;
  const amounts = extractAmounts(t);
  if (!amounts.length) return false;
  let stripped = t;
  for (const a of amounts) stripped = stripped.replace(a, " ");
  stripped = stripped.replace(/[.\-_/|–—]+/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length <= 4 || amounts.length >= 2;
}

function formatDate(d, m, y) {
  const yy = String(y).length === 2 ? `20${y}` : String(y);
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${yy}`;
}

function flushMovement(buf, out) {
  if (!buf?.date) return;
  const desc = normalizeSpaces(buf.description || "")
    .replace(/[.\s]+$/g, "")
    .trim();
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
  const raw = preprocessOcrNoise(String(text || "")).replace(
    /(\d{1,2})[./\-](\d{1,2})[./\-]?[\r\n]+(\d{2,4})\b/g,
    "$1.$2.$3"
  );

  const lines = raw.split(/\r?\n/).map(normalizeSpaces);
  const out = [];
  let buf = null;

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
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
      // Üstbilgi/altbilgi/ara toplam parser’a gitsin (hareket sayılmaz) ama
      // bakiye ipucu için açılış/kapanış satırlarını koru.
      out.push(line);
      continue;
    }

    // Tek satırda birden fazla tarih token’ı varsa böl
    const dateHits = [...line.matchAll(DATE_TOKEN_RE)];
    if (dateHits.length > 1) {
      const parts = [];
      let last = 0;
      for (let h = 0; h < dateHits.length; h += 1) {
        const hit = dateHits[h];
        if (h === 0) continue;
        parts.push(line.slice(last, hit.index).trim());
        last = hit.index;
      }
      parts.push(line.slice(last).trim());
      lines.splice(i, 1, ...parts.filter(Boolean));
      i -= 1;
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
      desc = normalizeSpaces(desc.replace(/[-–—]/g, " "));
      buf = {
        date: datePrefix[1].replace(/[-/]/g, "."),
        description: desc,
        amounts,
      };
      if (buf.amounts.length >= 1 && buf.description) {
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
