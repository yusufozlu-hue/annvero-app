import { getActiveCompanies, resolveCompanyId } from "./companyBridge";
import { daysUntil, parseTrDate } from "./dateUtils";

export function buildAutoReminderMessage({ title, date, contactName }) {
  const salutation = contactName?.trim()
    ? `Sayın ${contactName.trim()},`
    : "Sayın yetkili,";
  const subject = String(title || "yükümlülük").trim();

  return `${salutation}\n${date} tarihli ${subject} ödeme son günü için hatırlatmadır.\nİyi çalışmalar.`;
}

export function truncateText(value, maxLength = 56) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

export function resolveReminderCompanyIds(companyMode, companyIds, companies) {
  if (companyMode === "all") {
    return getActiveCompanies(companies).map((company) => company.id);
  }

  return (companyIds || []).filter(Boolean);
}

export function buildReminderDisplayRows({
  hatirlatmalar = [],
  vergiTakvimi = [],
  companies = [],
  reminderDaysBefore = 3,
}) {
  const rows = [];
  const activeCompanyIds = getActiveCompanies(companies).map((company) => company.id);

  for (const item of hatirlatmalar) {
    if (item.aktif === false) {
      continue;
    }

    rows.push({
      id: item.id,
      source: item.source || "manual",
      baslik: item.baslik,
      tarih: item.tarih,
      companyId: resolveCompanyId(item),
      mesaj: item.mesaj || item.aciklama || "",
      removable: true,
    });
  }

  for (const taxItem of vergiTakvimi) {
    if (taxItem.tamamlandi) {
      continue;
    }

    const remaining = daysUntil(taxItem.sonTarih);
    if (remaining === null || remaining > reminderDaysBefore) {
      continue;
    }

    const targetCompanyIds = resolveCompanyId(taxItem)
      ? [resolveCompanyId(taxItem)]
      : activeCompanyIds;

    for (const companyId of targetCompanyIds) {
      rows.push({
        id: `tax:${taxItem.id}:${companyId}`,
        source: "tax",
        taxItemId: taxItem.id,
        baslik: taxItem.baslik || taxItem.tur || "Vergi yükümlülüğü",
        tarih: taxItem.sonTarih,
        companyId,
        mesaj: taxItem.aciklama || "",
        removable: false,
      });
    }
  }

  return rows.sort((left, right) => {
    const leftTime = parseTrDate(left.tarih)?.getTime() || 0;
    const rightTime = parseTrDate(right.tarih)?.getTime() || 0;
    return leftTime - rightTime;
  });
}
