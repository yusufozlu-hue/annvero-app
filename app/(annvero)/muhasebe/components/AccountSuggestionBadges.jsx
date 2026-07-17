"use client";

export default function AccountSuggestionBadges({
  suggestions = [],
  onSelect,
  disabled = false,
}) {
  if (!suggestions?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {suggestions.map((item) => {
        const content = (
          <>
            {item.label}
            {onSelect ? (
              <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-300/80">
                Uygula
              </span>
            ) : null}
          </>
        );

        if (!onSelect) {
          return (
            <span
              key={item.code}
              className="inline-flex rounded-md border border-amber-700/50 bg-amber-950/50 px-2 py-0.5 text-xs font-medium text-amber-200"
            >
              {content}
            </span>
          );
        }

        return (
          <button
            key={item.code}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(item)}
            className="inline-flex rounded-md border border-amber-600/60 bg-amber-950/60 px-2 py-0.5 text-xs font-medium text-amber-100 transition hover:bg-amber-900/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
