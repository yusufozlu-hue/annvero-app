"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { DOCUMENT_TYPE_OPTIONS } from "@/src/utils/previewRowEdit";
import {
  buildLearningMemoryEditDraft,
  buildLearningMemoryUpdatePayload,
  filterLearningMemoryRows,
  formatLearningMemoryDate,
  getLearningMemoryKaynakTipiOptions,
  mapLearningMemoryRecordToListRow,
} from "@/src/utils/learningMemoryAdmin";
import {
  deleteLearningMemoryRecord,
  fetchAllLearningMemory,
  updateLearningMemoryRecord,
} from "@/src/utils/learningMemory";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

export default function OgrenenHafizaPage() {
  const { companies, selectedCompanyId, setSelectedCompanyId, getCompanyDisplayName } =
    useCompanyList();

  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kaynakTipiFilter, setKaynakTipiFilter] = useState("TUMU");
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type) => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const companyNameById = useMemo(() => {
    const map = new Map();
    companies.forEach((company) => {
      map.set(company.id, getCompanyDisplayName(company));
    });
    return map;
  }, [companies, getCompanyDisplayName]);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);

    try {
      const data = await fetchAllLearningMemory({ includeInactive: true });
      setRecords(
        (data || []).map((record) =>
          mapLearningMemoryRecordToListRow(
            record,
            companyNameById.get(record.company_id) || record.company_id
          )
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [companyNameById]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const filteredRows = useMemo(
    () =>
      filterLearningMemoryRows(records, {
        search,
        companyId: selectedCompanyId,
        kaynakTipi: kaynakTipiFilter,
      }),
    [records, search, selectedCompanyId, kaynakTipiFilter]
  );

  const kaynakTipiOptions = useMemo(
    () => getLearningMemoryKaynakTipiOptions(records),
    [records]
  );

  const closeEditPanel = () => {
    if (isSaving) return;
    setEditingRecordId(null);
    setEditDraft(null);
  };

  const openEditPanel = (row) => {
    setEditingRecordId(row.id);
    setEditDraft(buildLearningMemoryEditDraft(row.raw));
  };

  const updateDraftField = (field, value) => {
    setEditDraft((prev) => ({ ...prev, [field]: value }));
  };

  const saveEdit = async () => {
    if (!editingRecordId || !editDraft) return;

    if (!String(editDraft.keyword || "").trim()) {
      showToast("Arama anahtarı boş olamaz", "error");
      return;
    }

    setIsSaving(true);

    try {
      const ok = await updateLearningMemoryRecord(
        editingRecordId,
        buildLearningMemoryUpdatePayload(editDraft)
      );

      if (!ok) {
        showToast("Kayıt güncellenemedi", "error");
        return;
      }

      showToast("Kayıt güncellendi", "success");
      closeEditPanel();
      await loadRecords();
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (row) => {
    const ok = await updateLearningMemoryRecord(row.id, {
      status: row.isActive ? "passive" : "active",
    });

    if (!ok) {
      showToast("Durum güncellenemedi", "error");
      return;
    }

    showToast(row.isActive ? "Kayıt pasif yapıldı" : "Kayıt aktif yapıldı", "success");
    await loadRecords();
  };

  const deleteRecord = async (row) => {
    const confirmed = window.confirm("Bu hafıza kaydını silmek istediğinize emin misiniz?");
    if (!confirmed) return;

    const ok = await deleteLearningMemoryRecord(row.id);

    if (!ok) {
      showToast("Kayıt silinemedi", "error");
      return;
    }

    if (editingRecordId === row.id) {
      closeEditPanel();
    }

    showToast("Kayıt silindi", "success");
    await loadRecords();
  };

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-4 right-4 z-[9999] rounded-lg border px-4 py-3 text-sm font-medium shadow-xl ${
            toast.type === "success"
              ? "border-emerald-700 bg-emerald-950 text-emerald-200"
              : "border-red-700 bg-red-950 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <MuhasebeMenu />

      <h1 className="mb-2 text-4xl font-bold">Öğrenen Hafıza</h1>
      <p className="mb-8 text-gray-400">
        Ön izlemede kaydedilen firma bazlı düzeltmeleri yönetin. Pasif kayıtlar parser
        sonrası uygulanmaz.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-4 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-sm text-gray-400">Arama</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Firma, anahtar, hesap, açıklama..."
            className={inputClassName}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Firma Filtresi</span>
          <select
            value={selectedCompanyId}
            onChange={(event) => setSelectedCompanyId(event.target.value)}
            className={inputClassName}
          >
            <option value="">Tüm Firmalar</option>
            <CompanySelectOptions companies={companies} />
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Kaynak Tipi</span>
          <select
            value={kaynakTipiFilter}
            onChange={(event) => setKaynakTipiFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="TUMU">Tümü</option>
            {kaynakTipiOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">Hafıza Kayıtları</h2>
          <button
            type="button"
            onClick={loadRecords}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
          >
            Yenile
          </button>
        </div>

        {isLoading ? (
          <p className="text-gray-400">Kayıtlar yükleniyor...</p>
        ) : filteredRows.length === 0 ? (
          <p className="text-gray-400">Kayıt bulunamadı.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[1600px] text-sm">
              <thead className="bg-gray-800">
                <tr>
                  <th className="p-3 text-left">Firma</th>
                  <th className="p-3 text-left">Kaynak Tipi</th>
                  <th className="p-3 text-left">Banka</th>
                  <th className="p-3 text-left">Açıklama / Keyword</th>
                  <th className="p-3 text-left">Hesap Kodu</th>
                  <th className="p-3 text-left">Hesap Adı</th>
                  <th className="p-3 text-left">Belge Türü</th>
                  <th className="p-3 text-left">Cari</th>
                  <th className="p-3 text-left">Eşleşme</th>
                  <th className="p-3 text-left">Son Kullanım</th>
                  <th className="p-3 text-left">Aktif/Pasif</th>
                  <th className="p-3 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-t border-gray-800">
                      <td className="p-3">{row.firmaAdi}</td>
                      <td className="p-3">{row.kaynakTipi}</td>
                      <td className="p-3">{row.kaynakAdi}</td>
                      <td className="p-3 max-w-[280px]">
                        <div className="font-medium text-gray-100">{row.aramaAnahtari || "—"}</div>
                        <div className="mt-1 text-xs text-gray-400">{row.aciklama}</div>
                      </td>
                      <td className="p-3 font-mono text-xs">{row.hesapKodu || "—"}</td>
                      <td className="p-3">{row.hesapAdi || "—"}</td>
                      <td className="p-3">{row.belgeTuru || "—"}</td>
                      <td className="p-3">{row.cari || "—"}</td>
                      <td className="p-3">{row.matchCount}</td>
                      <td className="p-3">{formatLearningMemoryDate(row.lastMatchedAt)}</td>
                      <td className="p-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            row.isActive
                              ? "bg-emerald-950 text-emerald-300 ring-1 ring-emerald-700/60"
                              : "bg-gray-800 text-gray-400 ring-1 ring-gray-700"
                          }`}
                        >
                          {row.isActive ? "Aktif" : "Pasif"}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditPanel(row)}
                            className="rounded-lg border border-indigo-700/60 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-950/50"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActive(row)}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
                          >
                            {row.isActive ? "Pasif Yap" : "Aktif Yap"}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRecord(row)}
                            className="rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950/40"
                          >
                            Sil
                          </button>
                        </div>
                      </td>
                    </tr>

                    {editingRecordId === row.id && editDraft ? (
                      <tr className="border-t border-gray-800 bg-gray-950/60">
                        <td colSpan={12} className="p-4">
                          <div className="rounded-xl border border-indigo-700/40 p-4">
                            <h3 className="mb-4 text-lg font-semibold">Kayıt Düzenle</h3>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                              <Field label="Arama Anahtarı">
                                <input
                                  value={editDraft.keyword}
                                  onChange={(event) =>
                                    updateDraftField("keyword", event.target.value)
                                  }
                                  className={inputClassName}
                                />
                              </Field>
                              <Field label="Hesap Kodu">
                                <input
                                  value={editDraft.account_code}
                                  onChange={(event) =>
                                    updateDraftField("account_code", event.target.value)
                                  }
                                  className={inputClassName}
                                />
                              </Field>
                              <Field label="Hesap Adı">
                                <input
                                  value={editDraft.account_name}
                                  onChange={(event) =>
                                    updateDraftField("account_name", event.target.value)
                                  }
                                  className={inputClassName}
                                />
                              </Field>
                              <Field label="Belge Türü">
                                <select
                                  value={editDraft.document_type}
                                  onChange={(event) =>
                                    updateDraftField("document_type", event.target.value)
                                  }
                                  className={inputClassName}
                                >
                                  {DOCUMENT_TYPE_OPTIONS.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Cari" className="md:col-span-3">
                                <input
                                  value={editDraft.cari_name}
                                  onChange={(event) =>
                                    updateDraftField(
                                      "cari_name",
                                      event.target.value
                                    )
                                  }
                                  className={inputClassName}
                                />
                              </Field>
                              <Field label="Temiz Açıklama" className="md:col-span-3">
                                <input
                                  value={editDraft.clean_description}
                                  onChange={(event) =>
                                    updateDraftField(
                                      "clean_description",
                                      event.target.value
                                    )
                                  }
                                  className={inputClassName}
                                />
                              </Field>
                              <Field label="Aktif/Pasif">
                                <select
                                  value={editDraft.status === "passive" ? "passive" : "active"}
                                  onChange={(event) =>
                                    updateDraftField(
                                      "status",
                                      event.target.value
                                    )
                                  }
                                  className={inputClassName}
                                >
                                  <option value="active">Aktif</option>
                                  <option value="passive">Pasif</option>
                                </select>
                              </Field>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={saveEdit}
                                disabled={isSaving}
                                className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-700 disabled:opacity-60"
                              >
                                {isSaving ? "Kaydediliyor..." : "Kaydet"}
                              </button>
                              <button
                                type="button"
                                onClick={closeEditPanel}
                                disabled={isSaving}
                                className="rounded-lg bg-gray-700 px-4 py-2 hover:bg-gray-600 disabled:opacity-60"
                              >
                                İptal
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-sm text-gray-400">
          Toplam {filteredRows.length}/{records.length} kayıt görüntüleniyor.
        </p>
      </div>
    </main>
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
