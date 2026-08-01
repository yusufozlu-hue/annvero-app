/**
 * Muhasebe modül segment loading — AnnveroAppShell kalır; yalnız içerik skeleton.
 * app/(annvero)/loading.jsx yok (shell flash / çift boyama engeli).
 */
export default function MuhasebeModuleLoading() {
  return (
    <div
      className="w-full min-w-0 max-w-full space-y-4"
      data-annvero-muhasebe-skeleton
      aria-busy="true"
      aria-label="Modül yükleniyor"
    >
      <div className="space-y-2">
        <div className="h-9 w-64 max-w-full animate-pulse rounded-lg bg-slate-800/60 motion-reduce:animate-none" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-800/40 motion-reduce:animate-none" />
      </div>
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-5">
        <div className="mb-4 h-5 w-40 animate-pulse rounded bg-slate-800/50 motion-reduce:animate-none" />
        <div className="space-y-3">
          <div className="h-11 w-full max-w-xl animate-pulse rounded-xl bg-slate-800/45 motion-reduce:animate-none" />
          <div className="h-11 w-full max-w-md animate-pulse rounded-xl bg-slate-800/35 motion-reduce:animate-none" />
          <div className="h-11 w-56 animate-pulse rounded-xl bg-slate-800/50 motion-reduce:animate-none" />
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-800/70">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex h-11 items-center gap-3 border-b border-slate-800/50 px-4 last:border-b-0"
          >
            <div className="h-3 w-16 animate-pulse rounded bg-slate-800/50 motion-reduce:animate-none" />
            <div className="h-3 flex-1 animate-pulse rounded bg-slate-800/35 motion-reduce:animate-none" />
            <div className="h-3 w-24 animate-pulse rounded bg-slate-800/40 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
