/**
 * Merkezi Muhasebe Standart Motoru — Luca / Parser / CORE ortak açıklama üretimi.
 * Parser veya sayfa kendi kafasına göre açıklama üretmemeli; buradan almalı.
 */
import { normalizeParserText } from "@/src/utils/textNormalize";

export const STANDARD_MASRAF_DESCRIPTION = "HAVALE / EFT MASRAFI";
export const STANDARD_POS_TAHSILATI = "POS TAHSİLATI";
export const STANDARD_POS_BATCH_TAHSILATI = "POS BATCH TAHSİLATI";
export const STANDARD_POS_KOMISYONU = "POS KOMİSYONU";
export const STANDARD_DOVIZ = "DÖVİZ ALIŞ / SATIŞ İŞLEMİ";
export const STANDARD_SGK = "SGK ÖDEMESİ";
export const STANDARD_VERGI = "VERGİ ÖDEMESİ";
export const STANDARD_VIRMAN = "VİRMAN";
export const STANDARD_TRAFIK = "TRAFİK CEZASI ÖDEMESİ";
export const STANDARD_CEK = "ÇEK ÖDEMESİ";

function cleanChannelPrefixes(raw) {
  return String(raw || "")
    .replace(/^INT[-\s]*/i, "")
    .replace(/^MOBİL[-\s]*/i, "")
    .replace(/^MOBIL[-\s]*/i, "")
    .replace(/^CEP ŞUBE[-\s]*/i, "")
    .replace(/^CEP SUBE[-\s]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolvePartyName(row, cleanedDescription) {
  const explicit = String(
    row.partyName ||
      row.entityName ||
      row.cariUnvan ||
      row.unvan ||
      row.personelAdi ||
      row.matchedAccountName ||
      row.hesapAdi ||
      row.accountName ||
      ""
  )
    .replace(/\s+/g, " ")
    .trim();

  if (explicit) return explicit.slice(0, 120);
  return String(cleanedDescription || "").slice(0, 120) || "—";
}

function isMasrafText(text) {
  if (text.includes("POS")) return false;
  return (
    text.includes("HAVALE EFT MASRAF") ||
    text.includes("HAVALE MASRAF") ||
    text.includes("EFT MASRAF") ||
    text.includes("BSMV") ||
    text.includes("KESINTI") ||
    text.includes("BKM UCR") ||
    (text.includes("MASRAF") && !text.includes("AVANS")) ||
    text.includes("KOMISYON")
  );
}

function isPosBatchText(text) {
  return (
    text.includes("POS") &&
    (text.includes("BATCH") || text.includes("TOPLU") || text.includes("GUN SONU"))
  );
}

/**
 * Banka hareketinden standart Luca açıklaması üretir.
 * @param {object} row - aciklama/description, yon/direction, isteğe bağlı partyName/unvan
 * @param {object} [options]
 * @param {string} [options.islemTipi] - Luca tarafı işlem tipi ipucu (GELEN/GIDEN/POS/…)
 */
export function buildStandardLucaDescription(row = {}, options = {}) {
  const raw = String(row.aciklama || row.description || row.rawDescription || "");
  const text = normalizeParserText(raw);
  const tip = normalizeParserText(options.islemTipi || row.islemTipi || "");
  const direction = row.yon || row.direction;
  const temiz = cleanChannelPrefixes(raw);
  const party = resolvePartyName(row, temiz);

  if (tip.includes("POS BATCH") || isPosBatchText(text)) {
    return STANDARD_POS_BATCH_TAHSILATI;
  }

  if (
    tip.includes("POS KOMISYONU") ||
    (text.includes("POS") && (text.includes("KOMISYON") || direction === "CIKIS"))
  ) {
    return STANDARD_POS_KOMISYONU;
  }

  if (tip.includes("POS TAHSILATI") || (text.includes("POS") && direction === "GIRIS")) {
    return STANDARD_POS_TAHSILATI;
  }

  if (text.includes("POS") && !direction) {
    return STANDARD_POS_TAHSILATI;
  }

  if (isMasrafText(text) || (tip.includes("MASRAF") && !tip.includes("POS"))) {
    return STANDARD_MASRAF_DESCRIPTION;
  }

  if (tip.includes("TRAFIK") || text.includes("TRAFIK")) return STANDARD_TRAFIK;
  if (tip.includes("SGK") || text.includes("SGK")) return STANDARD_SGK;
  if (tip.includes("VERGI") || text.includes("VERGI")) return STANDARD_VERGI;
  if (tip.includes("CEK") || text.includes("CEK ODEME") || text.includes("CEK")) {
    return STANDARD_CEK;
  }
  if (text.includes("DOVIZ") || tip.includes("DOVIZ")) return STANDARD_DOVIZ;
  if (text.includes("KENDI HESABIMIZA") || tip.includes("VIRMAN")) return STANDARD_VIRMAN;

  const isMaas =
    tip.includes("MAAS") ||
    text.includes("MAAS") ||
    text.includes("BORDRO") ||
    text.includes("PERSONEL UCRET");
  const isAvans = tip.includes("AVANS") || text.includes("AVANS");
  const isPersonelHint =
    isMaas ||
    text.includes("PERSONEL") ||
    text.includes("CALISAN") ||
    Boolean(row.personelAdi);

  if (isAvans && (isMaas || isPersonelHint)) {
    return `GÖND. HVL / ${party} avans ödemesi`;
  }

  if (isMaas) {
    return `GÖND. HVL / ${party} maaş ödemesi`;
  }

  if (isAvans) {
    return `GÖND. HVL / ${party} avans`;
  }

  if (tip.includes("GELEN") || direction === "GIRIS") {
    return `GLN. HVL / ${party}`;
  }

  if (tip.includes("GIDEN") || direction === "CIKIS") {
    return `GÖND. HVL / ${party}`;
  }

  return party;
}

/** Geriye dönük alias — bankMovementMapper / TEB gruplama */
export function buildFallbackLucaDescription(row = {}, options = {}) {
  return buildStandardLucaDescription(row, options);
}
