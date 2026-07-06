import { normalizeParserText } from "@/src/utils/textNormalize";
import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";
import { isLikelyBankGlAccount } from "@/src/utils/transactionMemoryEngine";

export const SMART_SUGGESTION_CONFIDENCE = {
  HIGH: "yüksek",
  MEDIUM: "orta",
  LOW: "düşük",
};

const SMART_RULES = [
  {
    id: "pos-tahsilat",
    patterns: [/\bPOS\b/, /\bPOS\s+TAHSILAT/, /\bPOS\s+SATIS/, /\bSANAL\s+POS/],
    accountCandidates: [
      { code: "108", nameKeywords: ["POS"] },
      { code: "108", nameKeywords: ["KREDI", "KART"] },
    ],
    fallbackAccount: { code: "108", name: "POS Hesabı" },
    documentType: "DK",
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 92,
  },
  {
    id: "banka-masraf",
    patterns: [
      /\bHAVALE\s+MASRAF/,
      /\bEFT\s+MASRAF/,
      /\bFAST\s+MASRAF/,
      /\bBSMV\b/,
      /\bKOMISYON\b/,
      /\bKOMISYON\s+MASRAF/,
    ],
    accountCandidates: [
      { code: "770", nameKeywords: ["BANKA", "MASRAF"] },
      { code: "770", nameKeywords: ["GENEL", "YONETIM"] },
      { code: "780", nameKeywords: ["FINANSMAN"] },
    ],
    fallbackAccount: { code: "770", name: "Banka Masrafları" },
    documentType: "DK",
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 90,
  },
  {
    id: "sgk",
    patterns: [/\bSGK\b/, /\bMUHSGK\b/, /\bSOSYAL\s+GUVENLIK/],
    accountCandidates: [
      { code: "361", nameKeywords: ["SGK"] },
      { code: "361", nameKeywords: ["ODENECEK", "SOSYAL"] },
      { code: "360", nameKeywords: ["ODENECEK", "VERGI"] },
    ],
    fallbackAccount: { code: "361", name: "Ödenecek Sosyal Güvenlik Kesintileri" },
    documentType: "DK",
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 88,
  },
  {
    id: "dijital-servis-gider",
    patterns: [
      /\bGOOGLE\b/,
      /\bFACEBOOK\b/,
      /\bMETA\b/,
      /\bSPOTIFY\b/,
      /\bBOOKING\b/,
      /\bEXPEDIA\b/,
      /\bMICROSOFT\b/,
    ],
    accountCandidates: [
      { code: "760", nameKeywords: ["REKLAM"] },
      { code: "760", nameKeywords: ["PAZARLAMA"] },
      { code: "770", nameKeywords: ["YAZILIM"] },
      { code: "770", nameKeywords: ["GENEL", "YONETIM"] },
    ],
    fallbackAccount: { code: "760", name: "Reklam / Yazılım Giderleri" },
    documentType: "FT",
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 90,
  },
  {
    id: "maas-personel",
    patterns: [/\bMAAS\b/, /\bUCRET\b/, /\bPERSONEL\b/, /\bBORDRO\b/],
    accountCandidates: [
      { code: "335", nameKeywords: ["PERSONEL"] },
      { code: "335", nameKeywords: ["UCRET"] },
    ],
    fallbackAccount: { code: "335", name: "Personele Borçlar" },
    documentType: "DK",
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 88,
  },
  {
    id: "avans",
    patterns: [/\bAVANS\b/],
    accountCandidates: [
      { code: "195", nameKeywords: ["AVANS"] },
      { code: "196", nameKeywords: ["AVANS"] },
    ],
    fallbackAccount: { code: "195", name: "İş Avansları" },
    documentType: "DK",
    confidence: SMART_SUGGESTION_CONFIDENCE.MEDIUM,
    score: 72,
  },
];

function normalizeSmartText(value = "") {
  return normalizeParserText(value)
    .replace(/\bTR\d{2}[A-Z0-9]{10,30}\b/g, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{6,}\b/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAccountCode(account = {}) {
  return String(account.accountCode || account.hesapKodu || "").trim();
}

function getAccountName(account = {}) {
  return String(account.accountName || account.hesapAdi || "").trim();
}

function compactAccount(code = "") {
  return normalizeParserText(code).replace(/\s+/g, "");
}

function isGenericCariAccount(code = "") {
  const compact = compactAccount(code);
  return compact.startsWith("120") || compact.startsWith("320");
}

function findAccountInPlan(companyPlans = [], accountCandidates = []) {
  const activeAccounts = (companyPlans || []).filter((account) => account?.isActive !== false);

  for (const candidate of accountCandidates) {
    const wantedCode = compactAccount(candidate.code);
    const wantedName = normalizeSmartText((candidate.nameKeywords || []).join(" "));

    const exact = activeAccounts.find((account) => {
      const code = compactAccount(getAccountCode(account));
      const name = normalizeSmartText(getAccountName(account));
      return (
        code === wantedCode &&
        (!wantedName ||
          candidate.nameKeywords.every((word) => name.includes(normalizeSmartText(word))))
      );
    });

    if (exact) return exact;

    const prefix = activeAccounts.find((account) => {
      const code = compactAccount(getAccountCode(account));
      const name = normalizeSmartText(getAccountName(account));
      return (
        code.startsWith(wantedCode) &&
        (!wantedName ||
          candidate.nameKeywords.some((word) => name.includes(normalizeSmartText(word))))
      );
    });

    if (prefix) return prefix;
  }

  return null;
}

function findSmartRule(description = "") {
  const text = normalizeSmartText(description);
  if (!text) return null;

  // POS komisyonları işletmeye göre masraf, pazarlama veya banka kesintisi
  // olarak öğretilebilir; kesin öğrenme kaydı yoksa kuyruğa düşsün.
  if (/\bPOS\b/.test(text) && /\bKOMISYON\b/.test(text)) {
    return null;
  }

  return SMART_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text))) || null;
}

export function findSmartBankSuggestion(row = {}, context = {}) {
  const description = [
    row.detayAciklama,
    row.fisAciklama,
    row.aciklama,
    row.belgeNo,
    row.evrakNo,
  ].join(" ");
  const rule = findSmartRule(description);
  if (!rule) return null;

  const planAccount = findAccountInPlan(context.companyPlans || [], rule.accountCandidates);
  const accountCode = getAccountCode(planAccount) || rule.fallbackAccount.code;
  const accountName = getAccountName(planAccount) || rule.fallbackAccount.name;

  return {
    ruleId: rule.id,
    accountCode,
    accountName,
    documentType: rule.documentType,
    confidence: rule.confidence,
    score: rule.score,
    normalizedDescription: normalizeSmartText(description),
  };
}

export function applySmartBankSuggestionsToRows(rows = [], context = {}) {
  if (!rows.length) return rows;

  return rows.map((row) => {
    const existingAccount = String(row.hesapKodu || "").trim();
    if (existingAccount && isLikelyBankGlAccount(existingAccount)) return row;
    if (row.hafizaEslesme && existingAccount) return row;

    const suggestion = findSmartBankSuggestion(row, context);
    if (!suggestion) return row;

    const shouldFillAccount =
      !existingAccount ||
      row.riskDurumu === "HESAP_EKSIK" ||
      isGenericCariAccount(existingAccount);
    const documentType = String(row.belgeTuru || "").trim().toUpperCase();
    const shouldFillDocument = !documentType || documentType === "DK";

    return finalizeStandardLucaRow({
      ...row,
      hesapKodu: shouldFillAccount ? suggestion.accountCode : row.hesapKodu,
      hesapAdi: shouldFillAccount ? suggestion.accountName : row.hesapAdi,
      belgeTuru: shouldFillDocument ? suggestion.documentType : row.belgeTuru,
      riskDurumu: shouldFillAccount ? "" : row.riskDurumu,
      kontrolNotu: [
        row.kontrolNotu,
        `Akıllı öneri: ${suggestion.ruleId} (${suggestion.confidence})`,
      ]
        .filter(Boolean)
        .join(" | "),
      suggestedAccountCode: suggestion.accountCode,
      suggestedAccountName: suggestion.accountName,
      suggestedDocumentType: suggestion.documentType,
      suggestionScore: suggestion.score,
      suggestionConfidence: suggestion.confidence,
      smartSuggestionRuleId: suggestion.ruleId,
      smartSuggestionApplied: shouldFillAccount || shouldFillDocument,
    });
  });
}
