/**
 * Fiş Kontrol bulgularını kullanıcıya yönelik sınıflara ayırır.
 * Ham ekstre / kişisel veri loglanmaz; yalnız tip ve sayım.
 */

import {
  KONTROL_SEVIYE,
  KONTROL_TIP,
} from "@/src/utils/fisKontrolMerkezi";

export const FINDING_CLASS = {
  MISSING_ACCOUNT: "missing_account",
  UNBALANCED_VOUCHER: "unbalanced_voucher",
  DOCUMENT_DATE_PERIOD: "document_date_period",
  TAX_SGK: "tax_sgk",
  FX_RATE: "fx_rate",
  DUPLICATE: "duplicate",
  LOW_CONFIDENCE: "low_confidence",
  INFO_WARNING: "info_warning",
  PARSER_TECHNICAL: "parser_technical",
  OTHER: "other",
};

const CLASS_META = {
  [FINDING_CLASS.MISSING_ACCOUNT]: {
    label: "Eksik hesap",
    why: "Satırda muhasebe hesabı yok veya plan eşleşmesi bulunamadı.",
    action: "Eksik Hesap Çözüm Merkezi’nden gruba hesap seçin veya firma hafızasından öğrenin.",
  },
  [FINDING_CLASS.UNBALANCED_VOUCHER]: {
    label: "Fiş dengesizliği",
    why: "Fiş içinde borç ve alacak toplamları eşit değil.",
    action: "Eksik/yanlış bacakları düzeltin; denge sağlanmadan çıktı açılmaz.",
  },
  [FINDING_CLASS.DOCUMENT_DATE_PERIOD]: {
    label: "Belge / tarih / dönem",
    why: "Belge türü, tarih formatı veya dönem kuralları ihlal edildi.",
    action: "Belge türü ve tarihleri kontrol edin; kapalı dönemse yetkili açılış gerekir.",
  },
  [FINDING_CLASS.TAX_SGK]: {
    label: "Vergi / SGK",
    why: "360/361 dağılımı veya vergi-SGK kuralı tutarsız.",
    action: "Vergi/SGK satırlarını tahakkuk ve ödeme kurallarına göre düzeltin.",
  },
  [FINDING_CLASS.FX_RATE]: {
    label: "Döviz / kur",
    why: "Döviz tutarı ile kur/TL karşılığı uyumsuz.",
    action: "Kur ve döviz tutarını kontrol edin.",
  },
  [FINDING_CLASS.DUPLICATE]: {
    label: "Mükerrer",
    why: "Aynı evrak veya kaynak hareket tekrar işlenmiş görünüyor.",
    action: "Mükerrer satırları hariç tutun; aynı ekstre yeniden işlenmez.",
  },
  [FINDING_CLASS.LOW_CONFIDENCE]: {
    label: "Düşük güven",
    why: "Eşleşme güven skoru eşiğin altında.",
    action: "Hesabı manuel onaylayın; düşük güvenli öneri otomatik kaydedilmez.",
  },
  [FINDING_CLASS.INFO_WARNING]: {
    label: "Bilgi / uyarı",
    why: "Aktarımı engellemeyen bilgilendirme veya uyarı.",
    action: "Gözden geçirin; kritik değilse devam edebilirsiniz.",
  },
  [FINDING_CLASS.PARSER_TECHNICAL]: {
    label: "Parser teknik",
    why: "Muhasebe kuralı değil; parse/işleme teknik bulgusu.",
    action: "Dosya formatını veya banka seçimini kontrol edin.",
  },
  [FINDING_CLASS.OTHER]: {
    label: "Diğer",
    why: "Sınıflandırılamayan kontrol bulgusu.",
    action: "Fiş Kontrol detayından satırı inceleyin.",
  },
};

const TIP_TO_CLASS = new Map([
  [KONTROL_TIP.EKSIK_HESAP, FINDING_CLASS.MISSING_ACCOUNT],
  [KONTROL_TIP.HESAP_PLANINDA_YOK, FINDING_CLASS.MISSING_ACCOUNT],
  [KONTROL_TIP.DENGESIZ_FIS, FINDING_CLASS.UNBALANCED_VOUCHER],
  [KONTROL_TIP.FIS_BORC_ALACAK_ESIT_DEGIL, FINDING_CLASS.UNBALANCED_VOUCHER],
  [KONTROL_TIP.BORC_ALACAK_IKISI_DOLU, FINDING_CLASS.UNBALANCED_VOUCHER],
  [KONTROL_TIP.BORC_ALACAK_IKISI_BOS, FINDING_CLASS.UNBALANCED_VOUCHER],
  [KONTROL_TIP.TERS_BORC_ALACAK, FINDING_CLASS.UNBALANCED_VOUCHER],
  [KONTROL_TIP.NEGATIF_TUTAR, FINDING_CLASS.UNBALANCED_VOUCHER],
  [KONTROL_TIP.SIFIR_TUTAR, FINDING_CLASS.UNBALANCED_VOUCHER],
  [KONTROL_TIP.EKSIK_BELGE_TURU, FINDING_CLASS.DOCUMENT_DATE_PERIOD],
  [KONTROL_TIP.GECERSIZ_BELGE_TURU, FINDING_CLASS.DOCUMENT_DATE_PERIOD],
  [KONTROL_TIP.EKSIK_FIS_NO, FINDING_CLASS.DOCUMENT_DATE_PERIOD],
  [KONTROL_TIP.HATALI_TARIH, FINDING_CLASS.DOCUMENT_DATE_PERIOD],
  [KONTROL_TIP.TARIH_SIRASI, FINDING_CLASS.DOCUMENT_DATE_PERIOD],
  [KONTROL_TIP.DONEM_UYUMSUZ, FINDING_CLASS.DOCUMENT_DATE_PERIOD],
  [KONTROL_TIP.KAPALI_DONEM, FINDING_CLASS.DOCUMENT_DATE_PERIOD],
  [KONTROL_TIP.FIS_NO_SIRASI, FINDING_CLASS.DOCUMENT_DATE_PERIOD],
  [KONTROL_TIP.BELGE_KURAL, FINDING_CLASS.DOCUMENT_DATE_PERIOD],
  [KONTROL_TIP.VERGI_360, FINDING_CLASS.TAX_SGK],
  [KONTROL_TIP.SGK_361, FINDING_CLASS.TAX_SGK],
  [KONTROL_TIP.SGDP_AYRIM, FINDING_CLASS.TAX_SGK],
  [KONTROL_TIP.GECIKME_KARIŞIM, FINDING_CLASS.TAX_SGK],
  [KONTROL_TIP.MTV_EMLAK_ITO, FINDING_CLASS.TAX_SGK],
  [KONTROL_TIP.TAHAKKUK_ODEME, FINDING_CLASS.TAX_SGK],
  [KONTROL_TIP.DOVIZ_KUR, FINDING_CLASS.FX_RATE],
  [KONTROL_TIP.MUKERRER_EVRAK, FINDING_CLASS.DUPLICATE],
  [KONTROL_TIP.MUKERRER_HAREKET, FINDING_CLASS.DUPLICATE],
  [KONTROL_TIP.MUKERRER_KAYNAK, FINDING_CLASS.DUPLICATE],
  [KONTROL_TIP.MUKERRER_FIS, FINDING_CLASS.DUPLICATE],
  [KONTROL_TIP.DUSUK_GUVEN, FINDING_CLASS.LOW_CONFIDENCE],
  [KONTROL_TIP.EKSIK_ACIKLAMA, FINDING_CLASS.INFO_WARNING],
  [KONTROL_TIP.ACIKLAMA_STANDART, FINDING_CLASS.INFO_WARNING],
  [KONTROL_TIP.LUCA_GRUP_50, FINDING_CLASS.INFO_WARNING],
  [KONTROL_TIP.OGRENEN_HAFIZA, FINDING_CLASS.INFO_WARNING],
  [KONTROL_TIP.MAAS_AVANS, FINDING_CLASS.INFO_WARNING],
  [KONTROL_TIP.POS_KK, FINDING_CLASS.INFO_WARNING],
  [KONTROL_TIP.TENANT, FINDING_CLASS.PARSER_TECHNICAL],
]);

export function mapKontrolTipToFindingClass(tip = "", seviye = "") {
  const mapped = TIP_TO_CLASS.get(String(tip || ""));
  if (mapped) return mapped;
  if (seviye === KONTROL_SEVIYE.UYARI || seviye === KONTROL_SEVIYE.BILGI) {
    return FINDING_CLASS.INFO_WARNING;
  }
  return FINDING_CLASS.OTHER;
}

export function getFindingClassMeta(classId = "") {
  return (
    CLASS_META[classId] || {
      label: classId || "—",
      why: "",
      action: "",
    }
  );
}

/**
 * @param {object} analysis analyzeStandardLucaRows sonucu veya { issues, rows }
 * @returns {{ classes: Array, totalIssues: number, blockingClasses: string[] }}
 */
export function classifyFisKontrolFindings(analysis = {}) {
  const issues = Array.isArray(analysis?.issues)
    ? analysis.issues
    : (analysis?.rows || []).flatMap((row) =>
        (row._kontrol?.issues || []).map((issue) => ({
          ...issue,
          rowId: row.id,
        }))
      );

  const byClass = new Map();
  for (const issue of issues) {
    const classId = mapKontrolTipToFindingClass(issue.type, issue.seviye);
    const tip = String(issue.type || "diğer");
    if (!byClass.has(classId)) {
      const meta = getFindingClassMeta(classId);
      byClass.set(classId, {
        id: classId,
        label: meta.label,
        why: meta.why,
        action: meta.action,
        count: 0,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        rootCauses: new Map(),
      });
    }
    const bucket = byClass.get(classId);
    bucket.count += 1;
    if (issue.seviye === KONTROL_SEVIYE.HATA) bucket.errorCount += 1;
    else if (issue.seviye === KONTROL_SEVIYE.UYARI) bucket.warningCount += 1;
    else bucket.infoCount += 1;

    const root = bucket.rootCauses.get(tip) || {
      tip,
      count: 0,
      sampleMessage: String(issue.message || "").slice(0, 160),
    };
    root.count += 1;
    bucket.rootCauses.set(tip, root);
  }

  const classes = [...byClass.values()]
    .map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      why: bucket.why,
      action: bucket.action,
      count: bucket.count,
      errorCount: bucket.errorCount,
      warningCount: bucket.warningCount,
      infoCount: bucket.infoCount,
      roots: [...bucket.rootCauses.values()].sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.errorCount - a.errorCount || b.count - a.count);

  const blockingClasses = classes
    .filter((c) => c.errorCount > 0)
    .map((c) => c.id);

  return {
    classes,
    totalIssues: issues.length,
    blockingClasses,
    blocksExport: blockingClasses.length > 0,
  };
}

export function formatFindingClassesSummary(report = {}) {
  const classes = report.classes || [];
  if (!classes.length) return "Kontrol bulgusu yok.";
  return classes
    .map((c) => `${c.label}: ${c.count}`)
    .join(" · ");
}
