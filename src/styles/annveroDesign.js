/** ANNVERO Design System V1 — reusable class / geometry tokens. */

export const ANNVERO_SIDEBAR_COLLAPSED_KEY = "annvero_sidebar_collapsed_v1";

export const annveroInputClass =
  "annvero-input w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition";

export const annveroCardClass =
  "rounded-2xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] shadow-[var(--annvero-card-shadow)] backdrop-blur-xl";

export const annveroPanelClass =
  "rounded-[28px] border border-[var(--annvero-border)] bg-[var(--annvero-surface)] p-5 shadow-[var(--annvero-card-shadow)] backdrop-blur-xl";

export const annveroBtnPrimary =
  "annvero-btn inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:from-violet-500 hover:to-indigo-500 disabled:bg-[var(--annvero-disabled-bg)] disabled:text-[var(--annvero-disabled-text)] disabled:from-[var(--annvero-disabled-bg)] disabled:to-[var(--annvero-disabled-bg)]";

export const annveroBtnSecondary =
  "annvero-btn inline-flex items-center justify-center rounded-xl border border-[var(--annvero-border)] bg-[var(--annvero-surface-2)] px-4 py-2.5 text-sm font-semibold text-[var(--annvero-text)] transition hover:bg-[var(--annvero-hover)] disabled:bg-[var(--annvero-disabled-bg)] disabled:text-[var(--annvero-disabled-text)]";

export const annveroNavBtn =
  "inline-flex items-center gap-2 rounded-xl border border-[var(--annvero-border)] bg-[var(--annvero-surface-2)] px-4 py-2.5 text-sm font-semibold text-[var(--annvero-text)] transition hover:bg-[var(--annvero-hover)] hover:border-[var(--annvero-accent)]";

export const annveroStatCardClass =
  "min-w-[140px] flex-1 rounded-2xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] p-4 shadow-[var(--annvero-card-shadow)]";

export const annveroPageBg =
  "min-h-screen w-full max-w-full overflow-x-hidden bg-[var(--annvero-bg)] text-[var(--annvero-text)]";

/** Expanded office sidebar width (CSS var: --annvero-sidebar-width). */
export const annveroShellSidebarWidth = "302px";

/** Collapsed office sidebar width (CSS var: --annvero-sidebar-collapsed-width). */
export const annveroShellSidebarCollapsedWidth = "72px";

export const annveroTableScrollWrap =
  "annvero-table-scroll max-w-full min-w-0 overflow-x-auto rounded-xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)]";

export const annveroTableStickyRightTh =
  "sticky right-0 z-20 min-w-[132px] border-l border-[var(--annvero-border)] bg-[var(--annvero-table-header)] shadow-[-8px_0_16px_-8px_rgba(15,23,42,0.12)]";

export const annveroTableStickyRightTd =
  "sticky right-0 z-10 min-w-[132px] border-l border-[var(--annvero-border)] bg-[var(--annvero-surface)] shadow-[-6px_0_14px_-8px_rgba(15,23,42,0.1)]";

export const annveroPreviewRowClass = "annvero-preview-row h-14 max-h-14";

export function readSidebarCollapsedPreference() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ANNVERO_SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsedPreference(collapsed) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ANNVERO_SIDEBAR_COLLAPSED_KEY,
      collapsed ? "1" : "0"
    );
  } catch {
    // ignore quota / private mode
  }
}
