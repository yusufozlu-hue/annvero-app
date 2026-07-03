export const NOTIFICATION_CHANNELS = {
  GIB: "gib",
  SGK: "sgk",
  UETS: "uets",
  KEP: "kep",
};

export const CHANNEL_META = {
  gib: {
    label: "GİB e-Tebligat",
    shortLabel: "GİB",
    href: "/dashboard/ofis-takip/resmi-bildirimler/gib",
    description: "Gelir İdaresi e-Tebligat kontrolü ve hatırlatmaları",
    ready: true,
  },
  sgk: {
    label: "SGK Bildirimleri",
    shortLabel: "SGK",
    href: "/dashboard/ofis-takip/resmi-bildirimler/sgk",
    description: "SGK resmi bildirim takibi (hazırlık aşamasında)",
    ready: false,
  },
  uets: {
    label: "UETS",
    shortLabel: "UETS",
    href: "/dashboard/ofis-takip/resmi-bildirimler/uets",
    description: "Ulusal Elektronik Tebligat Sistemi (hazırlık aşamasında)",
    ready: false,
  },
  kep: {
    label: "KEP",
    shortLabel: "KEP",
    href: "/dashboard/ofis-takip/resmi-bildirimler/kep",
    description: "Kayıtlı Elektronik Posta takibi (hazırlık aşamasında)",
    ready: false,
  },
};

export const RESMI_BILDIRIM_BASE = "/dashboard/ofis-takip/resmi-bildirimler";

export const GIB_PUSH_MESSAGES = {
  CHECK_DUE: "GİB e-Tebligat kontrol zamanı geldi.",
  NEW_NOTIFICATION: "Yeni GİB e-Tebligatı geldi.",
};

export const DEFAULT_GIB_REMINDER = {
  enabled: true,
  intervalDays: 1,
  reminderTime: "09:00",
  pushEnabled: true,
};
