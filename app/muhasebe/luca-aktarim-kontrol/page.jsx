"use client";

import { Fragment, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { normalizeCompanyRecord } from "@/src/utils/companyCenter";
import {
  approveLucaAktarimMatch,
  buildLucaAktarimExcelRows,
  buildLucaAktarimSummarySheetRows,
  filterLucaAktarimRows,
  groupLucaAktarimRows,
  LUCA_AKTARIM_DURUM,
  LUCA_AKTARIM_GRUP,
  parseLucaTransferExcelSheet,
  recalculateLucaAktarimSummary,
  runLucaAktarimKontrol,
} from "@/src/utils/lucaAktarimKontrol";
import { saveLucaAktarimManualMatch } from "@/src/utils/lucaAktarimMatchMemory";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const FLOW_STEPS = [
  "Firma seç",
  "ANNVERO Luca Excel yükle",
  "Luca fiş/muavin Excel yükle",
  "Karşılaştır",
  "Sonuç raporu",
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function guvenClass(score) {
  if (score >= 90) return "bg-emerald-900/70 text-emerald-100";
  if (score >= 70) return "bg-sky-900/70 text-sky-100";
  if (score >= 40) return "bg-amber-900/70 text-amber-100";
  return "bg-gray-800 text-gray-300";
}

function riskClass(risk) {
  if (risk === "Yüksek") return "text-red-300";
  if (risk === "Orta") return "text-amber-300";
  return "text-emerald-300";
}

function durumClass(durum) {
  if (durum === LUCA_AKTARIM_DURUM.TAM_ESLESTI) {
    return "bg-emerald-900/50 text-emerald-200";
  }

  if (durum === LUCA_AKTARIM_DURUM.OLASI_ESLESTI) {
    return "bg-sky-900/50 text-sky-200";
  }

  if (
    [
      LUCA_AKTARIM_DURUM.ANNVERODA_VAR,
      LUCA_AKTARIM_DURUM.LUCADA_VAR,
      LUCA_AKTARIM_DURUM.TUTAR_FARKI,
      LUCA_AKTARIM_DURUM.YON_FARKI,
      LUCA_AKTARIM_DURUM.HESAP_FARKI,
    ].includes(durum)
  ) {
    return "bg-red-900/50 text-red-200";
  }

  if (
    [
      LUCA_AKTARIM_DURUM.TARIH_FARKI,
      LUCA_AKTARIM_DURUM.ACIKLAMA_FARKI,
      LUCA_AKTARIM_DURUM.MUKERRER,
      LUCA_AKTARIM_DURUM.SATIR_EKSIK,
    ].includes(durum)
  ) {
    return "bg-amber-900/50 text-amber-200";
  }

  return "bg-sky-900/50 text-sky-200";
}

async function readExcelSheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

export default function LucaAktarimKontrolPage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany: selectedCompanyRaw,
  } = useCompanyList();

  const selectedCompany = useMemo(
    () => (selectedCompanyRaw ? normalizeCompanyRecord(selectedCompanyRaw) : null),
    [selectedCompanyRaw]
  );

  const [annveroFileName, setAnnveroFileName] = useState("");
  const [lucaFileName, setLucaFileName] = useState("");
  const [annveroRows, setAnnveroRows] = useState([]);
  const [lucaRows, setLucaRows] = useState([]);
  const [hasCompared, setHasCompared] = useState(false);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [activeGroup, setActiveGroup] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = (message, type) => setToast({ message, type });

  const currentStep = useMemo(() => {
    if (hasCompared && (annveroRows.length || lucaRows.length)) return 5;
    if (annveroRows.length && lucaRows.length) return 4;
    if (lucaRows.length) return 3;
    if (annveroRows.length) return 2;
    if (selectedCompanyId) return 1;
    return 0;
  }, [hasCompared, annveroRows.length, lucaRows.length, selectedCompanyId]);

  const analysis = comparisonResult;

  const displayedRows = useMemo(() => {
    const baseRows = filterLucaAktarimRows(analysis?.rows || [], {
      group: activeGroup,
    });
    const query = search.trim().toLocaleLowerCase("tr");

    if (!query) return baseRows;

    return baseRows.filter((row) =>
      [
        row.grup,
        row.durum,
        row.annveroFisNo,
        row.lucaFisNo,
        row.annveroTarihi,
        row.lucaTarihi,
        row.annveroHesap,
        row.lucaHesap,
        row.annveroAciklama,
        row.lucaAciklama,
        row.oneri,
        row.guvenEtiketi,
        String(row.guvenSkoru || ""),
        ...(row.uyariListesi || []),
      ]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(query)
    );
  }, [analysis?.rows, activeGroup, search]);

  const resetComparison = () => {
    setHasCompared(false);
    setComparisonResult(null);
    setActiveGroup("");
  };

  const handleAnnveroFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const sheetRows = await readExcelSheet(file);
      const parsed = parseLucaTransferExcelSheet(sheetRows, "ANNVERO");
      setAnnveroRows(parsed);
      setAnnveroFileName(file.name);
      resetComparison();
      showToast(`${parsed.length} ANNVERO satırı yüklendi`, "success");
    } catch (error) {
      showToast(error?.message || "ANNVERO Excel okunamadı", "error");
      setAnnveroRows([]);
      setAnnveroFileName("");
      resetComparison();
    }

    event.target.value = "";
  };

  const handleLucaFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const sheetRows = await readExcelSheet(file);
      const parsed = parseLucaTransferExcelSheet(sheetRows, "LUCA");
      setLucaRows(parsed);
      setLucaFileName(file.name);
      resetComparison();
      showToast(`${parsed.length} Luca satırı yüklendi`, "success");
    } catch (error) {
      showToast(error?.message || "Luca Excel okunamadı", "error");
      setLucaRows([]);
      setLucaFileName("");
      resetComparison();
    }

    event.target.value = "";
  };

  const handleCompare = () => {
    if (!annveroRows.length) {
      showToast("ANNVERO Luca Excel dosyasını yükleyin", "error");
      return;
    }

    if (!lucaRows.length) {
      showToast("Luca fiş/muavin Excel dosyasını yükleyin", "error");
      return;
    }

    setHasCompared(true);
    setComparisonResult(
      runLucaAktarimKontrol({
        annveroRows,
        lucaRows,
        firmaId: selectedCompanyId,
      })
    );
    setActiveGroup("");
    showToast("Luca aktarım kontrolü tamamlandı", "success");
  };

  const handleApproveMatch = (row) => {
    if (!row?.annveroRow || !row?.lucaRow) return;

    saveLucaAktarimManualMatch(row.annveroRow, row.lucaRow, {
      firmaId: selectedCompanyId,
    });

    setComparisonResult((current) => {
      if (!current) return current;

      const updatedRows = current.rows.map((item) =>
        item.id === row.id ? approveLucaAktarimMatch(item) : item
      );
      const grouped = groupLucaAktarimRows(updatedRows);

      return {
        ...current,
        rows: updatedRows,
        grouped,
        summary: recalculateLucaAktarimSummary(updatedRows, grouped, current.summary),
      };
    });

    showToast("Eşleşme onaylandı ve hafızaya alındı", "success");
  };

  const downloadReport = (mode = "all") => {
    if (!analysis?.rows?.length) {
      showToast("Dışa aktarılacak sonuç yok", "error");
      return;
    }

    const rowsToExport = filterLucaAktarimRows(analysis.rows, {
      group: activeGroup,
      differencesOnly: mode === "differences",
      missingOnly: mode === "missing",
      riskyOnly: mode === "risky",
    });

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(
      buildLucaAktarimSummarySheetRows(analysis, {
        firma: getCompanyDisplayName(selectedCompany) || selectedCompanyId || "-",
      })
    );
    const resultSheet = XLSX.utils.json_to_sheet(
      buildLucaAktarimExcelRows({ rows: rowsToExport })
    );

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Özet");
    XLSX.utils.book_append_sheet(workbook, resultSheet, "Luca Aktarım");

    const suffix =
      mode === "differences"
        ? "Farklar"
        : mode === "missing"
          ? "Eksik_Aktarimlar"
          : mode === "risky"
            ? "Riskliler"
            : "Tum_Sonuclar";

    XLSX.writeFile(
      workbook,
      `Luca_Aktarim_Kontrol_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    showToast("Excel raporu indirildi", "success");
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

      <h1 className="mb-2 text-4xl font-bold">Luca Aktarım Kontrol Merkezi</h1>
      <p className="mb-6 max-w-4xl text-gray-400">
        ANNVERO&apos;nun ürettiği Luca fiş Excel dosyası ile Luca&apos;dan alınan gerçek
        kayıtları satır satır karşılaştırın. Eksik aktarım, tutar farkı ve mükerrer risk
        analizi yapar.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        {FLOW_STEPS.map((step, index) => (
          <span
            key={step}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              index + 1 <= currentStep
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400"
            }`}
          >
            {index + 1}. {step}
          </span>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 lg:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">
            1. Firma (hafıza için önerilir)
          </span>
          <select
            value={selectedCompanyId}
            onChange={(event) => {
              setSelectedCompanyId(event.target.value);
              resetComparison();
            }}
            className={inputClassName}
          >
            <option value="">Firma seçin</option>
            <CompanySelectOptions companies={companies} />
          </select>
        </label>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <UploadCard
          step="2"
          title="ANNVERO Luca Fiş Excel"
          fileName={annveroFileName}
          hint="Luca Dönüştürücü veya Banka Parser'dan indirilen Luca export dosyası"
          onChange={handleAnnveroFile}
          count={annveroRows.length}
        />
        <UploadCard
          step="3"
          title="Luca Fiş / Muavin Excel"
          fileName={lucaFileName}
          hint="Luca'dan alınan fiş listesi veya muavin aktarım dosyası"
          onChange={handleLucaFile}
          count={lucaRows.length}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleCompare}
          disabled={!annveroRows.length || !lucaRows.length}
          className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          4. Karşılaştır
        </button>
      </div>

      {analysis ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
            <SummaryCard title="ANNVERO Satırı" value={analysis.summary.annveroCount} />
            <SummaryCard title="Luca Satırı" value={analysis.summary.lucaCount} />
            <SummaryCard
              title="Tam Eşleşen"
              value={analysis.summary.tamEslesenCount}
              tone="success"
            />
            <SummaryCard
              title="Olası Eşleşen"
              value={analysis.summary.olasiEslesenCount}
              tone="warning"
            />
            <SummaryCard
              title="Eksik Aktarım"
              value={analysis.summary.eksikAktarimCount}
              tone={analysis.summary.eksikAktarimCount > 0 ? "error" : "success"}
            />
            <SummaryCard
              title="Fark Olan"
              value={analysis.summary.farkKayitCount}
              tone={analysis.summary.farkKayitCount > 0 ? "warning" : "success"}
            />
            <SummaryCard
              title="Riskli Kayıt"
              value={analysis.summary.riskliKayitCount}
              tone={analysis.summary.riskliKayitCount > 0 ? "error" : "success"}
            />
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveGroup("")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                !activeGroup
                  ? "bg-indigo-600 text-white"
                  : "border border-gray-700 text-gray-300 hover:bg-gray-900"
              }`}
            >
              Tüm Gruplar
            </button>
            {Object.values(LUCA_AKTARIM_GRUP).map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => setActiveGroup(group)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  activeGroup === group
                    ? "bg-indigo-600 text-white"
                    : "border border-gray-700 text-gray-300 hover:bg-gray-900"
                }`}
              >
                {group} ({analysis.grouped?.[group]?.length || 0})
              </button>
            ))}
          </div>

          <div className="mb-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => downloadReport("all")}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-700"
            >
              Tüm Sonuçlar Excel
            </button>
            <button
              type="button"
              onClick={() => downloadReport("differences")}
              className="rounded-xl border border-amber-700 bg-amber-950/40 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-950/70"
            >
              Sadece Farklar Excel
            </button>
            <button
              type="button"
              onClick={() => downloadReport("missing")}
              className="rounded-xl border border-orange-700 bg-orange-950/40 px-4 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-950/70"
            >
              Sadece Eksik Aktarımlar Excel
            </button>
            <button
              type="button"
              onClick={() => downloadReport("risky")}
              className="rounded-xl border border-red-700 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-950/70"
            >
              Sadece Riskliler Excel
            </button>
          </div>

          <div className="mb-4">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Durum, fiş no, hesap, açıklama, uyarı ara..."
              className={inputClassName}
            />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-900">
            <table className="w-full min-w-[1900px] text-sm">
              <thead className="bg-gray-800 text-gray-300">
                <tr>
                  <th className="p-3 text-left">Grup</th>
                  <th className="p-3 text-left">Durum</th>
                  <th className="p-3 text-center">Güven</th>
                  <th className="p-3 text-left">ANNVERO Fiş</th>
                  <th className="p-3 text-left">Luca Fiş</th>
                  <th className="p-3 text-left">ANNVERO Tarih</th>
                  <th className="p-3 text-left">Luca Tarih</th>
                  <th className="p-3 text-left">ANNVERO Hesap</th>
                  <th className="p-3 text-left">Luca Hesap</th>
                  <th className="p-3 text-left">ANNVERO Açıklama</th>
                  <th className="p-3 text-left">Luca Açıklama</th>
                  <th className="p-3 text-right">ANNVERO Tutar</th>
                  <th className="p-3 text-right">Luca Tutar</th>
                  <th className="p-3 text-right">Fark</th>
                  <th className="p-3 text-left">Risk</th>
                  <th className="p-3 text-left">Öneri / Uyarı</th>
                  <th className="p-3 text-left">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.slice(0, 150).map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-gray-800 align-top ${
                      row.needsManualApproval
                        ? "border-l-4 border-l-sky-500 bg-sky-950/10"
                        : row.guvenSkoru >= 90 && row.isMatched
                          ? "border-l-4 border-l-emerald-500/60"
                          : row.riskSeviyesi === "Yüksek"
                            ? "border-l-4 border-l-red-500/60 bg-red-950/10"
                            : ""
                    }`}
                  >
                    <td className="p-3 text-xs text-gray-400">{row.grup || "—"}</td>
                    <td className="p-3">
                      <span
                        className={`inline-block rounded-lg px-2 py-1 text-xs font-semibold ${durumClass(row.durum)}`}
                      >
                        {row.durum}
                      </span>
                      {row.eslesmeYontemi ? (
                        <div className="mt-1 text-xs text-gray-500">{row.eslesmeYontemi}</div>
                      ) : null}
                    </td>
                    <td className="p-3 text-center">
                      {row.guvenSkoru ? (
                        <div className="space-y-1">
                          <span
                            className={`inline-flex min-w-[42px] justify-center rounded-full px-2 py-1 text-[11px] font-semibold ${guvenClass(row.guvenSkoru)}`}
                          >
                            {row.guvenSkoru}
                          </span>
                          <div className="text-[10px] text-gray-400">{row.guvenEtiketi}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                    <td className="p-3">{row.annveroFisNo || "—"}</td>
                    <td className="p-3">{row.lucaFisNo || "—"}</td>
                    <td className="p-3">{row.annveroTarihi || "—"}</td>
                    <td className="p-3">{row.lucaTarihi || "—"}</td>
                    <td className="p-3 font-mono text-xs">{row.annveroHesap || "—"}</td>
                    <td className="p-3 font-mono text-xs">{row.lucaHesap || "—"}</td>
                    <td className="max-w-xs p-3">{row.annveroAciklama || "—"}</td>
                    <td className="max-w-xs p-3">{row.lucaAciklama || "—"}</td>
                    <td className="p-3 text-right">{formatMoney(row.annveroTutari)}</td>
                    <td className="p-3 text-right">{formatMoney(row.lucaTutari)}</td>
                    <td className="p-3 text-right">{formatMoney(row.fark)}</td>
                    <td className={`p-3 font-semibold ${riskClass(row.riskSeviyesi)}`}>
                      {row.riskSeviyesi}
                    </td>
                    <td className="max-w-sm p-3 text-gray-300">
                      <div>{row.oneri}</div>
                      {row.uyariListesi?.length ? (
                        <ul className="mt-2 space-y-1 text-[11px] text-amber-300">
                          {row.uyariListesi.map((warning) => (
                            <li key={warning}>• {warning}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="p-3">
                      {row.needsManualApproval && !row.manualApproved ? (
                        <button
                          type="button"
                          onClick={() => handleApproveMatch(row)}
                          className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-950"
                        >
                          Eşleşmeyi Onayla
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {displayedRows.length > 150 ? (
            <p className="mt-4 text-sm text-gray-400">
              İlk 150 sonuç gösteriliyor. Arama veya grup filtresi kullanın.
            </p>
          ) : null}

          {!displayedRows.length ? (
            <p className="mt-4 text-sm text-gray-400">
              Seçili filtrelerde gösterilecek kayıt yok.
            </p>
          ) : null}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 p-10 text-center text-gray-400">
          Her iki Excel dosyasını yükledikten sonra <strong>Karşılaştır</strong> butonuna
          basın. Luca aktarım kontrol raporu burada görünecek.
        </div>
      )}
    </main>
  );
}

function UploadCard({ step, title, fileName, hint, onChange, count }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <h2 className="mb-2 text-xl font-semibold">
        {step}. {title}
      </h2>
      <p className="mb-4 text-sm text-gray-400">{hint}</p>

      <label className="inline-flex cursor-pointer rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-700">
        Excel Yükle
        <input type="file" accept=".xlsx,.xls" onChange={onChange} className="hidden" />
      </label>

      <div className="mt-4 space-y-1 text-sm text-gray-400">
        <div>{fileName || "Henüz dosya seçilmedi"}</div>
        {count ? <div className="text-emerald-300">{count} satır okundu</div> : null}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, tone = "neutral" }) {
  const toneClasses = {
    neutral: "border-gray-700 bg-gray-950 text-white",
    success: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
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
