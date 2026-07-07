"use client";

import { useMemo, useState } from "react";
import { annveroInputClass } from "@/src/styles/annveroDesign";

function exportToCsv(filename, columns, rows) {
  const header = columns.map((col) => col.label).join(";");
  const body = rows
    .map((row) =>
      columns
        .map((col) => {
          const value = col.exportValue ? col.exportValue(row) : row[col.key];
          const text = value == null ? "" : String(value);
          return `"${text.replace(/"/g, '""')}"`;
        })
        .join(";")
    )
    .join("\n");
  const blob = new Blob([`\uFEFF${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AnnveroDataTable({
  columns = [],
  rows = [],
  rowKey = "id",
  searchPlaceholder = "Hızlı ara...",
  pageSize = 25,
  emptyMessage = "Kayıt bulunamadı.",
  stickyHeader = true,
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [hiddenColumns, setHiddenColumns] = useState({});
  const [columnFilters, setColumnFilters] = useState({});

  const visibleColumns = useMemo(
    () => columns.filter((col) => !hiddenColumns[col.key]),
    [columns, hiddenColumns]
  );

  const filteredRows = useMemo(() => {
    let result = [...rows];
    const query = search.trim().toLowerCase();

    if (query) {
      result = result.filter((row) =>
        visibleColumns.some((col) => {
          const value = col.filterValue ? col.filterValue(row) : row[col.key];
          return String(value ?? "")
            .toLowerCase()
            .includes(query);
        })
      );
    }

    Object.entries(columnFilters).forEach(([key, filterValue]) => {
      if (!filterValue?.trim()) return;
      const col = columns.find((c) => c.key === key);
      result = result.filter((row) => {
        const value = col?.filterValue ? col.filterValue(row) : row[key];
        return String(value ?? "")
          .toLowerCase()
          .includes(filterValue.trim().toLowerCase());
      });
    });

    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      result.sort((a, b) => {
        const av = col?.sortValue ? col.sortValue(a) : a[sortKey];
        const bv = col?.sortValue ? col.sortValue(b) : b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = String(av).localeCompare(String(bv), "tr", { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, search, sortKey, sortDir, columnFilters, visibleColumns, columns]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 shadow-xl shadow-black/20">
      <div className="flex flex-col gap-3 border-b border-slate-800 p-4 lg:flex-row lg:items-center lg:justify-between">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={searchPlaceholder}
          className={`max-w-md ${annveroInputClass}`}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportToCsv("annvero-export.csv", visibleColumns, filteredRows)}
            className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900"
          >
            Excel (CSV)
          </button>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900">
              Kolonlar
            </summary>
            <div className="absolute right-0 z-20 mt-2 min-w-[180px] rounded-xl border border-slate-700 bg-[#06111f] p-2 shadow-xl">
              {columns.map((col) => (
                <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={!hiddenColumns[col.key]}
                    onChange={() =>
                      setHiddenColumns((prev) => ({ ...prev, [col.key]: !prev[col.key] }))
                    }
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </details>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className={stickyHeader ? "sticky top-0 z-10 bg-slate-900/95 backdrop-blur" : "bg-slate-900/80"}>
            <tr>
              {visibleColumns.map((col) => (
                <th key={col.key} className="px-4 py-3 text-left font-medium text-slate-300">
                  <button
                    type="button"
                    onClick={() => col.sortable !== false && toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : null}
                  </button>
                  {col.filterable ? (
                    <input
                      value={columnFilters[col.key] || ""}
                      onChange={(e) => {
                        setColumnFilters((prev) => ({ ...prev, [col.key]: e.target.value }));
                        setPage(1);
                      }}
                      placeholder="Filtre"
                      className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedRows.length ? (
              pagedRows.map((row) => (
                <tr key={row[rowKey]} className="border-t border-slate-800/80 hover:bg-white/[0.02]">
                  {visibleColumns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-slate-200">
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-8 text-center text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
        <span>
          {filteredRows.length} kayıt · sayfa {currentPage}/{totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-40"
          >
            Önceki
          </button>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-40"
          >
            Sonraki
          </button>
        </div>
      </div>
    </div>
  );
}
