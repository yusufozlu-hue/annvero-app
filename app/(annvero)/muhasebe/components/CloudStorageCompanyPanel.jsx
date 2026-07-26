"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildCompanyFolderTree,
  FOLDER_STRUCTURE_VERSION,
} from "@/src/utils/cloudStorage/folderSchema";
import { emptyCloudStorageBinding } from "@/src/utils/cloudStorage/types";
import {
  buildUploadTargetPathList,
  DRIVE_UPLOAD_ACCEPT,
  DRIVE_UPLOAD_ACCEPT_HINT,
  DRIVE_UPLOAD_DEFAULT_FOLDER,
  DRIVE_UPLOAD_MAX_BYTES,
  DRIVE_UPLOAD_MAX_LABEL,
} from "@/src/utils/cloudStorage/uploadPolicy";

const CHECK_ERROR_MESSAGES = Object.freeze({
  MISSING_COMPANY_ID: "Firma seçilmedi.",
  FOLDER_BINDING_MISSING: "Önce firma Drive klasörünü oluşturun.",
  DRIVE_CONNECTION_MISSING: "Google Drive bağlantısı bulunamadı.",
  ROOT_FOLDER_INVALID: "Firma Drive kök klasörü geçersiz veya silinmiş.",
  ROOT_COMPANY_MISMATCH: "Drive kök klasörü bu firmaya bağlı değil.",
  DRIVE_API_ERROR: "Google Drive klasör yapısı okunamadı.",
  STRUCTURE_MISMATCH: "Klasör yapısı beklenen şema ile uyuşmuyor.",
  FORBIDDEN: "Bu firmaya erişim yetkiniz yok.",
  COMPANY_INACTIVE: "Pasif firmalara evrak yüklenemez.",
  SYSTEM_FOLDER_FORBIDDEN: "Sistem klasörüne (_ANNVERO) dosya yüklenemez.",
  INVALID_TARGET_PATH: "Hedef klasör şema v1 izinli yollarından biri değil.",
  UNSUPPORTED_FILE_TYPE: "Desteklenmeyen dosya türü. PDF, Excel, XML veya görsel yükleyin.",
  MIME_EXTENSION_MISMATCH: "Dosya uzantısı ile içerik türü uyuşmuyor.",
  EMPTY_FILE: "Boş dosya yüklenemez.",
  PAYLOAD_TOO_LARGE: `Dosya çok büyük. En fazla ${DRIVE_UPLOAD_MAX_LABEL} yükleyebilirsiniz.`,
  DUPLICATE_CONTENT: "Bu dosya daha önce yüklendi (içerik mükerrer).",
  DRIVE_UPLOAD_FAILED: "Dosya Google Drive’a yüklenemedi.",
  TARGET_FOLDER_MISSING: "Hedef klasör Drive’da bulunamadı. Önce klasör yapısını oluşturun.",
  MISSING_FILE: "Yüklenecek dosya bulunamadı.",
});

function friendlyApiError(body, fallback = "İşlem başarısız.") {
  const code = body?.code || "";
  if (code && CHECK_ERROR_MESSAGES[code]) return CHECK_ERROR_MESSAGES[code];
  if (typeof body?.message === "string" && body.message.trim()) return body.message;
  if (typeof body?.error === "string" && body.error.trim()) {
    if (/google drive işlemi başarısız/i.test(body.error)) {
      return "İşlem tamamlanamadı. Bağlantıyı ve klasör kaydını kontrol edin.";
    }
    return body.error;
  }
  return fallback;
}

function uploadStatusLabel(status) {
  switch (status) {
    case "pending":
      return "Bekliyor";
    case "uploading":
      return "Yükleniyor";
    case "success":
      return "Başarılı";
    case "duplicate":
      return "Mükerrer";
    case "error":
      return "Hata";
    default:
      return status;
  }
}

/**
 * Firma Yönetimi — gerçek Google Drive OAuth / metadata senkronizasyonu.
 */
export default function CloudStorageCompanyPanel({
  company,
  setCompany,
  onNotify,
}) {
  const [busy, setBusy] = useState("");
  const [showExpectedTree, setShowExpectedTree] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [lastSyncStats, setLastSyncStats] = useState(null);
  const [structureCheck, setStructureCheck] = useState(null);
  const [localError, setLocalError] = useState("");
  const [errorCompanyId, setErrorCompanyId] = useState(company?.id);
  const [binding, setBinding] = useState(() => ({
    ...emptyCloudStorageBinding(), ...(company?.cloudStorage || {}),
  }));
  const [uploadFolder, setUploadFolder] = useState(DRIVE_UPLOAD_DEFAULT_FOLDER);
  const [uploadItems, setUploadItems] = useState([]);

  const folderTree = useMemo(() => buildCompanyFolderTree(), []);
  const uploadTargets = useMemo(() => buildUploadTargetPathList(), []);
  const displayedError =
    errorCompanyId === company?.id ? localError : "";

  const uploadEnabled =
    Boolean(company?.id) &&
    binding.connectionStatus === "connected" &&
    Boolean(binding.rootFolderId) &&
    company?.isActive !== false;

  const notify = (message, type = "success") => {
    if (typeof onNotify === "function") onNotify(message, type);
  };

  useEffect(() => {
    let active = true;
    if (!company?.id) return undefined;
    void Promise.resolve().then(() => {
      if (active) {
        setStructureCheck(null);
        setUploadItems([]);
      }
    });
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
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(friendlyApiError(body));
      err.code = body?.code || "";
      err.body = body;
      err.status = response.status;
      throw err;
    }
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

  const runAutoSync = async () => {
    const result = await api("/api/google-drive/sync", {
      method: "POST",
      body: JSON.stringify({ companyId: company.id }),
    });
    setBinding((prev) => ({
      ...prev,
      syncStatus: "ok",
      lastSyncAt: result.lastSyncAt,
      indexedDocumentCount: Number(result.stats?.remoteCount || 0),
    }));
    setLastSyncStats(result.stats);
    return result;
  };

  const handleUploadFiles = async (fileList) => {
    if (busy || !uploadEnabled) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const items = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      size: file.size,
      status: file.size > DRIVE_UPLOAD_MAX_BYTES ? "error" : "pending",
      message:
        file.size > DRIVE_UPLOAD_MAX_BYTES
          ? CHECK_ERROR_MESSAGES.PAYLOAD_TOO_LARGE
          : "",
      file,
    }));
    setUploadItems(items);

    await run("upload", async () => {
      let uploadedOrDuplicate = 0;
      for (const item of items) {
        if (item.status === "error") continue;
        setUploadItems((prev) =>
          prev.map((row) =>
            row.id === item.id ? { ...row, status: "uploading", message: "" } : row
          )
        );
        try {
          if (!item.file.size) {
            throw Object.assign(new Error(CHECK_ERROR_MESSAGES.EMPTY_FILE), {
              code: "EMPTY_FILE",
            });
          }
          const form = new FormData();
          form.set("companyId", company.id);
          form.set("targetFolderPath", uploadFolder);
          form.set("file", item.file, item.file.name);
          const response = await fetch("/api/google-drive/files/upload", {
            method: "POST",
            body: form,
          });
          const body = await response.json().catch(() => ({}));
          if (response.status === 409 && body?.code === "DUPLICATE_CONTENT") {
            uploadedOrDuplicate += 1;
            setUploadItems((prev) =>
              prev.map((row) =>
                row.id === item.id
                  ? {
                      ...row,
                      status: "duplicate",
                      message: friendlyApiError(body, CHECK_ERROR_MESSAGES.DUPLICATE_CONTENT),
                    }
                  : row
              )
            );
            continue;
          }
          if (!response.ok) {
            throw Object.assign(new Error(friendlyApiError(body)), {
              code: body?.code || "",
              body,
              status: response.status,
            });
          }
          uploadedOrDuplicate += 1;
          setUploadItems((prev) =>
            prev.map((row) =>
              row.id === item.id
                ? { ...row, status: "success", message: body.message || "Yüklendi" }
                : row
            )
          );
        } catch (error) {
          setUploadItems((prev) =>
            prev.map((row) =>
              row.id === item.id
                ? {
                    ...row,
                    status: "error",
                    message: error?.message || CHECK_ERROR_MESSAGES.DRIVE_UPLOAD_FAILED,
                  }
                : row
            )
          );
        }
      }

      if (uploadedOrDuplicate > 0) {
        const syncResult = await runAutoSync();
        notify(
          `Yükleme tamamlandı. Drive’da ${syncResult.stats?.remoteCount ?? 0} belge indekslendi.`,
          "success"
        );
      }
    });
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

  const checkTone = structureCheck
    ? structureCheck.ok
      ? "ok"
      : structureCheck.missingPaths?.length
        ? "missing"
        : structureCheck.extraPaths?.length
          ? "extra"
          : "missing"
    : null;

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
          Bağlantı Google’ın dar kapsamlı drive.file izniyle çalışır. Dosyaları
          Drive’a elle değil, aşağıdaki ANNVERO yükleme alanından ekleyin.
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
              setStructureCheck(null);
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
          disabled={Boolean(busy) || !binding.rootFolderId}
          onClick={() =>
            void run("check", async () => {
              const result = await api(
                `/api/google-drive/folders/check?companyId=${encodeURIComponent(company.id)}`
              );
              setStructureCheck(result);
              notify(
                result.ok
                  ? "Klasör yapısı şema ile uyumlu"
                  : friendlyApiError(result, "Klasör yapısı uyuşmuyor"),
                result.ok ? "success" : "error"
              );
            })
          }
          className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {busy === "check" ? "Kontrol ediliyor…" : "Klasör Yapısını Kontrol Et"}
        </button>

        <button
          type="button"
          disabled={!binding.rootFolderId}
          onClick={() => setShowExpectedTree((v) => !v)}
          className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {showExpectedTree ? "Beklenen Şemayı Gizle" : "Beklenen Şemayı Göster"}
        </button>

        <button
          type="button"
          disabled={Boolean(busy) || !binding.rootFolderId}
          onClick={() =>
            void run("sync", async () => {
              await runAutoSync();
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

      <div
        className={`rounded-xl border p-4 ${
          uploadEnabled
            ? "border-slate-700 bg-slate-950/50"
            : "border-slate-800 bg-slate-950/30 opacity-70"
        }`}
      >
        <h3 className="text-sm font-semibold text-slate-100">
          ANNVERO’dan Drive’a Evrak Yükle
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          {DRIVE_UPLOAD_ACCEPT_HINT}. Dosyalar uygulama tarafından Drive’a
          yazılır; böylece senkronizasyon onları görebilir.
        </p>
        {!uploadEnabled ? (
          <p className="mt-2 text-xs text-amber-200/90">
            Yükleme için Google Drive bağlantısı ve firma klasörü gerekir.
          </p>
        ) : null}

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-slate-400">
            Hedef klasör
            <select
              value={uploadFolder}
              disabled={!uploadEnabled || Boolean(busy)}
              onChange={(event) => setUploadFolder(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
            >
              {uploadTargets.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50">
            {busy === "upload" ? "Yükleniyor…" : "Dosya seç"}
            <input
              type="file"
              multiple
              accept={DRIVE_UPLOAD_ACCEPT}
              disabled={!uploadEnabled || Boolean(busy)}
              className="hidden"
              onChange={(event) => {
                const list = event.target.files;
                void handleUploadFiles(list);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Boyut sınırı: {DRIVE_UPLOAD_MAX_LABEL} / dosya. Varsayılan hedef:{" "}
          {DRIVE_UPLOAD_DEFAULT_FOLDER}.
        </p>

        {uploadItems.length ? (
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
            {uploadItems.map((item) => (
              <li
                key={item.id}
                className={
                  item.status === "success"
                    ? "text-emerald-200"
                    : item.status === "duplicate"
                      ? "text-amber-200"
                      : item.status === "error"
                        ? "text-rose-200"
                        : "text-slate-300"
                }
              >
                <span className="font-medium">{uploadStatusLabel(item.status)}</span>
                {" · "}
                {item.name}
                {item.message ? ` — ${item.message}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {binding.rootFolderId ? (
        <p className="text-xs text-slate-500">
          Yapı sürümü: {binding.folderStructureVersion || FOLDER_STRUCTURE_VERSION}
          <span className="ml-2 opacity-60">· teknik kimlik gizli tutulur</span>
        </p>
      ) : null}

      {lastSyncStats ? (
        <p className="text-xs text-slate-400">
          Son senkronizasyon: Drive’da {lastSyncStats.remoteCount} belge bulundu.
        </p>
      ) : null}

      {structureCheck ? (
        <div
          className={
            checkTone === "ok"
              ? "rounded-xl border border-emerald-700/60 bg-emerald-950/30 p-4"
              : checkTone === "extra"
                ? "rounded-xl border border-amber-700/60 bg-amber-950/30 p-4"
                : "rounded-xl border border-rose-700/60 bg-rose-950/30 p-4"
          }
        >
          <p
            className={
              checkTone === "ok"
                ? "text-sm font-medium text-emerald-100"
                : checkTone === "extra"
                  ? "text-sm font-medium text-amber-100"
                  : "text-sm font-medium text-rose-100"
            }
          >
            {structureCheck.ok
              ? "Tam uyumlu — klasör yapısı şema ile eşleşiyor."
              : structureCheck.missingPaths?.length
                ? "Eksik klasörler bulundu."
                : "Beklenmeyen (fazla) klasörler bulundu."}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Şema {structureCheck.schemaVersion} · beklenen {structureCheck.expectedCount} ·
            Drive’da {structureCheck.existingCount}
            {" · "}
            _ANNVERO kökte: {structureCheck.annveroAtRoot ? "var" : "yok"}
          </p>

          {structureCheck.missingPaths?.length ? (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-rose-200/90">
                Eksik yollar
              </p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm text-rose-100/90">
                {structureCheck.missingPaths.map((path) => (
                  <li key={`missing-${path}`}>• {path}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {structureCheck.extraPaths?.length ? (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-200/90">
                Fazla yollar
              </p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm text-amber-100/90">
                {structureCheck.extraPaths.map((path) => (
                  <li key={`extra-${path}`}>• {path}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
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
                    setStructureCheck(null);
                    setUploadItems([]);
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

      {showExpectedTree ? (
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
