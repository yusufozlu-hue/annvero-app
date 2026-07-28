"use client";

import { useState } from "react";
import { useUserRole } from "@/src/hooks/useUserRole";

const STATUS_CLASS = {
  Hazır: "text-emerald-200",
  Oluşturuldu: "text-sky-200",
  Atlandı: "text-amber-200",
  Hata: "text-rose-200",
};

/**
 * Firma Yönetimi — aktif firmalar için toplu Drive arşiv hazırlığı.
 * Önizle (dry-run) → Hazırla (execute). Token / Drive ID göstermez.
 */
export default function DriveBulkProvisionPanel({ onNotify }) {
  const { isManagementUser } = useUserRole();
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const [executeResult, setExecuteResult] = useState(null);
  const [error, setError] = useState("");

  if (!isManagementUser) return null;

  const notify = (message, type = "info") => {
    if (typeof onNotify === "function") onNotify(message, type);
  };

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
      // Secret / Drive ID sızıntı kontrolü (istemci tarafı savunma).
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

  const rowsFromPayload = (payload) => {
    const buckets = [
      ...(payload.alreadyReady || []),
      ...(payload.willCreate || []),
      ...(payload.inactiveSkipped || []),
      ...(payload.failed || []),
      ...(payload.results || []),
    ];
    const byId = new Map();
    for (const row of buckets) {
      if (!row?.companyId) continue;
      byId.set(row.companyId, {
        companyName: row.companyName || "Firma",
        label: row.label || "Hata",
      });
    }
    return [...byId.values()].sort((a, b) =>
      a.companyName.localeCompare(b.companyName, "tr")
    );
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <h3 className="text-base font-semibold text-white">
        Aktif Firmaların Drive Arşivini Hazırla
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        Önce önizleyin; ardından tek tıkla eksik aktif firmaların ofis Drive
        arşivini oluşturun. Mevcut kökler ve ADH arşivi korunur.
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
                notify(
                  `Önizleme: ${body.summary?.willCreate ?? 0} oluşturulacak, ${body.summary?.alreadyReady ?? 0} hazır.`,
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
                notify(
                  `Hazırlandı: ${body.summary?.created ?? 0} oluşturuldu, ${body.summary?.alreadyReady ?? 0} hazır.`,
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

      {(executeResult || preview)?.summary ? (
        <p className="mt-3 text-xs text-slate-500">
          Hazır: {(executeResult || preview).summary.alreadyReady} ·
          Oluşturulacak/Oluşturulan:{" "}
          {(executeResult || preview).summary.created ??
            (executeResult || preview).summary.willCreate}{" "}
          · Atlandı: {(executeResult || preview).summary.inactiveSkipped} ·
          Hata: {(executeResult || preview).summary.failed}
        </p>
      ) : null}

      {rowsFromPayload(executeResult || preview || {}).length ? (
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2 text-sm">
          {rowsFromPayload(executeResult || preview || {}).map((row) => (
            <li
              key={`${row.companyName}-${row.label}`}
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
