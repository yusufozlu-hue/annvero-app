"use client";

import {
  buildMissingAccountsHint,
  formatDurationMs,
  formatElapsedClock,
  getPipelinePhaseTitle,
  getPipelineUiStepStatuses,
  evaluateBankOutputGate,
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

function formatBalanceAmount(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function BankPipelineResultCard({
  result,
  isExporting,
  lucaReady,
  onDownloadExcel,
  onDownloadElektra,
  onReviewMissing,
  onPartialExport,
  onGoToLucaProducer,
  onGoToFisKontrol,
  onReanalyzeWithNewPlan,
  isReanalyzing = false,
  auditHistory = [],
  primaryBtnClass = "",
  secondaryBtnClass = "",
  isReviewMissingLoading = false,
  showServiceMeta = false,
}) {
  if (!result) return null;

  const missing = Number(result.missingCount) || 0;
  const hint = buildMissingAccountsHint(missing);
  const isBalanceMismatch = Boolean(
    result.balanceMismatch || result.code === "BALANCE_MISMATCH"
  );
  const isDuplicate =
    Boolean(result.duplicate) ||
    result.code === "DUPLICATE_CONTENT" ||
    result.terminalStatus === "duplicate";
  const outputGate = evaluateBankOutputGate(result, { lucaReady });
  const compareRows = Array.isArray(result.revisionCompare?.rows)
    ? result.revisionCompare.rows
    : null;
  const balanceStats = isBalanceMismatch
    ? [
        { label: "Hareket", value: result.movementCount },
        {
          label: "Açılış bakiyesi",
          value: formatBalanceAmount(result.openingBalance),
        },
        {
          label: "Toplam borç / çıkış",
          value: formatBalanceAmount(result.totalDebit),
        },
        {
          label: "Toplam alacak / giriş",
          value: formatBalanceAmount(result.totalCredit),
        },
        {
          label: "Hesaplanan kapanış",
          value: formatBalanceAmount(result.computedClosingBalance),
        },
        {
          label: "Ekstre kapanış",
          value: formatBalanceAmount(result.statementClosingBalance),
        },
        {
          label: "Mutabakat farkı",
          value: formatBalanceAmount(result.reconciliationDelta),
        },
      ]
    : null;
  const stats = balanceStats || [
    { label: "Hareket", value: result.movementCount },
    { label: "Luca satırı", value: result.lucaRowCount },
    {
      label: "Otomatik eşleşen",
      value:
        result.autoMatchedCount != null ? result.autoMatchedCount : "—",
    },
    {
      label: "İnceleme",
      value:
        result.uniqueUnresolvedMovements ??
        result.unresolvedMovementCount ??
        result.reviewCount ??
        result.unrecognizedCount,
    },
    {
      label: "Geçti / Uyarı / Hata",
      value: `${result.passed ?? "—"} / ${result.warnings ?? "—"} / ${result.errors ?? "—"}`,
    },
    {
      label: "E-Defter",
      value: result.edefterCode || result.edefterStatus || "—",
    },
  ];
  if (showServiceMeta && !isBalanceMismatch) {
    stats.push({
      label: "Toplam süre",
      value: formatDurationMs(result.totalDurationMs),
    });
  }

  const cardBorder = isBalanceMismatch
    ? "border-amber-700/45 bg-gradient-to-b from-amber-950/35 to-slate-950/50"
    : "border-emerald-700/40 bg-gradient-to-b from-emerald-950/40 to-slate-950/50";
  const iconWrap = isBalanceMismatch
    ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
    : "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
  const subtitleTone = isBalanceMismatch
    ? "text-amber-100/85"
    : "text-emerald-100/80";

  return (
    <section
      className={`mt-5 min-w-0 rounded-2xl border px-4 py-5 sm:px-6 ${cardBorder}`}
      data-testid="bank-pipeline-result-card"
      data-result-code={
        isDuplicate
          ? "DUPLICATE_CONTENT"
          : isBalanceMismatch
            ? "BALANCE_MISMATCH"
            : result.terminalStatus || ""
      }
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${iconWrap}`}
        >
          {isBalanceMismatch ? (
            <AlertIcon className="h-8 w-8" />
          ) : (
            <CheckCircleIcon className="h-8 w-8" />
          )}
        </div>
        <div>
          <h3 className="text-xl font-semibold text-white">
            {isDuplicate
              ? "Mükerrer ekstre"
              : isBalanceMismatch
                ? "Bakiye uyuşmazlığı"
                : result.reanalyze
                  ? "Yeniden analiz tamamlandı"
                  : result.reviewRequired
                    ? "İnceleme Gerekli"
                    : "İşlem ve Kontrol Tamamlandı"}
          </h3>
          <p className={`mt-1 text-sm ${subtitleTone}`}>
            {isDuplicate
              ? result.duplicateMessage ||
                "Mükerrer ekstre — yeniden işlenmedi"
              : isBalanceMismatch
                ? result.message ||
                  "Bakiye uyuşmazlığı — otomatik fiş üretilmedi, inceleme gerekli"
                : result.reanalyze
                  ? "Mevcut arşiv kaynağı yeni hesap planıyla yeniden analiz edildi."
                  : result.reviewRequired
                    ? "Kritik veya düşük güven satırlar var — otomatik onay / Luca-Elektra aktarımı kapalı."
                    : "Tek tuş zinciri tamamlandı. Çıktıları indirebilir veya Fiş Kontrol’e gidebilirsiniz."}
          </p>
        </div>
      </div>

      <div
        className={`mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 ${
          showServiceMeta ? "lg:grid-cols-4" : "lg:grid-cols-3"
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

      {compareRows ? (
        <div className="mt-4 rounded-xl border border-sky-700/40 bg-sky-950/25 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-200/90">
            Önceki vs yeni analiz
          </p>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {compareRows.map((row) => (
              <li
                key={row.key}
                className="rounded-lg border border-sky-900/50 bg-slate-950/40 px-2.5 py-2 text-xs text-slate-200"
              >
                <span className="font-semibold text-white">{row.label}</span>
                <p className="mt-1 text-slate-300">
                  Önceki: {row.previous ?? "—"} → Yeni: {row.next ?? "—"}
                </p>
              </li>
            ))}
          </ul>
          {result.accountPlanCount ? (
            <p className="mt-2 text-[11px] text-sky-200/70">
              Aktif hesap planı: {result.accountPlanCount} hesap tarandı
            </p>
          ) : null}
        </div>
      ) : null}

      {hint && !isBalanceMismatch ? (
        <p className="mt-4 rounded-xl border border-amber-600/40 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-100/90">
          {hint}
        </p>
      ) : null}

      {isBalanceMismatch &&
      Array.isArray(result.movementPreview) &&
      result.movementPreview.length > 0 ? (
        <div
          className="mt-4 rounded-xl border border-amber-700/40 bg-slate-950/45 px-3 py-3"
          data-testid="bank-balance-mismatch-movement-preview"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">
            Hareket önizleme ({result.movementPreview.length}
            {result.hasMoreMovements ? ` / ${result.movementCount}` : ""})
          </p>
          <ul className="mt-2 space-y-2">
            {result.movementPreview.map((row) => (
              <li
                key={`mv-${row.index}-${row.date}`}
                className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-2.5 py-2 text-xs text-slate-200"
                data-testid="bank-safe-movement-row"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-white">
                    {row.date} ·{" "}
                    {row.direction === "debit"
                      ? "Borç"
                      : row.direction === "credit"
                        ? "Alacak"
                        : "—"}
                  </span>
                  <span className="font-mono text-slate-100">
                    {formatBalanceAmount(row.amount)}
                  </span>
                </div>
                <p className="mt-1 text-slate-400">{row.description}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Bakiye: {formatBalanceAmount(row.balance)}
                  {row.sourcePage != null || row.sourceLine != null
                    ? ` · Kaynak: s${row.sourcePage ?? "—"}/s${row.sourceLine ?? "—"}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
          {result.hasMoreMovements ? (
            <p className="mt-2 text-xs text-amber-100/80">
              Tüm hareketleri incele
            </p>
          ) : null}
        </div>
      ) : null}

      {Array.isArray(result.findingClasses?.classes) &&
      result.findingClasses.classes.length > 0 &&
      !isBalanceMismatch ? (
        <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Hata sınıfları
          </p>
          <ul className="mt-2 space-y-2">
            {result.findingClasses.classes.slice(0, 8).map((cls) => (
              <li
                key={cls.id}
                className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-2.5 py-2 text-xs text-slate-200"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-white">{cls.label}</span>
                  <span className="text-slate-400">
                    {cls.count} bulgu
                    {cls.errorCount ? ` · ${cls.errorCount} hata` : ""}
                  </span>
                </div>
                <p className="mt-1 text-slate-400">
                  Neden engellendi: {cls.why}
                </p>
                <p className="mt-0.5 text-sky-200/90">
                  Ne yapmalı: {cls.action}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.driveArchived || result.driveSkipped ? (
        <p className="mt-3 text-xs text-slate-400">
          Drive:{" "}
          {result.driveArchived
            ? result.reanalyze
              ? "mevcut arşiv yeniden kullanıldı (ikinci kopya yok)"
              : "kaynak arşivlendi"
            : "arşiv atlandı (bağlantı yok) — banka akışı engellenmedi"}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {isDuplicate && typeof onReanalyzeWithNewPlan === "function" ? (
          <button
            type="button"
            onClick={onReanalyzeWithNewPlan}
            disabled={isReanalyzing || isExporting}
            className="rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="bank-reanalyze-with-new-plan"
          >
            {isReanalyzing
              ? "Yeniden analiz ediliyor…"
              : "Yeni hesap planıyla yeniden analiz et"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDownloadExcel}
          disabled={isExporting || !outputGate.allowed}
          className={`rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 ${primaryBtnClass}`}
        >
          {isExporting ? "Excel hazırlanıyor…" : "Luca İndir"}
        </button>
        {onDownloadElektra ? (
          <button
            type="button"
            onClick={onDownloadElektra}
            disabled={isExporting || !outputGate.allowed}
            className="rounded-xl border border-emerald-600/50 bg-emerald-950/40 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-900/40 disabled:opacity-50"
          >
            ElektraWeb İndir
          </button>
        ) : null}
        {onGoToFisKontrol ? (
          <button
            type="button"
            onClick={onGoToFisKontrol}
            className="rounded-xl border border-sky-600/50 bg-sky-950/40 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-900/40"
          >
            Fiş Kontrol’e Git
          </button>
        ) : null}
        {missing > 0 ? (
          <>
            <button
              type="button"
              onClick={onReviewMissing}
              disabled={isReviewMissingLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-600/50 bg-rose-950/40 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-900/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isReviewMissingLoading ? "Hazırlanıyor…" : "Eksik Hesapları İncele"}
            </button>
            <button
              type="button"
              onClick={onPartialExport}
              disabled={isExporting}
              className="rounded-xl border border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-900/40 disabled:opacity-50"
            >
              Eksik Satırlar Hariç Excel
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={onGoToLucaProducer}
          disabled={!outputGate.allowed}
          className={
            secondaryBtnClass ||
            "rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          Luca Fiş Üreticiye Gönder
        </button>
      </div>
      {!outputGate.allowed && !isDuplicate ? (
        <p
          className="mt-2 text-xs text-amber-200/85"
          data-testid="bank-output-gate-message"
          data-output-gate-code={outputGate.code}
        >
          {outputGate.message}
        </p>
      ) : null}

      {Array.isArray(auditHistory) && auditHistory.length > 0 ? (
        <div className="mt-5 border-t border-emerald-900/40 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Denetim geçmişi
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-300">
            {auditHistory.slice(0, 5).map((run) => (
              <li key={run.id || run.createdAt}>
                {(run.metadata?.terminal_status || "kayıt").toString()}
                {run.metadata?.reanalyze ? " · revision" : ""}
                {run.metadata?.revision != null
                  ? ` #${run.metadata.revision}`
                  : ""}{" "}
                ·{" "}
                {run.createdAt
                  ? new Date(run.createdAt).toLocaleString("tr-TR")
                  : "—"}
                {run.metadata?.movement_count != null
                  ? ` · ${run.metadata.movement_count} hareket`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function BankPipelineErrorCard({
  error,
  disabled,
  onRetry,
  onOpenManual,
  onSwitchCompany,
  onConfirmCompanyAndContinue,
  confirmCompanyChecked = false,
  onConfirmCompanyCheckedChange,
  confirmCompanyLabel = "",
  confirmCompanyButtonLabel = "Firmayı Onayla ve Devam Et",
}) {
  if (!error) return null;

  const isInfo = error.tone === "info";
  const isMismatch = error.code === "COMPANY_MISMATCH";
  const isVerification =
    error.code === "COMPANY_VERIFICATION_REQUIRED";
  const isEmptyPlan = error.code === "EMPTY_ACCOUNT_PLAN";
  const isOcr = error.code === "OCR_REQUIRED";
  const isOcrFailed = error.code === "OCR_FAILED" || error.code === "OCR_TIMEOUT";
  const isOcrUnconfigured = error.code === "OCR_PROVIDER_NOT_CONFIGURED";
  const isBalanceMismatch = error.code === "BALANCE_MISMATCH";
  const wrap = isInfo
    ? "border-sky-700/50 bg-sky-950/35 text-sky-50"
    : "border-red-800/60 bg-red-950/40 text-red-50";
  const title = isOcrUnconfigured
    ? "OCR yapılandırılmamış"
    : isOcrFailed
      ? "OCR başarısız"
      : isOcr
        ? "OCR gerekli"
        : isBalanceMismatch
          ? "Bakiye uyuşmazlığı"
          : isInfo
            ? "Banka seçimi güncellendi"
            : isMismatch
              ? "Firma uyuşmazlığı"
              : isVerification
                ? "Firma doğrulaması gerekli"
                : isEmptyPlan
                  ? "Hesap planı eksik"
                  : "İşlem durdu";

  const verificationLabel =
    confirmCompanyLabel ||
    (error.activeCompanyName
      ? `Bu ekstre ${error.activeCompanyName} firmasına aittir`
      : "Bu ekstre aktif firmaya aittir");

  return (
    <section
      className={`mt-4 rounded-2xl border px-4 py-4 sm:px-5 ${wrap}`}
      data-testid="bank-pipeline-error-card"
      data-error-code={error.code || ""}
    >
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

          {isVerification && typeof onConfirmCompanyAndContinue === "function" ? (
            <div
              className="mt-3 space-y-3 rounded-xl border border-amber-500/35 bg-amber-950/25 px-3 py-3"
              data-testid="company-verification-confirm"
            >
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-amber-50">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400/60 bg-slate-950"
                  checked={Boolean(confirmCompanyChecked)}
                  disabled={disabled}
                  onChange={(e) =>
                    typeof onConfirmCompanyCheckedChange === "function"
                      ? onConfirmCompanyCheckedChange(e.target.checked)
                      : null
                  }
                  data-testid="company-verification-checkbox"
                />
                <span>{verificationLabel}</span>
              </label>
              <button
                type="button"
                onClick={onConfirmCompanyAndContinue}
                disabled={disabled || !confirmCompanyChecked}
                className="rounded-lg border border-emerald-500/50 bg-emerald-950/50 px-3 py-1.5 text-xs font-semibold text-emerald-50 hover:bg-emerald-900/55 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="company-verification-confirm-btn"
              >
                {confirmCompanyButtonLabel}
              </button>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {error.suggestedCompanyId && typeof onSwitchCompany === "function" ? (
              <button
                type="button"
                onClick={() =>
                  onSwitchCompany({
                    companyId: error.suggestedCompanyId,
                    companyName: error.suggestedCompanyName,
                  })
                }
                disabled={disabled}
                className="rounded-lg border border-amber-500/50 bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-900/50 disabled:opacity-50"
              >
                {error.suggestedCompanyName
                  ? `${error.suggestedCompanyName} firmasına geç`
                  : "Doğru firmaya geç"}
              </button>
            ) : null}
            {!isMismatch &&
            !isVerification &&
            !isEmptyPlan &&
            !isBalanceMismatch ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={disabled || error.recoverable === false}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  isInfo
                    ? "border border-sky-500/40 bg-sky-900/50 hover:bg-sky-900"
                    : "border border-rose-500/40 bg-rose-900/40 hover:bg-rose-900/60"
                }`}
                data-testid="bank-pipeline-safe-retry"
              >
                {error.recoverable === false
                  ? "Dosyayı yeniden seçmeniz gerekiyor"
                  : "Güvenli Yeniden Dene"}
              </button>
            ) : null}
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
