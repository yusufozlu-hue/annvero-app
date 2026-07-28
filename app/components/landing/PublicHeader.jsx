"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

const navLinks = [
  { label: "Ana Sayfa", href: "/" },
  { label: "Hizmetler", href: "/#hizmetler" },
  { label: "Mali Gündem", href: "/mevzuat-hap-notlari" },
  { label: "Hesaplama Araçları", href: "/hesaplama-araclari" },
  { label: "Hakkımızda", href: "/#hakkimizda" },
  { label: "İletişim", href: "/#iletisim" },
];

const SCROLL_COMPACT_THRESHOLD = 8;

export default function PublicHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPathname, setMenuPathname] = useState(pathname);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef(null);
  const menuId = useId();

  // Close the mobile menu on client navigations (render-time adjust, not an effect).
  if (pathname !== menuPathname) {
    setMenuPathname(pathname);
    if (menuOpen) {
      setMenuOpen(false);
    }
  }

  useEffect(() => {
    const updateScrolled = () => {
      setScrolled(window.scrollY > SCROLL_COMPACT_THRESHOLD);
    };

    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    const onPointerDown = (event) => {
      if (headerRef.current && !headerRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  const headerSurfaceClass = scrolled
    ? "border-b border-violet-100 bg-white/90 shadow-sm shadow-slate-900/5 backdrop-blur-md"
    : "border-b border-violet-100/60 bg-white/80 backdrop-blur-sm";

  const barPaddingClass = scrolled ? "py-2.5" : "py-4";

  return (
    <header
      ref={headerRef}
      className={`sticky top-0 z-[100] transition-[background-color,box-shadow,border-color] duration-200 ${headerSurfaceClass}`}
    >
      <div
        className={`mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 transition-[padding] duration-200 sm:px-6 lg:px-8 ${barPaddingClass}`}
      >
        <Link href="/" className="flex items-center" aria-label="ANNVERO ana sayfa">
          <Image
            src="/annvero-logo.png"
            alt="ANNVERO"
            width={150}
            height={42}
            priority
            className={`h-auto w-auto transition-[max-height] duration-200 ${
              scrolled ? "max-h-8" : "max-h-[42px]"
            }`}
          />
        </Link>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Ana menü">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-600 transition hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="rounded-full bg-violet-700 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:bg-violet-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
          >
            Platform Girişi
          </Link>
        </nav>

        <div className="flex items-center gap-3 lg:hidden">
          <Link
            href="/login"
            className="rounded-full bg-violet-700 px-3 py-2 text-xs font-semibold text-white shadow-md shadow-violet-500/25 sm:px-4 sm:text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
          >
            Platform Girişi
          </Link>
          <button
            type="button"
            aria-label={menuOpen ? "Menüyü kapat" : "Menüyü aç"}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-lg border border-violet-100 bg-white/80 p-2 text-slate-700 transition hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
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
              aria-hidden="true"
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
        <nav
          id={menuId}
          className="border-t border-violet-100 bg-white/95 px-4 py-4 backdrop-blur-md lg:hidden"
          aria-label="Mobil menü"
        >
          <div className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-violet-50 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
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
