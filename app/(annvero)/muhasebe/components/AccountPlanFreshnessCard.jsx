"use client";

/**
 * Hesap planı güncellik kartı — kompakt (Fiş Dönüştürme) / ayrıntılı (Hesap Planı).
 */
export default function AccountPlanFreshnessCard({
  summary = null,
  loading = false,
  variant = "compact",
}) {
  const isLoading = loading || summary?.status === "loading" || summary?.readiness === "loading";

  if (isLoading) {
    return (
      <div
        data-testid="account-plan-freshness-card"
        data-state="loading"
        className={`rounded-xl border border-gray-800 bg-gray-950/70 ${
          variant === "detailed" ? "p-4" : "p-3"
        }`}
      >
        <div className="mb-2 h-3 w-28 animate-pulse rounded bg-gray-800" />
        <div className="h-3 w-48 animate-pulse rounded bg-gray-800/80" />
        <p className="mt-2 text-xs text-gray-500">Yükleniyor…</p>
      </div>
    );
  }

  if (!summary || summary.status === "none") {
    return null;
  }

  const ready = summary.readiness === "ready";
  const rows = [
    {
      label: "Hesap planı",
      value: summary.readinessLabel,
      tone: ready ? "ok" : "danger",
    },
    {
      label: "Hesap sayısı",
      value:
        summary.accountCount == null ? "—" : String(summary.accountCount),
    },
  ];

  if (summary.showApiDates) {
    rows.push({
      label: "Son güncelleme",
      value: summary.updatedAtLabel || "—",
    });
    if (summary.fileName) {
      rows.push({ label: "Aktif dosya", value: summary.fileName });
    }
    if (summary.uploadId) {
      rows.push({ label: "Sürüm / yükleme", value: summary.uploadId });
    }
    if (summary.uploadedBy) {
      rows.push({ label: "Yükleyen", value: summary.uploadedBy });
    }
  } else if (summary.sourceLabel) {
    rows.push({
      label: "Kaynak",
      value: summary.sourceLabel,
      tone: "warn",
    });
  }

  if (summary.sourceLabel && summary.showApiDates && variant === "detailed") {
    rows.push({ label: "Kaynak", value: summary.sourceLabel });
  }

  return (
    <div
      data-testid="account-plan-freshness-card"
      data-state={summary.readiness}
      data-source={summary.source || ""}
      className={`rounded-xl border border-gray-800 bg-gray-950/70 ${
        variant === "detailed" ? "p-4" : "p-3"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3
          className={`font-semibold text-gray-200 ${
            variant === "detailed" ? "text-sm" : "text-xs"
          }`}
        >
          Hesap planı durumu
        </h3>
        {summary.sourceLabel && !summary.showApiDates ? (
          <span className="rounded-full border border-amber-700/50 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
            {summary.sourceLabel}
          </span>
        ) : null}
      </div>

      <dl
        className={`grid gap-1.5 ${
          variant === "detailed"
            ? "sm:grid-cols-2"
            : "grid-cols-1"
        }`}
      >
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex min-w-0 items-baseline justify-between gap-3 text-xs"
          >
            <dt className="shrink-0 text-gray-500">{row.label}</dt>
            <dd
              className={`min-w-0 truncate text-right font-medium ${
                row.tone === "ok"
                  ? "text-emerald-300"
                  : row.tone === "danger"
                    ? "text-rose-300"
                    : row.tone === "warn"
                      ? "text-amber-200"
                      : "text-gray-200"
              }`}
              title={String(row.value || "")}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {summary.staleWarning ? (
        <p
          data-testid="account-plan-stale-warning"
          className="mt-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-2.5 py-1.5 text-[11px] font-medium text-amber-200"
        >
          {summary.staleWarning}
        </p>
      ) : null}
    </div>
  );
}
