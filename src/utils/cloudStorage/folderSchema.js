/**
 * Firma Drive klasör ağacı şeması (V1).
 * Tekrar çalıştırılabilir: mevcut node varsa oluşturma atlanır (idempotent).
 */

import {
  ANNVERO_SYSTEM_FOLDER,
  FOLDER_STRUCTURE_VERSION,
  TAHAKKUK_EXCLUDED_OBLIGATIONS,
} from "./types.js";

export { FOLDER_STRUCTURE_VERSION, ANNVERO_SYSTEM_FOLDER };

/** Üst seviye klasörler (sıra korunsun) */
export const ROOT_FOLDER_SPECS = Object.freeze([
  { key: "annvero", name: ANNVERO_SYSTEM_FOLDER, system: true },
  { key: "firma_bilgileri", name: "00 - Firma Bilgileri" },
  { key: "hesap_plani", name: "01 - Hesap Planı" },
  { key: "beyannameler", name: "02 - Beyannameler" },
  { key: "tahakkuk", name: "03 - Tahakkuk Fişleri" },
  { key: "ticaret_sicil", name: "04 - Ticaret Sicil" },
  { key: "personel", name: "05 - Personel" },
  { key: "finansal", name: "06 - Finansal Tablolar" },
  { key: "sozlesmeler", name: "07 - Sözleşmeler" },
  { key: "policeler", name: "08 - Poliçeler" },
  { key: "ruhsatlar", name: "09 - Ruhsatlar" },
  { key: "tapular", name: "10 - Tapular" },
  { key: "resmi_yazisma", name: "97 - Resmi Yazışmalar" },
  { key: "diger", name: "98 - Diğer Evraklar" },
  { key: "arsiv", name: "99 - Arşiv" },
]);

/** Beyanname alt klasörleri */
export const BEYANNAME_SUBFOLDERS = Object.freeze([
  "MUHSGK",
  "KDV1",
  "KDV2",
  "Geçici Vergi",
  "Kurumlar Vergisi",
  "Damga Vergisi",
  "Konaklama Vergisi",
  "Turizm Payı",
  "Düzeltmeler",
]);

/**
 * Tahakkuk alt klasörleri.
 * MTV / Emlak dahil edilmez.
 */
export const TAHAKKUK_SUBFOLDERS = Object.freeze([
  "MUHSGK",
  "KDV1",
  "KDV2",
  "Geçici Vergi",
  "Kurumlar Vergisi",
  "Damga Vergisi",
  "Konaklama Vergisi",
  "Turizm Payı",
  "SGK",
  "SGDP",
  "Düzeltmeler",
]);

function assertNoExcludedTahakkuk() {
  for (const name of TAHAKKUK_SUBFOLDERS) {
    const upper = String(name).toUpperCase();
    if (TAHAKKUK_EXCLUDED_OBLIGATIONS.some((x) => upper.includes(x))) {
      throw new Error(`Tahakkuk şemasında yasaklı klasör: ${name}`);
    }
  }
}

assertNoExcludedTahakkuk();

/**
 * Düz klasör yolu listesi (kök altında göreli path).
 * @returns {string[]} örn. ["_ANNVERO", "02 - Beyannameler/MUHSGK", ...]
 */
export function buildCompanyFolderPathList() {
  const paths = [];
  for (const spec of ROOT_FOLDER_SPECS) {
    paths.push(spec.name);
    if (spec.key === "beyannameler") {
      for (const sub of BEYANNAME_SUBFOLDERS) {
        paths.push(`${spec.name}/${sub}`);
      }
    }
    if (spec.key === "tahakkuk") {
      for (const sub of TAHAKKUK_SUBFOLDERS) {
        paths.push(`${spec.name}/${sub}`);
      }
    }
  }
  return paths;
}

/**
 * Ağaç düğümü: { name, system?, children? }
 */
export function buildCompanyFolderTree() {
  return ROOT_FOLDER_SPECS.map((spec) => {
    if (spec.key === "beyannameler") {
      return {
        name: spec.name,
        key: spec.key,
        children: BEYANNAME_SUBFOLDERS.map((name) => ({ name, key: name })),
      };
    }
    if (spec.key === "tahakkuk") {
      return {
        name: spec.name,
        key: spec.key,
        children: TAHAKKUK_SUBFOLDERS.map((name) => ({ name, key: name })),
      };
    }
    return {
      name: spec.name,
      key: spec.key,
      system: Boolean(spec.system),
      children: [],
    };
  });
}

/**
 * Idempotent plan: mevcut path set’ine göre oluşturulacaklar.
 * @param {Iterable<string>} existingPaths
 */
export function planFolderCreations(existingPaths = []) {
  const existing = new Set(
    [...existingPaths].map((p) => String(p || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
  );
  const desired = buildCompanyFolderPathList();
  const toCreate = [];
  const skipped = [];
  for (const path of desired) {
    if (existing.has(path)) skipped.push(path);
    else toCreate.push(path);
  }
  return {
    folderStructureVersion: FOLDER_STRUCTURE_VERSION,
    desiredCount: desired.length,
    toCreate,
    skipped,
  };
}

export function isAnnveroSystemFolderName(name) {
  return String(name || "").trim() === ANNVERO_SYSTEM_FOLDER;
}
