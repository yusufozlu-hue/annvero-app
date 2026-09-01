"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CARI_RESOLUTION_FILTERS,
  CARI_RESOLUTION_MODAL_WIDTH_CSS,
  CARI_RESOLUTION_ESCAPE_DISMISS_SEARCH,
  CARI_RESOLUTION_DISMISS_SEARCH_EVENT,
  createCariResolutionPlanCache,
  selectVisibleResolutionGroups,
  countOpenResolutionGroups,
  pickDefaultCariResolutionFilter,
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
  canEnableCariAutoLearn,
  shouldDefaultCariAutoLearn,
  resolveCariResolutionEscapeAction,
} from "@/src/utils/cariMissingResolutionGroups";
import { isSelectableCariLeafAccount } from "@/src/utils/cariCounterpartyExtract";
import { isCreditCardAccountCode } from "@/src/utils/creditCardAccountResolver";
import { fetchActiveAccountPlan } from "@/src/utils/accountPlanApi";
import { mergeAccountPlanRows } from "@/src/utils/accountPlanMerge";
import { normalizeParserText } from "@/src/utils/textNormalize";
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
  bulkSelected = false,
  onToggleBulkSelect,
}) {
  const cardRef = useRef(null);
  const [hydratedGroup, setHydratedGroup] = useState(group);
  const [hydrating, setHydrating] = useState(false);
  const [selectedCode, setSelectedCode] = useState(group.suggestedAccount || "");
  const [selectedName, setSelectedName] = useState(group.suggestedName || "");
  const [learnNext, setLearnNext] = useState(() => {
    if (group.vadeliOnboardingStep === "STATEMENT_102") return true;
    if (group.vadeliOnboardingStep === "VADESIZ_COUNTER") return false;
    if (group.vadeliOnboardingStep === "FAIZ_STOPAJI_193") {
      return group.learnAllowedDefault !== false;
    }
    return shouldDefaultCariAutoLearn({
      accountCode: group.suggestedAccount || "",
      duplicateAccounts: group.duplicateAccounts,
      partyName: group.partyName || "",
    });
  });
  /** Varsayılan: tüm aktif hesap planı (4.166+); tercih listesine kullanıcı geçebilir. */
  const [searchAll, setSearchAll] = useState(true);
  const [query, setQuery] = useState("");
  const [expandedSearch, setExpandedSearch] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState(() =>
    createInitialCariRowSelection(group.rowIds || [])
  );
  const [serverPlanRows, setServerPlanRows] = useState([]);
  const [serverSearchLoading, setServerSearchLoading] = useState(false);
  const hydrateRequested = useRef(Boolean(group.candidatesReady));
  const companyIdForSearch = String(
    selectedCompany?.id || selectedCompany?.companyId || ""
  ).trim();

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
      setSelectedCode(next.suggestedAccount || "");
      setSelectedName(next.suggestedName || "");
      setLearnNext(
        shouldDefaultCariAutoLearn({
          confidence: next.confidence,
          accountCode: next.suggestedAccount || "",
          duplicateAccounts: next.duplicateAccounts,
          partyName: next.partyName || "",
        })
      );
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

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return undefined;
    const onDismissSearch = () => {
      setQuery("");
      setExpandedSearch(false);
    };
    node.addEventListener(CARI_RESOLUTION_DISMISS_SEARCH_EVENT, onDismissSearch);
    return () =>
      node.removeEventListener(
        CARI_RESOLUTION_DISMISS_SEARCH_EVENT,
        onDismissSearch
      );
  }, []);

  const accountSearchOpen = Boolean(query || expandedSearch);

  // Sunucu tarafı hesap planı araması — ilk 1000 dışı kodlar dahil (q=).
  useEffect(() => {
    const q = String(query || "").trim();
    if (!companyIdForSearch || q.length < 2) {
      return undefined;
    }
    if (group.virmanCandidate || hydratedGroup.virmanCandidate) {
      return undefined;
    }
    if (
      group.vadeliAccountGroup ||
      hydratedGroup.vadeliAccountGroup ||
      group.faizStopajiGroup ||
      hydratedGroup.faizStopajiGroup ||
      group.hideCariSearch
    ) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setServerSearchLoading(true);
      try {
        const result = await fetchActiveAccountPlan(companyIdForSearch, {
          q,
          page: 1,
          pageSize: 50,
        });
        if (cancelled) return;
        setServerPlanRows(Array.isArray(result.accounts) ? result.accounts : []);
      } catch {
        if (!cancelled) setServerPlanRows([]);
      } finally {
        if (!cancelled) setServerSearchLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    companyIdForSearch,
    query,
    group.virmanCandidate,
    hydratedGroup.virmanCandidate,
  ]);

  const searchablePlans = useMemo(() => {
    const q = String(query || "").trim();
    const serverRows = q.length >= 2 ? serverPlanRows : [];
    return mergeAccountPlanRows(companyPlans, serverRows);
  }, [companyPlans, serverPlanRows, query]);

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
        candidates: searchCreditCardResolutionCandidates(searchablePlans, {
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
    if (
      group.vadeliAccountGroup ||
      hydratedGroup.vadeliAccountGroup ||
      group.faizStopajiGroup ||
      hydratedGroup.faizStopajiGroup ||
      group.hideCariSearch ||
      hydratedGroup.hideCariSearch
    ) {
      const prefixes = hydratedGroup.preferredPrefixes ||
        (group.faizStopajiGroup || hydratedGroup.faizStopajiGroup
          ? ["193"]
          : ["102"]);
      const q = normalizeParserText(query);
      const base = (hydratedGroup.candidates || []).length
        ? hydratedGroup.candidates
        : (searchablePlans || [])
            .map((p) => ({
              code: String(p.accountCode || p.code || "").trim(),
              name: String(p.accountName || p.name || "").trim(),
              confidence: 0,
            }))
            .filter((c) => {
              const code = c.code;
              if (!code || !code.includes(".")) return false;
              return prefixes.some(
                (pref) => code === pref || code.startsWith(`${pref}.`)
              );
            });
      const filtered = q
        ? base.filter((c) =>
            normalizeParserText(`${c.code} ${c.name}`).includes(q)
          )
        : base;
      return {
        candidates: filtered.slice(0, expandedSearch ? 40 : 12),
        vendorMessage:
          hydratedGroup.selectionHint ||
          hydratedGroup.vendorMessage ||
          "",
      };
    }
    if (!expandedSearch && !query) {
      return {
        candidates: hydratedGroup.candidates || [],
        vendorMessage: hydratedGroup.vendorMessage || "",
        ownCompanyFiltered: hydratedGroup.ownCompanyFiltered || 0,
      };
    }
    return searchCariResolutionCandidates(searchablePlans, {
      query,
      direction: hydratedGroup.direction,
      description:
        hydratedGroup.samples?.[0] || hydratedGroup.partyName,
      limit: expandedSearch ? 25 : 5,
      foreignVendor: hydratedGroup.foreignVendor,
      searchAll,
      planCache: null,
      selectedCompany,
    });
  }, [
    searchablePlans,
    expandedSearch,
    group.virmanCandidate,
    group.creditCardGroup,
    group.vadeliAccountGroup,
    group.faizStopajiGroup,
    group.hideCariSearch,
    hydratedGroup,
    query,
    searchAll,
    selectedCompany,
  ]);

  // Arama sonucu değişince listede olmayan eski seçimi temizle
  useEffect(() => {
    if (!query && !expandedSearch) return;
    const list = liveSearch.candidates || [];
    if (!selectedCode) return;
    if (!list.some((c) => c.code === selectedCode)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- arama adayı dış kaynak; geçersiz seçimi temizle
      setSelectedCode("");
      setSelectedName("");
      setLearnNext(false);
    }
  }, [query, expandedSearch, liveSearch.candidates, selectedCode]);

  const isVirmanCandidateCard = Boolean(
    group.virmanCandidate || hydratedGroup.virmanCandidate
  );
  const isCreditCardCard = Boolean(
    group.creditCardGroup || hydratedGroup.creditCardGroup
  );
  const isTaxObligationCard = Boolean(
    group.taxObligationGroup || hydratedGroup.taxObligationGroup
  );
  const isVadeliAccountCard = Boolean(
    group.vadeliAccountGroup || hydratedGroup.vadeliAccountGroup
  );
  const isFaizStopajiCard = Boolean(
    group.faizStopajiGroup || hydratedGroup.faizStopajiGroup
  );
  const isGlLeafCard = isVadeliAccountCard || isFaizStopajiCard;

  const codeAllowedForCard = (code = "") => {
    const c = String(code || "").trim();
    if (!c || !c.includes(".")) return false;
    if (isCreditCardCard) return isCreditCardAccountCode(c);
    if (isVadeliAccountCard) return c === "102" || c.startsWith("102.");
    if (isFaizStopajiCard) return c === "193" || c.startsWith("193.");
    return (
      isAccountAllowedForDirection(c, hydratedGroup.direction) &&
      !(hydratedGroup.foreignVendor && isExpenseAccountCode(c))
    );
  };

  const canApply =
    !isVirmanCandidateCard &&
    !isTaxObligationCard &&
    Boolean(selectedCode) &&
    isSelectableCariLeafAccount(selectedCode) &&
    selectedApplyCount > 0 &&
    !isResolved &&
    codeAllowedForCard(selectedCode);

  const learnEnabled = isGlLeafCard
    ? Boolean(selectedCode) && codeAllowedForCard(selectedCode)
    : canEnableCariAutoLearn({
        confidence: hydratedGroup.confidence,
        accountCode: selectedCode,
        duplicateAccounts: hydratedGroup.duplicateAccounts,
      });

  const showCandidateLoading =
    hydrating ||
    serverSearchLoading ||
    (!hydratedGroup.candidatesReady &&
      !expandedSearch &&
      !query &&
      !isResolved &&
      !isVirmanCandidateCard);

  return (
    <article
      ref={cardRef}
      data-cari-search-open={accountSearchOpen ? "true" : undefined}
      className={`min-w-0 overflow-hidden rounded-2xl border px-4 py-4 sm:px-5 ${
        isResolved
          ? "border-emerald-800/50 bg-emerald-950/20"
          : "border-slate-800/80 bg-slate-950/50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {!isResolved &&
            !isVirmanCandidateCard &&
            !isTaxObligationCard &&
            !isGlLeafCard &&
            typeof onToggleBulkSelect === "function" ? (
              <label className="mr-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={bulkSelected}
                  onChange={() => onToggleBulkSelect(group.id)}
                  className="rounded border-slate-600"
                  aria-label="Toplu seç"
                />
                Toplu
              </label>
            ) : null}
            <h3 className="break-words text-base font-semibold text-white sm:text-lg">
              {hydratedGroup.partyName || "Karşı taraf"}
            </h3>
            <span className="rounded-md border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
              {hydratedGroup.directionLabel}
            </span>
            {isVadeliAccountCard ? (
              <span className="rounded-md border border-violet-700/50 bg-violet-950/40 px-2 py-0.5 text-[11px] text-violet-100">
                Vadeli 102
              </span>
            ) : null}
            {isFaizStopajiCard ? (
              <span className="rounded-md border border-indigo-700/50 bg-indigo-950/40 px-2 py-0.5 text-[11px] text-indigo-100">
                Stopaj 193
              </span>
            ) : null}
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
            {hydratedGroup.duplicateAccounts ? (
              <span className="rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-100">
                Mükerrer cari
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
          <p className="mt-1 text-xs text-slate-500">
            {hydratedGroup.transactionType
              ? `Tür: ${hydratedGroup.transactionType}`
              : "Tür: —"}
            {" · "}
            {hydratedGroup.currency || "TRY"}
            {hydratedGroup.bankName ? ` · ${hydratedGroup.bankName}` : ""}
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

      {!isResolved && isGlLeafCard ? (
        <div className="mt-4 rounded-xl border border-violet-800/40 bg-violet-950/20 px-4 py-3 text-sm text-violet-50">
          <p className="font-semibold">
            {hydratedGroup.partyName ||
              (isFaizStopajiCard
                ? "Faiz stopajı hesabı seçilmeli"
                : "Vadeli mevduat hesabı eşleştirilmedi")}
          </p>
          {(hydratedGroup.statementBankName ||
            hydratedGroup.statementAccountMasked) &&
          hydratedGroup.vadeliOnboardingStep === "STATEMENT_102" ? (
            <div className="mt-2 rounded-lg border border-violet-700/40 bg-slate-950/40 px-3 py-2 text-xs text-violet-100/90">
              <p>
                Banka:{" "}
                <span className="font-semibold text-white">
                  {hydratedGroup.statementBankName || "—"}
                </span>
              </p>
              <p className="mt-0.5">
                Hesap:{" "}
                <span className="font-semibold text-white">
                  {hydratedGroup.statementAccountMasked || "—"}
                </span>
              </p>
            </div>
          ) : null}
          {hydratedGroup.onboardingQuestion ? (
            <p className="mt-2 text-sm font-medium text-white">
              {hydratedGroup.onboardingQuestion}
            </p>
          ) : null}
          <p className="mt-1 text-xs leading-relaxed text-violet-100/85">
            {hydratedGroup.selectionHint ||
              hydratedGroup.vendorMessage ||
              (isFaizStopajiCard
                ? "Hesap planından yalnız 193 alt hesabı seçilebilir. Cari arama kapalıdır."
                : "Hesap planından yalnız 102 alt hesabı seçilebilir. Cari arama kapalıdır.")}
          </p>
          {hydratedGroup.createAccountHref &&
          !(liveSearch.candidates || []).length &&
          !(hydratedGroup.candidates || []).length ? (
            <a
              href={hydratedGroup.createAccountHref}
              className="mt-3 inline-flex rounded-xl border border-sky-600/50 bg-sky-950/40 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-900/50"
            >
              {hydratedGroup.createAccountLabel ||
                "Firma kartında hesap tanımla"}
            </a>
          ) : null}
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
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  if (!query && !expandedSearch) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                  setExpandedSearch(false);
                }}
                placeholder={
                  isVadeliAccountCard
                    ? "102 alt hesabı ara…"
                    : isFaizStopajiCard
                      ? "193 alt hesabı ara…"
                      : "Hesap kodu, ad, unvan, IBAN ara…"
                }
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              {!isGlLeafCard ? (
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
              ) : null}
            </div>
            <GroupCandidateList
              candidates={liveSearch.candidates || []}
              selectedCode={selectedCode}
              onSelect={(code, name) => {
                setSelectedCode(code);
                setSelectedName(name || "");
                setLearnNext(
                  shouldDefaultCariAutoLearn({
                    accountCode: code,
                    duplicateAccounts: hydratedGroup.duplicateAccounts,
                    partyName: hydratedGroup.partyName || "",
                  })
                );
              }}
              vendorMessage={
                liveSearch.vendorMessage || hydratedGroup.vendorMessage
              }
              loadingCandidates={showCandidateLoading}
            />
            {hydratedGroup.duplicateAccounts ||
            liveSearch.duplicateAccounts ? (
              <p className="mt-2 rounded-lg border border-amber-800/50 bg-amber-950/30 px-2.5 py-2 text-[11px] text-amber-100">
                Mükerrer cari hesap bulundu. Aynı normalize unvana birden fazla
                hesap var — otomatik seçim yapılmaz; doğru leaf hesabı siz
                seçin.
              </p>
            ) : null}
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
            <label
              className={`mt-1 flex items-center gap-2 text-xs ${
                learnEnabled ? "text-slate-300" : "text-slate-500"
              }`}
            >
              <input
                type="checkbox"
                checked={learnNext && learnEnabled}
                disabled={!learnEnabled}
                onChange={(e) => setLearnNext(e.target.checked)}
                className="rounded border-slate-600"
              />
              {hydratedGroup.learnLabel || "Bu firma için öğren"}
            </label>
            {hydratedGroup.vadeliOnboardingStep === "VADESIZ_COUNTER" ? (
              <p className="text-[11px] text-amber-100/80">
                Tek kesin aday olsa bile kalıcı kayıt için kutuyu işaretleyin;
                onaysız öğrenilmez.
              </p>
            ) : null}
            {learnNext && learnEnabled && !isGlLeafCard ? (
              <p className="text-[11px] text-slate-500">
                Bu dosyada ~{selectedApplyCount} satır · kalıp:{" "}
                {hydratedGroup.partyName || "—"} · kapsam:{" "}
                {hydratedGroup.directionLabel || "—"} / aktif firma
              </p>
            ) : null}
            {isGlLeafCard && learnNext && learnEnabled ? (
              <p className="text-[11px] text-slate-500">
                {hydratedGroup.vadeliOnboardingStep === "STATEMENT_102"
                  ? "Sonraki ekstrelerde aynı hesap numarası otomatik 102’ye bağlanır."
                  : hydratedGroup.vadeliOnboardingStep === "FAIZ_STOPAJI_193"
                    ? `${selectedApplyCount} stopaj hareketine uygulanır; firma hafızasına yazılır.`
                    : "Seçim uygulandıktan sonra isteğe bağlı öğrenilir."}
              </p>
            ) : null}
            {!learnNext && !isGlLeafCard ? (
              <p className="text-[11px] text-slate-500">
                Mükerrer cari veya parent hesapta öğrenme kapalıdır. Düşük güvenli
                öneri onayınız olmadan kaydedilmez.
              </p>
            ) : null}
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
                  learn: Boolean(
                    learnNext &&
                      learnEnabled &&
                      // Vadesiz: kullanıcı kutuyu açıkça işaretlemeden öğrenme yok
                      (hydratedGroup.vadeliOnboardingStep !==
                        "VADESIZ_COUNTER" ||
                        learnNext)
                  ),
                })
              }
              className="mt-1 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applyingId === hydratedGroup.id
                ? "Uygulanıyor…"
                : formatCariApplyButtonLabel(
                    selectedApplyCount,
                    hydratedGroup
                  )}
            </button>
            <p className="text-[11px] text-slate-500">
              {isCreditCardCard
                ? "Yalnız 309/409 kart hesapları uygulanır. Öğrenme açıkken aynı kart sonraki aylarda otomatik tanınır."
                : isGlLeafCard
                  ? hydratedGroup.selectionHint ||
                    "Onayınız olmadan hesap uygulanmaz. İlgili muhasebe bacağı güncellenir."
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
            {isGlLeafCard && hydratedGroup.createAccountHref ? (
              <a
                href={hydratedGroup.createAccountHref}
                className="mt-1 inline-flex text-center text-[11px] font-semibold text-sky-300 hover:text-sky-200"
              >
                {hydratedGroup.createAccountLabel ||
                  "Firma kartında banka hesabı tanımla"}
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
  resolvedGroups: resolvedGroupsProp = [],
  onApplyGroup,
  onBulkApplyGroups,
  onUndoLastApply,
  canUndo = false,
  applyingId = null,
  lastApplyMessage = "",
  applyCompare = null,
  loading = false,
  error = "",
  onRetry,
  showServiceMeta = false,
}) {
  const [filter, setFilter] = useState(CARI_RESOLUTION_FILTERS.REMAINING);
  const [query, setQuery] = useState("");
  const [bulkSelectedIds, setBulkSelectedIds] = useState(() => new Set());
  const [bulkCode, setBulkCode] = useState("");
  const [bulkName, setBulkName] = useState("");
  const [bulkLearn, setBulkLearn] = useState(true);
  const [filterBootstrappedFor, setFilterBootstrappedFor] = useState("");

  const resolutionCompanyKey = String(
    selectedCompanyProp?.id ||
      selectedCompanyProp?.companyId ||
      snapshot?.selectedCompany?.id ||
      snapshot?.selectedCompany?.companyId ||
      ""
  );
  const [companyResetKey, setCompanyResetKey] = useState(resolutionCompanyKey);
  if (companyResetKey !== resolutionCompanyKey) {
    setCompanyResetKey(resolutionCompanyKey);
    setBulkSelectedIds(new Set());
    setBulkCode("");
    setBulkName("");
    setBulkLearn(true);
    setFilter(CARI_RESOLUTION_FILTERS.REMAINING);
    setQuery("");
    setFilterBootstrappedFor("");
  }

  const groups = useMemo(() => snapshot?.groups || [], [snapshot?.groups]);
  const resolvedGroups = useMemo(
    () =>
      resolvedGroupsProp?.length
        ? resolvedGroupsProp
        : snapshot?.resolvedGroups || [],
    [resolvedGroupsProp, snapshot?.resolvedGroups]
  );
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
  const vadeliAccountGroups = useMemo(
    () => snapshot?.vadeliAccountGroups || [],
    [snapshot?.vadeliAccountGroups]
  );
  const faizStopajiGroups = useMemo(
    () => snapshot?.faizStopajiGroups || [],
    [snapshot?.faizStopajiGroups]
  );
  const selectedCompany = selectedCompanyProp || snapshot?.selectedCompany || null;
  // loading + snapshot yokken plan cache kurma — 4k hesap index’i her render’da
  // main thread’i kilitleyip “Cari grupları hazırlanıyor”da sonsuz beklemeye yol açıyordu.
  const planCount = Array.isArray(companyPlans) ? companyPlans.length : 0;
  const planCache = useMemo(() => {
    if (snapshot?.planCache) return snapshot.planCache;
    if (loading || planCount === 0) {
      return {
        companyPlans: [],
        planRows: [],
        cariIndex: null,
        indexBuildCount: 0,
        planNormalizeCount: 0,
      };
    }
    return createCariResolutionPlanCache(companyPlans);
  }, [snapshot?.planCache, loading, planCount, companyPlans]);
  const resolvedSet = useMemo(
    () =>
      resolvedGroupIds instanceof Set
        ? resolvedGroupIds
        : new Set(resolvedGroupIds || []),
    [resolvedGroupIds]
  );

  const remainingGroups = useMemo(
    () =>
      countOpenResolutionGroups(
        {
          groups,
          taxObligationGroups,
          creditCardGroups,
          virmanCandidateGroups,
          vadeliAccountGroups,
          faizStopajiGroups,
        },
        resolvedSet
      ),
    [
      groups,
      taxObligationGroups,
      creditCardGroups,
      virmanCandidateGroups,
      vadeliAccountGroups,
      faizStopajiGroups,
      resolvedSet,
    ]
  );
  const resolvedCount = useMemo(() => {
    if (resolvedGroups.length) return resolvedGroups.length;
    return resolvedSet.size;
  }, [resolvedGroups, resolvedSet]);

  const snapshotBootstrapKey = useMemo(() => {
    if (!snapshot || loading) return "";
    return [
      resolutionCompanyKey,
      snapshot.totalMissing ?? "",
      snapshot.groupCount ?? "",
      snapshot.taxObligationGroupCount ?? "",
      snapshot.creditCardGroupCount ?? "",
      snapshot.virmanCandidateGroupCount ?? "",
      snapshot.vadeliAccountGroupCount ?? "",
      snapshot.faizStopajiGroupCount ?? "",
      (snapshot.groups || []).map((g) => g.id).join(","),
      (snapshot.taxObligationGroups || []).map((g) => g.id).join(","),
      (snapshot.creditCardGroups || []).map((g) => g.id).join(","),
      (snapshot.virmanCandidateGroups || []).map((g) => g.id).join(","),
      (snapshot.vadeliAccountGroups || []).map((g) => g.id).join(","),
      (snapshot.faizStopajiGroups || []).map((g) => g.id).join(","),
    ].join("|");
  }, [snapshot, resolutionCompanyKey, loading]);

  // Snapshot gelince boş varsayılan filtreye düşme (effect setState yasak — render-time).
  if (
    open &&
    snapshotBootstrapKey &&
    filterBootstrappedFor !== snapshotBootstrapKey
  ) {
    setFilterBootstrappedFor(snapshotBootstrapKey);
    setFilter(pickDefaultCariResolutionFilter(snapshot, resolvedSet));
  }

  const bulkTargets = useMemo(() => {
    return (groups || []).filter(
      (g) =>
        bulkSelectedIds.has(g.id) &&
        !resolvedSet.has(g.id) &&
        !g.virmanCandidate &&
        !g.taxObligationGroup
    );
  }, [groups, bulkSelectedIds, resolvedSet]);

  const bulkAffectedRows = useMemo(
    () =>
      bulkTargets.reduce(
        (sum, g) => sum + (Number(g.count) || (g.rowIds || []).length || 0),
        0
      ),
    [bulkTargets]
  );

  const bulkLearnEnabled = canEnableCariAutoLearn({
    accountCode: bulkCode,
    duplicateAccounts: bulkTargets.some((g) => g.duplicateAccounts),
  });

  const toggleBulkSelect = (groupId) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const visible = useMemo(
    () =>
      selectVisibleResolutionGroups({
        filter,
        query,
        resolvedIds: resolvedSet,
        groups,
        resolvedGroups,
        virmanCandidateGroups,
        creditCardGroups,
        taxObligationGroups,
        vadeliAccountGroups,
        faizStopajiGroups,
      }),
    [
      groups,
      resolvedGroups,
      virmanCandidateGroups,
      creditCardGroups,
      taxObligationGroups,
      vadeliAccountGroups,
      faizStopajiGroups,
      filter,
      query,
      resolvedSet,
    ]
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      const openSearches = document.querySelectorAll(
        '[role="dialog"][aria-labelledby="cari-resolution-title"] [data-cari-search-open="true"]'
      );
      const action = resolveCariResolutionEscapeAction({
        hasOpenAccountSearch: openSearches.length > 0,
      });
      if (action === CARI_RESOLUTION_ESCAPE_DISMISS_SEARCH) {
        e.preventDefault();
        openSearches.forEach((el) => {
          el.dispatchEvent(
            new CustomEvent(CARI_RESOLUTION_DISMISS_SEARCH_EVENT)
          );
        });
        return;
      }
      onClose?.();
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

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
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
            <div className="rounded-xl border border-violet-800/40 bg-violet-950/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-violet-200/70">
                Vadeli mevduat
              </p>
              <p className="text-lg font-semibold text-violet-100">
                {metric(snapshot?.vadeliAccountMissingCount)}
              </p>
            </div>
            <div className="rounded-xl border border-indigo-800/40 bg-indigo-950/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-indigo-200/70">
                Faiz stopajı
              </p>
              <p className="text-lg font-semibold text-indigo-100">
                {metric(snapshot?.faizStopajiMissingCount)}
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
                {loading ? "—" : remainingGroups}
              </p>
            </div>
          </div>

          {lastApplyMessage ? (
            <p className="mt-3 break-words rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
              {lastApplyMessage}
            </p>
          ) : null}

          {applyCompare?.rows?.length ? (
            <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Önce / sonra · yeniden analiz
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {applyCompare.rows.map((row) => (
                  <div
                    key={row.key}
                    className="rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-2"
                  >
                    <p className="text-[11px] text-slate-500">{row.label}</p>
                    <p className="text-sm font-semibold text-white">
                      {row.previous} → {row.next}
                    </p>
                  </div>
                ))}
              </div>
              {applyCompare.fisKontrol ? (
                <p className="mt-2 text-[11px] text-slate-400">
                  Fiş Kontrol: hata {applyCompare.fisKontrol.errors ?? 0} · uyarı{" "}
                  {applyCompare.fisKontrol.warnings ?? 0} · geçen{" "}
                  {applyCompare.fisKontrol.passed ?? 0}
                </p>
              ) : null}
            </div>
          ) : null}

          {!loading && !error && bulkTargets.length > 0 ? (
            <div className="mt-3 rounded-xl border border-sky-800/50 bg-sky-950/30 px-3 py-3">
              <p className="text-sm font-semibold text-sky-100">
                Toplu eşleştirme · {bulkTargets.length} grup · {bulkAffectedRows}{" "}
                satır etkilenecek
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="min-w-[10rem] flex-1 text-[11px] text-slate-400">
                  Hesap kodu
                  <input
                    value={bulkCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      setBulkCode(code);
                      setBulkLearn(
                        shouldDefaultCariAutoLearn({ accountCode: code })
                      );
                    }}
                    placeholder="320.01.001"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
                  />
                </label>
                <label className="min-w-[10rem] flex-1 text-[11px] text-slate-400">
                  Hesap adı
                  <input
                    value={bulkName}
                    onChange={(e) => setBulkName(e.target.value)}
                    placeholder="Opsiyonel"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white"
                  />
                </label>
                <label
                  className={`flex items-center gap-2 pb-2 text-xs ${
                    bulkLearnEnabled ? "text-slate-200" : "text-slate-500"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={bulkLearn && bulkLearnEnabled}
                    disabled={!bulkLearnEnabled}
                    onChange={(e) => setBulkLearn(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  Bu firma için öğren
                </label>
                <button
                  type="button"
                  disabled={
                    !bulkCode ||
                    !isSelectableCariLeafAccount(bulkCode) ||
                    applyingId != null
                  }
                  onClick={() =>
                    onBulkApplyGroups?.({
                      groups: bulkTargets.map((g) =>
                        buildCariApplyGroupPayload(g, g.rowIds || [])
                      ),
                      accountCode: bulkCode,
                      accountName: bulkName,
                      learn: Boolean(bulkLearn && bulkLearnEnabled),
                      affectedRowCount: bulkAffectedRows,
                    })
                  }
                  className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  Seçili gruplara uygula ({bulkAffectedRows})
                </button>
                <button
                  type="button"
                  onClick={() => setBulkSelectedIds(new Set())}
                  className="rounded-xl border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900"
                >
                  Seçimi temizle
                </button>
              </div>
            </div>
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
                  [CARI_RESOLUTION_FILTERS.VADELI_ACCOUNTS, "Vadeli mevduat"],
                  [CARI_RESOLUTION_FILTERS.FAIZ_STOPAJI, "Faiz stopajı"],
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
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-slate-200">
                Bu filtrede gösterilecek çözülebilir grup yok.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Toplam eksik {metric(snapshot?.totalMissing)} · birleşik kalan{" "}
                {loading ? "—" : remainingGroups}.
              </p>
              {typeof onRetry === "function" ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-4 rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-900"
                >
                  Tekrar dene
                </button>
              ) : null}
            </div>
          ) : (
            visible.map((group) => (
              <GroupCard
                key={`${group.id}:${group.candidatesReady ? "1" : "0"}:${group.suggestedAccount || ""}`}
                group={group}
                companyPlans={companyPlans}
                planCache={planCache}
                selectedCompany={selectedCompany}
                isResolved={
                  resolvedSet.has(group.id) ||
                  group.status === "resolved" ||
                  filter === CARI_RESOLUTION_FILTERS.RESOLVED
                }
                onApply={onApplyGroup}
                applyingId={applyingId}
                onRetry={onRetry}
                showServiceMeta={showServiceMeta}
                bulkSelected={bulkSelectedIds.has(group.id)}
                onToggleBulkSelect={toggleBulkSelect}
              />
            ))
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-800 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap gap-2">
            {canUndo && typeof onUndoLastApply === "function" ? (
              <button
                type="button"
                onClick={onUndoLastApply}
                disabled={applyingId != null}
                className="rounded-xl border border-amber-600/50 bg-amber-950/30 px-4 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
              >
                Son uygulamayı geri al
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-800 sm:w-auto"
            >
              Daha Sonra İncele
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
