import * as XLSX from "xlsx";
import { formatDateTR } from "@/src/utils/formatDateTR";

export const DEFAULT_SALARY_ACCOUNT = "335";
export const DEFAULT_ADVANCE_ACCOUNT = "196";

export const EMPLOYEE_EXCEL_HEADERS = [
  "Ad Soyad",
  "TC No",
  "Görev",
  "Departman",
  "İşe Giriş Tarihi",
  "SGK Meslek Kodu",
  "Maaş Hesabı",
  "Avans Hesabı",
  "Aktif/Pasif",
];

const COLUMN_ALIASES = {
  fullName: ["Ad Soyad", "AdSoyad", "Adı Soyadı", " Isim", "İsim", "Personel"],
  tcNo: ["TC No", "TCNo", "TC Kimlik", "TC Kimlik No", "Kimlik No", "TC"],
  position: ["Görev", "Gorev", "Ünvan", "Unvan", "Pozisyon"],
  department: ["Departman", "Bölüm", "Bolum"],
  hireDate: ["İşe Giriş Tarihi", "Ise Giris Tarihi", "Giriş Tarihi", "Giris Tarihi"],
  sgkCode: [
    "SGK Meslek Kodu",
    "SGK Kodu",
    "Meslek Kodu",
    "SGKMeslekKodu",
  ],
  salaryAccountCode: ["Maaş Hesabı", "Maas Hesabi", "Maaş Hesap", "Maas Hesap"],
  advanceAccountCode: ["Avans Hesabı", "Avans Hesabi", "Avans Hesap"],
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
    if (foundKey !== undefined) {
      return row[foundKey];
    }
  }

  return "";
}

function parseActiveValue(value) {
  const normalized = normalizeHeader(value);
  if (!normalized) return true;

  if (["PASIF", "HAYIR", "NO", "FALSE", "0", "INACTIVE", "KAPALI"].includes(normalized)) {
    return false;
  }

  return true;
}

function parseHireDateValue(value) {
  if (value === null || value === undefined || value === "") return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateTR(value);
  }

  if (typeof value === "number") {
    return formatDateTR(value);
  }

  return String(value).trim();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

/**
 * Excel satırlarını (array-of-objects) normalize edilmiş personel kayıtlarına çevirir.
 * Boş maaş/avans hesapları için varsayılan değerler atanır.
 */
export function parseEmployeeSheet(sheetRows = []) {
  return sheetRows
    .map((row) => {
      const fullName = cleanText(getRowValue(row, COLUMN_ALIASES.fullName));
      const tcNo = cleanText(getRowValue(row, COLUMN_ALIASES.tcNo));

      if (!fullName && !tcNo) return null;

      return {
        fullName,
        tcNo,
        phone: "",
        email: "",
        position: cleanText(getRowValue(row, COLUMN_ALIASES.position)),
        department: cleanText(getRowValue(row, COLUMN_ALIASES.department)),
        hireDate: parseHireDateValue(getRowValue(row, COLUMN_ALIASES.hireDate)),
        sgkCode: cleanText(getRowValue(row, COLUMN_ALIASES.sgkCode)),
        salaryAccountCode:
          cleanText(getRowValue(row, COLUMN_ALIASES.salaryAccountCode)) ||
          DEFAULT_SALARY_ACCOUNT,
        advanceAccountCode:
          cleanText(getRowValue(row, COLUMN_ALIASES.advanceAccountCode)) ||
          DEFAULT_ADVANCE_ACCOUNT,
        isActive: parseActiveValue(getRowValue(row, COLUMN_ALIASES.isActive)),
      };
    })
    .filter(Boolean);
}

export async function parseEmployeeExcelFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return parseEmployeeSheet(rows);
}

export function downloadEmployeeTemplate() {
  const sampleRows = [
    {
      "Ad Soyad": "Ahmet Yılmaz",
      "TC No": "11111111111",
      "Görev": "Muhasebe Uzmanı",
      "Departman": "Muhasebe",
      "İşe Giriş Tarihi": "01.01.2025",
      "SGK Meslek Kodu": "2411.01",
      "Maaş Hesabı": DEFAULT_SALARY_ACCOUNT,
      "Avans Hesabı": DEFAULT_ADVANCE_ACCOUNT,
      "Aktif/Pasif": "Aktif",
    },
    {
      "Ad Soyad": "Ayşe Demir",
      "TC No": "22222222222",
      "Görev": "İnsan Kaynakları",
      "Departman": "İK",
      "İşe Giriş Tarihi": "15.03.2025",
      "SGK Meslek Kodu": "2423.02",
      "Maaş Hesabı": "",
      "Avans Hesabı": "",
      "Aktif/Pasif": "Aktif",
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleRows, {
    header: EMPLOYEE_EXCEL_HEADERS,
  });
  worksheet["!cols"] = EMPLOYEE_EXCEL_HEADERS.map(() => ({ wch: 20 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Personel");
  XLSX.writeFile(workbook, "Personel_Sablonu.xlsx");
}
