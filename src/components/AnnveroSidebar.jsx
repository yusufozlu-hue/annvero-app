"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import BuildVersionBadge from "@/app/components/BuildVersionBadge";
import {
  ANNVERO_NAV_GROUPS,
  ANNVERO_NAV_IDLE_PREFETCH_PRIORITY,
} from "@/src/config/annveroNavConfig";
import { canSeeNavGroup, canSeeNavItem } from "@/src/config/annveroRoles";
import { canAccessCoreTestCenter, isDevelopmentEnvironment } from "@/src/lib/dev/coreTestCenterAccess";
import { useUserRole } from "@/src/hooks/useUserRole";
import { annveroShellSidebarWidth } from "@/src/styles/annveroDesign";
import {
  findBestActiveGroup,
  isMenuItemActive,
  normalizeMenuPath,
  partitionNavGroupsByActive,
} from "@/src/utils/annveroNavActiveGroup";
import {
  createNavPrefetchController,
  listNavHrefs,
  resolveIdlePrefetchOrder,
  DEV_IDLE_PREFETCH_LIMIT,
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

function groupHrefs(group) {
  return listNavHrefs(group ? [group] : []);
}

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

function navLinkClass({ active, pending }) {
  if (active) {
    return "bg-[var(--annvero-active)] font-semibold text-[var(--annvero-text)] before:bg-[var(--annvero-accent)]";
  }
  if (pending) {
    return "bg-[var(--annvero-hover)] font-medium text-[var(--annvero-text)] before:bg-[var(--annvero-accent)] opacity-90";
  }
  return "text-[var(--annvero-shell-muted)] hover:bg-[var(--annvero-hover)] hover:text-[var(--annvero-text)] before:bg-[var(--annvero-border)] group-hover/item:before:bg-[var(--annvero-accent)]";
}

function NavSubItem({
  group,
  item,
  pathname,
  pendingHref,
  onNavIntent,
  onWarmHref,
  onNavPrime,
}) {
  const itemActive = isMenuItemActive(item.href, pathname);
  const pending = normalizeMenuPath(pendingHref) === normalizeMenuPath(item.href);
  return (
    <Link
      href={item.href}
      prefetch={true}
      onClick={(e) => onNavIntent?.(e, item.href)}
      onPointerDown={() => onNavPrime?.(item.href)}
      onMouseEnter={() => onWarmHref?.(item.href)}
      onFocus={() => onWarmHref?.(item.href)}
      title={`${group.title} · ${item.label}`}
      className={`group/item relative flex items-center justify-between rounded-lg py-2 pl-8 pr-3 text-[13px] transition-colors duration-100 ${navLinkClass(
        { active: itemActive, pending }
      )} before:absolute before:left-3 before:top-1/2 before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-full before:content-['']`}
    >
      <span>{item.label}</span>
      {pending && !itemActive ? (
        <span className="text-[10px] font-medium text-[var(--annvero-accent)]">
          …
        </span>
      ) : null}
    </Link>
  );
}

// Operasyon Paneli başlığının hemen altında SABİT kalan aktif ana modül
// başlığı. Yalnız başlık pinlenir (alt menüler kaydırılabilir alandadır).
// ÖNEMLİ: Bu bir <Link> DEĞİL, salt bir <button>'dır. Aynı (aktif) route'a
// tekrar navigasyon/prefetch yapmaz; yalnızca kaydırılabilir nav alanını
// en üste döndürür (onScrollTop). Böylece self-referential prefetch/navigation
// döngüsü (sürekli yükleniyor) oluşmaz.
function PinnedActiveHeader({ group, collapsed, onScrollTop }) {
  return (
    <button
      type="button"
      onClick={onScrollTop}
      title={group.title}
      aria-label={`${group.title} · alt menüleri göster`}
      className="group flex w-full items-center gap-3 rounded-xl bg-[var(--annvero-active)] px-2.5 py-2.5 text-left text-[var(--annvero-text)] shadow-sm ring-1 ring-[var(--annvero-accent)]/35"
    >
      <MenuIcon title={group.title} />
      {!collapsed ? (
        <span className="flex-1 text-[15px] font-bold tracking-tight">
          {group.title}
        </span>
      ) : null}
    </button>
  );
}

function SidebarGroup({
  group,
  open,
  active,
  pathname,
  pendingHref,
  showDivider,
  onToggleOnly,
  onNavIntent,
  onWarmGroup,
  onWarmHref,
  onNavPrime,
  collapsed,
}) {
  const headerClass = active
    ? "bg-[var(--annvero-active)] text-[var(--annvero-text)] shadow-sm ring-1 ring-[var(--annvero-accent)]/35"
    : pendingHref &&
        normalizeMenuPath(pendingHref) ===
          normalizeMenuPath(group.href || group.items?.[0]?.href || "")
      ? "bg-[var(--annvero-hover)] text-[var(--annvero-text)] ring-1 ring-[var(--annvero-accent)]/20"
      : "text-[var(--annvero-shell-text)] hover:bg-[var(--annvero-hover)] hover:text-[var(--annvero-text)]";

  const landingHref = group.href || group.items?.[0]?.href || "";

  if (!group.items?.length) {
    const href = group.href || "/dashboard";
    const itemActive = isMenuItemActive(href, pathname);
    const pending = normalizeMenuPath(pendingHref) === normalizeMenuPath(href);
    return (
      <div className={showDivider ? "border-t border-[var(--annvero-shell-separator)] pt-2" : ""}>
        <Link
          href={href}
          prefetch={true}
          onClick={(e) => onNavIntent?.(e, href)}
          onPointerDown={() => onNavPrime?.(href)}
          onMouseEnter={() => onWarmHref?.(href)}
          onFocus={() => onWarmHref?.(href)}
          title={group.title}
          className={`group mb-1 flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors duration-150 ${
            itemActive || pending
              ? "bg-[var(--annvero-active)] text-[var(--annvero-text)] shadow-sm ring-1 ring-[var(--annvero-accent)]/35"
              : "text-[var(--annvero-shell-text)] hover:bg-[var(--annvero-hover)] hover:text-[var(--annvero-text)]"
          }`}
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
    <div
      className={showDivider ? "border-t border-[var(--annvero-shell-separator)] pt-2" : ""}
      onMouseEnter={() => onWarmGroup?.(group)}
      onFocusCapture={() => onWarmGroup?.(group)}
    >
      <div
        className={`group mb-1 flex w-full items-center gap-1 rounded-xl px-1 py-1 transition-colors duration-150 ${headerClass}`}
      >
        <Link
          href={landingHref}
          prefetch={true}
          title={group.title}
          onClick={(e) => onNavIntent?.(e, landingHref)}
          onPointerDown={() => onNavPrime?.(landingHref)}
          onMouseEnter={() => onWarmGroup?.(group)}
          onFocus={() => onWarmGroup?.(group)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1.5"
        >
          <MenuIcon title={group.title} />
          {!collapsed ? (
            <span className="flex-1 text-left text-[15px] font-bold tracking-tight">
              {group.title}
            </span>
          ) : null}
        </Link>
        {!collapsed ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onWarmGroup?.(group);
              onToggleOnly?.(group.title);
            }}
            aria-label={open ? `${group.title} menüsünü kapat` : `${group.title} menüsünü aç`}
            aria-expanded={open}
            className="rounded-lg p-2 text-[var(--annvero-shell-muted)] hover:bg-[var(--annvero-hover)]"
          >
            <ChevronIcon open={open} />
          </button>
        ) : null}
      </div>
      {open && !collapsed ? (
        <div className="mb-2 space-y-0.5 border-b border-[var(--annvero-shell-separator)] pb-2 pl-2">
          {group.items.map((item) => (
            <NavSubItem
              key={`${group.title}-${item.label}`}
              group={group}
              item={item}
              pathname={pathname}
              pendingHref={pendingHref}
              onNavIntent={onNavIntent}
              onWarmHref={onWarmHref}
              onNavPrime={onNavPrime}
            />
          ))}
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

  // Router referansını render sırasında ref'e yazmadan güncel tut.
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Prefetch controller'ı istemcide bir kez, render dışında (effect içinde) oluştur.
  // Bağımlı effect'lerden önce tanımlandığı için ilk commit'te önce çalışır.
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

  // Aktif ana grubu (üstte sabit) diğer gruplardan (kaydırılabilir) ayır.
  const { activeGroup, otherGroups } = useMemo(
    () => partitionNavGroupsByActive(visibleNavGroups, pathname),
    [visibleNavGroups, pathname]
  );
  // Alt menülü grubun otomatik açılması / başlık vurgusu için (yalnız items'lı gruplar).
  const activeGroupTitle = activeGroup?.items?.length ? activeGroup.title : "";
  // Aktif ana grup (alt menülü veya menüsüz) — üstte sabit alana pinlenir.
  const activeTitle = activeGroup?.title || "";

  // Aktif route'un grubunu otomatik aç. Effect yerine render sırasında
  // "önceki değeri hatırla" desenini kullanır; böylece set-state-in-effect
  // oluşmaz ve grup yalnızca aktif grup değiştiğinde bir kez açılır
  // (kullanıcının elle açıp kapatması korunur).
  if (activeTitle && activeTitle !== autoOpenedGroup) {
    setAutoOpenedGroup(activeTitle);
    // Alt menülü aktif grup açılır; alt menüsüz grupta (activeGroupTitle === "")
    // tüm gruplar kapanır (yalnız aktif grup açık kalsın).
    setOpenMenu(activeGroupTitle);
  }

  // Hedefe ulaşıldığında bekleyen (pending) durumu render sırasında temizle;
  // completeNavigation gibi harici yan etki effect içinde kalır.
  if (
    pendingHref &&
    normalizeMenuPath(pathname) === normalizeMenuPath(pendingHref)
  ) {
    setPendingHref("");
  }

  useEffect(() => {
    prefetchRef.current?.setActivePath(pathname);
    // Controller içindeki navigation-pending durumunu senkronla. completeNavigation
    // kendi içinde navigationPending + hedef eşleşmesini kontrol eder (güvenli/no-op).
    prefetchRef.current?.completeNavigation(pathname);
  }, [pathname]);

  // Route (veya aktif grup) değişince kaydırılabilir nav alanını YALNIZCA bir
  // kez en üste getir; böylece aktif modülün alt menüleri görünür olur.
  // Yalnız sidebar nav kaydırılır; ana sayfanın scroll'una dokunulmaz.
  useEffect(() => {
    const nav = navRef.current;
    if (nav) nav.scrollTop = 0;
  }, [pathname, activeTitle]);

  // Açık grup ısıt — navigasyon sırasında yasak
  useEffect(() => {
    if (prefetchRef.current?.isNavigationPending) return;
    const group = visibleNavGroups.find((g) => g.title === openMenu);
    if (!group) return;
    prefetchRef.current?.enqueueMany(groupHrefs(group), { front: true });
  }, [openMenu, visibleNavGroups]);

  // Idle: dev'de en fazla 2–3 öncelikli route; prod'da config listesi
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      if (prefetchRef.current?.isNavigationPending) return;
      const ordered = resolveIdlePrefetchOrder(
        ANNVERO_NAV_IDLE_PREFETCH_PRIORITY,
        visibleNavGroups,
        {
          maxItems: isDev ? DEV_IDLE_PREFETCH_LIMIT : Number.POSITIVE_INFINITY,
          excludePath: pathname,
        }
      );
      prefetchRef.current?.enqueueMany(ordered, { front: false });
    };
    const idleId =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? window.requestIdleCallback(run, { timeout: 2800 })
        : window.setTimeout(run, 700);
    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [visibleNavGroups, pathname, isDev]);

  // Sabit aktif başlığa tıklanınca YALNIZCA kaydırılabilir nav alanını en üste
  // getir; böylece aktif modülün alt menüleri tekrar görünür. Navigasyon yok,
  // ana sayfa etkilenmez.
  const scrollNavToTop = () => {
    navRef.current?.scrollTo({ top: 0 });
  };

  const onWarmHref = (href) => {
    if (prefetchRef.current?.isNavigationPending) return;
    prefetchRef.current?.enqueue(href, { front: true });
  };

  const onWarmGroup = (group) => {
    if (prefetchRef.current?.isNavigationPending) return;
    prefetchRef.current?.enqueueMany(groupHrefs(group), { front: true });
  };

  const onNavPrime = (href) => {
    const target = normalizeMenuPath(href);
    const current = normalizeMenuPath(pathname);
    if (!target || target === current) return;
    // pointerDown: idle kuyruğu hemen durdur, hedefe öncelik ver
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
    // Click: pending + pause (pointerDown kaçarsa da güvence)
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

        {/* Yalnız aktif ana modül BAŞLIĞI sabit; alt menüler kaydırılabilir
            alandadır. Ölçeklenebilir: alt menü sayısı artsa da sabit alan
            büyümez. Scroll edilse bile başlık kaybolmaz. */}
        {activeGroup ? (
          <div className="shrink-0 border-b border-[var(--annvero-shell-separator)] px-2 pt-3 pb-2">
            <PinnedActiveHeader
              group={activeGroup}
              collapsed={collapsed}
              onScrollTop={scrollNavToTop}
            />
          </div>
        ) : null}

        {/* Tek kaydırma alanı: önce aktif modülün alt menüleri, ardından
            ayırıcı ve diğer ana modüller. Aktif modül burada tekrar
            gösterilmez; diğerleri orijinal göreli sıralarını korur. */}
        <nav ref={navRef} className="sidebar-premium-nav min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {!collapsed && activeGroup?.items?.length ? (
            <div className="mb-2 space-y-0.5 border-b border-[var(--annvero-shell-separator)] pb-2 pl-2">
              {activeGroup.items.map((item) => (
                <NavSubItem
                  key={`${activeGroup.title}-${item.label}`}
                  group={activeGroup}
                  item={item}
                  pathname={pathname}
                  pendingHref={pendingHref}
                  onNavIntent={onNavIntent}
                  onWarmHref={onWarmHref}
                  onNavPrime={onNavPrime}
                />
              ))}
            </div>
          ) : null}
          {otherGroups.map((group, index) => (
            <SidebarGroup
              key={group.title}
              group={group}
              open={openMenu === group.title}
              active={activeGroupTitle === group.title}
              pathname={pathname}
              pendingHref={pendingHref}
              showDivider={index > 0}
              collapsed={collapsed}
              onToggleOnly={(title) =>
                setOpenMenu((current) => (current === title ? "" : title))
              }
              onNavIntent={onNavIntent}
              onWarmGroup={onWarmGroup}
              onWarmHref={onWarmHref}
              onNavPrime={onNavPrime}
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
