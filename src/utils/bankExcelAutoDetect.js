/**
 * Excel banka auto-detect — puanlamalı, belirsizlikte UNKNOWN/AMBIGUOUS.
 * Dosya adı yalnız düşük ağırlıklı yardımcı sinyaldir; içerik önceliklidir.
 */

import {
  canonicalizeBankId,
  toParserBankId,
} from "@/src/utils/bankIdentity";

export const BANK_EXCEL_DETECTOR_VERSION = "excel-auto-detect/1.0.2";

/** formatGuard ile aynı — döngüsel import yok; İ→i̇ birleşik işaretini temizler */
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

const SELECT_MIN_SCORE = 45;
const AMBIGUITY_GAP = 12;
const AMBIGUITY_FLOOR = 35;

const WEIGHTS = Object.freeze({
  brand: 42,
  iban: 36,
  bic: 30,
  distinctiveHeader: 26,
  formatFingerprint: 22,
  sheetName: 14,
  filename: 8,
});

function rowText(row) {
  if (!Array.isArray(row)) return "";
  return row
    .map((cell) => normalizeStatementHeaderText(cell))
    .filter(Boolean)
    .join(" ");
}

/** Kolon başlığı: tarih + (tutar|borc/alacak|bakiye) + aciklama */
function isColumnHeaderRow(text) {
  if (!text) return false;
  const hasTarih = text.includes("tarih");
  const hasAciklama = text.includes("aciklama");
  const hasAmount =
    text.includes("tutar") ||
    text.includes("bakiye") ||
    (text.includes("borc") && text.includes("alacak")) ||
    text.includes("b/a");
  return hasTarih && hasAciklama && hasAmount;
}

/**
 * Brand/IBAN/BIC yalnız meta + kolon başlığından okunur.
 * Hareket açıklamalarındaki karşı-banka adları (örn. "vakifbank kredi karti")
 * statement bankasını seçtirmemeli.
 */
function joinCorpus(sheetRows = [], scanLimit = 40) {
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) {
    return {
      fullText: "",
      identityText: "",
      headerTexts: [],
      rowTexts: [],
      headerRowIndex: -1,
    };
  }
  const limit = Math.min(sheetRows.length, Math.max(1, scanLimit));
  const rowTexts = [];
  let headerRowIndex = -1;
  for (let i = 0; i < limit; i += 1) {
    const text = rowText(sheetRows[i]);
    if (!text) continue;
    rowTexts.push(text);
    if (headerRowIndex < 0 && isColumnHeaderRow(text)) headerRowIndex = i;
  }
  const identityEnd =
    headerRowIndex >= 0
      ? Math.min(headerRowIndex, rowTexts.length - 1)
      : Math.min(6, Math.max(0, rowTexts.length - 1));
  // identity: meta satırlar + kolon başlığı (veri satırları hariç)
  const identityRows = [];
  let seen = 0;
  for (let i = 0; i < limit; i += 1) {
    const text = rowText(sheetRows[i]);
    if (!text) continue;
    if (headerRowIndex < 0) {
      if (seen <= identityEnd) identityRows.push(text);
    } else if (i <= headerRowIndex) {
      identityRows.push(text);
    }
    seen += 1;
  }
  return {
    fullText: rowTexts.join(" | "),
    identityText: identityRows.join(" | "),
    headerTexts: rowTexts,
    rowTexts,
    headerRowIndex,
  };
}

function pushSignal(bag, code, weight, detail = "") {
  bag.push({ code, weight, detail: detail || code });
}

function scoreVakifbank(corpus) {
  const signals = [];
  const t = corpus.fullText;
  const id = corpus.identityText || "";
  if (!t) return { canonical: "VAKIFBANK", score: 0, signals };

  // Brand yalnız identity (meta+header) — hareket açıklamasındaki karşı banka sayılmaz
  if (/vakif\s*bank|vakifbank|vakiflar\s+bank/.test(id)) {
    pushSignal(signals, "brand_vakifbank", WEIGHTS.brand);
  }
  if (/tr\d{2}00015/.test(id.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00015", WEIGHTS.iban);
  }
  if (/tvbatr2a|tvba\s*tr/.test(id)) {
    pushSignal(signals, "bic_tvba", WEIGHTS.bic);
  }

  // Native fingerprint: B/A veya fiş no zorunlu — "hesap hareketleri"+tutar yetmez
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

  if (strongNative) {
    pushSignal(signals, "header_vakif_native", WEIGHTS.formatFingerprint + 8);
  } else if (
    t.includes("hareket tarih") ||
    (t.includes("islem tarihi") && t.includes("b/a"))
  ) {
    pushSignal(signals, "header_vakif_partial", WEIGHTS.distinctiveHeader);
  }

  return {
    canonical: "VAKIFBANK",
    score: signals.reduce((s, x) => s + x.weight, 0),
    signals,
  };
}

function scoreGaranti(corpus) {
  const signals = [];
  const t = corpus.fullText;
  const id = corpus.identityText || "";
  if (!t) return { canonical: "GARANTI", score: 0, signals };

  if (/garanti|bbva/.test(id)) {
    pushSignal(signals, "brand_garanti", WEIGHTS.brand);
  }
  if (/tr\d{2}00062/.test(id.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00062", WEIGHTS.iban);
  }
  if (/tgbatris|tgba\s*tr/.test(id)) {
    pushSignal(signals, "bic_tgba", WEIGHTS.bic);
  }

  const hasTarih = t.includes("tarih");
  const hasAciklama = t.includes("aciklama") || t.includes("islem aciklamasi");
  const hasAmount =
    t.includes("tutar") ||
    t.includes("bakiye") ||
    t.includes("borc") ||
    t.includes("alacak");
  const hasEtiket = t.includes("etiket");
  const hasDekont = t.includes("dekont");
  const hasBorcAlacakPair = t.includes("borc") && t.includes("alacak");
  // Vakıf native ile karışmasın; borc+alacak+dekont Ziraat/TEB’e daha yakın
  const looksVakif =
    t.includes("b/a") || (t.includes("hesap no") && t.includes("fis no"));

  if (
    hasTarih &&
    hasAciklama &&
    hasAmount &&
    !looksVakif &&
    (hasEtiket || (hasDekont && !hasBorcAlacakPair))
  ) {
    pushSignal(signals, "header_garanti_export", WEIGHTS.formatFingerprint + 6);
  } else if (hasEtiket && hasTarih && hasAciklama) {
    pushSignal(signals, "header_garanti_partial", WEIGHTS.distinctiveHeader);
  }

  return {
    canonical: "GARANTI",
    score: signals.reduce((s, x) => s + x.weight, 0),
    signals,
  };
}

function scoreTeb(corpus) {
  const signals = [];
  const t = corpus.fullText;
  const id = corpus.identityText || "";
  if (!t) return { canonical: "TEB", score: 0, signals };

  if (/\bteb\b|turkiye ekonomi bank|turkiye ekonomi|ekonomi bankasi/.test(id)) {
    pushSignal(signals, "brand_teb", WEIGHTS.brand);
  }
  if (/tr\d{2}00032/.test(id.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00032", WEIGHTS.iban);
  }
  if (/tebutris|tebu\s*tr/.test(id)) {
    pushSignal(signals, "bic_tebu", WEIGHTS.bic);
  }

  const hasTarih = t.includes("tarih");
  const hasAciklama = t.includes("aciklama");
  const hasBorcAlacak = t.includes("borc") && t.includes("alacak");
  const hasIslemNo = t.includes("islem no") || t.includes("islem numarasi");
  const hasBakiye = t.includes("bakiye");

  if (hasTarih && hasAciklama && hasBorcAlacak && hasIslemNo) {
    pushSignal(signals, "header_teb_islem_no", WEIGHTS.distinctiveHeader + 4);
  } else if (hasTarih && hasAciklama && hasBorcAlacak && hasBakiye) {
    // Generic — düşük; yalnız brand/iban ile birleşince yeter
    pushSignal(signals, "header_teb_borc_alacak", 10);
  }

  return {
    canonical: "TEB",
    score: signals.reduce((s, x) => s + x.weight, 0),
    signals,
  };
}

function scoreZiraat(corpus) {
  const signals = [];
  const t = corpus.fullText;
  const id = corpus.identityText || "";
  if (!t) return { canonical: "ZIRAAT", score: 0, signals };

  if (/t\.?\s*c\.?\s*ziraat|ziraat bank|ziraat/.test(id)) {
    pushSignal(signals, "brand_ziraat", WEIGHTS.brand);
  }
  if (/tr\d{2}00010/.test(id.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00010", WEIGHTS.iban);
  }
  if (/tczbtr|tczb\s*tr/.test(id)) {
    pushSignal(signals, "bic_tczb", WEIGHTS.bic);
  }

  const hasTarih = t.includes("tarih");
  const hasAciklama = t.includes("aciklama");
  const hasBorcAlacak = t.includes("borc") && t.includes("alacak");
  const hasDekont = t.includes("dekont");
  const hasIslem = t.includes("islem no") || t.includes("islem kodu");

  if (hasTarih && hasAciklama && hasBorcAlacak && (hasDekont || hasIslem)) {
    pushSignal(signals, "header_ziraat_dekont", WEIGHTS.distinctiveHeader);
  } else if (hasTarih && hasAciklama && hasBorcAlacak) {
    pushSignal(signals, "header_ziraat_borc_alacak", 10);
  }

  return {
    canonical: "ZIRAAT",
    score: signals.reduce((s, x) => s + x.weight, 0),
    signals,
  };
}

function scoreKuveytTurk(corpus) {
  const signals = [];
  const t = corpus.fullText;
  const id = corpus.identityText || "";
  if (!t) return { canonical: "KUVEYTTURK", score: 0, signals };

  // Brand/IBAN/BIC yalnız identity — hareket açıklamasındaki "Kuveyt Türk" sayılmaz
  if (/kuveyt\s*turk|kuveytturk|kuveyt/.test(id)) {
    pushSignal(signals, "brand_kuveytturk", WEIGHTS.brand);
  }
  if (/katilim/.test(id) && /kuveyt/.test(id)) {
    pushSignal(signals, "brand_katilim_kuveyt", 12);
  }
  if (/tr\d{2}00205/.test(id.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00205", WEIGHTS.iban);
  }
  if (/kteftris|ktef\s*tr/.test(id)) {
    pushSignal(signals, "bic_ktef", WEIGHTS.bic);
  }

  const hasTarih = t.includes("tarih");
  const hasAciklama = t.includes("aciklama");
  const hasBorcAlacak = t.includes("borc") && t.includes("alacak");
  const hasTutar = t.includes("tutar");
  const hasBakiye = t.includes("bakiye");
  const hasIslemTarihi = t.includes("islem tarihi");
  const hasReferans =
    t.includes("islem referans") ||
    t.includes("referans numara") ||
    t.includes("referans no");
  const looksVakifNative =
    t.includes("b/a") || (t.includes("hesap no") && t.includes("fis no"));

  // Kolon dizilimi tek başına kimlik değil — sheet/brand/iban/bic corroborator gerekir
  // (32 + sheet 14 = 46 ≥ SELECT_MIN; 32 + filename 8 = 40 < SELECT_MIN)
  if (
    !looksVakifNative &&
    !hasBorcAlacak &&
    hasIslemTarihi &&
    hasAciklama &&
    hasTutar &&
    hasBakiye &&
    hasReferans
  ) {
    pushSignal(signals, "header_kuveyt_columns", 32);
  } else if (hasTarih && hasAciklama && hasBorcAlacak) {
    pushSignal(signals, "header_kuveyt_borc_alacak", 10);
  }

  return {
    canonical: "KUVEYTTURK",
    score: signals.reduce((s, x) => s + x.weight, 0),
    signals,
  };
}

function applyFilenameBoost(candidates, fileName = "") {
  const name = normalizeStatementHeaderText(fileName);
  if (!name) return;
  const boosts = [
    [/vakif|vakıf/, "VAKIFBANK"],
    [/garanti|bbva/, "GARANTI"],
    [/\bteb\b/, "TEB"],
    [/ziraat/, "ZIRAAT"],
    [/kuveyt/, "KUVEYTTURK"],
  ];
  for (const [re, canonical] of boosts) {
    if (!re.test(name)) continue;
    const hit = candidates.find((c) => c.canonical === canonical);
    if (!hit) continue;
    hit.score += WEIGHTS.filename;
    hit.signals.push({
      code: "filename_hint",
      weight: WEIGHTS.filename,
      detail: "filename",
    });
  }
}

function applySheetNameBoost(candidates, sheetName = "") {
  const name = normalizeStatementHeaderText(sheetName);
  if (!name) return;
  // "hesap hareket" genel — Vakıf'a bağlama (Kuveyt/Garanti sheet'lerinde de geçer)
  const boosts = [
    [/vakif/, "VAKIFBANK"],
    [/garanti/, "GARANTI"],
    [/\bteb\b/, "TEB"],
    [/ziraat/, "ZIRAAT"],
    [/kuveyt/, "KUVEYTTURK"],
  ];
  for (const [re, canonical] of boosts) {
    if (!re.test(name)) continue;
    const hit = candidates.find((c) => c.canonical === canonical);
    if (!hit) continue;
    hit.score += WEIGHTS.sheetName;
    hit.signals.push({
      code: "sheet_name",
      weight: WEIGHTS.sheetName,
      detail: "sheet",
    });
  }
}

/**
 * @param {unknown[][]} sheetRows
 * @param {{ scanLimit?: number, fileName?: string, sheetName?: string }} [options]
 */
export function scoreExcelBankCandidates(sheetRows, options = {}) {
  const scanLimit = options.scanLimit ?? 40;
  const corpus = joinCorpus(sheetRows, scanLimit);
  const candidates = [
    scoreVakifbank(corpus),
    scoreGaranti(corpus),
    scoreTeb(corpus),
    scoreZiraat(corpus),
    scoreKuveytTurk(corpus),
  ];
  applySheetNameBoost(candidates, options.sheetName || "");
  applyFilenameBoost(candidates, options.fileName || "");
  return candidates
    .map((c) => ({
      ...c,
      parserBankId: toParserBankId(c.canonical),
    }))
    .sort((a, b) => b.score - a.score);
}

function confidenceFromScore(score) {
  if (score >= 70) return "high";
  if (score >= SELECT_MIN_SCORE) return "medium";
  if (score >= AMBIGUITY_FLOOR) return "low";
  return "unknown";
}

function candidateView(c) {
  if (!c) return null;
  return {
    canonical: c.canonical,
    parserBankId: c.parserBankId,
    score: c.score,
    signals: (c.signals || []).map((s) => s.code),
  };
}

function buildDiagnostics({
  status,
  selectedBank,
  parserBankId,
  canonicalBankId,
  confidence,
  top,
  second,
  rejected,
  ambiguityReason,
}) {
  return {
    selectedBank: selectedBank || null,
    parserBankId: parserBankId || null,
    canonicalBankId: canonicalBankId || null,
    confidence,
    status,
    topCandidate: top ? top.canonical : null,
    topScore: top?.score ?? 0,
    secondCandidate: second ? second.canonical : null,
    secondScore: second?.score ?? 0,
    matchedSignals: top ? top.signals.map((s) => s.code) : [],
    rejectedCandidates: rejected,
    ambiguityReason: ambiguityReason || null,
    detectorVersion: BANK_EXCEL_DETECTOR_VERSION,
    top: candidateView(top),
    second: candidateView(second),
  };
}

/**
 * Güvenli Excel banka çözümü + diagnostics (hassas hücre içeriği yok).
 * Dış sözleşme: selectedBank / bankId / topCandidate = kanonik (KUVEYTTURK…).
 * parserBankId yalnız parser sınırında (KUVEYTTURK → KUVEYT).
 */
export function detectExcelBank(sheetRows, options = {}) {
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) {
    return {
      status: "unknown",
      confidence: "unknown",
      bankId: null,
      parserBankId: null,
      canonicalBankId: null,
      detected: "UNKNOWN",
      diagnostics: buildDiagnostics({
        status: "UNKNOWN",
        selectedBank: null,
        parserBankId: null,
        canonicalBankId: null,
        confidence: "unknown",
        top: null,
        second: null,
        rejected: [],
        ambiguityReason: "empty_workbook",
      }),
    };
  }

  const ranked = scoreExcelBankCandidates(sheetRows, options);
  const top = ranked[0];
  const second = ranked[1];
  const rejected = ranked.slice(1).map((c) => ({
    canonicalBankId: c.canonical,
    parserBankId: c.parserBankId,
    score: c.score,
    signals: c.signals.map((s) => s.code),
  }));

  if (!top || top.score < SELECT_MIN_SCORE) {
    // Yalnız Vakıf native (B/A / fiş no) brand olmadan da yeter — Garanti/Kuveyt kolonları yetmez
    const exclusiveFormat = Boolean(
      top?.signals?.some((s) => s.code === "header_vakif_native")
    );
    const formatOnlyOk =
      exclusiveFormat &&
      top.score >= WEIGHTS.formatFingerprint &&
      !(
        second &&
        second.score >= AMBIGUITY_FLOOR &&
        top.score - second.score < AMBIGUITY_GAP
      );

    if (!formatOnlyOk) {
      return {
        status: "unknown",
        confidence: "unknown",
        bankId: null,
        parserBankId: null,
        canonicalBankId: null,
        detected: "UNKNOWN",
        diagnostics: buildDiagnostics({
          status: "UNKNOWN",
          selectedBank: null,
          parserBankId: null,
          canonicalBankId: null,
          confidence: "unknown",
          top,
          second,
          rejected,
          ambiguityReason:
            top && top.score > 0 ? "below_threshold" : "no_strong_signal",
        }),
      };
    }
  }

  const closeSecond =
    second &&
    second.score >= AMBIGUITY_FLOOR &&
    top.score - second.score < AMBIGUITY_GAP;

  if (closeSecond) {
    return {
      status: "ambiguous",
      confidence: "low",
      bankId: null,
      parserBankId: null,
      canonicalBankId: null,
      detected: "AMBIGUOUS",
      diagnostics: buildDiagnostics({
        status: "AMBIGUOUS",
        selectedBank: null,
        parserBankId: null,
        canonicalBankId: null,
        confidence: "low",
        top,
        second,
        rejected,
        ambiguityReason: "close_candidates",
      }),
    };
  }

  const confidence = confidenceFromScore(top.score);
  const canonical = top.canonical;
  const parserId = toParserBankId(canonical);
  return {
    status: "detected",
    confidence,
    bankId: canonical,
    parserBankId: parserId,
    canonicalBankId: canonical,
    detected: canonical,
    diagnostics: buildDiagnostics({
      status: "DETECTED",
      selectedBank: canonical,
      parserBankId: parserId,
      canonicalBankId: canonical,
      confidence,
      top,
      second,
      rejected,
      ambiguityReason: null,
    }),
  };
}

/** Geriye uyumluluk: kanonik banka string’i veya UNKNOWN/AMBIGUOUS */
export function detectKnownBankFormatScored(sheetRows, options = {}) {
  const result = detectExcelBank(sheetRows, options);
  if (result.status === "detected") return result.bankId;
  if (result.status === "ambiguous") return "AMBIGUOUS";
  return "UNKNOWN";
}

export function normalizeDetectedBankAlias(value = "") {
  const canonical = canonicalizeBankId(value);
  return canonical || "";
}
