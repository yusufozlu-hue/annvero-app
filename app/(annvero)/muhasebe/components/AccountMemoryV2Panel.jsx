"use client";

import { useMemo, useState } from "react";
import {
  deleteAccountMemoryV2Record,
  filterAccountMemoryV2Rows,
  loadAccountMemoryV2Records,
  MEMORY_DECISION_TYPE,
  mergeAccountMemoryV2Records,
  updateAccountMemoryV2Record,
} from "@/src/utils/accountMemoryV2";

const inputClass =
  "rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white outline-none focus:border-indigo-500";

export default function AccountMemoryV2Panel({
  companies = [],
  selectedCompanyId = "",
  getCompanyDisplayName = (c) => c?.name || c?.id || "",
}) {
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState(selectedCompanyId || "");
  const [bankFilter, setBankFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("TUMU");
  const [decisionFilter, setDecisionFilter] = useState("TUMU");
  const [mergeKeepId, setMergeKeepId] = useState("");
  const [mergeDropId, setMergeDropId] = useState("");

  const records = useMemo(() => {
    void tick;
    return loadAccountMemoryV2Records();
  }, [tick]);

  const rows = useMemo(
    () =>
      filterAccountMemoryV2Rows(records, {
        search,
        companyId: companyId || undefined,
        bankId: bankFilter || undefined,
        transactionType: typeFilter,
        decisionType: decisionFilter,
      }),
    [records, search, companyId, bankFilter, typeFilter, decisionFilter]
  );

  const refresh = () => setTick((value) => value + 1);

  const companyName = (id) => {
    const company = companies.find((item) => item.id === id);
    return company ? getCompanyDisplayName(company) : id || "—";
  };

  return (
    <section className="mb-8 rounded-2xl border border-violet-800/40 bg-violet-950/20 p-4 text-violet-50">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Firma Karar Hafızası V2</h2>
          <p className="mt-1 text-xs text-violet-200/80">
            analysisKey / IBAN / VKN / alias ile firma bazlı kalıcı kararlar.
            Tarayıcı deposunda tutulur; firmalar arası taşmaz.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="rounded-lg border border-violet-600/60 px-3 py-1.5 text-xs font-semibold"
        >
          Yenile ({rows.length}/{records.length})
        </button>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-5">
        <select
          className={inputClass}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          <option value="">Tüm firmalar</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {getCompanyDisplayName(company)}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          placeholder="Banka"
          value={bankFilter}
          onChange={(e) => setBankFilter(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="transactionType"
          value={typeFilter === "TUMU" ? "" : typeFilter}
          onChange={(e) => setTypeFilter(e.target.value.trim() || "TUMU")}
        />
        <select
          className={inputClass}
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value)}
        >
          <option value="TUMU">Tüm karar tipleri</option>
          {Object.values(MEMORY_DECISION_TYPE).map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          placeholder="Ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          className={`${inputClass} w-40`}
          placeholder="Birleştir: keep id"
          value={mergeKeepId}
          onChange={(e) => setMergeKeepId(e.target.value)}
        />
        <input
          className={`${inputClass} w-40`}
          placeholder="drop id"
          value={mergeDropId}
          onChange={(e) => setMergeDropId(e.target.value)}
        />
        <button
          type="button"
          className="rounded border border-amber-600/50 px-2 py-1"
          onClick={() => {
            if (!mergeKeepId || !mergeDropId) return;
            mergeAccountMemoryV2Records(mergeKeepId, mergeDropId);
            setMergeKeepId("");
            setMergeDropId("");
            refresh();
          }}
        >
          Kayıtları birleştir
        </button>
      </div>

      <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-violet-900/50">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-violet-950/90 text-violet-200">
            <tr>
              <th className="px-2 py-2">Firma</th>
              <th className="px-2 py-2">Karar</th>
              <th className="px-2 py-2">Hesap</th>
              <th className="px-2 py-2">Tip / Yön</th>
              <th className="px-2 py-2">Kullanım</th>
              <th className="px-2 py-2">Başarı</th>
              <th className="px-2 py-2">Düzeltme</th>
              <th className="px-2 py-2">Son</th>
              <th className="px-2 py-2">Durum</th>
              <th className="px-2 py-2">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((record) => {
              const usage = Math.max(1, Number(record.usageCount || 0));
              const successRate = Math.round(
                (Number(record.successCount || 0) / usage) * 100
              );
              return (
                <tr key={record.id} className="border-t border-violet-900/40">
                  <td className="px-2 py-2">{companyName(record.companyId)}</td>
                  <td className="px-2 py-2">
                    {record.decisionType}
                    <div className="text-[10px] text-violet-300/70">
                      {(record.normalizedDescription || "").slice(0, 48)}
                    </div>
                  </td>
                  <td className="px-2 py-2 font-mono">{record.accountCode}</td>
                  <td className="px-2 py-2">
                    {record.transactionType || "—"} / {record.direction || "—"}
                  </td>
                  <td className="px-2 py-2">{record.usageCount || 0}</td>
                  <td className="px-2 py-2">{successRate}%</td>
                  <td className="px-2 py-2">{record.correctionCount || 0}</td>
                  <td className="px-2 py-2">
                    {record.lastUsedAt
                      ? new Date(record.lastUsedAt).toLocaleString("tr-TR")
                      : "—"}
                  </td>
                  <td className="px-2 py-2">
                    {record.isActive === false ? "Pasif" : "Aktif"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="rounded border border-slate-600 px-1.5 py-0.5"
                        onClick={() => {
                          const next = window.prompt(
                            "Hesap kodu",
                            record.accountCode
                          );
                          if (!next) return;
                          updateAccountMemoryV2Record(record.id, {
                            accountCode: next.trim(),
                            correctionCount:
                              Number(record.correctionCount || 0) + 1,
                            confidence: Math.max(
                              50,
                              Number(record.confidence || 100) - 8
                            ),
                          });
                          refresh();
                        }}
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-600 px-1.5 py-0.5"
                        onClick={() => {
                          updateAccountMemoryV2Record(record.id, {
                            isActive: record.isActive === false,
                          });
                          refresh();
                        }}
                      >
                        {record.isActive === false ? "Aktifleştir" : "Pasifleştir"}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-rose-700/60 px-1.5 py-0.5 text-rose-200"
                        onClick={() => {
                          if (!window.confirm("Kayıt silinsin mi?")) return;
                          deleteAccountMemoryV2Record(record.id, { soft: true });
                          refresh();
                        }}
                      >
                        Sil
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-600 px-1.5 py-0.5"
                        onClick={() => setMergeKeepId(record.id)}
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-600 px-1.5 py-0.5"
                        onClick={() => setMergeDropId(record.id)}
                      >
                        Drop
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={10} className="px-2 py-6 text-center text-violet-300/70">
                  Bu filtrede V2 kayıt yok. Banka Parser’da “firma için öğren”
                  ile oluşur.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
