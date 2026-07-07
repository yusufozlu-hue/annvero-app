"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { DOCUMENT_TYPE_OPTIONS } from "@/src/utils/previewRowEdit";
import {
  buildLearningMemoryEditDraft,
  buildLearningMemoryUpdatePayload,
  filterLearningMemoryRows,
  formatLearningMemoryDate,
  getLearningMemoryBankOptions,
  getLearningMemoryDocumentTypeOptions,
  getLearningMemoryKaynakTipiOptions,
  getLearningMemoryStats,
  LEARNING_MEMORY_STATUS_LABELS,
  mapLearningMemoryRecordToListRow,
} from "@/src/utils/learningMemoryAdmin";
import {
  fetchAllLearningMemory,
  updateLearningMemoryRecord,
} from "@/src/utils/learningMemory";
import AnnveroDataTable from "@/src/components/AnnveroDataTable";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

export default function OgrenenHafizaPage() {
  const { companies, selectedCompanyId, setSelectedCompanyId, getCompanyDisplayName } =
    useCompanyList();

  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kaynakTipiFilter, setKaynakTipiFilter] = useState("TUMU");
  const [accountCodeFilter, setAccountCodeFilter] = useState("");
  const [documentTypeFilter, setDocumentTypeFilter] = useState("TUMU");
  const [bankFilter, setBankFilter] = useState("TUMU");
  const [statusFilter, setStatusFilter] = useState("TUMU");
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
        accountCode: accountCodeFilter,
        documentType: documentTypeFilter,
        bankName: bankFilter,
        status: statusFilter,
      }),
    [
      records,
      search,
      selectedCompanyId,
      kaynakTipiFilter,
      accountCodeFilter,
      documentTypeFilter,
      bankFilter,
      statusFilter,
    ]
  );

  const kaynakTipiOptions = useMemo(
    () => getLearningMemoryKaynakTipiOptions(records),
    [records]
  );

  const documentTypeOptions = useMemo(
    () => getLearningMemoryDocumentTypeOptions(records),
    [records]
  );

  const bankOptions = useMemo(() => getLearningMemoryBankOptions(records), [records]);

  const stats = useMemo(() => getLearningMemoryStats(records), [records]);

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

    const ok = await updateLearningMemoryRecord(row.id, {
      status: "deleted",
    });

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

  const memoryColumns = useMemo(
    () => [
      {
        key: "aramaAnahtari",
        label: "Açıklama / Keyword",
        filterable: true,
        render: (row) => (
          <div className="max-w-[280px]">
            <div className="font-medium text-gray-100">{row.aramaAnahtari || "—"}</div>
            <div className="mt-1 text-xs text-gray-400">{row.aciklama}</div>
            <div className="mt-1 text-[11px] text-gray-500">{row.firmaAdi}</div>
          </div>
        ),
        filterValue: (row) => `${row.aramaAnahtari} ${row.aciklama} ${row.firmaAdi}`,
      },
      { key: "hesapKodu", label: "Hesap Kodu", filterable: true },
      { key: "hesapAdi", label: "Hesap Adı", filterable: true },
      { key: "belgeTuru", label: "Belge Türü" },
      { key: "cari", label: "Cari", filterable: true },
      { key: "kaynakAdi", label: "Banka" },
      {
        key: "status",
        label: "Durum",
        render: (row) => <StatusBadge status={row.status} />,
      },
      { key: "matchCount", label: "Eşleşme", sortable: true },
      {
        key: "lastMatchedAt",
        label: "Son Kullanım",
        sortValue: (row) => row.lastMatchedAt,
        render: (row) => formatLearningMemoryDate(row.lastMatchedAt),
      },
      {
        key: "learnedAt",
        label: "Öğrenme",
        sortValue: (row) => row.learnedAt,
        render: (row) => formatLearningMemoryDate(row.learnedAt),
      },
      {
        key: "actions",
        label: "İşlem",
        sortable: false,
        render: (row) => (
          <div className="flex flex-wrap gap-2">
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
            {row.status !== "deleted" ? (
              <button
                type="button"
                onClick={() => deleteRecord(row)}
                className="rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950/40"
              >
                Sil
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    []
  );

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

      <h1 className="mb-2 text-4xl font-bold">Öğrenen Hafıza</h1>
      <p className="mb-8 text-gray-400">
        Ön izlemede kaydedilen firma bazlı düzeltmeleri yönetin. Pasif kayıtlar parser
        sonrası uygulanmaz; silinen kayıtlar yönetim geçmişinde kalır.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Toplam öğrenilen kayıt" value={stats.total} />
        <StatCard label="Aktif kayıt" value={stats.active} tone="emerald" />
        <StatCard label="Pasif kayıt" value={stats.passive} tone="amber" />
        <StatCard label="Bu ay eşleşen kayıt" value={stats.matchedThisMonth} tone="indigo" />
        <StatCard
          label="En çok eşleşen kayıt"
          value={stats.topMatched?.matchCount || 0}
          detail={stats.topMatched?.aramaAnahtari || "Kayıt yok"}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-4 lg:grid-cols-6">
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-sm text-gray-400">Arama</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Açıklama, keyword, cari, hesap adı..."
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
          <span className="mb-1 block text-sm text-gray-400">Hesap Kodu</span>
          <input
            value={accountCodeFilter}
            onChange={(event) => setAccountCodeFilter(event.target.value)}
            placeholder="120, 770..."
            className={inputClassName}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Belge Tipi</span>
          <select
            value={documentTypeFilter}
            onChange={(event) => setDocumentTypeFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="TUMU">Tümü</option>
            {documentTypeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Banka</span>
          <select
            value={bankFilter}
            onChange={(event) => setBankFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="TUMU">Tümü</option>
            {bankOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Durum</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="TUMU">Tümü</option>
            <option value="active">Aktif</option>
            <option value="passive">Pasif</option>
            <option value="deleted">Silindi</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">İşlem Tipi</span>
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

        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setSelectedCompanyId("");
              setAccountCodeFilter("");
              setDocumentTypeFilter("TUMU");
              setBankFilter("TUMU");
              setStatusFilter("TUMU");
              setKaynakTipiFilter("TUMU");
            }}
            className="w-full rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
          >
            Filtreleri Temizle
          </button>
        </div>
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

        <AnnveroDataTable
          columns={memoryColumns}
          rows={filteredRows}
          isLoading={isLoading}
          showToolbar={false}
          pageSize={25}
          exportFilename="ogrenen-hafiza.csv"
          emptyMessage="Kayıt bulunamadı."
        />

        {editingRecordId && editDraft ? (
          <div className="mt-4 rounded-xl border border-indigo-700/40 p-4">
            <h3 className="mb-4 text-lg font-semibold">Kayıt Düzenle</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Arama Anahtarı">
                <input
                  value={editDraft.keyword}
                  onChange={(event) => updateDraftField("keyword", event.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field label="Hesap Kodu">
                <input
                  value={editDraft.account_code}
                  onChange={(event) => updateDraftField("account_code", event.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field label="Hesap Adı">
                <input
                  value={editDraft.account_name}
                  onChange={(event) => updateDraftField("account_name", event.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field label="Belge Türü">
                <select
                  value={editDraft.document_type}
                  onChange={(event) => updateDraftField("document_type", event.target.value)}
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
                  onChange={(event) => updateDraftField("cari_name", event.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field label="Temiz Açıklama" className="md:col-span-3">
                <input
                  value={editDraft.clean_description}
                  onChange={(event) => updateDraftField("clean_description", event.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field label="Aktif/Pasif">
                <select
                  value={editDraft.status || "active"}
                  onChange={(event) => updateDraftField("status", event.target.value)}
                  className={inputClassName}
                >
                  <option value="active">Aktif</option>
                  <option value="passive">Pasif</option>
                  <option value="deleted">Silindi</option>
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
        ) : null}

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

function StatCard({ label, value, detail = "", tone = "gray" }) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-200"
      : tone === "amber"
        ? "border-amber-800/60 bg-amber-950/30 text-amber-200"
        : tone === "indigo"
          ? "border-indigo-800/60 bg-indigo-950/30 text-indigo-200"
          : "border-gray-800 bg-gray-900 text-gray-200";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-sm text-gray-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
      {detail ? <div className="mt-1 truncate text-xs text-gray-400">{detail}</div> : null}
    </div>
  );
}

function StatusBadge({ status }) {
  const normalizedStatus = String(status || "active").toLowerCase();
  const label = LEARNING_MEMORY_STATUS_LABELS[normalizedStatus] || normalizedStatus;
  const className =
    normalizedStatus === "active"
      ? "bg-emerald-950 text-emerald-300 ring-emerald-700/60"
      : normalizedStatus === "passive"
        ? "bg-amber-950 text-amber-300 ring-amber-700/60"
        : "bg-red-950 text-red-300 ring-red-800/60";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${className}`}>
      {label}
    </span>
  );
}
