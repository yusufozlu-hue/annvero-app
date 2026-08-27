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
import { createGenelMuhasebeAnalyzeGate } from "@/src/utils/genelMuhasebeKontrolEngine";
import { formatTurkishMoney } from "@/src/utils/turkishNumberFormat";

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
  const [result, setResult] = useState(null);
  const [planStatus, setPlanStatus] = useState("unknown");
  const [planAccounts, setPlanAccounts] = useState(null);
  const gateRef = useRef(createGenelMuhasebeAnalyzeGate());
  const runTokenRef = useRef(0);
  const abortRef = useRef(null);

  const invalidateActive = useCallback((reason) => {
    runTokenRef.current += 1;
    setResult(null);
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
  const findings = useMemo(() => {
    if (!result) return [];
    const fromRows = (result.rows || [])
      .filter((row) => (row.issueDetails || []).length)
      .slice(0, 80)
      .flatMap((row) =>
        (row.issueDetails || []).map((issue) => ({
          fisNo: row.fisNo || "",
          hesapKodu: row.hesapKodu || "",
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
        }))
      );
    const extras = (result.findingExtras || []).map((issue) => ({
      fisNo: "",
      hesapKodu: "",
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
    }));
    return [...extras, ...fromRows];
  }, [result]);

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
              <Stat label="Sonuç" value={summary.overallSonuc} />
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
              <Stat label="Çoklu karşıt" value={summary.cokluKarsit} />
              <Stat label="İnceleme" value={summary.incelemeGerekli} />
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
            </div>

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
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Fiş</th>
                    <th className="px-3 py-2">Hesap</th>
                    <th className="px-3 py-2">Seviye</th>
                    <th className="px-3 py-2">Kod</th>
                    <th className="px-3 py-2">Mesaj</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={5}>
                        Satır bulgusu yok (veya yalnız özet bulgular).
                      </td>
                    </tr>
                  ) : (
                    findings.map((f, idx) => (
                      <tr key={`${f.code}-${idx}`} className="border-t border-slate-100">
                        <td className="px-3 py-2">{f.fisNo || "—"}</td>
                        <td className="px-3 py-2">{f.hesapKodu || "—"}</td>
                        <td className="px-3 py-2">{f.severity}</td>
                        <td className="px-3 py-2">{f.code}</td>
                        <td className="px-3 py-2">{f.message}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
