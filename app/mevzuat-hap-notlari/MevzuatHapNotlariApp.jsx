"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PublicHeader from "@/app/components/landing/PublicHeader";
import {
  MEVZUAT_HAP_NOTU_CATEGORIES,
  MEVZUAT_HAP_NOTU_SOURCES,
  formatMevzuatDate,
} from "@/src/utils/mevzuatHapNotlariSchema";

const inputClass =
  "w-full rounded-xl border border-violet-100 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-500";

export default function MevzuatHapNotlariApp() {
  const [notes, setNotes] = useState([]);
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (source) params.set("source", source);
    if (search.trim()) params.set("search", search.trim());

    async function loadNotes() {
      setLoading(true);
      setErrorMessage("");
      try {
        const query = params.toString();
        const response = await fetch(
          query ? `/api/mevzuat-hap-notlari?${query}` : "/api/mevzuat-hap-notlari",
          { cache: "no-store" }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Hap notları yüklenemedi.");
        }
        if (active) {
          setNotes(payload.data || []);
          setNotice(payload.meta?.notice || "");
        }
      } catch (error) {
        if (active) {
          setNotes([]);
          setErrorMessage(error instanceof Error ? error.message : "Hap notları yüklenemedi.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadNotes();
    return () => {
      active = false;
    };
  }, [category, source, search]);

  const activeFilterCount = useMemo(
    () => [category, source, search.trim()].filter(Boolean).length,
    [category, source, search]
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <header className="mb-8 flex flex-col gap-4 border-b border-violet-100 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/"
              className="text-sm font-semibold text-violet-700 transition hover:text-violet-900"
            >
              ← Ana Sayfa
            </Link>
            <p className="mt-5 text-sm font-medium uppercase tracking-[0.2em] text-violet-700">
              Mali Gündem
            </p>
            <h1 className="mt-2 text-3xl font-bold sm:text-5xl">Mevzuat Hap Notları</h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600">
              Vergi, SGK ve mali mevzuat duyurularını kısa notlar halinde takip edin.
            </p>
          </div>
          <div className="rounded-2xl border border-violet-100 bg-white px-5 py-4 shadow-sm">
            <div className="text-3xl font-bold">{notes.length}</div>
            <div className="text-sm text-slate-500">Aktif hap not</div>
          </div>
        </header>

        <section className="mb-8 grid grid-cols-1 gap-4 rounded-3xl border border-violet-100 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4">
          <label>
            <span className="mb-2 block text-sm text-slate-500">Arama</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Başlık veya kısa not ara..."
              className={inputClass}
            />
          </label>
          <label>
            <span className="mb-2 block text-sm text-slate-500">Kategori</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={inputClass}
            >
              <option value="">Tüm Kategoriler</option>
              {MEVZUAT_HAP_NOTU_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-sm text-slate-500">Kaynak</span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className={inputClass}
            >
              <option value="">Tüm Kaynaklar</option>
              {MEVZUAT_HAP_NOTU_SOURCES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setCategory("");
                setSource("");
              }}
              className="w-full rounded-xl border border-violet-100 px-4 py-3 text-sm font-semibold text-violet-700 transition hover:bg-violet-50"
            >
              Filtreleri Temizle
            </button>
          </div>
        </section>

        {notice ? (
          <div className="mb-6 rounded-2xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            {notice}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mb-6 rounded-2xl border border-red-700/40 bg-red-950/30 px-4 py-3 text-sm text-red-100">
            {errorMessage}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-3xl border border-violet-100 bg-white p-8 text-center text-slate-500 shadow-sm">
            Hap notlar yükleniyor...
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Kayıt bulunamadı</h2>
            <p className="mt-2 text-sm text-slate-500">
              {activeFilterCount
                ? "Seçili filtrelere uygun aktif hap not bulunmuyor."
                : "Henüz aktif mevzuat hap notu eklenmemiş."}
            </p>
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {notes.map((note) => (
              <article
                key={note.id}
                className={`rounded-3xl border bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-500/10 ${
                  note.isPinned ? "border-violet-300" : "border-violet-100"
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {note.isPinned ? (
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
                      Sabit
                    </span>
                  ) : null}
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {note.category}
                  </span>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    {note.source}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatMevzuatDate(note.publishedAt)}
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-slate-900">{note.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{note.summary}</p>
                {note.sourceUrl ? (
                  <a
                    href={note.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-5 inline-flex rounded-full bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800"
                  >
                    Kaynağa Git
                  </a>
                ) : null}
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
