"use client";

import { useMemo, useState } from "react";
import {
  ANNUAL_LEAVE_DAYS,
  DEFAULT_PAYROLL_YEAR,
  EMPLOYEE_STATUS,
  getAvailablePayrollYears,
  MONTHS_TR,
  SGK_DISCOUNT,
  WAGE_TYPE,
} from "@/src/config/payrollParameters";
import { calculatePayrollProjection } from "@/src/utils/maasHesaplama";
import { exportMaasHesaplamaExcel } from "@/src/utils/maasHesaplamaExcel";
import {
  formatTurkishMoney,
  parseTurkishAmount,
} from "@/src/utils/turkishNumberFormat";
import CalculatorResultField from "@/app/components/landing/CalculatorResultField";
import {
  calculatorInputClassName,
  calculatorLabelClassName,
} from "@/app/components/landing/calculatorShared";

const TAB_BRUT_NET = "brut-net";
const TAB_NET_BRUT = "net-brut";

const selectClassName = `${calculatorInputClassName} cursor-pointer`;

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-bold text-slate-900 sm:text-xl">{value} TL</p>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-violet-50 py-3 last:border-b-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value} TL</span>
    </div>
  );
}

export default function MaasHesaplamaMerkezi() {
  const [activeTab, setActiveTab] = useState(TAB_BRUT_NET);
  const [showDetails, setShowDetails] = useState(true);

  const [year, setYear] = useState(DEFAULT_PAYROLL_YEAR);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [salaryInput, setSalaryInput] = useState("45000");
  const [sgkDays, setSgkDays] = useState("30");
  const [employeeStatus, setEmployeeStatus] = useState(EMPLOYEE_STATUS.NORMAL);
  const [sgkDiscount, setSgkDiscount] = useState(SGK_DISCOUNT.NONE);
  const [startMonth, setStartMonth] = useState(1);
  const [cumulativeTaxBaseInput, setCumulativeTaxBaseInput] = useState("0");
  const [usedExemptionMonths, setUsedExemptionMonths] = useState("0");
  const [netRoadInput, setNetRoadInput] = useState("0");
  const [annualLeaveDays, setAnnualLeaveDays] = useState(14);

  const wageType = activeTab === TAB_NET_BRUT ? WAGE_TYPE.NET : WAGE_TYPE.GROSS;
  const isRetired = employeeStatus === EMPLOYEE_STATUS.RETIRED;

  const formInput = useMemo(
    () => ({
      year: Number(year),
      selectedMonth: Number(selectedMonth),
      wageType,
      salaryAmount: parseTurkishAmount(salaryInput),
      sgkDays: Math.min(30, Math.max(0, Number(sgkDays) || 0)),
      employeeStatus,
      sgkDiscount: isRetired ? SGK_DISCOUNT.NONE : sgkDiscount,
      startMonth: Number(startMonth),
      cumulativeTaxBaseBefore: parseTurkishAmount(cumulativeTaxBaseInput),
      usedExemptionMonths: Number(usedExemptionMonths) || 0,
      netRoadPayment: parseTurkishAmount(netRoadInput),
      annualLeaveDays,
    }),
    [
      year,
      selectedMonth,
      wageType,
      salaryInput,
      sgkDays,
      employeeStatus,
      sgkDiscount,
      isRetired,
      startMonth,
      cumulativeTaxBaseInput,
      usedExemptionMonths,
      netRoadInput,
      annualLeaveDays,
    ]
  );

  const projection = useMemo(
    () => calculatePayrollProjection(formInput),
    [formInput]
  );

  const selected = projection.selectedRow;
  const money = (value) => formatTurkishMoney(value);

  const handleExportExcel = () => {
    exportMaasHesaplamaExcel(projection, {
      year,
      wageTypeLabel: wageType === WAGE_TYPE.NET ? "Net ücret" : "Brüt ücret",
      employeeStatusLabel: isRetired ? "Emekli / SGDP" : "Normal çalışan",
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  return (
    <div className="maas-hesaplama-root space-y-8">
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .maas-hesaplama-root,
          .maas-hesaplama-root * {
            visibility: visible;
          }
          .maas-hesaplama-root {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Bu hesaplama bilgilendirme amaçlıdır; resmi bordro yerine geçmez. Kesin
        tutarlar için mevzuat ve firma uygulamalarını dikkate alınız.
      </div>

      <div className="no-print flex flex-wrap gap-2 rounded-2xl border border-violet-100 bg-white p-2">
        <button
          type="button"
          onClick={() => handleTabChange(TAB_BRUT_NET)}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            activeTab === TAB_BRUT_NET
              ? "bg-violet-700 text-white shadow-md shadow-violet-500/20"
              : "text-slate-600 hover:bg-violet-50 hover:text-violet-700"
          }`}
        >
          Brüt → Net Maaş Hesaplama
        </button>
        <button
          type="button"
          onClick={() => handleTabChange(TAB_NET_BRUT)}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            activeTab === TAB_NET_BRUT
              ? "bg-violet-700 text-white shadow-md shadow-violet-500/20"
              : "text-slate-600 hover:bg-violet-50 hover:text-violet-700"
          }`}
        >
          Net → Brüt Maaş Hesaplama
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Hesaplama Girdileri</h3>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={calculatorLabelClassName}>Yıl</label>
              <select
                className={selectClassName}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {getAvailablePayrollYears().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={calculatorLabelClassName}>Ay</label>
              <select
                className={selectClassName}
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
              >
                {MONTHS_TR.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={calculatorLabelClassName}>Ücret türü</label>
              <select className={selectClassName} value={wageType} disabled>
                <option value={WAGE_TYPE.GROSS}>Brüt ücret</option>
                <option value={WAGE_TYPE.NET}>Net ücret</option>
              </select>
            </div>

            <div>
              <label className={calculatorLabelClassName}>
                {wageType === WAGE_TYPE.NET ? "Net maaş tutarı" : "Brüt maaş tutarı"}
              </label>
              <input
                className={calculatorInputClassName}
                value={salaryInput}
                onChange={(e) => setSalaryInput(e.target.value)}
                onBlur={() => setSalaryInput(money(parseTurkishAmount(salaryInput)))}
                inputMode="decimal"
              />
            </div>

            <div>
              <label className={calculatorLabelClassName}>SGK prim gün sayısı</label>
              <input
                className={calculatorInputClassName}
                value={sgkDays}
                onChange={(e) => setSgkDays(e.target.value)}
                inputMode="numeric"
              />
            </div>

            <div>
              <label className={calculatorLabelClassName}>Çalışan durumu</label>
              <select
                className={selectClassName}
                value={employeeStatus}
                onChange={(e) => setEmployeeStatus(e.target.value)}
              >
                <option value={EMPLOYEE_STATUS.NORMAL}>Normal çalışan</option>
                <option value={EMPLOYEE_STATUS.RETIRED}>Emekli çalışan / SGDP</option>
              </select>
            </div>

            <div>
              <label className={calculatorLabelClassName}>SGK indirimi</label>
              <select
                className={selectClassName}
                value={isRetired ? SGK_DISCOUNT.NONE : sgkDiscount}
                onChange={(e) => setSgkDiscount(e.target.value)}
                disabled={isRetired}
              >
                <option value={SGK_DISCOUNT.NONE}>Teşviksiz</option>
                <option value={SGK_DISCOUNT.DISCOUNT_2}>2 puan indirim</option>
                <option value={SGK_DISCOUNT.DISCOUNT_5}>5 puan indirim</option>
              </select>
            </div>

            <div>
              <label className={calculatorLabelClassName}>İşe giriş ayı</label>
              <select
                className={selectClassName}
                value={startMonth}
                onChange={(e) => setStartMonth(Number(e.target.value))}
              >
                {MONTHS_TR.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={calculatorLabelClassName}>
                Devreden kümülatif gelir vergisi matrahı
              </label>
              <input
                className={calculatorInputClassName}
                value={cumulativeTaxBaseInput}
                onChange={(e) => setCumulativeTaxBaseInput(e.target.value)}
                onBlur={() =>
                  setCumulativeTaxBaseInput(
                    money(parseTurkishAmount(cumulativeTaxBaseInput))
                  )
                }
                inputMode="decimal"
              />
            </div>

            <div>
              <label className={calculatorLabelClassName}>
                Daha önce kullanılan asgari ücret istisna ay sayısı
              </label>
              <input
                className={calculatorInputClassName}
                value={usedExemptionMonths}
                onChange={(e) => setUsedExemptionMonths(e.target.value)}
                inputMode="numeric"
              />
            </div>

            <div>
              <label className={calculatorLabelClassName}>Aylık net yol ödemesi</label>
              <input
                className={calculatorInputClassName}
                value={netRoadInput}
                onChange={(e) => setNetRoadInput(e.target.value)}
                onBlur={() => setNetRoadInput(money(parseTurkishAmount(netRoadInput)))}
                inputMode="decimal"
              />
            </div>

            <div>
              <label className={calculatorLabelClassName}>Yıllık izin gün sayısı</label>
              <select
                className={selectClassName}
                value={annualLeaveDays}
                onChange={(e) => setAnnualLeaveDays(Number(e.target.value))}
              >
                {ANNUAL_LEAVE_DAYS.map((days) => (
                  <option key={days} value={days}>
                    {days} gün
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">Seçili Ay Sonuçları</h3>
            <div className="no-print flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100"
              >
                {showDetails ? "Detayı Gizle" : "Detayı Göster"}
              </button>
              <button
                type="button"
                onClick={handleExportExcel}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
              >
                Excel&apos;e Aktar
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                PDF / Yazdır
              </button>
            </div>
          </div>

          {selected ? (
            <>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <CalculatorResultField
                  label="Brüt maaş"
                  value={money(selected.grossSalary)}
                  highlight
                />
                <CalculatorResultField
                  label="Net maaş"
                  value={money(selected.netSalary)}
                  highlight
                />
                <CalculatorResultField
                  label="Toplam işveren maliyeti"
                  value={money(selected.totalEmployerCost)}
                />
                <CalculatorResultField
                  label="Yol dahil toplam maliyet"
                  value={money(selected.totalCostWithRoad)}
                />
              </div>

              {showDetails ? (
                <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
                  <DetailRow label="SGK işçi primi" value={money(selected.sgkEmployee)} />
                  <DetailRow
                    label="İşsizlik işçi primi"
                    value={money(selected.unemploymentEmployee)}
                  />
                  <DetailRow
                    label="Gelir vergisi matrahı"
                    value={money(selected.incomeTaxBase)}
                  />
                  <DetailRow
                    label="Kümülatif gelir vergisi matrahı"
                    value={money(selected.cumulativeTaxBase)}
                  />
                  <DetailRow label="Gelir vergisi" value={money(selected.incomeTax)} />
                  <DetailRow
                    label="Asgari ücret gelir vergisi istisnası"
                    value={money(selected.minWageIncomeTaxExemption)}
                  />
                  <DetailRow label="Damga vergisi" value={money(selected.stampTax)} />
                  <DetailRow
                    label="Asgari ücret damga vergisi istisnası"
                    value={money(selected.minWageStampTaxExemption)}
                  />
                  <DetailRow label="SGK işveren primi" value={money(selected.sgkEmployer)} />
                  <DetailRow
                    label="İşsizlik işveren primi"
                    value={money(selected.unemploymentEmployer)}
                  />
                  <DetailRow label="Net yol" value={money(selected.netRoadPayment)} />
                  <DetailRow label="Brüt yol" value={money(selected.grossRoadPayment)} />
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      <section>
        <h3 className="text-lg font-semibold text-slate-900">Özet Kartları</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="İlk ay net ödeme"
            value={money(projection.summary.firstMonthNet)}
          />
          <SummaryCard
            label="İlk ay brüt ücret"
            value={money(projection.summary.firstMonthGross)}
          />
          <SummaryCard
            label="Ortalama aylık işveren maliyeti"
            value={money(projection.summary.averageEmployerCost)}
          />
          <SummaryCard
            label="Yıl sonu toplam brüt"
            value={money(projection.summary.yearEndTotalGross)}
          />
          <SummaryCard
            label="Yıl sonu toplam net"
            value={money(projection.summary.yearEndTotalNet)}
          />
          <SummaryCard
            label="Dönem toplam işveren maliyeti"
            value={money(projection.summary.periodTotalEmployerCost)}
          />
          <SummaryCard
            label="Ortalama personel kesintisi"
            value={money(projection.summary.averageEmployeeDeduction)}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
        <div className="border-b border-violet-100 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-900">Aylık Projeksiyon Tablosu</h3>
          <p className="mt-1 text-sm text-slate-500">
            İşe giriş ayından yıl sonuna kadar hesaplanan dönem özeti.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full text-left text-sm">
            <thead className="bg-violet-50 text-xs uppercase tracking-wide text-violet-700">
              <tr>
                <th className="px-4 py-3">Ay</th>
                <th className="px-4 py-3">SGK Gün</th>
                <th className="px-4 py-3">Brüt Maaş</th>
                <th className="px-4 py-3">Net Maaş</th>
                <th className="px-4 py-3">SGK İşçi</th>
                <th className="px-4 py-3">İşsizlik İşçi</th>
                <th className="px-4 py-3">GV Matrahı</th>
                <th className="px-4 py-3">Kümülatif Matrah</th>
                <th className="px-4 py-3">Gelir Vergisi</th>
                <th className="px-4 py-3">Damga Vergisi</th>
                <th className="px-4 py-3">İşveren Primi</th>
                <th className="px-4 py-3">Toplam Maliyet</th>
              </tr>
            </thead>
            <tbody>
              {projection.monthlyRows.map((row) => (
                <tr
                  key={row.month}
                  className={`border-t border-violet-50 ${
                    row.isSelected ? "bg-violet-50/70" : "bg-white"
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-slate-900">{row.monthLabel}</td>
                  <td className="px-4 py-3">{row.sgkDays}</td>
                  <td className="px-4 py-3">{money(row.grossSalary)}</td>
                  <td className="px-4 py-3">{money(row.netSalary)}</td>
                  <td className="px-4 py-3">{money(row.sgkEmployee)}</td>
                  <td className="px-4 py-3">{money(row.unemploymentEmployee)}</td>
                  <td className="px-4 py-3">{money(row.incomeTaxBase)}</td>
                  <td className="px-4 py-3">{money(row.cumulativeTaxBase)}</td>
                  <td className="px-4 py-3">{money(row.incomeTax)}</td>
                  <td className="px-4 py-3">{money(row.netStampTax)}</td>
                  <td className="px-4 py-3">
                    {money(row.sgkEmployer + row.unemploymentEmployer)}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {money(row.totalCostWithRoad)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
