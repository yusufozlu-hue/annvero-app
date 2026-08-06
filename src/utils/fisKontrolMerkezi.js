/**
 * Fiş Kontrol Merkezi — StandardLucaRows üzerinde ortak kontrol motoru.
 * Banka / Luca / ElektraWeb / manuel kaynaklar aynı kanonik modele bağlanır.
 * Ham banka içeriği loglanmaz.
 */

import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { MEMORY_MATCH_LABEL } from "@/src/utils/previewRowEdit";
import { MEMORY_AUTO_APPLY_MIN_CONFIDENCE } from "@/src/utils/accountMemoryPolicy";
import { resolveSgkAccountingRole } from "@/src/utils/taxObligation/sgkRules.js";
import { ACCOUNTING_ROLE } from "@/src/utils/taxObligation/types.js";

export const KONTROL_SEVIYE = {
  HATA: "Hata",
  UYARI: "Uyarı",
  BILGI: "Bilgi",
};

/** Kullanıcıya gösterilen aktarım durumu */
export const KONTROL_DURUM = {
  GECTI: "Geçti",
  UYARI: "Uyarı",
  HATA: "Hata",
};

export const DUPLICATE_VOUCHER_UI_MESSAGE =
  "Mükerrer kayıt — yeniden işlenmedi";

export const LUCA_FIS_GROUP_SIZE = 50;
export { MEMORY_AUTO_APPLY_MIN_CONFIDENCE };

export const KONTROL_TIP = {
  EKSIK_HESAP: "Eksik hesap kodu",
  HESAP_PLANINDA_YOK: "Hesap planında yok",
  EKSIK_ACIKLAMA: "Eksik açıklama",
  DENGESIZ_FIS: "Dengesiz fiş",
  FIS_BORC_ALACAK_ESIT_DEGIL: "Fiş borç/alacak eşit değil",
  MUKERRER_EVRAK: "Mükerrer evrak no",
  MUKERRER_HAREKET: "Tekrarlayan hareket",
  MUKERRER_KAYNAK: "Mükerrer kaynak hareket",
  MUKERRER_FIS: "Mükerrer fiş",
  EKSIK_BELGE_TURU: "Belge türü eksik",
  GECERSIZ_BELGE_TURU: "Geçersiz belge türü",
  EKSIK_FIS_NO: "Fiş numarası eksik",
  HATALI_TARIH: "Tarih formatı hatalı",
  TARIH_SIRASI: "Tarih sırası uyumsuz",
  DONEM_UYUMSUZ: "Dönem uyumsuz",
  KAPALI_DONEM: "Kapanmış dönem",
  BORC_ALACAK_IKISI_DOLU: "Borç/alacak aynı anda dolu",
  BORC_ALACAK_IKISI_BOS: "Borç/alacak ikisi de boş",
  TERS_BORC_ALACAK: "Ters borç/alacak kullanımı",
  NEGATIF_TUTAR: "Negatif tutar",
  SIFIR_TUTAR: "Sıfır tutar",
  DOVIZ_KUR: "Döviz kur/tutar tutarsız",
  LUCA_GRUP_50: "50 fişlik Luca gruplama",
  FIS_NO_SIRASI: "Fiş numarası sırası",
  VERGI_360: "360 vergi dağılımı",
  SGK_361: "361 SGK dağılımı",
  SGDP_AYRIM: "SGDP ayrımı",
  GECIKME_KARIŞIM: "Gecikme zammı karışımı",
  MTV_EMLAK_ITO: "MTV/Emlak/İTO taksit",
  TAHAKKUK_ODEME: "Ödeme belgesi tahakkuk sayıldı",
  BELGE_KURAL: "Belge türü kuralı",
  MAAS_AVANS: "Maaş/avans hesabı",
  POS_KK: "POS/kredi kartı hesabı",
  ACIKLAMA_STANDART: "Açıklama standardı",
  DUSUK_GUVEN: "Düşük güven skoru",
  OGRENEN_HAFIZA: "Öğrenen hafıza",
  TENANT: "Firma kapsamı",
};

const VALID_BELGE_TURLERI = new Set([
  "EA",
  "EF",
  "NM",
  "DK",
  "SM",
  "SMM",
  "MS",
  "DF",
  "HS",
  "DM",
  "KD",
]);

function compactText(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/\s+/g, "");
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getRowDescription(row) {
  return String(row.detayAciklama || row.fisAciklama || row.aciklama || "").trim();
}

function isValidLucaDateString(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(text)) return false;
  return Boolean(parseDateTR(text));
}

function createIssue(type, seviye, message) {
  return { type, seviye, message };
}

function resolveRiskSeviyesi(issues = []) {
  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.HATA)) return "Yüksek";
  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.UYARI)) return "Orta";
  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.BILGI)) return "Düşük";
  return "Temiz";
}

function resolvePrimarySeviye(issues = []) {
  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.HATA)) {
    return KONTROL_SEVIYE.HATA;
  }
  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.UYARI)) {
    return KONTROL_SEVIYE.UYARI;
  }
  if (issues.some((issue) => issue.seviye === KONTROL_SEVIYE.BILGI)) {
    return KONTROL_SEVIYE.BILGI;
  }
  return "Temiz";
}

function resolveKontrolDurum(seviye) {
  if (seviye === KONTROL_SEVIYE.HATA) return KONTROL_DURUM.HATA;
  if (seviye === KONTROL_SEVIYE.UYARI) return KONTROL_DURUM.UYARI;
  return KONTROL_DURUM.GECTI;
}

function buildKontrolNotu(issues = [], existingNote = "") {
  const messages = issues.map((issue) => issue.message).filter(Boolean);
  const existing = String(existingNote || "").trim();
  if (existing && !messages.includes(existing)) messages.unshift(existing);
  return messages.join(" · ");
}

function getRowAmount(row) {
  const borc = parseMoneyTR(row.borc);
  const alacak = parseMoneyTR(row.alacak);
  return borc > 0 ? borc : alacak;
}

function fingerprint(text = "") {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Ortak kanonik fiş satırı — tüm kaynaklar buraya normalize edilir.
 */
export function toCanonicalVoucherRow(row = {}, context = {}) {
  const firmaId = String(
    row.firmaId || row.companyId || context.firmaId || context.companyId || ""
  ).trim();
  const sourceMovementId = String(
    row.sourceMovementId || row._movementId || row.kaynakHareketId || ""
  ).trim();
  const fisTarihi = formatDateTR(row.fisTarihi || row.tarih || "");
  const aciklama = getRowDescription(row);
  const borc = parseMoneyTR(row.borc);
  const alacak = parseMoneyTR(row.alacak);
  const guvenSkoru = Number(
    row.guvenSkoru ?? row.hafizaGuvenSkoru ?? row.cariMatchConfidence ?? 100
  );
  const identityKey = fingerprint(
    [
      firmaId,
      compactText(fisTarihi),
      getRowAmount(row).toFixed(2),
      compactText(aciklama),
      compactText(row.hesapKodu),
      compactText(row.belgeTuru),
      compactText(row.evrakNo || row.belgeNo),
      sourceMovementId,
    ].join("|")
  );

  return {
    firmaId,
    companyId: firmaId,
    fisTarihi,
    fisNo: row.fisNo ?? "",
    belgeTuru: String(row.belgeTuru || "").trim().toUpperCase(),
    belgeNo: String(row.belgeNo || row.evrakNo || "").trim(),
    evrakNo: String(row.evrakNo || row.belgeNo || "").trim(),
    hesapKodu: String(row.hesapKodu || "").trim(),
    hesapAdi: String(row.hesapAdi || "").trim(),
    borc: borc || "",
    alacak: alacak || "",
    aciklama,
    fisAciklama: String(row.fisAciklama || aciklama).trim(),
    detayAciklama: String(row.detayAciklama || aciklama).trim(),
    paraBirimi: String(row.paraBirimi || row.currency || "TRY").toUpperCase(),
    kur: row.kur != null && row.kur !== "" ? Number(row.kur) : null,
    kaynakBelgeId: String(row.kaynakBelgeId || row.sourceFileHash || "").trim(),
    kaynakHareketId: sourceMovementId,
    sourceMovementId,
    guvenSkoru: Number.isFinite(guvenSkoru) ? guvenSkoru : 100,
    kontrolDurumu: row.kontrolDurumu || null,
    ogrenme: {
      hafizaEslesme: Boolean(row.hafizaEslesme),
      accountMemoryId: row.accountMemoryId || row.matchedMemoryId || null,
      manuallyEdited: Boolean(row.manuallyEdited),
    },
    identityKey,
    kaynakTipi: row.kaynakTipi || context.kaynakTipi || "",
    kaynakAdi: row.kaynakAdi || context.kaynakAdi || "",
    transactionType: row.transactionType || "",
    id: row.id,
    _raw: row,
  };
}

export function buildSourceMovementFingerprint(row = {}, firmaId = "") {
  return toCanonicalVoucherRow(row, { firmaId }).identityKey;
}

function accountPlanHas(accountPlanCodes, code) {
  if (!accountPlanCodes || accountPlanCodes.size === 0) return true;
  const c = String(code || "").trim();
  if (!c) return false;
  if (accountPlanCodes.has(c)) return true;
  // leaf vs parent: allow exact or any plan code that starts with this leaf? Prefer exact.
  return false;
}

function parsePeriodKey(fisTarihi) {
  const d = parseDateTR(fisTarihi);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * @param {object[]} rows StandardLucaRows
 * @param {object} [options]
 * @param {string} [options.firmaId]
 * @param {Set<string>|string[]} [options.accountPlanCodes]
 * @param {Set<string>|string[]} [options.closedPeriods] // "YYYY-MM"
 * @param {Set<string>|string[]} [options.processedSourceKeys] // prior fingerprints
 * @param {boolean} [options.strictDocumentTypes]
 * @param {AbortSignal} [options.signal]
 */
export function analyzeStandardLucaRows(rows = [], options = {}) {
  if (options.signal?.aborted) {
    const err = new Error("Kontrol iptal edildi.");
    err.name = "AbortError";
    throw err;
  }

  const sourceRows = Array.isArray(rows) ? rows : [];
  const firmaId = String(options.firmaId || options.companyId || "").trim();
  const accountPlanCodes =
    options.accountPlanCodes instanceof Set
      ? options.accountPlanCodes
      : new Set(options.accountPlanCodes || []);
  const closedPeriods =
    options.closedPeriods instanceof Set
      ? options.closedPeriods
      : new Set(options.closedPeriods || []);
  const processedSourceKeys =
    options.processedSourceKeys instanceof Set
      ? options.processedSourceKeys
      : new Set(options.processedSourceKeys || []);

  const rowIssues = sourceRows.map(() => []);
  const duplicateMovementKeys = new Map();
  const duplicateEvrakNos = new Map();
  const duplicateSourceKeys = new Map();
  const duplicateFisKeys = new Map();
  const fisTotals = new Map();
  const fisDateOrder = [];

  sourceRows.forEach((row, index) => {
    if (options.signal?.aborted) {
      const err = new Error("Kontrol iptal edildi.");
      err.name = "AbortError";
      throw err;
    }

    const canon = toCanonicalVoucherRow(row, { firmaId });
    const hesapKodu = canon.hesapKodu;
    const aciklama = canon.aciklama;
    const fisTarihi = canon.fisTarihi;
    const belgeTuru = canon.belgeTuru;
    const evrakNo = canon.evrakNo;
    const borc = parseMoneyTR(row.borc);
    const alacak = parseMoneyTR(row.alacak);
    const existingNote = String(row.kontrolNotu || "").trim();
    const text = compactText(aciklama);

    if (firmaId && canon.firmaId && canon.firmaId !== firmaId) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.TENANT,
          KONTROL_SEVIYE.HATA,
          "Satır başka firmaya ait; bu oturumda işlenemez."
        )
      );
    }

    if (!hesapKodu) {
      rowIssues[index].push(
        createIssue(KONTROL_TIP.EKSIK_HESAP, KONTROL_SEVIYE.HATA, "Hesap kodu alanı boş.")
      );
    } else if (accountPlanCodes.size > 0 && !accountPlanHas(accountPlanCodes, hesapKodu)) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.HESAP_PLANINDA_YOK,
          KONTROL_SEVIYE.HATA,
          `Hesap kodu hesap planında bulunamadı: ${hesapKodu}`
        )
      );
    }

    if (!aciklama) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.EKSIK_ACIKLAMA,
          KONTROL_SEVIYE.HATA,
          "Detay açıklama ve fiş açıklama alanları boş."
        )
      );
    }

    if (!belgeTuru) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.EKSIK_BELGE_TURU,
          KONTROL_SEVIYE.HATA,
          "Belge türü alanı boş."
        )
      );
    } else if (
      options.strictDocumentTypes !== false &&
      !VALID_BELGE_TURLERI.has(belgeTuru)
    ) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.GECERSIZ_BELGE_TURU,
          KONTROL_SEVIYE.HATA,
          `Geçersiz belge türü: ${belgeTuru}`
        )
      );
    }

    if (String(row.fisNo ?? "").trim() === "") {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.EKSIK_FIS_NO,
          KONTROL_SEVIYE.UYARI,
          "Fiş numarası boş."
        )
      );
    }

    if (!fisTarihi) {
      rowIssues[index].push(
        createIssue(KONTROL_TIP.HATALI_TARIH, KONTROL_SEVIYE.HATA, "Fiş tarihi alanı boş.")
      );
    } else if (!isValidLucaDateString(fisTarihi)) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.HATALI_TARIH,
          KONTROL_SEVIYE.HATA,
          `Fiş tarihi geçersiz format: "${fisTarihi}". Beklenen: GG.AA.YYYY`
        )
      );
    } else {
      const period = parsePeriodKey(fisTarihi);
      if (period && closedPeriods.has(period)) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.KAPALI_DONEM,
            KONTROL_SEVIYE.HATA,
            `Kapanmış döneme kayıt yapılamaz: ${period}`
          )
        );
      }
      fisDateOrder.push({ index, date: parseDateTR(fisTarihi), fisNo: row.fisNo });
    }

    if (borc > 0 && alacak > 0) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.BORC_ALACAK_IKISI_DOLU,
          KONTROL_SEVIYE.HATA,
          "Aynı satırda hem borç hem alacak dolu."
        )
      );
    }
    if (borc <= 0 && alacak <= 0) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.BORC_ALACAK_IKISI_BOS,
          KONTROL_SEVIYE.HATA,
          "Borç ve alacak tutarları boş veya sıfır."
        )
      );
    }
    if (borc < 0 || alacak < 0) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.NEGATIF_TUTAR,
          KONTROL_SEVIYE.HATA,
          "Negatif tutarlı satır hatalı."
        )
      );
    }

    // Döviz
    const currency = canon.paraBirimi;
    if (currency && currency !== "TRY") {
      if (canon.kur == null || !(Number(canon.kur) > 0)) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.DOVIZ_KUR,
            KONTROL_SEVIYE.HATA,
            "Dövizli kayıtta kur eksik veya geçersiz."
          )
        );
      }
    }

    // Düşük güven — otomatik fiş/export engeli (Hata)
    if (
      Number.isFinite(canon.guvenSkoru) &&
      canon.guvenSkoru < MEMORY_AUTO_APPLY_MIN_CONFIDENCE &&
      row.accountMemoryAutoFilled
    ) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.DUSUK_GUVEN,
          KONTROL_SEVIYE.HATA,
          `Güven skoru düşük (${canon.guvenSkoru}); otomatik fiş üretilemez.`
        )
      );
    }

    // Belge kuralları (açıklama/kaynak ipuçları)
    if (/GIB|MDA|E[- ]?ARŞIV|EARSIV/i.test(aciklama) && belgeTuru && belgeTuru !== "EA") {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.BELGE_KURAL,
          KONTROL_SEVIYE.UYARI,
          "GİB/MDA belgeleri için belge türü EA olmalıdır."
        )
      );
    }
    if (/NOTER/i.test(aciklama) && belgeTuru && belgeTuru !== "NM") {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.BELGE_KURAL,
          KONTROL_SEVIYE.UYARI,
          "Noter belgeleri için belge türü NM olmalıdır."
        )
      );
    }
    if (
      /FATURA|E[- ]?FATURA|EFATURA/i.test(aciklama) &&
      !/GIB|MDA|E[- ]?ARŞIV|EARSIV/i.test(aciklama) &&
      belgeTuru &&
      belgeTuru !== "EF" &&
      belgeTuru !== "EA"
    ) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.BELGE_KURAL,
          KONTROL_SEVIYE.UYARI,
          "Diğer faturalar için belge türü EF olmalıdır."
        )
      );
    }

    // Maaş / avans / POS / KK
    if (/MAAS|MAAŞ|UCRET|ÜCRET/i.test(aciklama) && hesapKodu && !hesapKodu.startsWith("335")) {
      if (!/AVANS/i.test(aciklama)) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.MAAS_AVANS,
            KONTROL_SEVIYE.UYARI,
            "Maaş kayıtları genellikle 335 hesabına bağlanır."
          )
        );
      }
    }
    if (/MAAS\s*AVANS|MAAŞ\s*AVANS/i.test(aciklama) && hesapKodu && !hesapKodu.startsWith("196")) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.MAAS_AVANS,
          KONTROL_SEVIYE.UYARI,
          "Maaş avansı genellikle 196 hesabına bağlanır."
        )
      );
    }
    if (/IS\s*AVANS|İŞ\s*AVANS/i.test(aciklama) && hesapKodu && !hesapKodu.startsWith("195")) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.MAAS_AVANS,
          KONTROL_SEVIYE.UYARI,
          "İş avansı genellikle 195 hesabına bağlanır."
        )
      );
    }
    if (/\bPOS\b/i.test(aciklama) && hesapKodu && !hesapKodu.startsWith("108") && !/KOMISYON|GIDER|GİDER/i.test(aciklama)) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.POS_KK,
          KONTROL_SEVIYE.UYARI,
          "POS tahsilatları genellikle 108 hesabına bağlanır."
        )
      );
    }
    if (/KREDI\s*KART|KREDİ\s*KART/i.test(aciklama) && hesapKodu) {
      if (!hesapKodu.startsWith("309") && !hesapKodu.startsWith("409")) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.POS_KK,
            KONTROL_SEVIYE.UYARI,
            "Kredi kartı bakiyesi genellikle 309 (yıl sonunda 409) hesabına bağlanır."
          )
        );
      }
    }

    // Açıklama standartları (bilgi)
    if (/HAVALE|EFT/i.test(aciklama) && !/GLN\s*HVL|GOND\.?\s*HVL|GÖND\.?\s*HVL/i.test(aciklama)) {
      rowIssues[index].push(
        createIssue(
          KONTROL_TIP.ACIKLAMA_STANDART,
          KONTROL_SEVIYE.BILGI,
          "Havale açıklamalarında GLN HVL / GÖND. HVL standardı önerilir."
        )
      );
    }

    // Vergi 360 / SGK 361 / SGDP / gecikme
    if (hesapKodu.startsWith("360") || /KDV|MUHSGK|GECICI\s*VERGI|KURUMLAR|DAMGA|KONAKLAMA/i.test(aciklama)) {
      if (/GECIKME|GECİKME|CEZA/i.test(aciklama) && hesapKodu.startsWith("360") && !/689|780|770/.test(hesapKodu)) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.GECIKME_KARIŞIM,
            KONTROL_SEVIYE.HATA,
            "Gecikme zammı/cezası ana vergi hesabına (360) karıştırılmamalıdır."
          )
        );
      }
      if (hesapKodu === "360" || /^360\.0+$/.test(hesapKodu)) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.VERGI_360,
            KONTROL_SEVIYE.UYARI,
            "360 vergi türü dağılımı alt hesap gerektirebilir."
          )
        );
      }
    }

    if (hesapKodu.startsWith("361") || /SGK|SGDP|5510|6661|14857/i.test(aciklama)) {
      try {
        const role = resolveSgkAccountingRole({
          lawCode: /SGDP/i.test(aciklama) ? "SGDP" : /5510|6661|14857/.exec(aciklama)?.[0],
          description: aciklama,
        });
        if (role === ACCOUNTING_ROLE.SGDP && !/SGDP/i.test(hesapKodu) && hesapKodu.startsWith("361")) {
          rowIssues[index].push(
            createIssue(
              KONTROL_TIP.SGDP_AYRIM,
              KONTROL_SEVIYE.HATA,
              "SGDP yalnızca SGDP 361 paylarına bağlanmalıdır."
            )
          );
        }
      } catch {
        /* sgkRules opsiyonel */
      }
      if (/GECIKME|GECİKME|CEZA/i.test(aciklama) && hesapKodu.startsWith("361")) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.GECIKME_KARIŞIM,
            KONTROL_SEVIYE.HATA,
            "Gecikme zammı/cezası ana SGK prim hesabına karıştırılmamalıdır."
          )
        );
      }
    }

    // MTV / Emlak / İTO
    if (/\bMTV\b|EMLAK|İTO|\bITO\b/i.test(aciklama)) {
      if (!/1\.?\s*TAKSIT|2\.?\s*TAKSIT|1\.?\s*TAKSİT|2\.?\s*TAKSİT/i.test(aciklama)) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.MTV_EMLAK_ITO,
            KONTROL_SEVIYE.UYARI,
            "MTV/Emlak/İTO ödemelerinde 1. veya 2. taksit ayrımı belirtilmelidir."
          )
        );
      }
      if (/TAHAKKUK/i.test(aciklama) && /ODEME|ÖDEME/i.test(aciklama)) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.TAHAKKUK_ODEME,
            KONTROL_SEVIYE.HATA,
            "MTV/Emlak ödeme belgesi tahakkuk sayılmamalıdır."
          )
        );
      }
    }

    // Mükerrer kaynak hareket — aynı fişte borç+alacak bacakları
    // aynı sourceMovementId taşır (bankMovementToStandardLucaRows); bu mükerrer değil.
    if (canon.sourceMovementId) {
      const sk = `${firmaId}|${canon.sourceMovementId}`;
      if (processedSourceKeys.has(sk)) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.MUKERRER_KAYNAK,
            KONTROL_SEVIYE.HATA,
            DUPLICATE_VOUCHER_UI_MESSAGE
          )
        );
      } else if (duplicateSourceKeys.has(sk)) {
        const prev = sourceRows[duplicateSourceKeys.get(sk)];
        const sameFis =
          String(prev?.fisNo ?? "").trim() !== "" &&
          String(prev?.fisNo ?? "").trim() === String(row.fisNo ?? "").trim();
        const prevRole = String(prev?.lineRole || "").trim();
        const thisRole = String(row.lineRole || "").trim();
        const sameLegRole = Boolean(prevRole && thisRole && prevRole === thisRole);
        // Farklı fiş veya aynı fişte aynı bacak → gerçek mükerrer
        if (!sameFis || sameLegRole) {
          rowIssues[index].push(
            createIssue(
              KONTROL_TIP.MUKERRER_KAYNAK,
              KONTROL_SEVIYE.HATA,
              DUPLICATE_VOUCHER_UI_MESSAGE
            )
          );
        }
      } else {
        duplicateSourceKeys.set(sk, index);
      }
    }

    // Identity fingerprint mükerrer
    const prevFp = duplicateMovementKeys.get(canon.identityKey);
    if (prevFp !== undefined) {
      const prev = sourceRows[prevFp];
      const sameFis =
        String(prev?.fisNo ?? "").trim() !== "" &&
        String(prev?.fisNo ?? "").trim() === String(row.fisNo ?? "").trim();
      if (!sameFis) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.MUKERRER_HAREKET,
            KONTROL_SEVIYE.HATA,
            DUPLICATE_VOUCHER_UI_MESSAGE
          )
        );
      }
    } else {
      duplicateMovementKeys.set(canon.identityKey, index);
    }

    // legacy movement key (uyarı seviyesinde ek)
    const movementKey = [
      compactText(fisTarihi),
      getRowAmount(row).toFixed(2),
      compactText(aciklama),
    ].join("|");
    if (movementKey.replace(/\|/g, "").length > 0) {
      const previousIndex = duplicateMovementKeys.get(`legacy:${movementKey}`);
      const previousRow =
        previousIndex !== undefined ? sourceRows[previousIndex] : null;
      const sameFis =
        previousRow &&
        String(previousRow.fisNo ?? "").trim() !== "" &&
        String(previousRow.fisNo ?? "").trim() === String(row.fisNo ?? "").trim();
      const sameMovement =
        previousRow &&
        String(previousRow.sourceMovementId || previousRow._movementId || "").trim() &&
        String(previousRow.sourceMovementId || previousRow._movementId || "").trim() ===
          String(row.sourceMovementId || row._movementId || "").trim();
      if (previousIndex !== undefined && !sameFis && !sameMovement) {
        rowIssues[index].push(
          createIssue(
            KONTROL_TIP.MUKERRER_HAREKET,
            KONTROL_SEVIYE.UYARI,
            `Aynı tarih, tutar ve açıklama ${previousIndex + 1}. satır ile tekrar ediyor (Fiş ${previousRow?.fisNo || "—"}).`
          )
        );
      } else if (previousIndex === undefined) {
        duplicateMovementKeys.set(`legacy:${movementKey}`, index);
      }
    }

    if (evrakNo) {
      const evrakKey = compactText(evrakNo);
      const previousIndex = duplicateEvrakNos.get(evrakKey);
      if (previousIndex !== undefined) {
        const previousRow = sourceRows[previousIndex];
        const sameFis =
          String(previousRow?.fisNo ?? "").trim() === String(row.fisNo ?? "").trim();
        if (!sameFis) {
          rowIssues[index].push(
            createIssue(
              KONTROL_TIP.MUKERRER_EVRAK,
              KONTROL_SEVIYE.UYARI,
              `Evrak no "${evrakNo}" ${previousIndex + 1}. satırda da kullanılmış (Fiş ${previousRow?.fisNo || "—"}).`
            )
          );
        }
      } else {
        duplicateEvrakNos.set(evrakKey, index);
      }
    }

    const fisKey = String(row.fisNo ?? "").trim() || `ROW-${index + 1}`;
    if (!fisTotals.has(fisKey)) {
      fisTotals.set(fisKey, {
        fisNo: row.fisNo ?? "—",
        borc: 0,
        alacak: 0,
        rowIndexes: [],
      });
    }
    const fisTotal = fisTotals.get(fisKey);
    fisTotal.borc += borc;
    fisTotal.alacak += alacak;
    fisTotal.rowIndexes.push(index);

    if (row.hafizaEslesme) {
      rowIssues[index].push(
        createIssue(KONTROL_TIP.OGRENEN_HAFIZA, KONTROL_SEVIYE.BILGI, MEMORY_MATCH_LABEL)
      );
    } else if (
      existingNote &&
      !rowIssues[index].some((issue) => issue.seviye === KONTROL_SEVIYE.HATA)
    ) {
      rowIssues[index].push(
        createIssue(KONTROL_TIP.OGRENEN_HAFIZA, KONTROL_SEVIYE.BILGI, existingNote)
      );
    }
  });

  // Fiş no sıralı mı + 50'lik grup
  const numericFis = [...fisTotals.keys()]
    .map((k) => ({ key: k, n: Number(String(k).replace(/\D/g, "")) }))
    .filter((x) => Number.isFinite(x.n) && x.n > 0)
    .sort((a, b) => a.n - b.n);
  for (let i = 1; i < numericFis.length; i += 1) {
    if (numericFis[i].n < numericFis[i - 1].n) {
      const bad = fisTotals.get(numericFis[i].key);
      bad?.rowIndexes.forEach((rowIndex) => {
        rowIssues[rowIndex].push(
          createIssue(
            KONTROL_TIP.FIS_NO_SIRASI,
            KONTROL_SEVIYE.UYARI,
            "Fiş numaraları artan sırada değil."
          )
        );
      });
    }
  }
  if (numericFis.length > LUCA_FIS_GROUP_SIZE) {
    // Bilgi: gruplama kuralı — export tarafında 50'lik dilim
    const first = fisTotals.get(numericFis[0].key);
    first?.rowIndexes.slice(0, 1).forEach((rowIndex) => {
      rowIssues[rowIndex].push(
        createIssue(
          KONTROL_TIP.LUCA_GRUP_50,
          KONTROL_SEVIYE.BILGI,
          `Luca aktarımında ${LUCA_FIS_GROUP_SIZE}'lik fiş gruplaması uygulanır (${numericFis.length} fiş).`
        )
      );
    });
  }

  // Tarih sırası (fiş no artarken tarih geri gitmesin)
  const orderedByFis = numericFis
    .map((f) => {
      const idxs = fisTotals.get(f.key)?.rowIndexes || [];
      const row = sourceRows[idxs[0]];
      return { n: f.n, date: parseDateTR(row?.fisTarihi), idxs };
    })
    .filter((x) => x.date);
  for (let i = 1; i < orderedByFis.length; i += 1) {
    if (orderedByFis[i].date < orderedByFis[i - 1].date) {
      orderedByFis[i].idxs.forEach((rowIndex) => {
        rowIssues[rowIndex].push(
          createIssue(
            KONTROL_TIP.TARIH_SIRASI,
            KONTROL_SEVIYE.UYARI,
            "Fiş numarası sırasına göre tarih geriye gidiyor."
          )
        );
      });
    }
  }

  let unbalancedFisCount = 0;
  fisTotals.forEach((fisTotal) => {
    const diff = Math.abs(fisTotal.borc - fisTotal.alacak);
    if (diff <= 0.01) return;
    unbalancedFisCount += 1;
    const message = `Fiş ${fisTotal.fisNo}: borç ${formatMoney(fisTotal.borc)} / alacak ${formatMoney(fisTotal.alacak)} — fark ${formatMoney(diff)}.`;
    fisTotal.rowIndexes.forEach((rowIndex) => {
      rowIssues[rowIndex].push(
        createIssue(KONTROL_TIP.DENGESIZ_FIS, KONTROL_SEVIYE.HATA, message)
      );
      rowIssues[rowIndex].push(
        createIssue(
          KONTROL_TIP.FIS_BORC_ALACAK_ESIT_DEGIL,
          KONTROL_SEVIYE.HATA,
          "Fiş içinde borç ve alacak toplamları eşit değil."
        )
      );
    });
  });

  const enrichedRows = sourceRows.map((row, index) => {
    const issues = rowIssues[index];
    const riskSeviyesi = resolveRiskSeviyesi(issues);
    const seviye = resolvePrimarySeviye(issues);
    const kontrolDurumu = resolveKontrolDurum(seviye);
    const canon = toCanonicalVoucherRow(row, { firmaId });

    return {
      ...row,
      firmaId: canon.firmaId || row.firmaId || firmaId,
      guvenSkoru: canon.guvenSkoru,
      kontrolDurumu,
      identityKey: canon.identityKey,
      _kontrol: {
        rowIndex: index + 1,
        issues,
        riskSeviyesi,
        seviye,
        kontrolDurumu,
        kontrolNotu: buildKontrolNotu(issues, row.kontrolNotu),
        issueTypes: issues.map((issue) => issue.type),
        identityKey: canon.identityKey,
      },
    };
  });

  const flatIssues = enrichedRows.flatMap((row) =>
    row._kontrol.issues.map((issue) => ({
      ...issue,
      rowIndex: row._kontrol.rowIndex,
      rowId: row.id || `row-${row._kontrol.rowIndex}`,
      fisNo: row.fisNo ?? "—",
      fisTarihi: row.fisTarihi || "—",
      hesapKodu: row.hesapKodu || "—",
      aciklama: getRowDescription(row) || "—",
      tutar: formatMoney(getRowAmount(row)),
    }))
  );

  const hataRowIndexes = new Set(
    enrichedRows
      .filter((row) => row._kontrol.seviye === KONTROL_SEVIYE.HATA)
      .map((row) => row._kontrol.rowIndex)
  );
  const uyariRowCount = enrichedRows.filter(
    (row) => row._kontrol.seviye === KONTROL_SEVIYE.UYARI
  ).length;
  const gectiRowCount = enrichedRows.filter(
    (row) => row._kontrol.kontrolDurumu === KONTROL_DURUM.GECTI
  ).length;

  return {
    rows: enrichedRows,
    issues: flatIssues,
    summary: {
      totalRows: enrichedRows.length,
      totalFis: fisTotals.size,
      hataRowCount: hataRowIndexes.size,
      hataIssueCount: flatIssues.filter((issue) => issue.seviye === KONTROL_SEVIYE.HATA)
        .length,
      uyariIssueCount: flatIssues.filter((issue) => issue.seviye === KONTROL_SEVIYE.UYARI)
        .length,
      bilgiIssueCount: flatIssues.filter((issue) => issue.seviye === KONTROL_SEVIYE.BILGI)
        .length,
      temizRowCount: enrichedRows.filter((row) => row._kontrol.seviye === "Temiz").length,
      gectiRowCount,
      uyariRowCount,
      unbalancedFisCount,
      balanceStatus:
        unbalancedFisCount === 0 ? "Dengeli" : `${unbalancedFisCount} fiş dengesiz`,
      isBalanced: unbalancedFisCount === 0,
      canExport:
        hataRowIndexes.size === 0 ||
        enrichedRows.some((r) => r._kontrol.kontrolDurumu === KONTROL_DURUM.GECTI),
    },
  };
}

/** Yalnız Geçti satırları — Luca/ElektraWeb çıktısı için */
export function filterPassedRowsForExport(analysis) {
  return (analysis?.rows || []).filter(
    (row) => row._kontrol?.kontrolDurumu === KONTROL_DURUM.GECTI
  );
}

/** 50'lik fiş grupları — deterministik artan fisNo ile */
export function groupLucaFisBatches(rows = [], groupSize = LUCA_FIS_GROUP_SIZE) {
  const byFis = new Map();
  for (const row of rows || []) {
    const key = String(row.fisNo ?? "").trim() || "_";
    if (!byFis.has(key)) byFis.set(key, []);
    byFis.get(key).push(row);
  }
  const fisKeys = [...byFis.keys()].sort((a, b) => {
    const na = Number(String(a).replace(/\D/g, "")) || 0;
    const nb = Number(String(b).replace(/\D/g, "")) || 0;
    return na - nb || String(a).localeCompare(String(b), "tr");
  });
  const batches = [];
  for (let i = 0; i < fisKeys.length; i += groupSize) {
    const slice = fisKeys.slice(i, i + groupSize);
    batches.push(slice.flatMap((k) => byFis.get(k)));
  }
  return batches;
}

export function applySessionVoucherDedup(rows = [], existingKeys = new Set(), firmaId = "") {
  const prior = existingKeys instanceof Set ? existingKeys : new Set(existingKeys || []);
  const unique = [];
  const duplicates = [];
  for (const row of rows || []) {
    const key = buildSourceMovementFingerprint(row, firmaId);
    if (prior.has(key)) {
      duplicates.push(row);
      continue;
    }
    prior.add(key);
    unique.push(row);
  }
  const allDuplicate = rows.length > 0 && unique.length === 0;
  return {
    unique,
    duplicates,
    seenKeys: prior,
    allDuplicate,
    suppressedCount: duplicates.length,
    uiMessage: allDuplicate ? DUPLICATE_VOUCHER_UI_MESSAGE : null,
  };
}

export function filterKontrolRows(rows = [], filter = "all") {
  if (filter === "all") return rows;
  if (filter === "temiz" || filter === "gecti") {
    return rows.filter(
      (row) =>
        row._kontrol?.kontrolDurumu === KONTROL_DURUM.GECTI ||
        row._kontrol?.seviye === "Temiz"
    );
  }
  const wanted =
    filter === "hata"
      ? KONTROL_SEVIYE.HATA
      : filter === "uyari"
        ? KONTROL_SEVIYE.UYARI
        : filter === "bilgi"
          ? KONTROL_SEVIYE.BILGI
          : "";
  return rows.filter((row) => row._kontrol?.seviye === wanted);
}

export function buildFisKontrolExcelRows(analysis) {
  return (analysis?.rows || []).map((row) => ({
    "Satır No": row._kontrol?.rowIndex || "",
    "Fiş No": row.fisNo ?? "",
    "Fiş Tarihi": formatDateTR(row.fisTarihi),
    "Kaynak Tipi": row.kaynakTipi || "",
    "Kaynak Adı": row.kaynakAdi || "",
    "Hesap Kodu": row.hesapKodu || "",
    "Fiş Açıklama": row.fisAciklama || "",
    "Detay Açıklama": row.detayAciklama || row.aciklama || "",
    "Belge Türü": row.belgeTuru || "",
    "Evrak No": row.evrakNo || "",
    Borç: row.borc ?? "",
    Alacak: row.alacak ?? "",
    "Güven Skoru": row.guvenSkoru ?? "",
    "Kontrol Durumu": row._kontrol?.kontrolDurumu || "",
    "Risk Seviyesi": row._kontrol?.riskSeviyesi || "",
    "Kontrol Seviyesi": row._kontrol?.seviye || "",
    "Kontrol Notu": row._kontrol?.kontrolNotu || "",
    "Kontrol Tipleri": (row._kontrol?.issueTypes || []).join(", "),
  }));
}

export function buildFisKontrolIssueExcelRows(analysis) {
  return (analysis?.issues || []).map((issue) => ({
    "Satır No": issue.rowIndex,
    "Fiş No": issue.fisNo,
    "Fiş Tarihi": issue.fisTarihi,
    "Hesap Kodu": issue.hesapKodu,
    Açıklama: issue.aciklama,
    Tutar: issue.tutar,
    "Kontrol Tipi": issue.type,
    Seviye: issue.seviye,
    Mesaj: issue.message,
  }));
}

export function buildPassedExportPayload(analysis, basePayload = {}) {
  const passed = filterPassedRowsForExport(analysis);
  if (!passed.length) {
    return {
      ok: false,
      code: "NO_PASSED_ROWS",
      message: "Dışa aktarım için Geçti durumunda fiş yok. Hatalı fişlerden çıktı üretilemez.",
      rows: [],
      batches: [],
    };
  }
  const batches = groupLucaFisBatches(passed, LUCA_FIS_GROUP_SIZE);
  return {
    ok: true,
    code: "OK",
    rows: passed,
    batches,
    payload: {
      ...basePayload,
      rows: passed,
      kontrolDurumu: KONTROL_DURUM.GECTI,
      exportedAt: new Date().toISOString(),
    },
  };
}
