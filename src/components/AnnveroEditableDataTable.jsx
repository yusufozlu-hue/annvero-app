"use client";

import { useCallback, useMemo, useState } from "react";
import { annveroInputClass } from "@/src/styles/annveroDesign";
import { useWindowedRows } from "@/src/hooks/useWindowedRows";

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

function EditableCell({
  column,
  row,
  rowId,
  draft,
  isEditing,
  error,
  onChange,
  onFocus,
  onKeyDown,
}) {
  if (!column.editable) {
    return column.render ? column.render(row, { draft, isEditing }) : row[column.key];
  }

  const value = draft?.[column.editKey || column.key] ?? row[column.key] ?? "";

  if (!isEditing && column.editDisplay) {
    return column.editDisplay(row, { draft, value });
  }

  if (column.editType === "select" && column.editOptions) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(column.editKey || column.key, e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        className={`${annveroInputClass} min-w-[120px] py-1.5 text-xs`}
      >
        {column.editOptions.map((option) => (
          <option key={option.value ?? option} value={option.value ?? option}>
            {option.label ?? option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div>
      <input
        value={value}
        onChange={(e) => onChange(column.editKey || column.key, e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        className={`${annveroInputClass} min-w-[120px] py-1.5 text-xs ${error ? "border-red-500/60" : ""}`}
        placeholder={column.editPlaceholder || ""}
      />
      {error ? <p className="mt-1 text-[10px] text-red-300">{error}</p> : null}
    </div>
  );
}

export default function AnnveroEditableDataTable({
  columns = [],
  rows = [],
  rowKey = "id",
  getRowKey,
  drafts = {},
  selectedIds = [],
  editingRowId = "",
  validationErrors = {},
  onToggleSelect,
  onToggleSelectAll,
  isRowSelectable,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onCommitEdit,
  renderRowActions,
  bulkToolbar = null,
  searchPlaceholder = "Hızlı ara...",
  pageSize = 25,
  emptyMessage = "Kayıt bulunamadı.",
  loadingMessage = "Kayıtlar yükleniyor...",
  stickyHeader = true,
  isLoading = false,
  showToolbar = true,
  exportFilename = "annvero-export.csv",
  enableVirtualScroll = false,
  virtualRowHeight = 52,
  className = "",
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
          const value = col.filterValue ? col.filterValue(row, drafts[row[rowKey]]) : row[col.key];
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
        const value = col?.filterValue ? col.filterValue(row, drafts[row[rowKey]]) : row[key];
        return String(value ?? "")
          .toLowerCase()
          .includes(filterValue.trim().toLowerCase());
      });
    });

    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      result.sort((a, b) => {
        const av = col?.sortValue ? col.sortValue(a, drafts[a[rowKey]]) : a[sortKey];
        const bv = col?.sortValue ? col.sortValue(b, drafts[b[rowKey]]) : b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = String(av).localeCompare(String(bv), "tr", { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, search, sortKey, sortDir, columnFilters, visibleColumns, columns, drafts, rowKey]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const { windowRows, onScroll, containerRef, totalHeight, offsetY } = useWindowedRows({
    rows: pagedRows,
    enabled: enableVirtualScroll,
    rowHeight: virtualRowHeight,
  });

  const displayRows = enableVirtualScroll ? windowRows : pagedRows;

  const resolveRowKey = useCallback(
    (row, index) => {
      if (getRowKey) return getRowKey(row, index);
      return row[rowKey] ?? `row-${index}`;
    },
    [getRowKey, rowKey]
  );

  const selectableRows = useMemo(
    () => filteredRows.filter((row) => (isRowSelectable ? isRowSelectable(row) : true)),
    [filteredRows, isRowSelectable]
  );

  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row) => selectedIds.includes(row[rowKey]));

  const handleKeyDown = (event, rowId, field) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancelEdit?.(rowId);
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onCommitEdit?.(rowId);
    }
    if (event.key === "Tab") {
      // basic keyboard navigation hook for parent extensions
      event.currentTarget.dataset.lastField = field;
    }
  };

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 shadow-xl shadow-black/20 ${className}`}
    >
      {showToolbar ? (
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
              onClick={() => exportToCsv(exportFilename, visibleColumns, filteredRows)}
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
      ) : null}

      {bulkToolbar}

      <div
        ref={containerRef}
        onScroll={onScroll}
        className={`overflow-x-auto ${enableVirtualScroll ? "max-h-[70vh] overflow-y-auto" : ""}`}
      >
        <table className="w-full min-w-[720px] text-sm">
          <thead
            className={
              stickyHeader ? "sticky top-0 z-10 bg-slate-900/95 backdrop-blur" : "bg-slate-900/80"
            }
          >
            <tr>
              {onToggleSelect ? (
                <th className="px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onToggleSelectAll?.()}
                    aria-label="Tümünü seç"
                  />
                </th>
              ) : null}
              {visibleColumns.map((col) => (
                <th key={col.key} className="px-4 py-3 text-left font-medium text-slate-300">
                  <button
                    type="button"
                    onClick={() => {
                      if (col.sortable === false) return;
                      if (sortKey === col.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                      else {
                        setSortKey(col.key);
                        setSortDir("asc");
                      }
                    }}
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
              {renderRowActions ? <th className="px-4 py-3 text-left">İşlem</th> : null}
            </tr>
          </thead>
          <tbody style={enableVirtualScroll ? { height: totalHeight } : undefined}>
            {enableVirtualScroll ? (
              <tr style={{ height: offsetY }} aria-hidden>
                <td colSpan={visibleColumns.length + 2} />
              </tr>
            ) : null}
            {isLoading ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (onToggleSelect ? 1 : 0) + (renderRowActions ? 1 : 0)}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  {loadingMessage}
                </td>
              </tr>
            ) : displayRows.length ? (
              displayRows.map((row, index) => {
                const id = resolveRowKey(row, index);
                const draft = drafts[id] || drafts[row[rowKey]];
                const isEditing = editingRowId === id || editingRowId === row[rowKey];
                const selectable = isRowSelectable ? isRowSelectable(row) : true;
                return (
                  <tr
                    key={id}
                    className={`border-t border-slate-800/80 hover:bg-white/[0.02] ${isEditing ? "bg-indigo-950/20" : ""}`}
                    style={enableVirtualScroll ? { height: virtualRowHeight } : undefined}
                  >
                    {onToggleSelect ? (
                      <td className="px-3 py-3">
                        {selectable ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(row[rowKey])}
                            onChange={() => onToggleSelect(row[rowKey])}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-slate-200">
                        <EditableCell
                          column={col}
                          row={row}
                          rowId={row[rowKey]}
                          draft={draft}
                          isEditing={isEditing || col.alwaysEdit}
                          error={validationErrors[row[rowKey]]}
                          onChange={(field, value) => onDraftChange?.(row[rowKey], field, value)}
                          onFocus={() => onStartEdit?.(row[rowKey])}
                          onKeyDown={(e) => handleKeyDown(e, row[rowKey], col.editKey || col.key)}
                        />
                      </td>
                    ))}
                    {renderRowActions ? (
                      <td className="px-4 py-3">{renderRowActions(row, { draft, isEditing })}</td>
                    ) : null}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={visibleColumns.length + (onToggleSelect ? 1 : 0) + (renderRowActions ? 1 : 0)}
                  className="px-4 py-8 text-center text-slate-500"
                >
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
          {enableVirtualScroll ? " · virtual scroll" : ""}
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
