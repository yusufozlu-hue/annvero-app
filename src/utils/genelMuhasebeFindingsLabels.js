/**
 * Genel Muhasebe Kontrol — kullanıcıya gösterilen Türkçe sunum eşlemesi.
 * Teknik kodlar (E_DEFTER_ISSUE_CODE) engine/worker/diagnostics'ta korunur;
 * bu modül yalnız UI başlık ve açıklama üretir.
 */
import { E_DEFTER_ISSUE_CODE } from "@/src/config/eDefterKontrolDefaults";

/** Kod → Türkçe durum başlığı (sonuç tablosu). */
export const GENEL_MUHASEBE_FINDING_TITLE_TR = {
  [E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART]: "Birden fazla karşıt hesap",
  [E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE]: "Aynı yönlü kayıt",
  [E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING]: "Şüpheli yuvarlama kaydı",
  [E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE]: "Hesap inceleme bilgisi",
  [E_DEFTER_ISSUE_CODE.ACCOUNT_NOT_IN_PLAN]: "Hesap planında bulunamadı",
  [E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO]: "Belge bilgisi eksik",
  [E_DEFTER_ISSUE_CODE.MIZAN_MUAVIN_EVIDENCE_MISSING]: "Mizan yüklenmedi",
  [E_DEFTER_ISSUE_CODE.PLAN_EVIDENCE_MISSING]: "Hesap planı kanıtı bulunamadı",
  [E_DEFTER_ISSUE_CODE.MUAVIN_YEVMIYE_MISMATCH]: "Muavin–yevmiye farkı",
  [E_DEFTER_ISSUE_CODE.MIZAN_MUAVIN_MISMATCH]: "Muavin–mizan farkı",
  [E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART]: "Karşıt hesap bulunamadı",
  [E_DEFTER_ISSUE_CODE.COUNTERPART_SELF]: "Kendine karşıt hesap",
  [E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW]: "Karşıt hesap incelemesi",
  [E_DEFTER_ISSUE_CODE.COUNTERPART_CONFLICT]: "Karşıt hesap çelişkisi",
  [E_DEFTER_ISSUE_CODE.MISSING_DESCRIPTION]: "Açıklama eksik",
  [E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD]: "Dönem dışı kayıt",
  [E_DEFTER_ISSUE_CODE.NEGATIVE_AMOUNT]: "Negatif tutar",
  [E_DEFTER_ISSUE_CODE.DEBIT_CREDIT_MISMATCH]: "Borç–alacak uyumsuzluğu",
  [E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY]: "Mükerrer kayıt bilgisi",
  [E_DEFTER_ISSUE_CODE.ZERO_AMOUNT]: "Sıfır tutarlı kayıt",
  [E_DEFTER_ISSUE_CODE.DOCUMENT_DATE_GAP]: "Belge tarihi farkı",
  [E_DEFTER_ISSUE_CODE.JOURNAL_SEQUENCE_GAP]: "Yevmiye sıra boşluğu",
};

/**
 * Kod → kullanıcıya gösterilen Türkçe açıklama.
 * Engine message alanı teknik/diagnostics için korunur; UI bunu kullanır.
 */
export const GENEL_MUHASEBE_FINDING_MESSAGE_TR = {
  [E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART]:
    "Bu fişte birden fazla karşıt hesap bulunduğu için otomatik olarak tek hesap atanmadı.",
  [E_DEFTER_ISSUE_CODE.COUNTERPART_SAME_SIDE]:
    "Aynı fişte yalnız aynı yönlü kayıtlar bulunduğu için karşıt hesap belirlenemedi.",
  [E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING]:
    "Tutar yuvarlama açısından inceleme gerektirebilir.",
  [E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE]: "Hesap satırı inceleme bilgisi içeriyor.",
  [E_DEFTER_ISSUE_CODE.ACCOUNT_NOT_IN_PLAN]:
    "Bu hesap kodu yüklenen hesap planında bulunamadı.",
  [E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO]: "Belge bilgisi eksik veya tamamlanmamış.",
  [E_DEFTER_ISSUE_CODE.MIZAN_MUAVIN_EVIDENCE_MISSING]:
    "Mizan dosyası yüklenmediği için muavin–mizan mutabakatı yapılamadı.",
  [E_DEFTER_ISSUE_CODE.PLAN_EVIDENCE_MISSING]:
    "Hesap planı kanıtı bulunamadığı için plan kontrolü yapılmadı.",
  [E_DEFTER_ISSUE_CODE.MUAVIN_YEVMIYE_MISMATCH]:
    "Muavin ve yevmiye kayıtları arasında fark tespit edildi.",
  [E_DEFTER_ISSUE_CODE.MIZAN_MUAVIN_MISMATCH]:
    "Muavin ve mizan hesapları arasında fark tespit edildi.",
  [E_DEFTER_ISSUE_CODE.MISSING_COUNTERPART]:
    "Aynı fişte karşıt hesap bacağı bulunamadı.",
  [E_DEFTER_ISSUE_CODE.COUNTERPART_SELF]:
    "Karşıt hesap olarak aynı hesap kodu göründü; inceleme gerekli.",
  [E_DEFTER_ISSUE_CODE.COUNTERPART_REVIEW]:
    "Karşıt hesap bağlantısı inceleme gerektiriyor.",
  [E_DEFTER_ISSUE_CODE.COUNTERPART_CONFLICT]:
    "Excel karşı hesap ile fiş bacaklarından hesaplanan karşıt çelişiyor.",
  [E_DEFTER_ISSUE_CODE.MISSING_DESCRIPTION]: "Açıklama alanı boş.",
  [E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD]: "Kayıt tarihi seçilen dönem dışında.",
  [E_DEFTER_ISSUE_CODE.NEGATIVE_AMOUNT]: "Negatif tutarlı satır tespit edildi.",
  [E_DEFTER_ISSUE_CODE.DEBIT_CREDIT_MISMATCH]:
    "Borç ve alacak tutarları dengeli değil.",
  [E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY]:
    "Benzer cari, tutar ve yakın tarih — inceleme bilgisi.",
  [E_DEFTER_ISSUE_CODE.ZERO_AMOUNT]: "Sıfır tutarlı satır tespit edildi.",
  [E_DEFTER_ISSUE_CODE.DOCUMENT_DATE_GAP]: "Belge tarihi ile fiş tarihi arasında fark var.",
  [E_DEFTER_ISSUE_CODE.JOURNAL_SEQUENCE_GAP]: "Yevmiye numaralarında sıra boşluğu var.",
};

const ENGLISH_TECHNICAL_CODE_RE = /^[A-Z][A-Z0-9_]{2,}$/;

export function genelMuhasebeFindingTitleTr(code = "", fallbackMessage = "") {
  const mapped = GENEL_MUHASEBE_FINDING_TITLE_TR[code];
  if (mapped) return mapped;
  const msg = String(fallbackMessage || "").trim();
  if (msg && !ENGLISH_TECHNICAL_CODE_RE.test(msg)) return msg;
  return "İnceleme bilgisi";
}

export function genelMuhasebeFindingMessageTr(code = "", fallbackMessage = "") {
  const mapped = GENEL_MUHASEBE_FINDING_MESSAGE_TR[code];
  if (mapped) return mapped;
  const msg = String(fallbackMessage || "").trim();
  if (msg && !ENGLISH_TECHNICAL_CODE_RE.test(msg)) return msg;
  return "Bu kayıt inceleme gerektirebilir.";
}

/** Gruplu MULTI satırı için Türkçe kullanıcı mesajı (fiş/adet ayrıntısı). */
export function genelMuhasebeMultiGroupMessageTr(fisNo = "", count = 0) {
  const base = GENEL_MUHASEBE_FINDING_MESSAGE_TR[E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART];
  const fis = String(fisNo || "").trim() || "—";
  return `Fiş ${fis} · ${count} hesap satırı — ${base}`;
}

/**
 * Presentation satırına kullanıcı alanları ekler.
 * Teknik `code` / `message` korunur.
 */
export function enrichFindingForUserPresentation(item = {}) {
  const code = item.code || "";
  const titleTr = genelMuhasebeFindingTitleTr(code, item.message);
  const messageTr =
    item.kind === "group" && code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART
      ? genelMuhasebeMultiGroupMessageTr(item.fisNo, item.count || item.details?.length || 0)
      : genelMuhasebeFindingMessageTr(code, item.message);
  return {
    ...item,
    titleTr,
    messageTr,
    displayTitle: titleTr,
    displayMessage: messageTr,
  };
}

/** Kullanıcıya görünen metinde İngilizce teknik kod sızıntısı var mı? */
export function userVisibleTextHasTechnicalCode(text = "") {
  const value = String(text || "");
  if (!value) return false;
  for (const code of Object.keys(GENEL_MUHASEBE_FINDING_TITLE_TR)) {
    if (value.includes(code)) return true;
  }
  return /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/.test(value);
}
