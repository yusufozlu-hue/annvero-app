/**
 * Banka açıklamasından yükümlülük sınıflandırması (saf).
 * Turizm: yalnız TURIZM PAYI / TURIZM VERGI — çıplak TURIZM yok.
 */
import {
  OBLIGATION_TRANSACTION_TYPE,
  OBLIGATION_TYPE,
  TAX_OBLIGATION_CLASSIFICATION,
} from "./types.js";

function norm(text = "") {
  return String(text || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C");
}

/**
 * @returns {{
 *   isObligationPayment: boolean,
 *   classification: string,
 *   obligationType: string,
 *   transactionType: string,
 *   cariRequired: false,
 * }}
 */
export function classifyObligationPayment(description = "") {
  const text = norm(description);
  const empty = {
    isObligationPayment: false,
    classification: "",
    obligationType: "",
    transactionType: "",
    cariRequired: false,
  };
  if (!text) return empty;

  const hit = (obligationType, transactionType, classification) => ({
    isObligationPayment: true,
    classification,
    obligationType,
    transactionType,
    cariRequired: false,
  });

  const tax = TAX_OBLIGATION_CLASSIFICATION.TAX_OBLIGATION_PAYMENT;
  const sgk = TAX_OBLIGATION_CLASSIFICATION.SGK_OBLIGATION_PAYMENT;

  if (/\bMUHSGK\b/.test(text) || /\bMUHTASAR\b/.test(text)) {
    return hit(
      OBLIGATION_TYPE.MUHSGK,
      OBLIGATION_TRANSACTION_TYPE.MUHSGK_ODEME,
      tax
    );
  }
  if (/\bSGDP\b/.test(text)) {
    return hit(OBLIGATION_TYPE.SGDP, OBLIGATION_TRANSACTION_TYPE.SGK_ODEME, sgk);
  }
  if (/\bSGK\b/.test(text) || /SOSYAL\s+GUVENLIK/.test(text)) {
    return hit(OBLIGATION_TYPE.SGK, OBLIGATION_TRANSACTION_TYPE.SGK_ODEME, sgk);
  }
  if (/\bKDV\s*2\b|\bKDV2\b/.test(text)) {
    return hit(
      OBLIGATION_TYPE.KDV2,
      OBLIGATION_TRANSACTION_TYPE.KDV2_ODEME,
      tax
    );
  }
  if (/\bKDV\s*1\b|\bKDV1\b|\bKDV\b/.test(text)) {
    return hit(
      OBLIGATION_TYPE.KDV1,
      OBLIGATION_TRANSACTION_TYPE.KDV1_ODEME,
      tax
    );
  }
  if (/GECICI\s+VERGI|\bGGECICI\b|\bGV\s*BEYAN/.test(text)) {
    return hit(
      OBLIGATION_TYPE.GECICI_VERGI,
      OBLIGATION_TRANSACTION_TYPE.GECICI_VERGI_ODEME,
      tax
    );
  }
  if (/KURUMLAR\s+VERGISI|\bKURUMLAR\b/.test(text)) {
    return hit(
      OBLIGATION_TYPE.KURUMLAR_VERGISI,
      OBLIGATION_TRANSACTION_TYPE.KURUMLAR_VERGISI_ODEME,
      tax
    );
  }
  if (/DAMGA\s+VERGISI|\bDAMGA\b/.test(text)) {
    return hit(
      OBLIGATION_TYPE.DAMGA_VERGISI,
      OBLIGATION_TRANSACTION_TYPE.DAMGA_VERGISI_ODEME,
      tax
    );
  }
  if (/KONAKLAMA\s+VERGI/.test(text)) {
    return hit(
      OBLIGATION_TYPE.KONAKLAMA_VERGISI,
      OBLIGATION_TRANSACTION_TYPE.KONAKLAMA_VERGISI_ODEME,
      tax
    );
  }
  // Dar Turizm — çıplak TURIZM yok
  if (/TURIZM\s+PAYI|TURIZM\s+VERGI/.test(text)) {
    return hit(
      OBLIGATION_TYPE.TURIZM_PAYI,
      OBLIGATION_TRANSACTION_TYPE.TURIZM_PAYI_ODEME,
      tax
    );
  }

  return empty;
}
