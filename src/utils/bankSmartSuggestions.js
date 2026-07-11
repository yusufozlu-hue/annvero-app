import { normalizeParserText } from "@/src/utils/textNormalize";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize";
import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";
import { isLikelyBankGlAccount } from "@/src/utils/transactionMemoryEngine";
import {
  buildStandardLucaDescription,
  STANDARD_MASRAF_DESCRIPTION,
  STANDARD_POS_TAHSILATI,
  STANDARD_POS_BATCH_TAHSILATI,
  STANDARD_POS_KOMISYONU,
  STANDARD_SGK,
  STANDARD_VERGI,
  STANDARD_TRAFIK,
  STANDARD_CEK,
  STANDARD_DOVIZ,
} from "@/src/utils/muhasebeDescriptionStandards";

export const SMART_SUGGESTION_CONFIDENCE = {
  HIGH: "yüksek",
  MEDIUM: "orta",
  LOW: "düşük",
};

/**
 * Güvenli sistem işlem aileleri.
 * Muhasebe kurallarını değiştirmez; yalnızca tanıma/öneri üretir.
 * accountCandidates plan içinde aranır — ham ana hesap körlemesine atanmaz.
 */
export const SAFE_SYSTEM_FAMILIES = [
  {
    id: "pos-batch",
    label: "POS batch tahsilatı",
    positive: [
      "POS BATCH",
      "POS GUN SONU",
      "POS TOPLU",
      "BATCH POS",
      "GUNSONU POS",
      "UYE ISYERI BATCH",
      "POS BLOKE COZUM",
      "POS BLOKE COZUMU",
    ],
    negative: ["KOMISYON", "KOM.", "MASRAF"],
    directions: ["GIRIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "108", nameKeywords: ["POS"] },
      { code: "108", nameKeywords: ["KREDI", "KART"] },
      { code: "108", nameKeywords: [] },
    ],
    descriptionStandard: STANDARD_POS_BATCH_TAHSILATI,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 94,
  },
  {
    id: "pos-komisyon",
    label: "POS komisyonu",
    positive: [
      "POS KOMISYON",
      "POS KOM.",
      "SANAL POS KOMISYON",
      "BKM KOMISYON",
      "UYE ISYERI KOMISYON",
      "POS HIZMET BEDEL",
    ],
    negative: ["TAHSILAT", "BATCH", "SATIS ISLEM", "BLOKE COZUM"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "770", nameKeywords: ["POS", "KOMISYON"] },
      { code: "760", nameKeywords: ["POS"] },
      { code: "780", nameKeywords: ["KOMISYON"] },
      { code: "770", nameKeywords: ["BANKA", "MASRAF"] },
      { code: "770", nameKeywords: ["KOMISYON"] },
    ],
    descriptionStandard: STANDARD_POS_KOMISYONU,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 93,
  },
  {
    id: "pos-tahsilat",
    label: "POS tahsilatı",
    positive: [
      "POS",
      "SANAL POS",
      "POS SATIS",
      "POS TAHSILAT",
      "UYE ISYERI",
      "POS PROVIZYON",
    ],
    negative: ["KOMISYON", "KOM.", "MASRAF", "BATCH", "HIZMET BEDEL"],
    directions: ["GIRIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "108", nameKeywords: ["POS"] },
      { code: "108", nameKeywords: ["KREDI", "KART"] },
      { code: "108", nameKeywords: [] },
    ],
    descriptionStandard: STANDARD_POS_TAHSILATI,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 92,
  },
  {
    id: "havale-masraf",
    label: "EFT/havale masrafı",
    positive: [
      "HAVALE MASRAF",
      "EFT MASRAF",
      "FAST UCRET",
      "FAST MASRAF",
      "BSMV",
      "HAVALE UCRET",
      "EFT UCRET",
      "BKM UCR",
      "HAVALE/EFT MASRAF",
      "HAVALE EFT MASRAF",
      "ISLEM UCRETI",
      "EFT ISLEM UCRET",
    ],
    negative: ["POS"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "780", nameKeywords: ["FINANSMAN"] },
      { code: "770", nameKeywords: ["BANKA", "MASRAF"] },
      { code: "770", nameKeywords: ["KOMISYON"] },
      { code: "770", nameKeywords: ["MASRAF"] },
    ],
    descriptionStandard: STANDARD_MASRAF_DESCRIPTION,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 95,
  },
  {
    id: "diger-masraf",
    label: "Diğer banka masrafı",
    positive: [
      "HESAP ISLETIM",
      "HESAP ISLETME",
      "PAKET UCRET",
      "KART YILLIK",
      "DIGITAL BANKACILIK UCRET",
      "BANKA MASRAF",
      "DEKONT UCRET",
    ],
    negative: ["POS", "HAVALE MASRAF", "EFT MASRAF", "FAIZ"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "770", nameKeywords: ["BANKA", "MASRAF"] },
      { code: "770", nameKeywords: ["MASRAF"] },
      { code: "780", nameKeywords: ["FINANSMAN"] },
    ],
    descriptionStandard: STANDARD_MASRAF_DESCRIPTION,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 86,
  },
  {
    id: "kredi-karti",
    label: "Kredi kartı ödemesi",
    positive: [
      "KREDI KART",
      "EKSTRE BORC",
      "KART EKSTRE",
      "KK ODEME",
      "KREDI KARTI ODEME",
      "KART BORC ODEME",
    ],
    negative: ["POS", "UYE ISYERI"],
    directions: ["CIKIS"],
    documentType: "KR",
    accountCandidates: [
      { code: "309", nameKeywords: ["KREDI", "KART"] },
      { code: "309", nameKeywords: ["KART"] },
      { code: "300", nameKeywords: ["KREDI", "KART"] },
    ],
    descriptionStandard: null,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 91,
  },
  {
    id: "maas",
    label: "Maaş ödemesi",
    positive: ["MAAS", "BORDRO", "PERSONEL UCRET", "UCRET ODEME", "MAAS ODEME"],
    negative: ["AVANS"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "335", nameKeywords: ["PERSONEL"] },
      { code: "335", nameKeywords: ["UCRET"] },
      { code: "335", nameKeywords: [] },
    ],
    descriptionStandard: null,
    islemTipi: "MAAS",
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 90,
  },
  {
    id: "maas-avans",
    label: "Maaş avansı",
    positive: [
      "MAAS AVANS",
      "PERSONEL AVANS",
      "ON AVANS",
      "AVANS ODEME",
      "PERSONELE AVANS",
    ],
    negative: ["IS AVANS", "TEDARIK", "CARI"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "196", nameKeywords: ["AVANS"] },
      { code: "196", nameKeywords: ["PERSONEL"] },
      { code: "196", nameKeywords: [] },
    ],
    descriptionStandard: null,
    islemTipi: "MAAS AVANS",
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 89,
  },
  {
    id: "is-avans",
    label: "İş avansı",
    positive: ["IS AVANS", "IS AVANSI", "TEDARIKCI AVANS"],
    negative: ["MAAS", "PERSONEL", "BORDRO"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "195", nameKeywords: ["AVANS"] },
      { code: "195", nameKeywords: ["IS"] },
      { code: "195", nameKeywords: [] },
    ],
    descriptionStandard: null,
    islemTipi: "IS AVANS",
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.MEDIUM,
    score: 82,
  },
  {
    id: "cek",
    label: "Çek ödemesi",
    positive: [
      "CEK ODEME",
      "CEK TAHSIL",
      "KESTIGIMIZ CEK",
      "ALINAN CEK",
      "CEK BORCU",
      "CEK KARSILIGI",
    ],
    negative: ["HAVALE", "EFT", "POS", "FAST", "CEKIM", "ATM"],
    directions: ["CIKIS", "GIRIS"],
    documentType: "CK",
    accountCandidates: [
      { code: "101", nameKeywords: ["CEK"] },
      { code: "103", nameKeywords: ["CEK"] },
      { code: "121", nameKeywords: ["CEK"] },
    ],
    descriptionStandard: STANDARD_CEK,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 88,
  },
  {
    id: "senet",
    label: "Senet ödemesi",
    positive: ["SENET", "BONO"],
    negative: ["POS", "HAVALE", "EFT"],
    directions: ["CIKIS", "GIRIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "121", nameKeywords: ["SENET"] },
      { code: "321", nameKeywords: ["SENET"] },
    ],
    descriptionStandard: null,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.MEDIUM,
    score: 80,
  },
  {
    id: "sgk",
    label: "SGK ödemesi",
    positive: ["SGK", "MUHSGK", "SOSYAL GUVENLIK", "BAGKUR", "PRIM ODEME"],
    negative: ["TRAFIK"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "361", nameKeywords: ["SGK"] },
      { code: "361", nameKeywords: ["SOSYAL"] },
      { code: "361", nameKeywords: ["PRIM"] },
    ],
    descriptionStandard: STANDARD_SGK,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 92,
  },
  {
    id: "vergi",
    label: "Vergi ödemesi",
    positive: [
      "VERGI",
      "GIB",
      "IVD",
      "KDV2",
      "KDV ",
      "MUHTASAR",
      "GECIKME ZAMMI",
      "DAMGA",
      "STOPAJ",
      "GECICI VERGI",
    ],
    negative: ["TRAFIK", "CEZA", "EMLAK", "MTV", "AIDAT"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "360", nameKeywords: ["VERGI"] },
      { code: "360", nameKeywords: ["KDV"] },
      { code: "360", nameKeywords: ["ODENECEK"] },
      { code: "360", nameKeywords: ["MUHTASAR"] },
    ],
    descriptionStandard: STANDARD_VERGI,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 91,
  },
  {
    id: "mtv-emlak-aidat",
    label: "MTV / emlak / oda aidatı",
    positive: [
      "MTV",
      "EMLAK VERGISI",
      "ODA AIDAT",
      "AIDAT",
      "BELEDIYE",
      "MESLEK ODASI",
    ],
    negative: ["TRAFIK CEZA", "KDV", "MUHTASAR"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "770", nameKeywords: ["VERGI"] },
      { code: "770", nameKeywords: ["AIDAT"] },
      { code: "360", nameKeywords: ["VERGI"] },
    ],
    descriptionStandard: null,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.MEDIUM,
    score: 82,
  },
  {
    id: "trafik",
    label: "Trafik cezası",
    positive: [
      "TRAFIK CEZA",
      "TRAFIK CEZASI",
      "HTS CEZA",
      "EGM CEZA",
      "TRAFIK PARA CEZASI",
    ],
    negative: ["VERGI", "SGK", "KDV"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "770", nameKeywords: ["CEZA"] },
      { code: "770", nameKeywords: ["TRAFIK"] },
      { code: "689", nameKeywords: ["CEZA"] },
    ],
    descriptionStandard: STANDARD_TRAFIK,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 90,
  },
  {
    id: "faiz-gelir",
    label: "Banka faiz geliri",
    positive: [
      "FAIZ GELIR",
      "VADE FAIZ",
      "MEVDUAT FAIZ",
      "FAIZ TAHSIL",
      "FAIZ GELIRI",
    ],
    negative: ["FAIZ GIDER", "KREDI FAIZ"],
    directions: ["GIRIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "642", nameKeywords: ["FAIZ"] },
      { code: "640", nameKeywords: ["FAIZ"] },
    ],
    descriptionStandard: null,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 88,
  },
  {
    id: "faiz-gider",
    label: "Banka faiz gideri",
    positive: [
      "FAIZ GIDER",
      "KREDI FAIZ",
      "FINANSMAN FAIZ",
      "FAIZ ODEME",
      "FAIZ GIDERİ",
    ],
    negative: ["FAIZ GELIR"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "780", nameKeywords: ["FAIZ"] },
      { code: "660", nameKeywords: ["FAIZ"] },
    ],
    descriptionStandard: null,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 88,
  },
  {
    id: "doviz",
    label: "Kur farkı / döviz işlemi",
    positive: ["DOVIZ", "KUR FARK", "FX ALIS", "FX SATIS", "DOVIZ ALIS", "DOVIZ SATIS"],
    negative: ["POS", "HAVALE", "EFT"],
    directions: ["GIRIS", "CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "646", nameKeywords: ["KUR"] },
      { code: "656", nameKeywords: ["KUR"] },
      { code: "102", nameKeywords: ["USD"] },
      { code: "102", nameKeywords: ["EUR"] },
    ],
    descriptionStandard: STANDARD_DOVIZ,
    autoFillIfPlanHit: false,
    confidence: SMART_SUGGESTION_CONFIDENCE.MEDIUM,
    score: 75,
  },
  {
    id: "nakit-cekim",
    label: "Nakit çekim",
    positive: [
      "NAKIT CEKIM",
      "ATM CEKIM",
      "VEZNEDEN CEKIM",
      "CASH WITHDRAWAL",
      "PARA CEKME",
    ],
    negative: ["YATIRMA", "DEPOSIT"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "100", nameKeywords: ["KASA"] },
      { code: "100", nameKeywords: ["NAKIT"] },
      { code: "100", nameKeywords: [] },
    ],
    descriptionStandard: null,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 87,
  },
  {
    id: "nakit-yatirma",
    label: "Nakit yatırma",
    positive: [
      "NAKIT YATIRMA",
      "VEZNE YATIRMA",
      "ATM YATIRMA",
      "CASH DEPOSIT",
      "PARA YATIRMA",
    ],
    negative: ["CEKIM"],
    directions: ["GIRIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "100", nameKeywords: ["KASA"] },
      { code: "100", nameKeywords: ["NAKIT"] },
      { code: "100", nameKeywords: [] },
    ],
    descriptionStandard: null,
    autoFillIfPlanHit: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.HIGH,
    score: 87,
  },
  {
    id: "iade",
    label: "İade / ters kayıt",
    positive: ["IADE", "TERS KAYIT", "IPTAL", "REFUND", "REVERSAL"],
    negative: [],
    directions: ["GIRIS", "CIKIS"],
    documentType: "DK",
    accountCandidates: [],
    descriptionStandard: null,
    autoFillIfPlanHit: false,
    confidence: SMART_SUGGESTION_CONFIDENCE.LOW,
    score: 60,
  },
  {
    id: "gelen-havale",
    label: "Gelen havale",
    positive: [
      "GELEN HAVALE",
      "GLN HVL",
      "GLN. HVL",
      "GELEN EFT",
      "FAST GELEN",
      "HAVALE GELEN",
      "EFT GELEN",
      "ALINAN HAVALE",
      "GELEN FAST",
      "HAVALE/EFT GELEN",
      "EFT",
      "HAVALE",
      "FAST",
    ],
    negative: ["MASRAF", "UCRET", "KOMISYON", "POS", "CEK", "GIDEN", "GONDER"],
    directions: ["GIRIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "120", nameKeywords: [] },
      { code: "320", nameKeywords: [] },
    ],
    descriptionStandard: null,
    islemTipi: "GELEN",
    autoFillIfPlanHit: false,
    needsEntity: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.MEDIUM,
    score: 72,
  },
  {
    id: "giden-havale",
    label: "Giden havale",
    positive: [
      "GIDEN HAVALE",
      "GOND HVL",
      "GONDERILEN HAVALE",
      "GONDERILEN EFT",
      "FAST GONDER",
      "EFT GONDER",
      "HAVALE GONDER",
      "GONDERILEN FAST",
      "HAVALE/EFT GIDEN",
      "GONDERME",
      "EFT",
      "HAVALE",
      "FAST",
    ],
    negative: [
      "MASRAF",
      "UCRET",
      "KOMISYON",
      "POS",
      "MAAS",
      "AVANS",
      "CEK",
      "SENET",
      "GELEN",
    ],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [
      { code: "320", nameKeywords: [] },
      { code: "120", nameKeywords: [] },
    ],
    descriptionStandard: null,
    islemTipi: "GIDEN",
    autoFillIfPlanHit: false,
    needsEntity: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.MEDIUM,
    score: 72,
  },
  {
    id: "cari-tahsilat",
    label: "Cari tahsilat",
    positive: ["TAHSILAT", "CARI TAHSILAT", "FATURA TAHSILAT"],
    negative: ["POS", "MASRAF", "KOMISYON", "VERGI", "SGK"],
    directions: ["GIRIS"],
    documentType: "DK",
    accountCandidates: [{ code: "120", nameKeywords: [] }],
    descriptionStandard: null,
    islemTipi: "GELEN",
    autoFillIfPlanHit: false,
    needsEntity: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.MEDIUM,
    score: 68,
  },
  {
    id: "cari-odeme",
    label: "Cari ödeme",
    positive: ["CARI ODEME", "FATURA ODEME", "TEDARIKCI ODEME"],
    negative: ["POS", "MASRAF", "MAAS", "VERGI", "SGK", "CEK"],
    directions: ["CIKIS"],
    documentType: "DK",
    accountCandidates: [{ code: "320", nameKeywords: [] }],
    descriptionStandard: null,
    islemTipi: "GIDEN",
    autoFillIfPlanHit: false,
    needsEntity: true,
    confidence: SMART_SUGGESTION_CONFIDENCE.MEDIUM,
    score: 68,
  },
];

// Geriye dönük alias
const SMART_RULES = SAFE_SYSTEM_FAMILIES.filter((f) =>
  ["pos-tahsilat", "havale-masraf", "sgk", "maas", "is-avans"].includes(f.id)
);

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

function getAccountCode(account) {
  if (!account || typeof account !== "object") return "";
  return String(account.accountCode || account.hesapKodu || "").trim();
}

function getAccountName(account) {
  if (!account || typeof account !== "object") return "";
  return String(account.accountName || account.hesapAdi || "").trim();
}

function compactAccount(code = "") {
  return normalizeParserText(code).replace(/\s+/g, "");
}

function isGenericCariAccount(code = "") {
  const compact = compactAccount(code);
  return compact.startsWith("120") || compact.startsWith("320");
}

function textHasAny(text, keywords = []) {
  return keywords.some((key) => {
    const normalized = normalizeSmartText(key);
    if (!normalized) return false;
    if (normalized.length <= 4) {
      const re = new RegExp(`(?:^|\\s)${normalized}(?:\\s|$)`);
      return re.test(text);
    }
    return text.includes(normalized);
  });
}

function findAccountInPlan(companyPlans = [], accountCandidates = []) {
  const activeAccounts = (companyPlans || []).filter(
    (account) => account?.isActive !== false
  );

  for (const candidate of accountCandidates) {
    const wantedCode = compactAccount(candidate.code);
    if (!wantedCode) continue;
    const nameKeywords = candidate.nameKeywords || [];

    const exact = activeAccounts.find((account) => {
      const code = compactAccount(getAccountCode(account));
      const name = normalizeSmartText(getAccountName(account));
      if (code !== wantedCode) return false;
      if (!nameKeywords.length) return true;
      return nameKeywords.every((word) => name.includes(normalizeSmartText(word)));
    });
    if (exact) return exact;

    const prefix = activeAccounts.find((account) => {
      const code = compactAccount(getAccountCode(account));
      const name = normalizeSmartText(getAccountName(account));
      if (!code.startsWith(wantedCode)) return false;
      if (!nameKeywords.length) return true;
      return nameKeywords.every((word) => name.includes(normalizeSmartText(word)));
    });
    if (prefix) return prefix;
  }

  return null;
}

function collectPlanSuggestions(companyPlans = [], accountCandidates = [], limit = 3) {
  const suggestions = [];
  const seen = new Set();
  for (const candidate of accountCandidates || []) {
    const hit = findAccountInPlan(companyPlans, [candidate]);
    if (!hit) continue;
    const code = getAccountCode(hit);
    const key = compactAccount(code);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      code,
      name: getAccountName(hit),
      label: `${code} ${getAccountName(hit)}`.trim(),
    });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

function scoreFamily(family, text, direction) {
  if (!textHasAny(text, family.positive)) return 0;
  if (textHasAny(text, family.negative || [])) return 0;
  if (
    Array.isArray(family.directions) &&
    family.directions.length &&
    direction &&
    !family.directions.includes(direction)
  ) {
    return 0;
  }
  let score = family.score || 70;
  // Daha spesifik positive eşleşmesi boost
  for (const key of family.positive) {
    const normalized = normalizeSmartText(key);
    if (normalized.length >= 8 && text.includes(normalized)) score += 3;
  }
  return score;
}

/**
 * Güvenli sistem kuralı — hafıza/firma kuralından sonra, incelemeden önce.
 */
export function matchSafeSystemBankRule(description = "", direction = "", context = {}) {
  const text = normalizeSmartText(description);
  if (!text) return null;

  let best = null;
  let bestScore = 0;

  for (const family of SAFE_SYSTEM_FAMILIES) {
    const score = scoreFamily(family, text, direction);
    if (score > bestScore) {
      best = family;
      bestScore = score;
    }
  }

  if (!best || bestScore < 65) return null;

  const planAccount = findAccountInPlan(
    context.companyPlans || [],
    best.accountCandidates || []
  );
  const suggestions = collectPlanSuggestions(
    context.companyPlans || [],
    best.accountCandidates || []
  );

  const accountCode = getAccountCode(planAccount);
  const accountName = getAccountName(planAccount);
  const canAutoFill =
    Boolean(best.autoFillIfPlanHit) &&
    Boolean(accountCode) &&
    !best.needsEntity &&
    best.confidence !== SMART_SUGGESTION_CONFIDENCE.LOW;

  const lucaDescription =
    best.descriptionStandard ||
    buildStandardLucaDescription(
      {
        aciklama: description,
        yon: direction,
        direction,
        personelAdi: context.personelAdi,
        cariUnvan: context.cariUnvan,
      },
      { islemTipi: best.islemTipi || best.label }
    );

  return {
    id: best.id,
    family: best.label,
    source: "safeSystemRule",
    confidence: best.confidence,
    score: bestScore,
    documentType: best.documentType || "DK",
    accountCode: canAutoFill ? accountCode : "",
    accountName: canAutoFill ? accountName : "",
    suggestedAccountCode: accountCode || suggestions[0]?.code || "",
    suggestedAccountName: accountName || suggestions[0]?.name || "",
    accountSuggestions: suggestions,
    lucaDescription,
    autoApplied: canAutoFill,
    requiresReview: !canAutoFill,
    planMissing:
      !best.needsEntity &&
      !accountCode &&
      (best.accountCandidates || []).length > 0,
    needsEntity: Boolean(best.needsEntity),
  };
}

function findSmartRule(description = "", direction = "") {
  return matchSafeSystemBankRule(description, direction, {});
}

export function findSmartBankSuggestion(row = {}, context = {}) {
  const description = [
    row.detayAciklama,
    row.fisAciklama,
    row.aciklama,
    row.belgeNo,
    row.evrakNo,
  ].join(" ");
  const direction =
    Number(row.borc || 0) > 0
      ? "GIRIS"
      : Number(row.alacak || 0) > 0
        ? "CIKIS"
        : row.direction || row.yon || "";

  const match = matchSafeSystemBankRule(description, direction, context);
  if (!match) return null;

  return {
    ruleId: match.id,
    accountCode: match.suggestedAccountCode || match.accountCode,
    accountName: match.suggestedAccountName || match.accountName,
    documentType: match.documentType,
    confidence: match.confidence,
    score: match.score,
    normalizedDescription: normalizeSmartText(description),
    family: match.family,
    requiresReview: match.requiresReview,
  };
}

export function applySmartBankSuggestionsToRows(rows = [], context = {}) {
  if (!rows.length) return rows;

  return rows.map((row) => {
    const existingAccount = String(row.hesapKodu || "").trim();
    if (existingAccount && isLikelyBankGlAccount(existingAccount)) return row;
    if (row.hafizaEslesme && existingAccount) return row;

    const suggestion = findSmartBankSuggestion(row, context);
    if (!suggestion || suggestion.requiresReview) return row;
    if (!suggestion.accountCode) return row;

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
        `Sistem kuralı: ${suggestion.ruleId} (${suggestion.confidence})`,
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

/**
 * “Kural bulunamadı” + eksik hesap satırlarını analysisKey gruplarına ayırır.
 */
export function groupUnresolvedRuleRows(rows = [], context = {}) {
  const unresolved = (rows || []).filter((row) => {
    const note = String(row.kontrolNotu || row.uyari || row.warning || "");
    const missingHesap =
      !String(row.hesapKodu || "").trim() || row.riskDurumu === "HESAP_EKSIK";
    return (
      missingHesap &&
      note.toLocaleLowerCase("tr").includes("kural bulunamadı")
    );
  });

  const groups = new Map();
  for (const row of unresolved) {
    const desc = row.detayAciklama || row.fisAciklama || row.description || "";
    const direction =
      Number(row.borc || 0) > 0
        ? "GIRIS"
        : Number(row.alacak || 0) > 0
          ? "CIKIS"
          : row.yon || row.direction || "";
    const key =
      row.analysisKey || normalizeBankAnalysisKey(desc, direction) || "unknown";
    if (!groups.has(key)) {
      groups.set(key, {
        analysisKey: key,
        count: 0,
        directions: new Set(),
        amounts: [],
        samples: [],
        rowIds: [],
      });
    }
    const group = groups.get(key);
    group.count += 1;
    if (direction) group.directions.add(direction);
    const amount = Number(row.borc || 0) || Number(row.alacak || 0) || 0;
    if (amount) group.amounts.push(amount);
    group.rowIds.push(row.id);
    if (group.samples.length < 10) {
      group.samples.push(String(desc).slice(0, 160));
    }
  }

  const ranked = [...groups.values()]
    .map((group) => {
      const match = matchSafeSystemBankRule(
        group.samples[0] || "",
        [...group.directions][0] || "",
        context
      );
      const amounts = group.amounts.length ? group.amounts : [0];
      const safeAuto =
        Boolean(match?.autoApplied) ||
        (Boolean(match?.suggestedAccountCode) &&
          !match?.needsEntity &&
          match?.confidence === SMART_SUGGESTION_CONFIDENCE.HIGH);
      return {
        analysisKey: group.analysisKey,
        count: group.count,
        directions: [...group.directions],
        amountMin: Math.min(...amounts),
        amountMax: Math.max(...amounts),
        samples: group.samples,
        rowIds: group.rowIds,
        suggestedFamily: match?.family || "İnceleme",
        suggestedIslemTuru: match?.family || "",
        suggestedAccount: match?.suggestedAccountCode || "",
        suggestedDocumentType: match?.documentType || "DK",
        canAutoRule: safeAuto,
        safeAutoApplicable: Boolean(match?.autoApplied),
        whyUnmatched:
          match?.needsEntity
            ? "Cari/personel exact eşleşmesi gerekli"
            : match?.planMissing
              ? "İşlem ailesi tanındı; hesap planında karşılık yok"
              : match?.autoApplied
                ? "Güvenli sistem kuralı plan hesabını buldu (otomatik uygulanır)"
                : match
                  ? "Sistem ailesi önerildi, otomatik uygulanmadı"
                  : "Mevcut kural/anahtar kelime eşleşmedi",
      };
    })
    .sort((a, b) => b.count - a.count);

  const top30 = ranked.slice(0, 30);
  const top30Coverage = top30.reduce((sum, item) => sum + item.count, 0);
  const safeFamilyCount = ranked.filter(
    (g) => g.suggestedFamily && g.suggestedFamily !== "İnceleme"
  ).length;

  return {
    totalUnresolved: unresolved.length,
    groupCount: ranked.length,
    top30,
    top30Coverage,
    top30CoveragePct: unresolved.length
      ? Math.round((top30Coverage / unresolved.length) * 100)
      : 0,
    safeFamilyGroupCount: safeFamilyCount,
    allGroups: ranked,
  };
}
