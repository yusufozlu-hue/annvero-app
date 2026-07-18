/**
 * Virman / BANK_INTERNAL_TRANSFER motoru V1 (regresyon-düzeltmeli).
 *
 * Kesin virman: karşı tarafın kendi banka hesabı kesin + 102↔102 çözülebilir.
 * Virman adayı: soft sinyaller (maskeli ekstre IBAN + unvan vb.) — otomatik
 * BANKA_ICI_VIRMAN fişi yok; 120/320 kendi firma cari’si uygulanmaz.
 */

import {
  normalizeCariName,
  normalizeCariNameCore,
} from "@/src/utils/cariAccountMatcher";
import {
  buildOwnCompanyIdentity,
  extractTransferCounterparty,
  isOwnCompanyPartyName,
} from "@/src/utils/cariCounterpartyExtract";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { resolve102BankAccount } from "@/src/utils/companyCenter";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const BANK_INTERNAL_TRANSFER = "BANK_INTERNAL_TRANSFER";
export const BANKA_ICI_VIRMAN_TYPE = "BANKA_ICI_VIRMAN";

/** @typedef {"none"|"candidate"|"definite"} VirmanStatus */
export const VIRMAN_STATUS = {
  NONE: "none",
  CANDIDATE: "candidate",
  DEFINITE: "definite",
};

export const VIRMAN_CANDIDATE_LABEL =
  "Virman adayı — karşı banka hesabı tanımlanmalı";

const VIRMAN_TYPE_SET = new Set([
  "BANKA_ICI_VIRMAN",
  "BANKALAR_ARASI_VIRMAN",
  "VIRMAN",
  "BANK_INTERNAL_TRANSFER",
]);

export const OWN_VIRMAN_KEYWORD_RE =
  /\b(VIRMAN|VİRMAN|HESAPLAR\s+ARASI|ACCOUNT\s+TRANSFER|BANKA\s+ICI|BANKA\s+İÇİ|KENDI\s+HESAB|KENDİ\s+HESAB|IC\s+TRANSFER|İÇ\s+TRANSFER)\b/i;

export const VIRMAN_RECLASS_PROTECTED_TYPES = new Set([
  "BANKA_MASRAFI",
  "BSMV",
  "KREDI_KARTI_ODEMESI",
  "POS_TAHSILAT",
  "POS_BATCH_TAHSILAT",
  "POS_KOMISYON",
  "POS_IADE",
  "POS_BLOKE",
  "POS_SANAL",
  "POS_COZUM",
  "POS_ERTESI_GUN",
  "CEK_ODEMESI",
  "CEK_TAHSILATI",
  "SGK_ODEMESI",
  "GELIR_VERGISI",
  "KDV2",
  "MUHTASAR",
  "STOPAJ",
  "DAMGA_VERGISI",
  "TURIZM_PAYI",
  "BELEDIYE_VERGISI",
  "TRAFIK_CEZASI",
  "VERGI_CEZASI",
]);

function isVirmanTypeLocal(transactionType = "") {
  return VIRMAN_TYPE_SET.has(String(transactionType || ""));
}

function compactCode(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
}

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeIban(value = "") {
  return normalizeParserText(value).replace(/\s+/g, "").toUpperCase();
}

function bankLuca(bank) {
  return compactCode(bank?.lucaAccountCode || "");
}

/**
 * Açıklama + yapılandırılmış karşı hesap alanları.
 * Satırdaki ekstre `iban` / `hesapNo` kanıt değildir (Vakıf parser kopyası).
 */
export function collectTransferEvidenceText(row = {}, extraDescription = "") {
  const parts = [
    extraDescription,
    row.detayAciklama,
    row.fisAciklama,
    row.aciklama,
    row.description,
    row.karsiIban,
    row.counterpartyIban,
    row.karsiHesapNo,
    row.counterAccountNumber,
    row.karsiMusteriNo,
    row.counterpartyCustomerNumber,
    row.unvan,
    row.cariUnvan,
    row.karsiHesap,
    row.bankRef,
    row.bankReferans,
    row.referans,
  ];
  return parts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function buildStatementAccountIgnoreSets(ownCtx = null) {
  const ignoreIbans = new Set();
  const ignoreAccountDigits = new Set();
  const ignoreIbanTails = new Set();
  if (!ownCtx) {
    return { ignoreIbans, ignoreAccountDigits, ignoreIbanTails };
  }

  const selected = normalizeParserText(ownCtx.selectedBank || "");
  const banks = ownCtx.banks || [];

  const matchesSelectedBank = (bank) => {
    if (!selected) return banks.length === 1;
    const name = normalizeParserText(
      bank?.bankName || bank?.name || bank?.accountName || ""
    );
    if (!name) return false;
    if (name.includes(selected) || selected.includes(name)) return true;
    if (selected.includes("VAKIF") && name.includes("VAKIF")) return true;
    if (selected.includes("GARANTI") && name.includes("GARANTI")) return true;
    if (selected.includes("ZIRAAT") && name.includes("ZIRAAT")) return true;
    if (selected.includes("TEB") && name.includes("TEB")) return true;
    if (selected.includes("KUVEYT") && name.includes("KUVEYT")) return true;
    return false;
  };

  let statementBanks = banks.filter(matchesSelectedBank);
  if (!statementBanks.length && banks.length === 1) {
    statementBanks = banks;
  }

  for (const bank of statementBanks) {
    const iban = normalizeIban(bank.iban || "");
    if (iban.length >= 15) {
      ignoreIbans.add(iban);
      const d = digitsOnly(iban);
      if (d.length >= 10) {
        ignoreIbanTails.add(d.slice(-10));
        ignoreIbanTails.add(d.slice(-16));
      }
    }
    for (const raw of [bank.accountNumber, bank.hesapNo, bank.accountNo]) {
      const dig = digitsOnly(raw || "");
      if (dig.length >= 5) ignoreAccountDigits.add(dig);
    }
  }

  return { ignoreIbans, ignoreAccountDigits, ignoreIbanTails };
}

export function extractIbansFromText(text = "") {
  const compact = normalizeIban(text);
  const matches = compact.match(/TR\d{24}/g) || [];
  return [...new Set(matches)];
}

export function isProtectedFromVirmanReclass(transactionType = "") {
  const t = String(transactionType || "");
  if (VIRMAN_RECLASS_PROTECTED_TYPES.has(t)) return true;
  if (/MASRAF|BSMV|KOMISYON|POS_|VERGI|SGK|CEK_/.test(t)) return true;
  return false;
}

export function createOwnAccountVirmanContext(
  selectedCompany = null,
  selectedBank = ""
) {
  const company = selectedCompany || {};
  const banks = (company.bankAccounts || []).filter(
    (b) => b?.isActive !== false
  );
  const cards = (company.creditCards || []).filter(
    (c) => c?.isActive !== false
  );
  const companyName = getCompanyDisplayName(company);
  const companyNameNorm = normalizeCariName(companyName);
  const companyNameCore = normalizeCariNameCore(companyName);

  const ibans = new Set();
  const ibanTails = new Map();
  const accountNumbers = [];
  const customerNumbers = [];
  const lucaCodes = [];
  const banksByIban = new Map();

  for (const bank of banks) {
    const iban = normalizeIban(bank.iban || "");
    if (iban.length >= 15) {
      ibans.add(iban);
      banksByIban.set(iban, bank);
      const d = digitsOnly(iban);
      if (d.length >= 10) {
        ibanTails.set(d.slice(-10), bank);
        ibanTails.set(d.slice(-16), bank);
      }
    }
    const accNo = compactCode(
      bank.accountNumber || bank.hesapNo || bank.accountNo || ""
    );
    if (accNo.length >= 5) {
      accountNumbers.push({ value: accNo, digits: digitsOnly(accNo), bank });
    }
    const cust = compactCode(
      bank.customerNumber ||
        bank.musteriNo ||
        bank.musteriNumarasi ||
        bank.customerNo ||
        ""
    );
    if (cust.length >= 4) {
      customerNumbers.push({ value: cust, digits: digitsOnly(cust), bank });
    }
    const luca = compactCode(bank.lucaAccountCode || "");
    if (luca.startsWith("102")) lucaCodes.push({ luca, bank });
  }

  const cardTokens = [];
  for (const card of cards) {
    const last4 = String(
      card.last4 || card.cardLast4 || card.lastFourDigits || card.number || ""
    ).replace(/\D/g, "");
    if (last4.length >= 4) cardTokens.push(last4.slice(-4));
  }

  return {
    company,
    companyName,
    companyNameNorm,
    companyNameCore,
    ibans,
    ibanTails,
    accountNumbers,
    customerNumbers,
    lucaCodes,
    banksByIban,
    banks,
    cards,
    cardTokens,
    selectedBank: String(selectedBank || "").trim(),
  };
}

function resolveOwnAccountContext(context = {}) {
  if (context.ownAccountContext) return context.ownAccountContext;
  if (context.selectedCompany || context.company) {
    return createOwnAccountVirmanContext(
      context.selectedCompany || context.company,
      context.selectedBank
    );
  }
  return null;
}

function descriptionHasCompanyTitle(descNorm, ownCtx, { soft = false } = {}) {
  const core = String(ownCtx?.companyNameCore || "").trim();
  if (core.length < 5) return false;
  const hay = String(descNorm || "");
  if (hay.includes(core)) return true;
  const hayCore = normalizeCariNameCore(hay);
  if (hayCore.includes(core)) return true;
  const tokens = core.split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length < 2) return false;
  if (tokens.every((t) => hayCore.includes(t) || hay.includes(t))) return true;
  // Maskeli hesap anlatımında kısmi unvan (ekstre kırpması / ANON… kısaltması)
  if (soft) {
    const strong = tokens.filter((t) => t.length >= 4);
    const hits = strong.filter((t) => hayCore.includes(t) || hay.includes(t));
    return hits.length >= 2;
  }
  return false;
}

/**
 * Maskeli ekstre IBAN (TR82 0001 5001 58** **** **84 49) veya
 * baş/son parça + “nolu/hesabından” anlatımı — kesin değil.
 */
export function hasMaskedStatementIbanInText(evidenceRaw, ownCtx) {
  if (!ownCtx) return false;
  const ignore = buildStatementAccountIgnoreSets(ownCtx);
  const descDigits = digitsOnly(evidenceRaw);
  const text = String(evidenceRaw || "");
  const hasNarration = /nolu|hesab(i|ı|ından|indan|ına|ina)\b/i.test(text);
  const hasMaskMarker = /\*{2,}/.test(text) || /x{2,}/i.test(text);

  for (const iban of ignore.ignoreIbans || []) {
    const d = digitsOnly(iban);
    if (d.length < 16) continue;
    const head = d.slice(0, 10);
    const tail = d.slice(-4);
    if (descDigits.includes(head) && descDigits.includes(tail)) return true;
    // Maskeli ekstre (TR82 0001 5001 58** …) veya nolu anlatımı + baş parça
    if ((hasMaskMarker || hasNarration) && descDigits.includes(head)) {
      return true;
    }
  }
  return false;
}

/**
 * Unvan + ekstre hesabı anlatımı → virman adayı sinyali (unvan tek başına yetmez).
 */
export function hasOwnAccountTransferCandidateSignal(evidenceRaw, ownCtx) {
  if (!ownCtx) return false;
  const titleHit = descriptionHasCompanyTitle(
    normalizeCariName(evidenceRaw),
    ownCtx,
    { soft: true }
  );
  if (!titleHit) return false;
  if (hasMaskedStatementIbanInText(evidenceRaw, ownCtx)) return true;
  const ignore = buildStatementAccountIgnoreSets(ownCtx);
  if (
    extractIbansFromText(evidenceRaw).some((iban) =>
      ignore.ignoreIbans?.has(iban)
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Karşı taraf = başka bir kendi banka hesabı (tam IBAN veya tam hesap no).
 * Ekstre hesabı / maskeli form / müşteri no YETERSİZ.
 */
export function findDefiniteCounterOwnBank(evidenceRaw, ownCtx) {
  if (!ownCtx) return { hit: false };
  const ignore = buildStatementAccountIgnoreSets(ownCtx);
  const ignoreIbans = ignore.ignoreIbans || new Set();
  const ignoreAccountDigits = ignore.ignoreAccountDigits || new Set();
  const descCompact = normalizeParserText(evidenceRaw).replace(/\s+/g, "");
  const descDigits = digitsOnly(evidenceRaw);

  // 1) Tam TR IBAN → farklı kendi hesap
  for (const iban of extractIbansFromText(evidenceRaw)) {
    if (!ownCtx.ibans.has(iban)) continue;
    if (ignoreIbans.has(iban)) continue;
    return {
      hit: true,
      kind: "counter_own_iban",
      iban,
      bank: ownCtx.banksByIban.get(iban) || null,
    };
  }

  // 2) Yapılandırılmış karsiIban alanı zaten evidence’te; aynı döngü kapsar.
  // Tam hesap numarası (ekstre hesabı hariç) — en az 8 hane tercih
  for (const item of ownCtx.accountNumbers || []) {
    const bankIban = normalizeIban(item.bank?.iban || "");
    if (bankIban && ignoreIbans.has(bankIban)) continue;
    if (item.digits && ignoreAccountDigits.has(item.digits)) continue;
    const dig = item.digits || "";
    if (dig.length < 8) continue;
    // Tam eşleşme: digit dizisi evidence’te sınırlı geçiş (substring ama uzun)
    if (descDigits.includes(dig) || descCompact.includes(item.value)) {
      return {
        hit: true,
        kind: "counter_own_account_number",
        accountNumber: item.value,
        iban: bankIban,
        bank: item.bank,
      };
    }
  }

  return { hit: false };
}

function emptyVerdict(overrides = {}) {
  return {
    status: VIRMAN_STATUS.NONE,
    isOwnVirman: false,
    isBankInternalTransfer: false,
    isVirmanCandidate: false,
    strongEvidence: false,
    definiteEvidence: false,
    reasons: [],
    suggested102: "",
    matchedBank: null,
    matchedIban: "",
    label: "",
    ...overrides,
  };
}

/**
 * Virman değerlendirmesi — kesin / aday / yok.
 */
export function evaluateOwnAccountVirmanTransfer(row = {}, context = {}) {
  const ownCtx = resolveOwnAccountContext(context);
  const type = String(row.transactionType || context.transactionType || "");
  const evidenceRaw = collectTransferEvidenceText(row, context.extraDescription);
  const descNorm = normalizeCariName(evidenceRaw);
  const titleHit = ownCtx
    ? descriptionHasCompanyTitle(descNorm, ownCtx)
    : false;
  const titleHitSoft = ownCtx
    ? descriptionHasCompanyTitle(descNorm, ownCtx, { soft: true })
    : false;
  const virmanKeyword = OWN_VIRMAN_KEYWORD_RE.test(evidenceRaw);
  const typeIsVirman = isVirmanTypeLocal(type) || type === BANK_INTERNAL_TRANSFER;

  // Dış cari havale: “X hesabından Y hesabına” ve Y (veya X) kendi firma değil → virman değil
  const ownIdentity = buildOwnCompanyIdentity(context.selectedCompany || ownCtx?.company || null);
  if (!ownIdentity.cores.length && ownCtx?.companyNameCore) {
    ownIdentity.cores.push(ownCtx.companyNameCore);
  }
  const externalParty = extractTransferCounterparty(
    evidenceRaw,
    row.direction || context.direction || "",
    ownIdentity
  );
  if (externalParty && !isOwnCompanyPartyName(externalParty, ownIdentity)) {
    return emptyVerdict({
      reasons: ["external_counterparty_transfer"],
    });
  }

  const counter = findDefiniteCounterOwnBank(evidenceRaw, ownCtx);
  const ownAccountNarration = hasOwnAccountTransferCandidateSignal(
    evidenceRaw,
    ownCtx
  );
  const maskedStatement = ownAccountNarration;

  const reasons = [];
  let matchedBank = counter.bank || null;
  let matchedIban = counter.iban || "";

  if (counter.hit) {
    reasons.push(
      counter.kind === "counter_own_iban"
        ? "counter_own_iban"
        : "counter_own_account_number"
    );
  }

  // —— Kesin kanıt adayı: başka kendi hesap bulundu ——
  if (counter.hit && matchedBank) {
    const suggested102 = bankLuca(matchedBank);
    return {
      ...emptyVerdict({
        status: VIRMAN_STATUS.CANDIDATE, // 102 tam çözülmeden definite değil
        isVirmanCandidate: true,
        definiteEvidence: true,
        reasons,
        matchedBank,
        matchedIban,
        suggested102:
          suggested102 && suggested102.startsWith("102") ? suggested102 : "",
        label: VIRMAN_CANDIDATE_LABEL,
        classification: BANK_INTERNAL_TRANSFER,
      }),
    };
  }

  // Açık virman tipi / kelime — karşı hesap yoksa yalnız aday
  if (typeIsVirman || virmanKeyword) {
    reasons.push(typeIsVirman ? "transaction_type" : "virman_keyword");
    return {
      ...emptyVerdict({
        status: VIRMAN_STATUS.CANDIDATE,
        isVirmanCandidate: true,
        reasons,
        label: VIRMAN_CANDIDATE_LABEL,
      }),
    };
  }

  // Unvan + ekstre hesabı/maskeli IBAN anlatımı → yalnız aday
  if (maskedStatement && (titleHit || titleHitSoft)) {
    return {
      ...emptyVerdict({
        status: VIRMAN_STATUS.CANDIDATE,
        isVirmanCandidate: true,
        reasons: ["masked_statement_iban_and_title"],
        label: VIRMAN_CANDIDATE_LABEL,
      }),
    };
  }

  // Yetersiz: yalnız unvan, müşteri no, ekstre IBAN alanı, “Mare” vb.
  return emptyVerdict({
    reasons: titleHit || titleHitSoft ? ["title_only_insufficient"] : [],
  });
}

/**
 * Kaynak + hedef 102. complete yalnız iki farklı 102 ile.
 */
export function resolveVirman102Pair({
  company = null,
  selectedBank = "",
  description = "",
  direction = "",
  bankAccountCode = "",
  transactionType = "",
  row = null,
} = {}) {
  const ownCtx = createOwnAccountVirmanContext(company, selectedBank);
  const evalRow = row || {
    detayAciklama: description,
    transactionType,
  };
  const verdict = evaluateOwnAccountVirmanTransfer(evalRow, {
    ownAccountContext: ownCtx,
    selectedBank,
    extraDescription: description,
    transactionType,
  });

  const source102 =
    compactCode(bankAccountCode) ||
    resolve102BankAccount(ownCtx.banks, "102", "", selectedBank) ||
    "";

  let target102 = "";
  if (verdict.matchedBank) {
    target102 = bankLuca(verdict.matchedBank);
  }
  if (
    target102 &&
    source102 &&
    (target102 === source102 || target102 === "102")
  ) {
    target102 = "";
  }

  // İkinci kendi IBAN (kaynak dışı) ile hedefi doğrula
  if (!target102 && verdict.definiteEvidence) {
    const evidence = collectTransferEvidenceText(evalRow, description);
    const ignore = buildStatementAccountIgnoreSets(ownCtx);
    for (const iban of extractIbansFromText(evidence)) {
      if (!ownCtx.ibans.has(iban)) continue;
      if (ignore.ignoreIbans.has(iban)) continue;
      const code = bankLuca(ownCtx.banksByIban.get(iban));
      if (code && code.startsWith("102") && code !== source102) {
        target102 = code;
        break;
      }
    }
  }

  const complete = Boolean(
    source102 &&
      target102 &&
      source102.startsWith("102") &&
      target102.startsWith("102") &&
      source102 !== target102 &&
      verdict.definiteEvidence
  );

  const dir = String(direction || "").toUpperCase();
  const isOutgoing =
    dir === "CIKIS" || dir === "GIDEN" || dir === "BORC" || dir === "DEBIT";

  let legs = null;
  if (complete) {
    legs = isOutgoing
      ? { debit: target102, credit: source102 }
      : { debit: source102, credit: target102 };
  }

  const status = complete
    ? VIRMAN_STATUS.DEFINITE
    : verdict.isVirmanCandidate
      ? VIRMAN_STATUS.CANDIDATE
      : VIRMAN_STATUS.NONE;

  return {
    ...verdict,
    status,
    isOwnVirman: complete,
    isBankInternalTransfer: complete,
    isVirmanCandidate: status === VIRMAN_STATUS.CANDIDATE,
    strongEvidence: complete,
    source102,
    target102: complete ? target102 : "",
    counterAccountCode: complete ? target102 : "",
    complete,
    legs,
    missingReason: complete
      ? ""
      : status === VIRMAN_STATUS.CANDIDATE
        ? VIRMAN_CANDIDATE_LABEL
        : "",
    label: complete
      ? "Firma kendi hesabı / virman"
      : status === VIRMAN_STATUS.CANDIDATE
        ? VIRMAN_CANDIDATE_LABEL
        : "",
  };
}

/**
 * Mapper erken kancası.
 * shouldReclassify yalnız complete 102↔102 kesin virmanda.
 */
export function detectAndClassifyBankInternalTransfer({
  description = "",
  direction = "",
  transactionType = "",
  selectedCompany = null,
  selectedBank = "",
  bankAccountCode = "",
  rawRow = null,
} = {}) {
  if (isProtectedFromVirmanReclass(transactionType)) {
    return {
      isBankInternalTransfer: false,
      shouldReclassify: false,
      isVirmanCandidate: false,
      pair: null,
    };
  }

  const row = {
    ...(rawRow || {}),
    detayAciklama:
      (rawRow &&
        (rawRow.aciklama || rawRow.description || rawRow.detayAciklama)) ||
      description,
    description,
    transactionType,
  };

  const pair = resolveVirman102Pair({
    company: selectedCompany,
    selectedBank,
    description,
    direction,
    bankAccountCode,
    transactionType,
    row,
  });

  if (pair.complete) {
    return {
      isBankInternalTransfer: true,
      shouldReclassify: true,
      isVirmanCandidate: false,
      transactionType: BANKA_ICI_VIRMAN_TYPE,
      classification: BANK_INTERNAL_TRANSFER,
      cariRequired: false,
      personelRequired: false,
      pair,
    };
  }

  if (pair.isVirmanCandidate) {
    return {
      isBankInternalTransfer: false,
      shouldReclassify: false,
      isVirmanCandidate: true,
      pair,
    };
  }

  return {
    isBankInternalTransfer: false,
    shouldReclassify: false,
    isVirmanCandidate: false,
    pair,
  };
}

/** Geriye dönük: yalnız kesin (complete) virman. */
export function isOwnAccountVirmanTransfer(row = {}, context = {}) {
  const pair = resolveVirman102Pair({
    company: context.selectedCompany || context.company,
    selectedBank: context.selectedBank,
    description: collectTransferEvidenceText(row),
    direction: row.direction || "",
    bankAccountCode: row.accountCode || row.bankAccountCode || "",
    transactionType: row.transactionType || context.transactionType,
    row,
  });
  return Boolean(pair.complete);
}

export function isVirmanCandidateTransfer(row = {}, context = {}) {
  if (row.virmanCandidate === true) return true;
  const note = `${row.kontrolNotu || ""} ${row.uyari || ""} ${row.warning || ""}`;
  if (/Virman adayı/i.test(note)) return true;
  if (String(row.missingHesapCategory || "").includes("Virman adayı")) {
    return true;
  }
  const v = evaluateOwnAccountVirmanTransfer(row, context);
  if (v.isVirmanCandidate) return true;
  const pair = resolveVirman102Pair({
    company: context.selectedCompany || context.company,
    selectedBank: context.selectedBank,
    description: collectTransferEvidenceText(row),
    transactionType: row.transactionType || context.transactionType,
    row,
  });
  return Boolean(pair.isVirmanCandidate && !pair.complete);
}

/**
 * Cari merkez yönlendirme: definite | candidate | none
 */
export function classifyVirmanForCariCenter(row = {}, context = {}) {
  if (isOwnAccountVirmanTransfer(row, context)) {
    return { bucket: "definite", label: "Firma kendi hesabı / virman" };
  }
  if (isVirmanCandidateTransfer(row, context)) {
    return { bucket: "candidate", label: VIRMAN_CANDIDATE_LABEL };
  }
  return { bucket: "none", label: "" };
}
