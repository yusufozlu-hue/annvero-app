"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { acquireModalLock } from "@/src/utils/modalLock";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const SIDEBAR_ID = "annvero-office-sidebar";
/** AnnveroAppShell içerik sütunu `lg:ml-[sidebar]` ile kayar; altında sidebar overlay'dir. */
const DESKTOP_QUERY = "(min-width: 1024px)";
/** Kapanışta overlay kısa süre tıklama kalkanı olarak kalır; çift tık alttaki Sil/Kaydet'e düşmesin. */
const CLOSE_SHIELD_MS = 220;

const FIELD_POLISH =
  "[&_:is(input:not([type=checkbox]),select)]:h-10 [&_label:has(>input[type=checkbox])]:h-10 [&_:is(input,select,textarea)]:transition-[border-color,box-shadow] [&_:is(input,select,textarea)]:duration-150 [&_:is(input,select,textarea):focus]:border-indigo-400 [&_:is(input,select,textarea):focus]:shadow-[0_0_0_3px_rgba(129,140,248,0.22)]";

function readContentInset() {
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

function BankIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5 12 4l9 5.5M4.5 10v8m5-8v8m5-8v8m5-8v8M3 20h18" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="mt-px h-4 w-4 shrink-0 text-sky-300" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
    </svg>
  );
}

export default function BankAccountEditSheet({
  open,
  title,
  eyebrow,
  description,
  notice,
  saving = false,
  error = "",
  onCancel,
  onSave,
  saveLabel = "Kaydet",
  children,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const bodyRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  const savingRef = useRef(saving);
  const [contentInset, setContentInset] = useState(0);
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
    const update = () => setContentInset(readContentInset());
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
    const releaseLock = acquireModalLock(rootRef.current);

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
      releaseLock();
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
    <div ref={rootRef} className="fixed inset-0 z-[45]" data-testid="bank-account-sheet-root">
      <div
        aria-hidden="true"
        onClick={handleOverlayClick}
        data-testid="bank-account-sheet-overlay"
        className={`absolute inset-0 bg-[var(--annvero-overlay)] backdrop-blur-[2px] transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {open ? (
        <div
          data-testid="bank-account-sheet-frame"
          style={{ left: contentInset }}
          className="pointer-events-none fixed right-0 bottom-0 flex justify-center px-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5"
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            className="pointer-events-auto relative flex max-h-[90dvh] w-full max-w-[940px] flex-col overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-950 text-white shadow-[0_28px_70px_-24px_rgba(0,0,0,0.8),0_0_40px_-18px_rgba(99,102,241,0.45)] outline-none transition-[opacity,translate] duration-200 ease-out starting:translate-y-4 starting:opacity-0 motion-reduce:transition-none sm:max-h-[min(70vh,640px)]"
          >
            <form
              onSubmit={handleSubmit}
              noValidate
              className="flex min-h-0 flex-1 flex-col"
            >
              <header className="relative shrink-0 border-b border-slate-800/80 bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-950 px-4 py-3.5 sm:px-6">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/70 to-transparent"
                />
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30"
                  >
                    <BankIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    {eyebrow ? (
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300/80">
                        {eyebrow}
                      </p>
                    ) : null}
                    <h2 id={titleId} className="truncate text-base font-semibold text-white sm:text-lg">
                      {title}
                    </h2>
                    {description ? (
                      <span
                        id={descriptionId}
                        title={description}
                        className="mt-1.5 inline-flex max-w-full items-center rounded-full border border-slate-700/80 bg-slate-900/80 px-2.5 py-0.5 text-xs text-slate-300"
                      >
                        <span className="truncate">{description}</span>
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onCancelRef.current?.()}
                    disabled={saving}
                    aria-label="Paneli kapat"
                    className="shrink-0 rounded-lg border border-slate-700/80 p-2 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-400"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>
                </div>
              </header>

              <div
                ref={bodyRef}
                data-testid="bank-account-sheet-body"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
              >
                <fieldset disabled={saving} className={`min-w-0 ${FIELD_POLISH}`}>
                  {children}
                </fieldset>
                {notice ? (
                  <div className="mt-5 flex gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.08] px-3.5 py-3 text-xs leading-relaxed text-sky-100/90">
                    <InfoIcon />
                    <p>{notice}</p>
                  </div>
                ) : null}
                {error ? (
                  <p
                    role="alert"
                    className="mt-4 rounded-xl border border-red-500/40 bg-red-950/40 px-3.5 py-2.5 text-sm text-red-200"
                  >
                    {error}
                  </p>
                ) : null}
              </div>

              <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-800 bg-slate-900/95 px-4 py-3 shadow-[0_-10px_24px_-16px_rgba(0,0,0,0.7)] sm:px-6">
                <button
                  type="button"
                  onClick={() => onCancelRef.current?.()}
                  disabled={saving}
                  className="flex-1 rounded-lg border border-slate-600/80 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  aria-busy={saving || undefined}
                  className="flex-1 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-950/50 transition-colors hover:from-indigo-500 hover:to-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
                >
                  {saving ? "Kaydediliyor..." : saveLabel}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </div>,
    document.body
  );
}
