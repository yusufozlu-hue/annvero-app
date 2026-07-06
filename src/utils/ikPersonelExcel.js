import * as XLSX from "xlsx";
import { formatDateTR } from "@/src/utils/formatDateTR";
import { IK_PERSONEL_EXCEL_HEADERS } from "@/src/config/ikPersonelDefaults";

const COLUMN_ALIASES = {
  fullName: ["Ad Soyad", "AdSoyad", "Adı Soyadı", "İsim", "Personel"],
  tcNo: ["TC No", "TCNo", "TC Kimlik", "TC Kimlik No", "Kimlik No", "TC"],
  sgkSicilNo: ["SGK Sicil No", "SGK Sicil", "Sicil No"],
  hireDate: ["İşe Giriş Tarihi", "Ise Giris Tarihi", "Giriş Tarihi", "Giris Tarihi"],
  terminationDate: [
    "İşten Çıkış Tarihi",
    "Isten Cikis Tarihi",
    "Çıkış Tarihi",
    "Cikis Tarihi",
  ],
  sgkCode: ["Meslek Kodu", "SGK Meslek Kodu", "SGK Kodu", "SGKMeslekKodu"],
  department: ["Departman", "Bölüm", "Bolum"],
  position: ["Görev", "Gorev", "Ünvan", "Unvan", "Pozisyon"],
  grossSalary: ["Brüt Ücret", "Brut Ucret", "Brüt Maaş", "Brut Maas"],
  netSalary: ["Net Ücret", "Net Ucret", "Net Maaş", "Net Maas"],
  workType: ["Çalışma Türü", "Calisma Turu", "Çalışma Tipi"],
  isActive: ["Aktif/Pasif", "Aktif Pasif", "Aktif", "Durum"],
};

function normalizeHeader(value) {
  return String(value ?? "")
    .toLocaleUpperCase("tr")
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/[^A-Z0-9]/g, "");
}

function getRowValue(row, aliases) {
  const keys = Object.keys(row || {});
  for (const alias of aliases) {
    const wanted = normalizeHeader(alias);
    const foundKey = keys.find((key) => normalizeHeader(key) === wanted);
    if (foundKey !== undefined) return row[foundKey];
  }
  return "";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function parseActiveValue(value) {
  const normalized = normalizeHeader(value);
  if (!normalized) return true;
  if (["PASIF", "HAYIR", "NO", "FALSE", "0", "INACTIVE", "KAPALI"].includes(normalized)) {
    return false;
  }
  return true;
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDateTR(value);
  if (typeof value === "number") return formatDateTR(value);
  return String(value).trim();
}

function parseMoneyValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = String(value).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseIkPersonelSheet(sheetRows = []) {
  return sheetRows
    .map((row, index) => {
      const fullName = cleanText(getRowValue(row, COLUMN_ALIASES.fullName));
      const tcNo = cleanText(getRowValue(row, COLUMN_ALIASES.tcNo));
      if (!fullName && !tcNo) return null;

      return {
        rowIndex: index + 2,
        fullName,
        tcNo,
        sgkSicilNo: cleanText(getRowValue(row, COLUMN_ALIASES.sgkSicilNo)),
        hireDate: parseDateValue(getRowValue(row, COLUMN_ALIASES.hireDate)),
        terminationDate: parseDateValue(getRowValue(row, COLUMN_ALIASES.terminationDate)),
        sgkCode: cleanText(getRowValue(row, COLUMN_ALIASES.sgkCode)),
        department: cleanText(getRowValue(row, COLUMN_ALIASES.department)),
        position: cleanText(getRowValue(row, COLUMN_ALIASES.position)),
        grossSalary: parseMoneyValue(getRowValue(row, COLUMN_ALIASES.grossSalary)),
        netSalary: parseMoneyValue(getRowValue(row, COLUMN_ALIASES.netSalary)),
        workType: cleanText(getRowValue(row, COLUMN_ALIASES.workType)) || "Tam zamanlı",
        isActive: parseActiveValue(getRowValue(row, COLUMN_ALIASES.isActive)),
      };
    })
    .filter(Boolean);
}

export async function parseIkPersonelExcelFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return parseIkPersonelSheet(rows);
}

export function downloadIkPersonelTemplate() {
  const sampleRows = [
    {
      "Ad Soyad": "Ahmet Yılmaz",
      "TC No": "11111111111",
      "SGK Sicil No": "12345678901",
      "İşe Giriş Tarihi": "01.01.2024",
      "İşten Çıkış Tarihi": "",
      "Meslek Kodu": "2411.01",
      "Departman": "Muhasebe",
      "Görev": "Muhasebe Uzmanı",
      "Brüt Ücret": "45000",
      "Net Ücret": "35000",
      "Çalışma Türü": "Tam zamanlı",
      "Aktif/Pasif": "Aktif",
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleRows, {
    header: IK_PERSONEL_EXCEL_HEADERS,
  });
  worksheet["!cols"] = IK_PERSONEL_EXCEL_HEADERS.map(() => ({ wch: 20 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Personel");
  XLSX.writeFile(workbook, "IK_Personel_Sablonu.xlsx");
}
