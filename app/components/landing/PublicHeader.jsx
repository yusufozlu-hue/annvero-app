"use client";

import Link from "next/link";
import { useState } from "react";

const navLinks = [
  { label: "Ana Sayfa", href: "/" },
  { label: "Hizmetler", href: "/#hizmetler" },
  { label: "Vergi Rehberi", href: "/#vergi-rehberi" },
  { label: "Hesaplama Araçları", href: "/hesaplama-araclari" },
  { label: "Hakkımızda", href: "/#hakkimizda" },
  { label: "İletişim", href: "/#iletisim" },
];

export default function PublicHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-violet-100 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 text-sm font-bold text-white shadow-md shadow-violet-500/30">
            A
          </span>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            ANNVERO
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-600 transition hover:text-violet-700"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="rounded-full bg-violet-700 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:bg-violet-800"
          >
            Platform Girişi
          </Link>
        </nav>

        <div className="flex items-center gap-3 lg:hidden">
          <Link
            href="/login"
            className="rounded-full bg-violet-700 px-3 py-2 text-xs font-semibold text-white shadow-md shadow-violet-500/25 sm:px-4 sm:text-sm"
          >
            Platform Girişi
          </Link>
          <button
            type="button"
            aria-label="Menüyü aç"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-lg border border-violet-100 p-2 text-slate-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {menuOpen ? (
                <>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </>
              ) : (
                <>
                  <path d="M4 5h16" />
                  <path d="M4 12h16" />
                  <path d="M4 19h16" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav className="border-t border-violet-100 bg-white px-4 py-4 lg:hidden">
          <div className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-violet-50 hover:text-violet-700"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
