"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AnnveroModuleNav from "@/app/components/AnnveroModuleNav";
import { useCompanyList } from "../hooks/useCompanyList";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { fetchFullActiveAccountPlan } from "@/src/utils/accountPlanApi";
import { PARSER_WORKER_URLS } from "@/src/utils/parserWorkerUrls";
import { cancelActiveParseJob } from "@/src/utils/workerParserBridge";
import {
  EXCEL_READ_STAGE,
  readExcelSheetRowsFromFile,
} from "@/src/utils/readExcelSheetWithWorkerFallback";
import {
  bumpAnalyzeGeneration,
  isAnalyzeJobInFlight,
  runEDefterAnalyzeJob,
} from "@/src/utils/eDefterAnalyzeBridge";
import {
  accountCodeFromPlanRow,
  EDEFTER_ANALYZE_JOB_KIND,
} from "@/src/utils/eDefterAnalyzeContract";
import { createGenelMuhasebeAnalyzeGate, buildAccountPlanCodeSet } from "@/src/utils/genelMuhasebeKontrolEngine";
import {
  buildVisibleGenelMuhasebeFindingsRows,
  presentationRowRenderKey,
  summarizeGenelMuhasebeFindingsWithCorrections,
} from "@/src/utils/genelMuhasebeFindingsView";
import { formatTurkishMoney } from "@/src/utils/turkishNumberFormat";
import {
  closeMultiCounterpartGroup,
  createMultiCounterpartUiState,
  openMultiCounterpartGroup,
} from "@/src/utils/multiCounterpartUi";
import CorrectionVoucherPanel from "./CorrectionVoucherPanel";
import CorrectionAppliedModal from "./CorrectionAppliedModal";
import MultiCounterpartDetailModal from "./MultiCounterpartDetailModal";
import { isCorrectionEligibleFinding } from "@/src/utils/correctionVoucher";
import {
  CORRECTION_RECORD_STATUS,
  canOpenApplyForCorrectionRecord,
  indexCorrectionRecordsByFingerprint,
  mergeCorrectionRecordIntoList,
  resolveCorrectionRecordForFinding,
} from "@/src/utils/correctionRecords";

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function planEvidenceLabel(summary) {
  if (!summary) return "—";
  if (summary.planEvidence === "PRESENT" || summary.planStatus === "loaded") {
    return "Yüklü";
  }
  return "Hesap planı yüklenemedi";
}

function yevmiyeEvidenceLabel(summary) {
  if (!summary) return "—";
  if (summary.yevmiyeEvidence === "PRESENT") return "Yüklü";
  return "Yüklenmedi";
}

function muavinYevmiyeLabel(summary) {
  const my = summary?.muavinYevmiye;
  if (!my) return "—";
  if (my.userLabel) return my.userLabel;
  if (my.status === "EVIDENCE_MISSING") return "Karşılaştırılamadı";
  if (my.matched) {
    const n = my.denominator || my.yevmiyeMovements || 0;
    return `Tam eşleşti (${n}/${n})`;
  }
  if (my.status === "MISMATCH") {
    return `${my.matchedCount || 0}/${my.denominator || 0} eşleşti`;
  }
  return "—";
}

function mizanMuavinLabel(summary) {
  const mm = summary?.mizanMuavin;
  if (!mm) return "—";
  if (mm.userLabel) return mm.userLabel;
  if (mm.status === "EVIDENCE_MISSING") {
    return "Mizan yüklenmedi";
  }
  if (mm.matched) return "Mutabık";
  if (mm.status === "MISMATCH") return "Fark var";
  return "—";
}

const LEDGER_FILE_INPUT_CLASS =
  "block w-full cursor-pointer rounded-lg border-2 border-teal-500 bg-teal-50/50 px-3 py-2 text-sm text-slate-800 shadow-sm transition hover:border-teal-600 hover:bg-teal-50 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500/50 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-teal-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-teal-800 focus:file:ring-2 focus:file:ring-teal-600";

function safeUserError(err) {
  const code = err?.code || "";
  if (code === "ANALYZE_IN_FLIGHT") return "Kontrol zaten çalışıyor.";
  if (code === "ANALYZE_CANCELLED" || code === "ANALYZE_STALE") {
    return "Kontrol iptal edildi veya geçersiz kılındı.";
  }
  if (typeof console !== "undefined" && code) {
    console.debug("[genel-muhasebe-kontrol]", code, err?.message || "");
  }
  if (
    code === "EXCEL_READ_FAILED" ||
    code === EXCEL_READ_STAGE.WORKER_LOAD ||
    code === EXCEL_READ_STAGE.WORKER_PARSE ||
    code === EXCEL_READ_STAGE.FALLBACK_PARSE
  ) {
    return "Excel dosyası okunamadı.";
  }
  if (code === "UNSUPPORTED_MUAVIN_LAYOUT") return "Desteklenmeyen muavin düzeni.";
  if (code === "UNSUPPORTED_YEVMIYE_LAYOUT") return "Desteklenmeyen yevmiye düzeni.";
  if (code === "EMPTY_YEVMIYE_PARSE") return "Yevmiye dosyasından hareket okunamadı.";
  if (code === "MUAVIN_YEVMIYE_RECONCILE_FAILED") {
    return "Muavin↔yevmiye farkı üretilemedi; kontrol güvenli şekilde durdu.";
  }
  if (code === "ANALYZE_WORKER_FAILED") return "Analiz worker başarısız oldu.";
  if (code === "ANALYZE_TIMEOUT") return "Analiz zaman aşımına uğradı.";
  return "Kontrol çalıştırılamadı. Lütfen tekrar deneyin.";
}

async function readSheetRows(file) {
  // Vercel/Turbopack preview: excelSheet.worker is media-copied without bundling
  // its @/ imports → WORKER_ONERROR. Prefer main-thread XLSX (same as bank Excel).
  return readExcelSheetRowsFromFile(file, {
    workerUrl: null,
    mode: "rows",
  });
}

export default function GenelMuhasebeKontrolPage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
  } = useCompanyList();

  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [muavinFile, setMuavinFile] = useState(null);
  const [yevmiyeFile, setYevmiyeFile] = useState(null);
  const [mizanFile, setMizanFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progressDetail, setProgressDetail] = useState("");
  const [error, setError] = useState("");
  const [perfWarning, setPerfWarning] = useState("");
  const [showMuavinYevmiyeDiffs, setShowMuavinYevmiyeDiffs] = useState(false);
  const [fisFilter, setFisFilter] = useState("");
  const [expandedTechnicalIds, setExpandedTechnicalIds] = useState(() => new Set());
  const [multiCounterpartUi, setMultiCounterpartUi] = useState(() =>
    createMultiCounterpartUiState(null)
  );
  const [result, setResult] = useState(null);
  const [planStatus, setPlanStatus] = useState("unknown");
  const [planAccounts, setPlanAccounts] = useState(null);
  const [correctionFinding, setCorrectionFinding] = useState(null);
  const [correctionPanelKey, setCorrectionPanelKey] = useState(0);
  const [correctionRecords, setCorrectionRecords] = useState([]);
  const [applyRecord, setApplyRecord] = useState(null);
  const [correctionNotice, setCorrectionNotice] = useState("");
  const [showDuzeltildiOnly, setShowDuzeltildiOnly] = useState(false);
  const gateRef = useRef(createGenelMuhasebeAnalyzeGate());
  const runTokenRef = useRef(0);
  const abortRef = useRef(null);

  const invalidateActive = useCallback((reason) => {
    runTokenRef.current += 1;
    setResult(null);
    setExpandedTechnicalIds(new Set());
    setMultiCounterpartUi(createMultiCounterpartUiState(null));
    setPerfWarning("");
    setProgressDetail("");
    bumpAnalyzeGeneration(reason);
    try {
      abortRef.current?.abort();
    } catch {
      /* ignore */
    }
    abortRef.current = null;
  }, []);

  const handleCompanyChange = useCallback(
    (nextId) => {
      setSelectedCompanyId(nextId);
      setError("");
      setPlanAccounts(null);
      setPlanStatus("unknown");
      invalidateActive("gm-company-change");
    },
    [setSelectedCompanyId, invalidateActive]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadPlan() {
      if (!selectedCompanyId) {
        setPlanAccounts(null);
        setPlanStatus("missing");
        return;
      }
      try {
        const plan = await fetchFullActiveAccountPlan(selectedCompanyId);
        if (cancelled) return;
        const accounts = Array.isArray(plan.accounts) ? plan.accounts : [];
        // Payload kanıtı: yalnız normalize edilebilir hesap kodu varsa “yüklü”.
        const withCodes = accounts.filter((account) => accountCodeFromPlanRow(account));
        setPlanAccounts(withCodes);
        setPlanStatus(withCodes.length ? "loaded" : "missing");
      } catch {
        if (cancelled) return;
        setPlanAccounts([]);
        setPlanStatus("missing");
      }
    }
    loadPlan();
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId]);

  useEffect(() => {
    let cancelled = false;
    async function loadCorrectionRecords() {
      if (!selectedCompanyId) {
        setCorrectionRecords([]);
        return;
      }
      try {
        const response = await fetch(
          `/api/accounting-correction-records?companyId=${encodeURIComponent(selectedCompanyId)}`
        );
        const payload = await response.json();
        if (cancelled) return;
        setCorrectionRecords(Array.isArray(payload.records) ? payload.records : []);
      } catch {
        if (!cancelled) setCorrectionRecords([]);
      }
    }
    loadCorrectionRecords();
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId]);

  useEffect(() => {
    return () => {
      invalidateActive("gm-unmount");
      try {
        cancelActiveParseJob("gm-unmount");
      } catch {
        /* ignore */
      }
    };
  }, [invalidateActive]);

  const canStart = Boolean(
    selectedCompanyId && (muavinFile || yevmiyeFile || mizanFile) && !busy
  );

  const handleAnalyze = useCallback(async () => {
    if (busy || isAnalyzeJobInFlight()) return;
    const gate = gateRef.current.begin();
    if (!gate.accepted) return;

    const token = ++runTokenRef.current;
    const generation = bumpAnalyzeGeneration("gm-analyze-start");
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError("");
    setPerfWarning("");
    setProgressDetail("Dosyalar okunuyor…");

    try {
      const [muavinSheetRows, yevmiyeSheetRows, mizanSheetRows] = await Promise.all([
        muavinFile ? readSheetRows(muavinFile) : Promise.resolve(null),
        yevmiyeFile ? readSheetRows(yevmiyeFile) : Promise.resolve(null),
        mizanFile ? readSheetRows(mizanFile) : Promise.resolve(null),
      ]);
      if (token !== runTokenRef.current || controller.signal.aborted) return;

      setProgressDetail("Kontrol ediliyor…");
      const analysis = await runEDefterAnalyzeJob(
        {
          jobKind: EDEFTER_ANALYZE_JOB_KIND.GENERAL_LEDGER_CONTROL,
          companyId: selectedCompanyId,
          period,
          muavinSheetRows,
          yevmiyeSheetRows,
          mizanSheetRows,
          accountPlanAccounts: planAccounts,
          accountPlanStatus: planStatus === "loaded" ? "loaded" : "missing",
        },
        {
          workerUrl: PARSER_WORKER_URLS.eDefterAnalyze,
          preferWorker: true,
          requireExclusive: true,
          signal: controller.signal,
          generation,
          timeoutMs: 300_000,
          onProgress: (progress) => {
            setProgressDetail(
              progress?.detail || progress?.stage || "Kontrol ediliyor…"
            );
          },
        }
      );

      if (token !== runTokenRef.current) return;
      if (analysis?.diagnostics?.generation != null && analysis.diagnostics.generation !== generation) {
        return;
      }

      setResult(analysis);
      if (analysis?.diagnostics?.fallback === 1 || analysis?.diagnostics?.performanceWarning) {
        setPerfWarning(
          analysis.diagnostics.performanceWarning ||
            "Analiz worker yedeğe düştü; büyük dosyada tarayıcı yavaşlayabilir."
        );
      }
    } catch (err) {
      if (token !== runTokenRef.current) return;
      if (err?.code === "ANALYZE_STALE" || err?.code === "ANALYZE_CANCELLED") return;
      setError(safeUserError(err));
      setResult(null);
    } finally {
      gateRef.current.end();
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setProgressDetail("");
    }
  }, [
    busy,
    muavinFile,
    yevmiyeFile,
    mizanFile,
    selectedCompanyId,
    period,
    planAccounts,
    planStatus,
  ]);

  const summary = result?.summary;
  const displayPlanStatus =
    summary?.planEvidence === "PRESENT" || summary?.planStatus === "loaded"
      ? "loaded"
      : summary
        ? "missing"
        : planStatus;
  const trimmedFisFilter = fisFilter.trim();
  const findingsCatalog = result?.findingsCatalog;
  const ledgerRows = result?.rows || [];

  // Tek final liste: özet sayaç + <tbody> yalnız visibleRows.
  const visibleRows = useMemo(
    () =>
      buildVisibleGenelMuhasebeFindingsRows({
        findingsCatalog,
        fisFilter: trimmedFisFilter,
        correctionRecords,
        ledgerRows,
        showDuzeltildiOnly,
      }),
    [findingsCatalog, trimmedFisFilter, correctionRecords, showDuzeltildiOnly, ledgerRows]
  );

  const findingsWithCorrections = useMemo(() => {
    if (!findingsCatalog?.length) return null;
    return summarizeGenelMuhasebeFindingsWithCorrections(
      findingsCatalog,
      correctionRecords
    );
  }, [findingsCatalog, correctionRecords]);

  const recordsByFingerprint = useMemo(
    () => indexCorrectionRecordsByFingerprint(correctionRecords),
    [correctionRecords]
  );

  useEffect(() => {
    setExpandedTechnicalIds(new Set());
    setMultiCounterpartUi(createMultiCounterpartUiState(null));
  }, [trimmedFisFilter, findingsCatalog]);

  const findingsCatalogSize = findingsCatalog?.length || 0;
  const visibleRowsCount = visibleRows.length;
  const visibleGroupedMultiCount = visibleRows.filter((item) => item.kind === "group").length;
  const multiDetailGroup = multiCounterpartUi.multiDetailGroup;
  const findingsTableBodyKey = `findings-body|${trimmedFisFilter}|${showDuzeltildiOnly ? "1" : "0"}|${visibleRowsCount}`;

  const openMultiCounterpartDetail = useCallback(
    (group, event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      setMultiCounterpartUi((prev) => openMultiCounterpartGroup(prev, group, ledgerRows));
    },
    [ledgerRows]
  );

  const closeMultiCounterpartDetail = useCallback(() => {
    setMultiCounterpartUi((prev) => closeMultiCounterpartGroup(prev));
  }, []);

  const toggleTechnicalDetails = useCallback((rowId) => {
    setExpandedTechnicalIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const renderTechnicalDetails = (row, rowKey) => {
    const open = expandedTechnicalIds.has(rowKey);
    if (!row?.code) return null;
    return (
      <div className="mt-1">
        <button
          type="button"
          className="text-xs text-slate-500 hover:underline"
          onClick={() => toggleTechnicalDetails(rowKey)}
        >
          {open ? "Teknik ayrıntıları gizle" : "Teknik ayrıntılar"}
        </button>
        {open ? (
          <div className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600">
            Kod: {row.code}
          </div>
        ) : null}
      </div>
    );
  };

  const muavinYevmiyeDiffs = summary?.muavinYevmiye?.differences || [];
  const muavinYevmiyeDiffPreview = muavinYevmiyeDiffs.slice(0, 50);

  const accountPlanCodes = useMemo(
    () => (planAccounts?.length ? buildAccountPlanCodeSet(planAccounts) : null),
    [planAccounts]
  );
  const companyAccountingRules = selectedCompany?.accountingRules || {};
  const companySlug = String(selectedCompany?.companyName || "FIRMA")
    .replace(/\s+/g, "_")
    .slice(0, 24);

  const renderCorrectionAction = (item) => {
    const linked =
      item.correctionRecord ||
      resolveCorrectionRecordForFinding(item, recordsByFingerprint);

    if (linked?.status === CORRECTION_RECORD_STATUS.APPLIED) {
      return (
        <div className="mt-2 space-y-1 text-sm">
          <p className="text-emerald-800">{item.correctionStatusMessage || linked.externalVoucherNo}</p>
          <button
            type="button"
            className="text-teal-700 hover:underline"
            onClick={() => setApplyRecord(linked)}
          >
            Düzeltme kaydını görüntüle
          </button>
        </div>
      );
    }

    if (canOpenApplyForCorrectionRecord(linked)) {
      return (
        <div className="mt-2 space-y-1 text-sm">
          <p className="text-teal-800">{item.correctionStatusMessage}</p>
          <button
            type="button"
            className="font-medium text-teal-700 hover:underline"
            onClick={() => setApplyRecord(linked)}
          >
            Luca&apos;da işlendi olarak işaretle
          </button>
          <button
            type="button"
            className="ml-3 text-teal-700 hover:underline"
            onClick={() => {
              setCorrectionFinding(item);
              setCorrectionPanelKey((value) => value + 1);
            }}
          >
            Dosyayı yeniden indir
          </button>
        </div>
      );
    }

    if (!isCorrectionEligibleFinding(item, ledgerRows)) return null;
    return (
      <button
        type="button"
        className="mt-2 block text-sm font-medium text-teal-700 hover:underline"
        onClick={() => {
          setCorrectionFinding(item);
          setCorrectionPanelKey((value) => value + 1);
        }}
      >
        Düzeltme fişi hazırla
      </button>
    );
  };

  const refreshCorrectionRecords = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const response = await fetch(
        `/api/accounting-correction-records?companyId=${encodeURIComponent(selectedCompanyId)}`
      );
      const payload = await response.json();
      setCorrectionRecords(Array.isArray(payload.records) ? payload.records : []);
    } catch {
      /* ignore */
    }
  }, [selectedCompanyId]);

  const handleExportRecorded = useCallback(
    (record) => {
      if (record?.id) {
        setCorrectionRecords((prev) => mergeCorrectionRecordIntoList(prev, record));
        setCorrectionNotice("");
      }
      refreshCorrectionRecords();
    },
    [refreshCorrectionRecords]
  );

  const handleStaleApplyRecord = useCallback(
    (message) => {
      setApplyRecord(null);
      setCorrectionNotice(message || "");
      refreshCorrectionRecords();
    },
    [refreshCorrectionRecords]
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <Link href="/muhasebe" className="text-sm text-teal-700 hover:underline">
              ← Muhasebe
            </Link>
            <h1 className="mt-1 text-2xl font-semibold">Genel Muhasebe Kontrol</h1>
            <p className="text-sm text-slate-600">
              Firma → dönem → Excel → tek analiz (worker). Karşıt hesap ortak motorla; yerel kontrol
              (DB yazımı yok).
            </p>
            {correctionNotice ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {correctionNotice}
              </div>
            ) : null}
          </div>
          <AnnveroModuleNav tone="light" />
        </div>

        <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Firma</span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={selectedCompanyId}
              onChange={(e) => handleCompanyChange(e.target.value)}
            >
              <option value="">Firma seçin</option>
              <CompanySelectOptions companies={companies} />
            </select>
            {selectedCompany ? (
              <span className="mt-1 block text-xs text-slate-500">Aktif firma seçildi</span>
            ) : null}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Dönem (YYYY/AA)</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                invalidateActive("gm-period-change");
              }}
              placeholder="2026/05"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Muavin Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className={LEDGER_FILE_INPUT_CLASS}
              onChange={(e) => {
                setMuavinFile(e.target.files?.[0] || null);
                invalidateActive("gm-file-change");
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Yevmiye Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className={LEDGER_FILE_INPUT_CLASS}
              onChange={(e) => {
                setYevmiyeFile(e.target.files?.[0] || null);
                invalidateActive("gm-file-change");
              }}
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block text-slate-600">Mizan Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className={LEDGER_FILE_INPUT_CLASS}
              onChange={(e) => {
                setMizanFile(e.target.files?.[0] || null);
                invalidateActive("gm-file-change");
              }}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canStart}
            onClick={handleAnalyze}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? "Kontrol ediliyor…" : "Kontrolü Başlat"}
          </button>
          <span className="text-xs text-slate-500">
            Hesap planı: {displayPlanStatus === "loaded" ? "yüklü" : "eksik / inceleme"} · Persist:
            yerel yok
            {busy && progressDetail ? ` · ${progressDetail}` : ""}
          </span>
        </div>

        {error ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {perfWarning ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {perfWarning}
          </div>
        ) : null}

        {summary ? (
          <div className="mt-6 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Sonuç"
                value={findingsWithCorrections?.overallSonuc ?? summary.overallSonuc}
              />
              <Stat label="Toplam fiş" value={summary.toplamFis} />
              <Stat
                label="Hareket"
                value={summary.hareketSatir ?? summary.toplamSatir}
              />
              <Stat label="Sistem bilgisi" value={summary.sistemBilgisi ?? 0} />
              <Stat
                label="Dengeli / Dengesiz"
                value={`${summary.dengeliFis} / ${summary.dengesizFis}`}
              />
              <Stat label="Kesin karşıt" value={summary.kesinKarsit} />
              <Stat label="Bileşik satır" value={summary.cokluKarsit} />
              <Stat label="İnceleme" value={findingsWithCorrections?.incelemeGerekli ?? summary.incelemeGerekli} />
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm hover:border-teal-400"
                onClick={() => setShowDuzeltildiOnly((value) => !value)}
              >
                <div className="text-xs text-slate-500">
                  Düzeltildi{showDuzeltildiOnly ? " (filtre açık)" : ""}
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {findingsWithCorrections?.duzeltildi ?? 0}
                </div>
              </button>
              <Stat label="Hesap planda yok" value={summary.hesapPlandaYok} />
              <Stat label="Dönem dışı" value={summary.donemDisi} />
              <Stat label="Mükerrer" value={summary.mukerrer} />
              <Stat
                label="Borç / Alacak"
                value={`${formatTurkishMoney(summary.borcToplam)} / ${formatTurkishMoney(summary.alacakToplam)}`}
              />
              <Stat label="Fark" value={formatTurkishMoney(summary.borcAlacakFark)} />
              <Stat label="Muavin↔Mizan" value={mizanMuavinLabel(summary)} />
              <Stat label="Plan kanıtı" value={planEvidenceLabel(summary)} />
              {summary.yevmiyeEvidence === "PRESENT" ? (
                <>
                  <Stat
                    label="Yevmiye hareketi"
                    value={summary.yevmiyeHareketSatir ?? 0}
                  />
                  <Stat label="Yevmiye fişi" value={summary.yevmiyeFis ?? 0} />
                  <Stat label="Yevmiye kanıtı" value={yevmiyeEvidenceLabel(summary)} />
                </>
              ) : null}
              {summary.muavinHareketSatir > 0 && summary.yevmiyeEvidence === "PRESENT" ? (
                <Stat label="Muavin↔Yevmiye" value={muavinYevmiyeLabel(summary)} />
              ) : null}
            </div>

            {summary.muavinHareketSatir > 0 && summary.yevmiyeEvidence === "PRESENT" ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <div className="font-medium text-slate-900">Muavin↔Yevmiye özeti</div>
                <div className="mt-2 grid gap-1 sm:grid-cols-3">
                  <div>
                    Eşleşen: {summary.muavinYevmiye?.matchedCount ?? 0} /{" "}
                    {summary.muavinYevmiye?.denominator ?? 0}
                  </div>
                  <div>Yalnız muavinde: {summary.muavinYevmiye?.counts?.onlyMuavin ?? 0}</div>
                  <div>Yalnız yevmiyede: {summary.muavinYevmiye?.counts?.onlyYevmiye ?? 0}</div>
                </div>
                {muavinYevmiyeDiffs.length ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="text-teal-700 hover:underline"
                      onClick={() => setShowMuavinYevmiyeDiffs((v) => !v)}
                    >
                      {showMuavinYevmiyeDiffs ? "Farkları gizle" : "Farkları göster"}
                      {` (${muavinYevmiyeDiffs.length})`}
                    </button>
                    {showMuavinYevmiyeDiffs ? (
                      <div className="mt-2 overflow-auto rounded-lg border border-slate-200">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-600">
                            <tr>
                              <th className="px-2 py-1">Durum</th>
                              <th className="px-2 py-1">Fiş</th>
                              <th className="px-2 py-1">Tarih</th>
                              <th className="px-2 py-1">Hesap</th>
                              <th className="px-2 py-1">Muavin B/A</th>
                              <th className="px-2 py-1">Yevmiye B/A</th>
                            </tr>
                          </thead>
                          <tbody>
                            {muavinYevmiyeDiffPreview.map((diff, idx) => (
                              <tr key={`my-diff-${idx}`} className="border-t border-slate-100">
                                <td className="px-2 py-1">{diff.statusLabel}</td>
                                <td className="px-2 py-1">{diff.fisNo || "—"}</td>
                                <td className="px-2 py-1">{diff.tarih || "—"}</td>
                                <td className="px-2 py-1">{diff.hesapKodu || "—"}</td>
                                <td className="px-2 py-1">
                                  {diff.muavin
                                    ? `${formatTurkishMoney(diff.muavin.borc)} / ${formatTurkishMoney(diff.muavin.alacak)}`
                                    : "—"}
                                </td>
                                <td className="px-2 py-1">
                                  {diff.yevmiye
                                    ? `${formatTurkishMoney(diff.yevmiye.borc)} / ${formatTurkishMoney(diff.yevmiye.alacak)}`
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {muavinYevmiyeDiffs.length > 50 ? (
                          <p className="px-2 py-2 text-slate-500">
                            İlk 50 fark gösteriliyor · toplam {muavinYevmiyeDiffs.length}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {summary.mizanMuavin?.message ? (
              <p className="text-sm text-slate-600">{summary.mizanMuavin.message}</p>
            ) : null}

            <p className="text-xs text-slate-500">
              Yerel kontrol ·{" "}
              {result?.diagnostics?.execution === "worker"
                ? "analyze worker"
                : result?.diagnostics?.execution || "analiz"}{" "}
              · persist yok
            </p>

            <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Sonuç tablosu</span>
                  <span className="ml-2 text-slate-500">
                    {summary.toplamFis} fiş işlendi · {findingsCatalogSize} bulgu
                    {trimmedFisFilter
                      ? ` · ${visibleRowsCount} sonuç gösteriliyor · ${visibleGroupedMultiCount} bileşik fiş özeti`
                      : ` · ${visibleGroupedMultiCount} bileşik fiş özeti`}
                  </span>
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-slate-500">Fiş no filtre</span>
                  <input
                    className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    value={fisFilter}
                    onChange={(e) => setFisFilter(e.target.value)}
                    placeholder=""
                    aria-label="Fiş no filtre"
                    data-testid="genel-muhasebe-fis-filter"
                  />
                </label>
              </div>
              <table
                className="min-w-full text-left text-sm"
                data-testid="genel-muhasebe-findings-table"
              >
                <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Fiş</th>
                    <th className="px-3 py-2">Tarih</th>
                    <th className="px-3 py-2">Hesap</th>
                    <th className="px-3 py-2">Seviye</th>
                    <th className="px-3 py-2">Durum</th>
                    <th className="px-3 py-2">Açıklama</th>
                  </tr>
                </thead>
                <tbody key={findingsTableBodyKey} data-testid="genel-muhasebe-findings-tbody">
                  {visibleRowsCount === 0 ? (
                    <tr data-testid="genel-muhasebe-findings-empty">
                      <td className="px-3 py-3 text-slate-500" colSpan={6}>
                        {trimmedFisFilter
                          ? `Fiş ${trimmedFisFilter} için sonuç bulunamadı.`
                          : "Satır bulgusu yok (veya yalnız özet bulgular)."}
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((item, index) => {
                      const rowKey = presentationRowRenderKey(item, index);
                      if (item.kind === "group") {
                        // Sözleşme: MULTI grupta inline alt satır yok — yalnız modal.
                        return (
                          <tr
                            key={rowKey}
                            className="border-t border-slate-100 bg-slate-50/60"
                            data-testid="genel-muhasebe-finding-row"
                            data-fis-no={item.fisNo || ""}
                            data-row-kind="group"
                          >
                            <td className="px-3 py-2" data-testid="genel-muhasebe-finding-fis">
                              {item.fisNo || "—"}
                            </td>
                            <td className="px-3 py-2">{item.tarih || "—"}</td>
                            <td className="px-3 py-2">—</td>
                            <td className="px-3 py-2">{item.severity}</td>
                            <td className="px-3 py-2 font-medium text-slate-900">
                              {item.displayTitle || item.titleTr}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                data-testid="multi-counterpart-detail-open"
                                aria-haspopup="dialog"
                                aria-expanded={Boolean(
                                  multiDetailGroup && multiDetailGroup.id === item.id
                                )}
                                className="text-left text-teal-700 hover:underline"
                                onClick={(event) => openMultiCounterpartDetail(item, event)}
                              >
                                {item.displayMessage || item.messageTr || item.message}
                                {" (ayrıntı)"}
                              </button>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr
                          key={rowKey}
                          className="border-t border-slate-100"
                          data-testid="genel-muhasebe-finding-row"
                          data-fis-no={item.fisNo || ""}
                          data-row-kind="single"
                        >
                          <td className="px-3 py-2" data-testid="genel-muhasebe-finding-fis">
                            {item.fisNo || "—"}
                          </td>
                          <td className="px-3 py-2">{item.tarih || "—"}</td>
                          <td className="px-3 py-2">{item.hesapKodu || "—"}</td>
                          <td className="px-3 py-2">{item.severity}</td>
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {item.displayTitle || item.titleTr}
                          </td>
                          <td className="px-3 py-2">
                            {item.displayMessage || item.messageTr || item.message}
                            {renderTechnicalDetails(item, rowKey)}
                            {renderCorrectionAction(item)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <MultiCounterpartDetailModal
          open={Boolean(multiDetailGroup)}
          onClose={closeMultiCounterpartDetail}
          group={multiDetailGroup}
        />

        <CorrectionVoucherPanel
          key={`correction-panel-${correctionPanelKey}`}
          open={Boolean(correctionFinding)}
          onClose={() => setCorrectionFinding(null)}
          finding={correctionFinding}
          ledgerRows={ledgerRows}
          planAccounts={planAccounts || []}
          companyId={selectedCompanyId}
          companySlug={companySlug}
          companyAccountingRules={companyAccountingRules}
          accountPlanCodes={accountPlanCodes}
          existingRecord={
            correctionFinding
              ? resolveCorrectionRecordForFinding(correctionFinding, recordsByFingerprint)
              : null
          }
          onExportRecorded={handleExportRecorded}
        />
        <CorrectionAppliedModal
          open={Boolean(applyRecord)}
          onClose={() => setApplyRecord(null)}
          record={applyRecord}
          companyAccountingRules={companyAccountingRules}
          onStaleRecord={handleStaleApplyRecord}
          onApplied={(record) => {
            if (record?.id) {
              setCorrectionRecords((prev) => mergeCorrectionRecordIntoList(prev, record));
            }
            refreshCorrectionRecords();
            setApplyRecord(record?.status === CORRECTION_RECORD_STATUS.APPLIED ? null : record);
          }}
        />
      </div>
    </div>
  );
}
