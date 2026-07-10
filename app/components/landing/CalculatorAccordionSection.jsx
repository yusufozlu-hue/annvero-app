"use client";

import { useEffect, useId, useRef } from "react";

function ChevronIcon({ isOpen }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-5 w-5 shrink-0 text-violet-600 transition-transform duration-200 ${
        isOpen ? "rotate-180" : ""
      }`}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Tek açık sekme accordion paneli.
 * İçerik kapanınca unmount edilmez; son hesap değerleri korunur.
 */
export default function CalculatorAccordionSection({
  id,
  title,
  description,
  isOpen,
  onToggle,
  children,
}) {
  const reactId = useId();
  const panelId = `calculator-panel-${id}-${reactId}`;
  const headerId = `calculator-header-${id}-${reactId}`;
  const articleRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !articleRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      articleRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  return (
    <article
      ref={articleRef}
      className={`rounded-2xl border p-5 shadow-sm transition-colors duration-200 ${
        isOpen
          ? "border-violet-300 bg-violet-50/70"
          : "border-violet-100 bg-white hover:border-violet-200 hover:shadow-md hover:shadow-violet-500/5"
      }`}
    >
      <button
        type="button"
        id={headerId}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex w-full items-start justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2"
      >
        <div>
          <span className="block text-lg font-semibold text-slate-900">{title}</span>
          {description ? (
            <span className="mt-1 block text-sm text-slate-600">{description}</span>
          ) : null}
        </div>
        <ChevronIcon isOpen={isOpen} />
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        aria-hidden={!isOpen}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`border-t border-violet-200/80 pt-4 transition-opacity duration-200 ${
              isOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            {...(!isOpen ? { inert: true } : {})}
          >
            {children}
          </div>
        </div>
      </div>
    </article>
  );
}
