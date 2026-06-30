import * as XLSX from "xlsx";
import { createId } from "./defaultState";
import { normalizeTrDateInput } from "./dateUtils";

export const VERGI_TAKVIMI_HEADERS = [
  "Vergi/Yükümlülük",
  "Son Ödeme Tarihi",
  "Açıklama/Mesaj",
];

export function downloadTaxCalendarTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    VERGI_TAKVIMI_HEADERS,
    ["KDV Beyannamesi", "26.07.2026", "Temmuz dönemi KDV ödeme son günü"],
    ["Muhtasar Beyannamesi", "26.07.2026", "Temmuz dönemi muhtasar"],
  ]);

  ws["!cols"] = [{ wch: 32 }, { wch: 18 }, { wch: 42 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vergi Takvimi");
  XLSX.writeFile(wb, "vergi_takvimi_sablon.xlsx");
}

function readCell(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }

  return "";
}

export function parseTaxCalendarExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  return rows
    .map((row) => {
      const baslik = readCell(row, [
        "Vergi/Yükümlülük",
        "Vergi",
        "Yükümlülük",
        "Başlık",
      ]);
      const rawDate = readCell(row, [
        "Son Ödeme Tarihi",
        "Son Tarih",
        "Tarih",
      ]);
      const aciklama = readCell(row, ["Açıklama/Mesaj", "Açıklama", "Mesaj"]);

      if (!baslik && !rawDate) {
        return null;
      }

      const sonTarih = normalizeTrDateInput(rawDate);

      if (!baslik || !sonTarih) {
        return null;
      }

      return {
        id: createId(),
        baslik,
        tur: baslik,
        sonTarih,
        aciklama,
        tamamlandi: false,
        companyId: "",
      };
    })
    .filter(Boolean);
}
