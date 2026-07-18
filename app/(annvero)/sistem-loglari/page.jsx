"use client";

import { useEffect, useMemo, useState } from "react";
import AnnveroDataTable from "@/src/components/AnnveroDataTable";
import AnnveroDateInput from "@/src/components/AnnveroDateInput";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import {
  annveroBtnPrimary,
  annveroInputClass,
  annveroPanelClass,
  annveroStatCardClass,
} from "@/src/styles/annveroDesign";
import {
  buildSystemLogStats,
  collectAggregatedSystemLogs,
  filterSystemLogs,
  SYSTEM_LOG_LEVELS,
  SYSTEM_LOG_STATUSES,
  updateSystemLogStatus,
} from "@/src/utils/systemLogEngine";

const MODULE_OPTIONS = [
  "Tümü",
  "Banka Parser",
  "Otomasyon Merkezi",
  "AI Ofis Asistanı",
  "Sistem",
  "XML / e-Defter",
];

function levelBadge(level) {
  const map = {
    info: "bg-blue-500/15 text-blue-200",
    warning: "bg-amber-500/15 text-amber-200",
    error: "bg-red-500/15 text-red-200",
    critical: "bg-rose-600/20 text-rose-100",
  };
  return map[level] || map.info;
}

export default function SistemLoglariPage() {
  const { companies, selectedCompanyId } = useCompanyList();
  const [logs, setLogs] = useState([]);
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [moduleFilter, setModuleFilter] = useState("Tümü");
  const [levelFilter, setLevelFilter] = useState("Tümü");
  const [companyFilter, setCompanyFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLogs(collectAggregatedSystemLogs());
  }, []);

  useEffect(() => {
    setCompanyFilter(selectedCompanyId || "");
  }, [selectedCompanyId]);

  const filtered = useMemo(
    () =>
      filterSystemLogs(logs, {
        module: moduleFilter,
        companyId: companyFilter,
        level: levelFilter,
        status: statusFilter,
        dateFrom,
        dateTo,
        search,
      }),
    [logs, moduleFilter, companyFilter, levelFilter, statusFilter, dateFrom, dateTo, search]
  );

  const stats = useMemo(() => buildSystemLogStats(filtered), [filtered]);

  const columns = [
    {
      key: "createdAt",
      label: "Tarih",
      render: (row) => (
        <span className="tabular-nums text-slate-300">
          {row.createdAt ? new Date(row.createdAt).toLocaleString("tr-TR") : "—"}
        </span>
      ),
      sortValue: (row) => row.createdAt,
    },
    {
      key: "level",
      label: "Seviye",
      render: (row) => (
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${levelBadge(row.level)}`}>
          {row.level}
        </span>
      ),
    },
    { key: "module", label: "Modül", filterable: true },
    {
      key: "companyName",
      label: "Firma",
      render: (row) => row.companyName || row.companyId || "—",
      filterable: true,
    },
    { key: "fileName", label: "Dosya", filterable: true },
    { key: "message", label: "Mesaj", filterable: true },
    {
      key: "suggestion",
      label: "Çözüm Önerisi",
      render: (row) => (
        <span className="max-w-xs text-xs text-cyan-200/80">{row.suggestion || "—"}</span>
      ),
    },
    {
      key: "retryable",
      label: "Retry",
      render: (row) => (row.retryable ? "Evet" : "Hayır"),
    },
    {
      key: "status",
      label: "Durum",
      render: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            (row.status || "open") === "resolved"
              ? "bg-emerald-500/15 text-emerald-200"
              : "bg-amber-500/15 text-amber-200"
          }`}
        >
          {(row.status || "open") === "resolved" ? "Çözüldü" : "Açık"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "İşlem",
      sortable: false,
      render: (row) =>
        row.id?.startsWith("syslog-") && (row.status || "open") !== "resolved" ? (
          <button
            type="button"
            onClick={() => {
              updateSystemLogStatus(row.id, "resolved");
              setLogs(collectAggregatedSystemLogs());
            }}
            className="rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            Çözüldü işaretle
          </button>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className={annveroPanelClass}>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/80">
          Sistem Yönetimi
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white">Sistem Hata ve İşlem Logları</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Parser, XML, otomasyon, eşleşmeyen işlem ve retry kayıtlarını tek merkezden izleyin.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Toplam" value={stats.total} />
        <Stat label="Hata" value={stats.errors} tone="text-red-300" />
        <Stat label="Uyarı" value={stats.warnings} tone="text-amber-300" />
        <Stat label="Parser" value={stats.parserErrors} />
        <Stat label="XML" value={stats.xmlErrors} />
        <Stat label="Açık" value={stats.open} tone="text-amber-300" />
        <Stat label="Retry" value={stats.retryCount} />
      </section>

      <section className={`${annveroPanelClass} grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7`}>
        <label className="block xl:col-span-2">
          <span className="mb-1 block text-xs text-slate-400">Arama</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={annveroInputClass}
            placeholder="Mesaj, detay..."
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Modül</span>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className={annveroInputClass}
          >
            {MODULE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Seviye</span>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className={annveroInputClass}
          >
            {SYSTEM_LOG_LEVELS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Durum</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={annveroInputClass}
          >
            {SYSTEM_LOG_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option === "open" ? "Açık" : option === "resolved" ? "Çözüldü" : option}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Firma</span>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className={annveroInputClass}
          >
            <option value="">Tümü</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name || company.title || company.id}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Başlangıç</span>
          <AnnveroDateInput
            value={dateFrom}
            onChange={setDateFrom}
            className={annveroInputClass}
            aria-label="Başlangıç"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Bitiş</span>
          <AnnveroDateInput
            value={dateTo}
            onChange={setDateTo}
            className={annveroInputClass}
            aria-label="Bitiş"
          />
        </label>
      </section>

      <AnnveroDataTable columns={columns} rows={filtered} pageSize={30} searchPlaceholder="Loglarda ara..." />

      <div className="flex justify-end">
        <button type="button" onClick={() => setLogs(collectAggregatedSystemLogs())} className={annveroBtnPrimary}>
          Logları Yenile
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "text-white" }) {
  return (
    <div className={annveroStatCardClass}>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
