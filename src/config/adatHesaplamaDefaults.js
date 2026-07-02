export const DEFAULT_ADAT_HESAPLARI = [
  { id: "131", label: "131 Ortaklardan Alacaklar", prefix: "131" },
  { id: "331", label: "331 Ortaklara Borçlar", prefix: "331" },
  { id: "195", label: "195 İş Avansları / Peşin Ödenen", prefix: "195" },
  { id: "295", label: "295 Peşin Ödenen Vergiler ve Fonlar", prefix: "295" },
  { id: "100", label: "100 Kasa", prefix: "100" },
];

export const GUN_BAZI = {
  360: 360,
  365: 365,
};

export const HESAPLAMA_MODU = {
  GUNLUK_DETAY: "gunluk_detay",
  AYLIK_TOPLU: "aylik_toplu",
  DONEM_SONU: "donem_sonu",
};

export const FAIZ_YONU = {
  GELIR: "gelir",
  GIDER: "gider",
};

export const DEFAULT_FAIZ_GELIR_HESAP = "642";
export const DEFAULT_FAIZ_GIDER_HESAP = "780";
export const DEFAULT_BSMV_HESAP = "";

export function buildAdatFisAciklama(donem, hesapAdi = "") {
  const label = hesapAdi ? `${hesapAdi} ` : "";
  return `${donem} ${label}adat faizi`;
}

export function buildKasaAdatFisAciklama(donem) {
  return `${donem} kasa adat faiz kaydı`;
}

export function buildOrtakAdatFisAciklama(donem) {
  return `${donem} ortaklar cari hesap adat faizi`;
}
