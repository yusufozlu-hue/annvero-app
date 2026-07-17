"use client";

import { useMemo, useState } from "react";

function compactCode(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
}

/**
 * Hesap planından kod seçimi — prefix filtresi + autocomplete.
 * Plan dışı kod yazılabilir ama uyarı verilir (boş bırakılabilir).
 */
export default function AccountPlanCodeSelect({
  label = "Luca Hesap Kodu",
  value = "",
  onChange,
  accountPlan = [],
  prefix = "",
  prefixes = null,
  required = false,
  hint = "",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const allowedPrefixes = useMemo(() => {
    if (Array.isArray(prefixes) && prefixes.length) {
      return prefixes.map((p) => compactCode(p));
    }
    if (prefix) return [compactCode(prefix)];
    return [];
  }, [prefix, prefixes]);

  const options = useMemo(() => {
    const rows = (accountPlan || [])
      .filter((row) => row?.isActive !== false)
      .map((row) => ({
        code: compactCode(row.accountCode || row.hesapKodu || row.kod || ""),
        name: String(row.accountName || row.hesapAdi || row.name || "").trim(),
      }))
      .filter((row) => row.code);

    const filtered = allowedPrefixes.length
      ? rows.filter((row) =>
          allowedPrefixes.some(
            (p) => row.code === p || row.code.startsWith(`${p}.`) || row.code.startsWith(p)
          )
        )
      : rows;

    const q = compactCode(query || value).toLocaleLowerCase("tr-TR");
    if (!q) return filtered.slice(0, 40);

    return filtered
      .filter((row) => {
        const hay = `${row.code} ${row.name}`.toLocaleLowerCase("tr-TR");
        return hay.includes(q) || compactCode(row.code).toLowerCase().includes(q);
      })
      .slice(0, 40);
  }, [accountPlan, allowedPrefixes, query, value]);

  const exactInPlan = useMemo(() => {
    const wanted = compactCode(value);
    if (!wanted) return true;
    return (accountPlan || []).some((row) => {
      const code = compactCode(row.accountCode || row.hesapKodu || row.kod || "");
      return code === wanted;
    });
  }, [accountPlan, value]);

  const displayValue = open ? query : value;

  return (
    <label className="relative block space-y-1 text-sm">
      <span className="text-slate-300">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
        value={displayValue}
        placeholder={
          allowedPrefixes.length
            ? `${allowedPrefixes.join("/")} alt hesap seçin…`
            : "Hesap kodu ara…"
        }
        onFocus={() => {
          setQuery(value || "");
          setOpen(true);
        }}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          onChange?.(next);
          setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
      />
      {open && options.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {options.map((opt) => (
            <li key={opt.code}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange?.(opt.code);
                  setQuery(opt.code);
                  setOpen(false);
                }}
              >
                <span className="font-mono text-xs text-indigo-300">{opt.code}</span>
                <span className="text-xs text-slate-400">{opt.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {value && accountPlan?.length > 0 && !exactInPlan ? (
        <p className="text-xs text-amber-400">
          Bu kod hesap planında yok — karar motoru incelemeye düşebilir.
        </p>
      ) : null}
    </label>
  );
}
