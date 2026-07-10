"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthUserBar from "@/src/components/AuthUserBar";
import { ANNVERO_THEME_KEY } from "@/src/config/annveroNavConfig";
import { useCompanyList } from "@/app/muhasebe/hooks/useCompanyList";
import {
  loadFavoriteCompanyIds,
  loadRecentCompanyIds,
  toggleFavoriteCompanyId,
} from "@/src/utils/companyPreferences";
import { fetchPendingTransactionCount } from "@/src/utils/transactionMemoryApi";
import { annveroInputClass } from "@/src/styles/annveroDesign";

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
  const dropdownRef = useRef(null);

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
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    if (!query) return companies;
    return companies.filter((company) =>
      getCompanyDisplayName(company).toLowerCase().includes(query)
    );
  }, [companies, companySearch, getCompanyDisplayName]);

  const favoriteCompanies = useMemo(
    () => companies.filter((c) => favoriteIds.includes(c.id)),
    [companies, favoriteIds]
  );

  const recentCompanies = useMemo(
    () =>
      recentIds
        .map((id) => companies.find((c) => c.id === id))
        .filter(Boolean)
        .slice(0, 5),
    [companies, recentIds]
  );

  const selectCompany = useCallback(
    (id) => {
      setSelectedCompanyId(id);
      setRecentIds(loadRecentCompanyIds());
      setDropdownOpen(false);
      setCompanySearch("");
      window.dispatchEvent(new Event("annvero:refresh-modules"));
    },
    [setSelectedCompanyId]
  );

  const toggleFavorite = useCallback((event, companyId) => {
    event.stopPropagation();
    setFavoriteIds(toggleFavoriteCompanyId(companyId));
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(ANNVERO_THEME_KEY, next);
    document.documentElement.dataset.annveroTheme = next;
  };

  const companyLabel = selectedCompany
    ? getCompanyDisplayName(selectedCompany)
    : isLoading
      ? "Firmalar yükleniyor..."
      : "Firma seçin";

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#040b18]/95 px-4 py-3 backdrop-blur-xl sm:px-6">
      <div className="flex flex-wrap items-center gap-3 lg:gap-4">
        <button
          type="button"
          onClick={onMenuToggle}
          className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm font-semibold text-slate-200 lg:hidden"
        >
          Menü
        </button>

        <div className="relative min-w-0 flex-1" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex w-full max-w-xl items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-left transition hover:border-blue-500/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-sm font-bold text-blue-200">
              {selectedCompany ? getCompanyDisplayName(selectedCompany).slice(0, 1).toUpperCase() : "?"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">{companyLabel}</span>
              <span className="block text-xs text-slate-500">Aktif firma · hızlı arama</span>
            </span>
            <span className="text-slate-500">▾</span>
          </button>

          {dropdownOpen ? (
            <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-700 bg-[#06111f] p-3 shadow-2xl shadow-black/40">
              <input
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Firma ara..."
                className={annveroInputClass}
                autoFocus
              />

              {favoriteCompanies.length ? (
                <div className="mt-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-amber-400/90">
                    Favoriler
                  </p>
                  <div className="space-y-1">
                    {favoriteCompanies.map((company) => (
                      <CompanyRow
                        key={`fav-${company.id}`}
                        company={company}
                        label={getCompanyDisplayName(company)}
                        selected={company.id === selectedCompanyId}
                        isFavorite
                        onSelect={() => selectCompany(company.id)}
                        onToggleFavorite={(e) => toggleFavorite(e, company.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {recentCompanies.length ? (
                <div className="mt-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-cyan-400/90">
                    Son kullanılan
                  </p>
                  <div className="space-y-1">
                    {recentCompanies.map((company) => (
                      <CompanyRow
                        key={`recent-${company.id}`}
                        company={company}
                        label={getCompanyDisplayName(company)}
                        selected={company.id === selectedCompanyId}
                        isFavorite={favoriteIds.includes(company.id)}
                        onSelect={() => selectCompany(company.id)}
                        onToggleFavorite={(e) => toggleFavorite(e, company.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Tüm firmalar
                </p>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => selectCompany("")}
                    className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm ${
                      !selectedCompanyId ? "bg-blue-600/20 text-white" : "text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    Tüm firmalar
                  </button>
                  {filteredCompanies.map((company) => (
                    <CompanyRow
                      key={company.id}
                      company={company}
                      label={getCompanyDisplayName(company)}
                      selected={company.id === selectedCompanyId}
                      isFavorite={favoriteIds.includes(company.id)}
                      onSelect={() => selectCompany(company.id)}
                      onToggleFavorite={(e) => toggleFavorite(e, company.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/muhasebe/islem-hafizasi"
            className="relative rounded-xl border border-slate-700 bg-slate-950/80 p-2.5 text-slate-300 transition hover:border-amber-500/40 hover:text-amber-200"
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
            className="rounded-xl border border-slate-700 bg-slate-950/80 p-2.5 text-slate-300 transition hover:border-blue-500/40 hover:text-blue-200"
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

function CompanyRow({ label, selected, isFavorite, onSelect, onToggleFavorite }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
        selected ? "bg-blue-600/20 text-white" : "text-slate-300 hover:bg-white/5"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        role="button"
        tabIndex={0}
        onClick={onToggleFavorite}
        onKeyDown={(e) => e.key === "Enter" && onToggleFavorite(e)}
        className={`shrink-0 text-base ${isFavorite ? "text-amber-400" : "text-slate-600 hover:text-amber-300"}`}
        title={isFavorite ? "Favoriden çıkar" : "Favoriye ekle"}
      >
        {isFavorite ? "★" : "☆"}
      </span>
    </button>
  );
}
