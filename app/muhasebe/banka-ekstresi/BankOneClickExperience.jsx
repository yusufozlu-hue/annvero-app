"use client";

import {
  buildMissingAccountsHint,
  formatDurationMs,
  formatElapsedClock,
  getPipelinePhaseTitle,
  getPipelineUiStepStatuses,
  PIPELINE_PHASES,
} from "@/src/utils/bankOneClickPipeline";

function IconBase({ children, className = "h-5 w-5" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function FileBankIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h8" />
    </IconBase>
  );
}

function EyeTableIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}

function BrainCalcIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M12 12v6" />
    </IconBase>
  );
}

function ReceiptIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2Z" />
      <path d="M8 10h8" />
      <path d="M8 14h6" />
    </IconBase>
  );
}

function ShieldCheckIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z" />
      <path d="m9 12 2 2 4-4" />
    </IconBase>
  );
}

function CheckCircleIcon({ className }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </IconBase>
  );
}

function AlertIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </IconBase>
  );
}

function PhaseIcon({ phase, className = "h-6 w-6" }) {
  switch (phase) {
    case PIPELINE_PHASES.PARSING:
      return <FileBankIcon className={className} />;
    case PIPELINE_PHASES.PREVIEW:
      return <EyeTableIcon className={className} />;
    case PIPELINE_PHASES.ACCOUNTING_ANALYSIS:
      return <BrainCalcIcon className={className} />;
    case PIPELINE_PHASES.LUCA_BUILD:
      return <ReceiptIcon className={className} />;
    case PIPELINE_PHASES.VALIDATION:
      return <ShieldCheckIcon className={className} />;
    case PIPELINE_PHASES.READY_FOR_EXPORT:
      return <CheckCircleIcon className={className} />;
    default:
      return <FileBankIcon className={className} />;
  }
}

function StepStatusMark({ status }) {
  if (status === "done") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
        <CheckCircleIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/20 text-rose-300">
        <AlertIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="relative flex h-5 w-5 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400/30" />
        <span className="relative h-2.5 w-2.5 rounded-full bg-sky-400" />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
    );
  }
  return <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />;
}

export function BankPipelineProgressPanel({
  visible,
  phase,
  label,
  detail,
  percent = 0,
  elapsedSeconds = 0,
  showTiming = false,
  processed = null,
  total = null,
  errorPhase = null,
  onCancel,
}) {
  if (!visible) return null;

  const steps = getPipelineUiStepStatuses(phase, { errorPhase });
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const phaseTitle = getPipelinePhaseTitle(phase);

  return (
    <section
      className="mt-5 min-w-0 rounded-2xl border border-indigo-800/40 bg-gradient-to-b from-indigo-950/50 to-slate-950/60 px-4 py-4 shadow-lg shadow-black/20 sm:px-5"
      aria-live="polite"
      aria-busy={phase !== PIPELINE_PHASES.READY_FOR_EXPORT}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-200">
            <PhaseIcon phase={phase} className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white sm:text-lg">
              Banka Ekstresi İşleniyor
            </h3>
            <p className="mt-0.5 text-sm font-medium text-sky-100/90">
              {phaseTitle}
              {label ? (
                <span className="font-normal text-slate-300"> — {label}</span>
              ) : null}
            </p>
            {detail && detail !== label ? (
              <p className="mt-1 truncate text-xs text-slate-400">{detail}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showTiming ? (
            <span className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-2.5 py-1 font-mono text-xs text-slate-200">
              Geçen süre: {formatElapsedClock(elapsedSeconds)}
            </span>
          ) : null}
          <span className="rounded-lg border border-indigo-600/40 bg-indigo-950/50 px-2.5 py-1 text-xs font-semibold text-indigo-100">
            %{safePercent}
          </span>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
            >
              İptal Et
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-[width] duration-500 ease-out"
          style={{ width: `${safePercent}%` }}
        />
      </div>

      {processed != null && total != null ? (
        <p className="mt-2 text-xs text-slate-400">
          İşlenen hareket: {processed} / {total}
        </p>
      ) : null}

      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, index) => {
          const tone =
            step.status === "done"
              ? "border-emerald-700/40 bg-emerald-950/25 text-emerald-100"
              : step.status === "active"
                ? "border-sky-500/50 bg-sky-950/40 text-sky-50"
                : step.status === "error"
                  ? "border-rose-600/50 bg-rose-950/30 text-rose-100"
                  : step.status === "cancelled"
                    ? "border-slate-700 bg-slate-900/40 text-slate-500"
                    : "border-slate-800/80 bg-slate-950/30 text-slate-500";
          return (
            <li
              key={step.id}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-xs transition-colors duration-300 ${tone}`}
            >
              <StepStatusMark status={step.status} />
              <span className="min-w-0 leading-snug">
                <span className="mr-1 opacity-60">{index + 1}.</span>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function BankPipelineResultCard({
  result,
  isExporting,
  lucaReady,
  onDownloadExcel,
  onReviewMissing,
  onPartialExport,
  onGoToLucaProducer,
  primaryBtnClass = "",
  secondaryBtnClass = "",
  isReviewMissingLoading = false,
  showServiceMeta = false,
}) {
  if (!result) return null;

  const missing = Number(result.missingCount) || 0;
  const hint = buildMissingAccountsHint(missing);
  const stats = [
    { label: "Hareket", value: result.movementCount },
    { label: "Luca satırı", value: result.lucaRowCount },
    {
      label: "Otomatik eşleşen",
      value:
        result.autoMatchedCount != null ? result.autoMatchedCount : "—",
    },
    { label: "Eksik hesap", value: result.missingCount },
    { label: "Tanınmayan işlem", value: result.unrecognizedCount },
  ];
  if (showServiceMeta) {
    stats.push({
      label: "Toplam süre",
      value: formatDurationMs(result.totalDurationMs),
    });
  }

  return (
    <section className="mt-5 min-w-0 rounded-2xl border border-emerald-700/40 bg-gradient-to-b from-emerald-950/40 to-slate-950/50 px-4 py-5 sm:px-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
          <CheckCircleIcon className="h-8 w-8" />
        </div>
        <div>
          <h3 className="text-xl font-semibold text-white">İşlem Tamamlandı</h3>
          <p className="mt-1 text-sm text-emerald-100/80">
            Luca dosyanız hazır. İndirmeden önce özeti kontrol edebilirsiniz.
          </p>
        </div>
      </div>

      <div
        className={`mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 ${
          showServiceMeta ? "lg:grid-cols-6" : "lg:grid-cols-5"
        }`}
      >
        {stats.map((item) => (
          <div
            key={item.label}
            className="min-w-0 rounded-xl border border-emerald-800/40 bg-slate-950/40 px-3 py-2.5"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              {item.label}
            </p>
            <p className="mt-1 truncate text-lg font-semibold text-white">
              {item.value == null || item.value === "" ? "—" : item.value}
            </p>
          </div>
        ))}
      </div>

      {hint ? (
        <p className="mt-4 rounded-xl border border-amber-600/40 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-100/90">
          {hint}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onDownloadExcel}
          disabled={isExporting || !lucaReady}
          className={`rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 ${primaryBtnClass}`}
        >
          {isExporting ? "Excel hazırlanıyor…" : "Luca Excel’i İndir"}
        </button>
        {missing > 0 ? (
          <>
            <button
              type="button"
              onClick={onReviewMissing}
              disabled={isReviewMissingLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-600/50 bg-rose-950/40 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-900/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isReviewMissingLoading ? (
                <>
                  <span
                    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-rose-200/30 border-t-rose-100"
                    aria-hidden="true"
                  />
                  Hazırlanıyor…
                </>
              ) : (
                "Eksik Hesapları İncele"
              )}
            </button>
            <button
              type="button"
              onClick={onPartialExport}
              disabled={isExporting}
              className="rounded-xl border border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-900/40 disabled:opacity-50"
            >
              Eksik Satırlar Hariç Excel Oluştur
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={onGoToLucaProducer}
          className={
            secondaryBtnClass ||
            "rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
          }
        >
          Luca Fiş Üreticiye Gönder
        </button>
      </div>
    </section>
  );
}

export function BankPipelineErrorCard({
  error,
  disabled,
  onRetry,
  onOpenManual,
}) {
  if (!error) return null;

  const isInfo = error.tone === "info";
  const wrap = isInfo
    ? "border-sky-700/50 bg-sky-950/35 text-sky-50"
    : "border-red-800/60 bg-red-950/40 text-red-50";
  const title = isInfo ? "Banka seçimi güncellendi" : "İşlem durdu";

  return (
    <section className={`mt-4 rounded-2xl border px-4 py-4 sm:px-5 ${wrap}`}>
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            isInfo
              ? "border border-sky-500/40 bg-sky-500/15 text-sky-200"
              : "border border-rose-500/40 bg-rose-500/15 text-rose-200"
          }`}
        >
          {isInfo ? (
            <FileBankIcon className="h-5 w-5" />
          ) : (
            <AlertIcon className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm opacity-90">{error.message}</p>
          {!isInfo && error.phaseLabel ? (
            <p className="mt-1 text-xs opacity-60">
              Durduğu aşama: {error.phaseLabel}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRetry}
              disabled={disabled}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                isInfo
                  ? "border border-sky-500/40 bg-sky-900/50 hover:bg-sky-900"
                  : "border border-red-500/40 bg-red-900/50 hover:bg-red-900"
              }`}
            >
              Tekrar Dene
            </button>
            {onOpenManual ? (
              <button
                type="button"
                onClick={onOpenManual}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
              >
                Manuel Kontrolü Aç
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
