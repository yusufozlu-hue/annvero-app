"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import CompanySelectOptions from "../components/CompanySelectOptions";
import PreviewVoucherDetailPanel from "../components/PreviewVoucherDetailPanel";
import { useCompanyList } from "../hooks/useCompanyList";
import AnnveroDateInput from "@/src/components/AnnveroDateInput";
import {
  loadPendingLucaRows,
  savePendingLucaRows,
} from "@/src/utils/companyCenter";
import {
  AI_RISK,
  analyzeAiKontrolRows,
  buildAiKontrolExcelRows,
  filterAiKontrolFindings,
  loadAccountHistoryFromStorage,
  saveAccountHistoryToStorage,
  updateAccountHistoryFromRows,
} from "@/src/utils/aiKontrolMerkezi";
import {
  applyStandardLucaRowEditDraft,
  buildStandardLucaRowEditDraft,
} from "@/src/utils/previewRowEdit";
import {
  buildStandardLucaTransferPayload,
  ensureStandardLucaRowIds,
  finalizeStandardLucaRow,
  isStandardLucaPayload,
  KAYNAK_TIPI,
} from "@/src/utils/standardLucaRow";
import { fetchLearningMemoryForCompany } from "@/src/utils/learningMemory";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const RISK_OPTIONS = [
  { id: "", label: "Tüm riskler" },
  { id: AI_RISK.YUKSEK, label: "Yüksek" },
  { id: AI_RISK.ORTA, label: "Orta" },
  { id: AI_RISK.DUSUK, label: "Düşük" },
];

const KAYNAK_OPTIONS = [
  { id: "TUMU", label: "Tüm kaynaklar" },
  { id: KAYNAK_TIPI.BANKA, label: "Banka" },
  { id: KAYNAK_TIPI.ELEKTRAWEB, label: "Elektraweb" },
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function riskClass(risk) {
  if (risk === AI_RISK.YUKSEK) return "text-red-300";
  if (risk === AI_RISK.ORTA) return "text-amber-300";
  return "text-sky-300";
}

function riskBadgeClass(risk) {
  if (risk === AI_RISK.YUKSEK) return "bg-red-900/60 text-red-200";
  if (risk === AI_RISK.ORTA) return "bg-amber-900/60 text-amber-200";
  return "bg-sky-900/60 text-sky-200";
}

function getPayloadCompanyId(payload) {
  return payload?.firmaId || payload?.companyId || "";
}

export default function AiKontrolPage() {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompanyList();

  const [payload, setPayload] = useState(null);
  const [rows, setRows] = useState([]);
  const [learningMemory, setLearningMemory] = useState([]);
  const [accountHistory, setAccountHistory] = useState({});
  const [riskFilter, setRiskFilter] = useState("");
  const [kaynakFilter, setKaynakFilter] = useState("TUMU");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [editingRowId, setEditingRowId] = useState(null);
  const [draftRow, setDraftRow] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type) => setToast({ message, type });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const activeCompanyId = selectedCompanyId || getPayloadCompanyId(payload);

  const loadData = useCallback(() => {
    const pending = loadPendingLucaRows();
    const history = loadAccountHistoryFromStorage();

    if (!pending?.rows?.length || !isStandardLucaPayload(pending)) {
      setPayload(null);
      setRows([]);
      setAccountHistory(history);
      return;
    }

    const companyId = getPayloadCompanyId(pending);
    const normalizedRows = ensureStandardLucaRowIds(
      pending.rows.map((row) =>
        finalizeStandardLucaRow({
          ...row,
          firmaId: row.firmaId || companyId,
        })
      )
    );

    setPayload(pending);
    setRows(normalizedRows);
    setAccountHistory(history);

    if (!selectedCompanyId && companyId) {
      setSelectedCompanyId(companyId);
    }
  }, [selectedCompanyId, setSelectedCompanyId]);

  useEffect(() => {
    loadData();
    window.addEventListener("focus", loadData);
    return () => window.removeEventListener("focus", loadData);
  }, [loadData]);

  useEffect(() => {
    if (!activeCompanyId) {
      setLearningMemory([]);
      return;
    }

    fetchLearningMemoryForCompany(activeCompanyId).then(setLearningMemory);
  }, [activeCompanyId]);

  const scopedRows = useMemo(() => {
    if (!selectedCompanyId) return rows;
    return rows.filter((row) => row.firmaId === selectedCompanyId);
  }, [rows, selectedCompanyId]);

  const analysis = useMemo(
    () =>
      scopedRows.length
        ? analyzeAiKontrolRows(scopedRows, {
            learningMemory,
            companyId: activeCompanyId,
            accountHistory: accountHistory[activeCompanyId] || {},
            dateFrom,
            dateTo,
          })
        : null,
    [scopedRows, learningMemory, activeCompanyId, accountHistory, dateFrom, dateTo]
  );

  const filteredFindings = useMemo(
    () =>
      filterAiKontrolFindings(analysis?.findings || [], {
        risk: riskFilter,
        kaynakTipi: kaynakFilter,
        search,
      }),
    [analysis?.findings, riskFilter, kaynakFilter, search]
  );

  const persistRows = (nextRows) => {
    if (!payload) return;

    const companyId = activeCompanyId || getPayloadCompanyId(payload);
    const nextPayload = buildStandardLucaTransferPayload({
      firmaId: companyId,
      companyName: payload.companyName,
      kaynakTipi: payload.kaynakTipi,
      kaynakAdi: payload.kaynakAdi,
      rows: nextRows,
    });

    savePendingLucaRows(nextPayload);
    setPayload(nextPayload);
    setRows(nextRows);

    const nextHistory = updateAccountHistoryFromRows(nextRows, companyId, accountHistory);
    saveAccountHistoryToStorage(nextHistory);
    setAccountHistory(nextHistory);
  };

  const openEdit = (finding) => {
    if (!finding?.row) return;
    setEditingRowId(finding.rowId);
    setDraftRow(buildStandardLucaRowEditDraft(finding.row));
  };

  const cancelEdit = () => {
    setEditingRowId(null);
    setDraftRow(null);
  };

  const saveEdit = () => {
    if (!editingRowId || !draftRow) return;

    const currentRow = rows.find((row) => row.id === editingRowId);
    if (!currentRow) return;

    const updatedRow = finalizeStandardLucaRow(
      applyStandardLucaRowEditDraft(currentRow, draftRow)
    );

    const nextRows = rows.map((row) =>
      row.id === editingRowId ? { ...updatedRow, id: row.id } : row
    );

    persistRows(nextRows);
    showToast("Satır güncellendi", "success");
    cancelEdit();
  };

  const exportReport = () => {
    if (!filteredFindings.length) {
      showToast("Dışa aktarılacak kayıt yok", "error");
      return;
    }

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet([
      {
        Firma: activeCompanyId,
        "Toplam Satır": analysis?.summary.totalRows || 0,
        "Toplam Bulgu": analysis?.summary.totalFindings || 0,
        "Yüksek Risk": analysis?.summary.yuksekRisk || 0,
        "Orta Risk": analysis?.summary.ortaRisk || 0,
        "Düşük Risk": analysis?.summary.dusukRisk || 0,
      },
    ]);
    const findingsSheet = XLSX.utils.json_to_sheet(
      buildAiKontrolExcelRows(filteredFindings)
    );

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Özet");
    XLSX.utils.book_append_sheet(workbook, findingsSheet, "AI Kontrol");
    XLSX.writeFile(
      workbook,
      `AI_Kontrol_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    showToast("Rapor indirildi", "success");
  };

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      {toast ? (
        <div
          role="status"
          className={`fixed top-4 right-4 z-[9999] rounded-lg border px-4 py-3 text-sm font-medium shadow-xl ${
            toast.type === "success"
              ? "border-emerald-700 bg-emerald-950 text-emerald-200"
              : "border-red-700 bg-red-950 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-2 text-4xl font-bold">AI Kontrol Merkezi</h1>
          <p className="max-w-4xl text-gray-400">
            StandardLucaRows üzerinde kural tabanlı şüpheli kayıt analizi. Gerçek AI
            modeli sonraki aşamada eklenecek; şimdilik öğrenen hafıza ve geçmiş hesap
            kullanımı ile çalışır.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={loadData}
            className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-900"
          >
            Yenile
          </button>
          <button
            type="button"
            onClick={exportReport}
            disabled={!filteredFindings.length}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Excel Raporu
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 lg:grid-cols-5">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Firma</span>
          <select
            value={selectedCompanyId}
            onChange={(event) => setSelectedCompanyId(event.target.value)}
            className={inputClassName}
          >
            <option value="">Tüm firmalar</option>
            <CompanySelectOptions companies={companies} />
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Risk Seviyesi</span>
          <select
            value={riskFilter}
            onChange={(event) => setRiskFilter(event.target.value)}
            className={inputClassName}
          >
            {RISK_OPTIONS.map((option) => (
              <option key={option.id || "all"} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Kaynak Tipi</span>
          <select
            value={kaynakFilter}
            onChange={(event) => setKaynakFilter(event.target.value)}
            className={inputClassName}
          >
            {KAYNAK_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Başlangıç Tarihi</span>
          <AnnveroDateInput
            value={dateFrom}
            onChange={setDateFrom}
            className={inputClassName}
            aria-label="Başlangıç Tarihi"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">Bitiş Tarihi</span>
          <AnnveroDateInput
            value={dateTo}
            onChange={setDateTo}
            className={inputClassName}
            aria-label="Bitiş Tarihi"
          />
        </label>
      </div>

      {!scopedRows.length ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 p-10 text-center">
          <h2 className="text-2xl font-semibold">Analiz edilecek satır yok</h2>
          <p className="mx-auto mt-3 max-w-2xl text-gray-400">
            Banka Parser, Elektraweb veya Luca Fiş Üretici ekranından StandardLucaRows
            aktarım kuyruğuna gönderin.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <SummaryCard title="Analiz Satırı" value={analysis?.summary.totalRows || 0} />
            <SummaryCard title="Toplam Bulgu" value={analysis?.summary.totalFindings || 0} />
            <SummaryCard
              title="Yüksek Risk"
              value={analysis?.summary.yuksekRisk || 0}
              tone="error"
            />
            <SummaryCard
              title="Orta Risk"
              value={analysis?.summary.ortaRisk || 0}
              tone="warning"
            />
            <SummaryCard title="Kaynak" value={payload?.kaynakTipi || "-"} />
          </div>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm text-gray-400">Bulgu ara</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="AI notu, açıklama, hesap, kontrol tipi..."
              className={inputClassName}
            />
          </label>

          <div className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-900">
            <table className="w-full min-w-[1280px] text-sm">
              <thead className="bg-gray-800 text-gray-300">
                <tr>
                  <th className="p-3 text-left">Kontrol</th>
                  <th className="p-3 text-left">Risk</th>
                  <th className="p-3 text-left">Tarih</th>
                  <th className="p-3 text-left">Kaynak</th>
                  <th className="p-3 text-left">Açıklama</th>
                  <th className="p-3 text-left">Hesap</th>
                  <th className="p-3 text-right">Tutar</th>
                  <th className="p-3 text-left">AI Notu</th>
                  <th className="p-3 text-left">Önerilen Hesap</th>
                  <th className="p-3 text-left">Önceki Kullanım</th>
                  <th className="p-3 text-left">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {filteredFindings.slice(0, 150).map((finding) => (
                  <Fragment key={finding.id}>
                    <tr className="border-t border-gray-800 align-top">
                      <td className="p-3">
                        <span className="rounded-lg bg-gray-800 px-2 py-1 text-xs font-semibold">
                          {finding.kontrolTipi}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`rounded-lg px-2 py-1 text-xs font-semibold ${riskBadgeClass(finding.riskSeviyesi)}`}
                        >
                          <span className={riskClass(finding.riskSeviyesi)}>
                            {finding.riskSeviyesi}
                          </span>
                        </span>
                      </td>
                      <td className="p-3">{finding.fisTarihi || "—"}</td>
                      <td className="p-3">
                        <div>{finding.kaynakTipi || "—"}</div>
                        <div className="text-xs text-gray-500">
                          {finding.kaynakAdi || "—"}
                        </div>
                      </td>
                      <td className="max-w-xs p-3">{finding.aciklama || "—"}</td>
                      <td className="p-3">{finding.hesapKodu || "—"}</td>
                      <td className="p-3 text-right">{formatMoney(finding.tutar)}</td>
                      <td className="max-w-sm p-3 text-gray-300">{finding.aiNotu}</td>
                      <td className="p-3 font-semibold text-indigo-300">
                        {finding.onerilenHesap || "—"}
                      </td>
                      <td className="max-w-xs p-3 text-gray-400">
                        {finding.oncekiKullanim || "—"}
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => openEdit(finding)}
                          className="rounded-lg border border-indigo-700 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-950"
                        >
                          Düzenle
                        </button>
                      </td>
                    </tr>

                    {editingRowId === finding.rowId && draftRow ? (
                      <tr className="border-t border-gray-800 bg-gray-950/80">
                        <td colSpan={11} className="p-4">
                          <PreviewVoucherDetailPanel
                            variant="standardLuca"
                            draft={draftRow}
                            onChange={setDraftRow}
                            onSave={saveEdit}
                            onCancel={cancelEdit}
                            showMemoryOption={false}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {filteredFindings.length > 150 ? (
            <p className="mt-4 text-sm text-gray-400">
              İlk 150 bulgu gösteriliyor. Filtre veya arama kullanın.
            </p>
          ) : null}

          {!filteredFindings.length ? (
            <p className="mt-4 text-sm text-emerald-300">
              Seçili filtrelerde şüpheli kayıt bulunamadı.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}

function SummaryCard({ title, value, tone = "neutral" }) {
  const toneClasses = {
    neutral: "border-gray-700 bg-gray-950 text-white",
    warning: "border-amber-800 bg-amber-950/40 text-amber-300",
    error: "border-red-800 bg-red-950/40 text-red-300",
  };

  return (
    <div className={`rounded-2xl border p-5 ${toneClasses[tone] || toneClasses.neutral}`}>
      <div className="text-sm text-gray-400">{title}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}
