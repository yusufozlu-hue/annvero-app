"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const SIDEBAR_ID = "annvero-office-sidebar";
const DESKTOP_QUERY = "(min-width: 1024px)";
/** Kapanışta overlay kısa süre tıklama kalkanı olarak kalır; çift tık alttaki Sil/Kaydet'e düşmesin. */
const CLOSE_SHIELD_MS = 220;

function readSidebarInset() {
  if (typeof window === "undefined") return 0;
  if (!window.matchMedia(DESKTOP_QUERY).matches) return 0;
  const sidebar = document.getElementById(SIDEBAR_ID);
  if (!sidebar) return 0;
  const rect = sidebar.getBoundingClientRect();
  return rect.width > 0 ? Math.max(0, Math.round(rect.right)) : 0;
}

function getFocusable(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (node) => node.getClientRects().length > 0
  );
}

export default function BankAccountEditSheet({
  open,
  title,
  description,
  saving = false,
  error = "",
  onCancel,
  onSave,
  saveLabel = "Kaydet",
  children,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const bodyRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  const savingRef = useRef(saving);
  const [sidebarInset, setSidebarInset] = useState(0);
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    setClosing(!open);
  }

  useEffect(() => {
    onCancelRef.current = onCancel;
    savingRef.current = saving;
  }, [onCancel, saving]);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => setClosing(false), CLOSE_SHIELD_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    if (!open) return undefined;
    const update = () => setSidebarInset(readSidebarInset());
    const sidebar = document.getElementById(SIDEBAR_ID);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer) observer.observe(sidebar || document.documentElement);
    else window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    const frame = window.requestAnimationFrame(() => {
      const [first] = getFocusable(bodyRef.current);
      (first || panelRef.current)?.focus({ preventScroll: true });
    });

    const onKeyDown = (event) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!savingRef.current) onCancelRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = getFocusable(panel);
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const outside = !panel.contains(active);
      if (event.shiftKey && (active === first || active === panel || outside)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const onFocusIn = (event) => {
      const panel = panelRef.current;
      if (!panel || panel.contains(event.target)) return;
      const [first] = getFocusable(panel);
      (first || panel).focus({ preventScroll: true });
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (typeof document === "undefined" || (!open && !closing)) return null;

  const handleOverlayClick = () => {
    if (!open || savingRef.current) return;
    onCancelRef.current?.();
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    onSave?.();
  };

  return createPortal(
    <div className="fixed inset-0 z-[45]" data-testid="bank-account-sheet-root">
      <div
        aria-hidden="true"
        onClick={handleOverlayClick}
        data-testid="bank-account-sheet-overlay"
        className={`absolute inset-0 bg-[var(--annvero-overlay)] backdrop-blur-[1px] transition-opacity duration-200 motion-reduce:transition-none ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          style={{ left: sidebarInset }}
          className="fixed bottom-0 right-0 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-slate-700/80 bg-slate-950 text-white shadow-[0_-18px_40px_-16px_rgba(0,0,0,0.55)] outline-none sm:max-h-[min(70vh,640px)]"
        >
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex min-h-0 flex-1 flex-col"
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-base font-semibold">
                  {title}
                </h2>
                {description ? (
                  <p
                    id={descriptionId}
                    className="mt-0.5 truncate text-xs text-slate-400"
                    title={description}
                  >
                    {description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onCancelRef.current?.()}
                disabled={saving}
                aria-label="Paneli kapat"
                className="shrink-0 rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-400"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </header>

            <div
              ref={bodyRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
            >
              <fieldset disabled={saving} className="min-w-0">
                {children}
              </fieldset>
              {error ? (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200"
                >
                  {error}
                </p>
              ) : null}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-800 bg-slate-900 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
              <button
                type="button"
                onClick={() => onCancelRef.current?.()}
                disabled={saving}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={saving}
                aria-busy={saving || undefined}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Kaydediliyor..." : saveLabel}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>,
    document.body
  );
}
