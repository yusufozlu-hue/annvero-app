"use client";

import { useMemo, useState } from "react";

const STATUS_CLASS = {
  Hazır: "text-emerald-300",
  Oluşturulacak: "text-sky-300",
  Oluşturuldu: "text-emerald-300",
  Hazırlanıyor: "text-sky-200",
  "Pasif Atlandı": "text-slate-400",
  "Mükerrer İnceleme": "text-amber-300",
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

function safeErrorMessage(response, body, fallback) {
  const fromBody =
    (typeof body?.error === "string" && body.error) ||
    (typeof body?.message === "string" && body.message) ||
    "";
  if (response?.status === 429) {
    return fromBody || "Çok fazla istek — kısa süre sonra tekrar deneyin.";
  }
  if (response?.status === 504 || response?.status === 408) {
    return (
      fromBody ||
      "İstek zaman aşımına uğradı. Kaldığı yerden tekrar Hazırla ile devam edebilirsiniz."
    );
  }
  if (response?.status === 502 || response?.status === 503) {
    return fromBody || "Sunucu geçici olarak yanıt vermedi. Tekrar deneyin.";
  }
  if (response?.status === 403) {
    return fromBody || "Bu işlem için yönetim yetkisi gerekli.";
  }
  if (response?.status === 401) {
    return fromBody || "Oturum gerekli — yeniden giriş yapın.";
  }
  if (fromBody && fromBody !== "İşlem başarısız.") return fromBody;
  if (response?.status) {
    return `${fallback} (HTTP ${response.status}).`;
  }
  return fallback;
}

function mergeRowIntoPreview(preview, row) {
  if (!preview || !row?.companyId) return preview;
  const id = String(row.companyId);
  const strip = (list) => (list || []).filter((r) => String(r.companyId) !== id);
  const next = {
    ...preview,
    dryRun: false,
    alreadyReady: strip(preview.alreadyReady),
    willCreate: strip(preview.willCreate),
    duplicateSkipped: strip(preview.duplicateSkipped),
    inactiveSkipped: strip(preview.inactiveSkipped),
    failed: strip(preview.failed),
    results: strip(preview.results),
  };

  if (row.status === "ALREADY_READY" || row.status === "CREATED") {
    next.alreadyReady = [
      ...next.alreadyReady,
      {
        ...row,
        status: "ALREADY_READY",
        label: row.status === "CREATED" ? "Oluşturuldu" : "Hazır",
      },
    ];
  } else if (row.status === "DUPLICATE_NAME_SKIPPED") {
    next.duplicateSkipped = [...next.duplicateSkipped, row];
  } else if (row.status === "INACTIVE_SKIPPED") {
    next.inactiveSkipped = [...next.inactiveSkipped, row];
  } else if (row.status === "WILL_CREATE") {
    next.willCreate = [...next.willCreate, row];
  } else {
    next.failed = [
      ...next.failed,
      { ...row, status: row.status || "DRIVE_ERROR", label: row.label || "Hata" },
    ];
  }

  const createdCount =
    (preview.summary?.created || 0) + (row.status === "CREATED" ? 1 : 0);
  next.summary = {
    alreadyReady: next.alreadyReady.length,
    willCreate: next.willCreate.length,
    inactiveSkipped: next.inactiveSkipped.length,
    duplicateSkipped: next.duplicateSkipped.length,
    failed: next.failed.length,
    created: createdCount,
  };
  return next;
}

/**
 * Aktif firmalar için Drive arşivi toplu önizleme / tekil sırayla oluşturma.
 * Ofis köküne dokunmaz; token göstermez. Kimliksiz mükerrer unvanları Mükerrer İnceleme olarak atlar.
 */
export default function DriveBulkProvisionPanel({ notify = () => {} }) {
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState(null);
  const [executeResult, setExecuteResult] = useState(null);
  const [error, setError] = useState("");
  const [rowOverrides, setRowOverrides] = useState({});

  const payload = executeResult || preview;
  const baseRows = useMemo(() => flattenRows(payload), [payload]);
  const rows = useMemo(() => {
    return baseRows.map((row) => {
      const ov = rowOverrides[String(row.companyId)];
      return ov ? { ...row, ...ov } : row;
    });
  }, [baseRows, rowOverrides]);
  const counts = useMemo(() => provisionSummaryCounts(payload), [payload]);

  const callPreview = async () => {
    const response = await fetch(
      "/api/google-drive/folders/provision-active",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        safeErrorMessage(response, body, "Önizleme başarısız.")
      );
    }
    const raw = JSON.stringify(body);
    if (/token_reference|accessToken|refresh_token|client_secret/i.test(raw)) {
      throw new Error("Yanıt güvenlik kontrolünden geçmedi.");
    }
    return body;
  };

  const callExecuteOne = async (companyId) => {
    const response = await fetch(
      "/api/google-drive/folders/provision-active",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: false,
          execute: true,
          companyId: String(companyId),
        }),
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        safeErrorMessage(response, body, "Firma hazırlanamadı.")
      );
    }
    const raw = JSON.stringify(body);
    if (/token_reference|accessToken|refresh_token|client_secret/i.test(raw)) {
      throw new Error("Yanıt güvenlik kontrolünden geçmedi.");
    }
    if (!body?.result?.companyId) {
      throw new Error("Sunucu yanıtı eksik — firma sonucu alınamadı.");
    }
    return body;
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <h3 className="text-base font-semibold text-white">
        Aktif Firmaların Drive Arşivini Hazırla
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        Önce önizleyin; ardından firmalar tek tek hazırlanır (ilerleme
        gösterilir). Aynı unvanlı mükerrer kayıtlar atlanır; mevcut kökler ve
        ADH arşivi korunur. Kesinti olursa tekrar Hazırla kaldığı yerden devam
        eder.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            void (async () => {
              try {
                setError("");
                setBusy("preview");
                setProgress("");
                const body = await callPreview();
                setPreview(body);
                setExecuteResult(null);
                setRowOverrides({});
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
              } finally {
                setBusy("");
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
              setError("");
              setBusy("execute");
              let working = preview;
              try {
                // Sunucu doğrulamalı güncel liste (resume: yalnız eksikler).
                working = await callPreview();
                setPreview(working);
                setExecuteResult(null);

                const queue = [...(working.willCreate || [])];
                const total = queue.length;
                if (total === 0) {
                  setExecuteResult(working);
                  setProgress("");
                  notify("Hazırlanacak eksik firma yok.", "success");
                  return;
                }

                let created = 0;
                let failed = 0;
                let ready = 0;
                let skipped = 0;

                for (let i = 0; i < queue.length; i += 1) {
                  const item = queue[i];
                  const id = String(item.companyId);
                  setProgress(`${i + 1}/${total} hazırlanıyor`);
                  setRowOverrides((prev) => ({
                    ...prev,
                    [id]: {
                      label: "Hazırlanıyor",
                      status: "IN_PROGRESS",
                      message: `${i + 1}/${total} hazırlanıyor`,
                    },
                  }));

                  try {
                    const body = await callExecuteOne(id);
                    const result = body.result;
                    working = mergeRowIntoPreview(working, result);
                    setPreview(working);
                    setExecuteResult(working);
                    setRowOverrides((prev) => {
                      const next = { ...prev };
                      delete next[id];
                      return next;
                    });

                    if (result.status === "CREATED") created += 1;
                    else if (result.status === "ALREADY_READY") ready += 1;
                    else if (
                      result.status === "DUPLICATE_NAME_SKIPPED" ||
                      result.status === "INACTIVE_SKIPPED"
                    ) {
                      skipped += 1;
                    } else {
                      failed += 1;
                    }
                  } catch (err) {
                    failed += 1;
                    const message =
                      err instanceof Error
                        ? err.message
                        : "Firma hazırlanamadı.";
                    const failRow = {
                      companyId: id,
                      companyName: item.companyName,
                      status: "DRIVE_ERROR",
                      label: "Hata",
                      message,
                    };
                    working = mergeRowIntoPreview(working, failRow);
                    setPreview(working);
                    setExecuteResult(working);
                    setRowOverrides((prev) => {
                      const next = { ...prev };
                      delete next[id];
                      return next;
                    });
                    // Diğer firmalara devam
                  }
                }

                setProgress("");
                notify(
                  `Tamamlandı: ${created} oluşturuldu, ${ready} zaten hazır, ${skipped} atlandı, ${failed} hata.`,
                  failed > 0 ? "error" : "success"
                );
                if (failed > 0) {
                  setError(
                    `${failed} firmada hata oluştu. Diğerleri tamamlandı; tekrar Hazırla ile kalanlar sürdürülebilir.`
                  );
                }
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : "Hazırlama başarısız.";
                setError(message);
                notify(message, "error");
              } finally {
                setBusy("");
                setProgress("");
              }
            })();
          }}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy === "execute"
            ? progress || "Hazırlanıyor…"
            : "Hazırla"}
        </button>
      </div>

      {progress ? (
        <p className="mt-2 text-xs text-sky-300">{progress}</p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      {payload?.summary ? (
        <p className="mt-3 text-xs text-slate-500">
          Hazır: {counts.alreadyReady} ·{" "}
          {counts.dryRun ? "Oluşturulacak" : "Oluşturulan"}:{" "}
          {counts.pendingOrCreated} · Mükerrer İnceleme:{" "}
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
                title={row.message || ""}
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
