"use client";

import Link from "next/link";

const baseBtn =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white";

const lightBtn =
  "inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-teal-500 hover:bg-teal-50 hover:text-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function AnnveroModuleNav({
  variant = "muhasebe-subpage",
  tone = "dark",
  className = "",
}) {
  const btn = tone === "light" ? lightBtn : baseBtn;

  if (variant === "muhasebe-home") {
    return (
      <nav className={`flex flex-wrap gap-3 ${className}`} aria-label="Modül gezinme">
        <Link href="/ofis-takip" className={btn}>
          ← Ofis Takip&apos;e Dön
        </Link>
        <Link href="/dashboard" className={btn}>
          Dashboard
        </Link>
      </nav>
    );
  }

  if (variant === "ofis-takip") {
    return (
      <nav className={`flex flex-wrap gap-3 ${className}`} aria-label="Modül gezinme">
        <Link href="/muhasebe" className={btn}>
          Muhasebe Modülü
        </Link>
        <Link href="/dashboard" className={btn}>
          Dashboard
        </Link>
      </nav>
    );
  }

  return (
    <nav className={`flex flex-wrap gap-3 ${className}`} aria-label="Modül gezinme">
      <Link href="/muhasebe" className={btn}>
        ← Muhasebe Paneline Dön
      </Link>
      <Link href="/ofis-takip" className={btn}>
        Ofis Takip
      </Link>
      <Link href="/dashboard" className={btn}>
        Dashboard
      </Link>
    </nav>
  );
}
