"use client";

import Link from "next/link";
import AuthUserBar from "@/src/components/AuthUserBar";
import { useAdminAccess } from "@/src/hooks/useAdminAccess";
import BuildVersionBadge from "@/app/components/BuildVersionBadge";
import MevzuatHapNotlariDashboardCard from "@/src/components/MevzuatHapNotlariDashboardCard";

export default function DashboardPage() {
  const { isAdmin } = useAdminAccess();

  return (
    <main className="min-h-screen bg-black p-6 text-white sm:p-8">
      <header className="mb-10 flex flex-col gap-4 border-b border-gray-800 pb-6 sm:gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-gray-500">
            ANNVERO Dashboard
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Finansal Kontrol Paneli</h1>
          <BuildVersionBadge className="mt-2" />
        </div>
        <div className="w-full lg:w-auto lg:shrink-0">
          <AuthUserBar variant="embedded" showAdminLink />
        </div>
      </header>

      <section>
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-gray-500">
          Modüller
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {isAdmin ? (
            <div className="relative rounded-3xl bg-gradient-to-br from-amber-500/60 via-amber-500/10 to-transparent p-[1.5px]">
              <div className="relative flex h-full flex-col overflow-hidden rounded-[22px] bg-gray-900/90 p-6 shadow-xl shadow-black/30 backdrop-blur-xl">
                <div className="pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full bg-amber-500/25 opacity-70 blur-2xl" />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/30 to-amber-600/5 text-amber-200 ring-1 ring-amber-400/30">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3v18" />
                    <path d="M3 12h18" />
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                  </svg>
                </div>
                <h2 className="relative mt-6 text-2xl font-semibold text-gray-100">
                  Mevzuat Parametre Yönetimi
                </h2>
                <p className="relative mt-2 flex-1 text-sm leading-relaxed text-gray-400">
                  Maaş, SGK, vergi ve diğer hesaplama parametrelerini yönetin.
                </p>
                <Link
                  href="/admin/parametre-yonetimi"
                  className="relative mt-6 inline-flex w-fit items-center justify-center rounded-xl bg-amber-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-amber-500"
                >
                  Parametre Yönetimi
                </Link>
                <Link
                  href="/admin/mevzuat-hap-notlari"
                  className="relative mt-3 inline-flex w-fit items-center justify-center rounded-xl border border-amber-700 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-950"
                >
                  Hap Not Yönetimi
                </Link>
              </div>
            </div>
          ) : null}

          <MevzuatHapNotlariDashboardCard />

          <div className="relative rounded-3xl bg-gradient-to-br from-violet-500/60 via-violet-500/10 to-transparent p-[1.5px]">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[22px] bg-gray-900/90 p-6 shadow-xl shadow-black/30 backdrop-blur-xl">
              <div className="pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full bg-violet-500/25 opacity-70 blur-2xl" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-violet-600/5 text-violet-200 ring-1 ring-violet-400/30">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  <rect width="20" height="14" x="2" y="6" rx="2" />
                </svg>
              </div>
              <h2 className="relative mt-6 text-2xl font-semibold text-gray-100">
                Ofis Takip
              </h2>
              <p className="relative mt-2 flex-1 text-sm leading-relaxed text-gray-400">
                Günlük ofis iş yönetimi, vergi takvimi ve resmi bildirim takibi.
              </p>

              <div className="relative mt-4 rounded-xl border border-violet-700/40 bg-violet-950/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-200">
                  Resmi Bildirim & Tebligat Takibi
                </p>
                <p className="mt-1 text-sm text-gray-400">
                  GİB e-Tebligat kontrolü, hatırlatmalar ve SGK/UETS/KEP hazırlık alanları.
                </p>
                <Link
                  href="/dashboard/ofis-takip/resmi-bildirimler"
                  className="mt-3 inline-flex text-sm font-semibold text-violet-300 hover:text-violet-200"
                >
                  Resmi Bildirimlere Git →
                </Link>
              </div>

              <div className="relative mt-4 flex flex-wrap gap-2">
                <Link
                  href="/ofis-takip"
                  className="inline-flex w-fit items-center justify-center rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
                >
                  Ofis Takip
                </Link>
                <Link
                  href="/dashboard/ofis-takip/resmi-bildirimler/gib"
                  className="inline-flex w-fit items-center justify-center rounded-xl border border-violet-700 px-5 py-3 text-sm font-semibold text-violet-100 transition hover:bg-violet-950"
                >
                  GİB e-Tebligat
                </Link>
              </div>
            </div>
          </div>

          <div className="relative rounded-3xl bg-gradient-to-br from-blue-500/60 via-blue-500/10 to-transparent p-[1.5px]">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[22px] bg-gray-900/90 p-6 shadow-xl shadow-black/30 backdrop-blur-xl">
              <div className="pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full bg-blue-500/25 opacity-70 blur-2xl" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/30 to-sky-600/5 text-blue-200 ring-1 ring-blue-400/30">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                  <path d="M8 13h2" />
                  <path d="M14 13h2" />
                  <path d="M8 17h2" />
                  <path d="M14 17h2" />
                </svg>
              </div>
              <h2 className="relative mt-6 text-2xl font-semibold text-gray-100">
                Muhasebe Modülü
              </h2>
              <p className="relative mt-2 flex-1 text-sm leading-relaxed text-gray-400">
                Fiş, banka, kural motoru ve firma yönetimi
              </p>
              <Link
                href="/muhasebe"
                className="relative mt-6 inline-flex w-fit items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                Modüle Git
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
