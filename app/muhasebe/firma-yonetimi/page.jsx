"use client";

import dynamic from "next/dynamic";

/**
 * Firma Yönetimi hafif kabuk — CompanyManagement ayrı chunk.
 * İlk görünür UI: başlık + liste/sekme iskeleti; ağır paneller ihtiyaçta.
 */
function FirmaYonetimiShellFallback() {
  return (
    <div className="min-h-[60vh] w-full pb-8 text-white">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Firma Yönetimi
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Firma listesi ve aktif sekme kabuğu hazırlanıyor…
          </p>
        </div>
        <div className="h-10 w-36 animate-pulse rounded-lg bg-slate-800/60" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="h-9 w-full animate-pulse rounded-lg bg-slate-800/50" />
          <div className="h-8 w-full animate-pulse rounded bg-slate-800/40" />
          <div className="h-8 w-5/6 animate-pulse rounded bg-slate-800/40" />
          <div className="h-8 w-4/5 animate-pulse rounded bg-slate-800/40" />
          <div className="h-8 w-full animate-pulse rounded bg-slate-800/40" />
        </aside>
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-5">
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-800/50" />
            <div className="h-9 w-20 animate-pulse rounded-lg bg-slate-800/50" />
            <div className="h-9 w-28 animate-pulse rounded-lg bg-slate-800/50" />
            <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-800/50" />
          </div>
          <p className="mb-4 text-sm text-slate-500">Hazırlanıyor…</p>
          <div className="space-y-3">
            <div className="h-10 w-full animate-pulse rounded-lg bg-slate-800/40" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-slate-800/40" />
            <div className="h-10 w-3/4 animate-pulse rounded-lg bg-slate-800/40" />
          </div>
        </section>
      </div>
    </div>
  );
}

const CompanyManagement = dynamic(
  () => import("../components/CompanyManagement"),
  {
    ssr: false,
    loading: () => <FirmaYonetimiShellFallback />,
  }
);

export default function FirmaYonetimiPage() {
  return <CompanyManagement />;
}
