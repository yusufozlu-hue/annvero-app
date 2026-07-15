"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  enqueueParseJobs,
  hashUtf8String,
  loadObligationAccruals,
  loadParseQueue,
  saveObligationAccruals,
  saveParseQueue,
  updateParseJob,
  upsertObligationAccrual,
} from "@/src/utils/taxObligation/documentStore";
import { parseObligationDocument } from "@/src/utils/taxObligation/parserAdapter";

const STATUS_LABEL = {
  queued: "Bekliyor",
  processing: "İşleniyor",
  done: "İşlendi",
  error: "Hata",
  duplicate: "Mükerrer",
};

const ACCEPT =
  ".json,application/json,.pdf,application/pdf,.xml,application/xml,text/xml";

const FILE_TYPE_BADGES = ["PDF", "JSON", "XML"];

function isJsonDocument(fileName, text) {
  return /\.json$/i.test(fileName) || text.trim().startsWith("{");
}

/**
 * Büyük Upload Card — drag & drop + dosya seç.
 * Domain / store API aynı; localStorage hydrate mount sonrası (useEffect).
 */
export default function MaliYukumlulukUploadPanel({
  companyId = "",
  companyName = "",
}) {
  const inputRef = useRef(null);
  const jobsRef = useRef([]);
  const [jobs, setJobs] = useState([]);
  const [accrualCount, setAccrualCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const queue = loadParseQueue();
    jobsRef.current = queue;
    setJobs(queue);
    const all = loadObligationAccruals();
    setAccrualCount(
      companyId
        ? all.filter((r) => r.company_id === companyId).length
        : all.length
    );
  }, [companyId]);

  const companyJobs = useMemo(
    () =>
      (jobs || []).filter((j) => !companyId || j.companyId === companyId),
    [jobs, companyId]
  );

  const persistJobs = useCallback((next) => {
    jobsRef.current = next;
    setJobs(next);
    saveParseQueue(next);
  }, []);

  const processFiles = useCallback(
    async (filesInput) => {
      const files = Array.from(filesInput || []);
      if (!files.length) return;
      if (!companyId) {
        setMessage("Önce firma seçin.");
        return;
      }

      setBusy(true);
      setMessage("");
      let nextJobs = enqueueParseJobs(jobsRef.current, files, { companyId });
      persistJobs(nextJobs);

      for (const file of files) {
        const job = nextJobs.find(
          (j) =>
            j.fileName === file.name &&
            j.status === "queued" &&
            j.companyId === companyId
        );
        if (!job) continue;
        try {
          const text = await file.text();
          nextJobs = updateParseJob(nextJobs, job.id, {
            status: "processing",
            progress: 10,
          });
          persistJobs(nextJobs);

          if (!isJsonDocument(file.name, text)) {
            const kind = /\.pdf$/i.test(file.name)
              ? "PDF OCR"
              : /\.xml$/i.test(file.name)
                ? "XML parse"
                : "Bu dosya türü";
            nextJobs = updateParseJob(nextJobs, job.id, {
              status: "error",
              progress: 100,
              error: `${kind} henüz hazır değil. Şimdilik JSON tahakkuk dosyası yükleyin.`,
            });
            persistJobs(nextJobs);
            continue;
          }

          const hash = hashUtf8String(text);
          const parsed = parseObligationDocument({
            jsonText: text,
            fileMeta: {
              companyId,
              name: file.name,
              hash,
              id: job.id,
            },
          });
          if (!parsed.ok) {
            nextJobs = updateParseJob(nextJobs, job.id, {
              status: "error",
              progress: 100,
              error: parsed.error,
            });
            persistJobs(nextJobs);
            continue;
          }

          const existing = loadObligationAccruals();
          const result = upsertObligationAccrual(existing, {
            ...parsed.accrual,
            company_id: parsed.accrual.company_id || companyId,
            source_file_hash: hash,
          });
          saveObligationAccruals(result.records);
          setAccrualCount(
            result.records.filter((r) => r.company_id === companyId).length
          );

          nextJobs = updateParseJob(nextJobs, job.id, {
            status: result.duplicate ? "duplicate" : "done",
            progress: 100,
            accrualId: result.accrual.id,
            error: result.duplicate
              ? "Bu belge daha önce yüklendi (aynı firma + dosya)."
              : "",
          });
          persistJobs(nextJobs);
        } catch (err) {
          nextJobs = updateParseJob(nextJobs, job.id, {
            status: "error",
            progress: 100,
            error: err?.message || "Okuma hatası",
          });
          persistJobs(nextJobs);
        }
      }

      setBusy(false);
      setMessage(
        `Yükleme tamamlandı. Bu firma için ${
          loadObligationAccruals().filter((r) => r.company_id === companyId)
            .length
        } tahakkuk kaydı.`
      );
    },
    [companyId, persistJobs]
  );

  const onInputChange = (event) => {
    const files = event.target.files;
    event.target.value = "";
    void processFiles(files);
  };

  const onDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (busy || !companyId) {
      if (!companyId) setMessage("Önce firma seçin.");
      return;
    }
    void processFiles(event.dataTransfer?.files);
  };

  return (
    <section className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/40 shadow-sm shadow-black/10">
      <div className="flex flex-col gap-1 border-b border-slate-800/80 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">
            Belge yükleme
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            PDF, JSON veya XML tahakkuk / beyanname belgelerini sürükleyin ya da
            seçin. OCR ve XML parse sonraki adımlarda bağlanacak.
          </p>
        </div>
        <p className="shrink-0 text-xs text-slate-500">
          {companyName ? companyName : "Firma seçili değil"}
          {accrualCount > 0 ? ` · ${accrualCount} kayıt` : ""}
        </p>
      </div>

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!busy && companyId) inputRef.current?.click();
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
          }}
          onDrop={onDrop}
          onClick={() => {
            if (!busy && companyId) inputRef.current?.click();
          }}
          className={`flex min-h-[220px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition sm:min-h-[260px] ${
            dragOver
              ? "border-sky-500 bg-sky-950/30"
              : "border-slate-700 bg-slate-950/60 hover:border-slate-500 hover:bg-slate-900/50"
          } ${!companyId || busy ? "cursor-not-allowed opacity-70" : ""}`}
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-sky-300">
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden
            >
              <path
                d="M12 16V4m0 0 4 4m-4-4-4 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="text-base font-semibold text-slate-100">
            Dosyaları buraya bırakın
          </p>
          <p className="mt-1.5 max-w-md text-sm text-slate-400">
            veya tıklayarak seçin · PDF · JSON · XML
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {FILE_TYPE_BADGES.map((ext) => (
              <span
                key={ext}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-300"
              >
                {ext}
              </span>
            ))}
          </div>
          {!companyId ? (
            <p className="mt-4 text-xs font-medium text-amber-200">
              Yüklemek için önce firma seçin
            </p>
          ) : null}
          {busy ? (
            <p className="mt-4 text-xs font-medium text-sky-200">İşleniyor…</p>
          ) : null}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          disabled={busy || !companyId}
          onChange={onInputChange}
        />

        {message ? (
          <p className="mt-4 text-sm text-emerald-200/90">{message}</p>
        ) : null}

        {companyJobs.length > 0 ? (
          <ul className="mt-4 max-h-40 space-y-1.5 overflow-y-auto text-xs">
            {companyJobs
              .slice()
              .reverse()
              .slice(0, 8)
              .map((j) => (
                <li
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/80 px-2.5 py-1.5 text-slate-300"
                >
                  <span className="min-w-0 truncate">{j.fileName || "—"}</span>
                  <span className="shrink-0 text-slate-400">
                    {STATUS_LABEL[j.status] || j.status}
                  </span>
                  {j.error ? (
                    <span className="w-full text-[11px] text-rose-300">
                      {j.error}
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
