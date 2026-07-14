/**
 * Banka hareketi işlem türü — cari/personel ihtiyacından ÖNCE belirlenir.
 * Parser / performans / cari matcher mimarisini değiştirmez; yalnızca karar katmanı.
 */
import { normalizeParserText } from "@/src/utils/textNormalize";
import { matchSafeSystemBankRule } from "@/src/utils/bankSmartSuggestions";

export const BANK_TRANSACTION_TYPE = {
  // POS ailesi
  POS_TAHSILAT: "POS_TAHSILAT",
  POS_BATCH_TAHSILAT: "POS_BATCH_TAHSILAT",
  POS_KOMISYON: "POS_KOMISYON",
  POS_IADE: "POS_IADE",
  POS_BLOKE: "POS_BLOKE",
  POS_SANAL: "POS_SANAL",
  POS_COZUM: "POS_COZUM",
  POS_ERTESI_GUN: "POS_ERTESI_GUN",

  // Transfer / cari
  GELEN_HAVALE: "GELEN_HAVALE",
  GIDEN_HAVALE: "GIDEN_HAVALE",
  MUSTERI_TAHSILAT: "MUSTERI_TAHSILAT",
  TEDARIKCI_ODEME: "TEDARIKCI_ODEME",
  DIGER_CARI_HAREKET: "DIGER_CARI_HAREKET",
  /** @deprecated alias → MUSTERI_TAHSILAT / DIGER_CARI_HAREKET */
  CARI_TAHSILAT: "CARI_TAHSILAT",
  /** @deprecated alias → TEDARIKCI_ODEME / DIGER_CARI_HAREKET */
  CARI_ODEME: "CARI_ODEME",
  CEK_ODEMESI: "CEK_ODEMESI",
  CEK_TAHSILATI: "CEK_TAHSILATI",
  /** @deprecated alias → CEK_ODEMESI / CEK_TAHSILATI */
  CEK: "CEK",
  SENET: "SENET",

  // Banka / personel
  BANKA_MASRAFI: "BANKA_MASRAFI",
  BSMV: "BSMV",
  KREDI_KARTI_ODEMESI: "KREDI_KARTI_ODEMESI",
  MAAS: "MAAS",
  MAAS_AVANSI: "MAAS_AVANSI",
  IS_AVANSI: "IS_AVANSI",

  // Vergi / SGK
  VERGI: "VERGI",
  SGK: "SGK",
  MUHSGK: "MUHSGK",
  KDV: "KDV",
  KDV2: "KDV2",
  MTV: "MTV",
  EMLAK_VERGISI: "EMLAK_VERGISI",
  ODA_AIDATI: "ODA_AIDATI",
  KONAKLAMA_VERGISI: "KONAKLAMA_VERGISI",
  TURIZM_VERGISI: "TURIZM_VERGISI",
  TURIZM_PAYI: "TURIZM_PAYI",
  DAMGA_VERGISI: "DAMGA_VERGISI",
  VERGI_CEZASI: "VERGI_CEZASI",
  GECIKME_ZAMMI: "GECIKME_ZAMMI",
  CEZA: "CEZA",
  TRAFIK_CEZASI: "TRAFIK_CEZASI",

  // Finans / kasa / virman
  BANKA_ICI_VIRMAN: "BANKA_ICI_VIRMAN",
  BANKALAR_ARASI_VIRMAN: "BANKALAR_ARASI_VIRMAN",
  /** @deprecated alias → BANKA_ICI_VIRMAN / BANKALAR_ARASI_VIRMAN */
  VIRMAN: "VIRMAN",
  KASA_BANKAYA_YATAN: "KASA_BANKAYA_YATAN",
  BANKADAN_KASAYA_CEKILEN: "BANKADAN_KASAYA_CEKILEN",
  FON_ALIS: "FON_ALIS",
  FON_SATIS: "FON_SATIS",
  REPO: "REPO",
  TERS_REPO: "TERS_REPO",
  KREDI_KULLANIM: "KREDI_KULLANIM",
  KREDI_ANAPARA: "KREDI_ANAPARA",
  KREDI_FAIZ: "KREDI_FAIZ",
  KMH_FAIZ: "KMH_FAIZ",
  EK_HESAP_KAPAMA: "EK_HESAP_KAPAMA",
  DOVIZ_ALIS: "DOVIZ_ALIS",
  DOVIZ_SATIS: "DOVIZ_SATIS",
  KUR_FARKI: "KUR_FARKI",
  FAIZ_GELIRI: "FAIZ_GELIRI",
  FAIZ_GIDERI: "FAIZ_GIDERI",
  NAKIT_CEKME: "NAKIT_CEKME",
  /** @deprecated alias → NAKIT_CEKME */
  NAKIT_CEKIM: "NAKIT_CEKIM",
  NAKIT_YATIRMA: "NAKIT_YATIRMA",

  BILINMEYEN: "BILINMEYEN",
};

export const POS_TYPES = new Set([
  BANK_TRANSACTION_TYPE.POS_TAHSILAT,
  BANK_TRANSACTION_TYPE.POS_BATCH_TAHSILAT,
  BANK_TRANSACTION_TYPE.POS_KOMISYON,
  BANK_TRANSACTION_TYPE.POS_IADE,
  BANK_TRANSACTION_TYPE.POS_BLOKE,
  BANK_TRANSACTION_TYPE.POS_SANAL,
  BANK_TRANSACTION_TYPE.POS_COZUM,
  BANK_TRANSACTION_TYPE.POS_ERTESI_GUN,
]);

export const VERGI_SGK_TYPES = new Set([
  BANK_TRANSACTION_TYPE.VERGI,
  BANK_TRANSACTION_TYPE.SGK,
  BANK_TRANSACTION_TYPE.MUHSGK,
  BANK_TRANSACTION_TYPE.KDV,
  BANK_TRANSACTION_TYPE.KDV2,
  BANK_TRANSACTION_TYPE.MTV,
  BANK_TRANSACTION_TYPE.EMLAK_VERGISI,
  BANK_TRANSACTION_TYPE.ODA_AIDATI,
  BANK_TRANSACTION_TYPE.KONAKLAMA_VERGISI,
  BANK_TRANSACTION_TYPE.TURIZM_VERGISI,
  BANK_TRANSACTION_TYPE.TURIZM_PAYI,
  BANK_TRANSACTION_TYPE.DAMGA_VERGISI,
  BANK_TRANSACTION_TYPE.VERGI_CEZASI,
  BANK_TRANSACTION_TYPE.GECIKME_ZAMMI,
  BANK_TRANSACTION_TYPE.CEZA,
  BANK_TRANSACTION_TYPE.TRAFIK_CEZASI,
]);

export const CEK_TYPES = new Set([
  BANK_TRANSACTION_TYPE.CEK_ODEMESI,
  BANK_TRANSACTION_TYPE.CEK_TAHSILATI,
  BANK_TRANSACTION_TYPE.CEK,
]);

export const KASA_TYPES = new Set([
  BANK_TRANSACTION_TYPE.KASA_BANKAYA_YATAN,
  BANK_TRANSACTION_TYPE.BANKADAN_KASAYA_CEKILEN,
]);

export const VIRMAN_TYPES = new Set([
  BANK_TRANSACTION_TYPE.BANKA_ICI_VIRMAN,
  BANK_TRANSACTION_TYPE.BANKALAR_ARASI_VIRMAN,
  BANK_TRANSACTION_TYPE.VIRMAN,
]);

export const FINANCE_TYPES = new Set([
  ...VIRMAN_TYPES,
  ...KASA_TYPES,
  BANK_TRANSACTION_TYPE.FON_ALIS,
  BANK_TRANSACTION_TYPE.FON_SATIS,
  BANK_TRANSACTION_TYPE.REPO,
  BANK_TRANSACTION_TYPE.TERS_REPO,
  BANK_TRANSACTION_TYPE.KREDI_KULLANIM,
  BANK_TRANSACTION_TYPE.KREDI_ANAPARA,
  BANK_TRANSACTION_TYPE.KREDI_FAIZ,
  BANK_TRANSACTION_TYPE.KMH_FAIZ,
  BANK_TRANSACTION_TYPE.EK_HESAP_KAPAMA,
  BANK_TRANSACTION_TYPE.DOVIZ_ALIS,
  BANK_TRANSACTION_TYPE.DOVIZ_SATIS,
  BANK_TRANSACTION_TYPE.KUR_FARKI,
  BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
  BANK_TRANSACTION_TYPE.FAIZ_GIDERI,
  BANK_TRANSACTION_TYPE.NAKIT_CEKME,
  BANK_TRANSACTION_TYPE.NAKIT_CEKIM,
  BANK_TRANSACTION_TYPE.NAKIT_YATIRMA,
]);

/** Bu türlerde cari eşleştirme çalıştırılmaz / “Cari bulunamadı” üretilmez */
export const CARI_NOT_REQUIRED_TYPES = new Set([
  ...POS_TYPES,
  ...CEK_TYPES,
  ...KASA_TYPES,
  ...VIRMAN_TYPES,
  BANK_TRANSACTION_TYPE.BANKA_MASRAFI,
  BANK_TRANSACTION_TYPE.BSMV,
  BANK_TRANSACTION_TYPE.KREDI_KARTI_ODEMESI,
  ...VERGI_SGK_TYPES,
  ...FINANCE_TYPES,
]);

/** Yalnızca gerçek cari / havale senaryoları */
export const CARI_REQUIRED_TYPES = new Set([
  BANK_TRANSACTION_TYPE.GELEN_HAVALE,
  BANK_TRANSACTION_TYPE.GIDEN_HAVALE,
  BANK_TRANSACTION_TYPE.MUSTERI_TAHSILAT,
  BANK_TRANSACTION_TYPE.TEDARIKCI_ODEME,
  BANK_TRANSACTION_TYPE.DIGER_CARI_HAREKET,
  BANK_TRANSACTION_TYPE.CARI_TAHSILAT,
  BANK_TRANSACTION_TYPE.CARI_ODEME,
  BANK_TRANSACTION_TYPE.IS_AVANSI,
  BANK_TRANSACTION_TYPE.SENET,
]);

export const PERSONEL_REQUIRED_TYPES = new Set([
  BANK_TRANSACTION_TYPE.MAAS,
  BANK_TRANSACTION_TYPE.MAAS_AVANSI,
]);

/**
 * Serbest hatırlatma açıklamaları — DOĞRUDAN GİDER değildir.
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
  BANK_TRANSACTION_TYPE.KREDI_FAIZ,
  BANK_TRANSACTION_TYPE.KMH_FAIZ,
  BANK_TRANSACTION_TYPE.GECIKME_ZAMMI,
  BANK_TRANSACTION_TYPE.MTV,
  BANK_TRANSACTION_TYPE.EMLAK_VERGISI,
  BANK_TRANSACTION_TYPE.ODA_AIDATI,
  BANK_TRANSACTION_TYPE.CEZA,
  BANK_TRANSACTION_TYPE.VERGI_CEZASI,
]);

const DIRECT_BANK_FEE_SIGNALS =
  /\b(HAVALE\/EFT MASRAF|HAVALE EFT MASRAF|EFT MASRAF|HAVALE MASRAF|BSMV|BKM UCR|HESAP ISLETIM|BANKA KOMISYON|BANKA HIZMET|POS KOMISYON|FAIZ TAHSIL|FAIZ TAHAKKUK|FAIZ GELIR|FAIZ GIDER)\b/i;

export function hasReminderDescriptionLanguage(description = "") {
  const text = normalizeParserText(description);
  if (!text) return false;
  if (DIRECT_BANK_FEE_SIGNALS.test(text)) return false;
  // Konaklama vergisi / turizm vergisi hatırlatma sayılmaz
  if (/\b(KONAKLAMA VERGI|TURIZM PAY|TURIZM VERGI|DAMGA VERGI)\b/.test(text)) {
    return false;
  }
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

/** Ham 360/361 — tahakkuk alt hesabı yoksa kör atama yapılmaz */
export function isBareVergiSgkMainAccount(accountCode = "") {
  const compact = String(accountCode || "")
    .trim()
    .replace(/\s+/g, "");
  return compact === "360" || compact === "361";
}

const FAMILY_ID_TO_TYPE = {
  "pos-batch": BANK_TRANSACTION_TYPE.POS_BATCH_TAHSILAT,
  "pos-tahsilat": BANK_TRANSACTION_TYPE.POS_TAHSILAT,
  "pos-komisyon": BANK_TRANSACTION_TYPE.POS_KOMISYON,
  "pos-iade": BANK_TRANSACTION_TYPE.POS_IADE,
  "pos-bloke": BANK_TRANSACTION_TYPE.POS_BLOKE,
  "pos-sanal": BANK_TRANSACTION_TYPE.POS_SANAL,
  "pos-cozum": BANK_TRANSACTION_TYPE.POS_COZUM,
  "pos-ertesi-gun": BANK_TRANSACTION_TYPE.POS_ERTESI_GUN,
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
  "emlak-vergisi": BANK_TRANSACTION_TYPE.EMLAK_VERGISI,
  "oda-aidati": BANK_TRANSACTION_TYPE.ODA_AIDATI,
  "konaklama-vergisi": BANK_TRANSACTION_TYPE.KONAKLAMA_VERGISI,
  "turizm-vergisi": BANK_TRANSACTION_TYPE.TURIZM_VERGISI,
  "damga-vergisi": BANK_TRANSACTION_TYPE.DAMGA_VERGISI,
  "vergi-cezasi": BANK_TRANSACTION_TYPE.VERGI_CEZASI,
  "gecikme-zammi": BANK_TRANSACTION_TYPE.GECIKME_ZAMMI,
  trafik: BANK_TRANSACTION_TYPE.CEZA,
  "faiz-gelir": BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
  "faiz-gider": BANK_TRANSACTION_TYPE.FAIZ_GIDERI,
  doviz: null,
  "kur-farki": BANK_TRANSACTION_TYPE.KUR_FARKI,
  "nakit-cekim": BANK_TRANSACTION_TYPE.NAKIT_CEKME,
  "nakit-yatirma": BANK_TRANSACTION_TYPE.NAKIT_YATIRMA,
  virman: BANK_TRANSACTION_TYPE.VIRMAN,
  "fon-alis": BANK_TRANSACTION_TYPE.FON_ALIS,
  "fon-satis": BANK_TRANSACTION_TYPE.FON_SATIS,
  repo: BANK_TRANSACTION_TYPE.REPO,
  "ters-repo": BANK_TRANSACTION_TYPE.TERS_REPO,
  "kredi-kullanim": BANK_TRANSACTION_TYPE.KREDI_KULLANIM,
  "kredi-anapara": BANK_TRANSACTION_TYPE.KREDI_ANAPARA,
  "kredi-faiz": BANK_TRANSACTION_TYPE.KREDI_FAIZ,
  "kmh-faiz": BANK_TRANSACTION_TYPE.KMH_FAIZ,
  "ek-hesap-kapama": BANK_TRANSACTION_TYPE.EK_HESAP_KAPAMA,
  cek: BANK_TRANSACTION_TYPE.CEK,
  senet: BANK_TRANSACTION_TYPE.SENET,
  "cari-tahsilat": BANK_TRANSACTION_TYPE.MUSTERI_TAHSILAT,
  "cari-odeme": BANK_TRANSACTION_TYPE.TEDARIKCI_ODEME,
  iade: BANK_TRANSACTION_TYPE.BILINMEYEN,
};

/** Eski tip → yeni tip (geriye dönük) */
export function canonicalizeTransactionType(type = "", direction = "") {
  const t = String(type || "").trim().toUpperCase();
  if (t === BANK_TRANSACTION_TYPE.CEK) {
    return direction === "GIRIS"
      ? BANK_TRANSACTION_TYPE.CEK_TAHSILATI
      : BANK_TRANSACTION_TYPE.CEK_ODEMESI;
  }
  if (t === BANK_TRANSACTION_TYPE.VIRMAN) {
    return BANK_TRANSACTION_TYPE.BANKA_ICI_VIRMAN;
  }
  if (t === BANK_TRANSACTION_TYPE.NAKIT_CEKIM) {
    return BANK_TRANSACTION_TYPE.NAKIT_CEKME;
  }
  if (t === BANK_TRANSACTION_TYPE.CARI_TAHSILAT) {
    return BANK_TRANSACTION_TYPE.MUSTERI_TAHSILAT;
  }
  if (t === BANK_TRANSACTION_TYPE.CARI_ODEME) {
    return BANK_TRANSACTION_TYPE.TEDARIKCI_ODEME;
  }
  if (t === BANK_TRANSACTION_TYPE.TURIZM_VERGISI) {
    return BANK_TRANSACTION_TYPE.TURIZM_PAYI;
  }
  if (t === BANK_TRANSACTION_TYPE.CEZA) {
    return BANK_TRANSACTION_TYPE.TRAFIK_CEZASI;
  }
  return t || BANK_TRANSACTION_TYPE.BILINMEYEN;
}

function detectPosType(text, direction) {
  if (!text.includes("POS") && !text.includes("UYE ISYERI") && !text.includes("BKM")) {
    return null;
  }
  if (
    text.includes("POS KOMISYON") ||
    text.includes("POS KOM") ||
    (text.includes("POS") && text.includes("KOMISYON")) ||
    text.includes("BKM KOMISYON")
  ) {
    return BANK_TRANSACTION_TYPE.POS_KOMISYON;
  }
  if (text.includes("POS IADE") || text.includes("POS IPTAL") || text.includes("POS REFUND")) {
    return BANK_TRANSACTION_TYPE.POS_IADE;
  }
  if (
    text.includes("POS BLOKE COZUM") ||
    text.includes("BLOKE COZUM") ||
    text.includes("POS COZUM") ||
    text.includes("POS VIRMAN")
  ) {
    return BANK_TRANSACTION_TYPE.POS_COZUM;
  }
  if (text.includes("BLOKE POS") || text.includes("POS BLOKE")) {
    return BANK_TRANSACTION_TYPE.POS_BLOKE;
  }
  if (
    text.includes("ERTESI GUN POS") ||
    text.includes("POS ERTESI") ||
    text.includes("NEXT DAY POS")
  ) {
    return BANK_TRANSACTION_TYPE.POS_ERTESI_GUN;
  }
  if (
    text.includes("POS BATCH") ||
    text.includes("POS GUN SONU") ||
    text.includes("POS TOPLU") ||
    text.includes("BATCH POS") ||
    text.includes("GUNSONU POS")
  ) {
    return BANK_TRANSACTION_TYPE.POS_BATCH_TAHSILAT;
  }
  if (text.includes("SANAL POS")) {
    return BANK_TRANSACTION_TYPE.POS_SANAL;
  }
  if (
    text.includes("POS TAHSILAT") ||
    text.includes("POS SATIS") ||
    (direction === "GIRIS" && text.includes("POS"))
  ) {
    return BANK_TRANSACTION_TYPE.POS_TAHSILAT;
  }
  return null;
}

function detectVergiSgkType(text) {
  if (text.includes("TRAFIK CEZA") || text.includes("TRAFIK CEZASI") || text.includes("EGM CEZA")) {
    return BANK_TRANSACTION_TYPE.TRAFIK_CEZASI;
  }
  if (text.includes("GECIKME ZAMMI") || text.includes("GECIKME FAIZ")) {
    return BANK_TRANSACTION_TYPE.GECIKME_ZAMMI;
  }
  if (text.includes("VERGI CEZA") || (text.includes("CEZA") && text.includes("VERGI"))) {
    return BANK_TRANSACTION_TYPE.VERGI_CEZASI;
  }
  if (text.includes("MUHSGK")) return BANK_TRANSACTION_TYPE.MUHSGK;
  if (text.includes("SGK") || text.includes("SOSYAL GUVENLIK") || text.includes("BAGKUR")) {
    return BANK_TRANSACTION_TYPE.SGK;
  }
  if (text.includes("KDV2")) return BANK_TRANSACTION_TYPE.KDV2;
  if (/\bKDV\b/.test(text)) return BANK_TRANSACTION_TYPE.KDV;
  if (text.includes("KONAKLAMA VERGI")) return BANK_TRANSACTION_TYPE.KONAKLAMA_VERGISI;
  if (text.includes("TURIZM PAY") || text.includes("TURIZM VERGI")) {
    return BANK_TRANSACTION_TYPE.TURIZM_PAYI;
  }
  if (text.includes("DAMGA VERGI") || (text.includes("DAMGA") && text.includes("VERGI"))) {
    return BANK_TRANSACTION_TYPE.DAMGA_VERGISI;
  }
  if (text.includes("ODA AIDAT") || text.includes("MESLEK ODASI")) {
    return BANK_TRANSACTION_TYPE.ODA_AIDATI;
  }
  if (text.includes("EMLAK VERGI") || text.includes("EMLAK")) {
    return BANK_TRANSACTION_TYPE.EMLAK_VERGISI;
  }
  if (text.includes("MTV")) return BANK_TRANSACTION_TYPE.MTV;
  if (
    text.includes("VERGI") ||
    text.includes("MUHTASAR") ||
    text.includes("GIB") ||
    text.includes("IVD") ||
    text.includes("STOPAJ")
  ) {
    return BANK_TRANSACTION_TYPE.VERGI;
  }
  return null;
}

function detectCekType(text, direction) {
  if (!text.includes("CEK") || text.includes("CEKIM") || text.includes("CEKME")) {
    return null;
  }
  // Çek tahsili / alınan çek
  if (
    text.includes("CEK TAHSIL") ||
    text.includes("ALINAN CEK") ||
    text.includes("CEK YATIR") ||
    (direction === "GIRIS" && text.includes("CEK"))
  ) {
    return BANK_TRANSACTION_TYPE.CEK_TAHSILATI;
  }
  // Verilen çek ödemesi (bankadan çıkan)
  if (
    text.includes("CEK ODEME") ||
    text.includes("CEK BEDEL") ||
    text.includes("VERILEN CEK") ||
    text.includes("CEK ODEMESI") ||
    (direction === "CIKIS" && text.includes("CEK"))
  ) {
    return BANK_TRANSACTION_TYPE.CEK_ODEMESI;
  }
  return direction === "GIRIS"
    ? BANK_TRANSACTION_TYPE.CEK_TAHSILATI
    : BANK_TRANSACTION_TYPE.CEK_ODEMESI;
}

function detectKasaType(text, direction) {
  const kasaYatir =
    text.includes("KASADAN YATAN") ||
    text.includes("KASA YATIRMA") ||
    text.includes("KASADAN BANKAYA") ||
    text.includes("TARIHLI KASA") ||
    (text.includes("KASA") && text.includes("YATAN"));
  const kasaCek =
    text.includes("BANKADAN KASAYA") ||
    text.includes("KASAYA CEK") ||
    text.includes("KASA CEKIM") ||
    (text.includes("KASA") && (text.includes("CEKILEN") || text.includes("CEKME")));

  if (kasaYatir) return BANK_TRANSACTION_TYPE.KASA_BANKAYA_YATAN;
  if (kasaCek) return BANK_TRANSACTION_TYPE.BANKADAN_KASAYA_CEKILEN;
  if (text.includes("KASA") && direction === "GIRIS") {
    return BANK_TRANSACTION_TYPE.KASA_BANKAYA_YATAN;
  }
  if (text.includes("KASA") && direction === "CIKIS") {
    return BANK_TRANSACTION_TYPE.BANKADAN_KASAYA_CEKILEN;
  }
  return null;
}

function detectFinanceType(text, direction) {
  if (text.includes("TERS REPO")) return BANK_TRANSACTION_TYPE.TERS_REPO;
  if (/\bREPO\b/.test(text)) return BANK_TRANSACTION_TYPE.REPO;
  if (
    text.includes("FON ALIS") ||
    text.includes("YATIRIM FONU ALIS") ||
    (text.includes("FON") && text.includes("ALIS"))
  ) {
    return BANK_TRANSACTION_TYPE.FON_ALIS;
  }
  if (
    text.includes("FON SATIS") ||
    text.includes("YATIRIM FONU SATIS") ||
    (text.includes("FON") && text.includes("SATIS"))
  ) {
    return BANK_TRANSACTION_TYPE.FON_SATIS;
  }
  if (
    text.includes("BANKALAR ARASI") ||
    text.includes("BANKA ARASI VIRMAN") ||
    text.includes("DIGER BANKA")
  ) {
    return BANK_TRANSACTION_TYPE.BANKALAR_ARASI_VIRMAN;
  }
  if (
    text.includes("VIRMAN") ||
    text.includes("HESAPLAR ARASI") ||
    text.includes("ACCOUNT TRANSFER") ||
    text.includes("BANKA ICI")
  ) {
    return BANK_TRANSACTION_TYPE.BANKA_ICI_VIRMAN;
  }
  if (
    text.includes("KMH FAIZ") ||
    text.includes("EK HESAP FAIZ") ||
    text.includes("KMH TAHAKKUK") ||
    text.includes("EK HESAP TAHAKKUK")
  ) {
    return BANK_TRANSACTION_TYPE.KMH_FAIZ;
  }
  if (text.includes("EK HESAP KAPAMA") || text.includes("KMH KAPAMA")) {
    return BANK_TRANSACTION_TYPE.EK_HESAP_KAPAMA;
  }
  if (
    text.includes("KREDI KULLANIM") ||
    text.includes("KREDI KULLANDIRIM") ||
    text.includes("KREDI ODEME ALINDI")
  ) {
    return BANK_TRANSACTION_TYPE.KREDI_KULLANIM;
  }
  if (
    text.includes("KREDI ANAPARA") ||
    text.includes("ANAPARA ODEME") ||
    (text.includes("KREDI") && text.includes("ANAPARA"))
  ) {
    return BANK_TRANSACTION_TYPE.KREDI_ANAPARA;
  }
  if (
    text.includes("KREDI FAIZ") ||
    (text.includes("KREDI") && text.includes("FAIZ") && !text.includes("KART"))
  ) {
    return BANK_TRANSACTION_TYPE.KREDI_FAIZ;
  }
  if (text.includes("KUR FARK")) return BANK_TRANSACTION_TYPE.KUR_FARKI;
  if (text.includes("FAIZ GELIR") || text.includes("MEVDUAT FAIZ") || text.includes("FAIZ TAHSIL")) {
    return BANK_TRANSACTION_TYPE.FAIZ_GELIRI;
  }
  if (text.includes("FAIZ GIDER") || text.includes("FAIZ ODEME")) {
    return BANK_TRANSACTION_TYPE.FAIZ_GIDERI;
  }
  if (
    text.includes("DOVIZ ALIS") ||
    text.includes("FX ALIS") ||
    (text.includes("DOVIZ") && direction === "CIKIS" && text.includes("ALIS"))
  ) {
    return BANK_TRANSACTION_TYPE.DOVIZ_ALIS;
  }
  if (
    text.includes("DOVIZ SATIS") ||
    text.includes("FX SATIS") ||
    (text.includes("DOVIZ") && direction === "GIRIS" && text.includes("SATIS"))
  ) {
    return BANK_TRANSACTION_TYPE.DOVIZ_SATIS;
  }
  if (text.includes("DOVIZ")) {
    return direction === "CIKIS"
      ? BANK_TRANSACTION_TYPE.DOVIZ_SATIS
      : BANK_TRANSACTION_TYPE.DOVIZ_ALIS;
  }
  if (text.includes("NAKIT CEKIM") || text.includes("ATM CEKIM") || text.includes("PARA CEKME")) {
    return BANK_TRANSACTION_TYPE.NAKIT_CEKME;
  }
  if (
    text.includes("NAKIT YATIRMA") ||
    text.includes("ATM YATIRMA") ||
    text.includes("PARA YATIRMA")
  ) {
    return BANK_TRANSACTION_TYPE.NAKIT_YATIRMA;
  }
  return null;
}

function detectFromText(description = "", direction = "") {
  const text = normalizeParserText(description);
  if (!text) return BANK_TRANSACTION_TYPE.BILINMEYEN;

  const pos = detectPosType(text, direction);
  if (pos) return pos;

  if (
    text.includes("HAVALE/EFT MASRAF") ||
    text.includes("HAVALE EFT MASRAF") ||
    text.includes("EFT MASRAF") ||
    text.includes("HAVALE MASRAF") ||
    text.includes("BKM UCR") ||
    text.includes("HESAP ISLETIM")
  ) {
    return BANK_TRANSACTION_TYPE.BANKA_MASRAFI;
  }
  if (/\bBSMV\b/.test(text)) {
    return BANK_TRANSACTION_TYPE.BSMV;
  }

  const cek = detectCekType(text, direction);
  if (cek) return cek;

  const kasa = detectKasaType(text, direction);
  if (kasa) return kasa;

  const vergi = detectVergiSgkType(text);
  if (vergi) return vergi;

  const finance = detectFinanceType(text, direction);
  if (finance) return finance;

  if (text.includes("KREDI KART") || text.includes("KK ODEME") || text.includes("EKSTRE BORC")) {
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
  if (text.includes("SENET") || text.includes("BONO")) {
    return BANK_TRANSACTION_TYPE.SENET;
  }

  // POS kelimesi havale’den önce — yanlış cari sınıflandırmayı engelle
  if (text.includes("POS")) {
    return direction === "CIKIS"
      ? BANK_TRANSACTION_TYPE.POS_KOMISYON
      : BANK_TRANSACTION_TYPE.POS_TAHSILAT;
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
    text.includes("MUSTERI TAHSILAT") ||
    text.includes("CARI TAHSILAT") ||
    (text.includes("CARI MAHSUP") && direction === "GIRIS")
  ) {
    return BANK_TRANSACTION_TYPE.MUSTERI_TAHSILAT;
  }
  if (
    text.includes("TEDARIKCI ODEME") ||
    text.includes("CARI ODEME") ||
    (text.includes("CARI MAHSUP") && direction === "CIKIS")
  ) {
    return BANK_TRANSACTION_TYPE.TEDARIKCI_ODEME;
  }

  if (hasReminderDescriptionLanguage(text)) {
    return direction === "GIRIS"
      ? BANK_TRANSACTION_TYPE.MUSTERI_TAHSILAT
      : BANK_TRANSACTION_TYPE.TEDARIKCI_ODEME;
  }

  return BANK_TRANSACTION_TYPE.BILINMEYEN;
}

function mapSystemFamilyToType(system, description, direction) {
  if (!system?.id) return BANK_TRANSACTION_TYPE.BILINMEYEN;
  if (system.id === "doviz") {
    return direction === "CIKIS"
      ? BANK_TRANSACTION_TYPE.DOVIZ_SATIS
      : BANK_TRANSACTION_TYPE.DOVIZ_ALIS;
  }
  if (system.id === "sgk") {
    const text = normalizeParserText(description);
    return text.includes("MUHSGK")
      ? BANK_TRANSACTION_TYPE.MUHSGK
      : BANK_TRANSACTION_TYPE.SGK;
  }
  if (system.id === "vergi") {
    return detectVergiSgkType(normalizeParserText(description)) || BANK_TRANSACTION_TYPE.VERGI;
  }
  if (system.id === "mtv-emlak-aidat") {
    const text = normalizeParserText(description);
    if (text.includes("ODA AIDAT") || text.includes("MESLEK ODASI")) {
      return BANK_TRANSACTION_TYPE.ODA_AIDATI;
    }
    if (text.includes("EMLAK")) return BANK_TRANSACTION_TYPE.EMLAK_VERGISI;
    return BANK_TRANSACTION_TYPE.MTV;
  }
  return FAMILY_ID_TO_TYPE[system.id] || BANK_TRANSACTION_TYPE.BILINMEYEN;
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
  const profile = globalThis.__ANNVERO_ANALYSIS_PROFILE__;
  const started = profile?.enabled ? performance.now() : 0;
  const system = matchSafeSystemBankRule(description, direction, context);
  let transactionType = BANK_TRANSACTION_TYPE.BILINMEYEN;
  let source = "heuristic";
  let familyId = "";

  // Metin önce: POS/finans/vergi yanlışlıkla havale ailesine düşmesin
  const textFirst = detectFromText(description, direction);
  if (POS_TYPES.has(textFirst) || FINANCE_TYPES.has(textFirst) || VERGI_SGK_TYPES.has(textFirst)) {
    transactionType = textFirst;
    source = "textHeuristic";
  }

  if (system?.id && transactionType === BANK_TRANSACTION_TYPE.BILINMEYEN) {
    familyId = system.id;
    source = "safeSystemFamily";
    transactionType = mapSystemFamilyToType(system, description, direction);
  } else if (system?.id && POS_TYPES.has(transactionType)) {
    // POS tipini koru; aile id bilgisini ekle
    familyId = system.id;
  }

  // Aidat/MTV ailesi: serbest “aidat” + hatırlatma → cari ödeme
  if (
    (transactionType === BANK_TRANSACTION_TYPE.MTV ||
      transactionType === BANK_TRANSACTION_TYPE.ODA_AIDATI) &&
    hasReminderDescriptionLanguage(description) &&
    !/\b(MTV|EMLAK|BELEDIYE|MESLEK ODASI|ODA AIDAT)\b/i.test(
      normalizeParserText(description)
    )
  ) {
    transactionType =
      direction === "GIRIS"
        ? BANK_TRANSACTION_TYPE.MUSTERI_TAHSILAT
        : BANK_TRANSACTION_TYPE.TEDARIKCI_ODEME;
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

  if (transactionType === BANK_TRANSACTION_TYPE.BILINMEYEN) {
    transactionType = detectFromText(description, direction);
  }

  transactionType = canonicalizeTransactionType(transactionType, direction);

  let cariRequired = CARI_REQUIRED_TYPES.has(transactionType);
  const personelRequired = PERSONEL_REQUIRED_TYPES.has(transactionType);

  if (
    !cariRequired &&
    !personelRequired &&
    !isDirectExpenseAllowedType(transactionType) &&
    !isCariForbiddenForType(transactionType) &&
    hasReminderDescriptionLanguage(description)
  ) {
    transactionType =
      direction === "GIRIS"
        ? BANK_TRANSACTION_TYPE.MUSTERI_TAHSILAT
        : BANK_TRANSACTION_TYPE.TEDARIKCI_ODEME;
    cariRequired = true;
    source = "reminderCari";
  }

  // POS / finans / vergi / çek / kasa / virman asla cari gerektirmez
  if (isCariForbiddenForType(transactionType)) {
    cariRequired = false;
  }

  if (profile?.enabled) {
    const elapsed = performance.now() - started;
    profile.txTypeDetectCount += 1;
    profile.txTypeDetectTotalMs += elapsed;
    profile.functionMs.resolveBankTransactionType =
      (profile.functionMs.resolveBankTransactionType || 0) + elapsed;
  }

  return {
    transactionType,
    cariRequired,
    personelRequired,
    source,
    familyId,
    systemMatch: system,
    /** Mapper ikinci matchSafeSystemBankRule çağrısını engeller (null olsa bile). */
    systemRuleResolved: true,
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

export function isPosType(transactionType = "") {
  return POS_TYPES.has(String(transactionType || ""));
}

export function isFinanceType(transactionType = "") {
  return FINANCE_TYPES.has(String(transactionType || ""));
}

export function isCekType(transactionType = "") {
  return CEK_TYPES.has(String(transactionType || ""));
}

export function isKasaType(transactionType = "") {
  return KASA_TYPES.has(String(transactionType || ""));
}

export function isVirmanType(transactionType = "") {
  return VIRMAN_TYPES.has(String(transactionType || ""));
}

/** Eksik hesap kategorisi için işlem türüne göre varsayılan etiket */
export function missingCategoryForTransactionType(transactionType = "") {
  const type = String(transactionType || "");
  if (isPosType(type)) return "POS/komisyon ayrımı çözülemedi";
  if (isCekType(type)) return "Çek hesabı 101/103 eksik";
  if (isKasaType(type)) return "Kasa hesabı 100 eksik";
  if (isVergiSgkType(type)) return "Vergi/SGK türü çözülemedi";
  if (isFinanceType(type)) return "Finans işlem türü çözülemedi";
  if (isPersonelRequiredForType(type)) return "Personel bulunamadı";
  if (
    type === BANK_TRANSACTION_TYPE.BANKA_MASRAFI ||
    type === BANK_TRANSACTION_TYPE.BSMV
  ) {
    return "Hesap planında önerilen kod yok";
  }
  if (isCariRequiredForType(type)) return "Cari bulunamadı";
  return "Diğer";
}
