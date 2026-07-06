"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMevzuatDate } from "@/src/utils/mevzuatHapNotlariSchema";

export default function PublicMevzuatHapNotlariSection() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadNotes() {
      try {
        const response = await fetch("/api/mevzuat-hap-notlari?limit=4", {
          cache: "no-store",
        });
        const payload = await response.json();
        if (active && response.ok) {
          setNotes(payload.data || []);
        }
      } catch {
        if (active) setNotes([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadNotes();
    return () => {
      active = false;
    };
  }, []);

  return (
    <section id="mali-gundem" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-violet-700">
            Mali Gündem
          </p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">
            Güncel Mevzuat Hap Notları
          </h2>
          <p className="mt-4 text-slate-600">
            Vergi, SGK ve mali mevzuat duyurularını kısa, sade ve kaynaklı notlar
            halinde takip edin.
          </p>
        </div>
        <Link
          href="/mevzuat-hap-notlari"
          className="inline-flex w-fit items-center justify-center rounded-full bg-violet-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-800"
        >
          Bilgi Merkezine Git
        </Link>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          <div className="rounded-3xl border border-violet-100 bg-white p-6 text-sm text-slate-500 shadow-sm md:col-span-2 xl:col-span-4">
            Hap notlar yükleniyor...
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-violet-200 bg-white p-6 text-sm text-slate-500 md:col-span-2 xl:col-span-4">
            Henüz yayında hap not yok. İçerikler eklendiğinde burada görünecek.
          </div>
        ) : (
          notes.map((note) => (
            <article
              key={note.id}
              className="rounded-3xl border border-violet-100 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-500/10"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                  {note.category}
                </span>
                <span className="text-sm text-slate-500">
                  {formatMevzuatDate(note.publishedAt)}
                </span>
              </div>
              <h3 className="mt-4 line-clamp-2 text-lg font-semibold text-slate-900">
                {note.title}
              </h3>
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600">
                {note.summary}
              </p>
              <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {note.source}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
