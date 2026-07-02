import * as XLSX from "xlsx";
import { formatTurkishMoney } from "@/src/utils/turkishNumberFormat";

function money(value) {
  return formatTurkishMoney(value);
}

export function buildMaasHesaplamaExcelRows(projection, formMeta = {}) {
  const monthlyRows = projection.monthlyRows.map((row) => ({
    Ay: row.monthLabel,
    "SGK Gün": row.sgkDays,
    "Brüt Maaş": money(row.grossSalary),
    "Net Maaş": money(row.netSalary),
    "SGK İşçi": money(row.sgkEmployee),
    "İşsizlik İşçi": money(row.unemploymentEmployee),
    "GV Matrahı": money(row.incomeTaxBase),
    "Kümülatif Matrah": money(row.cumulativeTaxBase),
    "Gelir Vergisi": money(row.incomeTax),
    "Damga Vergisi": money(row.netStampTax),
    "İşveren Primi": money(row.sgkEmployer + row.unemploymentEmployer),
    "Toplam Maliyet": money(row.totalCostWithRoad),
  }));

  const summaryRows = [
    { Metrik: "İlk ay net ödeme", Değer: money(projection.summary.firstMonthNet) },
    { Metrik: "İlk ay brüt ücret", Değer: money(projection.summary.firstMonthGross) },
    {
      Metrik: "Ortalama aylık işveren maliyeti",
      Değer: money(projection.summary.averageEmployerCost),
    },
    { Metrik: "Yıl sonu toplam brüt", Değer: money(projection.summary.yearEndTotalGross) },
    { Metrik: "Yıl sonu toplam net", Değer: money(projection.summary.yearEndTotalNet) },
    {
      Metrik: "Dönem toplam işveren maliyeti",
      Değer: money(projection.summary.periodTotalEmployerCost),
    },
    {
      Metrik: "Ortalama personel kesintisi",
      Değer: money(projection.summary.averageEmployeeDeduction),
    },
    { Metrik: "Yıl", Değer: String(formMeta.year || "") },
    { Metrik: "Ücret türü", Değer: formMeta.wageTypeLabel || "" },
    { Metrik: "Çalışan durumu", Değer: formMeta.employeeStatusLabel || "" },
  ];

  const detailRows = projection.selectedRow
    ? [
        { Kalem: "Brüt maaş", Tutar: money(projection.selectedRow.grossSalary) },
        { Kalem: "Net maaş", Tutar: money(projection.selectedRow.netSalary) },
        { Kalem: "SGK işçi primi", Tutar: money(projection.selectedRow.sgkEmployee) },
        {
          Kalem: "İşsizlik işçi primi",
          Tutar: money(projection.selectedRow.unemploymentEmployee),
        },
        {
          Kalem: "Gelir vergisi matrahı",
          Tutar: money(projection.selectedRow.incomeTaxBase),
        },
        {
          Kalem: "Kümülatif gelir vergisi matrahı",
          Tutar: money(projection.selectedRow.cumulativeTaxBase),
        },
        { Kalem: "Gelir vergisi", Tutar: money(projection.selectedRow.incomeTax) },
        {
          Kalem: "Asgari ücret gelir vergisi istisnası",
          Tutar: money(projection.selectedRow.minWageIncomeTaxExemption),
        },
        { Kalem: "Damga vergisi", Tutar: money(projection.selectedRow.stampTax) },
        {
          Kalem: "Asgari ücret damga vergisi istisnası",
          Tutar: money(projection.selectedRow.minWageStampTaxExemption),
        },
        { Kalem: "SGK işveren primi", Tutar: money(projection.selectedRow.sgkEmployer) },
        {
          Kalem: "İşsizlik işveren primi",
          Tutar: money(projection.selectedRow.unemploymentEmployer),
        },
        {
          Kalem: "Toplam işveren maliyeti",
          Tutar: money(projection.selectedRow.totalEmployerCost),
        },
        { Kalem: "Net yol", Tutar: money(projection.selectedRow.netRoadPayment) },
        { Kalem: "Brüt yol", Tutar: money(projection.selectedRow.grossRoadPayment) },
        {
          Kalem: "Yol dahil toplam maliyet",
          Tutar: money(projection.selectedRow.totalCostWithRoad),
        },
      ]
    : [];

  return { monthlyRows, summaryRows, detailRows };
}

export function exportMaasHesaplamaExcel(projection, formMeta = {}) {
  const { monthlyRows, summaryRows, detailRows } = buildMaasHesaplamaExcelRows(
    projection,
    formMeta
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    XLSX.utils.json_to_sheet(monthlyRows),
    workbook,
    "Aylık Tablo"
  );
  XLSX.utils.book_append_sheet(
    XLSX.utils.json_to_sheet(summaryRows),
    workbook,
    "Özet"
  );
  if (detailRows.length) {
    XLSX.utils.book_append_sheet(
      XLSX.utils.json_to_sheet(detailRows),
      workbook,
      "Seçili Ay Detay"
    );
  }

  const fileName = `maas-hesaplama-${formMeta.year || "rapor"}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
