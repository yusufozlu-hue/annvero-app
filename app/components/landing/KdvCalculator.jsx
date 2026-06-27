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
  const [rate, setRate] = useState(20);

  const matrah = parseAmount(matrahInput);

  const { kdvTutari, toplam } = useMemo(() => {
    const kdv = (matrah * rate) / 100;
    return {
      kdvTutari: kdv,
      toplam: matrah + kdv,
    };
  }, [matrah, rate]);

  return (
    <section className="rounded-3xl border border-violet-200 bg-white p-6 shadow-lg shadow-violet-500/10 sm:p-8">
      <div className="mb-6">
        <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
          Aktif
        </span>
        <h2 className="mt-3 text-2xl font-bold text-slate-900">KDV Hesaplama</h2>
        <p className="mt-2 text-sm text-slate-600">
          Matrah ve KDV oranına göre KDV tutarı ile KDV dahil toplamı hesaplayın.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
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
              className="w-full rounded-xl border border-violet-100 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>

          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700">
              KDV Oranı
            </span>
            <div className="flex flex-wrap gap-2">
              {RATE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRate(option.value)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    rate === option.value
                      ? "bg-violet-700 text-white shadow-md shadow-violet-500/25"
                      : "border border-violet-100 bg-white text-violet-700 hover:bg-violet-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-1">
          <ResultCard label="KDV Tutarı" value={formatMoney(kdvTutari)} />
          <ResultCard label="KDV Dahil Toplam" value={formatMoney(toplam)} highlight />
        </div>
      </div>
    </section>
  );
}

function ResultCard({ label, value, highlight = false }) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        highlight
          ? "border-violet-200 bg-gradient-to-br from-violet-50 to-white"
          : "border-violet-100 bg-slate-50"
      }`}
    >
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p
        className={`mt-2 text-2xl font-bold ${
          highlight ? "text-violet-700" : "text-slate-900"
        }`}
      >
        {value} TL
      </p>
    </div>
  );
}
