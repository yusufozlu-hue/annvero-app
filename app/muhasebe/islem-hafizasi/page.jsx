"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { DOCUMENT_TYPE_OPTIONS } from "@/src/utils/previewRowEdit";
import {
  dismissUnrecognizedTransaction,
  fetchUnrecognizedTransactions,
  learnUnrecognizedTransaction,
} from "@/src/utils/transactionMemoryApi";
import { UNRECOGNIZED_STATUS_LABEL } from "@/src/utils/transactionMemoryEngine";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500";

function formatAmount(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildDraft(row) {
  return {
    accountCode: row.accountCode || row.suggestedAccountCode || "",
    accountName: row.accountName || row.suggestedAccountName || "",
    documentType: row.documentType || row.suggestedDocumentType || "DK",
    cariName: row.cariName || row.suggestedCari || "",
    cleanDescription: row.cleanDescription || row.rawDescription || "",
    keyword: row.keyword || "",
    userCorrection: row.userCorrection || "",
  };
}

export default function IslemHafizasiPage() {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompanyList();

  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => setToast({ message, type });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchUnrecognizedTransactions({
        companyId: selectedCompanyId || undefined,
        status: statusFilter,
      });
      setRows(data);

      const nextDrafts = {};
      data.forEach((row) => {
        nextDrafts[row.id] = buildDraft(row);
      });
      setDrafts(nextDrafts);
    } catch (error) {
      showToast(error.message || "Kayıtlar yüklenemedi.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompanyId, statusFilter]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr-TR");
    if (!query) return rows;

    return rows.filter((row) => {
      const haystack = [
        row.rawDescription,
        row.cleanDescription,
        row.keyword,
        row.suggestedAccountCode,
        row.suggestedCari,
        row.sourceBank,
      ]
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return haystack.includes(query);
    });
  }, [rows, search]);

  const updateDraft = (id, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
      },
    }));
  };

  const handleLearn = async (row) => {
    const draft = drafts[row.id] || buildDraft(row);

    if (!String(draft.accountCode || "").trim()) {
      showToast("Hesap kodu zorunludur.", "error");
      return;
    }

    setBusyId(row.id);
    try {
      await learnUnrecognizedTransaction(row.id, draft);
      showToast("İşlem öğrenildi ve hafızaya kaydedildi.");
      await loadRows();
    } catch (error) {
      showToast(error.message || "Öğrenme başarısız.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (row) => {
    setBusyId(row.id);
    try {
      await dismissUnrecognizedTransaction(row.id);
      showToast("İşlem yok sayıldı.");
      await loadRows();
    } catch (error) {
      showToast(error.message || "Güncelleme başarısız.", "error");
    } finally {
      setBusyId(null);
    }
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

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-2 text-4xl font-bold">İşlem Hafızası / Öğrenme Merkezi</h1>
          <p className="max-w-3xl text-gray-400">
            Banka parser&apos;ın tanıyamadığı işlemleri burada düzeltin. Sistem hesap, belge
            türü ve cari bilgisini öğrenir; sonraki ekstrelerde benzer açıklamalar için otomatik
            öneri üretir.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/muhasebe/ogrenen-hafiza"
            className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-900"
          >
            Öğrenilen Kurallar
          </Link>
          <Link
            href="/muhasebe/banka-ekstresi"
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
          >
            Banka Ekstresi
          </Link>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-4 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-sm text-gray-400">Arama</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Açıklama, hesap, cari, banka..."
            className={inputClassName}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Firma</span>
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
          <span className="mb-1 block text-sm text-gray-400">Durum</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="pending">Bekleyen</option>
            <option value="learned">Öğrenilen</option>
            <option value="dismissed">Yok sayılan</option>
            <option value="all">Tümü</option>
          </select>
        </label>
      </div>

      <section className="rounded-2xl border border-gray-800 bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-5 py-4">
          <div>
            <h2 className="text-2xl font-semibold">Tanınmayan İşlemler</h2>
            <p className="text-sm text-gray-400">
              {filteredRows.length} kayıt · Öğrenilen kurallar sonraki banka ekstrelerinde öneri
              olarak uygulanır.
            </p>
          </div>
          <button
            type="button"
            onClick={loadRows}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
          >
            Yenile
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-sm">
            <thead className="bg-gray-800/80 text-gray-300">
              <tr>
                <th className="p-3 text-left">Tarih</th>
                <th className="p-3 text-left">Açıklama</th>
                <th className="p-3 text-right">Tutar</th>
                <th className="p-3 text-left">Önerilen hesap</th>
                <th className="p-3 text-left">Önerilen belge tipi</th>
                <th className="p-3 text-left">Cari</th>
                <th className="p-3 text-left">Durum</th>
                <th className="p-3 text-left">Öğren</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const draft = drafts[row.id] || buildDraft(row);
                const isBusy = busyId === row.id;
                const isPending = row.status === "pending";

                return (
                  <tr key={row.id} className="border-t border-gray-800 align-top">
                    <td className="p-3 whitespace-nowrap text-gray-300">
                      <div>{row.transactionDate || "—"}</div>
                      <div className="text-xs text-gray-500">{row.sourceBank || "—"}</div>
                    </td>
                    <td className="p-3">
                      <div className="max-w-xs text-gray-200">{row.rawDescription}</div>
                      {isPending ? (
                        <input
                          value={draft.cleanDescription}
                          onChange={(event) =>
                            updateDraft(row.id, "cleanDescription", event.target.value)
                          }
                          placeholder="Temiz açıklama"
                          className={`${inputClassName} mt-2`}
                        />
                      ) : (
                        <div className="mt-1 text-xs text-gray-500">
                          {row.cleanDescription || row.keyword}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right font-medium whitespace-nowrap">
                      {formatAmount(row.amount)}
                    </td>
                    <td className="p-3">
                      {isPending ? (
                        <div className="space-y-2">
                          <input
                            value={draft.accountCode}
                            onChange={(event) =>
                              updateDraft(row.id, "accountCode", event.target.value)
                            }
                            placeholder="760"
                            className={inputClassName}
                          />
                          <input
                            value={draft.accountName}
                            onChange={(event) =>
                              updateDraft(row.id, "accountName", event.target.value)
                            }
                            placeholder="Reklam Giderleri"
                            className={inputClassName}
                          />
                          {row.suggestedAccountCode ? (
                            <p className="text-xs text-amber-300">
                              Öneri: {row.suggestedAccountCode}
                              {row.suggestedAccountName
                                ? ` · ${row.suggestedAccountName}`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span>
                          {row.accountCode || row.suggestedAccountCode || "—"}
                          {row.accountName ? ` · ${row.accountName}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {isPending ? (
                        <select
                          value={draft.documentType}
                          onChange={(event) =>
                            updateDraft(row.id, "documentType", event.target.value)
                          }
                          className={inputClassName}
                        >
                          {DOCUMENT_TYPE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.documentType || row.suggestedDocumentType || "—"
                      )}
                    </td>
                    <td className="p-3">
                      {isPending ? (
                        <input
                          value={draft.cariName}
                          onChange={(event) =>
                            updateDraft(row.id, "cariName", event.target.value)
                          }
                          placeholder="Google Ireland"
                          className={inputClassName}
                        />
                      ) : (
                        row.cariName || row.suggestedCari || "—"
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.status === "learned"
                            ? "bg-emerald-900/60 text-emerald-100"
                            : row.status === "dismissed"
                              ? "bg-gray-800 text-gray-300"
                              : "bg-amber-900/60 text-amber-100"
                        }`}
                      >
                        {UNRECOGNIZED_STATUS_LABEL[row.status] || row.status}
                      </span>
                    </td>
                    <td className="p-3">
                      {isPending ? (
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleLearn(row)}
                            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold hover:bg-violet-500 disabled:opacity-50"
                          >
                            {isBusy ? "Kaydediliyor..." : "Bu işlemi öğren"}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDismiss(row)}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold hover:bg-gray-800 disabled:opacity-50"
                          >
                            Yok say
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!isLoading && !filteredRows.length ? (
            <p className="p-6 text-sm text-gray-400">
              Tanınmayan işlem bulunamadı. Banka ekstresi yükledikten sonra hesap/cari
              bulunamayan satırlar burada listelenir.
            </p>
          ) : null}

          {isLoading ? (
            <p className="p-6 text-sm text-gray-400">Kayıtlar yükleniyor...</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
