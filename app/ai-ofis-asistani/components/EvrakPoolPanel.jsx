"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import AnnveroDataTable from "@/src/components/AnnveroDataTable";
import {
  AI_OFIS_DOCUMENT_STATUS,
  AI_OFIS_DOCUMENT_TYPES,
  AI_OFIS_WORKFLOW_STATUS,
  AI_OFIS_WORKFLOW_STATUS_LIST,
} from "@/src/config/aiOfisAsistaniDefaults";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { getModuleRouteForType } from "@/src/utils/aiOfisAsistaniEngine";
import { loadCachedUsers } from "@/src/utils/annveroUserStore";

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20";

const VIEW_MODES = [
  { id: "card", label: "Kart" },
  { id: "list", label: "Liste" },
  { id: "table", label: "Tablo" },
];

function AiBadge({ confidence }) {
  const score = Number(confidence || 0);
  const tone =
    score >= 80
      ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30"
      : score >= 55
        ? "bg-amber-500/15 text-amber-200 ring-amber-500/30"
        : "bg-red-500/15 text-red-200 ring-red-500/30";
  return (
    <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ring-1 ${tone}`}>
      AI %{score || 0}
    </span>
  );
}

export function DocumentTimeline({ doc, history = [] }) {
  const events = useMemo(() => {
    const base = [
      {
        id: "upload",
        label: "Yükleme",
        at: doc.uploadedAt || doc.createdAt,
        detail: doc.source,
      },
      {
        id: "classify",
        label: "Sınıflandırma",
        at: doc.updatedAt || doc.createdAt,
        detail: doc.classificationExplanation || doc.documentType,
      },
    ];
    const related = history
      .filter((item) => item.documentId === doc.id)
      .map((item) => ({
        id: item.id,
        label: item.action,
        at: item.createdAt,
        detail: item.message,
      }));
    return [...base, ...related].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [doc, history]);

  return (
    <ol className="space-y-2 border-l border-slate-700 pl-4">
      {events.map((event) => (
        <li key={event.id} className="relative text-xs">
          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-cyan-500" />
          <p className="font-semibold text-slate-200">{event.label}</p>
          <p className="text-slate-400">{event.detail}</p>
          <p className="text-slate-500">{event.at?.slice(0, 19).replace("T", " ")}</p>
        </li>
      ))}
    </ol>
  );
}

export function DocumentCard({ doc, companies, assignees = [], onUpdate, onRoute, onPreview, history }) {
  return (
    <article className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => onPreview(doc)}
            className="text-left font-semibold text-white hover:text-cyan-200"
          >
            {doc.fileName || "İsimsiz evrak"}
          </button>
          <p className="text-sm text-slate-400">
            {doc.companyName || "Firma belirsiz"} · {doc.documentType} · {doc.source}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <AiBadge confidence={doc.aiConfidence} />
            <span className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300">
              {doc.status}
            </span>
            {doc.missingInfo ? (
              <span className="rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                Manuel kontrol
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {doc.uploadedAt?.slice(0, 10)} · {doc.targetModule} ·{" "}
            {doc.assignedUser || "Atanmamış"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPreview(doc)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200"
          >
            Önizle
          </button>
          <button
            type="button"
            onClick={() => onRoute(doc)}
            className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold hover:bg-cyan-500"
          >
            Modüle Aktar
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-400">
          Firma
          <select
            className={`${inputClassName} mt-1`}
            value={doc.companyId || ""}
            onChange={(e) => {
              const company = companies.find((item) => item.id === e.target.value);
              onUpdate(doc.id, {
                companyId: e.target.value,
                companyName: getCompanyDisplayName(company),
              });
            }}
          >
            <option value="">Seçin</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {getCompanyDisplayName(company)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Evrak Türü
          <select
            className={`${inputClassName} mt-1`}
            value={doc.documentType}
            onChange={(e) => {
              const route = getModuleRouteForType(e.target.value);
              onUpdate(doc.id, {
                documentType: e.target.value,
                targetModule: route.label,
                targetModuleHref: route.href,
              });
            }}
          >
            {AI_OFIS_DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          İş Akışı Durumu
          <select
            className={`${inputClassName} mt-1`}
            value={doc.workflowStatus || AI_OFIS_WORKFLOW_STATUS.YENI}
            onChange={(e) =>
              onUpdate(doc.id, {
                workflowStatus: e.target.value,
                status:
                  e.target.value === AI_OFIS_WORKFLOW_STATUS.TAMAMLANDI
                    ? AI_OFIS_DOCUMENT_STATUS.ISLENDI
                    : doc.status,
              })
            }
          >
            {AI_OFIS_WORKFLOW_STATUS_LIST.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Atanan Kullanıcı
          <select
            className={`${inputClassName} mt-1`}
            value={doc.assignedUser || ""}
            onChange={(e) =>
              onUpdate(doc.id, {
                assignedUser: e.target.value,
                responsibleUser: e.target.value,
              })
            }
          >
            <option value="">Seçin</option>
            {assignees.map((user) => (
              <option key={user.email} value={user.email}>
                {user.displayName || user.email}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Ekip
          <input
            className={`${inputClassName} mt-1`}
            value={doc.assignedTeam || ""}
            onChange={(e) => onUpdate(doc.id, { assignedTeam: e.target.value })}
            placeholder="Muhasebe / Bordro / Denetim"
          />
        </label>
        <label className="text-xs text-slate-400">
          Durum
          <select
            className={`${inputClassName} mt-1`}
            value={doc.status}
            onChange={(e) => onUpdate(doc.id, { status: e.target.value })}
          >
            {Object.values(AI_OFIS_DOCUMENT_STATUS).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-semibold text-cyan-300">
          İşlem geçmişi / timeline
        </summary>
        <div className="mt-3">
          <DocumentTimeline doc={doc} history={history} />
        </div>
      </details>
    </article>
  );
}

function DocumentListRow({ doc, companies, onUpdate, onRoute, onPreview }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <button
        type="button"
        onClick={() => onPreview(doc)}
        className="min-w-[180px] flex-1 text-left text-sm font-semibold text-white hover:text-cyan-200"
      >
        {doc.fileName}
      </button>
      <span className="text-xs text-slate-400">{doc.companyName || "—"}</span>
      <span className="text-xs text-slate-400">{doc.documentType}</span>
      <span className="text-xs text-slate-500">{doc.source}</span>
      <AiBadge confidence={doc.aiConfidence} />
      <span className="text-xs text-slate-400">{doc.status}</span>
      <span className="text-xs text-slate-500">{doc.targetModule}</span>
      <span className="text-xs text-slate-500">{doc.uploadedAt?.slice(0, 10)}</span>
      <select
        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
        value={doc.companyId || ""}
        onChange={(e) => {
          const company = companies.find((item) => item.id === e.target.value);
          onUpdate(doc.id, {
            companyId: e.target.value,
            companyName: getCompanyDisplayName(company),
          });
        }}
      >
        <option value="">Firma</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {getCompanyDisplayName(company)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onRoute(doc)}
        className="rounded-lg bg-cyan-600 px-2 py-1 text-xs font-semibold"
      >
        Aktar
      </button>
    </div>
  );
}

export default function EvrakPoolPanel({
  documents = [],
  companies = [],
  history = [],
  onUploadFiles,
  onUpdate,
  onRoute,
}) {
  const [viewMode, setViewMode] = useState("card");
  const [previewDoc, setPreviewDoc] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const assignees = useMemo(() => loadCachedUsers(), []);

  const tableColumns = useMemo(
    () => [
      { key: "fileName", label: "Dosya adı", sortable: true },
      { key: "companyName", label: "Firma", sortable: true },
      { key: "documentType", label: "Evrak türü", sortable: true },
      { key: "source", label: "Kaynak", sortable: true },
      {
        key: "aiConfidence",
        label: "AI güven",
        sortable: true,
        render: (row) => <AiBadge confidence={row.aiConfidence} />,
        exportValue: (row) => row.aiConfidence,
      },
      { key: "status", label: "Durum", sortable: true },
      { key: "targetModule", label: "İlgili modül", sortable: true },
      {
        key: "uploadedAt",
        label: "İşlem tarihi",
        sortable: true,
        render: (row) => row.uploadedAt?.slice(0, 10) || "—",
      },
      {
        key: "workflowStatus",
        label: "İş akışı",
        render: (row) => row.workflowStatus || AI_OFIS_WORKFLOW_STATUS.YENI,
      },
      {
        key: "assignedUser",
        label: "Atanan",
        render: (row) => row.assignedUser || row.responsibleUser || "—",
      },
    ],
    []
  );

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragActive(false);
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) onUploadFiles?.(files);
    },
    [onUploadFiles]
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Evrak Havuzu</h2>
        <div className="flex flex-wrap items-center gap-2">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setViewMode(mode.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                viewMode === mode.id
                  ? "bg-cyan-600 text-white"
                  : "border border-slate-700 text-slate-300"
              }`}
            >
              {mode.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold hover:bg-cyan-500"
          >
            Dosya yükle
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length) onUploadFiles?.(files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition ${
          dragActive
            ? "border-cyan-400 bg-cyan-950/20"
            : "border-slate-700 bg-slate-900/40"
        }`}
      >
        <p className="text-sm text-slate-300">
          Dosyaları buraya sürükleyip bırakın veya çoklu dosya yükleyin
        </p>
        <p className="mt-1 text-xs text-slate-500">
          PDF, Excel, XML ve diğer evrak formatları desteklenir
        </p>
      </div>

      {documents.length === 0 ? (
        <p className="rounded-2xl border border-gray-800 bg-gray-900 p-6 text-sm text-slate-400">
          Kayıt bulunamadı.
        </p>
      ) : viewMode === "card" ? (
        <div className="space-y-3">
          {documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              companies={companies}
              assignees={assignees}
              history={history}
              onUpdate={onUpdate}
              onRoute={onRoute}
              onPreview={setPreviewDoc}
            />
          ))}
        </div>
      ) : viewMode === "list" ? (
        <div className="space-y-2">
          {documents.map((doc) => (
            <DocumentListRow
              key={doc.id}
              doc={doc}
              companies={companies}
              onUpdate={onUpdate}
              onRoute={onRoute}
              onPreview={setPreviewDoc}
            />
          ))}
        </div>
      ) : (
        <AnnveroDataTable
          columns={tableColumns}
          rows={documents}
          rowKey="id"
          pageSize={25}
          enableVirtualScroll={documents.length > 80}
          searchPlaceholder="Evrak ara..."
          exportFilename="evrak-havuzu.csv"
        />
      )}

      {previewDoc ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{previewDoc.fileName}</h3>
                <p className="text-sm text-slate-400">
                  {previewDoc.companyName} · {previewDoc.documentType}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300"
              >
                Kapat
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-slate-300">
              <div>Kaynak: {previewDoc.source}</div>
              <div>Durum: {previewDoc.status}</div>
              <div>Modül: {previewDoc.targetModule}</div>
              <div>
                AI: %{previewDoc.aiConfidence} ({previewDoc.classificationSource})
              </div>
              <div className="col-span-2">
                Açıklama: {previewDoc.description || previewDoc.classificationExplanation || "—"}
              </div>
            </div>
            <div className="mt-6">
              <h4 className="mb-2 text-sm font-semibold text-cyan-300">Timeline</h4>
              <DocumentTimeline doc={previewDoc} history={history} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
