import * as XLSX from "xlsx";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { getCompanyContactSummary } from "./companyBridge";
import { MUKELLEF_EXCEL_HEADERS } from "./constants";

export function downloadMukellefExcelTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    MUKELLEF_EXCEL_HEADERS,
    [
      "Örnek Ltd. Şti.",
      "1234567890",
      "05321234567",
      "info@ornek.com",
      "Firma Yönetimi üzerinden kaydedin",
    ],
  ]);

  ws["!cols"] = [{ wch: 36 }, { wch: 14 }, { wch: 16 }, { wch: 28 }, { wch: 30 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Firmalar");
  XLSX.writeFile(wb, "annvero_firma_sablon.xlsx");
}

export function exportAnnveroCompaniesToExcel(companies = []) {
  const rows = companies.map((company) => {
    const summary = getCompanyContactSummary(company);

    return {
      Unvan: summary.name,
      "Vergi No": summary.taxNumber,
      Telefon: summary.phone,
      "E-posta": summary.email,
      Notlar: summary.contactPeople
        .map((contact) =>
          [contact.name, contact.phone, contact.email].filter(Boolean).join(" / ")
        )
        .join(" | "),
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: MUKELLEF_EXCEL_HEADERS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Firmalar");
  XLSX.writeFile(wb, "annvero_firmalar.xlsx");
}
