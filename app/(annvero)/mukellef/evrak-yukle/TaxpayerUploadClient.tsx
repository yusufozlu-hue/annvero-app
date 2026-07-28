"use client";

import { useCallback, useRef, useState } from "react";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import TaxpayerCompanyBar from "../components/TaxpayerCompanyBar";
import {
  DRIVE_UPLOAD_ACCEPT,
  DRIVE_UPLOAD_ACCEPT_HINT,
  DRIVE_UPLOAD_MAX_BYTES,
  DRIVE_UPLOAD_MAX_LABEL,
} from "@/src/utils/cloudStorage/uploadPolicy";
import {
  DUPLICATE_USER_MESSAGE,
  isUploadUiLocked,
  phaseAfterSyncResult,
  phaseAfterUploadResults,
  shouldRunSyncAfterUploadResults,
  UPLOAD_PHASE,
  UPLOADED_AND_INDEXED_MESSAGE,
  UPLOADED_INDEXING_MESSAGE,
  UPLOADED_SYNC_FAILED_MESSAGE,
  uploadButtonLabel,
  uploadPhaseLiveMessage,
} from "@/src/utils/cloudStorage/uploadFlow";

const TOO_LARGE = `Dosya çok büyük. En fazla ${DRIVE_UPLOAD_MAX_LABEL} yükleyebilirsiniz.`;

type UploadItem = {
  id: string;
  name: string;
  size: number;
  status: string;
  message: string;
  file?: File;
};

function statusLabel(status: string) {
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

export default function TaxpayerUploadClient() {
  const { selectedCompanyId } = useCompanyList();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploadPhase, setUploadPhase] = useState<string>(UPLOAD_PHASE.IDLE);
  const [uploadSyncFailed, setUploadSyncFailed] = useState(false);
  const [error, setError] = useState("");

  const uploadLocked = isUploadUiLocked(uploadPhase);
  const uploadLiveMessage = uploadPhaseLiveMessage(uploadPhase, {
    syncError: uploadSyncFailed,
  });
  const canUpload = Boolean(selectedCompanyId) && !uploadLocked;

  const runSync = useCallback(async (companyId: string) => {
    const response = await fetch("/api/google-drive/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || body.message || UPLOADED_SYNC_FAILED_MESSAGE);
    }
    return body;
  }, []);

  const handleUploadFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      if (!canUpload || !selectedCompanyId) return;
      const files = Array.from(fileList || []);
      if (!files.length) return;

      const items: UploadItem[] = files.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        size: file.size,
        status: file.size > DRIVE_UPLOAD_MAX_BYTES ? "error" : "pending",
        message: file.size > DRIVE_UPLOAD_MAX_BYTES ? TOO_LARGE : "",
        file,
      }));

      setUploadItems(items);
      setUploadSyncFailed(false);
      setUploadPhase(UPLOAD_PHASE.UPLOADING);
      setError("");

      const resultStatuses = items.map((item) => item.status);

      try {
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          if (item.status === "error") {
            resultStatuses[index] = "error";
            continue;
          }

          setUploadItems((prev) =>
            prev.map((row) =>
              row.id === item.id ? { ...row, status: "uploading", message: "" } : row
            )
          );

          try {
            if (!item.file?.size) {
              throw new Error("Boş dosya yüklenemez.");
            }
            const form = new FormData();
            form.set("companyId", selectedCompanyId);
            form.set("file", item.file, item.file.name);
            const response = await fetch("/api/google-drive/files/upload", {
              method: "POST",
              credentials: "include",
              body: form,
            });
            const body = await response.json().catch(() => ({}));

            if (response.status === 409 && body?.code === "DUPLICATE_CONTENT") {
              resultStatuses[index] = "duplicate";
              setUploadItems((prev) =>
                prev.map((row) =>
                  row.id === item.id
                    ? { ...row, status: "duplicate", message: DUPLICATE_USER_MESSAGE }
                    : row
                )
              );
              continue;
            }

            if (!response.ok) {
              throw new Error(body.message || body.error || "Yükleme başarısız.");
            }

            resultStatuses[index] = "success";
            setUploadItems((prev) =>
              prev.map((row) =>
                row.id === item.id
                  ? { ...row, status: "success", message: UPLOADED_INDEXING_MESSAGE }
                  : row
              )
            );
          } catch (uploadError) {
            resultStatuses[index] = "error";
            const message =
              uploadError instanceof Error
                ? uploadError.message
                : "Yükleme başarısız.";
            setUploadItems((prev) =>
              prev.map((row) =>
                row.id === item.id ? { ...row, status: "error", message } : row
              )
            );
          }
        }

        const nextPhase = phaseAfterUploadResults(resultStatuses);
        if (!shouldRunSyncAfterUploadResults(resultStatuses)) {
          setUploadPhase(nextPhase);
          if (nextPhase === UPLOAD_PHASE.ERROR) {
            setError("Yükleme başarısız. Tekrar deneyebilirsiniz.");
          }
          return;
        }

        setUploadPhase(UPLOAD_PHASE.SYNCING);
        try {
          await runSync(selectedCompanyId);
          setUploadPhase(phaseAfterSyncResult({ ok: true }));
          setUploadSyncFailed(false);
          setUploadItems((prev) =>
            prev.map((row) =>
              row.status === "success"
                ? { ...row, message: UPLOADED_AND_INDEXED_MESSAGE }
                : row
            )
          );
        } catch (syncError) {
          setUploadSyncFailed(true);
          setUploadPhase(phaseAfterSyncResult({ ok: false }));
          setUploadItems((prev) =>
            prev.map((row) =>
              row.status === "success"
                ? { ...row, message: UPLOADED_SYNC_FAILED_MESSAGE }
                : row
            )
          );
          setError(
            syncError instanceof Error
              ? syncError.message
              : UPLOADED_SYNC_FAILED_MESSAGE
          );
        }
      } catch (caught) {
        setUploadPhase(UPLOAD_PHASE.ERROR);
        setError(caught instanceof Error ? caught.message : "Yükleme başarısız.");
      }
    },
    [canUpload, runSync, selectedCompanyId]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-400/80">
          Mükellef Portalı
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
          Evrak Yükle
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {DRIVE_UPLOAD_ACCEPT_HINT}. Klasör seçimi gerekmez; sistem dosyayı
          otomatik sınıflandırır.
        </p>
      </header>

      <TaxpayerCompanyBar />

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          if (canUpload) setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (canUpload) setDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void handleUploadFiles(event.dataTransfer.files);
        }}
        className={`rounded-2xl border border-dashed px-6 py-10 text-center transition ${
          dragOver
            ? "border-sky-500 bg-sky-950/30"
            : "border-zinc-700 bg-zinc-950/50"
        } ${!canUpload ? "opacity-60" : ""}`}
      >
        <p className="text-sm font-medium text-zinc-200">
          Dosyaları buraya bırakın veya seçin
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          En fazla {DRIVE_UPLOAD_MAX_LABEL} / dosya · çoklu yükleme desteklenir
        </p>
        <label
          className={`mt-4 inline-flex cursor-pointer items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${
            canUpload ? "bg-sky-600 hover:bg-sky-500" : "bg-sky-900/50"
          }`}
        >
          {uploadButtonLabel(uploadPhase)}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={DRIVE_UPLOAD_ACCEPT}
            disabled={!canUpload}
            className="hidden"
            onChange={(event) => {
              void handleUploadFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        {!selectedCompanyId ? (
          <p className="mt-3 text-xs text-amber-200/90">
            Yükleme için atanmış bir firma gerekir.
          </p>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {uploadLiveMessage}
      </p>
      {uploadLiveMessage ? (
        <p className="text-sm text-zinc-300" aria-hidden="true">
          {uploadLiveMessage}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-100" role="alert">
          {error}
        </p>
      ) : null}

      {uploadItems.length ? (
        <ul className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
          {uploadItems.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-100">{item.name}</p>
                <p className="text-xs text-zinc-500">
                  {(item.size / 1024).toFixed(1)} KB · {statusLabel(item.status)}
                  {item.message ? ` — ${item.message}` : ""}
                </p>
              </div>
              {item.status === "uploading" ? (
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                  <span className="block h-full w-2/3 animate-pulse rounded-full bg-sky-500" />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
