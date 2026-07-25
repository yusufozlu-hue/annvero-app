"use client";

import { Suspense, useEffect, useState } from "react";
import AnnveroSidebar from "@/src/components/AnnveroSidebar";
import AnnveroTopbar from "@/src/components/AnnveroTopbar";
import { CompanyWorkspaceProvider } from "@/src/contexts/CompanyWorkspaceContext";
import { UserRoleProvider, useUserRole } from "@/src/hooks/useUserRole";
import {
  annveroPageBg,
  readSidebarCollapsedPreference,
  writeSidebarCollapsedPreference,
} from "@/src/styles/annveroDesign";

function ModuleRouteSkeleton() {
  return (
    <section
      data-annvero-module-skeleton
      aria-busy="true"
      aria-label="Modül yükleniyor"
      className="w-full space-y-5"
    >
      <div className="space-y-2">
        <div className="h-7 w-52 rounded-lg bg-[var(--annvero-surface-2)]" />
        <div className="h-4 w-full max-w-xl rounded-md bg-[var(--annvero-surface)]" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="min-h-28 rounded-[var(--annvero-radius-lg)] border border-[var(--annvero-border)] bg-[var(--annvero-surface)] p-4"
          >
            <div className="h-4 w-24 rounded-md bg-[var(--annvero-surface-2)]" />
            <div className="mt-5 h-7 w-16 rounded-md bg-[var(--annvero-surface-2)]" />
          </div>
        ))}
      </div>

      <div className="min-h-64 rounded-[var(--annvero-radius-lg)] border border-[var(--annvero-border)] bg-[var(--annvero-surface)] p-5">
        <div className="h-5 w-40 rounded-md bg-[var(--annvero-surface-2)]" />
        <div className="mt-5 grid gap-3">
          <div className="h-12 rounded-lg bg-[var(--annvero-surface-2)]" />
          <div className="h-12 rounded-lg bg-[var(--annvero-surface-2)]" />
          <div className="h-12 rounded-lg bg-[var(--annvero-surface-2)]" />
        </div>
      </div>
    </section>
  );
}

function AnnveroAppShellInner({ children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { userAccess, loading } = useUserRole();

  useEffect(() => {
    // Client-only preference — SSR ile ilk paint aynı kalsın.
    const timer = window.setTimeout(() => {
      setSidebarCollapsed(readSidebarCollapsedPreference());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Operasyon paneli: tam açık tema hazır olana kadar koyu temayı zorla.
  // Marketing sayfaları (annvero.com) bu layout'u kullanmaz.
  useEffect(() => {
    document.documentElement.dataset.annveroTheme = "dark";
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  const toggleCollapse = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      writeSidebarCollapsedPreference(next);
      return next;
    });
  };

  const mainOffsetClass = sidebarCollapsed
    ? "lg:ml-[var(--annvero-sidebar-collapsed-width)]"
    : "lg:ml-[var(--annvero-sidebar-width)]";
  const showBanner = !loading && userAccess?.showAccessWarning === true;

  return (
    <CompanyWorkspaceProvider>
      <div className={annveroPageBg}>
        <div className="pointer-events-none fixed inset-0 opacity-80 [background:radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--annvero-accent)_18%,transparent),transparent_36%),radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--annvero-accent-2)_12%,transparent),transparent_32%)]" />

        <AnnveroSidebar
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleCollapse}
        />

        {mobileMenuOpen ? (
          <button
            type="button"
            aria-label="Menüyü kapat"
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 z-[var(--annvero-z-overlay)] lg:hidden"
            style={{ background: "var(--annvero-overlay)" }}
          />
        ) : null}

        <div
          className={`relative flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-[var(--annvero-bg)] transition-[margin] duration-[var(--annvero-motion-menu)] ease-[var(--annvero-motion-ease)] ${mainOffsetClass}`}
        >
          <AnnveroTopbar
            onMenuToggle={() => setMobileMenuOpen((v) => !v)}
            menuOpen={mobileMenuOpen}
            sidebarCollapsed={sidebarCollapsed}
          />

          {showBanner ? (
            <div className="mx-4 mt-3 rounded-xl border border-cyan-700/40 bg-cyan-950/30 px-4 py-2 text-xs text-cyan-100 sm:mx-6 lg:mx-8">
              Hesabınıza henüz rol veya firma erişimi atanmadı. Yöneticinizden
              yetki tanımı isteyin.
            </div>
          ) : null}

          <main className="flex w-full min-w-0 max-w-full flex-1 flex-col overflow-x-hidden bg-[var(--annvero-bg)] px-4 pb-8 pt-4 sm:px-6 lg:px-8">
            <Suspense fallback={<ModuleRouteSkeleton />}>{children}</Suspense>
          </main>
        </div>
      </div>
    </CompanyWorkspaceProvider>
  );
}

export default function AnnveroAppShell({ children }) {
  return (
    <UserRoleProvider>
      <AnnveroAppShellInner>{children}</AnnveroAppShellInner>
    </UserRoleProvider>
  );
}
