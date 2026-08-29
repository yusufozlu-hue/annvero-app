"use client";

import { useEffect, useId, useRef } from "react";
import { formatTurkishMoney } from "@/src/utils/turkishNumberFormat";

/**
 * Salt okunur “Çoklu karşıt hesap ayrıntısı” modalı.
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
  const lines = Array.isArray(detail?.lines) ? detail.lines : [];
  const candidates = Array.isArray(detail?.candidates) ? detail.candidates : [];
  const reasonTr =
    detail?.reasonTr ||
    "Karşı yönde birden fazla hesap bulunduğu için tek karşıt hesap seçilemedi.";
  const technicalRows = Array.isArray(group.details) ? group.details : [];

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
              Çoklu karşıt hesap ayrıntısı
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {reasonTr}
          </p>

          <section>
            <h3 className="mb-2 text-sm font-medium text-slate-800">Karşıt hesap adayları</h3>
            {candidates.length === 0 ? (
              <p className="text-sm text-slate-500">Aday listesi üretilemedi.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((code) => (
                  <span
                    key={code}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-800"
                  >
                    {code}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {detail?.candidateCount ?? candidates.length} farklı karşı yön hesabı · otomatik
              tek hesap seçilmedi
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-slate-800">Fiş muhasebe satırları</h3>
            <div className="max-h-[48vh] overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Hesap kodu</th>
                    <th className="px-3 py-2">Hesap adı</th>
                    <th className="px-3 py-2">Yön</th>
                    <th className="px-3 py-2 text-right">Borç</th>
                    <th className="px-3 py-2 text-right">Alacak</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={5}>
                        Bu fiş için muhasebe satırı bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    lines.flatMap((line, index) => {
                      const prev = lines[index - 1];
                      const showSideDivider =
                        prev?.yon === "BORÇ" && line.yon === "ALACAK";
                      const rows = [];
                      if (showSideDivider) {
                        rows.push(
                          <tr key={`${line.id}|side-divider`} className="border-t border-slate-200">
                            <td
                              colSpan={5}
                              className="bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500"
                            >
                              Alacak
                            </td>
                          </tr>
                        );
                      }
                      rows.push(
                        <tr
                          key={line.id}
                          className={
                            line.multiAffected
                              ? "border-t border-slate-100 bg-teal-50/40"
                              : "border-t border-slate-100"
                          }
                        >
                          <td className="px-3 py-1.5 font-mono text-xs text-slate-900">
                            {line.hesapKodu || "—"}
                          </td>
                          <td className="px-3 py-1.5 text-slate-700">{line.hesapAdi || "—"}</td>
                          <td className="px-3 py-1.5 text-slate-800">{line.yon || "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                            {formatTurkishMoney(line.borc)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                            {formatTurkishMoney(line.alacak)}
                          </td>
                        </tr>
                      );
                      return rows;
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-slate-800">
              Teknik satır bulguları ({technicalRows.length})
            </h3>
            <div className="max-h-40 overflow-auto rounded-lg border border-slate-200 bg-slate-50">
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
                  {technicalRows.length === 0 ? (
                    <tr>
                      <td className="px-2 py-2 text-slate-500" colSpan={4}>
                        Teknik satır bulgusu yok.
                      </td>
                    </tr>
                  ) : (
                    technicalRows.map((row, idx) => (
                      <tr
                        key={`${row.hesapKodu || "x"}|${row.code || "c"}|${idx}`}
                        className="border-t border-slate-200"
                      >
                        <td className="px-2 py-1 font-mono">{row.hesapKodu || "—"}</td>
                        <td className="px-2 py-1">{row.severity || "—"}</td>
                        <td className="px-2 py-1 font-mono">{row.code || "—"}</td>
                        <td className="px-2 py-1 text-slate-700">
                          {row.displayMessage || row.messageTr || row.message || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
