/**
 * VakıfBank PDF layout adapter — ortak PDF hattında güvenli banka eklentisi.
 * Firma / dosya adı / hash / hesap hard-code yok.
 *
 * Gerçek Vakıf hesap ekstresi (pdfjs): tarih + açıklama + 2 para tokenı
 * (işlem tutarı, çalışan bakiye). Tutar işareti güvenilir değil; yön ve
 * signed amount çalışan bakiye farkından alınır.
 *
 * Ziraat dekont sınıflandırıcısı Vakıf başlıklarındaki Valör + çoklu ":"
 * yüzünden tetiklenmemeli — belge türü burada BANK_STATEMENT olur.
 */

import { createCanonicalBankTransaction } from "@/src/utils/bankCanonicalTransaction.js";
import { BANK_PDF_DOCUMENT_TYPE } from "@/src/utils/bankPdf/ziraatPdfLayout.js";

const DATE_START_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;
const CHAIN_TOLERANCE = 0.05;

function normalizeSpaces(s = "") {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeVakifBankBrand(text = "") {
  const t = normalizeSpaces(text).toLocaleLowerCase("tr-TR");
  return /vak[ıi]f\s*bank|vakifbank|vakiflar\s+bank/.test(t);
}

export function looksLikeVakifStatement(text = "") {
  const t = normalizeSpaces(text).toLocaleLowerCase("tr-TR");
  if (!looksLikeVakifBankBrand(t)) return false;
  const statement =
    /hesap\s*ekstresi/.test(t) ||
    /hesap\s*hareket/.test(t) ||
    /vadesiz/.test(t) ||
    /vb\s*m[uü][sş]/.test(t);
  const dateLines = (String(text || "").split(/\r?\n/).filter((l) => DATE_START_RE.test(l.trim())) || [])
    .length;
  return statement || dateLines >= 2;
}

export function classifyVakifPdfDocument(text = "") {
  if (!looksLikeVakifBankBrand(text)) return BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
  if (looksLikeVakifStatement(text)) return BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT;
  return BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
}

function toBal(tx) {
  const n = Number(tx?.balance);
  return Number.isFinite(n) ? n : null;
}

/**
 * 2-token Vakıf satırlarında tutar işareti çoğu zaman hep pozitif kalır.
 * Çalışan bakiye farkı hesabın gerçek hareketidir — yön tahmin edilmez.
 */
export function applyVakifRunningBalanceSigns(transactions = []) {
  const txs = Array.isArray(transactions) ? [...transactions] : [];
  if (txs.length < 2) return txs;
  for (let i = 1; i < txs.length; i += 1) {
    const prevBal = toBal(txs[i - 1]);
    const curBal = toBal(txs[i]);
    if (prevBal == null || curBal == null) continue;
    const delta = Number((curBal - prevBal).toFixed(2));
    if (Math.abs(delta) < 0.005) continue;
    const currentSigned = Number(txs[i].amount);
    const chainOk =
      Number.isFinite(currentSigned) &&
      Math.abs(prevBal + currentSigned - curBal) <= CHAIN_TOLERANCE;
    if (chainOk) continue;
    const direction = delta < 0 ? "CIKIS" : "GIRIS";
    txs[i] = createCanonicalBankTransaction({
      ...txs[i],
      amount: delta,
      direction,
    });
  }
  return txs;
}

export function applyVakifStatementPostParse(parsed = {}, text = "") {
  const transactions = applyVakifRunningBalanceSigns(parsed.transactions || []);
  const classified = classifyVakifPdfDocument(text);
  const documentType =
    classified !== BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT
      ? classified
      : transactions.length >= 1
        ? BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT
        : BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
  return {
    ...parsed,
    transactions,
    bank: parsed.bank || "VAKIFBANK",
    documentType,
    diagnostics: {
      ...(parsed.diagnostics || {}),
      parserMode: "vakif_running_balance",
      winner: "vakif_statement",
    },
  };
}
