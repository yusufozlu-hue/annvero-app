/**
 * Mevduat faizinden bankanın kestiği stopaj → FAIZ_STOPAJI (193).
 * Normal Vergi/SGK tahakkuk kapısına kilitlenmemeli.
 *
 * Kanıt sinyalleri birlikte değerlendirilir:
 * - açıklama (STOPAJ / mevduat / faiz),
 * - ilişkili FAIZ_GELIRI,
 * - tutar/oran (yaygın stopaj oranları),
 * - aynı tarih / vadeli hesap yaşam döngüsü.
 */

import { BANK_TRANSACTION_TYPE, isVergiSgkType } from "@/src/utils/bankTransactionType";
import { normalizeParserText } from "@/src/utils/textNormalize";
import { MISSING_HESAP_CATEGORY } from "@/src/utils/previewExportValidation";

/** Yaygın mevduat faiz stopaj oranları (toleranslı) */
export const FAIZ_STOPAJ_RATES = [0.05, 0.1, 0.15, 0.175, 0.2];

const RATE_TOLERANCE = 0.012; // ±1.2 puan

const STRICT_OBLIGATION_RE =
  /\b(MUHSGK|MUHTASAR|SGK|SGDP|KDV\s*2|KDV2|KDV\s*1|KDV1|\bKDV\b|GECICI\s+VERGI|KURUMLAR|DAMGA\s+VERGI|KONAKLAMA\s+VERGI|TURIZM\s+PAY|MTV|EMLAK\s+VERGI|ODA\s+AIDAT|TRAFIK\s+CEZA)\b/i;

const FAIZ_STOPAJ_TEXT_RE =
  /\b(FAIZ\s*STOPAJ|STOPAJ\s*FAIZ|MEVDUAT\s*STOPAJ|VADEL[Iİ]\s*STOPAJ|STOPAJ\s*KESINT|FAIZDEN\s*STOPAJ|STOPAJ\s*\(?\s*%?\s*\d)/i;

const SOFT_TAX_OUTFLOW_RE =
  /\b(VERGI\s*ODEME|VERGI\s*ODEMESI|STOPAJ|GELIR\s*VERGISI\s*STOPAJ)\b/i;

const FAIZ_SIGNAL_RE =
  /\b(FAIZ\s*GELIR|FAIZ\s*TAHAKKUK|FAIZ\s*TAHSIL|MEVDUAT\s*FAIZ|VADE\s*FAIZ|VADEL[Iİ]\s*FAIZ)\b/i;

const LIFECYCLE_OPEN_RE =
  /\b(HESAP\s*ACMA|VADEL[Iİ].*ACMA|MEVDUAT\s*ACMA|ACILIS)/i;
const LIFECYCLE_CLOSE_RE =
  /\b(HESAP\s*KAPAT|VADEL[Iİ].*KAPAT|MEVDUAT\s*KAPAT|KAPANIS)/i;

function absAmount(row = {}) {
  return Math.abs(Number(row.amount ?? row.tutar ?? 0) || 0);
}

function rowDate(row = {}) {
  return String(row.date || row.tarih || row.transactionDate || "").slice(0, 10);
}

function rowDesc(row = {}) {
  return normalizeParserText(row.description || row.aciklama || "");
}

function rowDirection(row = {}) {
  const d = String(row.direction || row.yon || "").toUpperCase();
  return d === "CIKIS" || d === "GIDEN" ? "CIKIS" : "GIRIS";
}

/**
 * Açıklamada net faiz-stopajı sinyali (tek satır yeterli).
 */
export function hasFaizStopajiDescriptionSignal(description = "") {
  const text = normalizeParserText(description);
  if (!text) return false;
  if (STRICT_OBLIGATION_RE.test(text) && !FAIZ_STOPAJ_TEXT_RE.test(text)) {
    return false;
  }
  if (FAIZ_STOPAJ_TEXT_RE.test(text)) return true;
  // STOPAJ + faiz/mevduat aynı metinde
  if (/\bSTOPAJ\b/.test(text) && /\b(FAIZ|MEVDUAT|VADEL)/.test(text)) {
    return true;
  }
  return false;
}

/**
 * Oran eşleşmesi: stopaj ≈ faiz × oran
 */
export function matchesFaizStopajRate(stopajAmount, faizAmount, rates = FAIZ_STOPAJ_RATES) {
  const s = Math.abs(Number(stopajAmount) || 0);
  const f = Math.abs(Number(faizAmount) || 0);
  if (!(s > 0) || !(f > 0)) return { ok: false, rate: null, expected: null };
  const ratio = s / f;
  for (const rate of rates) {
    if (Math.abs(ratio - rate) <= RATE_TOLERANCE) {
      return { ok: true, rate, expected: Math.round(f * rate * 100) / 100, ratio };
    }
  }
  return { ok: false, rate: null, expected: null, ratio };
}

/**
 * Yaşam döngüsü: açma + faiz + stopaj + kapatma tutar ilişkisi
 * principal + faiz − stopaj ≈ kapanış
 */
export function matchesVadeliLifecycleAmounts(movements = [], stopajRow, faizRow) {
  const rows = movements || [];
  const stopaj = absAmount(stopajRow);
  const faiz = absAmount(faizRow);
  if (!(stopaj > 0) || !(faiz > 0)) return { ok: false };

  const opens = rows.filter(
    (r) => rowDirection(r) === "GIRIS" && LIFECYCLE_OPEN_RE.test(rowDesc(r))
  );
  const closes = rows.filter(
    (r) => rowDirection(r) === "CIKIS" && LIFECYCLE_CLOSE_RE.test(rowDesc(r))
  );
  if (!opens.length || !closes.length) return { ok: false, reason: "no_open_close" };

  const tol = 1.0; // 1 TL
  for (const open of opens) {
    const principal = absAmount(open);
    for (const close of closes) {
      const closing = absAmount(close);
      const expected = Math.round((principal + faiz - stopaj) * 100) / 100;
      if (Math.abs(closing - expected) <= tol) {
        return {
          ok: true,
          principal,
          faiz,
          stopaj,
          closing,
          expected,
        };
      }
    }
  }
  return { ok: false, reason: "amount_mismatch" };
}

/**
 * Tek satır metinden FAIZ_STOPAJI (yön CIKIS).
 */
export function detectFaizStopajiType(description = "", direction = "") {
  const dir = String(direction || "").toUpperCase();
  if (dir && dir !== "CIKIS" && dir !== "GIDEN") return null;
  if (hasFaizStopajiDescriptionSignal(description)) {
    return BANK_TRANSACTION_TYPE.FAIZ_STOPAJI;
  }
  return null;
}

/**
 * Stopaj adayı mı? (henüz FAIZ_STOPAJI değilse)
 * Katı yükümlülük türlerini (KDV/SGK/…) dışarıda bırakır.
 */
export function isFaizStopajiCandidateRow(row = {}) {
  if (rowDirection(row) !== "CIKIS") return false;
  const type = String(row.transactionType || "");
  if (type === BANK_TRANSACTION_TYPE.FAIZ_STOPAJI) return false;
  if (type === BANK_TRANSACTION_TYPE.FAIZ_GELIRI) return false;

  const desc = rowDesc(row);
  if (STRICT_OBLIGATION_RE.test(desc) && !hasFaizStopajiDescriptionSignal(desc)) {
    return false;
  }

  // Zaten net faiz-stopaj metni
  if (hasFaizStopajiDescriptionSignal(desc)) return true;

  // Genel VERGI / yumuşak vergi çıkışı — ilişki ile doğrulanacak
  const softType =
    type === BANK_TRANSACTION_TYPE.VERGI ||
    type === "" ||
    type === BANK_TRANSACTION_TYPE.BILINMEYEN ||
    (isVergiSgkType(type) &&
      type === BANK_TRANSACTION_TYPE.VERGI);

  if (softType && SOFT_TAX_OUTFLOW_RE.test(desc)) return true;
  if (softType && /\bSTOPAJ\b/.test(desc)) return true;
  // "Vergi ödemesi" tek başına — yalnız ilişki kanıtı ile
  if (softType && /\bVERGI\b/.test(desc)) return true;

  return false;
}

function scoreRelatedFaiz(stopajRow, faizRow, allMovements) {
  let score = 0;
  const reasons = [];
  const stopajAmt = absAmount(stopajRow);
  const faizAmt = absAmount(faizRow);
  const dStopaj = rowDate(stopajRow);
  const dFaiz = rowDate(faizRow);

  if (dStopaj && dFaiz && dStopaj === dFaiz) {
    score += 40;
    reasons.push("same_date");
  } else if (dStopaj && dFaiz) {
    const a = Date.parse(dStopaj);
    const b = Date.parse(dFaiz);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 3 * 86400000) {
      score += 20;
      reasons.push("near_date");
    }
  }

  const rate = matchesFaizStopajRate(stopajAmt, faizAmt);
  if (rate.ok) {
    score += 45;
    reasons.push(`rate_${rate.rate}`);
  }

  const life = matchesVadeliLifecycleAmounts(allMovements, stopajRow, faizRow);
  if (life.ok) {
    score += 35;
    reasons.push("lifecycle_amounts");
  }

  if (FAIZ_SIGNAL_RE.test(rowDesc(faizRow))) {
    score += 10;
    reasons.push("faiz_signal");
  }
  if (hasFaizStopajiDescriptionSignal(rowDesc(stopajRow))) {
    score += 25;
    reasons.push("stopaj_text");
  } else if (SOFT_TAX_OUTFLOW_RE.test(rowDesc(stopajRow))) {
    score += 5;
    reasons.push("soft_tax_text");
  }

  return { score, reasons, rate, life };
}

/**
 * İlişkili faiz satırını bul (en yüksek skor, eşik üstü).
 */
export function findRelatedFaizGeliri(stopajRow, movements = []) {
  const faizRows = (movements || []).filter(
    (r) =>
      String(r.transactionType || "") === BANK_TRANSACTION_TYPE.FAIZ_GELIRI &&
      rowDirection(r) === "GIRIS" &&
      absAmount(r) > 0
  );
  let best = null;
  for (const faiz of faizRows) {
    const scored = scoreRelatedFaiz(stopajRow, faiz, movements);
    if (!best || scored.score > best.score) {
      best = { faizRow: faiz, ...scored };
    }
  }
  // Eşik: oran veya yaşam döngüsü veya (aynı gün + soft text) yeterli
  if (!best) return null;
  const strong =
    best.rate?.ok ||
    best.life?.ok ||
    (best.reasons.includes("same_date") && best.reasons.includes("stopaj_text")) ||
    best.score >= 70;
  if (!strong) return null;
  return best;
}

/**
 * Hareket listesinde stopaj adaylarını FAIZ_STOPAJI yap.
 * Canonical PDF/Excel aynı mapper çıktısını kullanır.
 *
 * @returns {{ movements: object[], reclassified: object[] }}
 */
export function applyFaizStopajiClassification(movements = []) {
  const list = Array.isArray(movements) ? movements.map((m) => ({ ...m })) : [];
  const reclassified = [];

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!isFaizStopajiCandidateRow(row)) continue;

    const textHit = hasFaizStopajiDescriptionSignal(rowDesc(row));
    const related = findRelatedFaizGeliri(row, list);

    if (!textHit && !related) continue;

    const reasons = [
      ...(textHit ? ["description"] : []),
      ...(related?.reasons || []),
    ];

    const prevType = row.transactionType;
    row.transactionType = BANK_TRANSACTION_TYPE.FAIZ_STOPAJI;
    row.cariRequired = false;
    row.personelRequired = false;
    row.accountingScenario = "FINANS";
    row.faizStopajiMeta = {
      relatedFaizSourceMovementId:
        related?.faizRow?.sourceMovementId ||
        related?.faizRow?.sourceRowId ||
        related?.faizRow?.id ||
        "",
      relatedFaizAmount: related ? absAmount(related.faizRow) : null,
      matchReasons: reasons,
      rate: related?.rate?.rate ?? null,
    };

    // Vergi/SGK kapısı kalıntılarını temizle
    const warn = String(row.warning || "")
      .split("|")
      .map((w) => w.trim())
      .filter(Boolean)
      .filter(
        (w) =>
          !/VERGI\/SGK|TAHAKKUK|MALI YUKUMLULUK|VERGI ODEME/i.test(
            normalizeParserText(w)
          )
      );
    warn.push("Faiz stopajı (193 Peşin Ödenen Vergiler)");
    if (!row.counterAccountCode) {
      warn.push("Finans işlem türü çözülemedi");
      row.missingHesapCategory = MISSING_HESAP_CATEGORY.FINAN_ISLEM;
    } else {
      row.missingHesapCategory = "";
    }
    row.warning = warn.join(" | ");

    // Yanlış vergi ailesi eşleşmesini düşür
    if (
      row.matchedRule?.anahtar === "vergi" ||
      row.matchedRule?.islem === "Vergi ödemesi" ||
      /vergi/i.test(String(row.matchedRule?.source || ""))
    ) {
      row.matchedRule = {
        source: "faizStopajiClassify",
        islem: "FAIZ_STOPAJI",
        anahtar: "faiz-stopaj",
        transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
      };
    }

    reclassified.push({
      id: row.id,
      sourceMovementId: row.sourceMovementId || row.sourceRowId || row.id,
      fromType: prevType,
      toType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
      reasons,
    });
    list[i] = row;
  }

  return { movements: list, reclassified };
}
