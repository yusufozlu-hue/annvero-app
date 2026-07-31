"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  getAccountPlanForCompany,
  loadAccountPlansFromStorage,
  saveAccountPlansToStorage,
  setCompanyAccountPlan,
} from "@/src/utils/companyCenter";
import { runCompanyAccountAutoDetect } from "@/src/utils/companyAccountMappingMemory";
import { buildDetectSignalsFromCompany } from "@/src/utils/companyAccountAutoDetect";
import {
  activateAccountPlanUpload,
  fetchAccountPlanUploads,
  fetchActiveAccountPlan,
  patchAccountPlanAccount,
  uploadAccountPlan,
} from "@/src/utils/accountPlanApi";
import {
  EMPTY_ACCOUNT_PLAN_MESSAGE,
  fingerprintAccountPlanAccounts,
  formatAccountPlanUploadStatus,
  paginateAccountPlanRows,
  parseAccountPlanSheetRows,
} from "@/src/utils/accountPlanUpload";

const ROW_HEIGHT = 52;
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 280;

export default function HesapPlaniPage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    getCompanyDisplayName,
  } = useCompanyList();

  const [allAccounts, setAllAccounts] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [activeUpload, setActiveUpload] = useState(null);
  const [source, setSource] = useState("loading");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detectMessage, setDetectMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef(null);
  const loadGenRef = useRef(0);
  const searchTimerRef = useRef(null);

  const refresh = useCallback(async (companyId) => {
    if (!companyId) {
      setAllAccounts([]);
      setUploads([]);
      setActiveUpload(null);
      setSource("none");
      return;
    }
    const gen = loadGenRef.current;
    setLoading(true);
    setErrorMessage("");
    try {
      const [plan, history] = await Promise.all([
        fetchActiveAccountPlan(companyId, { all: true }),
        fetchAccountPlanUploads(companyId),
      ]);
      if (gen !== loadGenRef.current) return;

      if (plan.source === "unavailable") {
        const local = loadAccountPlansFromStorage();
        const accounts = getAccountPlanForCompany(local, companyId);
        setAllAccounts(accounts);
        setActiveUpload(null);
        setUploads([]);
        setSource("localStorage");
        if (accounts.length) {
          saveAccountPlansToStorage(
            setCompanyAccountPlan(local, companyId, accounts)
          );
        }
      } else {
        setAllAccounts(plan.accounts || []);
        setActiveUpload(plan.upload || null);
        setUploads(history || []);
        setSource("api");
        const local = loadAccountPlansFromStorage();
        saveAccountPlansToStorage(
          setCompanyAccountPlan(local, companyId, plan.accounts || [])
        );
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("annvero:account-plan-updated", {
              detail: { companyId },
            })
          );
        }
      }
    } catch (error) {
      if (gen !== loadGenRef.current) return;
      setErrorMessage(error?.message || "Hesap planı yüklenemedi.");
      setSource("error");
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, []);

  // Firma değişince önceki firmanın hesapları bir an bile görünmesin
  useEffect(() => {
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    const timer = window.setTimeout(() => {
      if (gen !== loadGenRef.current) return;
      setAllAccounts([]);
      setUploads([]);
      setActiveUpload(null);
      setSearchInput("");
      setSearch("");
      setPage(1);
      setDetectMessage("");
      setStatusMessage("");
      setErrorMessage("");
      setSource("loading");
      setScrollTop(0);
      void refresh(selectedCompanyId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedCompanyId, refresh]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      startTransition(() => {
        setSearch(searchInput);
        setPage(1);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchInput]);

  const pagination = useMemo(
    () =>
      paginateAccountPlanRows(allAccounts, {
        page,
        pageSize: PAGE_SIZE,
        query: search,
      }),
    [allAccounts, page, search]
  );

  const pageRows = pagination.rows;
  const viewportHeight = 420;
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 4;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const endIndex = Math.min(pageRows.length, startIndex + visibleCount);
  const visibleRows = pageRows.slice(startIndex, endIndex);
  const topPad = startIndex * ROW_HEIGHT;
  const bottomPad = Math.max(0, (pageRows.length - endIndex) * ROW_HEIGHT);

  const bootstrapMappings = (parsedPlan) => {
    if (!selectedCompanyId || !parsedPlan?.length) return;
    try {
      const company = selectedCompany || { id: selectedCompanyId };
      const result = runCompanyAccountAutoDetect({
        companyId: selectedCompanyId,
        company,
        accountPlan: parsedPlan,
        signals: buildDetectSignalsFromCompany(company),
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
    } catch {
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

    setStatusMessage("");
    setErrorMessage("");
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      if (!workbook.SheetNames?.length) {
        throw new Error("Desteklenmeyen veya boş Excel dosyası.");
      }
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      const { accounts, errorCount } = parseAccountPlanSheetRows(rows);
      const fingerprint = await fingerprintAccountPlanAccounts(accounts);

      try {
        const result = await uploadAccountPlan({
          companyId: selectedCompanyId,
          fileName: file.name,
          accounts,
          contentFingerprint: fingerprint,
          errorCount,
        });
        if (result.duplicate) {
          setStatusMessage("Mükerrer yükleme — yeniden işlenmedi");
        } else if (result.ok === false) {
          setErrorMessage(
            result.message || "Yükleme başarısız; aktif sürüm değiştirilmedi."
          );
        } else {
          setStatusMessage(result.message || "Hesap planı yüklendi.");
          bootstrapMappings(accounts);
        }
        await refresh(selectedCompanyId);
      } catch (apiError) {
        if (apiError?.status === 503 || apiError?.code === "SCHEMA_MISSING") {
          // Fallback local until migration applied
          if (!accounts.length) {
            setErrorMessage("Yükleme başarısız; aktif sürüm değiştirilmedi.");
          } else {
            const local = loadAccountPlansFromStorage();
            saveAccountPlansToStorage(
              setCompanyAccountPlan(local, selectedCompanyId, accounts)
            );
            setAllAccounts(accounts);
            setSource("localStorage");
            setStatusMessage(
              "Hesap planı yerel olarak kaydedildi (API şeması henüz yok)."
            );
            bootstrapMappings(accounts);
          }
        } else {
          throw apiError;
        }
      }
    } catch (error) {
      setErrorMessage(error?.message || "Dosya okunamadı.");
    } finally {
      e.target.value = "";
    }
  };

  const toggleActive = async (account) => {
    if (!selectedCompanyId || !account?.id) return;
    if (source === "api") {
      await patchAccountPlanAccount({
        companyId: selectedCompanyId,
        accountId: account.id,
        isActive: account.isActive === false,
      });
      await refresh(selectedCompanyId);
      return;
    }
    const next = allAccounts.map((row) =>
      row.id === account.id ? { ...row, isActive: !row.isActive } : row
    );
    setAllAccounts(next);
    const local = loadAccountPlansFromStorage();
    saveAccountPlansToStorage(
      setCompanyAccountPlan(local, selectedCompanyId, next)
    );
  };

  const deleteAccount = async (account) => {
    if (!selectedCompanyId || !account?.id) return;
    if (!window.confirm(`“${account.accountCode}” hesabı silinsin mi?`)) return;
    if (source === "api") {
      await patchAccountPlanAccount({
        companyId: selectedCompanyId,
        accountId: account.id,
        delete: true,
      });
      await refresh(selectedCompanyId);
      return;
    }
    const next = allAccounts.filter((row) => row.id !== account.id);
    setAllAccounts(next);
    const local = loadAccountPlansFromStorage();
    saveAccountPlansToStorage(
      setCompanyAccountPlan(local, selectedCompanyId, next)
    );
  };

  const handleActivate = async (uploadId) => {
    if (!selectedCompanyId || !uploadId) return;
    try {
      await activateAccountPlanUpload({
        companyId: selectedCompanyId,
        uploadId,
      });
      setStatusMessage("Önceki güvenli sürüm aktif edildi.");
      await refresh(selectedCompanyId);
    } catch (error) {
      setErrorMessage(error?.message || "Sürüm etkinleştirilemedi.");
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 p-4 text-white sm:p-8">
      <div className="sticky top-0 z-20 -mx-4 mb-4 space-y-3 border-b border-gray-800 bg-gray-950/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Hesap Planı Merkezi</h1>
          <p className="text-xs text-gray-400 sm:text-sm">
            Firma bazlı hesap planı yükleme, arama ve sürüm geçmişi.
          </p>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs text-gray-400">Firma Seç</label>
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
            >
              <CompanySelectOptions companies={companies} />
            </select>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-gray-300">
            <span className="rounded-md bg-gray-800 px-2 py-1">
              Toplam: {pagination.total}
            </span>
            <span className="rounded-md bg-emerald-900/50 px-2 py-1">
              Aktif: {pagination.activeCount}
            </span>
            <span className="rounded-md bg-slate-800 px-2 py-1">
              Pasif: {pagination.inactiveCount}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-700">
            Excel Hesap Planı Yükle
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelUpload}
              className="hidden"
            />
          </label>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Hesap kodu veya hesap adı ara..."
            className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
          />
          {isPending || loading ? (
            <span className="text-xs text-gray-500">Güncelleniyor…</span>
          ) : null}
        </div>

        {detectMessage ? (
          <p className="text-xs text-emerald-300">{detectMessage}</p>
        ) : null}
        {statusMessage ? (
          <p className="text-xs text-sky-300">{statusMessage}</p>
        ) : null}
        {errorMessage ? (
          <p className="text-xs text-rose-300">{errorMessage}</p>
        ) : null}
      </div>

      <section className="mb-6 overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-base font-semibold">Hesap Planı</h2>
          <span className="text-xs text-gray-400">
            {activeUpload
              ? `Aktif sürüm · ${activeUpload.fileName || "—"}`
              : source === "localStorage"
                ? "Yerel kaynak"
                : "—"}
          </span>
        </div>

        {!selectedCompanyId ? (
          <div className="p-8 text-center text-sm text-gray-400">
            Firma seçin.
          </div>
        ) : pagination.total === 0 && !loading ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {EMPTY_ACCOUNT_PLAN_MESSAGE}
          </div>
        ) : (
          <>
            <div className="hidden grid-cols-[120px_1fr_72px_88px_140px] gap-2 border-b border-gray-800 px-4 py-2 text-[12px] font-semibold text-gray-400 md:grid">
              <div>Hesap Kodu</div>
              <div>Hesap Adı</div>
              <div>Para Birimi</div>
              <div>Durum</div>
              <div>İşlem</div>
            </div>

            <div
              ref={listRef}
              className="overflow-auto"
              style={{ maxHeight: viewportHeight }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              <div style={{ height: topPad }} />
              {visibleRows.map((account) => (
                <div
                  key={account.id || account.accountCode}
                  className="grid grid-cols-1 items-center gap-2 border-b border-gray-800/80 px-4 py-2 md:grid-cols-[120px_1fr_72px_88px_140px]"
                  style={{ minHeight: ROW_HEIGHT }}
                >
                  <div className="text-[14px] font-semibold text-white">
                    {account.accountCode}
                  </div>
                  <div className="text-[13px] text-gray-200 md:text-[14px]">
                    {account.accountName}
                  </div>
                  <div className="text-[12px] text-gray-400">
                    {account.currency || "TL"}
                  </div>
                  <div>
                    <span
                      className={`rounded px-2 py-0.5 text-[12px] font-medium ${
                        account.isActive !== false
                          ? "bg-emerald-900/60 text-emerald-200"
                          : "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {account.isActive !== false ? "Aktif" : "Pasif"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => toggleActive(account)}
                      className="rounded border border-gray-700 px-2 py-1 text-[12px] hover:bg-gray-800"
                    >
                      {account.isActive !== false ? "Pasifleştir" : "Aktifleştir"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteAccount(account)}
                      className="rounded border border-rose-800/60 px-2 py-1 text-[12px] text-rose-200 hover:bg-rose-950/40"
                    >
                      Sil
                    </button>
                  </div>
                </div>
              ))}
              <div style={{ height: bottomPad }} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 px-4 py-3 text-xs text-gray-400">
              <span>
                Sayfa {pagination.page} / {pagination.pageCount}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-gray-700 px-3 py-1 disabled:opacity-40"
                >
                  Önceki
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.pageCount}
                  onClick={() =>
                    setPage((p) => Math.min(pagination.pageCount, p + 1))
                  }
                  className="rounded border border-gray-700 px-3 py-1 disabled:opacity-40"
                >
                  Sonraki
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-4 py-3">
          <h2 className="text-base font-semibold">Yükleme Geçmişi</h2>
          <p className="text-[12px] text-gray-400">
            Denetim geçmişi korunur; başarısız yükleme aktif sürümü bozmaz.
          </p>
        </div>
        {source === "localStorage" ? (
          <div className="p-4 text-sm text-amber-200/90">
            API şeması henüz yok; geçmiş sunucuda tutulmuyor. Migration{" "}
            <code className="text-xs">029_account_plan_uploads_and_user_notifications.sql</code>{" "}
            uygulanınca kalıcı geçmiş açılır.
          </div>
        ) : uploads.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">
            Bu firma için yükleme kaydı yok.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-gray-950/80 text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Dosya</th>
                  <th className="px-3 py-2 font-semibold">Firma</th>
                  <th className="px-3 py-2 font-semibold">Tarih</th>
                  <th className="px-3 py-2 font-semibold">Yükleyen</th>
                  <th className="px-3 py-2 font-semibold">Satır</th>
                  <th className="px-3 py-2 font-semibold">+ / ~ / skip / err</th>
                  <th className="px-3 py-2 font-semibold">Durum</th>
                  <th className="px-3 py-2 font-semibold">Aktif</th>
                  <th className="px-3 py-2 font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id} className="border-t border-gray-800/80">
                    <td className="px-3 py-2 text-gray-200">{u.fileName}</td>
                    <td className="px-3 py-2 text-gray-400">
                      {getCompanyDisplayName(selectedCompany) || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      {u.uploadedAt
                        ? new Date(u.uploadedAt).toLocaleString("tr-TR")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{u.uploadedBy || "—"}</td>
                    <td className="px-3 py-2">{u.totalRows}</td>
                    <td className="px-3 py-2 text-gray-400">
                      {u.addedCount}/{u.updatedCount}/{u.skippedCount}/{u.errorCount}
                    </td>
                    <td className="px-3 py-2">
                      {formatAccountPlanUploadStatus(u.status)}
                    </td>
                    <td className="px-3 py-2">
                      {u.isActive ? (
                        <span className="text-emerald-300">Evet</span>
                      ) : (
                        "Hayır"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!u.isActive &&
                      u.status !== "failed" &&
                      u.status !== "duplicate" ? (
                        <button
                          type="button"
                          onClick={() => handleActivate(u.id)}
                          className="rounded border border-amber-700/50 px-2 py-1 text-amber-100 hover:bg-amber-950/40"
                        >
                          Geri dön
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
