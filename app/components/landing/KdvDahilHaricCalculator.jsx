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

export default function KdvDahilHaricCalculator() {
  const [calcType, setCalcType] = useState("exclusive");
  const [amountInput, setAmountInput] = useState("");
  const [rate, setRate] = useState("20");

  const amount = parseTurkishAmount(amountInput);
  const rateNumber = Number(rate);

  const { matrah, kdvTutari, toplam } = useMemo(() => {
    const rateRatio = rateNumber / 100;

    if (calcType === "exclusive") {
      const base = amount;
      const kdv = base * rateRatio;
      return {
        matrah: base,
        kdvTutari: kdv,
        toplam: base + kdv,
      };
    }

    const total = amount;
    const base = total / (1 + rateRatio);
    return {
      matrah: base,
      kdvTutari: total - base,
      toplam: total,
    };
  }, [amount, calcType, rateNumber]);

  const handleAmountBlur = () => {
    if (!amountInput.trim()) return;
    setAmountInput(formatTurkishMoney(amount));
  };

  const amountLabel =
    calcType === "exclusive"
      ? "Tutar (KDV hariç matrah)"
      : "Tutar (KDV dahil toplam)";

  return (
    <div className="mt-4 space-y-4">
      <label className="block">
        <span className={calculatorLabelClassName}>Hesaplama Tipi</span>
        <select
          value={calcType}
          onChange={(event) => setCalcType(event.target.value)}
          className={calculatorInputClassName}
        >
          <option value="exclusive">KDV Hariçten Dahile</option>
          <option value="inclusive">KDV Dahilden Hariçe</option>
        </select>
      </label>

      <label className="block">
        <span className={calculatorLabelClassName}>{amountLabel}</span>
        <input
          type="text"
          inputMode="decimal"
          value={amountInput}
          onChange={(event) => setAmountInput(event.target.value)}
          onBlur={handleAmountBlur}
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

      <div className="grid gap-3 sm:grid-cols-3">
        <CalculatorResultField
          label="Matrah"
          value={formatTurkishMoney(matrah)}
        />
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
