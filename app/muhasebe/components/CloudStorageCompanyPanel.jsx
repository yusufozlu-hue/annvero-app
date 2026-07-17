"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildCompanyFolderTree,
  FOLDER_STRUCTURE_VERSION,
} from "@/src/utils/cloudStorage/folderSchema";
import { emptyCloudStorageBinding } from "@/src/utils/cloudStorage/types";

/**
 * Firma Yönetimi — gerçek Google Drive OAuth / metadata senkronizasyonu.
 */
export default function CloudStorageCompanyPanel({
  company,
  setCompany,
  onNotify,
}) {
  const [busy, setBusy] = useState("");
  const [showTree, setShowTree] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [lastSyncStats, setLastSyncStats] = useState(null);
  const [localError, setLocalError] = useState("");
  const [errorCompanyId, setErrorCompanyId] = useState(company?.id);
  const [binding, setBinding] = useState(() => ({
    ...emptyCloudStorageBinding(), ...(company?.cloudStorage || {}),
  }));

  const folderTree = useMemo(() => buildCompanyFolderTree(), []);
  const displayedError =
    errorCompanyId === company?.id ? localError : "";

  const notify = (message, type = "success") => {
    if (typeof onNotify === "function") onNotify(message, type);
  };

  useEffect(() => {
    let active = true;
    if (!company?.id) return undefined;
    Promise.all([
      fetch("/api/google-drive/connection", { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/google-drive/folders?companyId=${encodeURIComponent(company.id)}`, { cache: "no-store" }).then((r) => r.json()),
    ]).then(([connectionBody, folderBody]) => {
      if (!active) return;
      const connection = connectionBody.connection || {};
      const folder = folderBody.folder || {};
      setBinding({
        ...emptyCloudStorageBinding(),
        provider: connection.provider || "google_drive",
        connectionStatus: connection.status || "disconnected",
        accountEmail: connection.accountEmail || "",
        rootFolderId: folder.root_folder_id || "",
        rootFolderName: folder.root_folder_name || "",
        folderStructureVersion: folder.folder_structure_version || "",
        syncStatus: folder.sync_status || "idle",
        lastSyncAt: folder.last_sync_at || null,
        lastError: folder.last_error || "",
      });
    }).catch(() => active && setLocalError("Drive bağlantı durumu alınamadı."));
    return () => { active = false; };
  }, [company?.id]);

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Google Drive işlemi başarısız.");
    return body;
  }

  const run = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    setErrorCompanyId(company?.id);
    setLocalError("");
    try {
      await fn();
    } catch (error) {
      const message = error?.message || "İşlem başarısız.";
      setErrorCompanyId(company?.id);
      setLocalError(message);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  };

  const statusCards = [
    {
      label: "Bağlantı",
      value:
        binding.connectionStatus === "connected"
          ? binding.accountEmail || "Bağlı"
          : "Bağlı değil",
    },
    {
      label: "Firma klasörü",
      value: binding.rootFolderId
        ? binding.rootFolderName || "Oluşturuldu"
        : "Yok",
    },
    {
      label: "Son senkronizasyon",
      value: binding.lastSyncAt
        ? new Date(binding.lastSyncAt).toLocaleString("tr-TR")
        : "—",
    },
    {
      label: "İndekslenen belge",
      value: String(binding.indexedDocumentCount || 0),
    },
    {
      label: "Durum",
      value: binding.lastError
        ? "Hata"
        : binding.syncStatus === "ok"
          ? "Hazır"
          : binding.connectionStatus === "connected"
            ? "Bağlı"
            : "Bekliyor",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Bulut Depolama</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Google Drive, firmanın fiziksel belge arşividir. ANNVERO yalnız indeks,
          metadata ve iş akışını tutar. Firma bilgilerinin doğruluk kaynağı bu
          karttır; Drive metadata dosyasında unvan/MERSİS tutulmaz.
        </p>
        <p className="mt-2 text-xs text-amber-200/90">
          Bağlantı Google’ın dar kapsamlı drive.file izniyle çalışır. Token yalnız
          sunucuda şifreli saklanır; tarayıcıya ve firma kartına yazılmaz.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {statusCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-3"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              {card.label}
            </p>
            <p className="mt-1 truncate text-sm font-medium text-slate-100">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {(displayedError || binding.lastError) && (
        <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
          {displayedError || binding.lastError}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => { window.location.assign(`/api/google-drive/oauth/start?companyId=${encodeURIComponent(company.id)}`); }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy === "connect" ? "Hazırlanıyor…" : "Google Drive’ı Bağla"}
        </button>

        <button
          type="button"
          disabled={Boolean(busy) || binding.connectionStatus !== "connected"}
          onClick={() =>
            void run("folders", async () => {
              const { result } = await api("/api/google-drive/folders", {
                method: "POST", body: JSON.stringify({ companyId: company.id }),
              });
              setBinding((prev) => ({ ...prev, rootFolderId: result.rootFolderId,
                rootFolderName: result.rootFolderName, folderStructureVersion: result.folderStructureVersion }));
              notify(
                result.createdFolderCount
                  ? `Klasör yapısı oluşturuldu (${result.createdFolderCount} yeni)`
                  : "Klasör yapısı zaten güncel (idempotent)",
                "success"
              );
            })
          }
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy === "folders" ? "Hazırlanıyor…" : "Firma Klasörünü Oluştur"}
        </button>

        <button
          type="button"
          disabled={!binding.rootFolderId}
          onClick={() => {
            const url = binding.rootFolderId
              ? `https://drive.google.com/drive/folders/${binding.rootFolderId}` : "";
            if (url) window.open(url, "_blank", "noopener,noreferrer");
            else notify("Açılacak klasör yok", "error");
          }}
          className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          Klasörü Aç
        </button>

        <button
          type="button"
          disabled={!binding.rootFolderId}
          onClick={() => setShowTree((v) => !v)}
          className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {showTree ? "Ağacı Gizle" : "Klasör Yapısını Kontrol Et"}
        </button>

        <button
          type="button"
          disabled={Boolean(busy) || !binding.rootFolderId}
          onClick={() =>
            void run("sync", async () => {
              const result = await api("/api/google-drive/sync", {
                method: "POST", body: JSON.stringify({ companyId: company.id }),
              });
              setBinding((prev) => ({ ...prev, syncStatus: "ok", lastSyncAt: result.lastSyncAt }));
              setLastSyncStats(result.stats);
              notify("Senkronizasyon tamamlandı", "success");
            })
          }
          className="rounded-lg border border-sky-700 bg-sky-950 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-900 disabled:opacity-50"
        >
          {busy === "sync" ? "Hazırlanıyor…" : "Senkronizasyonu Yenile"}
        </button>

        <button
          type="button"
          disabled={Boolean(busy) || binding.connectionStatus !== "connected"}
          onClick={() => setShowDisconnectConfirm(true)}
          className="rounded-lg border border-rose-700/70 bg-rose-950/50 px-4 py-2 text-sm font-medium text-rose-100 hover:bg-rose-900/60 disabled:opacity-50"
        >
          Bağlantıyı Kaldır
        </button>
      </div>

      {binding.rootFolderId ? (
        <p className="text-xs text-slate-500">
          Yapı sürümü: {binding.folderStructureVersion || FOLDER_STRUCTURE_VERSION}
          {/* folder ID teknik; baskın değil */}
          <span className="ml-2 opacity-60">· teknik kimlik gizli tutulur</span>
        </p>
      ) : null}

      {lastSyncStats ? (
        <p className="text-xs text-slate-400">
          Son senkronizasyon: Drive’da {lastSyncStats.remoteCount} belge bulundu.
        </p>
      ) : null}

      {showDisconnectConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cloud-disconnect-title"
          onClick={() => {
            if (busy !== "disconnect") setShowDisconnectConfirm(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-rose-800/60 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id="cloud-disconnect-title"
              className="text-lg font-semibold text-white"
            >
              Bağlantıyı kaldırmak istediğinize emin misiniz?
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              <li className="flex gap-2">
                <span className="text-rose-300">•</span>
                Google Drive erişimi (token) iptal edilir.
              </li>
              <li className="flex gap-2">
                <span className="text-rose-300">•</span>
                ANNVERO’da sunucuda şifreli saklanan token silinir.
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-300">•</span>
                Drive’daki mevcut klasör ve belgeler{" "}
                <strong className="text-slate-100">silinmez</strong>.
              </li>
            </ul>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy === "disconnect"}
                onClick={() => setShowDisconnectConfirm(false)}
                className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                İptal
              </button>
              <button
                type="button"
                disabled={busy === "disconnect"}
                onClick={() =>
                  void run("disconnect", async () => {
                    await api("/api/google-drive/connection", { method: "DELETE" });
                    setBinding(emptyCloudStorageBinding());
                    setCompany({ ...company, cloudStorage: emptyCloudStorageBinding() });
                    setLastSyncStats(null);
                    setShowDisconnectConfirm(false);
                    notify("Bulut bağlantısı kaldırıldı", "success");
                  })
                }
                className="rounded-lg border border-rose-700/70 bg-rose-700/80 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50"
              >
                {busy === "disconnect" ? "Kaldırılıyor…" : "Bağlantıyı Kaldır"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showTree ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="mb-3 text-sm font-medium text-slate-200">
            Beklenen klasör ağacı (şema {FOLDER_STRUCTURE_VERSION})
          </p>
          <ul className="space-y-1 text-sm text-slate-300">
            {folderTree.map((node) => (
              <li key={node.key || node.name}>
                <span className={node.system ? "text-amber-200" : ""}>
                  {node.name}
                  {node.system ? " (sistem)" : ""}
                </span>
                {node.children?.length ? (
                  <ul className="ml-4 mt-1 space-y-0.5 text-slate-400">
                    {node.children.map((child) => (
                      <li key={child.name}>└ {child.name}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
