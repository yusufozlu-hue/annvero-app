/**
 * Yüklenen belge içeriği ile firma eşleşmesi (salt okunur, loglamaz).
 * Sahte OCR başarısı üretmez — görseller için "pending" döner.
 */

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(value = "") {
  return String(value || "").replace(/\D+/g, "");
}

function extractCompanyHints(company = {}) {
  const data = company?.data && typeof company.data === "object" ? company.data : {};
  const name = normalizeText(
    company?.company_name || data.companyName || data.unvan || data.title || ""
  );
  const vkn = digitsOnly(data.vkn || data.taxNumber || data.vergiNo || "");
  const tckn = digitsOnly(data.tckn || data.identityNumber || "");
  const mersis = digitsOnly(data.mersis || data.mersisNo || "");
  return { name, vkn, tckn, mersis };
}

function extractXmlText(buffer) {
  try {
    const text = Buffer.from(buffer).toString("utf8");
    if (!text.includes("<") || text.length > 2_000_000) return "";
    return text.slice(0, 200_000);
  } catch {
    return "";
  }
}

function extractPdfLatinText(buffer) {
  try {
    const raw = Buffer.from(buffer).toString("latin1");
    // Basit PDF stream metin çıkarımı — tam PDF parser değildir.
    const chunks = [];
    const re = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    let match;
    let count = 0;
    while ((match = re.exec(raw)) && count < 4000) {
      const piece = match[1]
        .replace(/\\n/g, " ")
        .replace(/\\r/g, " ")
        .replace(/\\t/g, " ")
        .replace(/\\(.)/g, "$1");
      if (piece.trim()) chunks.push(piece);
      count += 1;
    }
    return chunks.join(" ").slice(0, 200_000);
  } catch {
    return "";
  }
}

/**
 * @returns {{
 *   status: "match" | "mismatch" | "pending" | "unknown",
 *   confidence: number,
 *   reasons: string[],
 *   quarantine: boolean,
 * }}
 */
export function validateDocumentCompanyMatch({
  fileName = "",
  mimeType = "",
  buffer,
  company = null,
} = {}) {
  const hints = extractCompanyHints(company || {});
  const reasons = [];
  const mime = String(mimeType || "").toLowerCase();
  const nameNorm = normalizeText(fileName).toLocaleLowerCase("tr-TR");

  if (mime.startsWith("image/") || /\.(png|jpe?g)$/i.test(fileName)) {
    return {
      status: "pending",
      confidence: 0,
      reasons: ["image_ocr_unavailable"],
      quarantine: false,
    };
  }

  let content = "";
  if (mime.includes("xml") || /\.xml$/i.test(fileName)) {
    content = extractXmlText(buffer);
  } else if (mime.includes("pdf") || /\.pdf$/i.test(fileName)) {
    content = extractPdfLatinText(buffer);
  }

  const contentDigits = digitsOnly(content);
  const contentNorm = normalizeText(content).toLocaleLowerCase("tr-TR");

  // Kesin VKN uyuşmazlığı: içerikte başka 10 haneli vergi no var, firma VKN yok.
  if (hints.vkn && hints.vkn.length >= 10 && contentDigits) {
    const hasOwnVkn = contentDigits.includes(hints.vkn);
    const foreignVknMatches = contentDigits.match(/\d{10,11}/g) || [];
    const foreign = foreignVknMatches.filter(
      (n) => n !== hints.vkn && n !== hints.tckn
    );
    if (!hasOwnVkn && foreign.length > 0) {
      reasons.push("vkn_mismatch");
      return {
        status: "mismatch",
        confidence: 0.9,
        reasons,
        quarantine: true,
      };
    }
    if (hasOwnVkn) {
      reasons.push("vkn_match");
    }
  }

  if (hints.tckn && hints.tckn.length === 11 && contentDigits.includes(hints.tckn)) {
    reasons.push("tckn_match");
  }

  if (hints.mersis && hints.mersis.length >= 10 && contentDigits.includes(hints.mersis)) {
    reasons.push("mersis_match");
  }

  if (hints.name && hints.name.length >= 6) {
    const token = hints.name.toLocaleLowerCase("tr-TR").slice(0, 24);
    if (contentNorm.includes(token) || nameNorm.includes(token.slice(0, 12))) {
      reasons.push("name_match");
    }
  }

  if (reasons.some((r) => r.endsWith("_match"))) {
    return {
      status: "match",
      confidence: reasons.includes("vkn_match") ? 0.95 : 0.7,
      reasons,
      quarantine: false,
    };
  }

  if (!content) {
    return {
      status: "unknown",
      confidence: 0.2,
      reasons: ["content_unreadable"],
      quarantine: false,
    };
  }

  return {
    status: "unknown",
    confidence: 0.3,
    reasons: reasons.length ? reasons : ["no_strong_match"],
    quarantine: false,
  };
}
