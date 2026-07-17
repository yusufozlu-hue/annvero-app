"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthUserBar from "@/src/components/AuthUserBar";
import { ANNVERO_THEME_KEY } from "@/src/config/annveroNavConfig";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import {
  loadFavoriteCompanyIds,
  loadRecentCompanyIds,
  toggleFavoriteCompanyId,
} from "@/src/utils/companyPreferences";
import { fetchPendingTransactionCount } from "@/src/utils/transactionMemoryApi";
import { annveroInputClass } from "@/src/styles/annveroDesign";

const DROPDOWN_MAX_WIDTH = 520;
const DROPDOWN_MAX_HEIGHT = 360;
const RECENT_LIMIT = 3;

function sortCompaniesTr(list, getLabel) {
  return [...list].sort((a, b) =>
    getLabel(a).localeCompare(getLabel(b), "tr", { sensitivity: "base" })
  );
}

export default function AnnveroTopbar({ onMenuToggle, sidebarCollapsed = false }) {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    getCompanyDisplayName,
    isLoading,
  } = useCompanyList();

  const [companySearch, setCompanySearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [recentIds, setRecentIds] = useState([]);
  const [theme, setTheme] = useState("dark");
  const [notificationCount, setNotificationCount] = useState(0);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    setFavoriteIds(loadFavoriteCompanyIds());
    setRecentIds(loadRecentCompanyIds());
    const savedTheme = localStorage.getItem(ANNVERO_THEME_KEY) || "dark";
    setTheme(savedTheme);
    document.documentElement.dataset.annveroTheme = savedTheme;
  }, []);

  useEffect(() => {
    let active = true;

    async function loadNotifications() {
      try {
        const pendingCount = await fetchPendingTransactionCount(selectedCompanyId || "");
        if (active) setNotificationCount(pendingCount);
      } catch {
        if (active) setNotificationCount(0);
      }
    }

    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!dropdownOpen) return;

    function handlePointerOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [dropdownOpen]);

  useEffect(() => {
    if (!dropdownOpen) {
      setCompanySearch("");
      setHighlightIndex(-1);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dropdownOpen]);

  // Mobilde body scroll kilidi — yalnızca dar ekranda
  useEffect(() => {
    if (!dropdownOpen) return;
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    if (!isMobile) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [dropdownOpen]);

  const getLabel = useCallback(
    (company) => getCompanyDisplayName(company),
    [getCompanyDisplayName]
  );

  const favoriteCompanies = useMemo(() => {
    const list = companies.filter((c) => favoriteIds.includes(c.id));
    return sortCompaniesTr(list, getLabel);
  }, [companies, favoriteIds, getLabel]);

  const favoriteIdSet = useMemo(
    () => new Set(favoriteCompanies.map((c) => c.id)),
    [favoriteCompanies]
  );

  const recentCompanies = useMemo(() => {
    return recentIds
      .map((id) => companies.find((c) => c.id === id))
      .filter((c) => c && !favoriteIdSet.has(c.id))
      .slice(0, RECENT_LIMIT);
  }, [companies, recentIds, favoriteIdSet]);

  const recentIdSet = useMemo(
    () => new Set(recentCompanies.map((c) => c.id)),
    [recentCompanies]
  );

  const allCompaniesSorted = useMemo(() => {
    const query = companySearch.trim().toLocaleLowerCase("tr");
    const filtered = companies.filter((company) => {
      // Favori / son kullanılanlarda gösterilenleri "Tüm firmalar"da tekrarlama
      if (!query && (favoriteIdSet.has(company.id) || recentIdSet.has(company.id))) {
        return false;
      }
      if (!query) return true;
      return getLabel(company).toLocaleLowerCase("tr").includes(query);
    });
    return sortCompaniesTr(filtered, getLabel);
  }, [companies, companySearch, favoriteIdSet, recentIdSet, getLabel]);

  /** Klavye navigasyonu için düz seçenek listesi */
  const flatOptions = useMemo(() => {
    const options = [{ type: "all", id: "", label: "Tüm firmalar" }];

    if (!companySearch.trim()) {
      favoriteCompanies.forEach((c) => {
        options.push({ type: "company", id: c.id, label: getLabel(c) });
      });
      recentCompanies.forEach((c) => {
        options.push({ type: "company", id: c.id, label: getLabel(c) });
      });
    }

    allCompaniesSorted.forEach((c) => {
      options.push({ type: "company", id: c.id, label: getLabel(c) });
    });

    return options;
  }, [
    companySearch,
    favoriteCompanies,
    recentCompanies,
    allCompaniesSorted,
    getLabel,
  ]);

  const selectCompany = useCallback(
    (id) => {
      setSelectedCompanyId(id);
      setRecentIds(loadRecentCompanyIds());
      setDropdownOpen(false);
      setCompanySearch("");
      setHighlightIndex(-1);
      window.dispatchEvent(new Event("annvero:refresh-modules"));
    },
    [setSelectedCompanyId]
  );

  const toggleFavorite = useCallback((event, companyId) => {
    event.stopPropagation();
    event.preventDefault();
    setFavoriteIds(toggleFavoriteCompanyId(companyId));
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(ANNVERO_THEME_KEY, next);
    document.documentElement.dataset.annveroTheme = next;
  };

  const handleListKeyDown = (event) => {
    if (!flatOptions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, flatOptions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = flatOptions[highlightIndex];
      if (option) selectCompany(option.id);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightIndex(flatOptions.length - 1);
    }
  };

  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-option-index="${highlightIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  const companyLabel = selectedCompany
    ? getCompanyDisplayName(selectedCompany)
    : isLoading
      ? "Firmalar yükleniyor..."
      : "Firma seçin";

  const showPinnedSections = !companySearch.trim();
  let optionIndex = 0;

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--annvero-border)] bg-[color-mix(in_srgb,var(--annvero-shell)_92%,transparent)] px-4 py-3 backdrop-blur-xl sm:px-6">
      <div className="flex flex-wrap items-center gap-3 lg:gap-4">
        <button
          type="button"
          onClick={onMenuToggle}
          className="rounded-xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] px-3 py-2 text-sm font-semibold text-[var(--annvero-text)] lg:hidden"
        >
          Menü
        </button>

        <div className="relative min-w-0 flex-1" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            className="flex w-full max-w-[520px] items-center gap-2.5 rounded-xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] px-3 py-2 text-left transition hover:border-[var(--annvero-accent)]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--annvero-accent-soft)] text-xs font-bold text-[var(--annvero-accent)]">
              {selectedCompany
                ? getCompanyDisplayName(selectedCompany).slice(0, 1).toUpperCase()
                : "?"}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-sm font-semibold text-[var(--annvero-text)]"
                title={companyLabel}
              >
                {companyLabel}
              </span>
              <span className="annvero-text-muted block text-[11px]">Aktif firma</span>
            </span>
            <span className="annvero-text-muted text-xs">▾</span>
          </button>

          {dropdownOpen ? (
            <>
              <div
                className="fixed inset-0 z-40 sm:hidden"
                style={{ background: "var(--annvero-overlay)" }}
                aria-hidden="true"
                onClick={() => setDropdownOpen(false)}
              />

              <div
                className="fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col rounded-t-2xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-[calc(100%+6px)] sm:max-h-[360px] sm:w-full sm:max-w-[520px] sm:rounded-xl"
                style={{ maxWidth: DROPDOWN_MAX_WIDTH }}
                role="listbox"
                aria-label="Firma seçimi"
                onKeyDown={handleListKeyDown}
              >
                <div className="shrink-0 border-b border-[var(--annvero-border)] p-2.5">
                  <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--annvero-border)] sm:hidden" />
                  <input
                    ref={searchInputRef}
                    value={companySearch}
                    onChange={(e) => {
                      setCompanySearch(e.target.value);
                      setHighlightIndex(0);
                    }}
                    onKeyDown={handleListKeyDown}
                    placeholder="Firma ara..."
                    className={`${annveroInputClass} !py-2 !text-sm`}
                    aria-autocomplete="list"
                    aria-controls="annvero-company-list"
                  />
                </div>

                <div
                  id="annvero-company-list"
                  ref={listRef}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5"
                  style={{ maxHeight: DROPDOWN_MAX_HEIGHT - 56 }}
                >
                  {/* Tüm firmalar seçeneği — arama yokken üstte kısa */}
                  <CompanyRow
                    label="Tüm firmalar"
                    selected={!selectedCompanyId}
                    highlighted={highlightIndex === optionIndex}
                    dataIndex={optionIndex++}
                    onSelect={() => selectCompany("")}
                    showFavorite={false}
                  />

                  {showPinnedSections && favoriteCompanies.length > 0 ? (
                    <SectionLabel>Favoriler</SectionLabel>
                  ) : null}
                  {showPinnedSections
                    ? favoriteCompanies.map((company) => {
                        const idx = optionIndex++;
                        return (
                          <CompanyRow
                            key={`fav-${company.id}`}
                            label={getLabel(company)}
                            selected={company.id === selectedCompanyId}
                            highlighted={highlightIndex === idx}
                            dataIndex={idx}
                            isFavorite
                            onSelect={() => selectCompany(company.id)}
                            onToggleFavorite={(e) => toggleFavorite(e, company.id)}
                          />
                        );
                      })
                    : null}

                  {showPinnedSections && recentCompanies.length > 0 ? (
                    <SectionLabel>Son kullanılan</SectionLabel>
                  ) : null}
                  {showPinnedSections
                    ? recentCompanies.map((company) => {
                        const idx = optionIndex++;
                        return (
                          <CompanyRow
                            key={`recent-${company.id}`}
                            label={getLabel(company)}
                            selected={company.id === selectedCompanyId}
                            highlighted={highlightIndex === idx}
                            dataIndex={idx}
                            isFavorite={favoriteIds.includes(company.id)}
                            onSelect={() => selectCompany(company.id)}
                            onToggleFavorite={(e) => toggleFavorite(e, company.id)}
                          />
                        );
                      })
                    : null}

                  <SectionLabel>
                    {companySearch.trim() ? "Sonuçlar" : "Tüm firmalar"}
                  </SectionLabel>
                  {allCompaniesSorted.length === 0 ? (
                    <p className="px-2.5 py-2 text-xs text-slate-500">Firma bulunamadı.</p>
                  ) : (
                    allCompaniesSorted.map((company) => {
                      const idx = optionIndex++;
                      return (
                        <CompanyRow
                          key={company.id}
                          label={getLabel(company)}
                          selected={company.id === selectedCompanyId}
                          highlighted={highlightIndex === idx}
                          dataIndex={idx}
                          isFavorite={favoriteIds.includes(company.id)}
                          onSelect={() => selectCompany(company.id)}
                          onToggleFavorite={(e) => toggleFavorite(e, company.id)}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/muhasebe/islem-hafizasi"
            className="relative rounded-xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] p-2.5 text-[var(--annvero-text-muted)] transition hover:border-amber-500/40 hover:text-amber-600"
            title="Bildirimler"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15 17H9l-1 5h8l-1-5ZM18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z" />
            </svg>
            {notificationCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-slate-950">
                {notificationCount > 99 ? "99+" : notificationCount}
              </span>
            ) : null}
          </Link>

          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] p-2.5 text-[var(--annvero-text-muted)] transition hover:border-[var(--annvero-accent)] hover:text-[var(--annvero-accent)]"
            title={theme === "dark" ? "Açık tema" : "Koyu tema"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>

          <div className="hidden sm:block">
            <AuthUserBar variant="embedded" showAdminLink />
          </div>
        </div>
      </div>
    </header>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="annvero-text-muted sticky top-0 z-[1] bg-[var(--annvero-surface)]/95 px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm">
      {children}
    </p>
  );
}

function CompanyRow({
  label,
  selected,
  highlighted = false,
  dataIndex,
  isFavorite = false,
  showFavorite = true,
  onSelect,
  onToggleFavorite,
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      data-option-index={dataIndex}
      className={`group flex h-9 w-full items-center gap-1 rounded-lg px-2 text-left text-sm transition ${
        selected
          ? "bg-[var(--annvero-accent-soft)] text-[var(--annvero-text)]"
          : highlighted
            ? "bg-[var(--annvero-hover)] text-[var(--annvero-text)]"
            : "text-[var(--annvero-text)] hover:bg-[var(--annvero-hover)]"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate py-1.5 text-left"
        title={label}
      >
        {label}
      </button>
      {showFavorite ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggleFavorite}
          className={`shrink-0 rounded p-1 text-xs transition ${
            isFavorite
              ? "text-amber-500 opacity-100"
              : "annvero-text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-amber-500 focus-visible:opacity-100"
          }`}
          title={isFavorite ? "Favoriden çıkar" : "Favoriye ekle"}
          aria-label={isFavorite ? "Favoriden çıkar" : "Favoriye ekle"}
        >
          {isFavorite ? "★" : "☆"}
        </button>
      ) : null}
    </div>
  );
}
