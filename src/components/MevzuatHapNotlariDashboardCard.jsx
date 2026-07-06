"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMevzuatDate } from "@/src/utils/mevzuatHapNotlariSchema";

export default function MevzuatHapNotlariDashboardCard() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadNotes() {
      try {
        const response = await fetch("/api/mevzuat-hap-notlari?limit=5", {
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
    <div className="relative rounded-3xl bg-gradient-to-br from-cyan-500/60 via-cyan-500/10 to-transparent p-[1.5px] md:col-span-2 xl:col-span-3">
      <div className="relative h-full overflow-hidden rounded-[22px] bg-gray-900/90 p-6 shadow-xl shadow-black/30 backdrop-blur-xl">
        <div className="pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full bg-cyan-500/25 opacity-70 blur-2xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300/80">
              Güncel Mevzuat
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-100">
              Güncel Mevzuat Hap Notları
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">
              Vergi, SGK ve mali mevzuat duyurularından kısa notlar.
            </p>
          </div>
          <Link
            href="/mevzuat-hap-notlari"
            className="relative inline-flex w-fit items-center justify-center rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
          >
            Tümünü Gör
          </Link>
        </div>

        <div className="relative mt-5 grid grid-cols-1 gap-3 lg:grid-cols-5">
          {loading ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-400 lg:col-span-5">
              Hap notlar yükleniyor...
            </div>
          ) : notes.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-400 lg:col-span-5">
              Henüz aktif mevzuat hap notu yok.
            </div>
          ) : (
            notes.map((note) => (
              <article
                key={note.id}
                className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4"
              >
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {note.isPinned ? (
                    <span className="rounded-full bg-cyan-950 px-2 py-0.5 text-[11px] font-semibold text-cyan-200">
                      Sabit
                    </span>
                  ) : null}
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[11px] font-semibold text-gray-300">
                    {note.category}
                  </span>
                </div>
                <h3 className="line-clamp-2 text-sm font-semibold text-white">{note.title}</h3>
                <p className="mt-2 text-xs text-gray-500">
                  {note.source} · {formatMevzuatDate(note.publishedAt)}
                </p>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
