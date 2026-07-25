"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import BuildVersionBadge from "@/app/components/BuildVersionBadge";
import {
  ANNVERO_NAV_GROUPS,
  ANNVERO_NAV_WARM_LIMIT,
  ANNVERO_NAV_WARM_PRIORITY,
} from "@/src/config/annveroNavConfig";
import { canSeeNavGroup, canSeeNavItem } from "@/src/config/annveroRoles";
import { canAccessCoreTestCenter, isDevelopmentEnvironment } from "@/src/lib/dev/coreTestCenterAccess";
import { useUserRole } from "@/src/hooks/useUserRole";
import {
  findBestActiveGroup,
  isMenuItemActive,
  normalizeMenuPath,
  partitionNavGroupsByActive,
} from "@/src/utils/annveroNavActiveGroup";
import {
  createNavPrefetchController,
  resolveIdlePrefetchOrder,
} from "@/src/utils/annveroNavPrefetch";

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

function MenuIcon({ groupTitle }) {
  const path = ICON_MAP[groupTitle] || "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0";
  return (
    <span className="annvero-sidebar-icon" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d={path} />
      </svg>
    </span>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-3.5 w-3.5 shrink-0 text-[var(--annvero-shell-muted)] opacity-70 transition-transform duration-[var(--annvero-motion-fast)] ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SidebarLabel({ children, className = "" }) {
  return <span className={`annvero-sidebar-label ${className}`.trim()}>{children}</span>;
}

function navLinkClass({ active, pending }) {
  if (active) {
    return "annvero-sidebar-sub--active before:bg-[color-mix(in_srgb,var(--annvero-accent)_50%,transparent)]";
  }
  if (pending) {
    return "bg-[var(--annvero-hover)] font-medium text-[var(--annvero-text)] before:bg-[var(--annvero-accent)] opacity-90";
  }
  return "text-[var(--annvero-shell-muted)] hover:bg-[var(--annvero-hover)] hover:text-[var(--annvero-text)] before:bg-[color-mix(in_srgb,var(--annvero-border)_80%,transparent)]";
}

function NavSubItem({
  group,
  item,
  pathname,
  pendingHref,
  onNavIntent,
  onNavPrime,
  onNavFocus,
}) {
  const itemActive = isMenuItemActive(item.href, pathname);
  const pending = normalizeMenuPath(pendingHref) === normalizeMenuPath(item.href);
  return (
    <Link
      href={item.href}
      prefetch={false}
      onClick={(e) => onNavIntent?.(e, item.href)}
      onPointerDown={() => onNavPrime?.(item.href)}
      onFocus={() => onNavFocus?.(item.href)}
      aria-label={`${group.title}: ${item.label}`}
      aria-current={itemActive ? "page" : undefined}
      className={`group/item relative flex min-h-[40px] items-center justify-between rounded-[var(--annvero-radius-sm)] py-1.5 pl-7 pr-2.5 text-[12px] font-medium transition-colors duration-[var(--annvero-motion-fast)] ${navLinkClass(
        { active: itemActive, pending }
      )} before:absolute before:left-2.5 before:top-1/2 before:h-1 before:w-1 before:-translate-y-1/2 before:rounded-full before:content-['']`}
    >
      <span className="min-w-0 truncate">{item.label}</span>
      {pending && !itemActive ? (
        <span className="ml-2 shrink-0 text-[10px] font-medium text-[var(--annvero-accent)]">
          …
        </span>
      ) : null}
    </Link>
  );
}

// Operasyon Paneli başlığının hemen altında SABİT kalan aktif ana modül
// başlığı. Yalnız başlık pinlenir (alt menüler kaydırılabilir alandadır).
// ÖNEMLİ: Bu bir <Link> DEĞİL, salt bir <button>'dır.
function PinnedActiveHeader({ group, onScrollTop }) {
  return (
    <button
      type="button"
      onClick={onScrollTop}
      data-tip={group.title}
      aria-label={`${group.title} · alt menüleri göster`}
      className="annvero-sidebar-tip annvero-sidebar-item--active group flex min-h-[42px] w-full items-center gap-2.5 rounded-[var(--annvero-radius-md)] px-2 py-2 text-left"
    >
      <MenuIcon groupTitle={group.title} />
      <SidebarLabel className="flex-1 text-[13px] font-semibold tracking-tight text-white">
        {group.title}
      </SidebarLabel>
    </button>
  );
}

function SidebarGroup({
  group,
  open,
  pathname,
  pendingHref,
  showDivider,
  onToggleOnly,
  onNavIntent,
  onNavPrime,
  onNavFocus,
  collapsed,
}) {
  const landingHref = group.href || group.items?.[0]?.href || "";
  const pendingLanding =
    pendingHref &&
    normalizeMenuPath(pendingHref) === normalizeMenuPath(landingHref);

  if (!group.items?.length) {
    const href = group.href || "/dashboard";
    const itemActive = isMenuItemActive(href, pathname);
    const pending = normalizeMenuPath(pendingHref) === normalizeMenuPath(href);
    return (
      <div className={showDivider ? "border-t border-[var(--annvero-shell-separator)] pt-1.5" : ""}>
        <Link
          href={href}
          prefetch={false}
          onClick={(e) => onNavIntent?.(e, href)}
          onPointerDown={() => onNavPrime?.(href)}
          onFocus={() => onNavFocus?.(href)}
          data-tip={group.title}
          aria-label={group.title}
          aria-current={itemActive ? "page" : undefined}
          className={`annvero-sidebar-tip group mb-0.5 flex min-h-[42px] items-center gap-2.5 rounded-[var(--annvero-radius-md)] px-2 py-2 transition-colors duration-[var(--annvero-motion-fast)] ${
            itemActive || pending
              ? "annvero-sidebar-item--active"
              : "text-[var(--annvero-shell-text)] hover:bg-[var(--annvero-hover)] hover:text-[var(--annvero-text)]"
          }`}
        >
          <MenuIcon groupTitle={group.title} />
          <SidebarLabel className="flex-1 text-[13px] font-semibold tracking-tight">
            {group.title}
          </SidebarLabel>
        </Link>
      </div>
    );
  }

  const headerClass = pendingLanding
    ? "bg-[var(--annvero-hover)] text-[var(--annvero-text)] ring-1 ring-[var(--annvero-accent)]/15"
    : "text-[var(--annvero-shell-text)] hover:bg-[var(--annvero-hover)] hover:text-[var(--annvero-text)]";

  return (
    <div
      className={`annvero-sidebar-group ${showDivider ? "border-t border-[var(--annvero-shell-separator)] pt-1.5" : ""}`}
    >
      <div
        className={`annvero-sidebar-group-header group mb-0.5 flex min-h-[42px] w-full items-center gap-0.5 rounded-[var(--annvero-radius-md)] px-0.5 py-0.5 transition-colors duration-[var(--annvero-motion-fast)] ${headerClass}`}
      >
        <Link
          href={landingHref}
          prefetch={false}
          data-tip={group.title}
          aria-label={group.title}
          onClick={(e) => onNavIntent?.(e, landingHref)}
          onPointerDown={() => onNavPrime?.(landingHref)}
          onFocus={() => onNavFocus?.(landingHref)}
          className="annvero-sidebar-tip flex min-h-[40px] min-w-0 flex-1 items-center gap-2.5 rounded-[var(--annvero-radius-sm)] px-1.5 py-1.5"
        >
          <MenuIcon groupTitle={group.title} />
          <SidebarLabel className="flex-1 text-left text-[13px] font-semibold tracking-tight">
            {group.title}
          </SidebarLabel>
        </Link>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleOnly?.(group.title);
          }}
          aria-label={open ? `${group.title} menüsünü kapat` : `${group.title} menüsünü aç`}
          aria-expanded={open}
          className={`rounded-[var(--annvero-radius-sm)] p-1.5 text-[var(--annvero-shell-muted)] hover:bg-[var(--annvero-hover)] ${collapsed ? "pointer-events-none absolute opacity-0" : ""}`}
          tabIndex={collapsed ? -1 : 0}
        >
          <ChevronIcon open={open} />
        </button>
      </div>
      <div className="annvero-nav-panel" data-open={open && !collapsed ? "true" : "false"}>
        <div className="annvero-nav-panel__inner">
          <div className="mb-1.5 space-y-px border-b border-[var(--annvero-shell-separator)] pb-1.5 pl-1.5">
            {group.items.map((item) => (
              <NavSubItem
                key={`${group.title}-${item.label}`}
                group={group}
                item={item}
                pathname={pathname}
                pendingHref={pendingHref}
                onNavIntent={onNavIntent}
                onNavPrime={onNavPrime}
                onNavFocus={onNavFocus}
              />
            ))}
          </div>
        </div>
      </div>
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
  const router = useRouter();
  const { role, isManagementUser, isAdmin, isPartner } = useUserRole();
  const [openMenu, setOpenMenu] = useState("");
  const [autoOpenedGroup, setAutoOpenedGroup] = useState("");
  const [pendingHref, setPendingHref] = useState("");
  const [, startTransition] = useTransition();
  const prefetchRef = useRef(null);
  const navRef = useRef(null);
  const routerRef = useRef(router);

  const isDev = isDevelopmentEnvironment();

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Prefetch controller — yalnız tıklama/pointer intent; hover/idle toplu yükleme yok.
  useEffect(() => {
    if (prefetchRef.current == null) {
      prefetchRef.current = createNavPrefetchController({
        prefetchFn: (href) => routerRef.current?.prefetch(href),
        isDev,
      });
    }
  }, [isDev]);

  const coreTestVisible = canAccessCoreTestCenter({
    isDevelopment: isDev,
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
          if (isDev) return true;
          return canSeeNavItem(role, item);
        }
        return canSeeNavItem(role, item);
      });
      if (!items.length) return null;
      return { ...group, items };
    }).filter(Boolean);
  }, [role, coreTestVisible, isDev]);

  const { activeGroup, otherGroups } = useMemo(
    () => partitionNavGroupsByActive(visibleNavGroups, pathname),
    [visibleNavGroups, pathname]
  );
  const activeGroupTitle = activeGroup?.items?.length ? activeGroup.title : "";
  const activeTitle = activeGroup?.title || "";

  // Aktif route'un grubunu otomatik aç. Effect yerine render sırasında
  // "önceki değeri hatırla" deseni; kullanıcının elle açıp kapatması korunur.
  if (activeTitle && activeTitle !== autoOpenedGroup) {
    setAutoOpenedGroup(activeTitle);
    setOpenMenu(activeGroupTitle);
  }

  if (
    pendingHref &&
    normalizeMenuPath(pathname) === normalizeMenuPath(pendingHref)
  ) {
    setPendingHref("");
  }

  useEffect(() => {
    prefetchRef.current?.setActivePath(pathname);
    prefetchRef.current?.completeNavigation(pathname);
  }, [pathname]);

  useEffect(() => {
    const nav = navRef.current;
    if (nav) nav.scrollTop = 0;
  }, [pathname, activeTitle]);

  // Intent ısıtma: tek route, tek prefetch, dedup (controller.done Set'i).
  // Navigasyon sürerken ve aktif path için ısıtma yapılmaz.
  const warmHref = useCallback(
    (href) => {
      const ctl = prefetchRef.current;
      if (!ctl || !href) return;
      const key = normalizeMenuPath(href);
      if (!key || key === "/") return;
      if (ctl.isNavigationPending) return;
      if (normalizeMenuPath(pathname) === key) return;
      if (ctl.has(href)) return;
      ctl.prioritize(href);
    },
    [pathname]
  );

  // Shell hazır olduktan sonra dashboard + en sık kullanılan ana merkezleri
  // requestIdleCallback ile SIRAYLA ısıt. Yalnız yetkili (visibleNavGroups)
  // hedefler; saveData/yavaş bağlantıda ve navigasyon sırasında durur.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const ctl = prefetchRef.current;
    if (!ctl) return undefined;

    const conn =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection ||
      null;
    if (conn?.saveData) return undefined;
    if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) {
      return undefined;
    }

    const order = resolveIdlePrefetchOrder(
      ANNVERO_NAV_WARM_PRIORITY,
      visibleNavGroups,
      { maxItems: ANNVERO_NAV_WARM_LIMIT, excludePath: pathname }
    );
    if (!order.length) return undefined;

    const ric =
      window.requestIdleCallback ||
      ((cb) => window.setTimeout(() => cb({ timeRemaining: () => 12 }), 240));
    const cic = window.cancelIdleCallback || window.clearTimeout;

    let index = 0;
    let handle = null;
    let cancelled = false;

    const step = () => {
      if (cancelled) return;
      // Kullanıcı navigasyonunda ısıtmayı beklet (aynı anda tek iş).
      if (ctl.isNavigationPending) {
        handle = ric(step);
        return;
      }
      if (index >= order.length) return;
      const href = order[index++];
      if (!ctl.has(href)) ctl.prioritize(href);
      handle = ric(step);
    };

    handle = ric(step);
    return () => {
      cancelled = true;
      if (handle != null) cic(handle);
    };
  }, [visibleNavGroups, pathname]);

  const scrollNavToTop = () => {
    navRef.current?.scrollTo({ top: 0 });
  };

  // Grup açıldığında yalnız o grubun ana/ilk hedefini bir kez ısıt.
  const toggleGroup = useCallback(
    (title) => {
      const willOpen = openMenu !== title;
      setOpenMenu(willOpen ? title : "");
      if (!willOpen) return;
      const group = visibleNavGroups.find((g) => g.title === title);
      warmHref(group?.href || group?.items?.[0]?.href);
    },
    [openMenu, visibleNavGroups, warmHref]
  );

  const onNavPrime = (href) => {
    const target = normalizeMenuPath(href);
    const current = normalizeMenuPath(pathname);
    if (!target || target === current) return;
    setPendingHref(href);
    prefetchRef.current?.beginNavigation(href);
  };

  const onNavIntent = (event, href) => {
    const target = normalizeMenuPath(href);
    const current = normalizeMenuPath(pathname);
    if (current === target) {
      event.preventDefault();
      setPendingHref("");
      prefetchRef.current?.resume();
      onMobileClose?.();
      return;
    }
    setPendingHref(href);
    prefetchRef.current?.beginNavigation(href);
    const best = findBestActiveGroup(visibleNavGroups, href);
    if (best?.items?.length) {
      setOpenMenu(best.title);
    }
    startTransition(() => {
      onMobileClose?.();
    });
  };

  return (
    <aside
      id="annvero-office-sidebar"
      aria-label="Operasyon menüsü"
      className={`annvero-sidebar fixed inset-y-0 left-0 lg:translate-x-0 ${
        collapsed ? "annvero-sidebar--collapsed" : ""
      } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="flex h-full flex-col">
        <div className="annvero-sidebar-brand shrink-0 px-3 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="annvero-sidebar-label text-[10px] font-bold uppercase tracking-[0.32em] text-[var(--annvero-accent)]">
                ANNVERO
              </p>
              <h1 className="annvero-sidebar-label mt-0.5 text-[15px] font-semibold text-[var(--annvero-text)]">
                Operasyon Paneli
              </h1>
            </div>
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--annvero-radius-lg)] bg-[var(--annvero-accent-soft)] text-sm font-black text-[var(--annvero-accent)] ring-1 ring-[var(--annvero-border)]"
              aria-hidden
            >
              A
            </div>
          </div>
        </div>

        {activeGroup ? (
          <div className="shrink-0 border-b border-[var(--annvero-shell-separator)] px-1.5 pt-2.5 pb-1.5">
            <PinnedActiveHeader
              group={activeGroup}
              onScrollTop={scrollNavToTop}
            />
          </div>
        ) : null}

        <nav
          ref={navRef}
          className="annvero-sidebar-scroll sidebar-premium-nav min-h-0 flex-1 overflow-y-auto px-1.5 py-2"
          aria-label="Ana navigasyon"
        >
          <div
            className="annvero-nav-panel"
            data-open={!collapsed && activeGroup?.items?.length ? "true" : "false"}
          >
            <div className="annvero-nav-panel__inner">
              {activeGroup?.items?.length ? (
                <div className="mb-1.5 space-y-px border-b border-[var(--annvero-shell-separator)] pb-1.5 pl-1.5">
                  {activeGroup.items.map((item) => (
                    <NavSubItem
                      key={`${activeGroup.title}-${item.label}`}
                      group={activeGroup}
                      item={item}
                      pathname={pathname}
                      pendingHref={pendingHref}
                      onNavIntent={onNavIntent}
                      onNavPrime={onNavPrime}
                      onNavFocus={warmHref}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {otherGroups.map((group, index) => (
            <SidebarGroup
              key={group.title}
              group={group}
              open={openMenu === group.title}
              pathname={pathname}
              pendingHref={pendingHref}
              showDivider={index > 0}
              collapsed={collapsed}
              onToggleOnly={toggleGroup}
              onNavFocus={warmHref}
              onNavIntent={onNavIntent}
              onNavPrime={onNavPrime}
            />
          ))}
        </nav>

        <div className="shrink-0 border-t border-[var(--annvero-border)] p-1.5 lg:p-3">
          <div className="annvero-sidebar-label mb-2 w-full">
            <BuildVersionBadge />
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            data-tip={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
            aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
            aria-pressed={collapsed}
            className="annvero-sidebar-tip hidden min-h-[40px] w-full items-center justify-center gap-2 rounded-[var(--annvero-radius-md)] border border-[var(--annvero-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--annvero-text-muted)] transition hover:bg-[var(--annvero-hover)] lg:flex"
          >
            <span aria-hidden>{collapsed ? "→" : "←"}</span>
            <SidebarLabel>
              {collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
            </SidebarLabel>
          </button>
        </div>
      </div>
    </aside>
  );
}
