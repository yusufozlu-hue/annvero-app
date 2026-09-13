/**
 * Fiş Dönüştürme Merkezi — Elektra tek-ekran kapıları.
 * Eski Luca Fiş Üretici'ye Elektra aktarımı kapalı; Excel HESAP_EKSIK fail-closed.
 */

import {
  assertElektrawebNoHesapEksikForExport,
  LUCA_EXPORT_HEADERS,
  sortStandardLucaRows,
  standardLucaRowsToExcelRows,
} from "@/src/utils/standardLucaRow";

export const FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_CODE =
  "ELEKTRAWEB_LUCA_TRANSFER_DISABLED";

export const FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_MESSAGE =
  "Elektraweb için eski Luca Fiş Üretici'ye aktarım kapalı. Luca Excel'i Fiş Dönüştürme Merkezi'nden indirin.";

const ELEKTRA_SOURCE_HINTS = new Set([
  "elektraweb",
  "elektra",
  "ELEKTRAWEB",
  "ELEKTRA",
]);

export function isFisDonusturmeElektrawebSource(sourceType = "") {
  const value = String(sourceType || "").trim();
  if (!value) return false;
  const upper = value.toUpperCase();
  const lower = value.toLowerCase();
  return (
    upper === "ELEKTRAWEB" ||
    lower === "elektraweb" ||
    lower === "elektra" ||
    ELEKTRA_SOURCE_HINTS.has(value)
  );
}

function rowLooksLikeElektraweb(row = {}) {
  const tip = String(row?.kaynakTipi || "").trim().toUpperCase();
  if (tip === "ELEKTRAWEB" || tip === "ELEKTRA") return true;
  const adi = String(row?.kaynakAdi || "").trim().toUpperCase();
  return adi === "ELEKTRAWEB" || adi.includes("ELEKTRAWEB");
}

/**
 * Fail-closed: Elektra satırları / kaynağı eski Luca üreticiye aktarılamaz.
 * UI gizlemesine güvenilmez — handler ve publish bu kapıyı kullanır.
 */
export function assertFisDonusturmeLucaProducerTransferAllowed({
  sourceType = "",
  source = "",
  rows = [],
} = {}) {
  if (isFisDonusturmeElektrawebSource(sourceType)) {
    return {
      ok: false,
      code: FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_CODE,
      message: FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_MESSAGE,
    };
  }

  if (isFisDonusturmeElektrawebSource(source)) {
    return {
      ok: false,
      code: FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_CODE,
      message: FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_MESSAGE,
    };
  }

  const list = Array.isArray(rows) ? rows : [];
  if (list.some(rowLooksLikeElektraweb)) {
    return {
      ok: false,
      code: FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_CODE,
      message: FIS_DONUSTURME_ELEKTRA_TRANSFER_DISABLED_MESSAGE,
    };
  }

  return { ok: true, code: "OK", message: "" };
}

/**
 * Elektra doğrudan Luca Excel: HESAP_EKSIK varken tamamen engelle.
 * Satır kısmen/sessiz düşürülmez.
 */
export function assertFisDonusturmeLucaExcelExportAllowed({
  sourceType = "",
  rows = [],
} = {}) {
  if (!isFisDonusturmeElektrawebSource(sourceType)) {
    return {
      ok: true,
      missingKaynakHesapKodlari: [],
      message: "",
    };
  }

  return assertElektrawebNoHesapEksikForExport(rows);
}

/**
 * HESAP_EKSIK satırında yeşil "Düşük" çelişkisini kaldır.
 * Export engeli = Yüksek risk.
 */
export function resolveFisDonusturmeDisplayRiskSeviyesi(row = {}) {
  if (String(row?.riskDurumu || "").trim() === "HESAP_EKSIK") {
    return "Yüksek";
  }
  const seviye = String(row?._kontrol?.riskSeviyesi || "").trim();
  return seviye || "Temiz";
}

export function shouldShowFisDonusturmeRiskPill(row = {}) {
  const display = resolveFisDonusturmeDisplayRiskSeviyesi(row);
  if (display === "Yüksek" || display === "Orta" || display === "Düşük") {
    if (String(row?.riskDurumu || "").trim() === "HESAP_EKSIK") return true;
    const seviye = row?._kontrol?.seviye;
    return Boolean(seviye && seviye !== "Temiz");
  }
  return false;
}

/**
 * Doğrudan Luca Excel hazırlığı — 50 fiş grup + Luca kolon sözleşmesi.
 * Dosya yazmaz; UI XLSX.writeFile ile indirir.
 */
export function prepareFisDonusturmeLucaExcelFiles({
  rows = [],
  sourceType = "",
  filePrefix = "fis",
  chunkSize = 50,
} = {}) {
  const gate = assertFisDonusturmeLucaExcelExportAllowed({ sourceType, rows });
  if (!gate.ok) {
    return {
      ok: false,
      code: "HESAP_EKSIK",
      message: gate.message,
      missingKaynakHesapKodlari: gate.missingKaynakHesapKodlari || [],
      files: [],
    };
  }

  const sorted = sortStandardLucaRows(rows);
  if (!sorted.length) {
    return {
      ok: false,
      code: "EMPTY",
      message: "Dışa aktarılacak satır yok.",
      missingKaynakHesapKodlari: [],
      files: [],
    };
  }

  const uniqueFisNo = [...new Set(sorted.map((row) => row.fisNo))];
  const size = Math.max(1, Number(chunkSize) || 50);
  const totalFiles = Math.ceil(uniqueFisNo.length / size);
  const prefix = String(filePrefix || "fis")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const files = [];
  for (let fileIndex = 0; fileIndex < totalFiles; fileIndex += 1) {
    const chunkFisNos = new Set(
      uniqueFisNo.slice(fileIndex * size, fileIndex * size + size)
    );
    const chunkRows = sorted.filter((row) => chunkFisNos.has(row.fisNo));
    const excelRows = standardLucaRowsToExcelRows(chunkRows);

    for (const excelRow of excelRows) {
      for (const header of LUCA_EXPORT_HEADERS) {
        if (!Object.prototype.hasOwnProperty.call(excelRow, header)) {
          return {
            ok: false,
            code: "LUCA_CONTRACT",
            message: `Luca Excel kolon sözleşmesi bozuldu: ${header}`,
            missingKaynakHesapKodlari: [],
            files: [],
          };
        }
      }
    }

    const suffix = totalFiles === 1 ? "luca" : `luca_${fileIndex + 1}`;
    files.push({
      fileName: `${prefix}_${suffix}.xlsx`,
      fisCount: chunkFisNos.size,
      rowCount: chunkRows.length,
      headers: [...LUCA_EXPORT_HEADERS],
      excelRows,
      sampleContract: excelRows[0]
        ? {
            fisNo: excelRows[0]["Fiş No"],
            fisTarihi: excelRows[0]["Fiş Tarihi"],
            hesapKodu: excelRows[0]["Hesap Kodu"],
            belgeTuru: excelRows[0]["Belge Türü"],
            borc: excelRows[0]["Borç"],
            alacak: excelRows[0]["Alacak"],
            aciklama:
              excelRows[0]["Detay Açıklama"] || excelRows[0]["Fiş Açıklama"] || "",
          }
        : null,
    });
  }

  return {
    ok: true,
    code: "OK",
    message: "",
    missingKaynakHesapKodlari: [],
    files,
  };
}
