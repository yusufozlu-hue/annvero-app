"use client";

import { useCallback, useEffect, useMemo, useState } from "react";import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  countCompanyRules,
  getCompanyRules,
  loadRuleEngineFromStorage,
  saveRuleEngineToStorage,
} from "@/src/utils/companyCenter";

const editableTabs = {
  banka: {    label: "Banka Kuralları",
    columns: [
      ["islem", "İşlem"],
      ["anahtar", "Anahtar Kelime"],
      ["islemTipi", "İşlem Tipi"],
      ["borcHesabi", "Borç Hesabı"],
      ["alacakHesabi", "Alacak Hesabı"],
      ["aciklama", "Açıklama Formatı"],
    ],
    empty: {
      islem: "",
      anahtar: "",
      islemTipi: "",
      borcHesabi: "",
      alacakHesabi: "",
      aciklama: "",
    },
  },

  fatura: {
    label: "Fatura / Belge Türü Kuralları",
    columns: [
      ["kural", "Kural"],
      ["anahtar", "Seri / Anahtar"],
      ["belgeTuru", "Belge Türü"],
      ["aciklama", "Açıklama"],
    ],
    empty: {
      kural: "",
      anahtar: "",
      belgeTuru: "EA",
      aciklama: "",
    },
  },

  vergi: {
    label: "Vergi / SGK Kuralları",
    columns: [
      ["tur", "Tür"],
      ["anahtar", "Anahtar Kelime"],
      ["hesapKodu", "Hesap Kodu"],
      ["aciklama", "Açıklama"],
    ],
    empty: {
      tur: "",
      anahtar: "",
      hesapKodu: "",
      aciklama: "",
    },
  },
};

const tabs = {
  ...editableTabs,
  hafiza: {
    label: "Öğrenen Hesap Hafızası",
  },
};

function formatAccountDisplay(code, name) {
  const normalizedCode = String(code || "").trim();
  const normalizedName = String(name || "").trim();

  if (normalizedCode && normalizedName) {
    return `${normalizedCode} - ${normalizedName}`;
  }

  if (normalizedCode) return normalizedCode;
  if (normalizedName) return normalizedName;

  return "-";
}

const learningMemoryColumns = [
  {
    label: "Anahtar Kelime",
    getValue: (row) =>
      row.keyword || row.anahtar_kelime || row.anahtar || row.key || "",
  },
  {
    label: "Borç Hesabı",
    getValue: (row) =>
      formatAccountDisplay(row.account_code, row.account_name),
  },
  {
    label: "Alacak Hesabı",
    getValue: (row) =>
      formatAccountDisplay(
        row.counter_account_code,
        row.counter_account_name
      ),
  },
  {
    label: "Belge Türü",
    getValue: (row) =>
      row.belge_turu || row.document_type || row.belgeTuru || "",
  },
  {
    label: "İşlem Tipi",
    getValue: (row) =>
      row.islem_tipi || row.transaction_type || row.islemTipi || "",
  },
  {
    label: "Kullanım",
    getValue: (row) => row.usage_count ?? row.kullanim ?? "",
  },
  {
    label: "Son Kullanım",
    getValue: (row) =>
      formatLearningMemoryDate(
        row.last_used_at || row.son_kullanim || row.lastUsedAt
      ),
  },
];

const emptyMemoryForm = {
  keyword: "",
  account_code: "",
  account_name: "",
  counter_account_code: "",
  counter_account_name: "",
  document_type: "EA",
  transaction_type: "",
  description_format: "",
};

function formatLearningMemoryDate(value) {  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("tr-TR");
}

export default function KurallarPage() {
  const {    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    getCompanyDisplayName,
  } = useCompanyList();

  const [rules, setRules] = useState({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState("banka");
  const [learningMemory, setLearningMemory] = useState([]);
  const [isLearningMemoryLoading, setIsLearningMemoryLoading] = useState(false);
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState(false);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [memoryForm, setMemoryForm] = useState(emptyMemoryForm);
  const [toast, setToast] = useState(null);

  const showToast = (message, type) => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadLearningMemory = useCallback(async () => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      console.error("Supabase istemcisi yapılandırılmamış.");
      setLearningMemory([]);
      return;
    }

    setIsLearningMemoryLoading(true);

    try {
      const { data, error } = await supabase
        .from("learning_memory")
        .select("*")
        .order("usage_count", { ascending: false });

      console.log("learning_memory data", data);
      console.log("learning_memory error", error);

      if (error) {
        console.error(error);
        setLearningMemory([]);
        return;
      }

      setLearningMemory(data || []);
    } finally {
      setIsLearningMemoryLoading(false);
    }
  }, []);

  useEffect(() => {
    setRules(loadRuleEngineFromStorage());
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (activeTab !== "hafiza") {
      setLearningMemory([]);
      return;
    }

    loadLearningMemory();
  }, [activeTab, loadLearningMemory]);  useEffect(() => {
    if (!isLoaded) return;

    saveRuleEngineToStorage(rules);
  }, [rules, isLoaded]);

  const companyRules = useMemo(
    () => getCompanyRules(rules, selectedCompanyId),
    [rules, selectedCompanyId]
  );

  const activeRows = companyRules[activeTab] || [];
  const activeConfig = tabs[activeTab];
  const editableConfig = editableTabs[activeTab];
  const ruleCount = countCompanyRules(rules, selectedCompanyId);
  const isMemoryTab = activeTab === "hafiza";

  const updateMemoryForm = (field, value) => {
    setMemoryForm((prev) => ({ ...prev, [field]: value }));
  };

  const openMemoryModal = () => {
    if (!selectedCompanyId) {
      showToast("Önce firma seçmelisiniz", "error");
      return;
    }

    setMemoryForm({ ...emptyMemoryForm });
    setIsMemoryModalOpen(true);
  };

  const closeMemoryModal = () => {
    if (isSavingMemory) return;
    setIsMemoryModalOpen(false);
  };

  const saveMemoryRecord = async () => {
    if (!selectedCompanyId) {
      showToast("Önce firma seçmelisiniz", "error");
      return;
    }

    const supabase = getSupabaseClient();

    if (!supabase) {
      console.error("Supabase istemcisi yapılandırılmamış.");
      showToast("Hafıza kaydı eklenemedi", "error");
      return;
    }

    setIsSavingMemory(true);

    try {
      const { error } = await supabase.from("learning_memory").insert([
        {
          company_id: selectedCompanyId,
          keyword: memoryForm.keyword.trim(),
          account_code: memoryForm.account_code.trim(),
          account_name: memoryForm.account_name.trim(),
          counter_account_code: memoryForm.counter_account_code.trim(),
          counter_account_name: memoryForm.counter_account_name.trim(),
          document_type: memoryForm.document_type.trim(),
          transaction_type: memoryForm.transaction_type.trim(),
          description_format: memoryForm.description_format.trim(),
          usage_count: 0,
          source_module: "manual",
          is_active: true,
        },
      ]);

      if (error) {
        console.error(error);
        showToast("Hafıza kaydı eklenemedi", "error");
        return;
      }

      setIsMemoryModalOpen(false);
      setMemoryForm({ ...emptyMemoryForm });
      await loadLearningMemory();
      showToast("Hafıza kaydı eklendi", "success");
    } finally {
      setIsSavingMemory(false);
    }
  };

  const updateCell = (rowIndex, key, value) => {    if (!selectedCompanyId) return;

    setRules((prev) => {
      const current = getCompanyRules(prev, selectedCompanyId);
      const rows = [...(current[activeTab] || [])];

      rows[rowIndex] = {
        ...rows[rowIndex],
        [key]: value,
      };

      return {
        ...prev,
        [selectedCompanyId]: {
          ...current,
          [activeTab]: rows,
          updatedAt: Date.now(),
        },
      };
    });
  };

  const addRow = () => {
    if (isMemoryTab) return;

    if (!selectedCompanyId) {
      alert("Önce firma seçmelisin.");
      return;
    }

    setRules((prev) => {
      const current = getCompanyRules(prev, selectedCompanyId);
      const rows = current[activeTab] || [];

      return {
        ...prev,
        [selectedCompanyId]: {
          ...current,
          [activeTab]: [...rows, { ...editableConfig.empty }],
          updatedAt: Date.now(),
        },
      };
    });
  };
  const deleteRow = (rowIndex) => {
    if (!selectedCompanyId) return;

    setRules((prev) => {
      const current = getCompanyRules(prev, selectedCompanyId);
      const rows = [...(current[activeTab] || [])];

      rows.splice(rowIndex, 1);

      return {
        ...prev,
        [selectedCompanyId]: {
          ...current,
          [activeTab]: rows,
          updatedAt: Date.now(),
        },
      };
    });
  };

  if (companies.length === 0) {
    return (
      <main className="min-h-screen bg-gray-950 p-8 text-white">
        <MuhasebeMenu />
        <h1 className="mb-4 text-4xl font-bold">Kural Motoru</h1>
        <p className="text-gray-400">
          Önce Firma Yönetim Merkezi’nden firma eklemelisin.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur-sm ${
            toast.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/95 text-emerald-100"
              : "border-red-500/40 bg-red-950/95 text-red-100"
          }`}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              toast.type === "success" ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          {toast.message}
        </div>
      )}

      {isMemoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Kapat"
            onClick={closeMemoryModal}
            disabled={isSavingMemory}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm disabled:cursor-not-allowed"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-modal-title"
            className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-950 p-6 shadow-2xl shadow-indigo-500/10 ring-1 ring-white/5"
          >
            <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-b from-indigo-500/10 via-transparent to-transparent" />
            <h2
              id="memory-modal-title"
              className="relative text-lg font-semibold text-white"
            >
              Yeni Hafıza Kaydı
            </h2>
            <p className="relative mt-2 text-sm text-slate-400">
              Seçili firma için manuel öğrenen hafıza kaydı oluşturun.
            </p>

            <div className="relative mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <MemoryFormField
                label="Anahtar Kelime"
                value={memoryForm.keyword}
                onChange={(value) => updateMemoryForm("keyword", value)}
                className="md:col-span-2"
              />
              <MemoryFormField
                label="Borç Hesap Kodu"
                value={memoryForm.account_code}
                onChange={(value) => updateMemoryForm("account_code", value)}
              />
              <MemoryFormField
                label="Borç Hesap Adı"
                value={memoryForm.account_name}
                onChange={(value) => updateMemoryForm("account_name", value)}
              />
              <MemoryFormField
                label="Alacak Hesap Kodu"
                value={memoryForm.counter_account_code}
                onChange={(value) =>
                  updateMemoryForm("counter_account_code", value)
                }
              />
              <MemoryFormField
                label="Alacak Hesap Adı"
                value={memoryForm.counter_account_name}
                onChange={(value) =>
                  updateMemoryForm("counter_account_name", value)
                }
              />
              <label className="block">
                <div className="mb-1 text-sm text-slate-400">Belge Türü</div>
                <select
                  value={memoryForm.document_type}
                  onChange={(e) =>
                    updateMemoryForm("document_type", e.target.value)
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-indigo-500"
                >
                  {["EA", "EF", "DK", "KR", "NM", "SMM", "FT"].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <MemoryFormField
                label="İşlem Tipi"
                value={memoryForm.transaction_type}
                onChange={(value) => updateMemoryForm("transaction_type", value)}
              />
              <MemoryFormField
                label="Açıklama Formatı"
                value={memoryForm.description_format}
                onChange={(value) =>
                  updateMemoryForm("description_format", value)
                }
                className="md:col-span-2"
              />
            </div>

            <div className="relative mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeMemoryModal}
                disabled={isSavingMemory}
                className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={saveMemoryRecord}
                disabled={isSavingMemory}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingMemory ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}

      <MuhasebeMenu />
      <h1 className="mb-8 text-4xl font-bold">Rule Engine v1</h1>

      <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <label className="mb-2 block text-sm text-gray-400">Firma Seç</label>

        <select
          value={selectedCompanyId}
          onChange={(e) => setSelectedCompanyId(e.target.value)}
          className="min-w-[320px] rounded-xl border border-gray-700 bg-gray-950 p-3 text-white"
        >
          <CompanySelectOptions companies={companies} />
        </select>

        <p className="mt-4 text-sm text-gray-400">
          Aktif firma: {getCompanyDisplayName(selectedCompany) || "Firma seçilmedi"}
        </p>

        <p className="mt-2 text-xs text-gray-500">
          Kayıtlı kural sayısı: {ruleCount}
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        {Object.entries(tabs).map(([key, tab]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`rounded-xl px-5 py-3 font-semibold ${
              activeTab === key
                ? "bg-blue-600 text-white"
                : "bg-gray-900 text-gray-300 hover:bg-gray-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!isMemoryTab && (
        <div className="mb-5">
          <button
            onClick={addRow}
            className="rounded-xl bg-green-600 px-5 py-3 font-semibold hover:bg-green-700"
          >
            Yeni Kural Ekle
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-indigo-500/5">
        <div className="mb-2 flex items-start justify-between gap-4">
          <h2 className="text-2xl font-bold">{activeConfig.label}</h2>
          {isMemoryTab && (
            <button
              type="button"
              onClick={openMemoryModal}
              className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
            >
              + Yeni Hafıza Kaydı
            </button>
          )}
        </div>
        <p className="mb-6 text-sm text-slate-400">
          {isMemoryTab
            ? "Bu kayıtlar seçili firma için Supabase öğrenen hafızadan okunur."
            : "Bu kurallar sadece seçili firma için geçerlidir."}
        </p>

        {isMemoryTab ? (
          <div className="overflow-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-slate-800/90">
                <tr>
                  {learningMemoryColumns.map((column) => (
                    <th
                      key={column.label}
                      className="p-3 text-left font-semibold text-slate-200"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {isLearningMemoryLoading && (
                  <tr>
                    <td
                      colSpan={learningMemoryColumns.length}
                      className="p-6 text-center text-slate-400"
                    >
                      Öğrenen hafıza yükleniyor...
                    </td>
                  </tr>
                )}

                {!isLearningMemoryLoading &&
                  learningMemory.map((row) => (
                    <tr
                      key={row.id || `${row.keyword}-${row.usage_count}`}
                      className="border-t border-slate-800 hover:bg-slate-950/60"
                    >
                      {learningMemoryColumns.map((column) => (
                        <td
                          key={column.label}
                          className="p-3 text-slate-200"
                        >
                          {column.getValue(row) || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}

                {!isLearningMemoryLoading && learningMemory.length === 0 && (
                  <tr>
                    <td
                      colSpan={learningMemoryColumns.length}
                      className="p-6 text-center text-slate-400"
                    >
                      Henüz öğrenen hafıza kaydı yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-800">
                <tr>
                  {editableConfig.columns.map(([key, label]) => (
                    <th key={key} className="p-3 text-left">
                      {label}
                    </th>
                  ))}
                  <th className="p-3 text-left">İşlem</th>
                </tr>
              </thead>

              <tbody>
                {activeRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-slate-800">
                    {editableConfig.columns.map(([key]) => (
                      <td key={key} className="p-3">
                        <input
                          value={row[key] || ""}
                          onChange={(e) =>
                            updateCell(rowIndex, key, e.target.value)
                          }
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white"
                        />
                      </td>
                    ))}

                    <td className="p-3">
                      <button
                        onClick={() => deleteRow(rowIndex)}
                        className="rounded-lg bg-red-600 px-4 py-2 font-semibold hover:bg-red-700"
                      >
                        Sil
                      </button>
                    </td>
                  </tr>
                ))}

                {activeRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={editableConfig.columns.length + 1}
                      className="p-6 text-center text-slate-400"
                    >
                      Henüz kural yok. Yeni kural ekleyebilirsin.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!isMemoryTab && (
          <p className="mt-5 text-sm text-slate-400">
            Değişiklikler otomatik kaydedilir.
          </p>
        )}
      </div>
    </main>
  );
}

function MemoryFormField({ label, value, onChange, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-1 text-sm text-slate-400">{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-indigo-500"
      />
    </label>
  );
}