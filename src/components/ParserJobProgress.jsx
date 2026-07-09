"use client";

export default function ParserJobProgress({
  visible = false,
  stage = "",
  detail = "",
  percent = 0,
  timeoutWarning = false,
  status = "running",
  error = "",
  onCancel,
  className = "",
}) {
  if (!visible) return null;

  const isRunning = status === "running";
  const isDone = status === "done";
  const isError = status === "error";
  const isCancelled = status === "cancelled";

  const barPercent = isDone ? 100 : isError || isCancelled ? 0 : percent || 12;

  return (
    <div
      className={`min-w-0 rounded-2xl border px-4 py-3.5 text-sm shadow-lg shadow-black/15 ${
        isError
          ? "border-red-800/50 bg-red-950/30 text-red-100"
          : isDone
            ? "border-emerald-800/50 bg-emerald-950/30 text-emerald-100"
            : isCancelled
              ? "border-slate-700/60 bg-slate-900/50 text-slate-300"
              : "border-indigo-800/50 bg-indigo-950/30 text-indigo-100"
      } ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isRunning ? (
            <span className="inline-flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-cyan-400" />
          ) : null}
          <div className="min-w-0">
            <p className="font-semibold">
              {isError
                ? "İşlem başarısız"
                : isDone
                  ? "İşlem tamamlandı"
                  : isCancelled
                    ? "İşlem iptal edildi"
                    : stage || "İşleniyor"}
            </p>
            {detail ? <p className="truncate text-xs opacity-80">{detail}</p> : null}
            {isError && error ? <p className="mt-1 text-xs text-red-200/90">{error}</p> : null}
          </div>
        </div>

        {isRunning && onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
          >
            İptal Et
          </button>
        ) : null}
      </div>

      {isRunning || isDone ? (
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/5">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              isDone ? "bg-emerald-400" : "bg-gradient-to-r from-cyan-500 to-indigo-500"
            }`}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      ) : null}

      {timeoutWarning && isRunning ? (
        <p className="mt-2 text-xs text-amber-200">
          İşlem uzun sürüyor. Arka planda devam ediyor; sayfayı kapatabilir veya iptal edebilirsiniz.
        </p>
      ) : null}
    </div>
  );
}
