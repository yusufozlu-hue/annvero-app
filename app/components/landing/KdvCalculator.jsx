"use client";

import { useMemo, useState } from "react";
import {
  formatTurkishMoney,
  parseTurkishAmount,
} from "@/src/utils/turkishNumberFormat";
import CalculatorResultField from "./CalculatorResultField";
import {
  calculatorInputClassName,
  calculatorLabelClassName,
  KDV_RATE_OPTIONS,
} from "./calculatorShared";

export default function KdvCalculator() {
  const [matrahInput, setMatrahInput] = useState("");
  const [rate, setRate] = useState("20");

  const matrah = parseTurkishAmount(matrahInput);
  const rateNumber = Number(rate);

  const { kdvTutari, toplam } = useMemo(() => {
    const kdv = (matrah * rateNumber) / 100;
    return {
      kdvTutari: kdv,
      toplam: matrah + kdv,
    };
  }, [matrah, rateNumber]);

  const handleMatrahBlur = () => {
    if (!matrahInput.trim()) return;
    setMatrahInput(formatTurkishMoney(matrah));
  };

  return (
    <div className="mt-4 space-y-4">
      <label className="block">
        <span className={calculatorLabelClassName}>Matrah (KDV hariç)</span>
        <input
          type="text"
          inputMode="decimal"
          value={matrahInput}
          onChange={(event) => setMatrahInput(event.target.value)}
          onBlur={handleMatrahBlur}
          placeholder="Örn. 10.000,00"
          className={calculatorInputClassName}
        />
      </label>

      <label className="block">
        <span className={calculatorLabelClassName}>KDV Oranı</span>
        <select
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          className={calculatorInputClassName}
        >
          {KDV_RATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <CalculatorResultField
          label="KDV Tutarı"
          value={formatTurkishMoney(kdvTutari)}
        />
        <CalculatorResultField
          label="KDV Dahil Toplam"
          value={formatTurkishMoney(toplam)}
          highlight
        />
      </div>
    </div>
  );
}
