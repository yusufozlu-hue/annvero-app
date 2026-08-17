/**
 * Ziraat PDF layout adapter — ortak PDF hattında güvenli banka eklentisi.
 * Firma / dosya adı / hash / hesap hard-code yok.
 *
 * Belge türleri (ayrı tutulur):
 * - BANK_STATEMENT — hesap ekstresi tablosu
 * - BANK_TRANSFER_RECEIPT — tek havale/virman dekontu (ekstre değildir)
 * - UNKNOWN_BANK_DOCUMENT
 *
 * Dekont yönü yalnız sahiplik kanıtıyla (IBAN/hesap ↔ firma); “havale”/başlık tahmin yok.
 */

import {
  BANK_STATEMENT_SOURCE,
  createCanonicalBankTransaction,
} from "@/src/utils/bankCanonicalTransaction.js";

/** Ziraat PDF belge sınıfları — ekstre ≠ dekont. */
export const BANK_PDF_DOCUMENT_TYPE = Object.freeze({
  BANK_STATEMENT: "BANK_STATEMENT",
  BANK_TRANSFER_RECEIPT: "BANK_TRANSFER_RECEIPT",
  UNKNOWN_BANK_DOCUMENT: "UNKNOWN_BANK_DOCUMENT",
});

export const ACCOUNT_OWNERSHIP_UNRESOLVED = "ACCOUNT_OWNERSHIP_UNRESOLVED";
export const COUNTERPARTY_UNRESOLVED = "COUNTERPARTY_UNRESOLVED";

const DATE_RE = /(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/;
const DATE_RE_G = /(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/g;
const DATE_ONLY_RE = /^\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}$/;
const AMOUNT_RE =
  /-?\d{1,3}(?:[.\s']\d{3})*(?:,\d{2})|-?\d+(?:,\d{2})/g;
const PAGE_MARK_RE = /^---\s*page\s+(\d+)\s*---$/i;
const IBAN_RE = /\bTR\s*\d{2}(?:\s*\d{4}){5}\s*\d{2}\b|\bTR\d{24}\b/gi;

/** Ana transfer tutarı etiketleri — masraf/BSMV/kur hariç. */
const MAIN_TRANSFER_AMOUNT_RE =
  /(?:havale\s*|transfer\s*|i[sş]lem\s*)?tutar[ıi]?\s*:?\s*(-?\d{1,3}(?:[.\s']\d{3})*(?:,\d{2})?|-?\d+(?:,\d{2})?)/i;
const FEE_OR_CHARGE_LINE_RE =
  /\b(masraf|komisyon|[uü]cret|bsmv|damga\s*vergisi|toplam\s*(?:masraf|[uü]cret|kesinti)|kur\s*(?:de[gğ]eri|fiyat)|d[oö]viz\s*kuru|slip\s*no|referans\s*no|i[sş]lem\s*no)\b/i;
const SENDER_LABEL_RE =
  /g[oö]nderen|bor[cç]lu|from\s*account|source\s*account|hesaptan\s*(?:d[uü][sş][uü]len|kesilen)?\s*hesap|g[oö]nderici/i;
const RECEIVER_LABEL_RE =
  /al[iı]c[iı]|alacakl[iı]|lehtar|to\s*account|hedef\s*hesap|hesaba\s*ge[cç]en/i;

const STATEMENT_HEADER_KEYS = [
  ["muh_tarih", /muh\.?\s*tarih|i[sş]lem\s*tarihi|^tarih$/i],
  ["valor", /val[oö]r/i],
  ["sube", /[sş]ube/i],
  ["fis", /fi[sş]\s*no|^fi[sş]$/i],
  ["isl_kd", /i[sş]l\.?\s*kd|i[sş]lem\s*kod/i],
  ["borc", /^bor[cç]$|bor[cç]\s*$/i],
  ["alacak", /^alacak$/i],
  ["tutar", /^tutar$/i],
  ["bakiye", /bakiye/i],
  ["aciklama", /a[cç][iı]klama|i[sş]lem\s*a[cç][iı]klama/i],
  ["ba", /^b\s*\/\s*a$|^b\/a$/i],
];

const FOOTER_RE =
  /^(sayfa\s*\d+|page\s*\d+|www\.|telefon|m[uü][sş]teri\s*hizmet|copyright|devam\s* ediyor|bu\s*belge|defter\s*kay[iı]t)/i;
const SUBTOTAL_RE =
  /(ara\s*toplam|g[uü]nl[uü]k\s*toplam|toplam\s*bor[cç]|toplam\s*alacak|a[cç][iı]l[iı][sş]\s*bakiyesi|kapan[iı][sş]\s*bakiyesi|devreden\s*bakiye)/i;

function stripNulls(s = "") {
  return String(s || "").replace(/\u0000/g, "");
}

function normalizeSpaces(s = "") {
  return stripNulls(s)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(d, m, y) {
  const yy = String(y).length === 2 ? `20${y}` : String(y);
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${yy}`;
}

function normalizeDateToken(raw = "") {
  const m = String(raw || "").match(DATE_RE);
  if (!m) return "";
  return formatDate(m[1], m[2], m[3]);
}

export function parseTrAmountToken(raw = "") {
  const s = normalizeSpaces(raw).replace(/[^\d,.\-]/g, "");
  if (!s) return NaN;
  // "0,00" / "0.00" korunur (null değil)
  const normalized = s.replace(/\s/g, "").replace(/'/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function extractAmounts(text = "") {
  return [...String(text || "").matchAll(AMOUNT_RE)].map((m) => m[0]);
}

export function looksLikeZiraatBrand(text = "") {
  const t = normalizeSpaces(text).toLocaleLowerCase("tr-TR");
  return /t\.?\s*c\.?\s*ziraat|ziraat\s*bank|ziraat/.test(t);
}

export function looksLikeZiraatStatementHeader(text = "") {
  const t = normalizeSpaces(text).toLocaleLowerCase("tr-TR");
  const hasMuh = /muh\.?\s*tarih/.test(t);
  const hasValor = /val[oö]r/.test(t);
  const hasBorcAlacak = /bor[cç]/.test(t) && /alacak/.test(t);
  const hasFis = /fi[sş]\s*no/.test(t);
  return (hasMuh && hasValor) || (hasBorcAlacak && (hasFis || hasMuh || hasValor));
}

export function looksLikeZiraatDekont(text = "") {
  const t = normalizeSpaces(text).toLocaleLowerCase("tr-TR");
  const labelValue =
    (t.match(/:\s*/g) || []).length >= 4 &&
    (/val[oö]r/.test(t) || /havale\s*tutar/.test(t) || /a[cç][iı]klama\s*:/.test(t));
  const title =
    /hesaptan\s+.+\s+havale|hesaba\s+.+\s+havale|virman|dekont|internet\s*bankac/.test(t);
  return labelValue || (title && /val[oö]r|tutar/.test(t));
}

export function looksLikeZiraatPdfLayout(text = "") {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (looksLikeZiraatStatementHeader(t)) return true;
  if (looksLikeZiraatBrand(t) && looksLikeZiraatDekont(t)) return true;
  // Dekont parmak izi (marka OCR’da kırık olabilir)
  if (looksLikeZiraatDekont(t) && /val[oö]r/i.test(t) && /tutar/i.test(t)) return true;
  return false;
}

/**
 * Ziraat PDF belge türü — ekstre ile dekontu karıştırma.
 */
export function classifyZiraatPdfDocument(text = "") {
  const t = String(text || "");
  if (!t.trim()) return BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
  const statement = looksLikeZiraatStatementHeader(t);
  const receipt = looksLikeZiraatDekont(t);
  if (statement && !receipt) return BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT;
  if (receipt && !statement) return BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT;
  if (statement && receipt) {
    // Tablo başlığı varsa ekstre kazanır; aksi halde dekont
    return BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT;
  }
  if (looksLikeZiraatBrand(t)) return BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
  return BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
}

function compactIban(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function extractIbans(text = "") {
  const hits = String(text || "").match(IBAN_RE) || [];
  return [...new Set(hits.map(compactIban).filter((x) => /^TR\d{24}$/.test(x)))];
}

function extractLabeledParty(lines = [], roleRe) {
  const ibans = [];
  const accounts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!roleRe.test(line)) continue;
    for (const iban of extractIbans(line)) ibans.push(iban);
    const acct = line.match(
      /(?:hesap\s*no|account\s*no|hesap\s*numaras[ıi]?)\s*:?\s*([0-9\s.\-]{5,})/i
    );
    if (acct) {
      const d = digitsOnly(acct[1]);
      if (d.length >= 5) accounts.push(d);
    }
    // Etiket satırında yoksa bir sonraki satıra bak
    if (!ibans.length && !accounts.length && lines[i + 1]) {
      for (const iban of extractIbans(lines[i + 1])) ibans.push(iban);
      const d = digitsOnly(lines[i + 1]);
      if (/^\d{5,}$/.test(d)) accounts.push(d);
    }
  }
  return {
    ibans: [...new Set(ibans)],
    accounts: [...new Set(accounts)],
  };
}

function collectFirmAccountKeys(context = {}) {
  const ibans = new Set();
  const accounts = new Set();
  const lucaCodes = new Set();
  const evidence = [];

  const pushBank = (bank, source) => {
    if (!bank || bank.isActive === false) return;
    const iban = compactIban(bank.iban || bank.IBAN || "");
    if (/^TR\d{24}$/.test(iban)) {
      ibans.add(iban);
      evidence.push({ source, kind: "iban", masked: `${iban.slice(0, 4)}…${iban.slice(-4)}` });
    }
    for (const raw of [bank.accountNumber, bank.hesapNo, bank.accountNo]) {
      const d = digitsOnly(raw || "");
      if (d.length >= 5) {
        accounts.add(d);
        evidence.push({ source, kind: "account", masked: `…${d.slice(-4)}` });
      }
    }
    const luca = String(bank.lucaAccountCode || bank.lucaCode || bank.code || "").trim();
    if (/^102(\.|$)/.test(luca)) {
      lucaCodes.add(luca);
      evidence.push({ source, kind: "luca102", code: luca });
    }
  };

  for (const bank of context.bankAccounts || context.selectedCompany?.bankAccounts || []) {
    const name = String(bank.bankName || bank.name || "").toUpperCase();
    if (name && !/ZIRAAT/.test(name) && (context.bankAccounts || []).length > 1) {
      // Çoklu bankada yalnız Ziraat; tek hesapta kabul
      continue;
    }
    pushBank(bank, "firm_bankAccounts");
  }

  for (const leaf of context.accountPlan102 || context.accountPlan || []) {
    const code = String(leaf.code || leaf.lucaCode || leaf.hesapKodu || "").trim();
    const name = String(leaf.bankName || leaf.name || leaf.hesapAdi || "").toUpperCase();
    if (!/^102(\.|$)/.test(code)) continue;
    if (name && !/ZIRAAT/.test(name) && !/^102\./.test(code)) continue;
    // Exact Ziraat 102 leaf — kod veya ad
    if (/ZIRAAT/.test(name) || /^102\./.test(code)) {
      lucaCodes.add(code);
      evidence.push({ source: "account_plan_102", kind: "luca102", code });
      const iban = compactIban(leaf.iban || "");
      if (/^TR\d{24}$/.test(iban)) {
        ibans.add(iban);
        evidence.push({
          source: "account_plan_102",
          kind: "iban",
          masked: `${iban.slice(0, 4)}…${iban.slice(-4)}`,
        });
      }
      const d = digitsOnly(leaf.accountNumber || leaf.hesapNo || "");
      if (d.length >= 5) {
        accounts.add(d);
        evidence.push({ source: "account_plan_102", kind: "account", masked: `…${d.slice(-4)}` });
      }
    }
  }

  for (const mem of context.verifiedAccountMemory || context.accountMemory || []) {
    if (!mem || mem.verified === false) continue;
    const bank = String(mem.bank || mem.bankName || "").toUpperCase();
    if (bank && !/ZIRAAT/.test(bank)) continue;
    const companyId = String(mem.companyId || "");
    const ctxCompany = String(context.companyId || context.selectedCompanyId || "");
    if (companyId && ctxCompany && companyId !== ctxCompany) continue;
    pushBank(mem, "verified_account_memory");
  }

  return { ibans, accounts, lucaCodes, evidence };
}

function partyMatchesFirm(party, firmKeys) {
  if (!party || !firmKeys) return false;
  for (const iban of party.ibans || []) {
    if (firmKeys.ibans.has(iban)) return true;
  }
  for (const acc of party.accounts || []) {
    if (firmKeys.accounts.has(acc)) return true;
    for (const firmAcc of firmKeys.accounts) {
      if (firmAcc.endsWith(acc) || acc.endsWith(firmAcc)) return true;
    }
  }
  return false;
}

/**
 * Dekont yönü — sahiplik önceliği:
 * A) aktif firma bankAccounts IBAN/hesap
 * B) hesap planı Ziraat 102 yaprağı
 * C) firma-scoped verified account memory
 * D) aksi halde UNKNOWN (tahmin yok)
 */
export function resolveZiraatReceiptDirection({ text = "", context = {} } = {}) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(normalizeSpaces)
    .filter(Boolean);
  const firmKeys = collectFirmAccountKeys(context);
  const sender = extractLabeledParty(lines, SENDER_LABEL_RE);
  const receiver = extractLabeledParty(lines, RECEIVER_LABEL_RE);
  const allIbans = extractIbans(lines.join("\n"));

  const firmIsSender = partyMatchesFirm(sender, firmKeys);
  const firmIsReceiver = partyMatchesFirm(receiver, firmKeys);

  let matchedVia = null;
  if (firmKeys.evidence.some((e) => e.source === "firm_bankAccounts")) matchedVia = "A_bankAccounts";
  else if (firmKeys.evidence.some((e) => e.source === "account_plan_102")) matchedVia = "B_plan102";
  else if (firmKeys.evidence.some((e) => e.source === "verified_account_memory")) {
    matchedVia = "C_verified_memory";
  }

  // Etiketli gönderen/alıcı eşleşmesi
  if (firmIsSender && !firmIsReceiver) {
    return {
      direction: "CIKIS",
      certain: true,
      role: "sender",
      matchedVia,
      accountOwnershipEvidence: firmKeys.evidence,
      reviewReason: "",
      bankGlHint: [...firmKeys.lucaCodes][0] || "",
      counterpartyUnresolved: !receiver.ibans.length && !receiver.accounts.length,
    };
  }
  if (firmIsReceiver && !firmIsSender) {
    return {
      direction: "GIRIS",
      certain: true,
      role: "receiver",
      matchedVia,
      accountOwnershipEvidence: firmKeys.evidence,
      reviewReason: "",
      bankGlHint: [...firmKeys.lucaCodes][0] || "",
      counterpartyUnresolved: !sender.ibans.length && !sender.accounts.length,
    };
  }

  // Tek taraflı IBAN: firma hesabı belgede var ama rol etiketi yok → UNKNOWN
  const firmIbanOnDoc = allIbans.some((iban) => firmKeys.ibans.has(iban));
  const firmAcctOnDoc = [...firmKeys.accounts].some((acc) => {
    const blob = digitsOnly(lines.join(" "));
    return blob.includes(acc);
  });

  return {
    direction: "UNKNOWN",
    certain: false,
    role: firmIbanOnDoc || firmAcctOnDoc ? "ambiguous" : "none",
    matchedVia: null,
    accountOwnershipEvidence: firmKeys.evidence,
    reviewReason: ACCOUNT_OWNERSHIP_UNRESOLVED,
    bankGlHint: "",
    counterpartyUnresolved: true,
    note:
      firmIsSender && firmIsReceiver
        ? "both_sides_matched"
        : firmIbanOnDoc || firmAcctOnDoc
          ? "account_seen_role_unlabeled"
          : "no_firm_account_match",
  };
}

/**
 * Ana havale tutarı — yalnız net etiket; masraf/BSMV/kur/ref hariç.
 */
export function extractZiraatReceiptMainAmount(lines = []) {
  const feeCandidates = [];
  let main = NaN;
  let mainLabel = "";

  for (const line of lines) {
    if (FEE_OR_CHARGE_LINE_RE.test(line)) {
      for (const tok of extractAmounts(line)) {
        const n = parseTrAmountToken(tok);
        if (Number.isFinite(n) && Math.abs(n) > 0) {
          feeCandidates.push({ line, amount: Math.abs(n) });
        }
      }
      continue;
    }
    // "Havale Tutarı" / "Transfer Tutarı" / "İşlem Tutarı" — çıplak "Tutar" kabul
    const m = line.match(MAIN_TRANSFER_AMOUNT_RE);
    if (m) {
      const n = parseTrAmountToken(m[1]);
      if (Number.isFinite(n) && Math.abs(n) > 0) {
        // "Masraf Tutarı" FEE_RE ile zaten elendi; burada ana tutar
        if (/havale|transfer|i[sş]lem/i.test(line) || /^tutar/i.test(line.trim())) {
          main = Math.abs(n);
          mainLabel = /havale|transfer|i[sş]lem/i.test(line)
            ? "labeled_transfer_amount"
            : "labeled_tutar";
        }
      }
    }
  }

  // Yapısal: etiketli tutar yoksa — ücret satırları dışındaki tek net "… Tutarı" dene
  if (!Number.isFinite(main)) {
    for (const line of lines) {
      if (FEE_OR_CHARGE_LINE_RE.test(line)) continue;
      if (!/havale\s*tutar|transfer\s*tutar|i[sş]lem\s*tutar/i.test(line)) continue;
      for (const tok of extractAmounts(line)) {
        const n = parseTrAmountToken(tok);
        if (Number.isFinite(n) && Math.abs(n) > 0) {
          main = Math.abs(n);
          mainLabel = "structural_transfer_label";
          break;
        }
      }
      if (Number.isFinite(main)) break;
    }
  }

  return {
    amount: main,
    label: mainLabel,
    feeCandidates,
    // P0: fee/BSMV ayrı hareket üretilmez — yalnız teşhis
    feeMovementsAuto: false,
  };
}

function sourceTypeOf(context = {}) {
  return (
    context.sourceType ||
    (context.ocrUsed ? BANK_STATEMENT_SOURCE.PDF_OCR : BANK_STATEMENT_SOURCE.PDF)
  );
}

/**
 * Kanonik model: debit_amount=GIRIS, credit_amount=CIKIS (Excel normalize ile aynı).
 * Ziraat ekstre ham kolonları tersine: Borç=para çıkışı, Alacak=para girişi.
 */
function signedFromZiraatBankColumns(bankBorc = 0, bankAlacak = 0, fallbackSigned = 0) {
  const b = Math.abs(Number(bankBorc) || 0);
  const a = Math.abs(Number(bankAlacak) || 0);
  if (b > 0 && a === 0) return -b; // CIKIS
  if (a > 0 && b === 0) return a; // GIRIS
  if (Number.isFinite(Number(fallbackSigned)) && Number(fallbackSigned) !== 0) {
    return Number(fallbackSigned);
  }
  return 0;
}

function pushTx(out, partial, context) {
  const explicitDir = String(partial.direction || "").toUpperCase();
  let signed = Number(partial.signed);
  if (explicitDir !== "UNKNOWN") {
    if (!Number.isFinite(signed) || signed === 0) {
      signed = signedFromZiraatBankColumns(partial.bankBorc, partial.bankAlacak, 0);
    }
    if (!Number.isFinite(signed) || signed === 0) return false;
  } else {
    const abs =
      Math.abs(Number(partial.amountAbs)) ||
      Math.abs(Number(partial.signed)) ||
      Math.abs(Number(partial.bankBorc)) ||
      Math.abs(Number(partial.bankAlacak)) ||
      0;
    if (!abs) return false;
    signed = abs; // unsigned placeholder; direction stays UNKNOWN
  }

  const description = normalizeSpaces(partial.description || "");
  if (!description || description.length < 2) return false;
  const transactionDate = normalizeDateToken(partial.transactionDate || "");
  if (!transactionDate) return false;

  const direction =
    explicitDir === "UNKNOWN"
      ? "UNKNOWN"
      : signed < 0
        ? "CIKIS"
        : "GIRIS";
  const abs = Math.abs(signed);
  const reviewReason = partial.reviewReason || "";
  const reviewRequired =
    Boolean(context.forceReview) ||
    direction === "UNKNOWN" ||
    Boolean(reviewReason) ||
    Boolean(partial.reviewRequired);

  out.push(
    createCanonicalBankTransaction({
      companyId: context.companyId,
      bank: "ZIRAAT",
      accountIdentity: partial.accountIdentity || context.accountIdentity || "",
      transactionDate,
      valueDate: normalizeDateToken(partial.valueDate || "") || transactionDate,
      description,
      amount: direction === "CIKIS" ? -abs : abs,
      debit_amount: direction === "GIRIS" ? abs : 0,
      credit_amount: direction === "CIKIS" ? abs : 0,
      direction,
      balance:
        partial.balance === null || partial.balance === undefined
          ? null
          : Number.isFinite(Number(partial.balance))
            ? Number(partial.balance)
            : null,
      currency: context.currency || "TRY",
      sourceRow: partial.sourceRow || 0,
      sourcePage: partial.sourcePage || 1,
      sourceFileHash: context.sourceFileHash,
      sourceType: sourceTypeOf(context),
      documentNo: partial.documentNo || "",
      parseWarnings: partial.parseWarnings || [],
      reviewRequired,
      reviewReason,
    })
  );
  return true;
}

/**
 * Dekont: label:value alanlarından tek hareket.
 * Yön sahiplik kanıtı olmadan tahmin edilmez; tutar masraf/BSMV ile karıştırılmaz.
 */
export function parseZiraatDekontFromText(text = "", context = {}) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(normalizeSpaces)
    .filter(Boolean);
  const joined = lines.join("\n");
  const warnings = [];
  const documentType = BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT;
  const diagnostics = {
    layout: "ziraat_dekont",
    documentType,
    detectedBank: "ZIRAAT",
    parserMode: "ziraat_dekont",
    skipped: [],
    feeCandidates: [],
  };

  if (!looksLikeZiraatDekont(joined) && !looksLikeZiraatBrand(joined)) {
    return {
      transactions: [],
      warnings,
      diagnostics: {
        ...diagnostics,
        documentType: BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT,
        transactionCount: 0,
      },
      bank: "ZIRAAT",
      documentType: BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT,
    };
  }

  let transactionDate = "";
  let valueDate = "";
  let description = "";
  let documentNo = "";

  const title = lines.find(
    (l) =>
      /hesaptan|hesaba|havale|virman|eft|vergi|ödeme|odeme|dekont/i.test(l) &&
      !/alacakl[ıi]|g[oö]nderen|al[iı]c[iı]/i.test(l)
  );
  if (title) description = title;

  for (const line of lines) {
    const valor = line.match(/val[oö]r\s*:?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i);
    if (valor) valueDate = normalizeDateToken(valor[1]);

    const islem = line.match(
      /(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\s*[-–]?\s*\d{1,2}:\d{2}/
    );
    if (islem && !transactionDate) transactionDate = normalizeDateToken(islem[1]);

    const fis = line.match(/\b(F\d{4,}|AP\s*\d+)\b/i);
    if (fis) documentNo = fis[1].replace(/\s+/g, "");

    const acik = line.match(/a[cç][iı]klama\s*:\s*(.+)$/i);
    if (acik) {
      description = [description, acik[1]].filter(Boolean).join(" — ");
    }
  }

  const amountInfo = extractZiraatReceiptMainAmount(lines);
  diagnostics.feeCandidates = amountInfo.feeCandidates;
  let amount = amountInfo.amount;

  if (!transactionDate) transactionDate = valueDate;
  if (!transactionDate) {
    const anyDate = joined.match(DATE_RE);
    if (anyDate) transactionDate = formatDate(anyDate[1], anyDate[2], anyDate[3]);
  }

  if (!Number.isFinite(amount) || amount === 0) {
    diagnostics.skipped.push({ code: "dekont_amount_missing" });
    warnings.push({ row: 0, code: "dekont_amount_missing" });
    return {
      transactions: [],
      warnings,
      diagnostics: { ...diagnostics, transactionCount: 0 },
      bank: "ZIRAAT",
      documentType,
    };
  }
  if (!transactionDate) {
    diagnostics.skipped.push({ code: "dekont_date_missing" });
    warnings.push({ row: 0, code: "dekont_date_missing" });
    return {
      transactions: [],
      warnings,
      diagnostics: { ...diagnostics, transactionCount: 0 },
      bank: "ZIRAAT",
      documentType,
    };
  }

  const ownership = resolveZiraatReceiptDirection({ text: joined, context });
  let direction = ownership.direction;
  let reviewReason = ownership.reviewReason || "";
  let reviewRequired = !ownership.certain;

  if (ownership.certain && ownership.counterpartyUnresolved) {
    reviewRequired = true;
    reviewReason = reviewReason || COUNTERPARTY_UNRESOLVED;
  }

  const isCikis = direction === "CIKIS";
  const isUnknown = direction === "UNKNOWN";
  const signed = isUnknown ? amount : isCikis ? -amount : amount;
  const out = [];
  pushTx(
    out,
    {
      transactionDate,
      valueDate: valueDate || transactionDate,
      description: description || "Ziraat dekont",
      signed,
      amountAbs: amount,
      direction,
      bankBorc: isCikis ? amount : 0,
      bankAlacak: !isCikis && !isUnknown ? amount : 0,
      balance: null,
      documentNo,
      accountIdentity: "",
      sourceRow: 1,
      sourcePage: 1,
      reviewRequired,
      reviewReason,
      parseWarnings: reviewReason ? [reviewReason] : [],
    },
    {
      ...context,
      forceReview: reviewRequired || context.forceReview,
      accountIdentity: ownership.bankGlHint || context.accountIdentity || "",
    }
  );

  diagnostics.parsed = out.length;
  diagnostics.transactionCount = out.length;
  diagnostics.directionResolution = {
    direction,
    certain: ownership.certain,
    role: ownership.role,
    matchedVia: ownership.matchedVia,
    note: ownership.note || "",
  };
  diagnostics.accountOwnershipEvidence = ownership.accountOwnershipEvidence || [];
  diagnostics.balanceEvidence = "none";
  diagnostics.reviewReason = reviewReason || (out[0]?.reviewReason || "");
  diagnostics.bankGlHint = ownership.bankGlHint || "";
  diagnostics.amountLabel = amountInfo.label;
  diagnostics.outputGateClosed = true; // dekont: bakiye kanıtı yok → OUTPUT_READY yok

  return {
    transactions: out,
    warnings,
    diagnostics,
    bank: "ZIRAAT",
    documentType,
    reviewRequired: reviewRequired || out.some((t) => t.reviewRequired),
    reviewReason: diagnostics.reviewReason,
  };
}

function classifyHeaderToken(text = "") {
  const t = normalizeSpaces(text);
  if (!t) return null;
  for (const [key, re] of STATEMENT_HEADER_KEYS) {
    if (re.test(t)) return key;
  }
  return null;
}

function clusterRows(items = []) {
  const mapped = (items || [])
    .filter((it) => it && typeof it.str === "string" && normalizeSpaces(it.str))
    .map((it) => ({
      str: normalizeSpaces(it.str),
      x: Number(it.x) || 0,
      y: Number(it.y) || 0,
      w: Number(it.w) || Math.max(4, String(it.str || "").length * 4),
      h: Number(it.h) || 10,
    }));
  mapped.sort((a, b) => (Math.abs(a.y - b.y) < 1.5 ? a.x - b.x : b.y - a.y));
  const rows = [];
  let cur = null;
  for (const it of mapped) {
    const band = Math.max(5.5, (cur?.h || it.h) * 0.7);
    if (!cur || Math.abs(it.y - cur.y) > band) {
      if (cur) {
        cur.cells.sort((a, b) => a.x - b.x);
        rows.push(cur);
      }
      cur = { y: it.y, h: it.h, cells: [it] };
    } else {
      cur.cells.push(it);
      const n = cur.cells.length;
      cur.y = (cur.y * (n - 1) + it.y) / n;
      cur.h = (cur.h * (n - 1) + it.h) / n;
    }
  }
  if (cur) {
    cur.cells.sort((a, b) => a.x - b.x);
    rows.push(cur);
  }
  return rows;
}

function detectColumnMap(rows = []) {
  for (const row of rows.slice(0, 40)) {
    const labeled = [];
    for (const cell of row.cells) {
      const key = classifyHeaderToken(cell.str);
      if (key) labeled.push({ key, x: cell.x + cell.w / 2 });
    }
    const keys = new Set(labeled.map((l) => l.key));
    const score =
      (keys.has("muh_tarih") || keys.has("valor") ? 2 : 0) +
      (keys.has("borc") && keys.has("alacak") ? 3 : 0) +
      (keys.has("bakiye") ? 1 : 0) +
      (keys.has("aciklama") ? 1 : 0) +
      (keys.has("fis") ? 1 : 0);
    if (score >= 3 && labeled.length >= 3) {
      return { columns: labeled, headerY: row.y };
    }
  }
  return null;
}

function assignCellsToColumns(cells, columns) {
  const bucket = Object.create(null);
  for (const col of columns) bucket[col.key] = [];
  const other = [];
  for (const cell of cells) {
    let best = null;
    let bestDist = Infinity;
    for (const col of columns) {
      const dist = Math.abs(cell.x + cell.w / 2 - col.x);
      if (dist < bestDist) {
        bestDist = dist;
        best = col.key;
      }
    }
    // Geniş açıklama kolonu: uzak hücreler other'a
    const maxDist = best === "aciklama" ? 90 : 55;
    if (!best || bestDist > maxDist) other.push(cell);
    else bucket[best].push(cell);
  }
  const joined = {};
  for (const [k, arr] of Object.entries(bucket)) {
    joined[k] = normalizeSpaces(arr.map((c) => c.str).join(" "));
  }
  joined._other = normalizeSpaces(other.map((c) => c.str).join(" "));
  return joined;
}

function parseAmountField(raw) {
  if (raw == null || raw === "") return 0;
  const t = normalizeSpaces(raw);
  if (!t || t === "-" || t === "–" || t === "—") return 0;
  const toks = extractAmounts(t);
  if (!toks.length) return 0;
  const n = parseTrAmountToken(toks[toks.length - 1]);
  return Number.isFinite(n) ? n : 0;
}

function isHeaderRepeatRow(joined) {
  const vals = Object.values(joined).filter((v) => typeof v === "string");
  const hit = vals.filter((v) => classifyHeaderToken(v)).length;
  return hit >= 2;
}

/**
 * pdfjs item koordinatlarıyla Ziraat ekstre tablosu.
 */
export function parseZiraatStatementFromItems(pagesItems = [], context = {}) {
  const warnings = [];
  const diagnostics = {
    layout: "ziraat_statement_coords",
    skipped: [],
    headerFound: false,
    pageCount: 0,
  };
  const out = [];
  let current = null;
  let sourceRow = 0;

  const pages = Array.isArray(pagesItems) ? pagesItems : [];
  diagnostics.pageCount = pages.length;

  for (const page of pages) {
    const pageNum = Number(page.page || page.pageNum || 1) || 1;
    const rows = clusterRows(page.items || []);
    const map = detectColumnMap(rows);
    if (!map) {
      diagnostics.skipped.push({ page: pageNum, code: "header_not_found" });
      continue;
    }
    diagnostics.headerFound = true;
    const { columns } = map;
    let seenHeader = false;

    for (const row of rows) {
      const joined = assignCellsToColumns(row.cells, columns);
      const lineText = normalizeSpaces(row.cells.map((c) => c.str).join(" "));
      if (!lineText) continue;
      if (FOOTER_RE.test(lineText) || SUBTOTAL_RE.test(lineText)) continue;
      if (isHeaderRepeatRow(joined) || looksLikeZiraatStatementHeader(lineText)) {
        seenHeader = true;
        continue;
      }
      if (!seenHeader && row.y > map.headerY - 2) {
        // başlık üstü meta
        continue;
      }

      let date = normalizeDateToken(joined.muh_tarih || "");
      if (!date) {
        const cellDate = row.cells.map((c) => c.str).find((s) => DATE_ONLY_RE.test(s));
        if (cellDate) date = normalizeDateToken(cellDate);
      }

      const valor = normalizeDateToken(joined.valor || "") || date;
      const borc = parseAmountField(joined.borc);
      const alacak = parseAmountField(joined.alacak);
      let tutar = parseAmountField(joined.tutar);
      const bakiyeRaw = joined.bakiye;
      const hasBakiyeToken =
        bakiyeRaw != null && String(bakiyeRaw).trim() !== "" && extractAmounts(bakiyeRaw).length > 0;
      const bakiye = hasBakiyeToken ? parseAmountField(bakiyeRaw) : null;

      // B/A kolonu
      if (!borc && !alacak && tutar && joined.ba) {
        const ba = joined.ba.toLocaleLowerCase("tr-TR");
        if (/^b|bor/.test(ba)) {
          // borç
        } else if (/^a|ala/.test(ba)) {
          tutar = -Math.abs(tutar);
        }
      }

      sourceRow += 1;

      if (date) {
        if (current) {
          flushStatementMovement(out, current, context, warnings, diagnostics);
        }
        let bankBorc = borc;
        let bankAlacak = alacak;
        let signed = signedFromZiraatBankColumns(bankBorc, bankAlacak, 0);
        if (!signed && tutar) {
          // B/A veya tek tutar: pozitif varsayılan GIRIS; ba=B → CIKIS
          const ba = String(joined.ba || "").toLocaleLowerCase("tr-TR");
          if (/^b|bor/.test(ba)) signed = -Math.abs(tutar);
          else if (/^a|ala/.test(ba)) signed = Math.abs(tutar);
          else signed = tutar;
          if (signed < 0) {
            bankBorc = Math.abs(signed);
            bankAlacak = 0;
          } else {
            bankAlacak = Math.abs(signed);
            bankBorc = 0;
          }
        }
        // Açıklama satırı çoğu zaman bir alt satırda; isl_kd'yi şimdilik tutma
        const descMain = normalizeSpaces(
          [joined.aciklama, joined._other]
            .filter(Boolean)
            .join(" ")
        );
        current = {
          transactionDate: date,
          valueDate: valor,
          description: descMain,
          bankBorc,
          bankAlacak,
          signed,
          balance: bakiye,
          documentNo: joined.fis || "",
          pendingKod: joined.isl_kd || "",
          sourceRow,
          sourcePage: pageNum,
        };
      } else if (current) {
        // Çok satırlı açıklama / taşan kolon — tarihsiz satır
        const contBits = [
          joined.aciklama,
          joined.isl_kd,
          joined.muh_tarih,
          joined.valor,
          joined.sube,
          joined.fis,
          joined._other,
        ]
          .map(normalizeSpaces)
          .filter(Boolean)
          .filter((s) => !DATE_ONLY_RE.test(s) && !classifyHeaderToken(s));
        const cont = normalizeSpaces(contBits.join(" "));
        if (cont) current.description = normalizeSpaces(`${current.description} ${cont}`);
        if (!current.bankBorc && borc) current.bankBorc = borc;
        if (!current.bankAlacak && alacak) current.bankAlacak = alacak;
        if (current.balance == null && bakiye != null) current.balance = bakiye;
        if (!current.documentNo && joined.fis) current.documentNo = joined.fis;
        if (!current.signed) {
          current.signed = signedFromZiraatBankColumns(
            current.bankBorc,
            current.bankAlacak,
            0
          );
        }
      } else {
        if (/a[cç][iı]klama/i.test(lineText) && !extractAmounts(lineText).length) {
          continue;
        }
        diagnostics.skipped.push({
          page: pageNum,
          row: sourceRow,
          code: "orphan_row",
        });
        warnings.push({ row: sourceRow, code: "orphan_row" });
      }
    }
  }

  if (current) flushStatementMovement(out, current, context, warnings, diagnostics);
  diagnostics.parsed = out.length;
  return { transactions: out, warnings, diagnostics, bank: "ZIRAAT" };
}

function flushStatementMovement(out, current, context, warnings, diagnostics) {
  if (current.pendingKod && !current.description) {
    current.description = current.pendingKod;
  } else if (current.pendingKod && current.description) {
    // kod zaten açıklamada yoksa ekleme — açıklama yeterli
  }
  let signed = Number(current.signed);
  if (!Number.isFinite(signed) || signed === 0) {
    signed = signedFromZiraatBankColumns(current.bankBorc, current.bankAlacak, 0);
  }
  if (!Number.isFinite(signed) || signed === 0) {
    diagnostics.skipped.push({
      page: current.sourcePage,
      row: current.sourceRow,
      code: "amount_unparsed",
    });
    warnings.push({ row: current.sourceRow, code: "amount_unparsed" });
    return false;
  }
  const ok = pushTx(
    out,
    {
      ...current,
      signed,
      // 0,00 bakiye → 0 (null değil)
      balance: current.balance,
    },
    context
  );
  if (!ok) {
    diagnostics.skipped.push({
      page: current.sourcePage,
      row: current.sourceRow,
      code: "tx_rejected",
    });
    warnings.push({ row: current.sourceRow, code: "tx_rejected" });
  }
  return ok;
}

/**
 * Metin satırı yolu — koordinat yoksa (fixture / latin1).
 * Yeni tarih = yeni hareket; tarihsiz satırlar açıklamaya bağlanır.
 */
export function parseZiraatStatementFromText(text = "", context = {}) {
  const warnings = [];
  const diagnostics = { layout: "ziraat_statement_text", skipped: [] };
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(normalizeSpaces)
    .filter(Boolean);

  if (!looksLikeZiraatStatementHeader(lines.join("\n")) && !looksLikeZiraatBrand(lines.join("\n"))) {
    return { transactions: [], warnings, diagnostics, bank: "ZIRAAT" };
  }

  const out = [];
  let current = null;
  let page = 1;
  let sourceRow = 0;
  let headerSeen = false;

  for (const line of lines) {
    const pageMark = line.match(PAGE_MARK_RE);
    if (pageMark) {
      page = Number(pageMark[1]) || page;
      continue;
    }
    if (FOOTER_RE.test(line) || SUBTOTAL_RE.test(line)) continue;
    if (looksLikeZiraatStatementHeader(line) || /muh\.?\s*tarih|bor[cç].*alacak/i.test(line)) {
      headerSeen = true;
      continue;
    }
    if (!headerSeen && looksLikeZiraatBrand(line)) continue;

    sourceRow += 1;
    const dateMatch = line.match(/^(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b(.*)$/);
    if (dateMatch) {
      if (current) flushStatementMovement(out, current, context, warnings, diagnostics);
      const rest = dateMatch[2] || "";
      const amounts = extractAmounts(rest).map(parseTrAmountToken).filter((n) => Number.isFinite(n));
      let description = rest;
      for (const tok of extractAmounts(rest)) description = description.replace(tok, " ");
      description = normalizeSpaces(
        description.replace(/\b(B|A|Bor[cç]|Alacak)\b/gi, " ")
      );

      let bankBorc = 0;
      let bankAlacak = 0;
      let balance = null;
      let signed = 0;
      if (amounts.length >= 3) {
        bankBorc = amounts[0] !== 0 ? Math.abs(amounts[0]) : 0;
        bankAlacak = amounts[1] !== 0 ? Math.abs(amounts[1]) : 0;
        balance = amounts[2]; // 0,00 → 0
        signed = signedFromZiraatBankColumns(bankBorc, bankAlacak, 0);
      } else if (amounts.length === 2) {
        // borç+alacak (biri 0) veya tutar+bakiye
        if (amounts[0] === 0 && amounts[1] !== 0) {
          bankAlacak = Math.abs(amounts[1]);
          signed = bankAlacak;
        } else if (amounts[1] === 0 && amounts[0] !== 0) {
          bankBorc = Math.abs(amounts[0]);
          signed = -bankBorc;
        } else {
          signed = amounts[0];
          balance = amounts[1];
          if (signed >= 0) bankAlacak = Math.abs(signed);
          else bankBorc = Math.abs(signed);
        }
      } else if (amounts.length === 1) {
        signed = amounts[0];
        if (signed >= 0) bankAlacak = Math.abs(signed);
        else bankBorc = Math.abs(signed);
      }

      // Valor ikinci tarih token
      const dates = [...rest.matchAll(DATE_RE_G)];
      const valor =
        dates.length >= 1 ? formatDate(dates[0][1], dates[0][2], dates[0][3]) : dateMatch[1];

      current = {
        transactionDate: normalizeDateToken(dateMatch[1]),
        valueDate: normalizeDateToken(valor),
        description,
        bankBorc,
        bankAlacak,
        signed,
        balance,
        documentNo: "",
        sourceRow,
        sourcePage: page,
      };
    } else if (current) {
      const amts = extractAmounts(line).map(parseTrAmountToken).filter((n) => Number.isFinite(n));
      let desc = line;
      for (const tok of extractAmounts(line)) desc = desc.replace(tok, " ");
      desc = normalizeSpaces(desc);
      if (desc && !FOOTER_RE.test(desc)) {
        current.description = normalizeSpaces(`${current.description} ${desc}`);
      }
      if (amts.length && current.balance == null) {
        if (!current.signed && amts.length >= 1) {
          if (amts.length >= 3) {
            current.bankBorc = amts[0] !== 0 ? Math.abs(amts[0]) : 0;
            current.bankAlacak = amts[1] !== 0 ? Math.abs(amts[1]) : 0;
            current.balance = amts[2];
            current.signed = signedFromZiraatBankColumns(
              current.bankBorc,
              current.bankAlacak,
              0
            );
          } else if (amts.length === 2) {
            current.signed = amts[0];
            current.balance = amts[1];
          } else {
            current.signed = amts[0];
          }
        } else if (current.balance == null && amts.length === 1) {
          current.balance = amts[0];
        }
      }
    } else {
      diagnostics.skipped.push({ row: sourceRow, code: "orphan_row" });
      warnings.push({ row: sourceRow, code: "orphan_row" });
    }
  }

  if (current) flushStatementMovement(out, current, context, warnings, diagnostics);
  diagnostics.parsed = out.length;
  return { transactions: out, warnings, diagnostics, bank: "ZIRAAT" };
}

/**
 * Ana giriş: item koordinatları varsa tablo; değilse metin; dekont son çare.
 * documentType açıkça ayrılır — dekont ekstreyi taklit etmez.
 */
export function parseZiraatPdfLayout({ text = "", pagesItems = null, context = {} } = {}) {
  const warnings = [];
  const diagnostics = { attempts: [], detectedBank: "ZIRAAT" };
  const body = String(text || "");
  const classified = classifyZiraatPdfDocument(body);

  const enrich = (parsed, winner, documentType) => {
    const txs = parsed.transactions || [];
    const baseDiag = parsed.diagnostics || {};
    const merged = {
      ...diagnostics,
      ...baseDiag,
      attempts: [...diagnostics.attempts, baseDiag],
      winner,
      documentType,
      detectedBank: "ZIRAAT",
      parserMode: baseDiag.parserMode || baseDiag.layout || winner,
      transactionCount: txs.length,
      directionResolution:
        baseDiag.directionResolution ||
        (documentType === BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT
          ? { mode: "statement_borc_alacak" }
          : undefined),
      accountOwnershipEvidence: baseDiag.accountOwnershipEvidence || [],
      balanceEvidence:
        baseDiag.balanceEvidence ||
        (documentType === BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT
          ? "none"
          : "statement_running_or_hints"),
      reviewReason: baseDiag.reviewReason || parsed.reviewReason || "",
      outputGateClosed:
        documentType === BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT ||
        Boolean(baseDiag.outputGateClosed),
    };
    return {
      transactions: txs,
      warnings: [...warnings, ...(parsed.warnings || [])],
      diagnostics: merged,
      bank: "ZIRAAT",
      documentType,
      reviewRequired: Boolean(parsed.reviewRequired) || txs.some((t) => t.reviewRequired),
      reviewReason: merged.reviewReason,
    };
  };

  // Dekont önceliği: sınıflandırma dekont ise tabloya zorlamayız
  if (classified === BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT) {
    const dekont = parseZiraatDekontFromText(body, context);
    diagnostics.attempts.push(dekont.diagnostics);
    if ((dekont.transactions || []).length) {
      return enrich(dekont, "dekont", BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT);
    }
    warnings.push(...(dekont.warnings || []));
  }

  if (pagesItems && pagesItems.length) {
    const fromItems = parseZiraatStatementFromItems(pagesItems, context);
    diagnostics.attempts.push(fromItems.diagnostics);
    if ((fromItems.transactions || []).length) {
      return enrich(fromItems, "statement_coords", BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT);
    }
    warnings.push(...(fromItems.warnings || []));
  }

  if (
    classified === BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT ||
    looksLikeZiraatStatementHeader(body) ||
    /muh\.?\s*tarih/i.test(body)
  ) {
    const fromText = parseZiraatStatementFromText(body, context);
    diagnostics.attempts.push(fromText.diagnostics);
    if ((fromText.transactions || []).length) {
      return enrich(fromText, "statement_text", BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT);
    }
    warnings.push(...(fromText.warnings || []));
  }

  if (
    classified !== BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT &&
    (looksLikeZiraatDekont(body) || looksLikeZiraatBrand(body))
  ) {
    const dekont = parseZiraatDekontFromText(body, context);
    diagnostics.attempts.push(dekont.diagnostics);
    if ((dekont.transactions || []).length) {
      return enrich(dekont, "dekont", BANK_PDF_DOCUMENT_TYPE.BANK_TRANSFER_RECEIPT);
    }
    warnings.push(...(dekont.warnings || []));
  }

  return {
    transactions: [],
    warnings,
    diagnostics: {
      ...diagnostics,
      winner: null,
      documentType: classified,
      detectedBank: "ZIRAAT",
      parserMode: null,
      transactionCount: 0,
      directionResolution: null,
      accountOwnershipEvidence: [],
      balanceEvidence: "none",
      reviewReason: "",
    },
    bank: "ZIRAAT",
    documentType: classified,
  };
}
