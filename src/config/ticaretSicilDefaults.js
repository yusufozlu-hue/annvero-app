export const TICARET_SICIL_PROFILE_STORAGE_KEY = "annvero_ticaret_sicil_profiles_v1";
export const TICARET_SICIL_OPERATIONS_STORAGE_KEY = "annvero_ticaret_sicil_operations_v1";
export const TICARET_SICIL_DOCUMENTS_STORAGE_KEY = "annvero_ticaret_sicil_documents_v1";

export const TICARET_SICIL_OPERATION_STATUS = {
  EVRAK_BEKLENIYOR: "Evrak Bekleniyor",
  HAZIRLANIYOR: "Hazırlanıyor",
  IMZAYA_GONDERILDI: "İmzaya Gönderildi",
  BASVURU_YAPILDI: "Başvuru Yapıldı",
  TESCIL_BEKLIYOR: "Tescil Bekliyor",
  TAMAMLANDI: "Tamamlandı",
  IPTAL: "İptal Edildi",
};

export const TICARET_SICIL_OPERATION_TYPES = [
  "Şirket kuruluşu",
  "Adres değişikliği",
  "Müdür değişikliği",
  "Sermaye artırımı",
  "Sermaye azaltımı",
  "Genel kurul",
  "Hisse devri",
  "Şube açılışı",
  "Şube kapanışı",
  "Unvan değişikliği",
  "Faaliyet konusu değişikliği",
  "Tasfiye işlemleri",
];

export const TICARET_SICIL_CHECKLISTS = {
  "Şirket kuruluşu": [
    "Ana sözleşme",
    "İmza beyannamesi",
    "Oda kayıt beyannamesi",
    "Kira kontratı",
    "Kimlik belgeleri",
    "Sermaye dekontu",
  ],
  "Adres değişikliği": [
    "Yönetim kurulu / müdür kararı",
    "Yeni kira kontratı veya tapu",
    "İmza beyannamesi",
    "Ticaret sicil başvuru formu",
  ],
  "Müdür değişikliği": [
    "Müdür atama kararı",
    "İmza beyannamesi",
    "Kimlik belgeleri",
    "Ticaret sicil başvuru formu",
  ],
  "Sermaye artırımı": [
    "Genel kurul / müdür kararı",
    "Ana sözleşme tadil metni",
    "Sermaye dekontu",
    "Ticaret sicil başvuru formu",
  ],
  "Sermaye azaltımı": [
    "Genel kurul kararı",
    "Ana sözleşme tadil metni",
    "Alacaklı ilanı",
    "Ticaret sicil başvuru formu",
  ],
  "Genel kurul": [
    "Toplantı çağrısı",
    "Genel kurul tutanağı",
    "Karar defteri sureti",
    "İmza sirküleri güncellemesi",
  ],
  "Hisse devri": [
    "Hisse devir sözleşmesi",
    "Yönetim kurulu onayı",
    "Kimlik belgeleri",
    "Ticaret sicil başvuru formu",
  ],
  "Şube açılışı": [
    "Şube açılış kararı",
    "Kira kontratı",
    "İmza beyannamesi",
    "Ticaret sicil başvuru formu",
  ],
  "Şube kapanışı": [
    "Şube kapanış kararı",
    "Ticaret sicil başvuru formu",
    "Kapanış ilanı",
  ],
  "Unvan değişikliği": [
    "Unvan değişikliği kararı",
    "Ana sözleşme tadil metni",
    "Ticaret sicil başvuru formu",
  ],
  "Faaliyet konusu değişikliği": [
    "Faaliyet değişikliği kararı",
    "Ana sözleşme tadil metni",
    "Ticaret sicil başvuru formu",
  ],
  "Tasfiye işlemleri": [
    "Tasfiye kararı",
    "Tasfiye memuru atama belgesi",
    "Alacaklı ilanı",
    "Ticaret sicil başvuru formu",
  ],
};

export const TICARET_SICIL_DOCUMENT_TEMPLATES = [
  { id: "genel-kurul-karari", title: "Genel Kurul Kararı", status: "altyapi" },
  { id: "mudur-karari", title: "Müdür Kararı", status: "altyapi" },
  { id: "adres-degisikligi-karari", title: "Adres Değişikliği Kararı", status: "altyapi" },
  { id: "sermaye-artirimi-karari", title: "Sermaye Artırımı Kararı", status: "altyapi" },
];

export const TICARET_SICIL_REMINDER_TYPES = {
  EKSIK_EVRAK: "Eksik evrak uyarısı",
  GENEL_KURUL: "Yaklaşan genel kurul",
  SERMAYE_SURESI: "Sermaye süresi",
  ISLEM_HATIRLATMA: "Ticaret sicil işlem hatırlatması",
};

export const TICARET_SICIL_ALLOWED_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp",
];
