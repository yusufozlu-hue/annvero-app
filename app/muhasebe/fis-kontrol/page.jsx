"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import PreviewVoucherDetailPanel from "../components/PreviewVoucherDetailPanel";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  loadPendingLucaRows,
  savePendingLucaRows,
} from "@/src/utils/companyCenter";
import {
  analyzeStandardLucaRows,
  buildFisKontrolExcelRows,
  buildFisKontrolIssueExcelRows,
  filterKontrolRows,
  KONTROL_SEVIYE,
} from "@/src/utils/fisKontrolMerkezi";
import {
  applyStandardLucaRowEditDraft,
  buildStandardLucaRowEditDraft,
} from "@/src/utils/previewRowEdit";
import {
  buildStandardLucaTransferPayload,
  ensureStandardLucaRowIds,
  finalizeStandardLucaRow,
  isStandardLucaPayload,
} from "@/src/utils/standardLucaRow";

const FILTER_OPTIONS = [
  { id: "all", label: "Tümü" },
  { id: "hata", label: "Hata" },
  { id: "uyari", label: "Uyarı" },
  { id: "bilgi", label: "Bilgi" },
  { id: "temiz", label: "Temiz" },
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getSourceLabel(payload) {
  if (!payload) return "Kaynak yok";

  const parts = [
    payload.companyName || payload.firmaId || payload.companyId,
    payload.kaynakTipi,
    payload.kaynakAdi,
  ].filter(Boolean);

  return parts.join(" · ") || "StandardLucaRows";
}

function seviyeBadgeClass(seviye) {
  if (seviye === KONTROL_SEVIYE.HATA) {
    return "bg-red-900/60 text-red-200";
  }

  if (seviye === KONTROL_SEVIYE.UYARI) {
    return "bg-amber-900/60 text-amber-200";
  }

  if (seviye === KONTROL_SEVIYE.BILGI) {
    return "bg-sky-900/60 text-sky-200";
  }

  return "bg-emerald-900/60 text-emerald-200";
}

function riskBadgeClass(riskSeviyesi) {
  if (riskSeviyesi === "Yüksek") return "text-red-300";
  if (riskSeviyesi === "Orta") return "text-amber-300";
  if (riskSeviyesi === "Düşük") return "text-sky-300";
  return "text-emerald-300";
}

export default function FisKontrolPage() {
  const { getCompanyDisplayName } = useCompanyList();

  const [payload, setPayload] = useState(null);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("all");
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

  const loadPendingData = useCallback(() => {
    const pending = loadPendingLucaRows();

    if (!pending?.rows?.length || !isStandardLucaPayload(pending)) {
      setPayload(null);
      setRows([]);
      return;
    }

    const normalizedRows = ensureStandardLucaRowIds(
      pending.rows.map((row) =>
        finalizeStandardLucaRow({
          ...row,
          firmaId: row.firmaId || pending.firmaId || pending.companyId || "",
          kaynakTipi: row.kaynakTipi || pending.kaynakTipi || "",
          kaynakAdi:
            row.kaynakAdi ||
            pending.kaynakAdi ||
            pending.selectedBank ||
            "",
        })
      )
    );

    setPayload(pending);
    setRows(normalizedRows);
    setEditingRowId(null);
    setDraftRow(null);
  }, []);

  useEffect(() => {
    loadPendingData();
    window.addEventListener("focus", loadPendingData);
    return () => window.removeEventListener("focus", loadPendingData);
  }, [loadPendingData]);

  const analysis = useMemo(() => analyzeStandardLucaRows(rows), [rows]);

  const filteredRows = useMemo(() => {
    const baseRows = filterKontrolRows(analysis.rows, filter);

    const query = search.trim().toLocaleLowerCase("tr");
    if (!query) return baseRows;

    return baseRows.filter((row) => {
      const haystack = [
        row.fisNo,
        row.fisTarihi,
        row.fisAciklama,
        row.detayAciklama,
        row.hesapKodu,
        row.belgeTuru,
        row.evrakNo,
        row._kontrol?.kontrolNotu,
        row._kontrol?.riskSeviyesi,
        row.kaynakTipi,
        row.kaynakAdi,
      ]
        .join(" ")
        .toLocaleLowerCase("tr");

      return haystack.includes(query);
    });
  }, [analysis.rows, filter, search]);

  const groupedIssues = useMemo(
    () => ({
      hata: analysis.issues.filter((issue) => issue.seviye === KONTROL_SEVIYE.HATA),
      uyari: analysis.issues.filter((issue) => issue.seviye === KONTROL_SEVIYE.UYARI),
      bilgi: analysis.issues.filter((issue) => issue.seviye === KONTROL_SEVIYE.BILGI),
    }),
    [analysis.issues]
  );

  const persistRows = (nextRows) => {
    if (!payload) return;

    const nextPayload = buildStandardLucaTransferPayload({
      firmaId: payload.firmaId || payload.companyId,
      companyName:
        payload.companyName ||
        getCompanyDisplayName({ id: payload.companyId, name: payload.companyName }),
      kaynakTipi: payload.kaynakTipi,
      kaynakAdi: payload.kaynakAdi,
      rows: nextRows,
    });

    savePendingLucaRows(nextPayload);
    setPayload(nextPayload);
    setRows(nextRows);
  };

  const openEdit = (row) => {
    setEditingRowId(row.id);
    setDraftRow(buildStandardLucaRowEditDraft(row));
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

  const exportControlReport = () => {
    if (!analysis.rows.length) {
      showToast("Dışa aktarılacak satır yok", "error");
      return;
    }

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet([
      {
        Kaynak: getSourceLabel(payload),
        "Toplam Satır": analysis.summary.totalRows,
        "Toplam Fiş": analysis.summary.totalFis,
        "Hatalı Satır": analysis.summary.hataRowCount,
        "Hata Kaydı": analysis.summary.hataIssueCount,
        "Uyarı Kaydı": analysis.summary.uyariIssueCount,
        "Bilgi Kaydı": analysis.summary.bilgiIssueCount,
        "Temiz Satır": analysis.summary.temizRowCount,
        "Denge Durumu": analysis.summary.balanceStatus,
      },
    ]);
    const rowsSheet = XLSX.utils.json_to_sheet(buildFisKontrolExcelRows(analysis));
    const issuesSheet = XLSX.utils.json_to_sheet(
      buildFisKontrolIssueExcelRows(analysis)
    );

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Özet");
    XLSX.utils.book_append_sheet(workbook, rowsSheet, "Satırlar");
    XLSX.utils.book_append_sheet(workbook, issuesSheet, "Kontroller");

    const fileName = `Fis_Kontrol_Raporu_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    showToast("Kontrol raporu indirildi", "success");
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

      <MuhasebeMenu />

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-2 text-4xl font-bold">Fiş Kontrol Merkezi</h1>
          <p className="max-w-3xl text-gray-400">
            Banka, Elektraweb ve Luca fiş üretiminden gelen StandardLucaRows
            satırları üzerinde denge, hesap, açıklama, belge ve mükerrer kayıt
            kontrolleri yapılır. Ön izleme ekranlarındaki kaynak veri değiştirilmez;
            düzenlemeler yalnızca aktarım kuyruğuna yazılır.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={loadPendingData}
            className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-900"
          >
            Yenile
          </button>
          <button
            type="button"
            onClick={exportControlReport}
            disabled={!analysis.rows.length}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Kontrol Raporu Excel
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-400">Aktif veri kaynağı</div>
            <div className="mt-1 text-lg font-semibold">
              {payload ? getSourceLabel(payload) : "Henüz aktarım kuyruğu boş"}
            </div>
            {payload?.createdAt ? (
              <div className="mt-1 text-sm text-gray-500">
                Son aktarım: {new Date(payload.createdAt).toLocaleString("tr-TR")}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href="/muhasebe/banka-ekstresi"
              className="rounded-lg border border-gray-700 px-3 py-2 hover:bg-gray-950"
            >
              Banka Parser
            </Link>
            <Link
              href="/muhasebe/elektraweb"
              className="rounded-lg border border-gray-700 px-3 py-2 hover:bg-gray-950"
            >
              Elektraweb
            </Link>
            <Link
              href="/muhasebe/luca-donusturucu"
              className="rounded-lg border border-gray-700 px-3 py-2 hover:bg-gray-950"
            >
              Luca Fiş Üretici
            </Link>
          </div>
        </div>
      </div>

      {!rows.length ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 p-10 text-center">
          <h2 className="text-2xl font-semibold">Kontrol edilecek satır bulunamadı</h2>
          <p className="mx-auto mt-3 max-w-2xl text-gray-400">
            Banka Parser, Elektraweb veya Luca Fiş Üretici ekranında ön izleme
            oluşturduktan sonra veriyi aktarım kuyruğuna gönderin. Kontrol merkezi
            yalnızca StandardLucaRows formatındaki bu kuyruk üzerinde çalışır.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Toplam Satır"
              value={analysis.summary.totalRows}
              tone="neutral"
            />
            <SummaryCard
              title="Hatalı Satır"
              value={analysis.summary.hataRowCount}
              tone={analysis.summary.hataRowCount > 0 ? "error" : "success"}
            />
            <SummaryCard
              title="Uyarı / Bilgi"
              value={`${analysis.summary.uyariIssueCount} / ${analysis.summary.bilgiIssueCount}`}
              tone={
                analysis.summary.uyariIssueCount > 0 ? "warning" : "success"
              }
            />
            <SummaryCard
              title="Denge Durumu"
              value={analysis.summary.balanceStatus}
              tone={analysis.summary.isBalanced ? "success" : "error"}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <IssuePanel
              title="Hata"
              issues={groupedIssues.hata}
              emptyText="Hata bulunamadı."
            />
            <IssuePanel
              title="Uyarı"
              issues={groupedIssues.uyari}
              emptyText="Uyarı bulunamadı."
            />
            <IssuePanel
              title="Bilgi"
              issues={groupedIssues.bilgi}
              emptyText="Bilgi kaydı bulunamadı."
            />
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">Kontrol Satırları</h2>
                <p className="mt-1 text-sm text-gray-400">
                  {filteredRows.length} / {analysis.rows.length} satır gösteriliyor
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFilter(option.id)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium ${
                      filter === option.id
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="mb-4 block">
              <span className="mb-1 block text-sm text-gray-400">Satır ara</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Fiş no, hesap, açıklama, kontrol notu..."
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
              />
            </label>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-sm">
                <thead className="bg-gray-800 text-gray-300">
                  <tr>
                    <th className="p-3 text-left">#</th>
                    <th className="p-3 text-left">Fiş</th>
                    <th className="p-3 text-left">Tarih</th>
                    <th className="p-3 text-left">Kaynak</th>
                    <th className="p-3 text-left">Hesap</th>
                    <th className="p-3 text-left">Açıklama</th>
                    <th className="p-3 text-right">Borç</th>
                    <th className="p-3 text-right">Alacak</th>
                    <th className="p-3 text-left">Belge</th>
                    <th className="p-3 text-left">Risk</th>
                    <th className="p-3 text-left">Kontrol Notu</th>
                    <th className="p-3 text-left">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.slice(0, 150).map((row) => (
                    <Fragment key={row.id}>
                      <tr className="border-t border-gray-800 align-top">
                        <td className="p-3">{row._kontrol.rowIndex}</td>
                        <td className="p-3">{row.fisNo ?? "—"}</td>
                        <td className="p-3">{row.fisTarihi || "—"}</td>
                        <td className="p-3">
                          <div>{row.kaynakTipi || "—"}</div>
                          <div className="text-xs text-gray-500">
                            {row.kaynakAdi || "—"}
                          </div>
                        </td>
                        <td className="p-3">{row.hesapKodu || "—"}</td>
                        <td className="max-w-xs p-3">
                          {row.detayAciklama || row.fisAciklama || "—"}
                        </td>
                        <td className="p-3 text-right">{formatMoney(row.borc)}</td>
                        <td className="p-3 text-right">{formatMoney(row.alacak)}</td>
                        <td className="p-3">{row.belgeTuru || "—"}</td>
                        <td className="p-3">
                          <span
                            className={`font-semibold ${riskBadgeClass(row._kontrol.riskSeviyesi)}`}
                          >
                            {row._kontrol.riskSeviyesi}
                          </span>
                          <div className="mt-1">
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-semibold ${seviyeBadgeClass(row._kontrol.seviye)}`}
                            >
                              {row._kontrol.seviye}
                            </span>
                          </div>
                        </td>
                        <td className="max-w-sm p-3 text-gray-300">
                          {row._kontrol.kontrolNotu || "—"}
                        </td>
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="rounded-lg border border-indigo-700 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-950"
                          >
                            Düzenle
                          </button>
                        </td>
                      </tr>

                      {editingRowId === row.id && draftRow ? (
                        <tr className="border-t border-gray-800 bg-gray-950/70">
                          <td colSpan={12} className="p-4">
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

            {filteredRows.length > 150 ? (
              <p className="mt-4 text-sm text-gray-400">
                İlk 150 satır gösteriliyor. Filtre veya arama kullanın.
              </p>
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}

function SummaryCard({ title, value, tone }) {
  const toneClasses = {
    neutral: "border-gray-700 bg-gray-950 text-white",
    success: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
    warning: "border-amber-800 bg-amber-950/40 text-amber-300",
    error: "border-red-800 bg-red-950/40 text-red-300",
  };

  return (
    <div
      className={`rounded-2xl border p-5 ${toneClasses[tone] || toneClasses.neutral}`}
    >
      <div className="text-sm text-gray-400">{title}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function IssuePanel({ title, issues, emptyText }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold">{title}</h2>
        <span className="rounded-lg bg-gray-800 px-3 py-1 text-sm text-gray-300">
          {issues.length}
        </span>
      </div>

      {issues.length === 0 ? (
        <p className="text-gray-400">{emptyText}</p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {issues.slice(0, 40).map((issue, index) => (
            <div
              key={`${issue.type}-${issue.rowIndex}-${index}`}
              className="rounded-xl border border-gray-800 bg-gray-950 p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-gray-800 px-2 py-1 text-xs font-semibold">
                  Satır {issue.rowIndex}
                </span>
                <span
                  className={`rounded-lg px-2 py-1 text-xs font-semibold ${seviyeBadgeClass(issue.seviye)}`}
                >
                  {issue.type}
                </span>
              </div>

              <p className="text-sm text-gray-300">{issue.message}</p>

              <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-gray-400 sm:grid-cols-2">
                <div>Fiş: {issue.fisNo}</div>
                <div>Hesap: {issue.hesapKodu}</div>
                <div>Tutar: {issue.tutar}</div>
                <div>Tarih: {issue.fisTarihi}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
