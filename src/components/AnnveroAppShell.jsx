"use client";

import { useState } from "react";
import AnnveroSidebar from "@/src/components/AnnveroSidebar";
import AnnveroTopbar from "@/src/components/AnnveroTopbar";
import { annveroPageBg } from "@/src/styles/annveroDesign";

export default function AnnveroAppShell({ children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const mainOffsetClass = sidebarCollapsed ? "lg:ml-[72px]" : "lg:ml-[302px]";

  return (
    <div className={annveroPageBg}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_36%),radial-gradient(circle_at_top_right,rgba(124,58,237,0.1),transparent_32%)]" />

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
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      ) : null}

      <div className={`relative flex min-h-screen flex-col transition-[margin] duration-200 ${mainOffsetClass}`}>
        <AnnveroTopbar onMenuToggle={() => setMobileMenuOpen((v) => !v)} sidebarCollapsed={sidebarCollapsed} />
        <main className="flex-1 px-4 pb-8 pt-4 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
