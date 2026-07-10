"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { DOCUMENT_TYPE_OPTIONS } from "@/src/utils/previewRowEdit";
import {
  dismissUnrecognizedTransaction,
  fetchUnrecognizedTransactions,
  learnUnrecognizedTransaction,
} from "@/src/utils/transactionMemoryApi";
import { logOperationalEvent, SYSTEM_ERROR_TYPES } from "@/src/utils/systemLogEngine";
import AnnveroEditableDataTable from "@/src/components/AnnveroEditableDataTable";
import SmartDateInput from "@/src/components/SmartDateInput";
import { annveroInputClass } from "@/src/styles/annveroDesign";
import {
  buildUnrecognizedStats,
  filterUnrecognizedRows,
  getPrimaryIssue,
  ISSUE_TYPE,
  ISSUE_TYPE_META,
  resolveRowIssues,
  UNRECOGNIZED_STATUS_LABEL,
} from "@/src/utils/transactionMemoryEngine";

const inputClassName = annveroInputClass;

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

function formatAiScore(row) {
  const score = Number(row.suggestionScore || row.suggestion_score || 0);
  if (!score) return "—";
  return `${score}%`;
}

function normalizeDescriptionKey(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function groupRowsByDescription(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = normalizeDescriptionKey(row.rawDescription || row.cleanDescription);
    if (!map.has(key)) {
      map.set(key, { key, description: row.rawDescription || row.cleanDescription, rows: [] });
    }
    map.get(key).rows.push(row);
  });
  return Array.from(map.values()).sort((a, b) => b.rows.length - a.rows.length);
}

function StatCard({ label, value, accent, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active
          ? "border-[var(--annvero-accent)] bg-[var(--annvero-accent-soft)] shadow-lg"
          : "border-[var(--annvero-border)] bg-[var(--annvero-surface)] hover:bg-[var(--annvero-hover)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="annvero-text-muted text-xs font-medium uppercase tracking-wide">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--annvero-text)]">
            {value}
          </p>
        </div>
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${accent}`} />
      </div>
    </button>
  );
}

function IssueBadges({ row }) {
  const issues = resolveRowIssues(row);
  const primary = getPrimaryIssue(row);

  return (
    <div className="flex flex-wrap gap-1.5">
      {issues.map((issueId) => {
        const meta = ISSUE_TYPE_META[issueId];
        if (!meta) return null;
        const isPrimary = issueId === primary;
        return (
          <span
            key={issueId}
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.className} ${
              isPrimary ? "" : "opacity-80"
            }`}
          >
            {meta.label}
          </span>
        );
      })}
      {row.status && row.status !== "pending" ? (
        <span className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-gray-300 ring-1 ring-white/10">
          {UNRECOGNIZED_STATUS_LABEL[row.status] || row.status}
        </span>
      ) : null}
    </div>
  );
}

export default function IslemHafizasiPage() {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompanyList();

  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [bankFilter, setBankFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [issueFilter, setIssueFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [groupByDescription, setGroupByDescription] = useState(false);
  const [bulkDraft, setBulkDraft] = useState({
    accountCode: "",
    accountName: "",
    documentType: "DK",
    cariName: "",
    cleanDescription: "",
  });

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
        status: "all",
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
  }, [selectedCompanyId]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const stats = useMemo(() => buildUnrecognizedStats(rows), [rows]);

  const bankOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((row) => {
      if (row.sourceBank) set.add(row.sourceBank);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [rows]);

  const typeOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((row) => {
      if (row.transactionType) set.add(row.transactionType);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      filterUnrecognizedRows(rows, {
        search,
        status: statusFilter,
        bank: bankFilter,
        transactionType: typeFilter,
        issueType: issueFilter,
        dateFrom,
        dateTo,
      }),
    [
      rows,
      search,
      statusFilter,
      bankFilter,
      typeFilter,
      issueFilter,
      dateFrom,
      dateTo,
    ]
  );

  const groupedRows = useMemo(
    () => (groupByDescription ? groupRowsByDescription(filteredRows) : []),
    [filteredRows, groupByDescription]
  );

  const displayRows = groupByDescription
    ? groupedRows.flatMap((group) => group.rows)
    : filteredRows;

  const unknownQueueColumns = useMemo(
    () => [
      {
        key: "transactionDate",
        label: "Tarih",
        sortable: true,
        render: (row) => (
          <div>
            <div className="font-medium text-gray-200">{row.transactionDate || "—"}</div>
            <div className="text-xs text-gray-500">{row.sourceBank || "—"}</div>
          </div>
        ),
      },
      {
        key: "rawDescription",
        label: "Açıklama",
        editable: true,
        editKey: "cleanDescription",
        editPlaceholder: "Temiz açıklama",
        sortable: true,
        editDisplay: (row, { draft }) =>
          row.status !== "pending" ? (
            <span className="max-w-xs text-gray-100">{row.rawDescription}</span>
          ) : null,
        render: (row) => <span className="max-w-xs text-gray-100">{row.rawDescription}</span>,
      },
      {
        key: "amount",
        label: "Tutar",
        sortable: true,
        render: (row) => (
          <span className="font-semibold tabular-nums">{formatAmount(row.amount)} ₺</span>
        ),
      },
      {
        key: "suggestionScore",
        label: "AI Skor",
        render: (row) => formatAiScore(row),
      },
      {
        key: "accountCode",
        label: "Hesap kodu",
        editable: true,
        editKey: "accountCode",
        editDisplay: (row, { draft }) =>
          row.status !== "pending" ? (
            <span>{draft?.accountCode || row.suggestedAccountCode || "—"}</span>
          ) : null,
      },
      {
        key: "accountName",
        label: "Hesap adı",
        editable: true,
        editKey: "accountName",
        editDisplay: (row, { draft }) =>
          row.status !== "pending" ? <span>{draft?.accountName || "—"}</span> : null,
      },
      {
        key: "documentType",
        label: "Belge türü",
        editable: true,
        editKey: "documentType",
        editType: "select",
        editOptions: DOCUMENT_TYPE_OPTIONS.map((option) => ({ value: option, label: option })),
        editDisplay: (row, { draft }) =>
          row.status !== "pending" ? <span>{draft?.documentType || "—"}</span> : null,
      },
      {
        key: "cariName",
        label: "Cari",
        editable: true,
        editKey: "cariName",
        editDisplay: (row, { draft }) =>
          row.status !== "pending" ? <span>{draft?.cariName || "—"}</span> : null,
      },
      {
        key: "status",
        label: "Durum",
        render: (row) => <IssueBadges row={row} />,
      },
    ],
    []
  );

  const pendingDisplayRows = displayRows.filter((row) => row.status === "pending");
  const allPendingSelected =
    pendingDisplayRows.length > 0 &&
    pendingDisplayRows.every((row) => selectedIds.includes(row.id));

  const toggleRowSelection = (rowId) => {
    setSelectedIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]
    );
  };

  const toggleSelectAllPending = () => {
    if (allPendingSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pendingDisplayRows.some((row) => row.id === id)));
      return;
    }
    const ids = pendingDisplayRows.map((row) => row.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const applyBulkDraftToSelection = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      selectedIds.forEach((id) => {
        next[id] = { ...(next[id] || {}), ...bulkDraft };
      });
      return next;
    });
    showToast("Toplu taslak seçili satırlara uygulandı.");
  };

  const handleBulkLearn = async () => {
    if (!selectedIds.length) {
      showToast("Toplu öğretme için satır seçin.", "error");
      return;
    }

    setBusyId("bulk");
    let success = 0;
    try {
      for (const id of selectedIds) {
        const row = rows.find((item) => item.id === id);
        if (!row || row.status !== "pending") continue;
        const draft = { ...(drafts[id] || buildDraft(row)), ...bulkDraft };
        if (!String(draft.accountCode || "").trim()) continue;
        await learnUnrecognizedTransaction(id, draft);
        success += 1;
        logOperationalEvent({
          module: "Unknown Queue",
          message: "Toplu öğretme başarılı",
          level: "info",
          companyId: row.companyId,
          errorType: SYSTEM_ERROR_TYPES.LEARN_SUCCESS,
          technicalDetail: { transactionId: id, accountCode: draft.accountCode },
        });
      }
      showToast(`${success} işlem toplu öğretildi.`);
      setSelectedIds([]);
      await loadRows();
    } catch (error) {
      logOperationalEvent({
        module: "Unknown Queue",
        message: "Toplu öğretme başarısız",
        level: "error",
        errorType: SYSTEM_ERROR_TYPES.LEARN_FAILED,
        technicalDetail: error.message,
        suggestion: "Hesap kodu ve bağlantıyı kontrol edip tekrar deneyin.",
      });
      showToast(error.message || "Toplu öğretme başarısız.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkDismiss = async () => {
    if (!selectedIds.length) {
      showToast("Toplu işlem için satır seçin.", "error");
      return;
    }

    setBusyId("bulk");
    try {
      for (const id of selectedIds) {
        const row = rows.find((item) => item.id === id);
        if (!row || row.status !== "pending") continue;
        await dismissUnrecognizedTransaction(id);
      }
      showToast(`${selectedIds.length} işlem yok sayıldı.`);
      setSelectedIds([]);
      await loadRows();
    } catch (error) {
      showToast(error.message || "Toplu güncelleme başarısız.", "error");
    } finally {
      setBusyId(null);
    }
  };

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
      setExpandedId(row.id);
      return;
    }

    setBusyId(row.id);
    try {
      await learnUnrecognizedTransaction(row.id, draft);
      logOperationalEvent({
        module: "Unknown Queue",
        message: "İşlem öğrenildi",
        level: "info",
        companyId: row.companyId,
        errorType: SYSTEM_ERROR_TYPES.LEARN_SUCCESS,
        technicalDetail: { transactionId: row.id, accountCode: draft.accountCode },
      });
      showToast("İşlem öğrenildi ve hafızaya kaydedildi.");
      setExpandedId(null);
      await loadRows();
    } catch (error) {
      logOperationalEvent({
        module: "Unknown Queue",
        message: "Öğrenme başarısız",
        level: "error",
        companyId: row.companyId,
        errorType: SYSTEM_ERROR_TYPES.LEARN_FAILED,
        technicalDetail: error.message,
        suggestion: "Hesap kodu zorunludur; taslak alanlarını kontrol edin.",
      });
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
      setExpandedId(null);
      await loadRows();
    } catch (error) {
      showToast(error.message || "Güncelleme başarısız.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setBankFilter("");
    setTypeFilter("");
    setIssueFilter("");
    setDateFrom("");
    setDateTo("");
    setStatusFilter("pending");
  };

  return (
    <main className="annvero-page min-h-0 px-0 py-2 sm:py-4">
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-4 right-4 z-[9999] max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur ${
            toast.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/95 text-emerald-100"
              : "border-red-500/40 bg-red-950/95 text-red-100"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--annvero-accent)]">
            Kural &amp; Hafıza
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--annvero-text)] sm:text-4xl">
            İşlem Hafızası / Öğrenme Merkezi
          </h1>
          <p className="annvero-text-muted mt-2 max-w-3xl text-sm leading-relaxed sm:text-base">
            Banka parser&apos;ın tanıyamadığı işlemleri düzeltin. Sistem hesap, belge türü ve
            cari bilgisini öğrenir; sonraki ekstrelerde benzer açıklamalar için öneri üretir.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/muhasebe/ogrenen-hafiza"
            className="rounded-xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--annvero-text)] transition hover:bg-[var(--annvero-hover)]"
          >
            Öğrenilen Kurallar
          </Link>
          <Link
            href="/muhasebe/banka-ekstresi"
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:from-indigo-500 hover:to-violet-500"
          >
            Banka Ekstresi
          </Link>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Toplam Tanınmayan"
          value={stats.total}
          accent="bg-indigo-400"
          active={!issueFilter && statusFilter === "pending"}
          onClick={() => {
            setStatusFilter("pending");
            setIssueFilter("");
          }}
        />
        <StatCard
          label="Cari Bulunamadı"
          value={stats.missingCari}
          accent="bg-amber-400"
          active={issueFilter === ISSUE_TYPE.MISSING_CARI}
          onClick={() => {
            setStatusFilter("pending");
            setIssueFilter(ISSUE_TYPE.MISSING_CARI);
          }}
        />
        <StatCard
          label="Hesap Bulunamadı"
          value={stats.missingAccount}
          accent="bg-sky-400"
          active={issueFilter === ISSUE_TYPE.MISSING_ACCOUNT}
          onClick={() => {
            setStatusFilter("pending");
            setIssueFilter(ISSUE_TYPE.MISSING_ACCOUNT);
          }}
        />
        <StatCard
          label="Belge Tipi Belirsiz"
          value={stats.unclearDocument}
          accent="bg-emerald-400"
          active={issueFilter === ISSUE_TYPE.UNCLEAR_DOCUMENT}
          onClick={() => {
            setStatusFilter("pending");
            setIssueFilter(ISSUE_TYPE.UNCLEAR_DOCUMENT);
          }}
        />
        <StatCard
          label="İlk Kez Görülen"
          value={stats.firstSeen}
          accent="bg-red-400"
          active={issueFilter === ISSUE_TYPE.FIRST_SEEN}
          onClick={() => {
            setStatusFilter("pending");
            setIssueFilter(ISSUE_TYPE.FIRST_SEEN);
          }}
        />
      </div>

      <div className="mb-6 rounded-2xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] p-4 shadow-xl shadow-black/10 backdrop-blur sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--annvero-text)]">Filtreler</h2>
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-medium text-[var(--annvero-accent)] hover:opacity-80"
          >
            Filtreleri temizle
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="block sm:col-span-2 xl:col-span-2">
            <span className="annvero-text-muted mb-1.5 block text-xs font-medium">
              Açıklama arama
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Açıklama, hesap, cari..."
              className={inputClassName}
            />
          </label>

          <label className="block">
            <span className="annvero-text-muted mb-1.5 block text-xs font-medium">
              Başlangıç tarihi
            </span>
            <SmartDateInput
              value={dateFrom}
              onChange={setDateFrom}
              className={inputClassName}
              aria-label="Başlangıç tarihi"
            />
          </label>

          <label className="block">
            <span className="annvero-text-muted mb-1.5 block text-xs font-medium">
              Bitiş tarihi
            </span>
            <SmartDateInput
              value={dateTo}
              onChange={setDateTo}
              className={inputClassName}
              aria-label="Bitiş tarihi"
            />
          </label>

          <label className="block">
            <span className="annvero-text-muted mb-1.5 block text-xs font-medium">
              Banka hesabı
            </span>
            <select
              value={bankFilter}
              onChange={(event) => setBankFilter(event.target.value)}
              className={inputClassName}
            >
              <option value="">Tümü</option>
              {bankOptions.map((bank) => (
                <option key={bank} value={bank}>
                  {bank}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="annvero-text-muted mb-1.5 block text-xs font-medium">Durum</span>
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

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-400">
              İşlem tipi
            </span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className={inputClassName}
            >
              <option value="">Tümü</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-400">Firma</span>
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
            <span className="mb-1.5 block text-xs font-medium text-gray-400">
              Tanınmama nedeni
            </span>
            <select
              value={issueFilter}
              onChange={(event) => setIssueFilter(event.target.value)}
              className={inputClassName}
            >
              <option value="">Tümü</option>
              {Object.values(ISSUE_TYPE_META).map((meta) => (
                <option key={meta.id} value={meta.id}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[var(--annvero-border)] bg-[var(--annvero-surface)] shadow-xl shadow-black/10 backdrop-blur">
        <div className="flex flex-col gap-3 border-b border-[var(--annvero-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-xl font-semibold sm:text-2xl">Tanınmayan İşlemler</h2>
            <p className="mt-1 text-sm text-gray-400">
              {filteredRows.length} kayıt listeleniyor
              {stats.total ? ` · ${stats.total} bekleyen` : ""}
              {selectedIds.length ? ` · ${selectedIds.length} seçili` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setGroupByDescription((value) => !value)}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                groupByDescription
                  ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                  : "border-white/10 bg-white/5 text-gray-200 hover:bg-white/10"
              }`}
            >
              Açıklamaya göre grupla
            </button>
            <button
              type="button"
              onClick={loadRows}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:bg-white/10"
            >
              Yenile
            </button>
          </div>
        </div>

        {groupByDescription && groupedRows.length ? (
          <div className="border-b border-white/10 px-4 py-3 sm:px-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-300">
              Açıklama grupları
            </p>
            <div className="flex flex-wrap gap-2">
              {groupedRows.slice(0, 12).map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => {
                    setSearch(group.description || "");
                    setSelectedIds(group.rows.filter((r) => r.status === "pending").map((r) => r.id));
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200 hover:border-indigo-500/40"
                >
                  {group.description?.slice(0, 42) || "—"} ({group.rows.length})
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {selectedIds.length ? (
          <div className="border-b border-indigo-500/20 bg-indigo-950/20 px-4 py-4 sm:px-5">
            <p className="mb-3 text-sm font-semibold text-indigo-100">Toplu işlem ({selectedIds.length})</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
              <input
                value={bulkDraft.accountCode}
                onChange={(e) => setBulkDraft((p) => ({ ...p, accountCode: e.target.value }))}
                placeholder="Hesap kodu"
                className={inputClassName}
              />
              <input
                value={bulkDraft.accountName}
                onChange={(e) => setBulkDraft((p) => ({ ...p, accountName: e.target.value }))}
                placeholder="Hesap adı"
                className={inputClassName}
              />
              <select
                value={bulkDraft.documentType}
                onChange={(e) => setBulkDraft((p) => ({ ...p, documentType: e.target.value }))}
                className={inputClassName}
              >
                {DOCUMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <input
                value={bulkDraft.cariName}
                onChange={(e) => setBulkDraft((p) => ({ ...p, cariName: e.target.value }))}
                placeholder="Cari"
                className={inputClassName}
              />
              <input
                value={bulkDraft.cleanDescription}
                onChange={(e) => setBulkDraft((p) => ({ ...p, cleanDescription: e.target.value }))}
                placeholder="Temiz açıklama"
                className={inputClassName}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applyBulkDraftToSelection}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-gray-200"
              >
                Taslağı uygula
              </button>
              <button
                type="button"
                disabled={busyId === "bulk"}
                onClick={handleBulkLearn}
                className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Toplu öğret
              </button>
              <button
                type="button"
                disabled={busyId === "bulk"}
                onClick={handleBulkDismiss}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-gray-300 disabled:opacity-50"
              >
                Toplu yok say
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="rounded-xl px-3 py-2 text-xs font-semibold text-gray-400"
              >
                Seçimi temizle
              </button>
            </div>
          </div>
        ) : null}

        {/* Mobil kart görünümü */}
        <div className="space-y-3 p-4 lg:hidden">
          {isLoading ? (
            <p className="text-sm text-gray-400">Kayıtlar yükleniyor...</p>
          ) : null}

          {!isLoading && !filteredRows.length ? (
            <p className="rounded-xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-gray-400">
              Tanınmayan işlem bulunamadı. Banka ekstresi yükledikten sonra hesap/cari
              bulunamayan satırlar burada listelenir.
            </p>
          ) : null}

          {displayRows.map((row) => {
            const draft = drafts[row.id] || buildDraft(row);
            const isBusy = busyId === row.id;
            const isPending = row.status === "pending";
            const isExpanded = expandedId === row.id;

            return (
              <article
                key={row.id}
                className="rounded-2xl border border-white/10 bg-gray-950/50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-gray-500">
                      {row.transactionDate || "—"} · {row.sourceBank || "—"}
                    </p>
                    <p className="mt-1 text-sm font-medium text-gray-100">
                      {row.rawDescription}
                    </p>
                    <p className="mt-2 text-base font-semibold tabular-nums">
                      {formatAmount(row.amount)} ₺
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <IssueBadges row={row} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-400">
                  <div>
                    <span className="block text-gray-500">Önerilen hesap</span>
                    <span className="text-gray-200">
                      {row.suggestedAccountCode || draft.accountCode || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-gray-500">Belge tipi</span>
                    <span className="text-gray-200">
                      {row.suggestedDocumentType || draft.documentType || "—"}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="block text-gray-500">Cari</span>
                    <span className="text-gray-200">
                      {row.suggestedCari || draft.cariName || "—"}
                    </span>
                  </div>
                </div>

                {isPending ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : row.id)
                      }
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold"
                    >
                      {isExpanded ? "Kapat" : "Düzenle"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleLearn(row)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-2 text-xs font-semibold shadow-md shadow-violet-950/40 disabled:opacity-50"
                    >
                      <span aria-hidden>✦</span>
                      {isBusy ? "Kaydediliyor..." : "Öğren"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDismiss(row)}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-gray-300 disabled:opacity-50"
                    >
                      Yok say
                    </button>
                  </div>
                ) : null}

                {isPending && isExpanded ? (
                  <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                    <input
                      value={draft.cleanDescription}
                      onChange={(event) =>
                        updateDraft(row.id, "cleanDescription", event.target.value)
                      }
                      placeholder="Temiz açıklama"
                      className={inputClassName}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={draft.accountCode}
                        onChange={(event) =>
                          updateDraft(row.id, "accountCode", event.target.value)
                        }
                        placeholder="Hesap kodu"
                        className={inputClassName}
                      />
                      <input
                        value={draft.accountName}
                        onChange={(event) =>
                          updateDraft(row.id, "accountName", event.target.value)
                        }
                        placeholder="Hesap adı"
                        className={inputClassName}
                      />
                    </div>
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
                    <input
                      value={draft.cariName}
                      onChange={(event) =>
                        updateDraft(row.id, "cariName", event.target.value)
                      }
                      placeholder="Cari"
                      className={inputClassName}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        {/* Masaüstü editable tablo */}
        <div className="hidden lg:block p-4">
          <AnnveroEditableDataTable
            columns={unknownQueueColumns}
            rows={displayRows}
            rowKey="id"
            drafts={drafts}
            selectedIds={selectedIds}
            editingRowId={expandedId}
            validationErrors={Object.fromEntries(
              displayRows
                .filter((row) => row.status === "pending")
                .filter((row) => !String(drafts[row.id]?.accountCode || "").trim())
                .map((row) => [row.id, "Hesap kodu zorunlu"])
            )}
            onToggleSelect={toggleRowSelection}
            onToggleSelectAll={toggleSelectAllPending}
            isRowSelectable={(row) => row.status === "pending"}
            onDraftChange={updateDraft}
            onStartEdit={(rowId) => setExpandedId(rowId)}
            onCancelEdit={(rowId) => {
              setExpandedId((current) => (current === rowId ? null : current));
              setDrafts((prev) => {
                const row = rows.find((item) => item.id === rowId);
                if (!row) return prev;
                return { ...prev, [rowId]: buildDraft(row) };
              });
            }}
            onCommitEdit={(rowId) => {
              const row = rows.find((item) => item.id === rowId);
              if (row) handleLearn(row);
            }}
            isLoading={isLoading}
            enableVirtualScroll={displayRows.length > 100}
            pageSize={50}
            searchPlaceholder="Satır içinde hızlı ara..."
            exportFilename="unknown-queue.csv"
            showToolbar={false}
            emptyMessage="Tanınmayan işlem bulunamadı. Banka ekstresi yükledikten sonra hesap/cari bulunamayan satırlar burada listelenir."
            renderRowActions={(row) => {
              const isBusy = busyId === row.id;
              const isPending = row.status === "pending";
              if (!isPending) return <span className="text-xs text-gray-500">—</span>;
              return (
                <div className="flex min-w-[150px] flex-col gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleLearn(row)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {isBusy ? "Kaydediliyor..." : "Öğren"}
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                      className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-gray-300"
                    >
                      {expandedId === row.id ? "İptal" : "Düzenle"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDismiss(row)}
                      className="flex-1 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] font-semibold text-gray-400"
                    >
                      Yok say
                    </button>
                  </div>
                </div>
              );
            }}
          />
        </div>
      </section>
    </main>
  );
}
