"use client";

import { useEffect, useState } from "react";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import TaxpayerCompanyBar from "../components/TaxpayerCompanyBar";

type PublicDoc = {
  id: string;
  status?: string;
};

export default function MukellefBildirimlerPage() {
  const { selectedCompanyId } = useCompanyList();
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedCompanyId) return undefined;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setReviewCount(0);
    });

    fetch(
      `/api/google-drive/files?companyId=${encodeURIComponent(selectedCompanyId)}`,
      { cache: "no-store", credentials: "include" }
    )
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || "Liste alınamadı.");
        }
        return body;
      })
      .then((body) => {
        if (!active) return;
        const docs: PublicDoc[] = Array.isArray(body.documents)
          ? body.documents
          : [];
        const count = docs.filter((doc) => doc.status === "review_required").length;
        setReviewCount(count);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setReviewCount(0);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCompanyId]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-400/80">
          Mükellef Portalı
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
          Bildirimler
        </h1>
      </header>

      <TaxpayerCompanyBar />

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-6">
        <p className="text-sm text-zinc-300">
          Yakında bildirimler burada görünecek.
        </p>
        {loading ? (
          <p className="mt-3 text-xs text-zinc-500">Durum kontrol ediliyor…</p>
        ) : reviewCount > 0 ? (
          <p className="mt-3 rounded-xl border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            İnceleme gerekli: {reviewCount} evrak
          </p>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">
            İnceleme gerektiren evrak bulunmuyor.
          </p>
        )}
      </div>
    </div>
  );
}
