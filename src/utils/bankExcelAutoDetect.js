/**
 * Excel banka auto-detect — puanlamalı, belirsizlikte UNKNOWN/AMBIGUOUS.
 * Dosya adı yalnız düşük ağırlıklı yardımcı sinyaldir; içerik önceliklidir.
 */

import {
  canonicalizeBankId,
  toParserBankId,
} from "@/src/utils/bankIdentity";

export const BANK_EXCEL_DETECTOR_VERSION = "excel-auto-detect/1.0.0";

/** formatGuard ile aynı — döngüsel import yok */
function normalizeStatementHeaderText(value) {
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

function joinCorpus(sheetRows = [], scanLimit = 40) {
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) {
    return { fullText: "", headerTexts: [], rowTexts: [] };
  }
  const limit = Math.min(sheetRows.length, Math.max(1, scanLimit));
  const rowTexts = [];
  for (let i = 0; i < limit; i += 1) {
    const row = sheetRows[i];
    if (!Array.isArray(row)) continue;
    const text = row
      .map((cell) => normalizeStatementHeaderText(cell))
      .filter(Boolean)
      .join(" ");
    if (text) rowTexts.push(text);
  }
  return {
    fullText: rowTexts.join(" | "),
    headerTexts: rowTexts,
    rowTexts,
  };
}

function pushSignal(bag, code, weight, detail = "") {
  bag.push({ code, weight, detail: detail || code });
}

function scoreVakifbank(corpus) {
  const signals = [];
  const t = corpus.fullText;
  if (!t) return { canonical: "VAKIFBANK", score: 0, signals };

  if (/vakif\s*bank|vakifbank/.test(t)) {
    pushSignal(signals, "brand_vakifbank", WEIGHTS.brand);
  }
  if (/tr\d{2}00015/.test(t.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00015", WEIGHTS.iban);
  }
  if (/tvbatr2a|tvba\s*tr/.test(t)) {
    pushSignal(signals, "bic_tvba", WEIGHTS.bic);
  }

  // Güçlü native fingerprint — tek başına "islem tarihi" yetmez
  const strongNative =
    (t.includes("b/a") &&
      (t.includes("fis no") || t.includes("hesap no") || t.includes("tutar"))) ||
    (t.includes("hesap no") &&
      t.includes("fis no") &&
      t.includes("tutar") &&
      (t.includes("islem") || t.includes("aciklama"))) ||
    (t.includes("hesap") && t.includes("hareket") && t.includes("tutar")) ||
    (t.includes("fis no") && t.includes("hareket") && t.includes("tutar"));

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
  if (!t) return { canonical: "GARANTI", score: 0, signals };

  if (/garanti|bbva/.test(t)) {
    pushSignal(signals, "brand_garanti", WEIGHTS.brand);
  }
  if (/tr\d{2}00062/.test(t.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00062", WEIGHTS.iban);
  }
  if (/tgbatris|tgba\s*tr/.test(t)) {
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
  if (!t) return { canonical: "TEB", score: 0, signals };

  if (/\bteb\b|turkiye ekonomi bank|turkiye ekonomi|ekonomi bankasi/.test(t)) {
    pushSignal(signals, "brand_teb", WEIGHTS.brand);
  }
  if (/tr\d{2}00032/.test(t.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00032", WEIGHTS.iban);
  }
  if (/tebutris|tebu\s*tr/.test(t)) {
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
  if (!t) return { canonical: "ZIRAAT", score: 0, signals };

  if (/t\.?\s*c\.?\s*ziraat|ziraat bank|ziraat/.test(t)) {
    pushSignal(signals, "brand_ziraat", WEIGHTS.brand);
  }
  if (/tr\d{2}00010/.test(t.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00010", WEIGHTS.iban);
  }
  if (/tczbtr|tczb\s*tr/.test(t)) {
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
  if (!t) return { canonical: "KUVEYTTURK", score: 0, signals };

  if (/kuveyt\s*turk|kuveytturk|kuveyt/.test(t)) {
    pushSignal(signals, "brand_kuveytturk", WEIGHTS.brand);
  }
  // "katilim" yalnız başına başka katılım bankasına da uyabilir — kuveyt ile birlikte
  if (/katilim/.test(t) && /kuveyt/.test(t)) {
    pushSignal(signals, "brand_katilim_kuveyt", 12);
  }
  if (/tr\d{2}00205/.test(t.replace(/\s/g, ""))) {
    pushSignal(signals, "iban_00205", WEIGHTS.iban);
  }
  if (/kteftris|ktef\s*tr/.test(t)) {
    pushSignal(signals, "bic_ktef", WEIGHTS.bic);
  }

  const hasTarih = t.includes("tarih");
  const hasAciklama = t.includes("aciklama");
  const hasBorcAlacak = t.includes("borc") && t.includes("alacak");
  if (hasTarih && hasAciklama && hasBorcAlacak) {
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
  const boosts = [
    [/vakif|hesap hareket/, "VAKIFBANK"],
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

/**
 * Güvenli Excel banka çözümü + diagnostics (hassas hücre içeriği yok).
 */
export function detectExcelBank(sheetRows, options = {}) {
  const emptyDiagnostics = {
    selectedBank: null,
    canonicalBankId: null,
    confidence: "unknown",
    matchedSignals: [],
    rejectedCandidates: [],
    ambiguityReason: null,
    detectorVersion: BANK_EXCEL_DETECTOR_VERSION,
  };

  if (!Array.isArray(sheetRows) || sheetRows.length === 0) {
    return {
      status: "unknown",
      confidence: "unknown",
      bankId: null,
      canonicalBankId: null,
      detected: "UNKNOWN",
      diagnostics: {
        ...emptyDiagnostics,
        ambiguityReason: "empty_workbook",
      },
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
    const exclusiveFormat = Boolean(
      top?.signals?.some(
        (s) =>
          s.code === "header_garanti_export" ||
          s.code === "header_vakif_native"
      )
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
        canonicalBankId: null,
        detected: "UNKNOWN",
        diagnostics: {
          ...emptyDiagnostics,
          rejectedCandidates: rejected,
          ambiguityReason:
            top && top.score > 0 ? "below_threshold" : "no_strong_signal",
          topScore: top?.score ?? 0,
        },
      };
    }
    // Güçlü Vakıf/Garanti native header — brand olmadan da kabul
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
      canonicalBankId: null,
      detected: "AMBIGUOUS",
      diagnostics: {
        selectedBank: null,
        canonicalBankId: null,
        confidence: "low",
        matchedSignals: top.signals.map((s) => s.code),
        rejectedCandidates: rejected,
        ambiguityReason: "close_candidates",
        detectorVersion: BANK_EXCEL_DETECTOR_VERSION,
        topScore: top.score,
        secondScore: second.score,
        topCanonical: top.canonical,
        secondCanonical: second.canonical,
      },
    };
  }

  const confidence = confidenceFromScore(top.score);
  const parserId = toParserBankId(top.canonical);
  return {
    status: "detected",
    confidence,
    bankId: parserId,
    canonicalBankId: top.canonical,
    detected: parserId,
    diagnostics: {
      selectedBank: parserId,
      canonicalBankId: top.canonical,
      confidence,
      matchedSignals: top.signals.map((s) => s.code),
      rejectedCandidates: rejected,
      ambiguityReason: null,
      detectorVersion: BANK_EXCEL_DETECTOR_VERSION,
      topScore: top.score,
    },
  };
}

/** Geriye uyumluluk: yalnız banka string’i */
export function detectKnownBankFormatScored(sheetRows, options = {}) {
  const result = detectExcelBank(sheetRows, options);
  if (result.status === "detected") return result.bankId;
  if (result.status === "ambiguous") return "AMBIGUOUS";
  return "UNKNOWN";
}

export function normalizeDetectedBankAlias(value = "") {
  const canonical = canonicalizeBankId(value);
  return canonical ? toParserBankId(canonical) : "";
}
