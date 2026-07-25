"use client";

import { useState } from "react";
import AnnveroSidebar from "@/src/components/AnnveroSidebar";
import AnnveroTopbar from "@/src/components/AnnveroTopbar";
import { CompanyWorkspaceProvider } from "@/src/contexts/CompanyWorkspaceContext";
import { UserRoleProvider, useUserRole } from "@/src/hooks/useUserRole";
import { annveroPageBg } from "@/src/styles/annveroDesign";

function AnnveroAppShellInner({ children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { userAccess, loading } = useUserRole();

  const mainOffsetClass = sidebarCollapsed ? "lg:ml-[72px]" : "lg:ml-[302px]";
  const showBanner = !loading && userAccess?.showAccessWarning === true;

  return (
    <CompanyWorkspaceProvider>
      <div className={annveroPageBg}>
        <div className="pointer-events-none fixed inset-0 opacity-80 [background:radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--annvero-accent)_18%,transparent),transparent_36%),radial-gradient(circle_at_top_right,color-mix(in_srgb,cyan_12%,transparent),transparent_32%)]" />

        <AnnveroSidebar
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />

        {mobileMenuOpen ? (
          <button
            type="button"
            aria-label="Menüyü kapat"
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 z-30 lg:hidden"
            style={{ background: "var(--annvero-overlay)" }}
          />
        ) : null}

        <div
          className={`relative flex min-h-screen min-w-0 flex-col overflow-x-hidden transition-[margin] duration-200 ${mainOffsetClass}`}
        >
          <AnnveroTopbar
            onMenuToggle={() => setMobileMenuOpen((v) => !v)}
            sidebarCollapsed={sidebarCollapsed}
          />

          {showBanner ? (
            <div className="mx-4 mt-3 rounded-xl border border-cyan-700/40 bg-cyan-950/30 px-4 py-2 text-xs text-cyan-100 sm:mx-6 lg:mx-8">
              Hesabınıza henüz rol veya firma erişimi atanmadı. Yöneticinizden
              yetki tanımı isteyin.
            </div>
          ) : null}

          <main className="flex w-full min-w-0 max-w-full flex-1 flex-col overflow-x-hidden px-4 pb-8 pt-4 sm:px-6 lg:px-8">
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
