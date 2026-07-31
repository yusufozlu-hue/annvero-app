"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
  archiveAccountPlanFile,
  fetchAccountPlanUploads,
  fetchActiveAccountPlan,
  fetchFullActiveAccountPlan,
  patchAccountPlanAccount,
  uploadAccountPlan,
} from "@/src/utils/accountPlanApi";
import {
  EMPTY_ACCOUNT_PLAN_MESSAGE,
  fingerprintAccountPlanAccounts,
  formatAccountPlanUploadStatus,
  parseAccountPlanSheetRows,
} from "@/src/utils/accountPlanUpload";

const ROW_HEIGHT = 52;
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 280;

async function sha256Hex(buffer) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return "";
}

export default function HesapPlaniPage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    getCompanyDisplayName,
  } = useCompanyList();

  const [pageAccounts, setPageAccounts] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [activeUpload, setActiveUpload] = useState(null);
  const [planCounts, setPlanCounts] = useState({
    total: 0,
    activeCount: 0,
    inactiveCount: 0,
  });
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    pageCount: 1,
  });
  const [source, setSource] = useState("loading");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [detectMessage, setDetectMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef(null);
  const loadGenRef = useRef(0);
  const searchTimerRef = useRef(null);
  const searchRef = useRef("");
  const pageRef = useRef(1);

  const wipeCompanyUi = useCallback(() => {
    setPageAccounts([]);
    setUploads([]);
    setActiveUpload(null);
    setPlanCounts({ total: 0, activeCount: 0, inactiveCount: 0 });
    setPagination({ total: 0, page: 1, pageSize: PAGE_SIZE, pageCount: 1 });
    setSearchInput("");
    setSearch("");
    searchRef.current = "";
    pageRef.current = 1;
    setDetectMessage("");
    setStatusMessage("");
    setErrorMessage("");
    setScrollTop(0);
  }, []);

  const refresh = useCallback(async (companyId, { page: pageArg = 1, query = "" } = {}) => {
    if (!companyId) {
      wipeCompanyUi();
      setSource("none");
      return;
    }
    const gen = loadGenRef.current;
    const nextPage = pageArg;
    const nextQuery = query;
    setLoading(true);
    setErrorMessage("");
    try {
      const [plan, history] = await Promise.all([
        fetchActiveAccountPlan(companyId, {
          page: nextPage,
          pageSize: PAGE_SIZE,
          q: nextQuery,
        }),
        fetchAccountPlanUploads(companyId),
      ]);
      if (gen !== loadGenRef.current) return;

      if (plan.source === "unavailable") {
        const local = loadAccountPlansFromStorage();
        const accounts = getAccountPlanForCompany(local, companyId);
        const q = String(nextQuery || "")
          .toLocaleLowerCase("tr")
          .trim();
        const filtered = !q
          ? accounts
          : accounts.filter((row) =>
              `${row.accountCode || ""} ${row.accountName || ""}`
                .toLocaleLowerCase("tr")
                .includes(q)
            );
        const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        const safePage = Math.min(pageCount, Math.max(1, nextPage));
        const start = (safePage - 1) * PAGE_SIZE;
        const slice = filtered.slice(start, start + PAGE_SIZE);
        const activeCount = accounts.filter((r) => r.isActive !== false).length;
        setPageAccounts(slice);
        setActiveUpload(null);
        setUploads([]);
        setPlanCounts({
          total: accounts.length,
          activeCount,
          inactiveCount: accounts.length - activeCount,
        });
        setPagination({
          total: filtered.length,
          page: safePage,
          pageSize: PAGE_SIZE,
          pageCount,
        });
        setSource("localStorage");
      } else {
        const pg = plan.pagination || {};
        setPageAccounts(plan.accounts || []);
        setActiveUpload(plan.upload || null);
        setUploads(history || []);
        setPlanCounts({
          total: Number(pg.planTotal ?? pg.total) || 0,
          activeCount: Number(pg.planActiveCount ?? pg.activeCount) || 0,
          inactiveCount: Number(pg.planInactiveCount ?? pg.inactiveCount) || 0,
        });
        setPagination({
          total: Number(pg.filteredTotal ?? pg.total) || 0,
          page: Number(pg.page) || nextPage,
          pageSize: Number(pg.pageSize) || PAGE_SIZE,
          pageCount: Number(pg.pageCount) || 1,
        });
        pageRef.current = Number(pg.page) || nextPage;
        setSource("api");

        void fetchFullActiveAccountPlan(companyId)
          .then((full) => {
            if (loadGenRef.current !== gen) return;
            if (full.source === "unavailable") return;
            const local = loadAccountPlansFromStorage();
            saveAccountPlansToStorage(
              setCompanyAccountPlan(local, companyId, full.accounts || [])
            );
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("annvero:account-plan-updated", {
                  detail: { companyId },
                })
              );
            }
          })
          .catch(() => {});
      }
    } catch (error) {
      if (gen !== loadGenRef.current) return;
      setErrorMessage(error?.message || "Hesap planı yüklenemedi.");
      setSource("error");
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [wipeCompanyUi]);

  // Firma değişince önceki firmanın hesapları bir an bile görünmesin
  useEffect(() => {
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    const timer = window.setTimeout(() => {
      if (gen !== loadGenRef.current) return;
      wipeCompanyUi();
      setSource("loading");
      void refresh(selectedCompanyId, { page: 1, query: "" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedCompanyId, wipeCompanyUi, refresh]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      startTransition(() => {
        searchRef.current = searchInput;
        pageRef.current = 1;
        setSearch(searchInput);
        if (selectedCompanyId) {
          void refresh(selectedCompanyId, { page: 1, query: searchInput });
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchInput, selectedCompanyId, refresh]);

  const viewportHeight = 420;
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 4;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const endIndex = Math.min(pageAccounts.length, startIndex + visibleCount);
  const visibleRows = pageAccounts.slice(startIndex, endIndex);
  const topPad = startIndex * ROW_HEIGHT;
  const bottomPad = Math.max(0, (pageAccounts.length - endIndex) * ROW_HEIGHT);

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
      const fileContentHash = await sha256Hex(buffer);
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
          originalFileName: file.name,
          accounts,
          contentFingerprint: fingerprint,
          fileContentHash,
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
          if (result.upload?.id) {
            const archive = await archiveAccountPlanFile({
              companyId: selectedCompanyId,
              uploadId: result.upload.id,
              file,
            });
            if (archive?.archiveStatus === "archived") {
              setStatusMessage(
                `${result.message || "Hesap planı yüklendi."} Drive arşivi tamam.`
              );
            } else if (
              archive?.archiveStatus === "archive_pending" ||
              archive?.ok === false
            ) {
              setStatusMessage(
                `${result.message || "Hesap planı yüklendi."} Drive arşivi bekliyor (aktif plan korundu).`
              );
            }
          }
        }
        await refresh(selectedCompanyId, { page: 1, query: search });
      } catch (apiError) {
        if (apiError?.status === 503 || apiError?.code === "SCHEMA_MISSING") {
          if (!accounts.length) {
            setErrorMessage("Yükleme başarısız; aktif sürüm değiştirilmedi.");
          } else {
            const local = loadAccountPlansFromStorage();
            saveAccountPlansToStorage(
              setCompanyAccountPlan(local, selectedCompanyId, accounts)
            );
            setSource("localStorage");
            setStatusMessage(
              "Hesap planı yerel olarak kaydedildi (API şeması henüz yok)."
            );
            bootstrapMappings(accounts);
            await refresh(selectedCompanyId, { page: 1, query: "" });
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
    const local = loadAccountPlansFromStorage();
    const all = getAccountPlanForCompany(local, selectedCompanyId).map((row) =>
      row.id === account.id ? { ...row, isActive: !row.isActive } : row
    );
    saveAccountPlansToStorage(
      setCompanyAccountPlan(local, selectedCompanyId, all)
    );
    await refresh(selectedCompanyId);
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
    const local = loadAccountPlansFromStorage();
    const all = getAccountPlanForCompany(local, selectedCompanyId).filter(
      (row) => row.id !== account.id
    );
    saveAccountPlansToStorage(
      setCompanyAccountPlan(local, selectedCompanyId, all)
    );
    await refresh(selectedCompanyId);
  };

  const handleActivate = async (uploadId) => {
    if (!selectedCompanyId || !uploadId) return;
    try {
      await activateAccountPlanUpload({
        companyId: selectedCompanyId,
        uploadId,
      });
      setStatusMessage("Önceki güvenli sürüm aktif edildi.");
      await refresh(selectedCompanyId, { page: 1, query: search });
    } catch (error) {
      setErrorMessage(error?.message || "Sürüm etkinleştirilemedi.");
    }
  };

  const goToPage = (next) => {
    const safe = Math.max(1, Math.min(pagination.pageCount, next));
    pageRef.current = safe;
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
    void refresh(selectedCompanyId, { page: safe, query: searchRef.current || search });
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
              Toplam: {planCounts.total}
            </span>
            <span className="rounded-md bg-emerald-900/50 px-2 py-1">
              Aktif: {planCounts.activeCount}
            </span>
            <span className="rounded-md bg-slate-800 px-2 py-1">
              Pasif: {planCounts.inactiveCount}
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
        ) : planCounts.total === 0 && !loading ? (
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
                {search ? ` · ${pagination.total} sonuç` : ""}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => goToPage(pagination.page - 1)}
                  className="rounded border border-gray-700 px-3 py-1 disabled:opacity-40"
                >
                  Önceki
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.pageCount}
                  onClick={() => goToPage(pagination.page + 1)}
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
                  <th className="px-3 py-2 font-semibold">Arşiv</th>
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
                    <td className="px-3 py-2 text-gray-400">
                      {u.archiveStatus === "archived"
                        ? "Arşivli"
                        : u.archiveStatus === "archive_pending"
                          ? "Bekliyor"
                          : u.archiveStatus === "duplicate_archived"
                            ? "Mükerrer arşiv"
                            : u.archiveStatus === "archive_skipped"
                              ? "Atlandı"
                              : "—"}
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
