"use client";

import { useMemo, useState } from "react";

const RATE_OPTIONS = [
  { label: "%1", value: 1 },
  { label: "%10", value: 10 },
  { label: "%20", value: 20 },
];

function parseAmount(value) {
  const normalized = String(value || "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();

  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function KdvCalculator() {
  const [matrahInput, setMatrahInput] = useState("");
  const [rate, setRate] = useState("20");

  const matrah = parseAmount(matrahInput);
  const rateNumber = Number(rate);

  const { kdvTutari, toplam } = useMemo(() => {
    const kdv = (matrah * rateNumber) / 100;
    return {
      kdvTutari: kdv,
      toplam: matrah + kdv,
    };
  }, [matrah, rateNumber]);

  return (
    <div className="mt-4 space-y-4">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-slate-700">
          Matrah (KDV hariç)
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={matrahInput}
          onChange={(event) => setMatrahInput(event.target.value)}
          placeholder="Örn. 10.000,00"
          className="w-full rounded-xl border border-violet-100 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-medium text-slate-700">
          KDV Oranı
        </span>
        <select
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          className="w-full rounded-xl border border-violet-100 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        >
          {RATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <ResultField label="KDV Tutarı" value={formatMoney(kdvTutari)} />
        <ResultField
          label="KDV Dahil Toplam"
          value={formatMoney(toplam)}
          highlight
        />
      </div>
    </div>
  );
}

function ResultField({ label, value, highlight = false }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? "border-violet-200 bg-gradient-to-br from-violet-50 to-white"
          : "border-violet-100 bg-slate-50"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-bold sm:text-xl ${
          highlight ? "text-violet-700" : "text-slate-900"
        }`}
      >
        {value} TL
      </p>
    </div>
  );
}
