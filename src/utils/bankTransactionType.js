/**
 * Banka hareketi işlem türü — cari/personel ihtiyacından ÖNCE belirlenir.
 * Parser / performans mimarisini değiştirmez; yalnızca karar katmanı.
 */
import { normalizeParserText } from "@/src/utils/textNormalize";
import { matchSafeSystemBankRule } from "@/src/utils/bankSmartSuggestions";

export const BANK_TRANSACTION_TYPE = {
  POS_TAHSILAT: "POS_TAHSILAT",
  POS_KOMISYON: "POS_KOMISYON",
  GELEN_HAVALE: "GELEN_HAVALE",
  GIDEN_HAVALE: "GIDEN_HAVALE",
  BANKA_MASRAFI: "BANKA_MASRAFI",
  KREDI_KARTI_ODEMESI: "KREDI_KARTI_ODEMESI",
  MAAS: "MAAS",
  MAAS_AVANSI: "MAAS_AVANSI",
  IS_AVANSI: "IS_AVANSI",
  VERGI: "VERGI",
  SGK: "SGK",
  MUHSGK: "MUHSGK",
  KDV: "KDV",
  KDV2: "KDV2",
  MTV: "MTV",
  CEZA: "CEZA",
  FAIZ_GELIRI: "FAIZ_GELIRI",
  FAIZ_GIDERI: "FAIZ_GIDERI",
  DOVIZ_ALIS: "DOVIZ_ALIS",
  DOVIZ_SATIS: "DOVIZ_SATIS",
  NAKIT_CEKIM: "NAKIT_CEKIM",
  NAKIT_YATIRMA: "NAKIT_YATIRMA",
  CEK: "CEK",
  SENET: "SENET",
  CARI_TAHSILAT: "CARI_TAHSILAT",
  CARI_ODEME: "CARI_ODEME",
  BILINMEYEN: "BILINMEYEN",
};

/** Bu türlerde cari eşleştirme çalıştırılmaz / “Cari bulunamadı” üretilmez */
export const CARI_NOT_REQUIRED_TYPES = new Set([
  BANK_TRANSACTION_TYPE.POS_TAHSILAT,
  BANK_TRANSACTION_TYPE.POS_KOMISYON,
  BANK_TRANSACTION_TYPE.BANKA_MASRAFI,
  BANK_TRANSACTION_TYPE.VERGI,
  BANK_TRANSACTION_TYPE.SGK,
  BANK_TRANSACTION_TYPE.MUHSGK,
  BANK_TRANSACTION_TYPE.KDV,
  BANK_TRANSACTION_TYPE.KDV2,
  BANK_TRANSACTION_TYPE.MTV,
  BANK_TRANSACTION_TYPE.CEZA,
  BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
  BANK_TRANSACTION_TYPE.FAIZ_GIDERI,
  BANK_TRANSACTION_TYPE.DOVIZ_ALIS,
  BANK_TRANSACTION_TYPE.DOVIZ_SATIS,
  BANK_TRANSACTION_TYPE.NAKIT_CEKIM,
  BANK_TRANSACTION_TYPE.NAKIT_YATIRMA,
  BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
]);

export const CARI_REQUIRED_TYPES = new Set([
  BANK_TRANSACTION_TYPE.GELEN_HAVALE,
  BANK_TRANSACTION_TYPE.GIDEN_HAVALE,
  BANK_TRANSACTION_TYPE.CARI_TAHSILAT,
  BANK_TRANSACTION_TYPE.CARI_ODEME,
  BANK_TRANSACTION_TYPE.CEK,
  BANK_TRANSACTION_TYPE.SENET,
  BANK_TRANSACTION_TYPE.IS_AVANSI,
]);

export const PERSONEL_REQUIRED_TYPES = new Set([
  BANK_TRANSACTION_TYPE.MAAS,
  BANK_TRANSACTION_TYPE.MAAS_AVANSI,
]);

export const VERGI_SGK_TYPES = new Set([
  BANK_TRANSACTION_TYPE.VERGI,
  BANK_TRANSACTION_TYPE.SGK,
  BANK_TRANSACTION_TYPE.MUHSGK,
  BANK_TRANSACTION_TYPE.KDV,
  BANK_TRANSACTION_TYPE.KDV2,
  BANK_TRANSACTION_TYPE.MTV,
  BANK_TRANSACTION_TYPE.CEZA,
]);

/**
 * Serbest hatırlatma açıklamaları — DOĞRUDAN GİDER değildir.
 * Çay / temizlik / kargo vb. çoğu zaman cariye yapılan ödemenin notudur.
 */
export const REMINDER_DESCRIPTION_KEYWORDS = [
  "CAY",
  "CAY PARASI",
  "TEMIZLIK",
  "MALZEME",
  "KARGO",
  "AIDAT",
  "BAKIM",
  "ONARIM",
  "KONAKLAMA",
  "KUCUK BAKIM",
  "PERSONEL YEMEK",
  "YEMEK",
  "AVANS",
];

/** Yalnızca bunlar otomatik gider/masraf hesabına gidebilir */
export const DIRECT_EXPENSE_ALLOWED_TYPES = new Set([
  BANK_TRANSACTION_TYPE.BANKA_MASRAFI,
  BANK_TRANSACTION_TYPE.POS_KOMISYON,
  BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
  BANK_TRANSACTION_TYPE.FAIZ_GIDERI,
]);

const DIRECT_BANK_FEE_SIGNALS =
  /\b(HAVALE\/EFT MASRAF|HAVALE EFT MASRAF|EFT MASRAF|HAVALE MASRAF|BSMV|BKM UCR|HESAP ISLETIM|BANKA KOMISYON|BANKA HIZMET|POS KOMISYON|FAIZ TAHSIL|FAIZ TAHAKKUK|FAIZ GELIR|FAIZ GIDER)\b/i;

export function hasReminderDescriptionLanguage(description = "") {
  const text = normalizeParserText(description);
  if (!text) return false;
  if (DIRECT_BANK_FEE_SIGNALS.test(text)) return false;
  return REMINDER_DESCRIPTION_KEYWORDS.some((keyword) => {
    const key = normalizeParserText(keyword);
    if (!key) return false;
    if (key.includes(" ")) return text.includes(key);
    return new RegExp(`\\b${key}\\b`).test(text);
  });
}

export function isDirectExpenseAllowedType(transactionType = "") {
  return DIRECT_EXPENSE_ALLOWED_TYPES.has(String(transactionType || ""));
}

/** 6xx/7xx — cari gereken türlerde otomatik gider olarak kullanılamaz */
export function isExpenseOrIncomeGlAccount(accountCode = "") {
  const compact = String(accountCode || "")
    .trim()
    .replace(/\s+/g, "");
  return /^[67]\d*/.test(compact);
}

export function isLikelyCariGlAccount(accountCode = "") {
  const compact = String(accountCode || "")
    .trim()
    .replace(/\s+/g, "");
  return /^(120|320|329|331|336|337|338|339)/.test(compact);
}

const FAMILY_ID_TO_TYPE = {
  "pos-batch": BANK_TRANSACTION_TYPE.POS_TAHSILAT,
  "pos-tahsilat": BANK_TRANSACTION_TYPE.POS_TAHSILAT,
  "pos-komisyon": BANK_TRANSACTION_TYPE.POS_KOMISYON,
  "havale-masraf": BANK_TRANSACTION_TYPE.BANKA_MASRAFI,
  "diger-masraf": BANK_TRANSACTION_TYPE.BANKA_MASRAFI,
  "gelen-havale": BANK_TRANSACTION_TYPE.GELEN_HAVALE,
  "giden-havale": BANK_TRANSACTION_TYPE.GIDEN_HAVALE,
  "kredi-karti": BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
  maas: BANK_TRANSACTION_TYPE.MAAS,
  "maas-avans": BANK_TRANSACTION_TYPE.MAAS_AVANSI,
  "is-avans": BANK_TRANSACTION_TYPE.IS_AVANSI,
  sgk: BANK_TRANSACTION_TYPE.SGK,
  vergi: BANK_TRANSACTION_TYPE.VERGI,
  "mtv-emlak-aidat": BANK_TRANSACTION_TYPE.MTV,
  trafik: BANK_TRANSACTION_TYPE.CEZA,
  "faiz-gelir": BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
  "faiz-gider": BANK_TRANSACTION_TYPE.FAIZ_GIDERI,
  doviz: null, // direction ile
  "nakit-cekim": BANK_TRANSACTION_TYPE.NAKIT_CEKIM,
  "nakit-yatirma": BANK_TRANSACTION_TYPE.NAKIT_YATIRMA,
  cek: BANK_TRANSACTION_TYPE.CEK,
  senet: BANK_TRANSACTION_TYPE.SENET,
  "cari-tahsilat": BANK_TRANSACTION_TYPE.CARI_TAHSILAT,
  "cari-odeme": BANK_TRANSACTION_TYPE.CARI_ODEME,
  iade: BANK_TRANSACTION_TYPE.BILINMEYEN,
};

function detectFromText(description = "", direction = "") {
  const text = normalizeParserText(description);
  if (!text) return BANK_TRANSACTION_TYPE.BILINMEYEN;

  if (
    text.includes("POS BATCH") ||
    text.includes("POS TAHSILATI") ||
    text.includes("POS TAHSILAT") ||
    (text.includes("POS") &&
      direction === "GIRIS" &&
      !text.includes("KOMISYON"))
  ) {
    return BANK_TRANSACTION_TYPE.POS_TAHSILAT;
  }
  if (
    text.includes("POS KOMISYON") ||
    text.includes("POS KOM") ||
    (text.includes("POS") && text.includes("KOMISYON"))
  ) {
    return BANK_TRANSACTION_TYPE.POS_KOMISYON;
  }
  if (
    text.includes("HAVALE/EFT MASRAF") ||
    text.includes("HAVALE EFT MASRAF") ||
    text.includes("EFT MASRAF") ||
    text.includes("HAVALE MASRAF") ||
    text.includes("BSMV") ||
    text.includes("BKM UCR")
  ) {
    return BANK_TRANSACTION_TYPE.BANKA_MASRAFI;
  }
  if (text.includes("MUHSGK")) return BANK_TRANSACTION_TYPE.MUHSGK;
  if (text.includes("SGK")) return BANK_TRANSACTION_TYPE.SGK;
  if (text.includes("KDV2")) return BANK_TRANSACTION_TYPE.KDV2;
  if (/\bKDV\b/.test(text)) return BANK_TRANSACTION_TYPE.KDV;
  if (text.includes("MTV") || text.includes("EMLAK")) {
    return BANK_TRANSACTION_TYPE.MTV;
  }
  if (text.includes("TRAFIK") || text.includes("CEZA")) {
    return BANK_TRANSACTION_TYPE.CEZA;
  }
  if (text.includes("VERGI") || text.includes("MUHTASAR") || text.includes("GIB")) {
    return BANK_TRANSACTION_TYPE.VERGI;
  }
  if (text.includes("FAIZ GELIR") || text.includes("MEVDUAT FAIZ")) {
    return BANK_TRANSACTION_TYPE.FAIZ_GELIRI;
  }
  if (text.includes("FAIZ GIDER") || text.includes("KREDI FAIZ")) {
    return BANK_TRANSACTION_TYPE.FAIZ_GIDERI;
  }
  if (text.includes("DOVIZ") || text.includes("KUR FARK")) {
    return direction === "CIKIS"
      ? BANK_TRANSACTION_TYPE.DOVIZ_SATIS
      : BANK_TRANSACTION_TYPE.DOVIZ_ALIS;
  }
  if (text.includes("NAKIT CEKIM") || text.includes("ATM CEKIM")) {
    return BANK_TRANSACTION_TYPE.NAKIT_CEKIM;
  }
  if (text.includes("NAKIT YATIRMA") || text.includes("ATM YATIRMA")) {
    return BANK_TRANSACTION_TYPE.NAKIT_YATIRMA;
  }
  if (text.includes("KREDI KART") || text.includes("KK ODEME")) {
    return BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI;
  }
  if (
    text.includes("MAAS AVANS") ||
    text.includes("PERSONEL AVANS") ||
    (text.includes("AVANS") && text.includes("MAAS"))
  ) {
    return BANK_TRANSACTION_TYPE.MAAS_AVANSI;
  }
  if (text.includes("MAAS") || text.includes("BORDRO")) {
    return BANK_TRANSACTION_TYPE.MAAS;
  }
  if (text.includes("IS AVANS")) return BANK_TRANSACTION_TYPE.IS_AVANSI;
  if (text.includes("CEK")) return BANK_TRANSACTION_TYPE.CEK;
  if (text.includes("SENET") || text.includes("BONO")) {
    return BANK_TRANSACTION_TYPE.SENET;
  }
  if (
    text.includes("GLN HVL") ||
    text.includes("GELEN HAVALE") ||
    text.includes("GELEN EFT") ||
    (direction === "GIRIS" &&
      (text.includes("HAVALE") || text.includes("EFT") || text.includes("FAST")))
  ) {
    return BANK_TRANSACTION_TYPE.GELEN_HAVALE;
  }
  if (
    text.includes("GOND HVL") ||
    text.includes("GIDEN HAVALE") ||
    text.includes("GONDERILEN") ||
    (direction === "CIKIS" &&
      (text.includes("HAVALE") || text.includes("EFT") || text.includes("FAST")))
  ) {
    return BANK_TRANSACTION_TYPE.GIDEN_HAVALE;
  }

  if (
    text.includes("CARI MAHSUP") ||
    text.includes("CARI ODEME") ||
    text.includes("CARI TAHSILAT")
  ) {
    return direction === "GIRIS"
      ? BANK_TRANSACTION_TYPE.CARI_TAHSILAT
      : BANK_TRANSACTION_TYPE.CARI_ODEME;
  }

  // Serbest açıklama (çay/temizlik/kargo…) → gider değil, cari ödeme/tahsilat
  if (hasReminderDescriptionLanguage(text)) {
    return direction === "GIRIS"
      ? BANK_TRANSACTION_TYPE.CARI_TAHSILAT
      : BANK_TRANSACTION_TYPE.CARI_ODEME;
  }

  return BANK_TRANSACTION_TYPE.BILINMEYEN;
}

/**
 * @returns {{
 *   transactionType: string,
 *   cariRequired: boolean,
 *   personelRequired: boolean,
 *   source: string,
 *   familyId: string,
 * }}
 */
export function resolveBankTransactionType(
  description = "",
  direction = "",
  context = {}
) {
  const system = matchSafeSystemBankRule(description, direction, context);
  let transactionType = BANK_TRANSACTION_TYPE.BILINMEYEN;
  let source = "heuristic";
  let familyId = "";

  if (system?.id) {
    familyId = system.id;
    source = "safeSystemFamily";
    if (system.id === "doviz") {
      transactionType =
        direction === "CIKIS"
          ? BANK_TRANSACTION_TYPE.DOVIZ_SATIS
          : BANK_TRANSACTION_TYPE.DOVIZ_ALIS;
    } else if (system.id === "sgk") {
      const text = normalizeParserText(description);
      transactionType = text.includes("MUHSGK")
        ? BANK_TRANSACTION_TYPE.MUHSGK
        : BANK_TRANSACTION_TYPE.SGK;
    } else if (system.id === "vergi") {
      const text = normalizeParserText(description);
      if (text.includes("KDV2")) transactionType = BANK_TRANSACTION_TYPE.KDV2;
      else if (/\bKDV\b/.test(text)) transactionType = BANK_TRANSACTION_TYPE.KDV;
      else transactionType = BANK_TRANSACTION_TYPE.VERGI;
    } else {
      transactionType =
        FAMILY_ID_TO_TYPE[system.id] || BANK_TRANSACTION_TYPE.BILINMEYEN;
    }
  }

  // Aidat/MTV ailesi: serbest “aidat” + havale/hatırlatma → cari ödeme
  if (
    transactionType === BANK_TRANSACTION_TYPE.MTV &&
    hasReminderDescriptionLanguage(description) &&
    !/\b(MTV|EMLAK|BELEDIYE|MESLEK ODASI|ODA AIDAT)\b/i.test(
      normalizeParserText(description)
    )
  ) {
    transactionType =
      direction === "GIRIS"
        ? BANK_TRANSACTION_TYPE.CARI_TAHSILAT
        : BANK_TRANSACTION_TYPE.CARI_ODEME;
    source = "reminderOverride";
    familyId = "";
  }

  if (transactionType === BANK_TRANSACTION_TYPE.BILINMEYEN) {
    transactionType = detectFromText(
      context.lucaDescription || description,
      direction
    );
    if (transactionType !== BANK_TRANSACTION_TYPE.BILINMEYEN) {
      source = source === "safeSystemFamily" ? source : "textHeuristic";
    }
  }

  // Standart Luca açıklamaları (analiz sonrası satırlar)
  if (transactionType === BANK_TRANSACTION_TYPE.BILINMEYEN) {
    transactionType = detectFromText(description, direction);
  }

  let cariRequired = CARI_REQUIRED_TYPES.has(transactionType);
  const personelRequired = PERSONEL_REQUIRED_TYPES.has(transactionType);

  // Cari gereken transfer sinyali varken gider ailesi baskın gelmesin
  if (
    !cariRequired &&
    !personelRequired &&
    !isDirectExpenseAllowedType(transactionType) &&
    !isCariForbiddenForType(transactionType) &&
    hasReminderDescriptionLanguage(description)
  ) {
    transactionType =
      direction === "GIRIS"
        ? BANK_TRANSACTION_TYPE.CARI_TAHSILAT
        : BANK_TRANSACTION_TYPE.CARI_ODEME;
    cariRequired = true;
    source = "reminderCari";
  }

  return {
    transactionType,
    cariRequired,
    personelRequired,
    source,
    familyId,
    systemMatch: system,
  };
}

export function isCariRequiredForType(transactionType = "") {
  return CARI_REQUIRED_TYPES.has(String(transactionType || ""));
}

export function isPersonelRequiredForType(transactionType = "") {
  return PERSONEL_REQUIRED_TYPES.has(String(transactionType || ""));
}

export function isCariForbiddenForType(transactionType = "") {
  return CARI_NOT_REQUIRED_TYPES.has(String(transactionType || ""));
}

export function isVergiSgkType(transactionType = "") {
  return VERGI_SGK_TYPES.has(String(transactionType || ""));
}

/** Eksik hesap kategorisi için işlem türüne göre varsayılan etiket */
export function missingCategoryForTransactionType(transactionType = "") {
  const type = String(transactionType || "");
  if (isVergiSgkType(type)) return "Vergi/SGK türü çözülemedi";
  if (isPersonelRequiredForType(type)) return "Personel bulunamadı";
  if (
    type === BANK_TRANSACTION_TYPE.POS_TAHSILAT ||
    type === BANK_TRANSACTION_TYPE.POS_KOMISYON
  ) {
    return "POS/komisyon ayrımı çözülemedi";
  }
  if (type === BANK_TRANSACTION_TYPE.BANKA_MASRAFI) {
    return "Hesap planında önerilen kod yok";
  }
  if (
    type === BANK_TRANSACTION_TYPE.DOVIZ_ALIS ||
    type === BANK_TRANSACTION_TYPE.DOVIZ_SATIS
  ) {
    return "Hesap planında önerilen kod yok";
  }
  if (isCariRequiredForType(type)) return "Cari bulunamadı";
  return "Diğer";
}
