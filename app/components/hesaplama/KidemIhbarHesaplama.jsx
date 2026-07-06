"use client";

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CALCULATION_SCOPE,
  CALCULATION_SCOPE_OPTIONS,
  DEFAULT_SEVERANCE_YEAR,
} from "@/src/config/severanceNoticeParameters";
import { calculateSeveranceNotice } from "@/src/utils/kidemIhbarHesaplama";
import { readKidemIhbarPrefill } from "@/src/utils/ikPersonelEngine";
import {
  formatTurkishMoney,
  parseTurkishAmount,
} from "@/src/utils/turkishNumberFormat";

const inputClassName =
  "w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20";

const labelClassName = "mb-2 block text-sm font-medium text-slate-300";

function SummaryCard({ label, value, suffix = "TL", highlight = false }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        highlight
          ? "border-violet-500/50 bg-violet-950/40"
          : "border-slate-700 bg-slate-800/80"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`mt-2 text-lg font-bold sm:text-xl ${
          highlight ? "text-violet-300" : "text-slate-100"
        }`}
      >
        {value}
        {suffix ? ` ${suffix}` : ""}
      </p>
    </div>
  );
}

function DetailSection({ title, rows, money }) {
  if (!rows?.length) return null;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <h4 className="text-sm font-semibold text-violet-300">{title}</h4>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1 border-b border-slate-800 py-2 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <dt className="text-sm text-slate-400">{row.label}</dt>
            <dd
              className={`text-sm font-semibold ${
                row.highlight ? "text-violet-300" : "text-slate-100"
              }`}
            >
              {typeof row.value === "number" ? `${money(row.value)} TL` : row.value}
              {row.note ? (
                <span className="mt-1 block text-xs font-normal text-slate-500 sm:mt-0 sm:ml-2 sm:inline">
                  {row.note}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MoneyInput({ label, value, onChange, onBlur, placeholder }) {
  return (
    <label className="block">
      <span className={labelClassName}>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        className={inputClassName}
      />
    </label>
  );
}

export default function KidemIhbarHesaplama() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [scope, setScope] = useState(CALCULATION_SCOPE.BOTH);
  const [lastGrossInput, setLastGrossInput] = useState("");
  const [travelMealInput, setTravelMealInput] = useState("0");
  const [otherBenefitsInput, setOtherBenefitsInput] = useState("0");
  const [annualBonusInput, setAnnualBonusInput] = useState("0");
  const [ceilingInput, setCeilingInput] = useState("");
  const [cumulativeTaxInput, setCumulativeTaxInput] = useState("0");
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const prefill = readKidemIhbarPrefill();
    if (!prefill) return;
    if (!startDate && prefill.startDate) setStartDate(prefill.startDate);
    if (!endDate && prefill.endDate) setEndDate(prefill.endDate);
    if (!lastGrossInput && prefill.lastGrossSalary) {
      setLastGrossInput(formatTurkishMoney(prefill.lastGrossSalary));
    }
  }, []);

  const formatBlur = (setter, raw) => {
    if (!raw.trim()) return;
    setter(formatTurkishMoney(parseTurkishAmount(raw)));
  };

  const formInput = useMemo(
    () => ({
      year: DEFAULT_SEVERANCE_YEAR,
      startDate,
      endDate,
      scope,
      lastGrossSalary: parseTurkishAmount(lastGrossInput),
      monthlyTravelMeal: parseTurkishAmount(travelMealInput),
      monthlyOtherBenefits: parseTurkishAmount(otherBenefitsInput),
      annualBonus: parseTurkishAmount(annualBonusInput),
      severanceCeiling: parseTurkishAmount(ceilingInput),
      cumulativeTaxBaseBefore: parseTurkishAmount(cumulativeTaxInput),
    }),
    [
      startDate,
      endDate,
      scope,
      lastGrossInput,
      travelMealInput,
      otherBenefitsInput,
      annualBonusInput,
      ceilingInput,
      cumulativeTaxInput,
    ]
  );

  const result = useMemo(() => calculateSeveranceNotice(formInput), [formInput]);
  const money = (value) => formatTurkishMoney(value ?? 0);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="kidem-ihbar-calculator space-y-6">
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-100">
        Bu hesaplama bilgilendirme ve ön kontrol amacıyla hazırlanmıştır. Kıdem ve
        ihbar tazminatına hak kazanma durumu, fesih nedeni ve güncel mevzuata göre
        ayrıca değerlendirilmelidir.
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-lg sm:p-6">
        <h3 className="text-lg font-semibold text-slate-100">Hesaplama Girdileri</h3>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClassName}>İşe giriş tarihi</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className={labelClassName}>İşten çıkış tarihi</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className={inputClassName}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className={labelClassName}>Hesaplama kapsamı</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              className={`${inputClassName} cursor-pointer`}
            >
              {CALCULATION_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <MoneyInput
            label="Son aylık brüt ücret"
            value={lastGrossInput}
            onChange={(event) => setLastGrossInput(event.target.value)}
            onBlur={() => formatBlur(setLastGrossInput, lastGrossInput)}
            placeholder="Örn. 45.000,00"
          />

          <MoneyInput
            label="Aylık brüt yol + yemek yardımı toplamı"
            value={travelMealInput}
            onChange={(event) => setTravelMealInput(event.target.value)}
            onBlur={() => formatBlur(setTravelMealInput, travelMealInput)}
            placeholder="0,00"
          />

          <MoneyInput
            label="Aylık diğer düzenli brüt menfaatler"
            value={otherBenefitsInput}
            onChange={(event) => setOtherBenefitsInput(event.target.value)}
            onBlur={() => formatBlur(setOtherBenefitsInput, otherBenefitsInput)}
            placeholder="0,00"
          />

          <MoneyInput
            label="Yıllık brüt ikramiye toplamı"
            value={annualBonusInput}
            onChange={(event) => setAnnualBonusInput(event.target.value)}
            onBlur={() => formatBlur(setAnnualBonusInput, annualBonusInput)}
            placeholder="0,00"
          />

          <MoneyInput
            label="Kıdem tazminatı tavanı (aylık)"
            value={ceilingInput}
            onChange={(event) => setCeilingInput(event.target.value)}
            onBlur={() => formatBlur(setCeilingInput, ceilingInput)}
            placeholder="Güncel aylık tavan"
          />

          <MoneyInput
            label="İhbar öncesi kümülatif gelir vergisi matrahı"
            value={cumulativeTaxInput}
            onChange={(event) => setCumulativeTaxInput(event.target.value)}
            onBlur={() => formatBlur(setCumulativeTaxInput, cumulativeTaxInput)}
            placeholder="0,00"
          />
        </div>
      </div>

      {!result.ok && result.errors.length > 0 ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-200"
        >
          <p className="font-semibold">Lütfen aşağıdaki alanları kontrol edin:</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {result.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.ok && result.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-100">
          <ul className="list-inside list-disc space-y-1">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.ok ? (
        <>
          <div className="print-results rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-lg sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-semibold text-slate-100">Hesaplama Sonuçları</h3>
              <div className="flex flex-wrap gap-2 print-hidden">
                <button
                  type="button"
                  onClick={() => setShowDetails((current) => !current)}
                  className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-violet-500 hover:text-violet-300"
                >
                  {showDetails ? "Detayı Gizle" : "Detayı Göster"}
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
                >
                  Yazdır
                </button>
                <button
                  type="button"
                  disabled
                  title="Yakında"
                  className="cursor-not-allowed rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-semibold text-slate-500"
                >
                  PDF / Excel
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryCard label="Toplam hizmet süresi" value={result.service.label} suffix="" />
              <SummaryCard
                label="Kıdeme esas gün"
                value={String(result.service.serviceDays)}
                suffix="gün"
              />
              <SummaryCard
                label="Çıplak brüt ücret"
                value={money(result.wage.bareGrossSalary)}
              />
              <SummaryCard
                label="Giydirilmiş brüt ücret"
                value={money(result.wage.dressedGrossSalary)}
              />
              <SummaryCard
                label="Kıdeme esas aylık ücret"
                value={money(result.wage.severanceBaseMonthly)}
              />
              <SummaryCard
                label="Brüt kıdem tazminatı"
                value={money(result.severance.gross)}
                highlight={result.severance.gross > 0}
              />
              <SummaryCard
                label="Net kıdem tazminatı"
                value={money(result.severance.net)}
              />
              <SummaryCard
                label="İhbar süresi"
                value={`${result.notice.weeks} hafta (${result.notice.days} gün)`}
                suffix=""
              />
              <SummaryCard
                label="Brüt ihbar tazminatı"
                value={money(result.notice.gross)}
                highlight={result.notice.gross > 0}
              />
              <SummaryCard
                label="Gelir vergisi"
                value={money(result.taxes.totalIncomeTax)}
              />
              <SummaryCard label="Damga vergisi" value={money(result.taxes.totalStampTax)} />
              <SummaryCard label="Net ihbar tazminatı" value={money(result.notice.net)} />
              <SummaryCard
                label="Toplam brüt tazminat"
                value={money(result.totals.gross)}
                highlight
              />
              <SummaryCard
                label="Toplam net tazminat"
                value={money(result.totals.net)}
                highlight
              />
            </div>
          </div>

          {showDetails ? (
            <div className="space-y-4 print-results">
              <h3 className="text-base font-semibold text-slate-200">Hesaplama Adımları</h3>
              <DetailSection
                title="1. Ücret bileşenleri"
                rows={result.details.wageComponents}
                money={money}
              />
              <DetailSection
                title="2. Hizmet süresi"
                rows={result.details.serviceSteps}
                money={money}
              />
              <DetailSection
                title="3. Kıdem hesabı"
                rows={result.details.severanceSteps}
                money={money}
              />
              <DetailSection
                title="4. İhbar hesabı"
                rows={result.details.noticeSteps}
                money={money}
              />
              <DetailSection
                title="5. Vergi kesintileri"
                rows={result.details.taxSteps}
                money={money}
              />
              <DetailSection
                title="6. Toplam sonuç"
                rows={result.details.totalSteps}
                money={money}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .kidem-ihbar-calculator,
          .kidem-ihbar-calculator * {
            visibility: visible;
          }
          .kidem-ihbar-calculator {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white !important;
            color: black !important;
          }
          .kidem-ihbar-calculator .print-hidden {
            display: none !important;
          }
          .kidem-ihbar-calculator .rounded-2xl,
          .kidem-ihbar-calculator .rounded-xl {
            border-color: #ccc !important;
            background: white !important;
            color: black !important;
          }
          .kidem-ihbar-calculator p,
          .kidem-ihbar-calculator dt,
          .kidem-ihbar-calculator dd,
          .kidem-ihbar-calculator h3,
          .kidem-ihbar-calculator h4,
          .kidem-ihbar-calculator span {
            color: black !important;
          }
        }
      `}</style>
    </div>
  );
}
