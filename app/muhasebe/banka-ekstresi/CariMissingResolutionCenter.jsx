"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CARI_RESOLUTION_FILTERS,
  CARI_RESOLUTION_MODAL_WIDTH_CSS,
  createCariResolutionPlanCache,
  filterCariResolutionGroups,
  hydrateCariResolutionGroupCandidates,
  searchCariResolutionCandidates,
  searchCreditCardResolutionCandidates,
  isAccountAllowedForDirection,
  isExpenseAccountCode,
  createInitialCariRowSelection,
  toggleCariRowSelection,
  setAllCariRowSelection,
  buildCariApplyGroupPayload,
  formatCariApplyButtonLabel,
} from "@/src/utils/cariMissingResolutionGroups";
import { isCreditCardAccountCode } from "@/src/utils/creditCardAccountResolver";
import dynamic from "next/dynamic";

const CariGroupTransactionPanel = dynamic(
  () => import("./CariGroupTransactionPanel"),
  {
    ssr: false,
    loading: () => (
      <p className="px-1 py-3 text-xs text-slate-500">İşlem listesi hazırlanıyor…</p>
    ),
  }
);

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
  loadingCandidates,
}) {
  if (loadingCandidates) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <span
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-sky-300"
          aria-hidden="true"
        />
        Adaylar hazırlanıyor…
      </p>
    );
  }
  if (vendorMessage && (!candidates || candidates.length === 0)) {
    return (
      <p className="break-words rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
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
              className={`flex w-full min-w-0 items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                active
                  ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-50"
                  : "border-slate-700/80 bg-slate-950/50 text-slate-200 hover:border-slate-500"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-white">{c.code}</span>
                <span className="mt-0.5 block break-words text-slate-400">
                  {c.name || "—"}
                </span>
                <span className="mt-0.5 block break-words text-slate-500">
                  {c.reasonLabel}
                </span>
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
  planCache,
  selectedCompany = null,
  isResolved,
  onApply,
  applyingId,
  onRetry,
  showServiceMeta = false,
}) {
  const cardRef = useRef(null);
  const [hydratedGroup, setHydratedGroup] = useState(group);
  const [hydrating, setHydrating] = useState(false);
  const [selectedCode, setSelectedCode] = useState(group.suggestedAccount || "");
  const [selectedName, setSelectedName] = useState(group.suggestedName || "");
  const [learnNext, setLearnNext] = useState(true);
  const [searchAll, setSearchAll] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedSearch, setExpandedSearch] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState(() =>
    createInitialCariRowSelection(group.rowIds || [])
  );
  const hydrateRequested = useRef(Boolean(group.candidatesReady));

  const rowIdsKey = (group.rowIds || []).join("|");
  const [rowSelectionKey, setRowSelectionKey] = useState(rowIdsKey);
  if (rowSelectionKey !== rowIdsKey) {
    setRowSelectionKey(rowIdsKey);
    setSelectedRowIds(createInitialCariRowSelection(group.rowIds || []));
  }

  const transactions = hydratedGroup.transactions || group.transactions || [];
  const selectedApplyCount = useMemo(() => {
    const all = new Set((group.rowIds || []).map(String));
    let n = 0;
    for (const id of selectedRowIds) {
      if (all.has(String(id))) n += 1;
    }
    return n;
  }, [group.rowIds, selectedRowIds]);

  const ensureCandidates = () => {
    if (hydrateRequested.current || group.candidatesReady) return;
    if (group.virmanCandidate) {
      hydrateRequested.current = true;
      return;
    }
    hydrateRequested.current = true;
    setHydrating(true);
    // UI’yı bloke etmeden bir tick sonra
    setTimeout(() => {
      const next = hydrateCariResolutionGroupCandidates(group, companyPlans, {
        planCache,
        limit: 5,
        selectedCompany,
      });
      setHydratedGroup(next);
      setSelectedCode((prev) => prev || next.suggestedAccount || "");
      setSelectedName((prev) => prev || next.suggestedName || "");
      setHydrating(false);
    }, 0);
  };

  useEffect(() => {
    if (isResolved || group.candidatesReady || group.virmanCandidate) {
      return undefined;
    }
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver !== "function") {
      ensureCandidates();
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          ensureCandidates();
          obs.disconnect();
        }
      },
      { root: null, rootMargin: "120px", threshold: 0.01 }
    );
    obs.observe(node);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/visibility hydrate once per group id
  }, [group.id, group.candidatesReady, group.virmanCandidate, isResolved]);

  const liveSearch = useMemo(() => {
    if (group.virmanCandidate || hydratedGroup.virmanCandidate) {
      return { candidates: [], vendorMessage: VIRMAN_CANDIDATE_LABEL_UI };
    }
    if (group.creditCardGroup || hydratedGroup.creditCardGroup) {
      if (!expandedSearch && !query) {
        return {
          candidates: hydratedGroup.candidates || [],
          vendorMessage: hydratedGroup.vendorMessage || "",
        };
      }
      return {
        candidates: searchCreditCardResolutionCandidates(companyPlans, {
          query,
          lastFourDigits: hydratedGroup.lastFourDigits || "",
          periodMonth: hydratedGroup.periodMonth || null,
          periodYear: hydratedGroup.periodYear || null,
          bankName: hydratedGroup.bankName || "",
          limit: expandedSearch ? 25 : 8,
        }),
        vendorMessage: hydratedGroup.vendorMessage || "",
      };
    }
    if (!expandedSearch && !query) {
      return {
        candidates: hydratedGroup.candidates || [],
        vendorMessage: hydratedGroup.vendorMessage || "",
        ownCompanyFiltered: hydratedGroup.ownCompanyFiltered || 0,
      };
    }
    return searchCariResolutionCandidates(companyPlans, {
      query,
      direction: hydratedGroup.direction,
      description:
        hydratedGroup.samples?.[0] || hydratedGroup.partyName,
      limit: expandedSearch ? 25 : 5,
      foreignVendor: hydratedGroup.foreignVendor,
      searchAll,
      planCache,
      selectedCompany,
    });
  }, [
    companyPlans,
    expandedSearch,
    group.virmanCandidate,
    group.creditCardGroup,
    hydratedGroup,
    planCache,
    query,
    searchAll,
    selectedCompany,
  ]);

  const isVirmanCandidateCard = Boolean(
    group.virmanCandidate || hydratedGroup.virmanCandidate
  );
  const isCreditCardCard = Boolean(
    group.creditCardGroup || hydratedGroup.creditCardGroup
  );
  const isTaxObligationCard = Boolean(
    group.taxObligationGroup || hydratedGroup.taxObligationGroup
  );

  const canApply =
    !isVirmanCandidateCard &&
    !isTaxObligationCard &&
    Boolean(selectedCode) &&
    selectedApplyCount > 0 &&
    !isResolved &&
    (isCreditCardCard
      ? isCreditCardAccountCode(selectedCode)
      : isAccountAllowedForDirection(selectedCode, hydratedGroup.direction) &&
        !(
          hydratedGroup.foreignVendor && isExpenseAccountCode(selectedCode)
        ));

  const showCandidateLoading =
    hydrating ||
    (!hydratedGroup.candidatesReady &&
      !expandedSearch &&
      !query &&
      !isResolved &&
      !isVirmanCandidateCard);

  return (
    <article
      ref={cardRef}
      className={`min-w-0 overflow-hidden rounded-2xl border px-4 py-4 sm:px-5 ${
        isResolved
          ? "border-emerald-800/50 bg-emerald-950/20"
          : "border-slate-800/80 bg-slate-950/50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-base font-semibold text-white sm:text-lg">
              {hydratedGroup.partyName || "Karşı taraf"}
            </h3>
            <span className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
              {hydratedGroup.directionLabel}
            </span>
            {isCreditCardCard ? (
              <span className="rounded-md border border-cyan-700/50 bg-cyan-950/40 px-2 py-0.5 text-[11px] text-cyan-100">
                Kredi kartı ****{hydratedGroup.lastFourDigits || "????"}
              </span>
            ) : null}
            {isTaxObligationCard ? (
              <span className="rounded-md border border-teal-700/50 bg-teal-950/40 px-2 py-0.5 text-[11px] text-teal-100">
                Vergi / SGK {hydratedGroup.obligationType || ""}
              </span>
            ) : null}
            {isVirmanCandidateCard ? (
              <span className="rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-100">
                Virman adayı
              </span>
            ) : null}
            {hydratedGroup.foreignVendor ? (
              <span className="rounded-md border border-violet-700/50 bg-violet-950/40 px-2 py-0.5 text-[11px] text-violet-100">
                Yabancı satıcı
              </span>
            ) : null}
            {isResolved ? (
              <span className="rounded-md border border-emerald-700/50 bg-emerald-950/40 px-2 py-0.5 text-[11px] text-emerald-100">
                Çözüldü
              </span>
            ) : !isVirmanCandidateCard ? (
              <span className="rounded-md border border-rose-700/40 bg-rose-950/30 px-2 py-0.5 text-[11px] text-rose-100">
                Kalan
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-300">
            {hydratedGroup.count} işlem · Toplam{" "}
            {formatMoney(hydratedGroup.totalAmount)} TL
            {hydratedGroup.dateFrom
              ? ` · ${hydratedGroup.dateFrom}${
                  hydratedGroup.dateTo &&
                  hydratedGroup.dateTo !== hydratedGroup.dateFrom
                    ? ` – ${hydratedGroup.dateTo}`
                    : ""
                }`
              : ""}
          </p>
          {isCreditCardCard ? (
            <p className="mt-1 text-xs text-slate-400">
              Banka: {hydratedGroup.bankName || "—"}
              {" · "}
              Ekstre dönemi: {hydratedGroup.statementPeriodLabel || "—"}
              {hydratedGroup.ambiguous
                ? " · Birden fazla kart eşleşmesi"
                : ""}
            </p>
          ) : null}
          {isTaxObligationCard ? (
            <p className="mt-1 text-xs text-slate-400">
              Dönem: {hydratedGroup.periodLabel || "—"}
              {" · "}
              Ödeme: {hydratedGroup.paymentDate || "—"}
              {" · "}
              Banka tutarı: {formatMoney(hydratedGroup.bankAmount)} TL
              {" · "}
              Tahakkuk:{" "}
              {hydratedGroup.accrualTotal != null
                ? `${formatMoney(hydratedGroup.accrualTotal)} TL`
                : "—"}
              {" · "}
              {hydratedGroup.matchStatusLabel || "Manuel inceleme"}
            </p>
          ) : null}
          {isTaxObligationCard ? (
            <p className="mt-1 text-xs text-teal-200/80">
              {hydratedGroup.accrualId
                ? "Tahakkuk seçimi ve Luca dağılımı sonraki pakette."
                : "Bu ödeme için tahakkuk kaydı bulunamadı."}
            </p>
          ) : null}
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {(hydratedGroup.samples || []).slice(0, 3).map((s) => (
              <li key={s} className="break-words">
                {s}
              </li>
            ))}
          </ul>
          {!isVirmanCandidateCard ? (
            <p className="mt-2 break-words text-xs text-slate-500">
              Güven: {hydratedGroup.confidenceLabel}
              {hydratedGroup.suggestedAccount
                ? ` · Öneri: ${hydratedGroup.suggestedAccount}`
                : ""}
            </p>
          ) : null}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowTransactions((v) => !v)}
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-900"
            >
              {showTransactions
                ? "İşlemleri Gizle"
                : `${hydratedGroup.count || transactions.length || 0} İşlemi Göster`}
            </button>
          </div>
          {showTransactions ? (
            <CariGroupTransactionPanel
              transactions={transactions}
              selectedIds={selectedRowIds}
              allowApplySelection={
                !isVirmanCandidateCard && !isTaxObligationCard && !isResolved
              }
              selectedAccount={selectedCode || hydratedGroup.suggestedAccount || ""}
              matchReason={
                hydratedGroup.confidenceLabel ||
                hydratedGroup.matchReason ||
                ""
              }
              groupKey={hydratedGroup.analysisKey || hydratedGroup.id || ""}
              creditCardMode={Boolean(
                group.creditCardGroup || hydratedGroup.creditCardGroup
              )}
              onToggleRow={(id) =>
                setSelectedRowIds((prev) => toggleCariRowSelection(prev, id))
              }
              onSelectAll={() =>
                setSelectedRowIds(
                  setAllCariRowSelection(group.rowIds || [], true)
                )
              }
              onClearSelection={() =>
                setSelectedRowIds(
                  setAllCariRowSelection(group.rowIds || [], false)
                )
              }
            />
          ) : null}
        </div>
      </div>

      {!isResolved && isVirmanCandidateCard ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/25 px-4 py-3 text-sm text-amber-50">
            <p className="font-semibold">
              Virman adayı — karşı banka hesabı tanımlanmalı
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/85">
              Aktif firmanın 120/320 cari hesabı burada uygulanmaz. Firma kartına
              karşı banka hesabını (IBAN + Luca 102) ekleyip ekstreyi yeniden
              işlediğinizde 102↔102 kesin virman çözülür.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/muhasebe/firma-yonetimi?tab=banks"
              className="inline-flex items-center justify-center rounded-xl border border-sky-600/50 bg-sky-950/40 px-4 py-2.5 text-sm font-semibold text-sky-100 transition hover:bg-sky-900/50"
            >
              Firma kartına git
            </a>
            {typeof onRetry === "function" ? (
              <button
                type="button"
                onClick={() => onRetry()}
                className="inline-flex items-center justify-center rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-2.5 text-sm font-semibold text-amber-50 transition hover:bg-amber-900/40"
              >
                Hesap tanımlandıktan sonra yeniden analiz et
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!isResolved && isTaxObligationCard ? (
        <div className="mt-4 space-y-3 rounded-xl border border-teal-700/40 bg-teal-950/25 px-4 py-3 text-sm text-teal-50">
          <p className="font-semibold">
            {hydratedGroup.accrualId
              ? "Vergi / SGK — inceleme"
              : "Bu ödeme için tahakkuk kaydı bulunamadı."}
          </p>
          <p className="text-xs leading-relaxed text-teal-100/85">
            {hydratedGroup.accrualId
              ? "Tahakkuk seçimi ve Luca dağılımı sonraki pakette. Bu aşamada otomatik uygulama kapalıdır."
              : "Banka Parser yalnızca Mali Yükümlülük Merkezi’ndeki normalize tahakkuk kayıtlarını kullanır."}
          </p>
          <a
            href="/muhasebe/mali-yukumluluk"
            className="inline-flex items-center justify-center rounded-xl border border-teal-600/50 bg-teal-950/40 px-4 py-2.5 text-sm font-semibold text-teal-50 transition hover:bg-teal-900/50"
          >
            Mali Yükümlülük Merkezi’ne Git
          </a>
        </div>
      ) : null}

      {!isResolved && !isVirmanCandidateCard && !isTaxObligationCard ? (
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setExpandedSearch(true);
                  ensureCandidates();
                }}
                onFocus={() => ensureCandidates()}
                placeholder="Hesap kodu, ad, unvan, IBAN ara…"
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={() => {
                  setSearchAll((v) => !v);
                  setExpandedSearch(true);
                  ensureCandidates();
                }}
                className="rounded-lg border border-slate-700 px-2.5 py-2 text-[11px] font-semibold text-slate-300 hover:bg-slate-900"
              >
                {searchAll ? "Tercih listesi" : "Tüm plan"}
              </button>
            </div>
            <GroupCandidateList
              candidates={liveSearch.candidates || []}
              selectedCode={selectedCode}
              onSelect={(code, name) => {
                setSelectedCode(code);
                setSelectedName(name || "");
              }}
              vendorMessage={
                liveSearch.vendorMessage || hydratedGroup.vendorMessage
              }
              loadingCandidates={showCandidateLoading}
            />
            {showServiceMeta &&
            Number(liveSearch.ownCompanyFiltered || 0) > 0 ? (
              <p className="mt-2 text-[11px] text-slate-500">
                Aktif firma hesabı filtrelendi: {liveSearch.ownCompanyFiltered}
              </p>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 sm:p-4">
            <p className="text-xs text-slate-400">Seçilen hesap</p>
            <p className="break-words text-sm font-semibold text-white">
              {selectedCode || "—"}
              {selectedName ? (
                <span className="mt-1 block font-normal break-words text-slate-400">
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
              disabled={!canApply || applyingId === hydratedGroup.id}
              onClick={() =>
                onApply({
                  group: buildCariApplyGroupPayload(
                    hydratedGroup,
                    [...selectedRowIds]
                  ),
                  accountCode: selectedCode,
                  accountName: selectedName,
                  learn: learnNext,
                })
              }
              className="mt-1 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applyingId === hydratedGroup.id
                ? "Uygulanıyor…"
                : formatCariApplyButtonLabel(selectedApplyCount)}
            </button>
            <p className="text-[11px] text-slate-500">
              {isCreditCardCard
                ? "Yalnız 309/409 kart hesapları uygulanır. Öğrenme açıkken aynı kart sonraki aylarda otomatik tanınır."
                : "Onayınız olmadan hesap uygulanmaz. Yalnız seçili satırlar güncellenir; gelen/giden yönü korunur."}
            </p>
            {isCreditCardCard ? (
              <a
                href="/muhasebe/firma-yonetimi"
                className="mt-1 inline-flex text-center text-[11px] font-semibold text-sky-300 hover:text-sky-200"
              >
                Firma kartına kredi kartı olarak kaydet / düzenle
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

const VIRMAN_CANDIDATE_LABEL_UI =
  "Virman adayı — karşı banka hesabı tanımlanmalı";

/**
 * Eksik Hesap Çözüm Merkezi — cari grup çözümü V1 (modal panel).
 */
export default function CariMissingResolutionCenter({
  open,
  onClose,
  snapshot,
  companyPlans = [],
  selectedCompany: selectedCompanyProp = null,
  resolvedGroupIds,
  onApplyGroup,
  applyingId = null,
  lastApplyMessage = "",
  loading = false,
  error = "",
  onRetry,
  showServiceMeta = false,
}) {
  const [filter, setFilter] = useState(CARI_RESOLUTION_FILTERS.REMAINING);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => snapshot?.groups || [], [snapshot?.groups]);
  const virmanCandidateGroups = useMemo(
    () => snapshot?.virmanCandidateGroups || [],
    [snapshot?.virmanCandidateGroups]
  );
  const creditCardGroups = useMemo(
    () => snapshot?.creditCardGroups || [],
    [snapshot?.creditCardGroups]
  );
  const taxObligationGroups = useMemo(
    () => snapshot?.taxObligationGroups || [],
    [snapshot?.taxObligationGroups]
  );
  const selectedCompany = selectedCompanyProp || snapshot?.selectedCompany || null;
  const planCache = useMemo(
    () => snapshot?.planCache || createCariResolutionPlanCache(companyPlans),
    [snapshot?.planCache, companyPlans]
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

  const visible = useMemo(() => {
    if (filter === CARI_RESOLUTION_FILTERS.VIRMAN_CANDIDATES) {
      return filterCariResolutionGroups(virmanCandidateGroups, {
        filter: CARI_RESOLUTION_FILTERS.ALL,
        query,
        resolvedIds: resolvedSet,
      });
    }
    if (filter === CARI_RESOLUTION_FILTERS.CREDIT_CARDS) {
      return filterCariResolutionGroups(creditCardGroups, {
        filter: CARI_RESOLUTION_FILTERS.ALL,
        query,
        resolvedIds: resolvedSet,
      });
    }
    if (filter === CARI_RESOLUTION_FILTERS.TAX_OBLIGATIONS) {
      return filterCariResolutionGroups(taxObligationGroups, {
        filter: CARI_RESOLUTION_FILTERS.ALL,
        query,
        resolvedIds: resolvedSet,
      });
    }
    return filterCariResolutionGroups(groups, {
      filter,
      query,
      resolvedIds: resolvedSet,
    }).filter(
      (g) =>
        !g.virmanCandidate && !g.creditCardGroup && !g.taxObligationGroup
    );
  }, [
    groups,
    virmanCandidateGroups,
    creditCardGroups,
    taxObligationGroups,
    filter,
    query,
    resolvedSet,
  ]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const metric = (value) => {
    if (loading) return "—";
    if (value == null || value === "") return "—";
    return value;
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cari-resolution-title"
    >
      <div
        className={`flex w-full flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl ${CARI_RESOLUTION_MODAL_WIDTH_CSS}`}
      >
        <header className="shrink-0 border-b border-slate-800 px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="cari-resolution-title"
                className="text-xl font-semibold text-white sm:text-2xl"
              >
                Eksik Hesap Çözüm Merkezi
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {loading
                  ? "Cari grupları hazırlanıyor…"
                  : "Cari bulunamayan işlemleri grup halinde eşleştirin."}
              </p>
              {Number(snapshot?.virmanCandidateCount || 0) > 0 ? (
                <p className="mt-1 text-xs text-amber-200/90">
                  Virman adayı: {snapshot.virmanCandidateCount} satır — karşı banka
                  hesabı firma kartında tanımlanmalı (120/320 uygulanmaz).
                </p>
              ) : null}
              {showServiceMeta &&
              !loading &&
              Number(snapshot?.virmanDivertedCount || 0) > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  Kesin virman (102↔102): {snapshot.virmanDivertedCount} satır
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-900"
            >
              Kapat
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-8">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Toplam eksik
              </p>
              <p className="text-lg font-semibold text-white">
                {metric(snapshot?.totalMissing)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Cari bulunamadı
              </p>
              <p className="text-lg font-semibold text-rose-200">
                {metric(snapshot?.cariMissingCount)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Cari grup
              </p>
              <p className="text-lg font-semibold text-white">
                {metric(snapshot?.groupCount)}
              </p>
            </div>
            <div className="rounded-xl border border-cyan-800/40 bg-cyan-950/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-cyan-200/70">
                Kredi kartı
              </p>
              <p className="text-lg font-semibold text-cyan-100">
                {metric(snapshot?.creditCardMissingCount)}
              </p>
            </div>
            <div className="rounded-xl border border-teal-800/40 bg-teal-950/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-teal-200/70">
                Vergi / SGK
              </p>
              <p className="text-lg font-semibold text-teal-100">
                {metric(snapshot?.taxObligationMissingCount)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-amber-200/70">
                Virman adayı
              </p>
              <p className="text-lg font-semibold text-amber-100">
                {metric(snapshot?.virmanCandidateCount)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Çözülen grup
              </p>
              <p className="text-lg font-semibold text-emerald-200">
                {loading ? "—" : resolvedCount}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Kalan grup
              </p>
              <p className="text-lg font-semibold text-amber-100">
                {metric(
                  snapshot?.groupCount != null ? remainingGroups : null
                )}
              </p>
            </div>
          </div>

          {lastApplyMessage ? (
            <p className="mt-3 break-words rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
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
                  [CARI_RESOLUTION_FILTERS.CREDIT_CARDS, "Kredi Kartları"],
                  [CARI_RESOLUTION_FILTERS.TAX_OBLIGATIONS, "Vergi / SGK"],
                  [CARI_RESOLUTION_FILTERS.VIRMAN_CANDIDATES, "Virman adayları"],
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

        <div className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-6">
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
              <p className="mt-1 break-words text-sm text-rose-100/80">
                {error}
              </p>
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
                key={`${group.id}:${group.candidatesReady ? "1" : "0"}:${group.suggestedAccount || ""}`}
                group={group}
                companyPlans={companyPlans}
                planCache={planCache}
                selectedCompany={selectedCompany}
                isResolved={resolvedSet.has(group.id)}
                onApply={onApplyGroup}
                applyingId={applyingId}
                onRetry={onRetry}
                showServiceMeta={showServiceMeta}
              />
            ))
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-800 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-800 sm:w-auto"
          >
            Daha Sonra İncele
          </button>
        </footer>
      </div>
    </div>
  );
}
