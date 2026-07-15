"use client";

import { useMemo, useState } from "react";
import {
  CARI_RESOLUTION_ROW_PAGE_SIZE,
  sliceCariRowsForDisplay,
} from "@/src/utils/cariMissingResolutionGroups";

function formatMoney(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function TruncatedDescription({ text = "" }) {
  const value = String(text || "").trim() || "—";
  return (
    <p
      className="line-clamp-2 break-words text-xs text-slate-300"
      title={value}
    >
      {value}
    </p>
  );
}

function RowInspectPanel({
  row,
  selectedAccount = "",
  matchReason = "",
  groupKey = "",
  creditCardMode = false,
}) {
  if (!row) return null;
  const fields = [
    ["Tam banka açıklaması", row.description || "—"],
    ["Tarih", row.date || "—"],
    ["Tutar", `${formatMoney(row.amount)} TL`],
    ["Gelen / Giden", row.directionLabel || "—"],
    ["Banka", row.bankName || "—"],
    ["İşlem tipi", row.transactionType || "—"],
  ];
  if (creditCardMode || row.creditCardRow) {
    fields.push(
      ["Kart son 4", row.lastFourDigits ? `****${row.lastFourDigits}` : "—"],
      ["Ekstre dönemi", row.statementPeriodLabel || "—"],
      ["Mevcut durum", row.statusOrSuggestion || row.statusLabel || "—"]
    );
  }
  fields.push(
    ["Grup anahtarı", groupKey || row.analysisKey || "—"],
    ["Seçilecek hesap", selectedAccount || "—"],
    ["Eşleşme gerekçesi", matchReason || "—"]
  );
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-slate-700/70 bg-slate-950/70 px-3 py-2.5 text-[11px] text-slate-300">
      {fields.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-1 gap-0.5 sm:grid-cols-[8.5rem_minmax(0,1fr)]"
        >
          <span className="text-slate-500">{label}</span>
          <span className="break-words text-slate-200">{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Grup içi işlem listesi — seçim + lazy sayfalama + satır inceleme.
 * Kredi kartı gruplarında ekstre dönemi / son 4 / banka kolonları gösterilir.
 */
export default function CariGroupTransactionPanel({
  transactions = [],
  selectedIds,
  onToggleRow,
  onSelectAll,
  onClearSelection,
  allowApplySelection = true,
  selectedAccount = "",
  matchReason = "",
  groupKey = "",
  creditCardMode = false,
}) {
  const [visibleCount, setVisibleCount] = useState(
    CARI_RESOLUTION_ROW_PAGE_SIZE
  );
  const [expandedId, setExpandedId] = useState(null);

  const selectedSet =
    selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const allIds = useMemo(
    () => (transactions || []).map((t) => String(t.id)).filter(Boolean),
    [transactions]
  );
  const selectedCount = allIds.filter((id) => selectedSet.has(id)).length;
  const allSelected =
    allIds.length > 0 && selectedCount === allIds.length;
  const page = sliceCariRowsForDisplay(transactions, visibleCount);
  const showCc =
    creditCardMode ||
    (transactions || []).some((t) => t?.creditCardRow);

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          {allowApplySelection ? (
            <>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => {
                    if (e.target.checked) onSelectAll?.();
                    else onClearSelection?.();
                  }}
                  className="rounded border-slate-600"
                />
                <span>Tümünü seç / seçimi kaldır</span>
              </label>
              <span className="text-slate-500">·</span>
            </>
          ) : null}
          <span>
            Seçili:{" "}
            <span className="font-semibold text-white">
              {allowApplySelection ? selectedCount : allIds.length}
            </span>
            {" / "}
            {allIds.length}
          </span>
        </div>
      </div>

      <div className="max-h-72 overflow-x-auto overflow-y-auto">
        <table className="hidden min-w-full text-left text-xs md:table">
          <thead className="sticky top-0 z-[1] bg-slate-900 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              {allowApplySelection ? (
                <th className="px-3 py-2 font-medium">Seç</th>
              ) : null}
              <th className="px-3 py-2 font-medium">Tarih</th>
              <th className="min-w-[14rem] px-3 py-2 font-medium">Açıklama</th>
              <th className="px-3 py-2 font-medium">Yön</th>
              <th className="px-3 py-2 font-medium">Tutar</th>
              {showCc ? (
                <>
                  <th className="px-3 py-2 font-medium">Son 4</th>
                  <th className="px-3 py-2 font-medium">Banka</th>
                  <th className="px-3 py-2 font-medium">Ekstre</th>
                </>
              ) : (
                <th className="px-3 py-2 font-medium">İşlem tipi</th>
              )}
              <th className="px-3 py-2 font-medium">Durum</th>
              <th className="px-3 py-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {page.visible.map((row) => {
              const id = String(row.id);
              const checked = selectedSet.has(id);
              const open = expandedId === id;
              return (
                <tr
                  key={id}
                  className="border-t border-slate-800/80 align-top text-slate-200"
                >
                  {allowApplySelection ? (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleRow?.(id)}
                        className="rounded border-slate-600"
                        aria-label={`İşlem seç ${id}`}
                      />
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-3 py-2 text-slate-300">
                    {row.date || "—"}
                  </td>
                  <td className="max-w-xs px-3 py-2">
                    <TruncatedDescription text={row.description} />
                    {open ? (
                      <RowInspectPanel
                        row={row}
                        selectedAccount={selectedAccount}
                        matchReason={matchReason}
                        groupKey={groupKey}
                        creditCardMode={showCc}
                      />
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {row.directionLabel}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
                    {formatMoney(row.amount)} TL
                  </td>
                  {showCc ? (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">
                        {row.lastFourDigits
                          ? `****${row.lastFourDigits}`
                          : "—"}
                      </td>
                      <td className="max-w-[8rem] px-3 py-2 text-slate-400">
                        <span className="line-clamp-2 break-words">
                          {row.bankName || "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">
                        {row.statementPeriodLabel || "—"}
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-slate-400">
                      {row.transactionType || "—"}
                    </td>
                  )}
                  <td className="max-w-[10rem] px-3 py-2 text-slate-400">
                    <span className="line-clamp-2 break-words">
                      {row.statusOrSuggestion || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId((prev) => (prev === id ? null : id))
                      }
                      className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-900"
                    >
                      {open ? "Gizle" : "İncele"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <ul className="space-y-2 p-2 md:hidden">
          {page.visible.map((row) => {
            const id = String(row.id);
            const checked = selectedSet.has(id);
            const open = expandedId === id;
            return (
              <li
                key={id}
                className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5"
              >
                <div className="flex items-start gap-2">
                  {allowApplySelection ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleRow?.(id)}
                      className="mt-1 rounded border-slate-600"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span>{row.date || "—"}</span>
                      <span>·</span>
                      <span>{row.directionLabel}</span>
                      <span>·</span>
                      <span className="font-semibold text-slate-100">
                        {formatMoney(row.amount)} TL
                      </span>
                    </div>
                    <div className="mt-1">
                      <TruncatedDescription text={row.description} />
                    </div>
                    {showCc ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        {row.lastFourDigits
                          ? `****${row.lastFourDigits}`
                          : "—"}
                        {" · "}
                        {row.bankName || "—"}
                        {" · "}
                        {row.statementPeriodLabel || "—"}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-slate-500">
                      {!showCc ? `${row.transactionType || "—"} · ` : ""}
                      {row.statusOrSuggestion || "—"}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId((prev) => (prev === id ? null : id))
                      }
                      className="mt-2 rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-200"
                    >
                      {open ? "Gizle" : "İncele"}
                    </button>
                    {open ? (
                      <RowInspectPanel
                        row={row}
                        selectedAccount={selectedAccount}
                        matchReason={matchReason}
                        groupKey={groupKey}
                        creditCardMode={showCc}
                      />
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {page.hasMore ? (
        <div className="border-t border-slate-800 px-3 py-2">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((n) => n + CARI_RESOLUTION_ROW_PAGE_SIZE)
            }
            className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900"
          >
            Daha fazla göster ({page.remaining} kalan)
          </button>
        </div>
      ) : null}
    </div>
  );
}
