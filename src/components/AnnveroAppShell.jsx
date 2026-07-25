"use client";

import { useEffect, useState } from "react";
import AnnveroSidebar from "@/src/components/AnnveroSidebar";
import AnnveroTopbar from "@/src/components/AnnveroTopbar";
import { CompanyWorkspaceProvider } from "@/src/contexts/CompanyWorkspaceContext";
import { UserRoleProvider, useUserRole } from "@/src/hooks/useUserRole";
import {
  annveroPageBg,
  readSidebarCollapsedPreference,
  writeSidebarCollapsedPreference,
} from "@/src/styles/annveroDesign";

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
          className={`annvero-shell-main relative flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-[var(--annvero-bg)] transition-[margin] duration-[var(--annvero-motion-menu)] ease-[var(--annvero-motion-ease)] ${mainOffsetClass}`}
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

          <main className="relative isolate flex w-full min-w-0 max-w-full flex-1 flex-col overflow-x-hidden bg-[var(--annvero-bg)] px-4 pb-8 pt-4 sm:px-6 lg:px-8">
            {children}
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
