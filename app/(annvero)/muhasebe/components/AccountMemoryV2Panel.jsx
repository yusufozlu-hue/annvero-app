"use client";

/**
 * Firma Muhasebe Hafızası — governance yönetim paneli (BSA + keyword).
 * Soft-delete yok; kayıtlar pasife alınır veya superseded olur.
 * Signature/hash gösterilmez.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAccountingMemoryGovernance,
  deactivateAccountingMemoryRecord,
  reactivateAccountingMemoryRecord,
  resolveAccountingMemoryConflict,
  rollbackAccountingMemoryRecord,
  formatGovernanceMutationError,
} from "@/src/utils/accountingMemoryGovernanceClient";
import { purgeAccountingMemoryCacheForUserChange } from "@/src/utils/accountingMemoryV1";

const inputClass =
  "rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white outline-none focus:border-indigo-500";

const TABS = [
  { id: "active", label: "Aktif Hafıza" },
  { id: "review", label: "İnceleme Gerekenler" },
  { id: "history", label: "Pasif / Geçmiş" },
];

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
  onMemoryChanged = null,
}) {
  const [tabs, setTabs] = useState({ active: [], review: [], history: [] });
  const [stats, setStats] = useState({ active: 0, review: 0, history: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [migrationWarn, setMigrationWarn] = useState("");
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [toast, setToast] = useState(null);
  const fetchGenRef = useRef(0);
  const companyIdRef = useRef(selectedCompanyId);
  const mutatingRef = useRef(false);
  const mountedRef = useRef(false);

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fetchGenRef.current += 1;
      companyIdRef.current = "";
    };
  }, []);

  const loadForCompany = useCallback(async (companyId) => {
    const id = String(companyId || "").trim();
    const gen = ++fetchGenRef.current;
    companyIdRef.current = id;

    if (!id) {
      setTabs({ active: [], review: [], history: [] });
      setStats({ active: 0, review: 0, history: 0, total: 0 });
      setLoadError("");
      setMigrationWarn("");
      setIsLoading(false);
      setConfirmAction(null);
      return;
    }

    setIsLoading(true);
    setLoadError("");
    setTabs({ active: [], review: [], history: [] });
    setConfirmAction(null);

    try {
      const result = await fetchAccountingMemoryGovernance(id);
      if (gen !== fetchGenRef.current || companyIdRef.current !== id) return;

      if (!result.ok) {
        setLoadError(result.error || "Server kayıtları yüklenemedi.");
        setTabs({ active: [], review: [], history: [] });
        return;
      }

      setTabs(result.tabs || { active: [], review: [], history: [] });
      setStats(result.stats || { active: 0, review: 0, history: 0, total: 0 });
      setLoadError("");
    } catch (err) {
      if (gen !== fetchGenRef.current) return;
      setLoadError(err?.message || "Server kayıtları yüklenemedi.");
      setTabs({ active: [], review: [], history: [] });
    } finally {
      if (gen === fetchGenRef.current) setIsLoading(false);
    }
  }, []);

  const refreshAfterMutation = useCallback(
    async ({ companyId, action, result }) => {
      if (!mountedRef.current || companyIdRef.current !== companyId) return;

      await Promise.all([
        loadForCompany(companyId),
        typeof onMemoryChanged === "function"
          ? Promise.resolve(onMemoryChanged({ companyId, action, result }))
          : Promise.resolve(),
      ]);
    },
    [loadForCompany, onMemoryChanged]
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadForCompany(firmId);
    });
    return () => {
      cancelled = true;
      fetchGenRef.current += 1;
      if (companyIdRef.current === firmId) {
        companyIdRef.current = "";
      }
    };
  }, [firmId, loadForCompany]);

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

  const rows = useMemo(() => {
    const list = tabs[tab] || [];
    const q = String(search || "").trim().toUpperCase();
    if (!q) return list;
    return list.filter((row) => {
      const hay = `${row.accountCode} ${row.bankId} ${row.transactionType} ${row.direction} ${row.lucaLegLabel} ${row.kind} ${row.sourceLabel}`
        .toUpperCase();
      return hay.includes(q);
    });
  }, [tabs, tab, search]);

  const runConfirmedAction = async () => {
    if (!confirmAction || busyId || !firmId || mutatingRef.current) return;
    mutatingRef.current = true;
    const { type, row } = confirmAction;
    const mutationCompanyId = firmId;
    setBusyId(row.memoryId);
    try {
      let result;
      const base = {
        companyId: mutationCompanyId,
        memoryId: row.memoryId,
        expectedRevision: row.revision,
      };
      if (type === "deactivate") {
        result = await deactivateAccountingMemoryRecord(base);
      } else if (type === "reactivate") {
        result = await reactivateAccountingMemoryRecord(base);
      } else if (type === "resolve") {
        result = await resolveAccountingMemoryConflict(base);
      } else if (type === "rollback") {
        result = await rollbackAccountingMemoryRecord(base);
      } else {
        result = { ok: false, error: "Bilinmeyen işlem" };
      }

      if (!result.ok) {
        if (
          mountedRef.current &&
          companyIdRef.current === mutationCompanyId
        ) {
          if (result.code === "MIGRATION_REQUIRED") {
            setMigrationWarn(formatGovernanceMutationError(result));
            showToast(formatGovernanceMutationError(result), "error");
          } else {
            showToast(formatGovernanceMutationError(result), "error");
          }
          await loadForCompany(mutationCompanyId);
        }
        return;
      }

      if (
        !mountedRef.current ||
        companyIdRef.current !== mutationCompanyId
      ) {
        return;
      }

      setMigrationWarn("");
      showToast(
        type === "deactivate"
          ? "Kayıt pasife alındı (silinmedi)."
          : type === "reactivate"
            ? "Kayıt etkinleştirildi."
            : type === "resolve"
              ? "Çakışma çözüldü; seçilen hesap aktif."
              : "Önceki sürüme dönüldü (yeni revision).",
        "success"
      );
      setConfirmAction(null);
      await refreshAfterMutation({
        companyId: mutationCompanyId,
        action: type,
        result,
      });
    } catch (err) {
      if (
        mountedRef.current &&
        companyIdRef.current === mutationCompanyId
      ) {
        showToast(err?.message || "İşlem başarısız; aktif kayıt korundu.", "error");
        await loadForCompany(mutationCompanyId);
      }
    } finally {
      if (mountedRef.current) setBusyId("");
      mutatingRef.current = false;
    }
  };

  const emptyMessage = !firmId
    ? "Aktif firma seçin."
    : tab === "review"
      ? "İnceleme bekleyen kayıt yok."
      : tab === "history"
        ? "Pasif veya geçmiş sürüm yok."
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
            BSA ve anahtar kelime kayıtları tek yönetim merkezinden yönetilir.
            Hatalı kayıt silinmez; pasife alınır veya önceki sürüme dönülür. Kapsam:{" "}
            {firmName}
          </p>
        </div>
        <button
          type="button"
          disabled={isLoading || !firmId || Boolean(busyId)}
          onClick={() => loadForCompany(firmId)}
          className="rounded-lg border border-violet-600/60 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          Yenile ({stats.active}/{stats.total || 0})
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={!firmId}
            onClick={() => setTab(item.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              tab === item.id
                ? "bg-violet-700 text-white"
                : "border border-violet-700/50 text-violet-100"
            }`}
          >
            {item.label}
            {item.id === "active" ? ` (${stats.active || 0})` : ""}
            {item.id === "review" ? ` (${stats.review || 0})` : ""}
            {item.id === "history" ? ` (${stats.history || 0})` : ""}
          </button>
        ))}
      </div>

      {migrationWarn ? (
        <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/40 p-3 text-sm text-amber-50">
          {migrationWarn}
          <div className="mt-1 text-xs text-amber-100/80">
            Sahte başarı gösterilmez; kayıt sunucuda değiştirilmedi.
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="mt-3 rounded-xl border border-red-700/50 bg-red-950/40 p-3 text-sm text-red-100">
          Yönetim listesi yüklenemedi. {loadError}
          <div className="mt-1 text-xs text-red-200/80">
            Parser çalışmaya devam edebilir; belirsiz kayıt otomatik uygulanmaz.
          </div>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/40 p-3 text-sm text-amber-50">
          <div className="font-semibold">Onay gerekli</div>
          <p className="mt-1 text-xs text-amber-100/90">
            {confirmAction.type === "deactivate"
              ? `Pasife alınacak hesap: ${confirmAction.row.accountCode} (${confirmAction.row.lucaLegLabel}). Kayıt silinmez.`
              : confirmAction.type === "reactivate"
                ? `Etkinleştirilecek hesap: ${confirmAction.row.accountCode}. Aynı imza için diğer aktifler geçersiz kılınır.`
                : confirmAction.type === "resolve"
                  ? `Çakışmada seçilen hesap: ${confirmAction.row.accountCode}. Diğer adaylar geçmişe alınır.`
                  : `Bu sürüme dönülecek hesap: ${confirmAction.row.accountCode}. Eski kayıt korunur; yeni aktif sürüm oluşur.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => void runConfirmedAction()}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busyId ? "İşleniyor…" : "Onayla"}
            </button>
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => setConfirmAction(null)}
              className="rounded-lg border border-amber-700/60 px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <input
          className={`${inputClass} w-full md:max-w-sm`}
          placeholder="Hesap / banka / tip / keyword ara…"
          value={search}
          disabled={!firmId}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mt-4 max-h-96 overflow-auto rounded-xl border border-violet-900/50">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-violet-950/90 text-violet-200">
            <tr>
              <th className="px-2 py-2">Tür</th>
              <th className="px-2 py-2">Banka / tip</th>
              <th className="px-2 py-2">Bacak</th>
              <th className="px-2 py-2">Hesap</th>
              <th className="px-2 py-2">Durum</th>
              <th className="px-2 py-2">Sürüm</th>
              <th className="px-2 py-2">Güven</th>
              <th className="px-2 py-2">Son değişiklik</th>
              <th className="px-2 py-2">Kaynak</th>
              <th className="px-2 py-2">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} className="px-2 py-6 text-center text-violet-300/70">
                  Sunucu kayıtları yükleniyor…
                </td>
              </tr>
            ) : null}
            {!isLoading && !loadError && !rows.length ? (
              <tr>
                <td colSpan={10} className="px-2 py-6 text-center text-violet-300/70">
                  {emptyMessage}
                </td>
              </tr>
            ) : null}
            {!isLoading &&
              rows.map((record) => (
                <tr key={record.memoryId} className="border-t border-violet-900/40">
                  <td className="px-2 py-2">
                    {record.kind === "keyword" ? "Keyword" : "BSA"}
                  </td>
                  <td className="px-2 py-2">
                    {record.bankId} / {record.transactionType} / {record.direction}
                  </td>
                  <td className="px-2 py-2">{record.lucaLegLabel}</td>
                  <td className="px-2 py-2 font-mono">{record.accountCode}</td>
                  <td className="px-2 py-2">{record.statusLabel}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono">
                    r{record.revision}
                  </td>
                  <td className="px-2 py-2">{record.confidence}</td>
                  <td className="px-2 py-2">{formatTs(record.updatedAt)}</td>
                  <td className="px-2 py-2">{record.sourceLabel}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {record.canDeactivate ? (
                        <button
                          type="button"
                          disabled={Boolean(busyId)}
                          className="rounded border border-slate-600 px-1.5 py-0.5 disabled:opacity-50"
                          onClick={() =>
                            setConfirmAction({ type: "deactivate", row: record })
                          }
                        >
                          Pasife Al
                        </button>
                      ) : null}
                      {record.canReactivate && tab === "history" ? (
                        <button
                          type="button"
                          disabled={Boolean(busyId)}
                          className="rounded border border-emerald-700/60 px-1.5 py-0.5 disabled:opacity-50"
                          onClick={() =>
                            setConfirmAction({ type: "reactivate", row: record })
                          }
                        >
                          Etkinleştir
                        </button>
                      ) : null}
                      {record.canResolve ? (
                        <button
                          type="button"
                          disabled={Boolean(busyId)}
                          className="rounded border border-amber-600/70 px-1.5 py-0.5 disabled:opacity-50"
                          onClick={() =>
                            setConfirmAction({ type: "resolve", row: record })
                          }
                        >
                          Çöz
                        </button>
                      ) : null}
                      {record.canRollback && tab === "history" ? (
                        <button
                          type="button"
                          disabled={Boolean(busyId)}
                          className="rounded border border-sky-700/60 px-1.5 py-0.5 disabled:opacity-50"
                          onClick={() =>
                            setConfirmAction({ type: "rollback", row: record })
                          }
                        >
                          Bu sürüme dön
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
