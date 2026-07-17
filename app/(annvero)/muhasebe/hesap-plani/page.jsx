"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  getAccountPlanForCompany,
  loadAccountPlansFromStorage,
  saveAccountPlansToStorage,
  setCompanyAccountPlan,
  updateCompanyAccounts,
} from "@/src/utils/companyCenter";
import { runCompanyAccountAutoDetect } from "@/src/utils/companyAccountMappingMemory";
import { buildDetectSignalsFromCompany } from "@/src/utils/companyAccountAutoDetect";

export default function HesapPlaniPage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    getCompanyDisplayName,
  } = useCompanyList();

  const [accountPlans, setAccountPlans] = useState(() => {
    if (typeof window === "undefined") return {};
    return loadAccountPlansFromStorage();
  });
  const [isLoaded] = useState(() => typeof window !== "undefined");
  const [search, setSearch] = useState("");
  const [detectMessage, setDetectMessage] = useState("");

  useEffect(() => {
    if (!isLoaded) return;
    saveAccountPlansToStorage(accountPlans);
  }, [accountPlans, isLoaded]);

  const currentPlan = useMemo(
    () => getAccountPlanForCompany(accountPlans, selectedCompany || selectedCompanyId),
    [accountPlans, selectedCompany, selectedCompanyId]
  );

  const filteredPlan = useMemo(() => {
    const q = search.toLowerCase().trim();

    if (!q) return currentPlan;

    return currentPlan.filter((row) =>
      `${row.accountCode} ${row.accountName}`.toLowerCase().includes(q)
    );
  }, [currentPlan, search]);

  const bootstrapMappings = (parsedPlan) => {
    if (!selectedCompanyId || !parsedPlan?.length) return;
    try {
      const company = selectedCompany || { id: selectedCompanyId };
      const isMare = /mare/i.test(
        String(company?.name || company?.title || company?.companyName || "")
      );
      const signals = {
        ...buildDetectSignalsFromCompany(company),
        ...(isMare
          ? {
              bankName: "VAKIFBANK",
              iban: "TR820001500158007308428449",
              accountNumber: "00158007308428449",
              posMerchantNo: "57700001130449",
              posNo: "01670904",
              cardLast4List: ["4682", "6725"],
            }
          : {}),
      };
      const result = runCompanyAccountAutoDetect({
        companyId: selectedCompanyId,
        company,
        accountPlan: parsedPlan,
        signals,
      });
      setDetectMessage(
        `Otomatik eşleme: ${result.summary.autoApplied} otomatik, ${result.summary.needsApproval} onay, ${result.summary.missing} eksik — Firma Kartı → Hesap Eşlemeleri`
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("annvero:account-mappings-updated", {
            detail: {
              companyId: selectedCompanyId,
              summary: result.summary,
            },
          })
        );
      }
    } catch (error) {
      console.error(error);
      setDetectMessage("Hesap planı kaydedildi; otomatik eşleme çalıştırılamadı.");
    }
  };

  const handleExcelUpload = async (e) => {
    const file = e.target.files?.[0];

    if (!file) return;

    if (!selectedCompanyId) {
      alert("Önce firma seçmelisin.");
      e.target.value = "";
      return;
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const parsed = rows
      .map((row) => {
        const accountCode = String(row[0] || "").trim();
        const accountName = String(row[1] || "").trim();
        const currency = String(row[2] || "TL").trim() || "TL";

        if (!accountCode || !accountName) return null;

        return {
          id: crypto.randomUUID(),
          accountCode,
          accountName,
          currency,
          isActive: true,
        };
      })
      .filter(Boolean);

    setAccountPlans((prev) =>
      setCompanyAccountPlan(prev, selectedCompanyId, parsed)
    );
    bootstrapMappings(parsed);

    e.target.value = "";
  };

  const toggleActive = (id) => {
    if (!selectedCompanyId) return;

    setAccountPlans((prev) =>
      updateCompanyAccounts(prev, selectedCompanyId, (accounts) =>
        accounts.map((account) =>
          account.id === id ? { ...account, isActive: !account.isActive } : account
        )
      )
    );
  };

  const deleteAccount = (id) => {
    if (!selectedCompanyId) return;

    setAccountPlans((prev) =>
      updateCompanyAccounts(prev, selectedCompanyId, (accounts) =>
        accounts.filter((account) => account.id !== id)
      )
    );
  };

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      <h1 className="mb-2 text-4xl font-bold">Hesap Planı Merkezi</h1>
      <p className="mb-8 text-gray-400">
        Firma bazlı hesap planı yükleme, arama ve parser altyapısı.
      </p>

      <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <label className="mb-2 block text-sm text-gray-400">Firma Seç</label>

        <select
          value={selectedCompanyId}
          onChange={(e) => setSelectedCompanyId(e.target.value)}
          className="w-full max-w-xl rounded-xl border border-gray-700 bg-gray-950 p-3 text-white"
        >
          <CompanySelectOptions companies={companies} />
        </select>

        <p className="mt-4 text-sm text-gray-400">
          Aktif firma: {getCompanyDisplayName(selectedCompany) || "Firma seçilmedi"}
        </p>
        {detectMessage ? (
          <p className="mt-3 text-sm text-emerald-300">{detectMessage}</p>
        ) : null}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <label className="cursor-pointer rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-700">
          Excel Hesap Planı Yükle
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleExcelUpload}
            className="hidden"
          />
        </label>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Hesap kodu veya hesap adı ara..."
          className="min-w-[320px] rounded-xl border border-gray-700 bg-gray-900 p-3 text-white"
        />
      </div>

      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Hesap Planı</h2>
          <span className="rounded-lg bg-gray-800 px-3 py-1 text-sm text-gray-300">
            {currentPlan.length} hesap
          </span>
        </div>

        <div className="space-y-3">
          {filteredPlan.map((account) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-800 bg-gray-950 p-4"
            >
              <div>
                <div className="text-lg font-semibold">{account.accountCode}</div>
                <div className="text-gray-300">{account.accountName}</div>
                {account.currency && (
                  <div className="text-xs text-gray-500">{account.currency}</div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => toggleActive(account.id)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                    account.isActive
                      ? "bg-emerald-700 hover:bg-emerald-800"
                      : "bg-gray-700 hover:bg-gray-800"
                  }`}
                >
                  {account.isActive ? "Aktif" : "Pasif"}
                </button>

                <button
                  onClick={() => deleteAccount(account.id)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-700"
                >
                  Sil
                </button>
              </div>
            </div>
          ))}

          {filteredPlan.length === 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-950 p-8 text-center text-gray-400">
              Henüz hesap planı yok veya arama sonucu bulunamadı.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
