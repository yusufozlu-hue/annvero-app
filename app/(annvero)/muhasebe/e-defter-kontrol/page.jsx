"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  E_DEFTER_ENGINE_VERSION,
  E_DEFTER_FINDING_STATUS,
  E_DEFTER_HATA_TURU,
  E_DEFTER_KAYNAK,
  E_DEFTER_KONTROL_GRUP,
  E_DEFTER_KONTROL_STATUS,
  E_DEFTER_REPORT_DISCLAIMER,
  E_DEFTER_RISK_LEVEL,
  E_DEFTER_SONUC_SEVIYE,
  riskLevelBadgeClass,
} from "@/src/config/eDefterKontrolDefaults";
import { normalizeCompanyRecord } from "@/src/utils/companyCenter";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  buildEDefterResultFingerprints,
  buildEDefterUploadRecord,
  buildFisKontrolDeepLink,
  filterEDefterRows,
  loadEDefterFingerprintSession,
  loadEDefterKontrolRecords,
  parseEDefterListeSheet,
  parseMizanSheet,
  parseMuavinSheet,
  parseYevmiyeSheet,
  recalculateEDefterRows,
  runOneClickEDefterKontrol,
  saveEDefterFingerprintSession,
  saveEDefterKontrolRecords,
} from "@/src/utils/eDefterKontrolEngine";
import {
  exportEDefterReportWorkbook,
  prepareEDefterPdfReport,
} from "@/src/utils/eDefterKontrolExport";
import AnnveroDataTable from "@/src/components/AnnveroDataTable";
import ParserJobProgress from "@/src/components/ParserJobProgress";
import { useParserJob } from "@/src/hooks/useParserJob";
import { logParserJobError } from "@/src/utils/parserJobLogger";
import { PARSER_WORKER_URLS } from "@/src/utils/parserWorkerUrls";
import {
  runEDefterXmlWorker,
  runExcelSheetWorker,
} from "@/src/utils/workerParserBridge";
import { parseEDefterUploadBuffer } from "@/src/utils/eDefterXmlParser";
import { DUPLICATE_EDEFTER_UI_MESSAGE } from "@/src/utils/eDefterSecurity";
import {
  buildPersistPayloadFromAnalysis,
  clearEDefterLegacyLocalStorage,
  clearEDefterUiCaches,
  getEDefterControlRun,
  listEDefterControlRuns,
  saveEDefterControlRun,
  updateEDefterFindingResolution,
} from "@/src/utils/eDefterPersistClient";
import { EDEFTER_FINDING_RESOLUTION } from "@/src/utils/eDefterPersistSafe";
import {
  logExcelError,
  SYSTEM_ERROR_TYPES,
} from "@/src/utils/systemLogEngine";

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20";

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function grupClass(grup) {
  if (grup === E_DEFTER_KONTROL_GRUP.HATASIZ) return "bg-emerald-900/50 text-emerald-200";
  if (
    [
      E_DEFTER_KONTROL_GRUP.KRITIK,
      E_DEFTER_KONTROL_GRUP.TEKNIK,
      E_DEFTER_KONTROL_GRUP.CAPRAZ,
    ].includes(grup)
  ) {
    return "bg-red-900/50 text-red-200";
  }
  if (grup === E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI) {
    return "bg-sky-900/50 text-sky-200";
  }
  if (grup === E_DEFTER_KONTROL_GRUP.VERGISEL) return "bg-purple-900/50 text-purple-200";
  return "bg-amber-900/50 text-amber-200";
}

function rowHasFindings(row) {
  if (!row || row.disaridaBirak) return false;
  if (Array.isArray(row.issueDetails) && row.issueDetails.length > 0) return true;
  if (Array.isArray(row.issues) && row.issues.length > 0) return true;
  return Boolean(row.grup && row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ);
}

function companyTaxIdOf(company) {
  if (!company) return "";
  return String(
    company.vkn ||
      company.taxId ||
      company.vergiNo ||
      company.tckn ||
      company.taxNumber ||
      ""
  ).replace(/\D/g, "");
}

export default function EDefterKontrolPage() {
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

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [records, setRecords] = useState(() => loadEDefterKontrolRecords());

  const [muavinRows, setMuavinRows] = useState([]);
  const [yevmiyeRows, setYevmiyeRows] = useState([]);
  const [mizanRows, setMizanRows] = useState([]);
  const [edefterListeRows, setEdefterListeRows] = useState([]);
  const [xmlRows, setXmlRows] = useState([]);
  const [technicalFindings, setTechnicalFindings] = useState([]);
  const [uploadMeta, setUploadMeta] = useState(null);
  const [pendingParsed, setPendingParsed] = useState(null);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [groupCounts, setGroupCounts] = useState([]);
  const [activeGroup, setActiveGroup] = useState("");
  const [search, setSearch] = useState("");
  const [riskLevelFilter, setRiskLevelFilter] = useState("Tümü");
  const [hataTuruFilter, setHataTuruFilter] = useState("Tümü");
  const [cozumFilter, setCozumFilter] = useState("Tümü");
  const [expandedId, setExpandedId] = useState("");
  const [showAllDetails, setShowAllDetails] = useState(false);
  const [toast, setToast] = useState("");
  const [xmlParsing, setXmlParsing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [detailLimit, setDetailLimit] = useState(40);

  const [historyRuns, setHistoryRuns] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPeriodFilter, setHistoryPeriodFilter] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("");
  const [historyRiskFilter, setHistoryRiskFilter] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedRunDetail, setSelectedRunDetail] = useState(null);
  const [selectedRunFindings, setSelectedRunFindings] = useState([]);
  const [persistError, setPersistError] = useState("");
  const [persistRetryPayload, setPersistRetryPayload] = useState(null);
  const [persisting, setPersisting] = useState(false);
  const [lastPersistMeta, setLastPersistMeta] = useState(null);
  const lastAnalysisRef = useRef(null);

  const fingerprintSessionRef = useRef(null);
  if (fingerprintSessionRef.current == null) {
    fingerprintSessionRef.current = loadEDefterFingerprintSession();
  }
  const abortRef = useRef(null);
  const prevCompanyRef = useRef(selectedCompanyId);

  const parserJob = useParserJob({
    logMeta: {
      module: "XML / e-Defter",
      companyId: selectedCompanyId,
      companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
    },
  });

  const period = `${year}/${month}`;
  const companyRecords = useMemo(
    () => records.filter((record) => !selectedCompanyId || record.companyId === selectedCompanyId),
    [records, selectedCompanyId]
  );

  const clearAnalysisState = () => {
    setMuavinRows([]);
    setYevmiyeRows([]);
    setMizanRows([]);
    setEdefterListeRows([]);
    setXmlRows([]);
    setTechnicalFindings([]);
    setUploadMeta(null);
    setPendingParsed(null);
    setRows([]);
    setSummary(null);
    setGroupCounts([]);
    setActiveGroup("");
    setExpandedId("");
    setShowAllDetails(false);
    setDetailLimit(40);
    setHistoryRuns([]);
    setSelectedRunId("");
    setSelectedRunDetail(null);
    setSelectedRunFindings([]);
    setPersistError("");
    setPersistRetryPayload(null);
    setLastPersistMeta(null);
    lastAnalysisRef.current = null;
    setRecords([]);
    clearEDefterUiCaches();
    fingerprintSessionRef.current = loadEDefterFingerprintSession();
  };

  const refreshHistory = async (companyId = selectedCompanyId) => {
    if (!companyId) {
      setHistoryRuns([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const data = await listEDefterControlRuns({
        companyId,
        period: historyPeriodFilter || undefined,
        status: historyStatusFilter || undefined,
        risk: historyRiskFilter || undefined,
      });
      setHistoryRuns(data);
    } catch (error) {
      setToast(error?.message || "Kontrol geçmişi alınamadı.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const persistAnalysisResult = async (payload, { silent = false } = {}) => {
    setPersisting(true);
    setPersistError("");
    try {
      const result = await saveEDefterControlRun(payload);
      setPersistRetryPayload(null);
      setLastPersistMeta({
        idempotent: Boolean(result?.idempotent),
        created: Boolean(result?.created),
        runId: result?.data?.id || "",
        revision: result?.data?.revision || 1,
      });
      clearEDefterLegacyLocalStorage();
      setRecords([]);
      await refreshHistory(payload.company_id);
      if (!silent) {
        if (result?.idempotent) {
          setToast("Bu kontrol daha önce kaydedilmiş — mükerrer run oluşturulmadı.");
        } else {
          setToast("Kontrol sonucu sunucuya kaydedildi.");
        }
      }
      return result;
    } catch (error) {
      setPersistError(error?.message || "Kayıt başarısız.");
      setPersistRetryPayload(payload);
      if (!silent) {
        setToast(
          `${error?.message || "Kayıt başarısız."} Analiz sonuçları ekranda duruyor — Kaydı yeniden deneyin.`
        );
      }
      throw error;
    } finally {
      setPersisting(false);
    }
  };

  useEffect(() => {
    if (prevCompanyRef.current === selectedCompanyId) return;
    prevCompanyRef.current = selectedCompanyId;
    clearAnalysisState();
    setToast("Firma değişti — kontrol durumu ve önbellek temizlendi.");
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        setHistoryLoading(true);
        try {
          const data = await listEDefterControlRuns({
            companyId: selectedCompanyId,
            period: historyPeriodFilter || undefined,
            status: historyStatusFilter || undefined,
            risk: historyRiskFilter || undefined,
          });
          if (!cancelled) setHistoryRuns(data);
        } catch (err) {
          if (!cancelled) setToast(err?.message || "Kontrol geçmişi alınamadı.");
        } finally {
          if (!cancelled) setHistoryLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [selectedCompanyId, historyPeriodFilter, historyStatusFilter, historyRiskFilter]);

  const findingRows = useMemo(
    () =>
      filterEDefterRows(rows, {
        grup: activeGroup,
        search,
        riskLevel: riskLevelFilter,
        hataTuru: hataTuruFilter,
        cozumDurumu: cozumFilter,
      }).filter((row) => {
        // Only truly clean rows may be hidden. Issues never hide behind HATASIZ.
        if (rowHasFindings(row)) return true;
        return row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ;
      }),
    [rows, activeGroup, search, riskLevelFilter, hataTuruFilter, cozumFilter]
  );

  const findingStats = useMemo(() => {
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    for (const row of findingRows) {
      const details = Array.isArray(row.issueDetails) ? row.issueDetails : [];
      if (details.length) {
        for (const issue of details) {
          if (issue.severity === "KRITIK" || issue.blocking) errorCount += 1;
          else if (issue.severity === "BILGI") infoCount += 1;
          else warningCount += 1;
        }
      } else if (row.grup === E_DEFTER_KONTROL_GRUP.KRITIK) {
        errorCount += 1;
      } else {
        warningCount += 1;
      }
    }
    return {
      total: findingRows.length,
      errorCount,
      warningCount,
      infoCount,
    };
  }, [findingRows]);

  const displayedRows = useMemo(() => {
    if (showAllDetails) return findingRows;
    return findingRows.slice(0, detailLimit);
  }, [findingRows, showAllDetails, detailLimit]);

  const persistRecord = (record) => {
    const next = [record, ...records.filter((item) => item.id !== record.id)];
    setRecords(next);
    saveEDefterKontrolRecords(next);
  };

  const readExcelSheetWithWorker = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    try {
      const result = await runExcelSheetWorker({
        workerUrl: PARSER_WORKER_URLS.excelSheet,
        arrayBuffer,
        mode: "rows",
        onProgress: parserJob.onProgress,
      });
      return result.rows;
    } catch {
      const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    }
  };

  const handleXmlUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setXmlParsing(true);
    parserJob.begin({ stage: "XML/ZIP okunuyor", detail: file.name });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const companyTaxId = companyTaxIdOf(selectedCompany);
      const known = fingerprintSessionRef.current;
      let parsed;
      try {
        const workerResult = await runEDefterXmlWorker({
          workerUrl: PARSER_WORKER_URLS.eDefterXml,
          arrayBuffer,
          fileName: file.name,
          companyTaxId,
          knownFingerprints: known.values(),
          onProgress: parserJob.onProgress,
        });
        parsed = workerResult;
        if (Array.isArray(workerResult.knownFingerprints)) {
          workerResult.knownFingerprints.forEach((fp) => known.add(fp));
          saveEDefterFingerprintSession(known);
        }
      } catch (workerError) {
        if (workerError?.code) throw workerError;
        parsed = await parseEDefterUploadBuffer(arrayBuffer, file.name, {
          companyTaxId,
          knownFingerprints: known,
          signal: controller.signal,
        });
        if (parsed.fingerprint) {
          known.add(parsed.fingerprint);
          saveEDefterFingerprintSession(known);
        }
      }

      if (parsed.duplicate) {
        setToast(parsed.duplicateMessage || DUPLICATE_EDEFTER_UI_MESSAGE);
        parserJob.markSuccess("Mükerrer — işlenmedi");
        return;
      }

      setXmlRows(parsed.rows);
      setTechnicalFindings(parsed.technicalFindings);
      setUploadMeta(parsed);
      setPendingParsed(parsed);
      parserJob.markSuccess(`${parsed.rows.length} XML satırı okundu`);
      setToast(`${parsed.rows.length} XML satırı, ${parsed.technicalFindings.length} teknik bulgu okundu.`);
    } catch (error) {
      logParserJobError(error, {
        module: "XML / e-Defter",
        companyId: selectedCompanyId,
        companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
        fileName: file.name,
        errorType: SYSTEM_ERROR_TYPES.CORRUPT_XML,
        source: "xml",
        jobType: "edefter-xml",
      });
      parserJob.markError(error);
      setToast(error.message || "XML/ZIP okunamadı.");
    } finally {
      setXmlParsing(false);
      abortRef.current = null;
      event.target.value = "";
    }
  };

  const handleMuavinUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setMuavinRows(parseMuavinSheet(await readExcelSheetWithWorker(file)));
      setToast("Muavin Excel yüklendi.");
    } catch (error) {
      logExcelError(error.message || "Muavin Excel okunamadı.", { stack: error?.stack }, selectedCompanyId, {
        fileName: file.name,
        errorType: SYSTEM_ERROR_TYPES.CORRUPT_EXCEL,
        module: "XML / e-Defter",
      });
      setToast(error.message || "Muavin Excel okunamadı.");
    }
    event.target.value = "";
  };

  const handleYevmiyeUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setYevmiyeRows(parseYevmiyeSheet(await readExcelSheetWithWorker(file)));
    setToast("Yevmiye Excel yüklendi.");
    event.target.value = "";
  };

  const handleMizanUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMizanRows(parseMizanSheet(await readExcelSheetWithWorker(file)));
    setToast("Mizan Excel yüklendi.");
    event.target.value = "";
  };

  const handleEdefterUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setEdefterListeRows(parseEDefterListeSheet(await readExcelSheetWithWorker(file)));
    setToast("E-defter liste Excel yüklendi.");
    event.target.value = "";
  };

  const handleAnalyze = async () => {
    if (!selectedCompanyId) {
      setToast("Önce firma seçin.");
      return;
    }
    if (!muavinRows.length && !yevmiyeRows.length && !xmlRows.length && !pendingParsed) {
      setToast("En az muavin, yevmiye veya XML/ZIP dosyası yükleyin.");
      return;
    }

    setAnalyzing(true);
    setPersistError("");
    setPersistRetryPayload(null);
    setLastPersistMeta(null);
    parserJob.begin({ stage: "e-Defter kontrolü", detail: "Tek tuş kontrol" });
    const startedAt = new Date().toISOString();

    try {
      const result = await runOneClickEDefterKontrol({
        parsedUpload: pendingParsed || {
          rows: xmlRows,
          technicalFindings,
          beratMeta: uploadMeta?.beratMeta || null,
          packageMeta: uploadMeta?.packageMeta || {},
          fingerprint: uploadMeta?.fingerprint || "",
          duplicate: false,
        },
        muavinRows,
        yevmiyeRows,
        mizanRows,
        edefterListeRows,
        companyId: selectedCompanyId,
        companyTaxId: companyTaxIdOf(selectedCompany),
        period,
        fingerprintSession: fingerprintSessionRef.current,
        coreDecision: { decision_source: "CORE", source: "CORE" },
      });

      if (result.duplicate) {
        setToast(result.duplicateMessage || DUPLICATE_EDEFTER_UI_MESSAGE);
        parserJob.markSuccess("Mükerrer");
        return;
      }

      saveEDefterFingerprintSession(fingerprintSessionRef.current);
      setRows(result.rows);
      setSummary(result.summary);
      setGroupCounts(result.groupCounts);
      setShowAllDetails(false);
      setDetailLimit(40);

      const localRecord = buildEDefterUploadRecord({
        companyId: selectedCompanyId,
        year,
        month,
        period,
        defterType: uploadMeta?.defterType || "Excel/XML",
        fileName: uploadMeta?.fileName || "excel-yukleme",
        controlStatus: E_DEFTER_KONTROL_STATUS.TAMAMLANDI,
        errorCount: result.summary.kritikHata + result.summary.teknikHata,
        warningCount: result.summary.uyariSayisi,
        uploadedAt: new Date().toISOString(),
      });
      // Geçici UI cache — sunucu kaydı başarılı olunca temizlenir
      persistRecord(localRecord);

      const journalRows = (result.rows || []).filter((row) =>
        [E_DEFTER_KAYNAK.YEVMIYE, E_DEFTER_KAYNAK.YEVMIYE_XML].includes(row.kaynak)
      );
      const ledgerRows = (result.rows || []).filter((row) =>
        [E_DEFTER_KAYNAK.KEBIR_XML, E_DEFTER_KAYNAK.MUAVIN].includes(row.kaynak)
      );
      const fingerprints = buildEDefterResultFingerprints({
        sourceFingerprint: uploadMeta?.fingerprint || pendingParsed?.fingerprint || "",
        journalRows,
        ledgerRows,
        companyId: selectedCompanyId,
        period,
        summary: result.summary,
      });

      const documentTypes = [
        uploadMeta?.defterType,
        muavinRows.length ? "Muavin" : "",
        yevmiyeRows.length ? "Yevmiye Excel" : "",
        xmlRows.length || pendingParsed ? "XML/ZIP" : "",
      ].filter(Boolean);

      const payload = buildPersistPayloadFromAnalysis({
        companyId: selectedCompanyId,
        period,
        engineVersion: E_DEFTER_ENGINE_VERSION,
        fingerprints,
        summary: result.summary,
        rows: result.rows,
        journalLedger: result.journalLedger,
        documentTypes,
        documentCount: result.summary.yuklenenDefterSayisi,
        startedAt,
        completedAt: new Date().toISOString(),
      });

      lastAnalysisRef.current = { result, payload };

      parserJob.markSuccess(`${result.rows.length} kayıt · ${result.overallSonuc}`);

      try {
        await persistAnalysisResult(payload);
        setToast(
          result.summary.edefterUygun
            ? `Kontrol tamamlandı ve kaydedildi: ${result.overallSonuc}`
            : `Kontrol tamamlandı ve kaydedildi: ${result.overallSonuc} (onaylı uygun değil)`
        );
      } catch {
        // Analiz ekranda kalır; retry butonu gösterilir
      }
    } catch (error) {
      logParserJobError(error, {
        module: "XML / e-Defter",
        companyId: selectedCompanyId,
        companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
        errorType: SYSTEM_ERROR_TYPES.UNEXPECTED,
        source: "xml",
        jobType: "edefter-analyze",
      });
      parserJob.markError(error);
      setToast(error?.message || "Analiz başarısız.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePersistRetry = async () => {
    const payload = persistRetryPayload || lastAnalysisRef.current?.payload;
    if (!payload) {
      setToast("Yeniden denenecek kayıt yok.");
      return;
    }
    try {
      await persistAnalysisResult({ ...payload, retry: true });
    } catch {
      /* toast already set */
    }
  };

  const handleOpenHistoryRun = async (runId) => {
    if (!selectedCompanyId || !runId) return;
    setSelectedRunId(runId);
    try {
      const detail = await getEDefterControlRun(runId, selectedCompanyId);
      setSelectedRunDetail(detail?.data || null);
      setSelectedRunFindings(detail?.findings || []);
    } catch (error) {
      setToast(error?.message || "Run detayı alınamadı.");
    }
  };

  const handleFindingResolution = async (findingId, resolutionStatus) => {
    if (!selectedCompanyId || !findingId) return;
    try {
      const updated = await updateEDefterFindingResolution({
        findingId,
        companyId: selectedCompanyId,
        resolutionStatus,
      });
      setSelectedRunFindings((current) =>
        current.map((item) => (item.id === findingId ? updated : item))
      );
      setToast("Bulgu çözüm durumu güncellendi.");
    } catch (error) {
      setToast(error?.message || "Bulgu güncellenemedi.");
    }
  };

  const updateRow = (rowId, patch) => {
    setRows((current) => {
      const next = current.map((row) =>
        row.id === rowId ? { ...row, ...patch, manuallyEdited: true } : row
      );
      const result = recalculateEDefterRows(next);
      setSummary({
        ...result.summary,
        overallSonuc: summary?.overallSonuc,
        edefterUygun: summary?.edefterUygun,
        canApproveExport: summary?.canApproveExport,
      });
      setGroupCounts(result.groupCounts);
      return result.rows;
    });
  };

  const handleExport = () => {
    if (!rows.length) {
      setToast("Önce kontrol çalıştırın.");
      return;
    }
    const result = exportEDefterReportWorkbook({
      rows,
      summary: summary || {},
      meta: {
        firmaAdi: getCompanyDisplayName(selectedCompany),
        donem: period,
        disclaimer: E_DEFTER_REPORT_DISCLAIMER,
        appVersion: typeof window !== "undefined" ? window.__ANNVERO_BUILD__ || "web" : "web",
      },
      fileName: "e-defter-kontrol",
      force: true,
    });
    if (result.blocked) {
      setToast(result.message);
      return;
    }
    setToast("Excel raporu indirildi.");
  };

  const handlePdf = () => {
    const pdf = prepareEDefterPdfReport({
      summary: summary || {},
      meta: { appVersion: "web" },
    });
    setToast(pdf.message);
  };

  const handleCancel = () => {
    abortRef.current?.abort?.();
    parserJob.cancel("user");
    setXmlParsing(false);
    setAnalyzing(false);
    setToast("İşlem iptal edildi.");
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
            E-Defter
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">E-Defter Kontrol Merkezi</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400 sm:text-base">
            Yevmiye/kebir XML, berat ve ZIP dosyalarını analiz ederek teknik, muhasebesel ve vergisel
            riskleri berat öncesi tespit edin. GİB doğrulaması yapılmaz.
          </p>
        </div>
        <div className="flex w-full min-w-[280px] flex-col gap-2 sm:w-auto">
          <ParserJobProgress
            visible={xmlParsing || analyzing || parserJob.isDone || parserJob.isError}
            stage={parserJob.stage}
            detail={parserJob.detail}
            percent={parserJob.percent}
            timeoutWarning={parserJob.timeoutWarning}
            status={parserJob.status}
            error={parserJob.error}
            onCancel={xmlParsing || analyzing ? handleCancel : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing || xmlParsing || persisting}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 disabled:opacity-60"
            >
              {analyzing ? "Kontrol çalışıyor..." : persisting ? "Kaydediliyor..." : "Kontrolü Başlat"}
            </button>
            {persistError ? (
              <button
                type="button"
                onClick={handlePersistRetry}
                disabled={persisting}
                className="rounded-xl border border-amber-500/50 bg-amber-950/50 px-4 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-900/40 disabled:opacity-60"
              >
                Kaydı yeniden dene
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleExport}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-white/10"
            >
              Excel İndir
            </button>
            <button
              type="button"
              onClick={handlePdf}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-gray-400 hover:bg-white/10"
            >
              PDF Özeti
            </button>
          </div>
          {persistError ? (
            <p className="mt-2 text-xs text-amber-200">
              Kayıt başarısız: {persistError}. Analiz sonuçları kaybolmadı.
            </p>
          ) : null}
          {lastPersistMeta?.idempotent ? (
            <p className="mt-2 text-xs text-emerald-200">
              Aynı fingerprint + motor sürümü — mükerrer run oluşturulmadı (rev.{lastPersistMeta.revision}).
            </p>
          ) : null}
        </div>
      </div>

      {summary ? (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <StatCard label="Genel Sonuç" value={summary.overallSonuc || "-"} />
          <StatCard label="Yüklenen Defter" value={summary.yuklenenDefterSayisi} />
          <StatCard label="Kritik Hata" value={summary.kritikHata} tone="red" />
          <StatCard label="Uyarı" value={summary.uyariSayisi} tone="amber" />
          <StatCard label="Teknik Hata" value={summary.teknikHata} />
          <StatCard label="Vergisel Risk" value={summary.vergiselRisk} tone="purple" />
        </div>
      ) : null}

      {summary && summary.edefterUygun === false ? (
        <p className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
          Engelleyici veya çözülmemiş bulgu varken “E-Defter uygun” onayı verilmez. Görünen
          bulgular: {findingStats.total} (hata {findingStats.errorCount}, uyarı{" "}
          {findingStats.warningCount}, bilgi {findingStats.infoCount}).
        </p>
      ) : null}

      {summary?.overallSonuc === E_DEFTER_SONUC_SEVIYE.KRITIK ? (
        <p className="mb-4 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-100">
          Kritik hata varken “E-Defter uygun” onayı verilemez.
        </p>
      ) : null}

      <section className="mb-6 rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <h2 className="mb-4 text-xl font-semibold">Firma ve Dönem</h2>
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
          <Field label="Yıl">
            <input value={year} onChange={(event) => setYear(event.target.value)} className={inputClassName} />
          </Field>
          <Field label="Ay">
            <input value={month} onChange={(event) => setMonth(event.target.value)} className={inputClassName} />
          </Field>
          <Field label="Dönem">
            <input value={period} readOnly className={inputClassName} />
          </Field>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <h2 className="mb-4 text-xl font-semibold">Dosya Yükleme</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Yevmiye / Kebir XML veya ZIP">
            <input type="file" accept=".xml,.zip" onChange={handleXmlUpload} className={inputClassName} />
          </Field>
          <Field label="Muavin Excel">
            <input type="file" accept=".xlsx,.xls" onChange={handleMuavinUpload} className={inputClassName} />
          </Field>
          <Field label="Yevmiye Excel">
            <input type="file" accept=".xlsx,.xls" onChange={handleYevmiyeUpload} className={inputClassName} />
          </Field>
          <Field label="Mizan Excel">
            <input type="file" accept=".xlsx,.xls" onChange={handleMizanUpload} className={inputClassName} />
          </Field>
          <Field label="E-defter Liste Excel">
            <input type="file" accept=".xlsx,.xls" onChange={handleEdefterUpload} className={inputClassName} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          XML: {xmlRows.length} satır · Teknik bulgu: {technicalFindings.length} · Muavin: {muavinRows.length} ·
          Yevmiye: {yevmiyeRows.length} · Mizan: {mizanRows.length}
        </p>
      </section>

      {companyRecords.length > 0 ? (
        <section className="mb-6 rounded-2xl border border-white/10 bg-gray-900/70 p-5">
          <h2 className="mb-2 text-xl font-semibold">Geçici Yükleme Önbelleği</h2>
          <p className="mb-4 text-xs text-gray-400">
            localStorage yalnız geçici UI cache’dir; denetim kaynağı sunucu geçmişidir. Başarılı kayıttan sonra temizlenir.
          </p>
          <AnnveroDataTable
            showToolbar={false}
            pageSize={15}
            exportFilename="edefter-yukleme-kayitlari.csv"
            rows={companyRecords}
            columns={[
              { key: "period", label: "Dönem", filterable: true },
              { key: "defterType", label: "Defter Türü", filterable: true },
              {
                key: "uploadedAt",
                label: "Yükleme",
                sortValue: (row) => row.uploadedAt,
                render: (row) => new Date(row.uploadedAt).toLocaleString("tr-TR"),
              },
              { key: "controlStatus", label: "Durum", filterable: true },
              { key: "errorCount", label: "Hata", sortable: true },
              { key: "warningCount", label: "Uyarı", sortable: true },
            ]}
          />
        </section>
      ) : null}

      <section className="mb-6 rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Kontrol Geçmişi</h2>
            <p className="mt-1 text-xs text-gray-400">
              Firma bazlı kalıcı özetler · motor {E_DEFTER_ENGINE_VERSION} · ham XML/ZIP saklanmaz
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshHistory()}
            disabled={!selectedCompanyId || historyLoading}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/10 disabled:opacity-50"
          >
            {historyLoading ? "Yükleniyor..." : "Yenile"}
          </button>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Dönem filtresi">
            <input
              value={historyPeriodFilter}
              onChange={(event) => setHistoryPeriodFilter(event.target.value)}
              placeholder="örn. 2026/05"
              className={inputClassName}
            />
          </Field>
          <Field label="Durum">
            <select
              value={historyStatusFilter}
              onChange={(event) => setHistoryStatusFilter(event.target.value)}
              className={inputClassName}
            >
              <option value="">Tümü</option>
              <option value="completed">completed</option>
              <option value="superseded">superseded</option>
              <option value="failed">failed</option>
            </select>
          </Field>
          <Field label="Risk">
            <select
              value={historyRiskFilter}
              onChange={(event) => setHistoryRiskFilter(event.target.value)}
              className={inputClassName}
            >
              <option value="">Tümü</option>
              <option value="kritik">Kritik</option>
              <option value="uyari">Uyarı</option>
            </select>
          </Field>
        </div>
        {!selectedCompanyId ? (
          <p className="text-sm text-gray-400">Geçmiş için firma seçin.</p>
        ) : historyRuns.length === 0 ? (
          <p className="text-sm text-gray-400">
            {historyLoading ? "Geçmiş yükleniyor..." : "Bu firma için kayıtlı kontrol yok."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-gray-400">
                <tr>
                  <th className="px-2 py-2">Dönem</th>
                  <th className="px-2 py-2">Durum</th>
                  <th className="px-2 py-2">Sonuç</th>
                  <th className="px-2 py-2">Motor</th>
                  <th className="px-2 py-2">Rev</th>
                  <th className="px-2 py-2">Kritik</th>
                  <th className="px-2 py-2">Tarih</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {historyRuns.map((run) => (
                  <tr
                    key={run.id}
                    className={`border-t border-white/5 text-gray-200 ${
                      selectedRunId === run.id ? "bg-indigo-950/40" : ""
                    }`}
                  >
                    <td className="px-2 py-2">{run.period || "-"}</td>
                    <td className="px-2 py-2">{run.status}</td>
                    <td className="px-2 py-2">
                      {run.result_summary?.overall_sonuc || "-"}
                    </td>
                    <td className="px-2 py-2">{run.engine_version}</td>
                    <td className="px-2 py-2">{run.revision}</td>
                    <td className="px-2 py-2">{run.severity_counts?.critical ?? 0}</td>
                    <td className="px-2 py-2">
                      {run.completed_at
                        ? new Date(run.completed_at).toLocaleString("tr-TR")
                        : "-"}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => handleOpenHistoryRun(run.id)}
                        className="rounded-lg border border-white/10 px-2 py-1 text-xs hover:bg-white/10"
                      >
                        Detay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedRunDetail ? (
          <div className="mt-5 rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4">
            <h3 className="mb-2 text-sm font-semibold text-indigo-100">
              Güvenli özet · {selectedRunDetail.period} · rev.{selectedRunDetail.revision}
            </h3>
            <p className="mb-3 text-xs text-gray-400">
              Mutabakat: {selectedRunDetail.reconciliation_status} · satır:{" "}
              {selectedRunDetail.row_count} · doküman: {selectedRunDetail.document_count} ·
              fingerprint: {String(selectedRunDetail.source_fingerprint || "").slice(0, 16)}…
            </p>
            <div className="mb-3 flex flex-wrap gap-2 text-xs text-gray-300">
              <span>Kritik: {selectedRunDetail.severity_counts?.critical ?? 0}</span>
              <span>Uyarı: {selectedRunDetail.severity_counts?.warning ?? 0}</span>
              <span>Teknik: {selectedRunDetail.severity_counts?.technical ?? 0}</span>
              <span>
                Sonuç: {selectedRunDetail.result_summary?.overall_sonuc || "-"}
              </span>
            </div>
            {selectedRunFindings.length ? (
              <ul className="space-y-2">
                {selectedRunFindings.map((finding) => (
                  <li
                    key={finding.id}
                    className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-100">
                          {finding.code} · {finding.severity}
                        </p>
                        <p className="mt-1 text-gray-300">{finding.summary}</p>
                        <p className="mt-1 text-gray-500">
                          ref: {finding.safe_reference || "-"} · adet:{" "}
                          {finding.occurrence_count}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            handleFindingResolution(
                              finding.id,
                              EDEFTER_FINDING_RESOLUTION.RESOLVED
                            )
                          }
                          className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-200"
                        >
                          Çözüldü
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleFindingResolution(
                              finding.id,
                              EDEFTER_FINDING_RESOLUTION.OPEN
                            )
                          }
                          className="rounded border border-white/20 px-2 py-1 text-gray-300"
                        >
                          Açık
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-gray-500">Durum: {finding.resolution_status}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">Bu koşuda kalıcı bulgu yok.</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="mb-4 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Ara..."
          className={`${inputClassName} max-w-sm`}
        />
        <select
          value={riskLevelFilter}
          onChange={(event) => setRiskLevelFilter(event.target.value)}
          className={`${inputClassName} max-w-[180px]`}
        >
          <option value="Tümü">Tüm Riskler</option>
          {Object.values(E_DEFTER_RISK_LEVEL)
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
        </select>
        <select
          value={hataTuruFilter}
          onChange={(event) => setHataTuruFilter(event.target.value)}
          className={`${inputClassName} max-w-[180px]`}
        >
          <option value="Tümü">Tüm Hata Türleri</option>
          {Object.values(E_DEFTER_HATA_TURU).map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          value={cozumFilter}
          onChange={(event) => setCozumFilter(event.target.value)}
          className={`${inputClassName} max-w-[180px]`}
        >
          <option value="Tümü">Tümü</option>
          <option value="Çözüldü">Çözüldü</option>
          <option value="Çözülmedi">Çözülmedi</option>
        </select>
      </section>

      {groupCounts.length > 0 ? (
        <section className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveGroup("")}
            className={`rounded-full px-3 py-1 text-xs ${!activeGroup ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300"}`}
          >
            Tümü
          </button>
          {groupCounts.map(({ grup, count }) => (
            <button
              key={grup}
              type="button"
              onClick={() => setActiveGroup(grup)}
              className={`rounded-full px-3 py-1 text-xs ${activeGroup === grup ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300"}`}
            >
              {grup} ({count})
            </button>
          ))}
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Kontrol Sonuçları</h2>
          {findingRows.length > detailLimit ? (
            <button
              type="button"
              onClick={() => {
                setShowAllDetails(true);
                setDetailLimit(findingRows.length);
              }}
              className="text-xs font-semibold text-indigo-300"
            >
              Tüm detayları yükle ({findingRows.length})
            </button>
          ) : null}
        </div>
        {displayedRows.length === 0 ? (
          <p className="py-8 text-center text-gray-400">
            Henüz sonuç yok. XML/ZIP veya Excel yükleyip Kontrolü Başlatın.
          </p>
        ) : (
          <div className="space-y-3">
            {displayedRows.map((row) => (
              <article key={row.id} className="rounded-xl border border-white/10 bg-gray-950/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${riskLevelBadgeClass(row.sonucSeviye || row.riskLevel)}`}>
                        {row.sonucSeviye || row.riskLevel || "-"}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${grupClass(row.grup)}`}>
                        {row.grup}
                      </span>
                      <span className="text-xs text-gray-500">{row.hataTuru}</span>
                    </div>
                    <p className="text-sm text-white">
                      {row.yevmiyeNo ? `Yevmiye ${row.yevmiyeNo}` : ""}
                      {row.fisNo ? ` · Fiş ${row.fisNo}` : ""}
                      {row.hesapKodu ? ` · ${row.hesapKodu}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-gray-300">
                      {row.aciklama || (row.issues || []).join(" ")}
                    </p>
                    {Array.isArray(row.issueDetails) && row.issueDetails.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-amber-100/90">
                        {row.issueDetails.map((issue) => (
                          <li key={`${row.id}-${issue.code}-${issue.message}`}>
                            <span className="font-semibold">{issue.code}</span>
                            {" · "}
                            {issue.message}
                            {issue.group === E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI
                              ? " · İnceleme gerekli"
                              : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="mt-2 text-sm text-indigo-200">{row.onerilenKontrol}</p>
                    {row.fisNo ? (
                      <a
                        href={buildFisKontrolDeepLink({
                          companyId: selectedCompanyId,
                          fisNo: row.fisNo,
                        })}
                        className="mt-2 inline-block text-xs font-semibold text-emerald-300 hover:underline"
                      >
                        Fiş Kontrolde aç
                      </a>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums">{formatMoney(row.tutar || row.borc || row.alacak)} TL</p>
                    <select
                      value={row.cozumDurumu || E_DEFTER_FINDING_STATUS.YENI}
                      onChange={(event) => updateRow(row.id, { cozumDurumu: event.target.value })}
                      className={`${inputClassName} mt-2 min-w-[150px] text-xs`}
                    >
                      {Object.values(E_DEFTER_FINDING_STATUS).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedId((current) => (current === row.id ? "" : row.id))}
                  className="mt-3 text-xs font-semibold text-indigo-300"
                >
                  {expandedId === row.id ? "Akıllı açıklamayı gizle" : "Akıllı açıklamayı göster"}
                </button>
                {expandedId === row.id ? (
                  <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-gray-300">
                    {row.smartExplanation}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-gray-500">{E_DEFTER_REPORT_DISCLAIMER}</p>
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

function StatCard({ label, value, tone = "default" }) {
  const toneClass =
    tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : tone === "purple" ? "text-purple-300" : "text-white";
  return (
    <div className="rounded-2xl border border-white/10 bg-gray-900/70 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${toneClass}`}>{value ?? 0}</p>
    </div>
  );
}
