"use client";

/**
 * Tablo hücrelerinde sabit yükseklik + line-clamp + tam metin tooltip.
 */
export function PreviewClampText({
  text,
  className = "",
  empty = "—",
  lines = 2,
}) {
  const value = String(text || "").trim();
  if (!value) {
    return <span className={`text-xs text-slate-500 ${className}`}>{empty}</span>;
  }

  return (
    <span
      className={`annvero-clamp-cell block text-xs leading-tight ${className}`}
      style={{ WebkitLineClamp: lines }}
      title={value}
    >
      {value}
    </span>
  );
}

export function PreviewClampList({
  items = [],
  tone = "text-red-300",
  maxItems = 2,
}) {
  if (!items?.length) {
    return <span className="text-xs text-slate-500">—</span>;
  }

  const shown = items.slice(0, maxItems);
  const rest = items.length - shown.length;

  return (
    <div className="max-h-10 overflow-hidden" title={items.join("\n")}>
      <ul className={`space-y-0.5 text-[10px] leading-tight ${tone}`}>
        {shown.map((item) => (
          <li key={item} className="truncate">
            • {item}
          </li>
        ))}
        {rest > 0 ? <li className="truncate opacity-70">+{rest} daha</li> : null}
      </ul>
    </div>
  );
}

export function PreviewRiskBadge({ score, level, variant = "default" }) {
  if (!score) {
    return <span className="text-xs text-slate-500">—</span>;
  }

  const tone =
    variant === "critical"
      ? "bg-red-900/70 text-red-100"
      : variant === "high"
        ? "bg-orange-900/70 text-orange-100"
        : variant === "medium"
          ? "bg-amber-900/60 text-amber-100"
          : "bg-slate-800 text-slate-300";

  return (
    <span
      className={`inline-flex max-h-7 min-w-[42px] items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none ${tone}`}
      title={level || "Risk"}
    >
      {score}
    </span>
  );
}
