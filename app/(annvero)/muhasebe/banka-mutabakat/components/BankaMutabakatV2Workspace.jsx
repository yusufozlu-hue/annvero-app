"use client";

import { useMemo } from "react";
import {
  V2_FILTER,
  badgeClassName,
  buildDualPanelRows,
  buildV2Kpis,
  filterV2PanelItem,
} from "@/src/utils/bankaMutabakatV2";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const FILTER_OPTIONS = [
  { id: V2_FILTER.ALL, label: "Tümü" },
  { id: V2_FILTER.MATCHED, label: "Eşleşenler" },
  { id: V2_FILTER.UNMATCHED, label: "Eşleşmeyenler" },
  { id: V2_FILTER.SUSPICIOUS, label: "Şüpheliler" },
  { id: V2_FILTER.AMOUNT_DIFF, label: "Tutar farkı" },
  { id: V2_FILTER.DATE_DIFF, label: "Tarih farkı" },
  { id: V2_FILTER.BANK_ONLY, label: "Sadece banka" },
  { id: V2_FILTER.LEDGER_ONLY, label: "Sadece muavin" },
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function scoreClass(score) {
  if (score >= 100) return "bg-emerald-900/70 text-emerald-100";
  if (score >= 85) return "bg-sky-900/70 text-sky-100";
  if (score >= 60) return "bg-amber-900/70 text-amber-100";
  return "bg-gray-800 text-gray-300";
}

function matchesSearch(item, query) {
  if (!query) return true;
  return [
    item.tarih,
    item.aciklama,
    item.referans,
    item.hesapKodu,
    item.badge,
    item.scoreLabel,
    String(item.score || ""),
  ]
    .join(" ")
    .toLocaleLowerCase("tr")
    .includes(query);
}

export default function BankaMutabakatV2Workspace({
  analysis,
  v2Filter,
  onV2FilterChange,
  search,
  onSearchChange,
  selectedBankTxnId,
  selectedLedgerTxnId,
  onSelectBank,
  onSelectLedger,
  onManualMatch,
  onRemoveMatch,
  onApproveMatch,
  onCreateVoucher,
  onExportAll,
  onExportUnmatched,
  onExportRisky,
}) {
  const kpis = useMemo(
    () => buildV2Kpis(analysis.summary, analysis.rows),
    [analysis.summary, analysis.rows]
  );

  const panels = useMemo(() => buildDualPanelRows(analysis.rows), [analysis.rows]);

  const searchQuery = search.trim().toLocaleLowerCase("tr");

  const filteredBankRows = useMemo(() => {
    return panels.bankRows
      .filter((item) => filterV2PanelItem(item, v2Filter))
      .filter((item) => matchesSearch(item, searchQuery));
  }, [panels.bankRows, v2Filter, searchQuery]);

  const filteredLedgerRows = useMemo(() => {
    return panels.ledgerRows
      .filter((item) => filterV2PanelItem(item, v2Filter))
      .filter((item) => matchesSearch(item, searchQuery));
  }, [panels.ledgerRows, v2Filter, searchQuery]);

  const selectedBankItem = panels.bankRows.find((item) => item.id === selectedBankTxnId);
  const selectedLedgerItem = panels.ledgerRows.find((item) => item.id === selectedLedgerTxnId);
  const canManualMatch = Boolean(selectedBankTxnId && selectedLedgerTxnId);

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard title="Toplam banka hareketi" value={kpis.totalBankMovements} />
        <KpiCard title="Toplam muavin kaydı" value={kpis.totalLedgerRecords} />
        <KpiCard title="Eşleşen kayıt" value={kpis.matchedRecords} tone="success" />
        <KpiCard title="Eşleşmeyen banka" value={kpis.unmatchedBankMovements} tone="error" />
        <KpiCard title="Eşleşmeyen muavin" value={kpis.unmatchedLedgerRecords} tone="error" />
        <KpiCard title="Tutar farkı" value={formatMoney(kpis.totalDifference)} tone="warning" />
        <KpiCard title="Şüpheli kayıt" value={kpis.suspiciousRecords} tone="warning" />
        <KpiCard title="Eşleşme oranı" value={`%${kpis.matchRate}`} tone="success" />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onV2FilterChange(option.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              v2Filter === option.id
                ? "bg-indigo-600 text-white"
                : "border border-gray-700 text-gray-300 hover:bg-gray-900"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onExportAll}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-700"
        >
          Tüm Sonuçlar Excel
        </button>
        <button
          type="button"
          onClick={onExportUnmatched}
          className="rounded-xl border border-amber-700 bg-amber-950/40 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-950/70"
        >
          Eşleşmeyenler Excel
        </button>
        <button
          type="button"
          onClick={onExportRisky}
          className="rounded-xl border border-red-700 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-950/70"
        >
          Riskliler Excel
        </button>
      </div>

      <input
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Tarih, açıklama, referans ara..."
        className={inputClassName}
      />

      <div className="sticky bottom-4 z-20 rounded-2xl border border-indigo-700/60 bg-gray-900/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-300">
            <span className="font-semibold text-white">Manuel eşleştirme:</span>{" "}
            Banka: {selectedBankItem?.aciklama?.slice(0, 40) || "—"} | Muavin:{" "}
            {selectedLedgerItem?.aciklama?.slice(0, 40) || "—"}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canManualMatch}
              onClick={onManualMatch}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Eşleştir
            </button>
            <button
              type="button"
              disabled={!selectedBankItem?.resultRow?.isMatched && !selectedLedgerItem?.resultRow?.isMatched}
              onClick={() => {
                const row =
                  selectedBankItem?.resultRow?.isMatched
                    ? selectedBankItem.resultRow
                    : selectedLedgerItem?.resultRow;
                if (row) onRemoveMatch(row);
              }}
              className="rounded-lg border border-red-700 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Eşleşmeyi kaldır
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PanelTable
          title="Banka Ekstresi Hareketleri"
          rows={filteredBankRows.slice(0, 200)}
          selectedId={selectedBankTxnId}
          onSelect={onSelectBank}
          side="bank"
          onApproveMatch={onApproveMatch}
          onCreateVoucher={onCreateVoucher}
        />
        <PanelTable
          title="Muavin / Muhasebe Kayıtları"
          rows={filteredLedgerRows.slice(0, 200)}
          selectedId={selectedLedgerTxnId}
          onSelect={onSelectLedger}
          side="ledger"
          onApproveMatch={onApproveMatch}
        />
      </div>

      {filteredBankRows.length > 200 || filteredLedgerRows.length > 200 ? (
        <p className="text-sm text-gray-400">
          Her panelde ilk 200 kayıt gösteriliyor. Arama veya filtre kullanın.
        </p>
      ) : null}

      {!filteredBankRows.length && !filteredLedgerRows.length ? (
        <p className="text-sm text-gray-400">Seçili filtrelerde gösterilecek kayıt yok.</p>
      ) : null}
    </section>
  );
}

function PanelTable({
  title,
  rows,
  selectedId,
  onSelect,
  side,
  onApproveMatch,
  onCreateVoucher,
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 bg-gray-800/80 px-4 py-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-xs text-gray-400">{rows.length} kayıt</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-gray-800/60 text-gray-300">
            <tr>
              <th className="p-2 text-left">Durum</th>
              <th className="p-2 text-center">Skor</th>
              <th className="p-2 text-left">Tarih</th>
              <th className="p-2 text-left">Açıklama</th>
              {side === "ledger" ? <th className="p-2 text-left">Hesap</th> : null}
              <th className="p-2 text-right">Tutar</th>
              <th className="p-2 text-left">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const isSelected = selectedId === item.id;
              const resultRow = item.resultRow || {};
              const showVoucher = side === "bank" && !item.matchedLedgerId;

              return (
                <tr
                  key={item.id}
                  onClick={() => onSelect(isSelected ? "" : item.id)}
                  className={`cursor-pointer border-t border-gray-800 transition hover:bg-gray-800/40 ${
                    isSelected ? "bg-indigo-950/40 ring-1 ring-inset ring-indigo-500/60" : ""
                  }`}
                >
                  <td className="p-2">
                    <span
                      className={`inline-block rounded-lg px-2 py-0.5 text-[11px] font-semibold ${badgeClassName(item.badge)}`}
                    >
                      {item.badge}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    {item.score ? (
                      <div>
                        <span
                          className={`inline-flex min-w-[38px] justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${scoreClass(item.score)}`}
                        >
                          %{item.score}
                        </span>
                        <div className="mt-0.5 text-[10px] text-gray-500">{item.scoreLabel}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                  <td className="p-2 whitespace-nowrap">{item.tarih || "—"}</td>
                  <td className="max-w-[220px] p-2">
                    <div className="truncate" title={item.aciklama}>
                      {item.aciklama || "—"}
                    </div>
                    {item.referans ? (
                      <div className="text-[10px] text-gray-500">{item.referans}</div>
                    ) : null}
                  </td>
                  {side === "ledger" ? (
                    <td className="p-2 text-xs text-gray-400">{item.hesapKodu || "—"}</td>
                  ) : null}
                  <td className="p-2 text-right whitespace-nowrap">{formatMoney(item.tutar)}</td>
                  <td className="p-2" onClick={(event) => event.stopPropagation()}>
                    <div className="flex flex-col gap-1">
                      {resultRow.needsManualApproval && !resultRow.manualApproved ? (
                        <button
                          type="button"
                          onClick={() => onApproveMatch(resultRow)}
                          className="rounded border border-emerald-700 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-950"
                        >
                          Onayla
                        </button>
                      ) : null}
                      {showVoucher ? (
                        <button
                          type="button"
                          onClick={() => onCreateVoucher(item)}
                          className="rounded border border-indigo-700 px-2 py-1 text-[10px] font-semibold text-indigo-200 hover:bg-indigo-950"
                        >
                          Fiş oluştur
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ title, value, tone = "neutral" }) {
  const toneClasses = {
    neutral: "border-gray-700 bg-gray-950 text-white",
    success: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
    warning: "border-amber-800 bg-amber-950/40 text-amber-300",
    error: "border-red-800 bg-red-950/40 text-red-300",
  };

  return (
    <div className={`rounded-xl border p-4 ${toneClasses[tone] || toneClasses.neutral}`}>
      <div className="text-[11px] text-gray-400">{title}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
