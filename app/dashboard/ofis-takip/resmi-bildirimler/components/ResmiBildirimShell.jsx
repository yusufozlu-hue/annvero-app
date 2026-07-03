"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthUserBar from "@/src/components/AuthUserBar";
import BuildVersionBadge from "@/app/components/BuildVersionBadge";
import { CHANNEL_META, RESMI_BILDIRIM_BASE } from "@/src/config/resmiBildirimDefaults";

const navBtn =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white";

export default function ResmiBildirimShell({ title, description, children }) {
  const pathname = usePathname();

  const tabs = Object.values(CHANNEL_META);

  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white sm:p-8">
      <header className="mb-8 flex flex-col gap-4 border-b border-gray-800 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <nav className="mb-3 flex flex-wrap gap-2" aria-label="Modül gezinme">
            <Link href="/dashboard" className={navBtn}>
              ← Dashboard
            </Link>
            <Link href="/ofis-takip" className={navBtn}>
              Ofis Takip
            </Link>
            <Link href={RESMI_BILDIRIM_BASE} className={navBtn}>
              Resmi Bildirimler
            </Link>
          </nav>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-gray-500">
            Ofis Takip Modülü
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-gray-400">{description}</p> : null}
          <BuildVersionBadge className="mt-2" />
        </div>
        <div className="w-full lg:w-auto lg:shrink-0">
          <AuthUserBar variant="embedded" />
        </div>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                active
                  ? "bg-violet-600 text-white"
                  : "border border-gray-700 text-gray-300 hover:bg-gray-900"
              }`}
            >
              {tab.shortLabel}
              {!tab.ready ? " (yakında)" : ""}
            </Link>
          );
        })}
      </div>

      {children}
    </main>
  );
}
