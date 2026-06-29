import { DEFAULT_WHATSAPP_TEMPLATE } from "./constants";

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildDefaultVergiTakvimi() {
  const items = [
    { baslik: "KDV Beyannamesi", tur: "KDV", gun: 26 },
    { baslik: "Muhtasar Beyannamesi", tur: "Muhtasar", gun: 26 },
    { baslik: "SGK Prim Bildirgesi", tur: "SGK", gun: 26 },
    { baslik: "Ba-Bs Formu", tur: "Ba-Bs", gun: 28 },
  ];

  const year = new Date().getFullYear();
  const entries = [];

  for (let month = 1; month <= 12; month += 1) {
    for (const item of items) {
      const dueMonth = month === 12 ? 1 : month + 1;
      const dueYear = month === 12 ? year + 1 : year;
      const sonTarih = `${String(item.gun).padStart(2, "0")}.${String(dueMonth).padStart(2, "0")}.${dueYear}`;

      entries.push({
        id: createId(),
        baslik: `${item.baslik} (${String(month).padStart(2, "0")}.${year})`,
        tur: item.tur,
        sonTarih,
        aciklama: `${month}. dönem`,
        tamamlandi: false,
        companyId: "",
      });
    }
  }

  return entries;
}

export function createDefaultOfisTakipState() {
  return {
    version: 1,
    settings: {
      officeName: "Yusuf Özlü SMMM",
      whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE,
      reminderDaysBefore: 3,
    },
    yapilacaklar: [],
    hatirlatmalar: [],
    vergiTakvimi: buildDefaultVergiTakvimi(),
  };
}

export { createId };
