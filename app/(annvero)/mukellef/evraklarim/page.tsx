"use client";

import { useEffect, useMemo, useState } from "react";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import TaxpayerCompanyBar from "../components/TaxpayerCompanyBar";

type PublicDoc = {
  id: string;
  fileName?: string;
  fileType?: string;
  statusLabel?: string;
  status?: string;
  lastSyncAt?: string | null;
  indexedAt?: string | null;
  openPath?: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("tr-TR");
  } catch {
    return "—";
  }
}

export default function MukellefEvraklarimPage() {
  const { selectedCompanyId } = useCompanyList();
  const [documents, setDocuments] = useState<PublicDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!selectedCompanyId) return undefined;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setDocuments([]);
      setError("");
      setQuery("");
      setStatusFilter("all");
    });

    fetch(
      `/api/google-drive/files?companyId=${encodeURIComponent(selectedCompanyId)}`,
      { cache: "no-store", credentials: "include" }
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
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || "Evrak listesi alınamadı.");
        setDocuments([]);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCompanyId]);

  const filtered = useMemo(() => {
    if (!selectedCompanyId) return [];
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return documents.filter((doc) => {
      if (statusFilter !== "all" && doc.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${doc.fileName || ""} ${doc.fileType || ""} ${doc.statusLabel || ""}`
        .toLocaleLowerCase("tr-TR");
      return hay.includes(q);
    });
  }, [documents, query, statusFilter, selectedCompanyId]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    documents.forEach((doc) => {
      if (doc.status) set.add(doc.status);
    });
    return Array.from(set).sort();
  }, [documents]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-400/80">
          Mükellef Portalı
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
          Evraklarım
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Firmaya ait indekslenmiş belgeler. Teknik kimlikler gösterilmez.
        </p>
      </header>

      <TaxpayerCompanyBar />

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ada veya türe göre ara…"
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-sky-500/60"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-sky-500/60 sm:w-48"
        >
          <option value="all">Tüm durumlar</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-100" role="alert">
          {error}
        </p>
      ) : null}

      {!selectedCompanyId ? (
        <p className="text-sm text-zinc-500">Firma seçilince liste burada görünür.</p>
      ) : loading ? (
        <p className="text-sm text-zinc-500">Evraklar yükleniyor…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">Gösterilecek evrak yok.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="min-w-full text-left text-sm text-zinc-200">
            <thead className="border-b border-zinc-800 bg-zinc-950/80 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Ad</th>
                <th className="px-4 py-3 font-semibold">Tür</th>
                <th className="px-4 py-3 font-semibold">Durum</th>
                <th className="px-4 py-3 font-semibold">Senkron</th>
                <th className="px-4 py-3 font-semibold">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.map((doc) => (
                <tr key={doc.id} className="bg-zinc-950/40">
                  <td className="max-w-[18rem] truncate px-4 py-3 font-medium text-zinc-100">
                    {doc.fileName || "Dosya"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{doc.fileType || "—"}</td>
                  <td className="px-4 py-3 text-zinc-300">
                    {doc.statusLabel || doc.status || "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {formatDate(doc.lastSyncAt || doc.indexedAt)}
                  </td>
                  <td className="px-4 py-3">
                    {doc.openPath ? (
                      <a
                        href={doc.openPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-zinc-900"
                      >
                        Aç
                      </a>
                    ) : (
                      "—"
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
