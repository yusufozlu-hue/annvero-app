"use client";

import Link from "next/link";

const baseBtn =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white";

export default function AnnveroModuleNav({ variant = "muhasebe-subpage", className = "" }) {
  if (variant === "muhasebe-home") {
    return (
      <nav className={`flex flex-wrap gap-3 ${className}`} aria-label="Modül gezinme">
        <Link href="/ofis-takip" className={baseBtn}>
          ← Ofis Takip&apos;e Dön
        </Link>
        <Link href="/dashboard" className={baseBtn}>
          Dashboard
        </Link>
      </nav>
    );
  }

  if (variant === "ofis-takip") {
    return (
      <nav className={`flex flex-wrap gap-3 ${className}`} aria-label="Modül gezinme">
        <Link href="/muhasebe" className={baseBtn}>
          Muhasebe Modülü
        </Link>
        <Link href="/dashboard" className={baseBtn}>
          Dashboard
        </Link>
      </nav>
    );
  }

  return (
    <nav className={`flex flex-wrap gap-3 ${className}`} aria-label="Modül gezinme">
      <Link href="/muhasebe" className={baseBtn}>
        ← Muhasebe Paneline Dön
      </Link>
      <Link href="/ofis-takip" className={baseBtn}>
        Ofis Takip
      </Link>
      <Link href="/dashboard" className={baseBtn}>
        Dashboard
      </Link>
    </nav>
  );
}
