"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  MEVZUAT_HAP_NOTU_CATEGORIES,
  MEVZUAT_HAP_NOTU_SOURCES,
  formatMevzuatDate,
} from "@/src/utils/mevzuatHapNotlariSchema";

const inputClass =
  "w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-500";

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
    <main className="min-h-screen bg-black p-6 text-white sm:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-4 border-b border-gray-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-violet-300 transition hover:text-violet-100"
            >
              ← Dashboard
            </Link>
            <p className="mt-5 text-sm font-medium uppercase tracking-[0.2em] text-gray-500">
              Mevzuat Takibi
            </p>
            <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Mevzuat Hap Notları</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-400">
              Vergi, SGK ve mali mevzuat duyurularını kısa notlar halinde takip edin.
            </p>
          </div>
          <div className="rounded-2xl border border-violet-800/50 bg-violet-950/20 px-5 py-4">
            <div className="text-3xl font-bold">{notes.length}</div>
            <div className="text-sm text-gray-400">Aktif hap not</div>
          </div>
        </header>

        <section className="mb-6 grid grid-cols-1 gap-4 rounded-3xl border border-gray-800 bg-gray-900/80 p-4 md:grid-cols-2 xl:grid-cols-4">
          <label>
            <span className="mb-2 block text-sm text-gray-400">Arama</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Başlık veya kısa not ara..."
              className={inputClass}
            />
          </label>
          <label>
            <span className="mb-2 block text-sm text-gray-400">Kategori</span>
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
            <span className="mb-2 block text-sm text-gray-400">Kaynak</span>
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
              className="w-full rounded-xl border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-200 transition hover:bg-gray-800"
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
          <div className="rounded-3xl border border-gray-800 bg-gray-900 p-8 text-center text-gray-400">
            Hap notlar yükleniyor...
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-3xl border border-gray-800 bg-gray-900 p-8 text-center">
            <h2 className="text-xl font-semibold text-white">Kayıt bulunamadı</h2>
            <p className="mt-2 text-sm text-gray-400">
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
                className={`rounded-3xl border bg-gray-900/85 p-5 shadow-xl shadow-black/20 ${
                  note.isPinned ? "border-violet-600/60" : "border-gray-800"
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {note.isPinned ? (
                    <span className="rounded-full bg-violet-950 px-2.5 py-1 text-xs font-semibold text-violet-200 ring-1 ring-violet-700/60">
                      Sabit
                    </span>
                  ) : null}
                  <span className="rounded-full bg-gray-800 px-2.5 py-1 text-xs font-semibold text-gray-200">
                    {note.category}
                  </span>
                  <span className="rounded-full bg-blue-950/60 px-2.5 py-1 text-xs font-semibold text-blue-200">
                    {note.source}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatMevzuatDate(note.publishedAt)}
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-white">{note.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-gray-300">{note.summary}</p>
                {note.sourceUrl ? (
                  <a
                    href={note.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-5 inline-flex rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500"
                  >
                    Kaynağa Git
                  </a>
                ) : null}
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
