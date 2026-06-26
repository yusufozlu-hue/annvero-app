export default function AccountSuggestionBadges({ suggestions = [] }) {
  if (!suggestions?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {suggestions.map((item) => (
        <span
          key={item.code}
          className="inline-flex rounded-md border border-amber-700/50 bg-amber-950/50 px-2 py-0.5 text-xs font-medium text-amber-200"
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}
