"use client";

import { useEffect, useMemo, useState } from "react";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  countCompanyRules,
  getCompanyRules,
  loadRuleEngineFromStorage,
  saveRuleEngineToStorage,
} from "@/src/utils/companyCenter";

const tabs = {
  banka: {
    label: "Banka Kuralları",
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

  hafiza: {
    label: "Öğrenen Hesap Hafızası",
    columns: [
      ["anahtar", "Anahtar"],
      ["hesapKodu", "Hesap Kodu"],
      ["aciklama", "Açıklama"],
    ],
    empty: {
      anahtar: "",
      hesapKodu: "",
      aciklama: "",
    },
  },
};

export default function KurallarPage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    getCompanyDisplayName,
  } = useCompanyList();

  const [rules, setRules] = useState({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState("banka");

  useEffect(() => {
    setRules(loadRuleEngineFromStorage());
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    saveRuleEngineToStorage(rules);
  }, [rules, isLoaded]);

  const companyRules = useMemo(
    () => getCompanyRules(rules, selectedCompanyId),
    [rules, selectedCompanyId]
  );

  const activeRows = companyRules[activeTab] || [];
  const activeConfig = tabs[activeTab];
  const ruleCount = countCompanyRules(rules, selectedCompanyId);

  const updateCell = (rowIndex, key, value) => {
    if (!selectedCompanyId) return;

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
          [activeTab]: [...rows, { ...activeConfig.empty }],
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

      <div className="mb-5">
        <button
          onClick={addRow}
          className="rounded-xl bg-green-600 px-5 py-3 font-semibold hover:bg-green-700"
        >
          Yeni Kural Ekle
        </button>
      </div>

      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-2 text-2xl font-bold">{activeConfig.label}</h2>

        <p className="mb-6 text-sm text-gray-400">
          Bu kurallar sadece seçili firma için geçerlidir.
        </p>

        <div className="overflow-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-gray-800">
              <tr>
                {activeConfig.columns.map(([key, label]) => (
                  <th key={key} className="p-3 text-left">
                    {label}
                  </th>
                ))}
                <th className="p-3 text-left">İşlem</th>
              </tr>
            </thead>

            <tbody>
              {activeRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-gray-800">
                  {activeConfig.columns.map(([key]) => (
                    <td key={key} className="p-3">
                      <input
                        value={row[key] || ""}
                        onChange={(e) =>
                          updateCell(rowIndex, key, e.target.value)
                        }
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-white"
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
                    colSpan={activeConfig.columns.length + 1}
                    className="p-6 text-center text-gray-400"
                  >
                    Henüz kural yok. Yeni kural ekleyebilirsin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-5 text-sm text-gray-400">
          Değişiklikler otomatik kaydedilir.
        </p>
      </div>
    </main>
  );
}
