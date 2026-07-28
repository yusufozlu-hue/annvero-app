"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import { useUserRole } from "@/src/hooks/useUserRole";
import { getCompanyDisplayName } from "@/src/utils/companies";
import TaxpayerCompanyBar from "./components/TaxpayerCompanyBar";

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

export default function MukellefHomePage() {
  const { email, role, loading: roleLoading } = useUserRole();
  const { selectedCompanyId, selectedCompany, isLoading: companyLoading } =
    useCompanyList();
  const [documents, setDocuments] = useState<PublicDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState("");

  useEffect(() => {
    if (!selectedCompanyId) return undefined;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDocsLoading(true);
      setDocuments([]);
      setDocsError("");
    });

    fetch(
      `/api/google-drive/files?companyId=${encodeURIComponent(selectedCompanyId)}`,
      { cache: "no-store", credentials: "include" }
    )
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || "Evraklar alınamadı.");
        }
        return body;
      })
      .then((body) => {
        if (!active) return;
        setDocuments(Array.isArray(body.documents) ? body.documents.slice(0, 5) : []);
        setDocsLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setDocsError(error?.message || "Evraklar alınamadı.");
        setDocuments([]);
        setDocsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCompanyId]);

  const visibleDocuments = selectedCompanyId ? documents : [];
  const pendingCount = visibleDocuments.filter(
    (doc) => doc.status === "pending" || doc.status === "review_required"
  ).length;
  const companyName = getCompanyDisplayName(selectedCompany) || "—";

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-400/80">
          Mükellef Portalı
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
          Ana Sayfa
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {roleLoading
            ? "Oturum yükleniyor…"
            : email
              ? `Hoş geldiniz, ${email}.`
              : "Hoş geldiniz."}
        </p>
      </header>

      <TaxpayerCompanyBar />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Kısa durum
          </p>
          <p className="mt-2 text-sm text-zinc-200">
            {companyLoading
              ? "Firma bilgisi yükleniyor…"
              : selectedCompanyId
                ? `${companyName} için portal hazır.`
                : "Henüz atanmış firma yok."}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            {docsLoading
              ? "Evrak özeti yükleniyor…"
              : `${visibleDocuments.length} son evrak · ${pendingCount} inceleme / bekleyen`}
          </p>
          {role ? (
            <p className="mt-3 text-xs text-zinc-500">Rol: görüntüleme</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Hızlı işlemler
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/mukellef/evrak-yukle"
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-500"
            >
              Evrak Yükle
            </Link>
            <Link
              href="/mukellef/evraklarim"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800"
            >
              Evraklarım
            </Link>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-100">Son evraklar</h2>
          <Link
            href="/mukellef/evraklarim"
            className="text-xs font-medium text-sky-400 hover:text-sky-300"
          >
            Tümünü gör
          </Link>
        </div>

        {docsError ? (
          <p className="mt-3 text-sm text-rose-300" role="alert">
            {docsError}
          </p>
        ) : null}

        {!selectedCompanyId ? (
          <p className="mt-3 text-sm text-zinc-500">Firma seçilince evraklar burada görünür.</p>
        ) : docsLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Yükleniyor…</p>
        ) : visibleDocuments.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Henüz indekslenmiş evrak yok.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-800">
            {visibleDocuments.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-100">
                    {doc.fileName || "Dosya"}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {doc.fileType || "—"} · {doc.statusLabel || doc.status || "—"} ·{" "}
                    {formatDate(doc.lastSyncAt || doc.indexedAt)}
                  </p>
                </div>
                {doc.openPath ? (
                  <a
                    href={doc.openPath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-zinc-900"
                  >
                    Aç
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
