"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import BuildVersionBadge from "@/app/components/BuildVersionBadge";
import { ANNVERO_NAV_GROUPS } from "@/src/config/annveroNavConfig";
import { canSeeNavGroup, canSeeNavItem } from "@/src/config/annveroRoles";
import { canAccessCoreTestCenter, isDevelopmentEnvironment } from "@/src/lib/dev/coreTestCenterAccess";
import { useUserRole } from "@/src/hooks/useUserRole";
import { annveroShellSidebarWidth } from "@/src/styles/annveroDesign";

function normalizeMenuPath(href = "") {
  return href.split("?")[0].replace(/\/$/, "") || "/";
}

function isMenuGroupActive(group, pathname) {
  const current = normalizeMenuPath(pathname);
  if (group.href && normalizeMenuPath(group.href) === current) return true;
  return (group.items || []).some((item) => {
    const target = normalizeMenuPath(item.href);
    return current === target || current.startsWith(`${target}/`);
  });
}

function isMenuItemActive(href, pathname) {
  const current = normalizeMenuPath(pathname);
  const target = normalizeMenuPath(href);
  return current === target || current.startsWith(`${target}/`);
}

const ICON_MAP = {
  Dashboard: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z",
  "Muhasebe Merkezi": "M7 4h10v16H7zM9 8h6M9 12h6M9 16h4",
  "Risk & Denetim Merkezi": "M12 3 4 7v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V7l-8-4Zm0 6 2 2-3 3-2-2 1-1 1 1 2-2Z",
  "E-Defter Merkezi": "M6 4h9l5 5v11H6V4Zm9 0v5h5M8 12h8M8 16h6",
  "Beyanname Merkezi": "M12 3 4 7v2h16V7l-8-4Zm-8 8v6h16v-6H4Zm4 2h2v2H8v-2Zm4 0h4v2h-4v-2Z",
  "İK / Personel Merkezi": "M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 16 0",
  "Ticaret Sicil Merkezi": "M8 4h8v4H8V4Zm-1 6h10v10H7V10Zm2 2v6M11 12v6M15 12v6",
  "AI Ofis Asistanı": "M12 3a7 7 0 0 1 7 7c0 2.8-1.6 5.2-4 6.3V19a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2.7C6.6 15.2 5 12.8 5 10a7 7 0 0 1 7-7Z",
  "Evrak Havuzu": "M7 3h7l5 5v13H7V3Zm7 0v5h5M9 12h6M9 16h4",
  "Otomasyon Merkezi": "M12 2v4m0 12v4M4.9 4.9l2.8 2.8m8.6 8.6 2.8 2.8M2 12h4m12 0h4M4.9 19.1l2.8-2.8m8.6-8.6 2.8-2.8",
  "Finansal Analiz Merkezi": "M4 19V5M4 19h16M8 15l3-4 3 2 4-6",
  "Hesaplama Araçları": "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4h2v2H9V7Zm4 0h2v2h-2V7ZM9 11h2v2H9v-2Zm4 0h2v2h-2v-2ZM9 15h2v2H9v-2Zm4 0h2v2h-2v-2Z",
  "Sistem Yönetimi": "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8.7 4a7.1 7.1 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1L16 2h-4l-.5 2.9a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.1 7.1 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 1.7 1L12 22h4l.5-2.9a7.3 7.3 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7.1 7.1 0 0 0 .1-1Z",
};

function MenuIcon({ title }) {
  const path = ICON_MAP[title] || "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0";
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--annvero-accent-soft)] text-[var(--annvero-accent)] ring-1 ring-[var(--annvero-border)]">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d={path} />
      </svg>
    </span>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-4 w-4 shrink-0 text-[var(--annvero-shell-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SidebarGroup({ group, open, active, pathname, showDivider, onToggle, onNavigate, collapsed }) {
  const headerClass = active
    ? "bg-[var(--annvero-active)] text-[var(--annvero-text)] shadow-sm ring-1 ring-[var(--annvero-accent)]/35"
    : "text-[var(--annvero-shell-text)] hover:bg-[var(--annvero-hover)] hover:text-[var(--annvero-text)]";

  if (!group.items?.length) {
    return (
      <div className={showDivider ? "border-t border-[var(--annvero-shell-separator)] pt-2" : ""}>
        <Link
          href={group.href || "/dashboard"}
          onClick={onNavigate}
          title={group.title}
          className={`group mb-1 flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-all duration-200 ${headerClass}`}
        >
          <MenuIcon title={group.title} />
          {!collapsed ? (
            <span className="flex-1 text-[15px] font-bold tracking-tight">{group.title}</span>
          ) : null}
        </Link>
      </div>
    );
  }

  return (
    <div className={showDivider ? "border-t border-[var(--annvero-shell-separator)] pt-2" : ""}>
      <button
        type="button"
        onClick={onToggle}
        title={group.title}
        className={`group mb-1 flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-all duration-200 ${headerClass}`}
      >
        <MenuIcon title={group.title} />
        {!collapsed ? (
          <>
            <span className="flex-1 text-[15px] font-bold tracking-tight">{group.title}</span>
            <ChevronIcon open={open} />
          </>
        ) : null}
      </button>
      {open && !collapsed ? (
        <div className="mb-2 space-y-0.5 border-b border-[var(--annvero-shell-separator)] pb-2 pl-2">
          {group.items.map((item) => {
            const itemActive = isMenuItemActive(item.href, pathname);
            return (
              <Link
                key={`${group.title}-${item.label}`}
                href={item.href}
                onClick={onNavigate}
                className={`group/item relative flex items-center justify-between rounded-lg py-2 pl-8 pr-3 text-[13px] transition-colors duration-150 ${
                  itemActive
                    ? "bg-[var(--annvero-active)] font-semibold text-[var(--annvero-text)] before:bg-[var(--annvero-accent)]"
                    : "text-[var(--annvero-shell-muted)] hover:bg-[var(--annvero-hover)] hover:text-[var(--annvero-text)] before:bg-[var(--annvero-border)] group-hover/item:before:bg-[var(--annvero-accent)]"
                } before:absolute before:left-3 before:top-1/2 before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-full before:content-['']`}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function AnnveroSidebar({
  mobileOpen = false,
  onMobileClose,
  collapsed = false,
  onToggleCollapse,
}) {
  const pathname = usePathname();
  const { role, isManagementUser, isAdmin, isPartner } = useUserRole();
  const [openMenu, setOpenMenu] = useState("");

  const coreTestVisible = canAccessCoreTestCenter({
    isDevelopment: isDevelopmentEnvironment(),
    isManagementUser,
    isAdmin,
    isPartner,
  });

  const visibleNavGroups = useMemo(() => {
    return ANNVERO_NAV_GROUPS.map((group) => {
      if (!canSeeNavGroup(role, group.title)) return null;
      if (!group.items?.length) return group;
      const items = group.items.filter((item) => {
        if (item.devTool) {
          if (!coreTestVisible) return false;
          if (isDevelopmentEnvironment()) return true;
          return canSeeNavItem(role, item);
        }
        return canSeeNavItem(role, item);
      });
      if (!items.length) return null;
      return { ...group, items };
    }).filter(Boolean);
  }, [role, coreTestVisible]);

  useEffect(() => {
    const activeGroup = visibleNavGroups.find((group) => isMenuGroupActive(group, pathname));
    if (activeGroup?.items?.length) {
      setOpenMenu(activeGroup.title);
    }
  }, [pathname, visibleNavGroups]);

  const width = collapsed ? "72px" : annveroShellSidebarWidth;

  return (
    <aside
      style={{ width }}
      className={`fixed inset-y-0 left-0 z-40 border-r border-[var(--annvero-shell-border)] bg-[var(--annvero-shell)] shadow-xl backdrop-blur-xl transition-all duration-200 lg:translate-x-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-[var(--annvero-border)] bg-[var(--annvero-surface)] px-4 py-5">
          <div className="flex items-center justify-between gap-2">
            {!collapsed ? (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-[var(--annvero-accent)]">
                  ANNVERO
                </p>
                <h1 className="mt-1 text-lg font-bold text-[var(--annvero-text)]">Operasyon Paneli</h1>
              </div>
            ) : (
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--annvero-accent-soft)] text-lg font-black text-[var(--annvero-accent)] ring-1 ring-[var(--annvero-border)]">
                A
              </div>
            )}
            {!collapsed ? (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--annvero-accent-soft)] text-lg font-black text-[var(--annvero-accent)] ring-1 ring-[var(--annvero-border)]">
                A
              </div>
            ) : null}
          </div>
        </div>

        <nav className="sidebar-premium-nav flex-1 overflow-y-auto px-2 py-3">
          {visibleNavGroups.map((group, index) => (
            <SidebarGroup
              key={group.title}
              group={group}
              open={openMenu === group.title}
              active={isMenuGroupActive(group, pathname)}
              pathname={pathname}
              showDivider={index > 0}
              collapsed={collapsed}
              onToggle={() =>
                setOpenMenu((current) => (current === group.title ? "" : group.title))
              }
              onNavigate={() => onMobileClose?.()}
            />
          ))}
        </nav>

        {!collapsed ? (
          <div className="border-t border-[var(--annvero-border)] p-4">
            <BuildVersionBadge className="mb-3" />
            <button
              type="button"
              onClick={onToggleCollapse}
              className="hidden w-full rounded-xl border border-[var(--annvero-border)] px-3 py-2 text-xs font-semibold text-[var(--annvero-text-muted)] transition hover:bg-[var(--annvero-hover)] lg:block"
            >
              Menüyü daralt
            </button>
          </div>
        ) : (
          <div className="border-t border-[var(--annvero-border)] p-2">
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Menüyü genişlet"
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--annvero-border)] text-[var(--annvero-text-muted)] hover:bg-[var(--annvero-hover)]"
            >
              →
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
