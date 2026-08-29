/**
 * Açılış / devir fişi sınıflandırması.
 * Karşıt hesap ve bileşik fiş analizinden hariç tutulur;
 * fiş/hareket sayacı, BA denge, Muavin↔Yevmiye/Mizan kontrollerine dahil kalır.
 */

function compactText(value = "") {
  return String(value ?? "").trim();
}

/** Türkçe karakterleri sadeleştirip büyük harfe çevir (etiket eşlemesi). */
export function normalizeOpeningLabelText(value = "") {
  return compactText(value)
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/İ/g, "I")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const OPENING_LABEL_RE =
  /\b(ACILIS(\s+FIS[I]?)?|DEVIR(\s+FIS[I]?)?|OPENING(\s+VOUCHER)?|OPENING\s+ENTRY)\b/;

/**
 * Kaynak satırında açık AÇILIŞ / DEVİR / OPENING işareti var mı?
 */
export function hasOpeningVoucherLabel(row = {}) {
  const blob = normalizeOpeningLabelText(
    [
      row.fisTuru,
      row.belgeTuru,
      row.documentType,
      row.fisTipi,
      row.voucherType,
      row.aciklama,
      row.belgeAciklama,
    ]
      .map((part) => compactText(part))
      .filter(Boolean)
      .join(" ")
  );
  if (!blob) return false;
  return OPENING_LABEL_RE.test(blob);
}

/**
 * Yalnız rakamlardan oluşan fiş no → baştaki sıfırlar kaldırılır; boş/hepsi sıfır → "0".
 * Harf içeren değerlerde null (fallback kuralı uygulanmaz).
 */
export function normalizeNumericFisNo(value = "") {
  const trimmed = compactText(value);
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const stripped = trimmed.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

/**
 * Tarih mali yılın ilk günü mü? (01.01 / 1.1 / 2026-01-01 / 01/01/2026)
 */
export function isFiscalYearFirstDay(tarih = "") {
  const raw = compactText(tarih);
  if (!raw) return false;

  const iso = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (iso) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return month === 1 && day === 1;
  }

  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    return month === 1 && day === 1;
  }

  return false;
}

/**
 * Tek satır / fiş kimliği için açılış fişi mi?
 * 1) Açık etiket → evet (fiş no bağımsız)
 * 2) Fallback: normalize fisNo === "1" VE tarih = 01.01
 */
export function isOpeningVoucher(row = {}) {
  if (!row || typeof row !== "object") return false;
  if (hasOpeningVoucherLabel(row)) return true;
  const fis = normalizeNumericFisNo(row.fisNo);
  if (fis !== "1") return false;
  return isFiscalYearFirstDay(row.tarih);
}

/**
 * Aynı fiş grubu açılış mı?
 * Etiket herhangi bir satırda varsa veya (fis=1 ve en az bir satır 01.01) ise evet.
 * 00001 + 01.01 dışı tarihler, etiket yoksa hayır.
 */
export function isOpeningVoucherGroup(rows = []) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return false;
  if (list.some((row) => hasOpeningVoucherLabel(row))) return true;

  const fisValues = [
    ...new Set(list.map((row) => normalizeNumericFisNo(row.fisNo)).filter(Boolean)),
  ];
  if (fisValues.length !== 1 || fisValues[0] !== "1") return false;
  return list.some((row) => isFiscalYearFirstDay(row.tarih));
}

/** Dahili sınıflandırma etiketi — kullanıcı bulgusu üretmez. */
export const OPENING_VOUCHER_CLASS = "OPENING_VOUCHER";
