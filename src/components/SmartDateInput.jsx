"use client";

import { useEffect, useState } from "react";
import {
  completeSmartDateDisplay,
  completeSmartDateIso,
  isoOrTrToDisplay,
} from "@/src/utils/smartDateInput";
import { annveroInputClass } from "@/src/styles/annveroDesign";

/**
 * Ortak akıllı tarih girişi.
 * - value / onChange: ISO (yyyy-mm-dd) veya ""
 * - Tab / Enter / blur: gg.aa → gg.aa.yyyy (mevcut yıl)
 * - Geçersiz tarihler temizlenir
 */
export default function SmartDateInput({
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

  useEffect(() => {
    setText(isoOrTrToDisplay(value));
  }, [value]);

  const commit = () => {
    const display = completeSmartDateDisplay(text);
    const iso = completeSmartDateIso(text);

    if (!text.trim()) {
      setText("");
      if (value) onChange?.("");
      return;
    }

    if (!iso) {
      // Geçersiz — önceki geçerli değere dön veya temizle
      setText(isoOrTrToDisplay(value));
      return;
    }

    setText(display);
    if (iso !== value) onChange?.(iso);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" || event.key === "Tab") {
      // Tab: blur da tetiklenir; Enter için commit
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else {
        // Tab — commit before leaving
        commit();
      }
    }
  };

  return (
    <input
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
}
