"use client";

import { useEffect, useId, useRef, useState } from "react";
import { E_DEFTER_ISSUE_CODE } from "@/src/config/eDefterKontrolDefaults";
import MultiCounterpartDetailBody from "./MultiCounterpartDetailBody";

/**
 * Fiş bazlı sonuç ayrıntısı — ana sonuç + düzeltme + bileşik gövde + ikincil bulgular.
 * Teknik kodlar yalnız açılır teknik bölümde.
 */
export default function VoucherFindingsDetailModal({
  open,
  onClose,
  group = null,
  onOpenCorrectionRecord = null,
}) {
  const titleId = useId();
  const closeRef = useRef(null);
  const [techOpen, setTechOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setTechOpen(false);
      return undefined;
    }
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

  const secondary = Array.isArray(group.secondaryFindings) ? group.secondaryFindings : [];
  const allFindings = Array.isArray(group.findings) ? group.findings : [];
  const correction = group.correctionRecord || null;
  const hasComposite = Boolean(group.multiDetail);
  const multiFindings = allFindings.filter(
    (item) => item.code === E_DEFTER_ISSUE_CODE.MULTI_COUNTERPART
  );
  const compositeGroup = hasComposite
    ? {
        fisNo: group.fisNo,
        tarih: group.tarih,
        multiDetail: group.multiDetail,
        details: multiFindings,
      }
    : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-3 sm:p-6"
      role="presentation"
      data-testid="voucher-findings-detail-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="voucher-findings-detail-modal"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              Fiş ayrıntısı
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Fiş {group.fisNo || "—"} · {group.tarih || "—"}
              {group.findingCount != null ? ` · ${group.findingCount} bulgu` : ""}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            data-testid="voucher-findings-detail-close"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            Kapat
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <section data-testid="voucher-detail-primary">
            <h3 className="mb-2 text-sm font-medium text-slate-800">Ana sonuç</h3>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-slate-900">
                {group.primaryStatus || group.displayTitle || "—"}
              </p>
              <p className="mt-1 text-slate-700">
                {group.primaryMessage || group.displayMessage || "—"}
              </p>
              {group.primaryAccount ? (
                <p className="mt-1 text-slate-600">Hesap: {group.primaryAccount}</p>
              ) : null}
              <p className="mt-1 text-slate-600">
                Seviye: {group.primarySeverity || group.severity || "—"}
              </p>
            </div>
          </section>

          {correction ? (
            <section data-testid="voucher-detail-correction">
              <h3 className="mb-2 text-sm font-medium text-slate-800">Düzeltme kaydı</h3>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-900">
                <p>
                  {group.correctionStatusMessage ||
                    group.primaryFinding?.correctionStatusMessage ||
                    "Düzeltme kaydı mevcut."}
                </p>
                {onOpenCorrectionRecord ? (
                  <button
                    type="button"
                    className="mt-2 text-teal-700 hover:underline"
                    data-testid="voucher-detail-open-correction"
                    onClick={() => onOpenCorrectionRecord(correction)}
                  >
                    Düzeltme kaydını görüntüle
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {hasComposite && compositeGroup ? (
            <section data-testid="voucher-detail-composite">
              <h3 className="mb-2 text-sm font-medium text-slate-800">Bileşik fiş ayrıntısı</h3>
              <MultiCounterpartDetailBody
                group={compositeGroup}
                showIntro
                showTechnicalRows={false}
              />
            </section>
          ) : null}

          <section data-testid="voucher-detail-secondary">
            <h3 className="mb-2 text-sm font-medium text-slate-800">
              Diğer kontroller ({secondary.length})
            </h3>
            {secondary.length === 0 ? (
              <p className="text-sm text-slate-500">İkincil bulgu yok.</p>
            ) : (
              <ul className="space-y-2">
                {secondary.map((item, index) => (
                  <li
                    key={`${item.id || item.code || "s"}|${index}`}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    data-testid="voucher-detail-secondary-item"
                  >
                    <p className="font-medium text-slate-900">
                      {item.displayTitle || item.titleTr || item.code || "Kontrol"}
                    </p>
                    <p className="mt-0.5 text-slate-700">
                      {item.displayMessage || item.messageTr || item.message || "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[item.hesapKodu, item.severity].filter(Boolean).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section data-testid="voucher-detail-technical">
            <button
              type="button"
              className="text-sm text-slate-600 underline hover:text-slate-900"
              aria-expanded={techOpen}
              onClick={() => setTechOpen((value) => !value)}
              data-testid="voucher-detail-technical-toggle"
            >
              {techOpen ? "Teknik ayrıntıları gizle" : "Teknik ayrıntıları göster"}
            </button>
            {techOpen ? (
              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5">Hesap</th>
                      <th className="px-2 py-1.5">Seviye</th>
                      <th className="px-2 py-1.5">Kod</th>
                      <th className="px-2 py-1.5">Mesaj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allFindings.map((row, idx) => (
                      <tr
                        key={`${row.hesapKodu || "x"}|${row.code || "c"}|${idx}`}
                        className="border-t border-slate-200"
                      >
                        <td className="px-2 py-1 font-mono">{row.hesapKodu || "—"}</td>
                        <td className="px-2 py-1">{row.severity || "—"}</td>
                        <td className="px-2 py-1 font-mono">{row.code || "—"}</td>
                        <td className="px-2 py-1 text-slate-700">
                          {row.message || row.messageTr || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
