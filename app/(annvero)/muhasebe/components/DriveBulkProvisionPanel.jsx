"use client";

import { useMemo, useState } from "react";

const STATUS_CLASS = {
  Hazır: "text-emerald-300",
  Oluşturulacak: "text-sky-300",
  Oluşturuldu: "text-emerald-300",
  "Pasif Atlandı": "text-slate-400",
  "Aynı unvanlı mükerrer kayıt — inceleme bekliyor": "text-amber-300",
  Hata: "text-rose-300",
};

function flattenRows(payload) {
  if (!payload) return [];
  const buckets = [
    ...(payload.alreadyReady || []),
    ...(payload.willCreate || []),
    ...(payload.duplicateSkipped || []),
    ...(payload.inactiveSkipped || []),
    ...(payload.failed || []),
    ...(payload.results || []),
  ];
  const byId = new Map();
  for (const row of buckets) {
    if (!row?.companyId) continue;
    byId.set(String(row.companyId), row);
  }
  return Array.from(byId.values());
}

function provisionSummaryCounts(payload) {
  const summary = payload?.summary || {};
  const dryRun = Boolean(payload?.dryRun);
  return {
    dryRun,
    alreadyReady: summary.alreadyReady ?? 0,
    pendingOrCreated: dryRun
      ? (summary.willCreate ?? 0)
      : (summary.created ?? summary.willCreate ?? 0),
    inactiveSkipped: summary.inactiveSkipped ?? 0,
    duplicateSkipped: summary.duplicateSkipped ?? 0,
    failed: summary.failed ?? 0,
  };
}

/**
 * Aktif firmalar için Drive arşivi toplu önizleme / oluşturma.
 * Ofis köküne dokunmaz; token göstermez. Mükerrer unvanları otomatik atlar.
 */
export default function DriveBulkProvisionPanel({ notify = () => {} }) {
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const [executeResult, setExecuteResult] = useState(null);
  const [error, setError] = useState("");

  const payload = executeResult || preview;
  const rows = useMemo(() => flattenRows(payload), [payload]);
  const counts = useMemo(() => provisionSummaryCounts(payload), [payload]);

  const callApi = async ({ execute }) => {
    setError("");
    setBusy(execute ? "execute" : "preview");
    try {
      const response = await fetch(
        "/api/google-drive/folders/provision-active",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            execute ? { dryRun: false, execute: true } : { dryRun: true }
          ),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || body.message || "İşlem başarısız.");
      }
      const raw = JSON.stringify(body);
      if (
        /token_reference|accessToken|refresh_token|client_secret/i.test(raw)
      ) {
        throw new Error("Yanıt güvenlik kontrolünden geçmedi.");
      }
      return body;
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <h3 className="text-base font-semibold text-white">
        Aktif Firmaların Drive Arşivini Hazırla
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        Önce önizleyin; ardından tek tıkla eksik aktif firmaların ofis Drive
        arşivini oluşturun. Aynı unvanlı mükerrer kayıtlar otomatik atlanır;
        mevcut kökler ve ADH arşivi korunur.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            void (async () => {
              try {
                const body = await callApi({ execute: false });
                setPreview(body);
                setExecuteResult(null);
                const c = provisionSummaryCounts(body);
                notify(
                  `Önizleme: ${c.pendingOrCreated} oluşturulacak, ${c.duplicateSkipped} mükerrer atlandı, ${c.alreadyReady} hazır.`,
                  "success"
                );
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : "Önizleme başarısız.";
                setError(message);
                notify(message, "error");
              }
            })();
          }}
          className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {busy === "preview" ? "Önizleniyor…" : "Önizle"}
        </button>

        <button
          type="button"
          disabled={Boolean(busy) || !preview}
          onClick={() => {
            void (async () => {
              try {
                const body = await callApi({ execute: true });
                setExecuteResult(body);
                setPreview(body);
                const c = provisionSummaryCounts(body);
                notify(
                  `Hazırlandı: ${c.pendingOrCreated} oluşturuldu, ${c.duplicateSkipped} mükerrer atlandı, ${c.alreadyReady} hazır.`,
                  "success"
                );
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : "Hazırlama başarısız.";
                setError(message);
                notify(message, "error");
              }
            })();
          }}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy === "execute" ? "Hazırlanıyor…" : "Hazırla"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      {payload?.summary ? (
        <p className="mt-3 text-xs text-slate-500">
          Hazır: {counts.alreadyReady} ·{" "}
          {counts.dryRun ? "Oluşturulacak" : "Oluşturulan"}:{" "}
          {counts.pendingOrCreated} · Mükerrer Atlandı:{" "}
          {counts.duplicateSkipped} · Pasif Atlandı: {counts.inactiveSkipped} ·
          Hata: {counts.failed}
        </p>
      ) : null}

      {rows.length ? (
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2 text-sm">
          {rows.map((row) => (
            <li
              key={row.companyId}
              className="flex items-center justify-between gap-2 px-1 py-0.5"
            >
              <span className="truncate text-slate-200">{row.companyName}</span>
              <span
                className={`shrink-0 text-xs font-medium ${
                  STATUS_CLASS[row.label] || "text-slate-400"
                }`}
              >
                {row.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
