"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AnnveroDateInput from "@/src/components/AnnveroDateInput";
import { formatTurkishMoney } from "@/src/utils/turkishNumberFormat";
import { formatDateTR } from "@/src/utils/formatDateTR";
import {
  buildStaleCorrectionRecordNotice,
  isCorrectionRecordNotFoundError,
} from "@/src/utils/correctionRecords";

export default function CorrectionAppliedModal({
  open,
  onClose,
  record,
  companyAccountingRules = {},
  onApplied,
  onStaleRecord,
}) {
  const [externalVoucherNo, setExternalVoucherNo] = useState("");
  const [externalVoucherDate, setExternalVoucherDate] = useState("");
  const [closedPeriodInput, setClosedPeriodInput] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  useEffect(() => {
    if (!open || !record) return;
    setExternalVoucherNo("");
    setExternalVoucherDate(record.correctionDate || "");
    setClosedPeriodInput("");
    setConfirmed(false);
    setBusy(false);
    setError("");
    setWarning("");
  }, [open, record?.id]);

  const correctionDateTr = useMemo(
    () => formatDateTR(record?.correctionDate || ""),
    [record?.correctionDate]
  );

  const dateDiffers = useMemo(() => {
    if (!record?.correctionDate || !externalVoucherDate) return false;
    return externalVoucherDate !== record.correctionDate;
  }, [record?.correctionDate, externalVoucherDate]);

  const lastClosedPeriod =
    companyAccountingRules.lastClosedEdefterPeriod || closedPeriodInput;

  const handleSubmit = useCallback(async () => {
    setError("");
    setWarning("");
    if (!record?.id) {
      onStaleRecord?.(buildStaleCorrectionRecordNotice());
      onClose?.();
      return;
    }
    if (!confirmed) {
      setError("Luca fişi onay kutusunu işaretleyin.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/accounting-correction-records/${record.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: record.companyId,
          externalVoucherNo,
          externalVoucherDate,
          userConfirmed: true,
          lastClosedLedgerPeriod: lastClosedPeriod,
          lastClosedReliability: companyAccountingRules.lastClosedEdefterPeriod
            ? "COMPANY_PROFILE"
            : closedPeriodInput
              ? "USER_CONFIRMED"
              : null,
        }),
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (isCorrectionRecordNotFoundError(payload, response.ok)) {
        onStaleRecord?.(buildStaleCorrectionRecordNotice());
        onClose?.();
        return;
      }
      if (!response.ok) {
        setError(payload.error || "Uygulama kaydedilemedi.");
        return;
      }
      if (payload.warnings?.length) {
        setWarning(payload.warnings[0]?.message || "");
      }
      onApplied?.(payload.record);
      onClose?.();
    } catch {
      setError("Bağlantı hatası. Tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }, [
    record,
    confirmed,
    externalVoucherNo,
    externalVoucherDate,
    lastClosedPeriod,
    companyAccountingRules,
    closedPeriodInput,
    onApplied,
    onClose,
    onStaleRecord,
  ]);

  if (!open || !record) return null;

  const isApplied = record.status === "APPLIED";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correction-applied-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 id="correction-applied-title" className="text-lg font-semibold text-slate-900">
            {isApplied ? "Düzeltme kaydı" : "Luca'da işlendi olarak işaretle"}
          </h2>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="font-medium text-slate-900">Kaynak fiş (salt okunur)</div>
            <dl className="mt-2 grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Fiş</dt>
                <dd>{record.sourceVoucherNo || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Tarih</dt>
                <dd>{formatDateTR(record.sourceVoucherDate) || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Belge</dt>
                <dd>{record.sourceDocumentNo || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Hatalı hesap</dt>
                <dd>{record.wrongAccountCode || "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="font-medium text-slate-900">Düzeltme (salt okunur)</div>
            <dl className="mt-2 grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Hesap</dt>
                <dd>
                  {record.correctionAccountCode}
                  {record.correctionAccountName ? ` — ${record.correctionAccountName}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Tutar</dt>
                <dd>{formatTurkishMoney(record.correctionDebit)} TL</dd>
              </div>
              <div>
                <dt className="text-slate-500">Düzeltme tarihi</dt>
                <dd>{correctionDateTr || "—"}</dd>
              </div>
            </dl>
          </div>

          {!companyAccountingRules.lastClosedEdefterPeriod ? (
            <label className="block">
              <span className="mb-1 block font-medium text-slate-800">
                Son kapalı e-Defter dönemi (YYYY/AA)
              </span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                value={closedPeriodInput}
                onChange={(e) => setClosedPeriodInput(e.target.value)}
                placeholder="2026/03"
              />
            </label>
          ) : null}

          {isApplied ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
              Luca fişi {record.externalVoucherNo || "—"} ·{" "}
              {formatDateTR(record.externalVoucherDate || record.correctionDate)}
            </div>
          ) : null}

          {!isApplied ? (
            <>
              <label className="block">
                <span className="mb-1 block font-medium text-slate-800">Luca fiş no</span>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  value={externalVoucherNo}
                  onChange={(e) => setExternalVoucherNo(e.target.value)}
                  placeholder="00121"
                />
              </label>

              <label className="block">
                <span className="mb-1 block font-medium text-slate-800">Luca fiş tarihi</span>
                <AnnveroDateInput
                  value={externalVoucherDate}
                  onChange={setExternalVoucherDate}
                  aria-label="Luca fiş tarihi"
                />
                {dateDiffers ? (
                  <span className="mt-1 block text-xs text-amber-700">
                    Luca fiş tarihi düzeltme tarihinden farklı; açık dönemde olmalıdır.
                  </span>
                ) : null}
              </label>

              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  Luca&apos;daki fişi kontrol ettim ve bu düzeltmeyle eşleştiriyorum.
                </span>
              </label>
            </>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
              {error}
            </div>
          ) : null}
          {warning ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              {warning}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm"
            onClick={onClose}
            disabled={busy}
          >
            {isApplied ? "Kapat" : "Vazgeç"}
          </button>
          {!isApplied ? (
            <button
              type="button"
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              onClick={handleSubmit}
              disabled={busy || !confirmed}
            >
              {busy ? "Kaydediliyor…" : "Uygulandı olarak kaydet"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
