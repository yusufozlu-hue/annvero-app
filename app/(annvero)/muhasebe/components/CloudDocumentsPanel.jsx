"use client";

import { useEffect, useState } from "react";

/**
 * Firma Yönetimi → Evraklar: ortak document_index (company_id filtreli).
 * Firma kartı JSON’una yazmaz; Ticaret Sicil yerel listesini kullanmaz.
 * Üst bileşen firma değişiminde key={companyId} vermeli (önceki liste anında düşer).
 */
export default function CloudDocumentsPanel({ companyId = "", onNotify }) {
  const [documents, setDocuments] = useState([]);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [loading, setLoading] = useState(Boolean(companyId));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) {
      return undefined;
    }

    let active = true;

    fetch(
      `/api/google-drive/files?companyId=${encodeURIComponent(companyId)}`,
      { cache: "no-store" }
    )
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || "Evrak listesi alınamadı.");
        }
        return body;
      })
      .then((body) => {
        if (!active) return;
        setDocuments(Array.isArray(body.documents) ? body.documents : []);
        setLastSyncAt(body.lastSyncAt || null);
        setError("");
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        const message = err?.message || "Evrak listesi alınamadı.";
        setError(message);
        setDocuments([]);
        setLoading(false);
        if (typeof onNotify === "function") onNotify(message, "error");
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast kimliği her render'da değişebilir
  }, [companyId]);

  const formatSync = (value) => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString("tr-TR");
    } catch {
      return "—";
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-white">Evraklar</h3>
        <p className="mt-1 text-sm text-slate-400">
          Bu firma için Google Drive belge indeksinden okunur. Veri firma kartına
          kopyalanmaz.
        </p>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {loading
          ? "Evraklar yükleniyor."
          : error
            ? error
            : `${documents.length} evrak listelendi.`}
      </p>

      {error ? (
        <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">Evraklar yükleniyor…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-slate-400">
          Henüz indekslenmiş evrak yok. Bulut Depolama’dan yükleyip
          senkronize edin.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="border-b border-slate-800 bg-slate-950/80 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Dosya adı</th>
                <th className="px-3 py-2 font-medium">Tür</th>
                <th className="px-3 py-2 font-medium">Klasör yolu</th>
                <th className="px-3 py-2 font-medium">Kaynak</th>
                <th className="px-3 py-2 font-medium">Son senkronizasyon</th>
                <th className="px-3 py-2 font-medium">Durum</th>
                <th className="px-3 py-2 font-medium">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  className="border-b border-slate-800/80 last:border-0"
                >
                  <td className="px-3 py-2 font-medium text-white">
                    {doc.fileName}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{doc.fileType}</td>
                  <td
                    className="max-w-[14rem] truncate px-3 py-2 text-slate-400"
                    title={doc.folderPath}
                  >
                    {doc.folderPath}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{doc.source}</td>
                  <td className="px-3 py-2 text-slate-400">
                    {formatSync(doc.lastSyncAt || lastSyncAt)}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{doc.statusLabel}</td>
                  <td className="px-3 py-2">
                    {doc.openPath && doc.status !== "missing" ? (
                      <a
                        href={doc.openPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 hover:text-sky-300"
                      >
                        Drive’da Aç
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
