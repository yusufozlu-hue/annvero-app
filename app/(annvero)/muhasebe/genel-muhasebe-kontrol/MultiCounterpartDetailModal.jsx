"use client";

import { useEffect, useId, useRef } from "react";
import MultiCounterpartDetailBody from "./MultiCounterpartDetailBody";

/**
 * Salt okunur “Bileşik fiş ayrıntısı” modalı.
 * Otomatik hesap seçmez; DB yazmaz.
 */
export default function MultiCounterpartDetailModal({
  open,
  onClose,
  group = null,
}) {
  const titleId = useId();
  const closeRef = useRef(null);
  const detail = group?.multiDetail || null;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open || !group) return null;

  const fisNo = detail?.fisNo || group.fisNo || "—";
  const tarih = detail?.tarih || group.tarih || "—";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-3 sm:p-6"
      role="presentation"
      data-testid="multi-counterpart-detail-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="multi-counterpart-detail-modal"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              Bileşik fiş ayrıntısı
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Fiş {fisNo} · {tarih}
              {detail?.lineCount != null ? ` · ${detail.lineCount} satır` : ""}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            data-testid="multi-counterpart-detail-close"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            Kapat
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MultiCounterpartDetailBody group={group} />
        </div>
      </div>
    </div>
  );
}
