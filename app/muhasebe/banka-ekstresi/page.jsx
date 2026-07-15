"use client";

import dynamic from "next/dynamic";
import { annveroCardClass } from "@/src/styles/annveroDesign";

/**
 * Banka Parser hafif kabuk — ağır workbench ayrı chunk.
 * İlk görünür UI anında; motor/tablolar workbench yüklenince gelir.
 */
function BankParserShellFallback() {
  return (
    <div className="w-full min-w-0 max-w-full pb-6">
      <div className="mb-6 min-w-0">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Banka Parser Merkezi
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Ekstre dosyasını seçin, banka otomatik tespit edilir ve işlem tek tuşla
          tamamlanır.
        </p>
      </div>

      <div className={`grid w-full min-w-0 max-w-full gap-5 ${annveroCardClass}`}>
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-950/50 px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Aktif Firma
          </span>
          <span className="h-5 w-40 animate-pulse rounded bg-slate-800/60" />
        </div>

        <div className="space-y-4 px-1 pb-2">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Dosya
            </p>
            <div className="h-11 w-full max-w-xl animate-pulse rounded-xl bg-slate-800/50" />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Banka
            </p>
            <div className="h-11 w-full max-w-md animate-pulse rounded-xl bg-slate-800/50" />
          </div>
          <div className="pt-2">
            <div className="inline-flex h-11 min-w-[220px] items-center justify-center rounded-xl bg-slate-800/70 px-6 text-sm font-semibold text-slate-400">
              Hazırlanıyor…
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const BankParserWorkbench = dynamic(() => import("./BankParserWorkbench"), {
  ssr: false,
  loading: () => <BankParserShellFallback />,
});

export default function BankaParserPage() {
  return <BankParserWorkbench />;
}
