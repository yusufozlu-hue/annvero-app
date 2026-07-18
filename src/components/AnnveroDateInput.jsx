"use client";

import { useEffect, useState } from "react";
import {
  isoOrTrToDisplay,
  resolveSmartDateInput,
} from "@/src/utils/smartDateInput";
import { annveroInputClass } from "@/src/styles/annveroDesign";

/**
 * Ortak akıllı tarih girişi (AnnveroDateInput).
 * - value / onChange: ISO (yyyy-mm-dd) veya ""
 * - Tab / Enter / blur: gg.aa → gg.aa.<mevcut yıl>
 * - Geçersiz tarihler için erişilebilir hata; rastgele düzeltme yok
 */
export default function AnnveroDateInput({
  value = "",
  onChange,
  className = annveroInputClass,
  placeholder = "gg.aa.yyyy",
  disabled = false,
  id,
  name,
  "aria-label": ariaLabel,
}) {
  const [text, setText] = useState(() => isoOrTrToDisplay(value));
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setText(isoOrTrToDisplay(value));
      setError("");
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const commit = () => {
    const result = resolveSmartDateInput(text);

    if (result.empty) {
      setText("");
      setError("");
      if (value) onChange?.("");
      return;
    }

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setError("");
    setText(result.display);
    if (result.iso !== value) onChange?.(result.iso);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Tab") {
      // preventDefault yok — odak sonraki alana geçer; önce yıl tamamlanır
      commit();
    }
  };

  return (
    <div className="w-full">
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && id ? `${id}-error` : undefined}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (error) setError("");
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className={className}
      />
      {error ? (
        <p
          id={id ? `${id}-error` : undefined}
          role="alert"
          className="mt-1 text-xs text-red-300"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
