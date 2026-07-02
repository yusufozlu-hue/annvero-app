"use client";

import { Fragment, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { normalizeCompanyRecord } from "@/src/utils/companyCenter";
import {
  BANK_OPTIONS,
  buildMutabakatExcelRows,
  buildSuggestedLucaExcelRows,
  filterMutabakatRows,
  MUTABAKAT_DURUM,
  parseBankEkstreSheet,
  parseLuca102MuavinSheet,
  runBankaMutabakat,
} from "@/src/utils/bankaMutabakat";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const FLOW_STEPS = [
  "Firma seç",
  "Banka seç",
  "Banka ekstresi yükle",
  "Luca 102 muavin yükle",
  "Karşılaştır",
  "Sonuç raporu",
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function riskClass(risk) {
  if (risk === "Yüksek") return "text-red-300";
  if (risk === "Orta") return "text-amber-300";
  return "text-emerald-300";
}

function durumClass(durum) {
  if (durum === MUTABAKAT_DURUM.TAM_ESLESTI) {
    return "bg-emerald-900/50 text-emerald-200";
  }

  if (
    [
      MUTABAKAT_DURUM.BANKADA_VAR,
      MUTABAKAT_DURUM.MUAVINDE_VAR,
      MUTABAKAT_DURUM.TUTAR_FARKI,
      MUTABAKAT_DURUM.EKSIK_MASRAF,
      MUTABAKAT_DURUM.EKSIK_POS,
    ].includes(durum)
  ) {
    return "bg-red-900/50 text-red-200";
  }

  if (
    [
      MUTABAKAT_DURUM.TARIH_FARKI,
      MUTABAKAT_DURUM.ACIKLAMA_FARKI,
      MUTABAKAT_DURUM.ACIKLAMA_BENZER_TUTAR_FARKLI,
      MUTABAKAT_DURUM.MUKERRER,
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

export default function BankaMutabakatPage() {
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

  const [selectedBank, setSelectedBank] = useState("TEB");
  const [bankFileName, setBankFileName] = useState("");
  const [muavinFileName, setMuavinFileName] = useState("");
  const [bankRows, setBankRows] = useState([]);
  const [muavinRows, setMuavinRows] = useState([]);
  const [hasCompared, setHasCompared] = useState(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [hideMatched, setHideMatched] = useState(false);
  const [search, setSearch] = useState("");
  const [suggestionRowId, setSuggestionRowId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type) => setToast({ message, type });

  const bank102Account = useMemo(() => {
    const bankAccounts = selectedCompany?.bankAccounts || [];
    const matched = bankAccounts.find((bank) => {
      if (bank.isActive === false) return false;
      return String(bank.bankName || "")
        .toUpperCase()
        .includes(selectedBank.slice(0, 3));
    });
    return matched?.lucaAccountCode || "";
  }, [selectedCompany, selectedBank]);

  const currentStep = useMemo(() => {
    if (hasCompared && (bankRows.length || muavinRows.length)) return 6;
    if (bankRows.length && muavinRows.length) return 5;
    if (muavinRows.length) return 4;
    if (bankRows.length) return 3;
    if (selectedBank) return 2;
    if (selectedCompanyId) return 1;
    return 0;
  }, [
    hasCompared,
    bankRows.length,
    muavinRows.length,
    selectedBank,
    selectedCompanyId,
  ]);

  const analysis = useMemo(() => {
    if (!hasCompared) return null;
    if (!bankRows.length && !muavinRows.length) return null;

    return runBankaMutabakat({
      bankRows,
      muavinRows,
      bankId: selectedBank,
      company: selectedCompany || {},
      firmaId: selectedCompanyId,
    });
  }, [
    hasCompared,
    bankRows,
    muavinRows,
    selectedBank,
    selectedCompany,
    selectedCompanyId,
  ]);

  const displayedRows = useMemo(() => {
    const baseRows = filterMutabakatRows(analysis?.rows || [], {
      errorsOnly: showErrorsOnly,
      hideMatched,
    });
    const query = search.trim().toLocaleLowerCase("tr");

    if (!query) return baseRows;

    return baseRows.filter((row) =>
      [
        row.durum,
        row.bankaTarihi,
        row.muavinTarihi,
        row.bankaAciklama,
        row.muavinAciklama,
        row.oneri,
        row.riskSeviyesi,
        row.eslesmeYontemi,
      ]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(query)
    );
  }, [analysis?.rows, showErrorsOnly, hideMatched, search]);

  const resetComparison = () => {
    setHasCompared(false);
    setSuggestionRowId(null);
  };

  const handleBankFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const sheetRows = await readExcelSheet(file);
      const parsed = parseBankEkstreSheet(sheetRows, selectedBank);
      setBankRows(parsed);
      setBankFileName(file.name);
      resetComparison();
      showToast(`${parsed.length} banka satırı yüklendi`, "success");
    } catch (error) {
      showToast(error?.message || "Banka ekstresi okunamadı", "error");
      setBankRows([]);
      setBankFileName("");
      resetComparison();
    }

    event.target.value = "";
  };

  const handleMuavinFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const sheetRows = await readExcelSheet(file);
      const parsed = parseLuca102MuavinSheet(sheetRows, bank102Account);
      setMuavinRows(parsed);
      setMuavinFileName(file.name);
      resetComparison();
      showToast(`${parsed.length} muavin satırı yüklendi`, "success");
    } catch (error) {
      showToast(error?.message || "Muavin dosyası okunamadı", "error");
      setMuavinRows([]);
      setMuavinFileName("");
      resetComparison();
    }

    event.target.value = "";
  };

  const handleCompare = () => {
    if (!selectedCompanyId) {
      showToast("Karşılaştırma için firma seçmelisiniz", "error");
      return;
    }

    if (!bankRows.length) {
      showToast("Banka ekstresi yükleyin", "error");
      return;
    }

    if (!muavinRows.length) {
      showToast("Luca 102 muavin dosyası yükleyin", "error");
      return;
    }

    setHasCompared(true);
    setSuggestionRowId(null);
    showToast("Karşılaştırma tamamlandı", "success");
  };

  const exportReport = () => {
    if (!analysis?.rows?.length) {
      showToast("Dışa aktarılacak sonuç yok", "error");
      return;
    }

    const rowsToExport = filterMutabakatRows(analysis.rows, {
      errorsOnly: showErrorsOnly,
      hideMatched,
    });

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet([
      {
        Firma: selectedCompany?.name || selectedCompanyId || "-",
        Banka: selectedBank,
        "Banka Satırı": analysis.summary.bankCount,
        "Muavin Satırı": analysis.summary.muavinCount,
        "Tam Eşleşen": analysis.summary.tamEslesenCount,
        "Hatalı Kayıt": analysis.summary.errorCount,
        "Bankada Var": analysis.summary.bankadaVarCount,
        "Muavin Var": analysis.summary.muavinVarCount,
      },
    ]);
    const resultSheet = XLSX.utils.json_to_sheet(
      buildMutabakatExcelRows({ rows: rowsToExport })
    );

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Özet");
    XLSX.utils.book_append_sheet(workbook, resultSheet, "Mutabakat");

    XLSX.writeFile(
      workbook,
      `Banka_Mutabakat_${selectedBank}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    showToast("Excel raporu indirildi", "success");
  };

  const exportSuggestion = (row) => {
    if (!row?.suggestedLucaRows?.length) return;

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(
      buildSuggestedLucaExcelRows(row.suggestedLucaRows)
    );
    XLSX.utils.book_append_sheet(workbook, sheet, "Fiş Önerisi");
    XLSX.writeFile(workbook, `Fis_Onerisi_${row.id}.xlsx`);
    showToast("Fiş önerisi Excel olarak indirildi", "success");
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

      <h1 className="mb-2 text-4xl font-bold">Banka Muavin Mutabakat Merkezi</h1>
      <p className="mb-6 max-w-4xl text-gray-400">
        Banka ekstresi ile Luca 102 banka muavinini işlem işlem karşılaştırın. Bu
        modül yalnızca analiz ve rapor üretir; otomatik muhasebe kaydı yapmaz.
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

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">1. Firma</span>
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

        <label className="block">
          <span className="mb-1 block text-sm text-gray-400">2. Banka</span>
          <select
            value={selectedBank}
            onChange={(event) => {
              setSelectedBank(event.target.value);
              resetComparison();
            }}
            className={inputClassName}
          >
            {BANK_OPTIONS.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <div className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-gray-300">
            Luca 102 Hesap: {bank102Account || "Firma banka hesabı tanımlı değil"}
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <UploadCard
          step="3"
          title="Banka Ekstresi Excel"
          fileName={bankFileName}
          hint="TEB, Vakıfbank, Garanti, Ziraat, Kuveyt veya genel format"
          onChange={handleBankFile}
          count={bankRows.length}
        />
        <UploadCard
          step="4"
          title="Luca 102 Muavin Excel"
          fileName={muavinFileName}
          hint="Luca muavin veya fiş aktarım dosyası (102 hesap satırları)"
          onChange={handleMuavinFile}
          count={muavinRows.length}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleCompare}
          disabled={!bankRows.length || !muavinRows.length}
          className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          5. Karşılaştır
        </button>
      </div>

      {analysis ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <SummaryCard title="Banka Satırı" value={analysis.summary.bankCount} />
            <SummaryCard title="Muavin Satırı" value={analysis.summary.muavinCount} />
            <SummaryCard
              title="Tam Eşleşen"
              value={analysis.summary.tamEslesenCount}
              tone="success"
            />
            <SummaryCard
              title="Hatalı Kayıt"
              value={analysis.summary.errorCount}
              tone={analysis.summary.errorCount > 0 ? "error" : "success"}
            />
            <SummaryCard
              title="Açıklama Farkı"
              value={analysis.summary.aciklamaFarkiCount}
              tone="warning"
            />
          </div>

          <div className="mb-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={exportReport}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-700"
            >
              Excel Raporu İndir
            </button>
            <button
              type="button"
              onClick={() => {
                setShowErrorsOnly(true);
                setHideMatched(false);
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                showErrorsOnly && !hideMatched
                  ? "bg-red-600 text-white"
                  : "border border-gray-700 hover:bg-gray-900"
              }`}
            >
              Sadece Hatalıları Göster
            </button>
            <button
              type="button"
              onClick={() => {
                setHideMatched(true);
                setShowErrorsOnly(false);
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                hideMatched
                  ? "bg-emerald-700 text-white"
                  : "border border-gray-700 hover:bg-gray-900"
              }`}
            >
              Tam Eşleşenleri Gizle
            </button>
            <button
              type="button"
              onClick={() => {
                setShowErrorsOnly(false);
                setHideMatched(false);
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                !showErrorsOnly && !hideMatched
                  ? "bg-indigo-600 text-white"
                  : "border border-gray-700 hover:bg-gray-900"
              }`}
            >
              Tümünü Göster
            </button>
          </div>

          <div className="mb-4">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Durum, açıklama, öneri ara..."
              className={inputClassName}
            />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-900">
            <table className="w-full min-w-[1500px] text-sm">
              <thead className="bg-gray-800 text-gray-300">
                <tr>
                  <th className="p-3 text-left">Durum</th>
                  <th className="p-3 text-left">Banka Tarihi</th>
                  <th className="p-3 text-left">Muavin Tarihi</th>
                  <th className="p-3 text-left">Banka Açıklama</th>
                  <th className="p-3 text-left">Muavin Açıklama</th>
                  <th className="p-3 text-right">Banka Tutarı</th>
                  <th className="p-3 text-right">Muavin Tutarı</th>
                  <th className="p-3 text-right">Fark</th>
                  <th className="p-3 text-left">Risk</th>
                  <th className="p-3 text-left">Öneri</th>
                  <th className="p-3 text-left">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.slice(0, 150).map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-t border-gray-800 align-top">
                      <td className="p-3">
                        <span
                          className={`inline-block rounded-lg px-2 py-1 text-xs font-semibold ${durumClass(row.durum)}`}
                        >
                          {row.durum}
                        </span>
                        {row.eslesmeYontemi ? (
                          <div className="mt-1 text-xs text-gray-500">
                            {row.eslesmeYontemi}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3">{row.bankaTarihi || "—"}</td>
                      <td className="p-3">{row.muavinTarihi || "—"}</td>
                      <td className="max-w-xs p-3">{row.bankaAciklama || "—"}</td>
                      <td className="max-w-xs p-3">{row.muavinAciklama || "—"}</td>
                      <td className="p-3 text-right">{formatMoney(row.bankaTutari)}</td>
                      <td className="p-3 text-right">{formatMoney(row.muavinTutari)}</td>
                      <td className="p-3 text-right">{formatMoney(row.fark)}</td>
                      <td className={`p-3 font-semibold ${riskClass(row.riskSeviyesi)}`}>
                        {row.riskSeviyesi}
                      </td>
                      <td className="max-w-sm p-3 text-gray-300">{row.oneri}</td>
                      <td className="p-3">
                        {row.suggestedLucaRows?.length ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSuggestionRowId((current) =>
                                current === row.id ? null : row.id
                              )
                            }
                            className="rounded-lg border border-indigo-700 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-950"
                          >
                            Fiş Öner
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                      </td>
                    </tr>

                    {suggestionRowId === row.id && row.suggestedLucaRows?.length ? (
                      <tr className="border-t border-gray-800 bg-gray-950/80">
                        <td colSpan={11} className="p-4">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-lg font-semibold">
                              Fiş Önerisi (ön izleme — otomatik kayıt yapılmaz)
                            </h3>
                            <button
                              type="button"
                              onClick={() => exportSuggestion(row)}
                              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold hover:bg-gray-900"
                            >
                              Öneriyi Excel İndir
                            </button>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[960px] text-sm">
                              <thead className="bg-gray-800 text-gray-300">
                                <tr>
                                  <th className="p-2 text-left">Fiş No</th>
                                  <th className="p-2 text-left">Tarih</th>
                                  <th className="p-2 text-left">Hesap</th>
                                  <th className="p-2 text-left">Açıklama</th>
                                  <th className="p-2 text-right">Borç</th>
                                  <th className="p-2 text-right">Alacak</th>
                                  <th className="p-2 text-left">Belge</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.suggestedLucaRows.map((suggestion, index) => (
                                  <tr
                                    key={`${row.id}-suggestion-${index}`}
                                    className="border-t border-gray-800"
                                  >
                                    <td className="p-2">{suggestion.fisNo}</td>
                                    <td className="p-2">{suggestion.fisTarihi}</td>
                                    <td className="p-2">{suggestion.hesapKodu}</td>
                                    <td className="p-2">
                                      {suggestion.detayAciklama || suggestion.fisAciklama}
                                    </td>
                                    <td className="p-2 text-right">
                                      {formatMoney(suggestion.borc)}
                                    </td>
                                    <td className="p-2 text-right">
                                      {formatMoney(suggestion.alacak)}
                                    </td>
                                    <td className="p-2">{suggestion.belgeTuru}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {displayedRows.length > 150 ? (
            <p className="mt-4 text-sm text-gray-400">
              İlk 150 sonuç gösteriliyor. Arama veya filtre kullanın.
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
          Her iki Excel dosyasını yükledikten sonra <strong>Karşılaştır</strong>{" "}
          butonuna basın. Sonuç raporu burada görünecek.
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
