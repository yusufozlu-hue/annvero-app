"use client";

/**
 * Firma Muhasebe Hafızası — yetkili kaynak: server learning_memory
 * (document_type = BANK_STATEMENT_ACCOUNTING). Local V2 yalnız cache.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BANK_STATEMENT_ACCOUNTING_DOC,
  buildFirmAccountingMemoryStats,
  filterFirmAccountingMemoryUiRows,
  hydrateFirmAccountingMemoryCache,
  mapServerAccountingRowToUiSafe,
  parseUserCorrectionMeta,
  purgeAccountingMemoryCacheForUserChange,
} from "@/src/utils/accountingMemoryV1";
import {
  fetchLearningMemoryForCompanyDetailed,
  updateLearningMemoryRecordDetailed,
} from "@/src/utils/learningMemory";

const inputClass =
  "rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white outline-none focus:border-indigo-500";

function formatTs(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("tr-TR");
  } catch {
    return "—";
  }
}

export default function AccountMemoryV2Panel({
  selectedCompanyId = "",
  getCompanyDisplayName = () => "",
  companyLabel = "",
}) {
  const [serverRows, setServerRows] = useState([]);
  const [uiRows, setUiRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [bankFilter, setBankFilter] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(null);
  const fetchGenRef = useRef(0);
  const companyIdRef = useRef(selectedCompanyId);

  const firmId = String(selectedCompanyId || "").trim();
  const firmName =
    companyLabel ||
    (firmId ? getCompanyDisplayName({ id: firmId }) : "") ||
    firmId ||
    "—";

  const showToast = (message, type = "success") => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const applyServerSnapshot = useCallback((rawRows, companyId) => {
    const accounting = (rawRows || []).filter(
      (row) =>
        String(row.document_type || row.documentType || "").toUpperCase() ===
        BANK_STATEMENT_ACCOUNTING_DOC
    );
    hydrateFirmAccountingMemoryCache(accounting, companyId);
    const mapped = accounting
      .map(mapServerAccountingRowToUiSafe)
      .filter(Boolean)
      .filter((r) => r.companyId === companyId);
    setServerRows(accounting);
    setUiRows(mapped);
  }, []);

  const loadForCompany = useCallback(
    async (companyId) => {
      const id = String(companyId || "").trim();
      const gen = ++fetchGenRef.current;
      companyIdRef.current = id;

      if (!id) {
        setServerRows([]);
        setUiRows([]);
        setLoadError("");
        setActionError("");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setLoadError("");
      setActionError("");
      setServerRows([]);
      setUiRows([]);

      try {
        const { data, error } = await fetchLearningMemoryForCompanyDetailed(id, {
          includeInactive: true,
        });
        if (gen !== fetchGenRef.current || companyIdRef.current !== id) return;

        if (error) {
          setLoadError(error || "Server kayıtları yüklenemedi.");
          setServerRows([]);
          setUiRows([]);
          return;
        }

        applyServerSnapshot(data || [], id);
        setLoadError("");
      } catch (err) {
        if (gen !== fetchGenRef.current) return;
        setLoadError(err?.message || "Server kayıtları yüklenemedi.");
        setServerRows([]);
        setUiRows([]);
      } finally {
        if (gen === fetchGenRef.current) setIsLoading(false);
      }
    },
    [applyServerSnapshot]
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadForCompany(firmId);
    });
    return () => {
      cancelled = true;
      fetchGenRef.current += 1;
    };
  }, [firmId, loadForCompany]);

  // Logout / unmount: company cache görünümü temizlenir
  useEffect(() => {
    return () => {
      if (firmId) {
        purgeAccountingMemoryCacheForUserChange({
          previousUserId: "session",
          nextUserId: "gone",
          companyId: firmId,
        });
      }
    };
  }, [firmId]);

  const filtered = useMemo(
    () =>
      filterFirmAccountingMemoryUiRows(uiRows, {
        status: statusFilter === "TUMU" ? "TUMU" : statusFilter,
        bankId: bankFilter,
        search,
      }),
    [uiRows, statusFilter, bankFilter, search]
  );

  const stats = useMemo(() => buildFirmAccountingMemoryStats(uiRows), [uiRows]);

  const handleDisable = async (row) => {
    if (!row?.id || busyId) return;
    setBusyId(row.id);
    setActionError("");
    const prevUi = uiRows;
    try {
      const raw = serverRows.find((r) => String(r.id) === String(row.id));
      const meta = parseUserCorrectionMeta(raw || {});
      const result = await updateLearningMemoryRecordDetailed(row.id, {
        status: "passive",
        user_correction: JSON.stringify({
          ...meta,
          status: "disabled",
          disabledAt: new Date().toISOString(),
        }),
      });
      if (!result.ok) {
        setActionError(result.error || "Pasifleştirme yazılamadı.");
        setUiRows(prevUi);
        showToast("Pasifleştirme başarısız; kayıt aktif kaldı.", "error");
        return;
      }
      showToast("Kayıt sunucuda pasifleştirildi.", "success");
      await loadForCompany(firmId);
    } catch (err) {
      setUiRows(prevUi);
      setActionError(err?.message || "Pasifleştirme başarısız.");
      showToast("Pasifleştirme başarısız; kayıt aktif kaldı.", "error");
    } finally {
      setBusyId("");
    }
  };

  const emptyMessage = !firmId
    ? "Aktif firma seçin."
    : "Bu firma için henüz onaylanmış muhasebe hafızası kaydı yok.";

  return (
    <section className="mb-8 rounded-2xl border border-violet-800/40 bg-violet-950/20 p-4 text-violet-50">
      {toast ? (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            toast.type === "error"
              ? "border-red-700 bg-red-950/60 text-red-100"
              : "border-emerald-700 bg-emerald-950/50 text-emerald-100"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Firma Muhasebe Hafızası</h2>
          <p className="mt-1 text-xs text-violet-200/80">
            Yetkili kayıtlar güvenli şekilde sunucuda tutulur; tarayıcı yalnız
            performans önbelleğidir. Kapsam: {firmName}
          </p>
        </div>
        <button
          type="button"
          disabled={isLoading || !firmId}
          onClick={() => loadForCompany(firmId)}
          className="rounded-lg border border-violet-600/60 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          Yenile ({stats.active}/{stats.total})
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-violet-200/90">
        <span>Aktif: {stats.active}</span>
        <span>Pasif: {stats.disabled}</span>
        <span>Superseded: {stats.superseded}</span>
      </div>

      {loadError ? (
        <div className="mt-3 rounded-xl border border-red-700/50 bg-red-950/40 p-3 text-sm text-red-100">
          Server kayıtları yüklenemedi. {loadError}
          <div className="mt-1 text-xs text-red-200/80">
            Yerel önbellek yetkili kayıt olarak gösterilmez.
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-2 text-xs text-amber-200">{actionError}</div>
      ) : null}

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <select
          className={inputClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="active">Aktif</option>
          <option value="disabled">Pasif</option>
          <option value="superseded">Superseded</option>
          <option value="TUMU">Tüm durumlar</option>
        </select>
        <input
          className={inputClass}
          placeholder="Banka"
          value={bankFilter}
          onChange={(e) => setBankFilter(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="Hesap / tip ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-violet-900/50">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-violet-950/90 text-violet-200">
            <tr>
              <th className="px-2 py-2">Kaynak</th>
              <th className="px-2 py-2">Banka</th>
              <th className="px-2 py-2">Tip / Yön</th>
              <th className="px-2 py-2">PB</th>
              <th className="px-2 py-2">Hesap</th>
              <th className="px-2 py-2">Güven</th>
              <th className="px-2 py-2">Durum</th>
              <th className="px-2 py-2">Oluşturma</th>
              <th className="px-2 py-2">Son kullanım</th>
              <th className="px-2 py-2">Kul / Baş / Düz</th>
              <th className="px-2 py-2">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} className="px-2 py-6 text-center text-violet-300/70">
                  Sunucu kayıtları yükleniyor…
                </td>
              </tr>
            ) : null}
            {!isLoading && !loadError && !filtered.length ? (
              <tr>
                <td colSpan={11} className="px-2 py-6 text-center text-violet-300/70">
                  {emptyMessage}
                </td>
              </tr>
            ) : null}
            {!isLoading &&
              filtered.map((record) => (
                <tr key={record.id} className="border-t border-violet-900/40">
                  <td className="px-2 py-2">{record.decisionSource}</td>
                  <td className="px-2 py-2">{record.bankId || "—"}</td>
                  <td className="px-2 py-2">
                    {record.transactionType || "—"} / {record.direction || "—"}
                  </td>
                  <td className="px-2 py-2">{record.currency || "—"}</td>
                  <td className="px-2 py-2 font-mono">{record.accountCode}</td>
                  <td className="px-2 py-2">{record.confidence}</td>
                  <td className="px-2 py-2">
                    {record.status === "active"
                      ? "Aktif"
                      : record.status === "superseded"
                        ? "Superseded"
                        : "Pasif"}
                  </td>
                  <td className="px-2 py-2">{formatTs(record.createdAt)}</td>
                  <td className="px-2 py-2">{formatTs(record.lastUsedAt)}</td>
                  <td className="px-2 py-2">
                    {record.usageCount}/{record.successCount}/
                    {record.correctionCount}
                  </td>
                  <td className="px-2 py-2">
                    {record.status === "active" ? (
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        className="rounded border border-slate-600 px-1.5 py-0.5 disabled:opacity-50"
                        onClick={() => handleDisable(record)}
                      >
                        {busyId === record.id ? "…" : "Pasifleştir"}
                      </button>
                    ) : (
                      <span className="text-violet-400/70">—</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
