"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAccess } from "@/src/hooks/useAdminAccess";
import {
  MEVZUAT_HAP_NOTU_CATEGORIES,
  MEVZUAT_HAP_NOTU_SOURCES,
  formatMevzuatDate,
} from "@/src/utils/mevzuatHapNotlariSchema";

const inputClass =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500";

const emptyForm = {
  title: "",
  source: "GİB",
  sourceUrl: "",
  category: "Vergi",
  summary: "",
  publishedAt: "",
  isPinned: false,
  isActive: true,
};

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export default function MevzuatHapNotlariAdminApp() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdminAccess();
  const [notes, setNotes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/dashboard?error=admin_required");
    }
  }, [adminLoading, isAdmin, router]);

  const loadNotes = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/mevzuat-hap-notlari?includeInactive=1&limit=500", {
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Kayıtlar yüklenemedi.");
      setNotes(payload.data || []);
      if (payload.meta?.notice) setMessage(payload.meta.notice);
    } catch (error) {
      setNotes([]);
      setErrorMessage(error instanceof Error ? error.message : "Kayıtlar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadNotes();
  }, [isAdmin]);

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr");
    if (!query) return notes;
    return notes.filter((note) =>
      [note.title, note.summary, note.source, note.category]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(query)
    );
  }, [notes, search]);

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId("");
  };

  const editNote = (note) => {
    setEditingId(note.id);
    setForm({
      title: note.title || "",
      source: note.source || "GİB",
      sourceUrl: note.sourceUrl || "",
      category: note.category || "Vergi",
      summary: note.summary || "",
      publishedAt: toDateTimeLocalValue(note.publishedAt),
      isPinned: Boolean(note.isPinned),
      isActive: note.isActive !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveNote = async () => {
    if (!form.title.trim() || !form.summary.trim()) {
      setErrorMessage("Başlık ve kısa not zorunludur.");
      return;
    }

    setSaving(true);
    setMessage("");
    setErrorMessage("");
    try {
      const payload = {
        ...form,
        publishedAt: fromDateTimeLocalValue(form.publishedAt),
      };
      const response = await fetch("/api/mevzuat-hap-notlari", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kayıt kaydedilemedi.");
      setMessage(editingId ? "Hap not güncellendi." : "Hap not eklendi.");
      resetForm();
      await loadNotes();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Kayıt kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  const patchNote = async (note, fields) => {
    setErrorMessage("");
    try {
      const response = await fetch("/api/mevzuat-hap-notlari", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: note.id, ...fields }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kayıt güncellenemedi.");
      await loadNotes();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Kayıt güncellenemedi.");
    }
  };

  const deleteNote = async (note) => {
    if (!window.confirm("Bu hap notu silmek istediğinize emin misiniz?")) return;
    setErrorMessage("");
    try {
      const response = await fetch(
        `/api/mevzuat-hap-notlari?id=${encodeURIComponent(note.id)}`,
        { method: "DELETE", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kayıt silinemedi.");
      if (editingId === note.id) resetForm();
      setMessage("Hap not silindi.");
      await loadNotes();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Kayıt silinemedi.");
    }
  };

  if (adminLoading || !isAdmin) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center text-gray-400">
        Yetki kontrol ediliyor...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-violet-300 transition hover:text-violet-100"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-3 text-3xl font-bold text-white">Mevzuat Hap Notları Yönetimi</h1>
          <p className="mt-2 text-sm text-gray-400">
            Kısa duyuru notlarını ekleyin, düzenleyin ve yayındaki durumunu yönetin.
          </p>
        </div>
        <Link
          href="/mevzuat-hap-notlari"
          className="inline-flex w-fit rounded-xl border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:bg-gray-800"
        >
          Sayfayı Gör
        </Link>
      </header>

      {message ? (
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
          {message}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-xl border border-red-700/40 bg-red-950/30 px-4 py-3 text-sm text-red-100">
          {errorMessage}
        </div>
      ) : null}

      <section className="rounded-3xl border border-gray-800 bg-gray-900/80 p-5">
        <h2 className="text-xl font-semibold text-white">
          {editingId ? "Hap Not Düzenle" : "Yeni Hap Not"}
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Başlık" className="md:col-span-2">
            <input
              value={form.title}
              onChange={(event) => updateForm("title", event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Kaynak">
            <select
              value={form.source}
              onChange={(event) => updateForm("source", event.target.value)}
              className={inputClass}
            >
              {MEVZUAT_HAP_NOTU_SOURCES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kategori">
            <select
              value={form.category}
              onChange={(event) => updateForm("category", event.target.value)}
              className={inputClass}
            >
              {MEVZUAT_HAP_NOTU_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kaynak URL" className="md:col-span-2">
            <input
              value={form.sourceUrl}
              onChange={(event) => updateForm("sourceUrl", event.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
          </Field>
          <Field label="Yayın Tarihi">
            <input
              type="datetime-local"
              value={form.publishedAt}
              onChange={(event) => updateForm("publishedAt", event.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={form.isPinned}
                onChange={(event) => updateForm("isPinned", event.target.checked)}
              />
              Sabit
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => updateForm("isActive", event.target.checked)}
              />
              Aktif
            </label>
          </div>
          <Field label="Kısa Not" className="md:col-span-2 xl:col-span-4">
            <textarea
              value={form.summary}
              onChange={(event) => updateForm("summary", event.target.value)}
              rows={4}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveNote}
            disabled={saving}
            className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
          >
            {saving ? "Kaydediliyor..." : editingId ? "Güncelle" : "Ekle"}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="rounded-xl border border-gray-700 px-5 py-3 text-sm font-semibold text-gray-200 transition hover:bg-gray-800 disabled:opacity-60"
            >
              İptal
            </button>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-gray-800 bg-gray-900/80 p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-xl font-semibold text-white">Kayıtlar</h2>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Başlık, kaynak, kategori ara..."
            className={`${inputClass} md:max-w-sm`}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="bg-gray-950 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Başlık</th>
                <th className="px-4 py-3">Kaynak</th>
                <th className="px-4 py-3">Kategori</th>
                <th className="px-4 py-3">Tarih</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Sabit</th>
                <th className="px-4 py-3">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Kayıtlar yükleniyor...
                  </td>
                </tr>
              ) : filteredNotes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Kayıt bulunamadı.
                  </td>
                </tr>
              ) : (
                filteredNotes.map((note) => (
                  <tr key={note.id} className="border-t border-gray-800 align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{note.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-gray-400">
                        {note.summary}
                      </div>
                    </td>
                    <td className="px-4 py-3">{note.source}</td>
                    <td className="px-4 py-3">{note.category}</td>
                    <td className="px-4 py-3">{formatMevzuatDate(note.publishedAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => patchNote(note, { isActive: !note.isActive })}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          note.isActive
                            ? "bg-emerald-950 text-emerald-300 ring-1 ring-emerald-700/60"
                            : "bg-gray-800 text-gray-400 ring-1 ring-gray-700"
                        }`}
                      >
                        {note.isActive ? "Aktif" : "Pasif"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => patchNote(note, { isPinned: !note.isPinned })}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          note.isPinned
                            ? "bg-violet-950 text-violet-200 ring-1 ring-violet-700/60"
                            : "bg-gray-800 text-gray-400 ring-1 ring-gray-700"
                        }`}
                      >
                        {note.isPinned ? "Sabit" : "Normal"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => editNote(note)}
                          className="rounded-lg border border-violet-700/60 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-950/50"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteNote(note)}
                          className="rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950/40"
                        >
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm text-gray-400">{label}</span>
      {children}
    </label>
  );
}
