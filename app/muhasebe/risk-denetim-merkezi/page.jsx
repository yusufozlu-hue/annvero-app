"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import CompanySelectOptions from "../components/CompanySelectOptions";
import ParserJobProgress from "@/src/components/ParserJobProgress";
import { useCompanyList } from "../hooks/useCompanyList";
import { useParserJob } from "@/src/hooks/useParserJob";
import {
  KURGAN_RISK_LEVEL,
  KURGAN_RISK_STATUS,
  riskLevelBadgeClass,
} from "@/src/config/kurganRiskDefaults";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { logParserJobError } from "@/src/utils/parserJobLogger";
import { SYSTEM_ERROR_TYPES } from "@/src/utils/systemLogEngine";
import { runRiskAnalysisWorker } from "@/src/utils/workerParserBridge";
import { PARSER_WORKER_URLS } from "@/src/utils/parserWorkerUrls";
import {
  analyzeKurganRisks,
  collectKurganDataSources,
  loadKurganRiskFindings,
  mergeSavedStatuses,
  parseMizanSheet,
  parseMuavinSheet,
  saveKurganRiskFindings,
  saveKurganRiskSnapshot,
} from "@/src/utils/kurganRiskEngine";
import {
  exportKurganRiskReportWorkbook,
  prepareKurganRiskPdfReport,
} from "@/src/utils/kurganRiskExport";

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20";

const STATUS_OPTIONS = Object.values(KURGAN_RISK_STATUS);
const LEVEL_OPTIONS = ["Tümü", ...Object.values(KURGAN_RISK_LEVEL)];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function readExcelSheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

export default function RiskDenetimMerkeziPage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
  } = useCompanyList();

  const [period, setPeriod] = useState("");
  const [mizanRows, setMizanRows] = useState([]);
  const [muavinRows, setMuavinRows] = useState([]);
  const [findings, setFindings] = useState(() => loadKurganRiskFindings());
  const [summary, setSummary] = useState({
    totalRisks: 0,
    criticalRisks: 0,
    highRisks: 0,
    pendingReviews: 0,
    lastAnalyzedAt: "",
  });
  const [levelFilter, setLevelFilter] = useState("Tümü");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const companyName = getCompanyDisplayName(selectedCompany);

  const parserJob = useParserJob({
    logMeta: {
      module: "Risk / Denetim Merkezi",
      companyId: selectedCompanyId,
      companyName,
      jobType: "risk-analysis",
    },
  });

  const filteredFindings = useMemo(() => {
    return findings.filter((item) => {
      if (selectedCompanyId && item.companyId !== selectedCompanyId) return false;
      if (levelFilter !== "Tümü" && item.level !== levelFilter) return false;
      if (statusFilter !== "Tümü" && item.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const haystack = `${item.type} ${item.description} ${item.recommendedAction}`.toLowerCase();
      return haystack.includes(search.trim().toLowerCase());
    });
  }, [findings, selectedCompanyId, levelFilter, statusFilter, search]);

  const handleMizanUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await readExcelSheet(file);
    setMizanRows(parseMizanSheet(rows));
    setToast("Mizan dosyası yüklendi.");
  };

  const handleMuavinUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await readExcelSheet(file);
    setMuavinRows(parseMuavinSheet(rows));
    setToast("Muavin dosyası yüklendi.");
  };

  const runAnalysis = async () => {
    if (!selectedCompanyId) {
      setToast("Analiz için önce firma seçin.");
      return;
    }

    setAnalyzing(true);
    parserJob.begin({ stage: "Risk analizi", detail: "Veri kaynakları toplanıyor" });

    try {
      const { lucaRows, declarationRecords, bankRows } = collectKurganDataSources({
        companyId: selectedCompanyId,
      });
      const input = {
        companyId: selectedCompanyId,
        companyName,
        period,
        mizanRows,
        muavinRows,
        bankRows,
        lucaRows,
        declarationRecords,
      };

      let result;
      try {
        const workerResult = await runRiskAnalysisWorker({
          workerUrl: PARSER_WORKER_URLS.riskAnalysis,
          payload: { input },
          onProgress: parserJob.onProgress,
        });
        result = {
          findings: workerResult.findings,
          summary: workerResult.summary,
          sources: workerResult.sources,
          analyzedAt: workerResult.analyzedAt,
        };
      } catch (workerError) {
        console.warn("[risk-denetim] worker fallback", workerError);
        result = analyzeKurganRisks(input);
      }

      const merged = mergeSavedStatuses(result.findings, loadKurganRiskFindings());
      setFindings(merged);
      setSummary({ ...result.summary, lastAnalyzedAt: result.analyzedAt });
      saveKurganRiskFindings(merged);
      saveKurganRiskSnapshot({
        companyId: selectedCompanyId,
        companyName,
        period,
        summary: result.summary,
        sources: result.sources,
      });
      parserJob.markSuccess(`${merged.length} risk bulgusu üretildi`);
      setToast(`${merged.length} risk bulgusu üretildi.`);
    } catch (error) {
      logParserJobError(error, {
        module: "Risk / Denetim Merkezi",
        companyId: selectedCompanyId,
        companyName,
        errorType: SYSTEM_ERROR_TYPES.UNEXPECTED,
        jobType: "risk-analysis",
      });
      parserJob.markError(error);
      setToast(error?.message || "Risk analizi başarısız.");
    } finally {
      setAnalyzing(false);
    }
  };

  const updateFindingStatus = (id, status) => {
    const next = findings.map((item) => (item.id === id ? { ...item, status } : item));
    setFindings(next);
    saveKurganRiskFindings(next);
    setSummary((prev) => ({
      ...prev,
      pendingReviews: next.filter((item) =>
        [KURGAN_RISK_STATUS.YENI, KURGAN_RISK_STATUS.INCELENIYOR, KURGAN_RISK_STATUS.DUZELTME_GEREKLI].includes(
          item.status
        )
      ).length,
    }));
  };

  const handleExcelExport = () => {
    exportKurganRiskReportWorkbook({
      findings: filteredFindings,
      summary,
      meta: {
        companyName,
        period,
        analyzedAt: summary.lastAnalyzedAt,
      },
      fileName: "kurgan-risk-denetim",
    });
    setToast("Excel raporu indirildi.");
  };

  const handlePdfExport = () => {
    const pdf = prepareKurganRiskPdfReport();
    setToast(pdf.message);
  };

  return (
    <main className="min-h-screen bg-[#050816] px-4 py-6 text-white sm:px-6 lg:px-8">
      {toast ? (
        <div className="fixed right-4 top-4 z-[9999] rounded-xl border border-indigo-500/40 bg-indigo-950/95 px-4 py-3 text-sm font-medium text-indigo-100 shadow-xl">
          {toast}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300/80">
            KURGAN / Vergisel Risk
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Risk / Denetim Merkezi</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400 sm:text-base">
            Mizan, muavin, banka, Luca fiş ve beyanname verilerini analiz ederek vergisel riskleri
            tespit edin.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ParserJobProgress
            visible={analyzing || parserJob.isDone || parserJob.isError}
            stage={parserJob.stage}
            detail={parserJob.detail}
            percent={parserJob.percent}
            timeoutWarning={parserJob.timeoutWarning}
            status={parserJob.status}
            error={parserJob.error}
            onCancel={analyzing ? () => parserJob.cancel("user") : undefined}
            className="w-full"
          />
          <button
            type="button"
            onClick={runAnalysis}
            disabled={analyzing}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60"
          >
            {analyzing ? "Analiz çalışıyor..." : "Risk Analizi Çalıştır"}
          </button>
          <button
            type="button"
            onClick={handleExcelExport}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-white/10"
          >
            Excel İndir
          </button>
          <button
            type="button"
            onClick={handlePdfExport}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-gray-400 hover:bg-white/10"
          >
            PDF (Yakında)
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Toplam Risk Sayısı" value={summary.totalRisks} />
        <StatCard label="Kritik Risk Sayısı" value={summary.criticalRisks} tone="red" />
        <StatCard label="Yüksek Risk Sayısı" value={summary.highRisks} tone="amber" />
        <StatCard label="Kontrol Bekleyen İşlem" value={summary.pendingReviews} />
        <StatCard
          label="Son Analiz Tarihi"
          value={
            summary.lastAnalyzedAt
              ? new Date(summary.lastAnalyzedAt).toLocaleString("tr-TR")
              : "-"
          }
          small
        />
      </div>

      <section className="mb-6 rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <h2 className="mb-4 text-xl font-semibold">Veri Kaynakları</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Firma">
            <select
              value={selectedCompanyId}
              onChange={(event) => setSelectedCompanyId(event.target.value)}
              className={inputClassName}
            >
              <option value="">Firma seçin</option>
              <CompanySelectOptions companies={companies} />
            </select>
          </Field>
          <Field label="Dönem">
            <input
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              placeholder="2026/05"
              className={inputClassName}
            />
          </Field>
          <Field label="Mizan Yükle">
            <input type="file" accept=".xlsx,.xls" onChange={handleMizanUpload} className={inputClassName} />
          </Field>
          <Field label="Muavin Yükle">
            <input type="file" accept=".xlsx,.xls" onChange={handleMuavinUpload} className={inputClassName} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-400">
          <span>Mizan satırı: {mizanRows.length}</span>
          <span>Muavin satırı: {muavinRows.length}</span>
          <span>Luca/banka/beyanname verileri analiz sırasında otomatik okunur.</span>
        </div>
      </section>

      <section className="mb-4 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Risk ara..."
          className={`${inputClassName} max-w-sm`}
        />
        <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)} className={`${inputClassName} max-w-[180px]`}>
          {LEVEL_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${inputClassName} max-w-[200px]`}>
          <option value="Tümü">Tüm Durumlar</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <h2 className="mb-4 text-xl font-semibold">Risk Listesi</h2>
        <div className="space-y-3">
          {filteredFindings.length === 0 ? (
            <p className="py-8 text-center text-gray-400">
              Henüz risk bulgusu yok. Veri yükleyip analiz çalıştırın.
            </p>
          ) : (
            filteredFindings.map((finding) => (
              <article key={finding.id} className="rounded-xl border border-white/10 bg-gray-950/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${riskLevelBadgeClass(finding.level)}`}>
                        {finding.level}
                      </span>
                      <span className="text-xs text-gray-400">{finding.source}</span>
                    </div>
                    <h3 className="font-semibold text-white">{finding.type}</h3>
                    <p className="mt-1 text-sm text-gray-300">{finding.description}</p>
                    <p className="mt-2 text-sm text-indigo-200">{finding.recommendedAction}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums">{formatMoney(finding.amount)} TL</p>
                    <p className="text-xs text-gray-400">{finding.companyName || companyName}</p>
                    <p className="text-xs text-gray-500">{finding.period || period || "-"}</p>
                    <select
                      value={finding.status}
                      onChange={(event) => updateFindingStatus(finding.id, event.target.value)}
                      className={`${inputClassName} mt-2 min-w-[170px] text-xs`}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedId((current) => (current === finding.id ? "" : finding.id))}
                  className="mt-3 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
                >
                  {expandedId === finding.id ? "Akıllı açıklamayı gizle" : "Akıllı açıklamayı göster"}
                </button>
                {expandedId === finding.id ? (
                  <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-relaxed text-gray-300">
                    {finding.smartExplanation}
                  </pre>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function StatCard({ label, value, tone = "default", small = false }) {
  const toneClass =
    tone === "red"
      ? "text-red-300"
      : tone === "amber"
        ? "text-amber-300"
        : "text-white";

  return (
    <div className="rounded-2xl border border-white/10 bg-gray-900/70 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-2 font-bold tabular-nums ${toneClass} ${small ? "text-sm" : "text-3xl"}`}>
        {value}
      </p>
    </div>
  );
}
