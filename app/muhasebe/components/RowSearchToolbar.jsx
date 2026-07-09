"use client";

export default function RowSearchToolbar({
  search,
  onSearchChange,
  placeholder,
  filters,
  activeFilter,
  onFilterChange,
  shownCount,
  totalCount,
}) {
  const isActive = Boolean(search.trim()) || activeFilter !== "all";

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 w-full max-w-xl flex-1 rounded-xl border border-gray-700 bg-gray-900 p-3 text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20"
        />

        {isActive && (
          <span className="text-sm text-gray-400">
            {shownCount} / {totalCount} satır gösteriliyor
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => onFilterChange(filter.id)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              activeFilter === filter.id
                ? "bg-blue-600 text-white"
                : "border border-gray-700 bg-gray-950 text-gray-300 hover:bg-gray-800"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>
  );
}
