"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CARI_RESOLUTION_FILTERS,
  filterCariResolutionGroups,
  searchCariResolutionCandidates,
  isAccountAllowedForDirection,
  isExpenseAccountCode,
} from "@/src/utils/cariMissingResolutionGroups";

function formatMoney(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "border-sky-500/60 bg-sky-950/50 text-sky-100"
          : "border-slate-700 bg-slate-950/40 text-slate-300 hover:bg-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function GroupCandidateList({
  candidates,
  selectedCode,
  onSelect,
  vendorMessage,
}) {
  if (vendorMessage && (!candidates || candidates.length === 0)) {
    return (
      <p className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
        {vendorMessage}
      </p>
    );
  }
  if (!candidates?.length) {
    return (
      <p className="text-xs text-slate-400">
        Uygun cari adayı yok. Hesap planında arayın.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {candidates.map((c) => {
        const active = selectedCode === c.code;
        return (
          <li key={c.code}>
            <button
              type="button"
              onClick={() => onSelect(c.code, c.name)}
              className={`flex w-full items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                active
                  ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-50"
                  : "border-slate-700/80 bg-slate-950/50 text-slate-200 hover:border-slate-500"
              }`}
            >
              <span>
                <span className="font-semibold text-white">{c.code}</span>
                <span className="mt-0.5 block text-slate-400">{c.name || "—"}</span>
                <span className="mt-0.5 block text-slate-500">{c.reasonLabel}</span>
              </span>
              <span className="shrink-0 text-slate-400">
                {Number(c.confidence) > 0 ? `${c.confidence}%` : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function GroupCard({
  group,
  companyPlans,
  isResolved,
  onApply,
  applyingId,
}) {
  const [selectedCode, setSelectedCode] = useState(group.suggestedAccount || "");
  const [selectedName, setSelectedName] = useState(group.suggestedName || "");
  const [learnNext, setLearnNext] = useState(true);
  const [searchAll, setSearchAll] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedSearch, setExpandedSearch] = useState(false);

  const liveSearch = useMemo(() => {
    if (!expandedSearch && !query) {
      return {
        candidates: group.candidates || [],
        vendorMessage: group.vendorMessage || "",
      };
    }
    return searchCariResolutionCandidates(companyPlans, {
      query,
      direction: group.direction,
      description: group.samples?.[0] || group.partyName,
      limit: expandedSearch ? 25 : 5,
      foreignVendor: group.foreignVendor,
      searchAll,
    });
  }, [companyPlans, expandedSearch, group, query, searchAll]);

  const canApply =
    Boolean(selectedCode) &&
    !isResolved &&
    isAccountAllowedForDirection(selectedCode, group.direction) &&
    !(group.foreignVendor && isExpenseAccountCode(selectedCode));

  return (
    <article
      className={`min-w-0 rounded-2xl border px-4 py-4 ${
        isResolved
          ? "border-emerald-800/50 bg-emerald-950/20"
          : "border-slate-800/80 bg-slate-950/50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-white">
              {group.partyName || "Karşı taraf"}
            </h3>
            <span className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
              {group.directionLabel}
            </span>
            {group.foreignVendor ? (
              <span className="rounded-md border border-violet-700/50 bg-violet-950/40 px-2 py-0.5 text-[11px] text-violet-100">
                Yabancı satıcı
              </span>
            ) : null}
            {isResolved ? (
              <span className="rounded-md border border-emerald-700/50 bg-emerald-950/40 px-2 py-0.5 text-[11px] text-emerald-100">
                Çözüldü
              </span>
            ) : (
              <span className="rounded-md border border-rose-700/40 bg-rose-950/30 px-2 py-0.5 text-[11px] text-rose-100">
                Kalan
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-300">
            {group.count} işlem · Toplam {formatMoney(group.totalAmount)} TL
            {group.dateFrom
              ? ` · ${group.dateFrom}${
                  group.dateTo && group.dateTo !== group.dateFrom
                    ? ` – ${group.dateTo}`
                    : ""
                }`
              : ""}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {(group.samples || []).slice(0, 3).map((s) => (
              <li key={s} className="truncate">
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Güven: {group.confidenceLabel}
            {group.suggestedAccount
              ? ` · Öneri: ${group.suggestedAccount}`
              : ""}
          </p>
        </div>
      </div>

      {!isResolved ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setExpandedSearch(true);
                }}
                placeholder="Hesap kodu, ad, unvan ara…"
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={() => {
                  setSearchAll((v) => !v);
                  setExpandedSearch(true);
                }}
                className="rounded-lg border border-slate-700 px-2.5 py-2 text-[11px] font-semibold text-slate-300 hover:bg-slate-900"
              >
                {searchAll ? "Tercih listesi" : "Tüm plan"}
              </button>
            </div>
            <GroupCandidateList
              candidates={(liveSearch.candidates || []).map((c) => ({
                ...c,
                confidenceLabel: undefined,
              }))}
              selectedCode={selectedCode}
              onSelect={(code, name) => {
                setSelectedCode(code);
                setSelectedName(name || "");
              }}
              vendorMessage={liveSearch.vendorMessage || group.vendorMessage}
            />
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
            <p className="text-xs text-slate-400">Seçilen hesap</p>
            <p className="text-sm font-semibold text-white">
              {selectedCode || "—"}
              {selectedName ? (
                <span className="ml-2 font-normal text-slate-400">
                  {selectedName}
                </span>
              ) : null}
            </p>
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={learnNext}
                onChange={(e) => setLearnNext(e.target.checked)}
                className="rounded border-slate-600"
              />
              Sonraki işlemlerde otomatik tanı
            </label>
            <button
              type="button"
              disabled={!canApply || applyingId === group.id}
              onClick={() =>
                onApply({
                  group,
                  accountCode: selectedCode,
                  accountName: selectedName,
                  learn: learnNext,
                })
              }
              className="mt-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applyingId === group.id
                ? "Uygulanıyor…"
                : `Seçilen Hesabı Gruba Uygula (${group.count})`}
            </button>
            <p className="text-[11px] text-slate-500">
              Onayınız olmadan hesap uygulanmaz. Gelen/giden yönü korunur.
            </p>
          </div>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Eksik Hesap Çözüm Merkezi — cari grup çözümü V1 (modal panel).
 */
export default function CariMissingResolutionCenter({
  open,
  onClose,
  snapshot,
  companyPlans = [],
  resolvedGroupIds,
  onApplyGroup,
  applyingId = null,
  lastApplyMessage = "",
  loading = false,
  error = "",
  onRetry,
}) {
  const [filter, setFilter] = useState(CARI_RESOLUTION_FILTERS.REMAINING);
  const [query, setQuery] = useState("");

  const groups = useMemo(
    () => snapshot?.groups || [],
    [snapshot?.groups]
  );
  const resolvedSet = useMemo(
    () =>
      resolvedGroupIds instanceof Set
        ? resolvedGroupIds
        : new Set(resolvedGroupIds || []),
    [resolvedGroupIds]
  );

  const remainingGroups = useMemo(
    () => groups.filter((g) => !resolvedSet.has(g.id)).length,
    [groups, resolvedSet]
  );
  const resolvedCount = useMemo(
    () => groups.filter((g) => resolvedSet.has(g.id)).length,
    [groups, resolvedSet]
  );

  const visible = useMemo(
    () =>
      filterCariResolutionGroups(groups, {
        filter,
        query,
        resolvedIds: resolvedSet,
      }),
    [groups, filter, query, resolvedSet]
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-stretch justify-center bg-black/70 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cari-resolution-title"
    >
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
        <header className="shrink-0 border-b border-slate-800 px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="cari-resolution-title"
                className="text-xl font-semibold text-white sm:text-2xl"
              >
                Eksik Hesap Çözüm Merkezi
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Cari bulunamayan işlemleri grup halinde eşleştirin.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-900"
            >
              Kapat
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Toplam eksik
              </p>
              <p className="text-lg font-semibold text-white">
                {loading ? "…" : snapshot?.totalMissing ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Cari bulunamadı
              </p>
              <p className="text-lg font-semibold text-rose-200">
                {loading ? "…" : snapshot?.cariMissingCount ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Cari grup
              </p>
              <p className="text-lg font-semibold text-white">
                {loading ? "…" : snapshot?.groupCount ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Çözülen grup
              </p>
              <p className="text-lg font-semibold text-emerald-200">
                {resolvedCount}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Kalan grup
              </p>
              <p className="text-lg font-semibold text-amber-100">
                {loading ? "…" : remainingGroups}
              </p>
            </div>
          </div>

          {lastApplyMessage ? (
            <p className="mt-3 rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
              {lastApplyMessage}
            </p>
          ) : null}

          {!loading && !error ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  [CARI_RESOLUTION_FILTERS.REMAINING, "Kalanlar"],
                  [CARI_RESOLUTION_FILTERS.ALL, "Tümü"],
                  [CARI_RESOLUTION_FILTERS.INCOMING, "Gelen cariler"],
                  [CARI_RESOLUTION_FILTERS.OUTGOING, "Giden cariler"],
                  [CARI_RESOLUTION_FILTERS.FOREIGN, "Yabancı satıcılar"],
                  [CARI_RESOLUTION_FILTERS.RESOLVED, "Çözülenler"],
                ].map(([id, label]) => (
                  <FilterChip
                    key={id}
                    active={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </FilterChip>
                ))}
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Açıklama, karşı taraf, tutar veya hesap kodu ara…"
                className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
              />
            </>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <div className="space-y-3" aria-busy="true" aria-live="polite">
              <p className="flex items-center gap-2 text-sm text-slate-300">
                <span
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-300"
                  aria-hidden="true"
                />
                Cari grupları hazırlanıyor…
              </p>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-5"
                >
                  <div className="h-4 w-1/3 rounded bg-slate-800" />
                  <div className="mt-3 h-3 w-2/3 rounded bg-slate-800/80" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-slate-800/60" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-700/50 bg-rose-950/30 px-4 py-5">
              <p className="text-sm font-semibold text-rose-100">
                Gruplar hazırlanamadı
              </p>
              <p className="mt-1 text-sm text-rose-100/80">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-xl border border-rose-600/50 bg-rose-900/40 px-4 py-2 text-sm font-semibold text-rose-50 hover:bg-rose-900/70"
              >
                Tekrar dene
              </button>
            </div>
          ) : visible.length === 0 ? (
            <p className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-400">
              Bu filtrede gösterilecek cari grubu yok.
            </p>
          ) : (
            visible.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                companyPlans={companyPlans}
                isResolved={resolvedSet.has(group.id)}
                onApply={onApplyGroup}
                applyingId={applyingId}
              />
            ))
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-800 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-800"
          >
            Daha Sonra İncele
          </button>
        </footer>
      </div>
    </div>
  );
}
