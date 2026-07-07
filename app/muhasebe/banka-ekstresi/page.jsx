"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CompanySelectOptions from "../components/CompanySelectOptions";
import RowSearchToolbar from "../components/RowSearchToolbar";
import AccountSuggestionBadges from "../components/AccountSuggestionBadges";
import EditableStandardLucaPreviewTable from "../components/EditableStandardLucaPreviewTable";
import {
  applySuggestionToMovement,
  buildLearningMemoryAccountUpdate,
  parseSuggestionsFromWarning,
  resolveSuggestionTargetField,
} from "@/src/utils/accountPlanSuggestions";
import { useCompanyList } from "../hooks/useCompanyList";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  countCompanyRules,
  countPendingLucaRowsForCompany,
  formatDateTime,
  getAccountPlanForCompany,
  getAccountPlanUploadedAt,
  getCompanyRules,
  getCompanyRulesUpdatedAt,
  loadAccountPlansFromStorage,
  loadRuleEngineFromStorage,
  normalizeCompanyRecord,
  savePendingLucaRows,
} from "@/src/utils/companyCenter";
import { loadAccountingRulesFromStorage } from "@/src/utils/accountingRuleEngine";
import {
  buildStandardLucaTransferPayload,
  filterStandardLucaRows,
  finalizeStandardLucaRow,
  KAYNAK_TIPI,
  logStandardLucaReport,
} from "@/src/utils/standardLucaRow";
import { exportStandardLucaExcel } from "@/src/utils/exportStandardLucaExcel";
import {
  loadAccountMemoryV1Records,
  saveAccountMemoryFromEdit,
} from "@/src/utils/accountMemoryV1";
import { buildExportWarningConfirmMessage } from "@/src/utils/previewExportValidation";
import {
  buildBankStandardLucaLearningMemoryPayload,
  mapLearningMemoryRecordToItem,
} from "@/src/utils/bankLearningMemory";
import {
  fetchLearningMemoryForCompany,
  createLearningMemoryRecord,
  recordLearningMemoryUsage,
  updateLearningMemoryRecord,
} from "@/src/utils/learningMemory";
import { queueUnrecognizedTransactions } from "@/src/utils/transactionMemoryApi";
import {
  applyStandardLucaRowEditDraft,
  MEMORY_MATCH_LABEL,
} from "@/src/utils/previewRowEdit";
import { hasBankMovementError } from "@/src/utils/tableSearch";
import {
  logParserError,
  SYSTEM_ERROR_TYPES,
} from "@/src/utils/systemLogEngine";
import {
  loadDeclarationAccrualRecords,
  saveDeclarationAccrualRecords,
} from "@/src/utils/beyannameTahakkukEngine";
import { cancelActiveParseJob, runBankParserWorker } from "@/src/utils/workerParserBridge";

const BANK_PREVIEW_FILTERS = [
  { id: "all", label: "Tümü" },
  { id: "errors", label: "Hatalılar" },
  { id: "missingAccount", label: "Hesap Eksik" },
  { id: "learningMemory", label: "Öğrenen Hafıza" },
  { id: "missingDescription", label: "Açıklama Eksik" },
  { id: "missingDocumentType", label: "Belge Türü Eksik" },
];

const BANK_PARSE_STAGES = {
  READING: "Dosya okunuyor",
  PARSING: "Parser çalışıyor",
  LUCA: "Luca satırları oluşturuluyor",
  LEARNING: "Öğrenme sistemi kontrol ediliyor",
};

export default function BankaParserPage() {
  const fileInputRef = useRef(null);
  const timeoutWarningRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parserProgress, setParserProgress] = useState({
    stage: "",
    detail: "",
    timeoutWarning: false,
  });
  const [rawCount, setRawCount] = useState(0);
  const [parsedNormalizedRows, setParsedNormalizedRows] = useState([]);
  const [movementRows, setMovementRows] = useState([]);
  const [accountPlans, setAccountPlans] = useState({});
  const [ruleEngine, setRuleEngine] = useState({});
  const [learningMemory, setLearningMemory] = useState([]);
  const [accountingRules, setAccountingRules] = useState([]);
  const [declarationAccrualRecords, setDeclarationAccrualRecords] = useState([]);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewQuickFilter, setPreviewQuickFilter] = useState("all");
  const [toast, setToast] = useState(null);
  const [applyingSuggestionRowId, setApplyingSuggestionRowId] = useState(null);
  const [isSavingPreviewEdit, setIsSavingPreviewEdit] = useState(false);
  const [exportValidation, setExportValidation] = useState(null);
  const [standardLucaRows, setStandardLucaRows] = useState([]);

  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany: selectedCompanyRaw,
    refreshCompanies,
  } = useCompanyList();

  const selectedCompany = useMemo(
    () => normalizeCompanyRecord(selectedCompanyRaw),
    [selectedCompanyRaw]
  );

  const [selectedBank, setSelectedBank] = useState("GARANTI");

  const showToast = (message, type) => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const refreshCompanyData = () => {
      setAccountPlans(loadAccountPlansFromStorage());
      setRuleEngine(loadRuleEngineFromStorage());
      setAccountingRules(loadAccountingRulesFromStorage());
      setDeclarationAccrualRecords(loadDeclarationAccrualRecords());
      refreshCompanies();
    };

    refreshCompanyData();

    window.addEventListener("focus", refreshCompanyData);

    return () => {
      window.removeEventListener("focus", refreshCompanyData);
    };
  }, [refreshCompanies]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setLearningMemory([]);
      return;
    }

    fetchLearningMemoryForCompany(selectedCompanyId).then(setLearningMemory);
  }, [selectedCompanyId]);

  const companyPlans = useMemo(
    () => getAccountPlanForCompany(accountPlans, selectedCompanyId),
    [accountPlans, selectedCompanyId]
  );

  const companyRules = useMemo(
    () => getCompanyRules(ruleEngine, selectedCompanyId),
    [ruleEngine, selectedCompanyId]
  );

  const ruleCount = useMemo(
    () => countCompanyRules(ruleEngine, selectedCompanyId),
    [ruleEngine, selectedCompanyId]
  );

  const hasRules = ruleCount > 0;

  const activeBankCount = useMemo(
    () =>
      (selectedCompany?.bankAccounts || []).filter(
        (bank) => bank.isActive !== false
      ).length,
    [selectedCompany]
  );

  const activeCreditCardCount = useMemo(
    () =>
      (selectedCompany?.creditCards || []).filter(
        (card) => card.isActive !== false
      ).length,
    [selectedCompany]
  );

  const lastPlanUploadedAt = useMemo(
    () => formatDateTime(getAccountPlanUploadedAt(accountPlans, selectedCompanyId)),
    [accountPlans, selectedCompanyId]
  );

  const lastRuleUpdatedAt = useMemo(
    () => formatDateTime(getCompanyRulesUpdatedAt(ruleEngine, selectedCompanyId)),
    [ruleEngine, selectedCompanyId]
  );

  const pendingRowCount = useMemo(
    () => countPendingLucaRowsForCompany(selectedCompanyId),
    [selectedCompanyId, accountPlans, movementRows]
  );

  useEffect(() => {
    return () => {
      if (timeoutWarningRef.current) {
        clearTimeout(timeoutWarningRef.current);
      }
      cancelActiveParseJob("unmount");
    };
  }, []);

  const filteredStandardLucaRows = useMemo(
    () =>
      filterStandardLucaRows(
        standardLucaRows,
        previewSearch,
        previewQuickFilter
      ),
    [standardLucaRows, previewSearch, previewQuickFilter]
  );

  const displayedStandardLucaRows = filteredStandardLucaRows.slice(0, 100);

  const movementById = useMemo(() => {
    const map = new Map();
    movementRows.forEach((row) => map.set(row.id, row));
    return map;
  }, [movementRows]);

  const handleApplyAccountSuggestion = async (row, suggestion) => {
    const updatedRow = applySuggestionToMovement(
      row,
      suggestion,
      selectedCompany?.bankAccounts || []
    );

    setMovementRows((prev) =>
      prev.map((item) => (item.id === row.id ? updatedRow : item))
    );

    if (!row.matchedMemoryId) return;

    setApplyingSuggestionRowId(row.id);

    const targetField = resolveSuggestionTargetField(row, suggestion);
    const memoryFields = buildLearningMemoryAccountUpdate(
      row,
      targetField,
      suggestion
    );

    const ok = await updateLearningMemoryRecord(row.matchedMemoryId, memoryFields);

    setApplyingSuggestionRowId(null);

    if (ok) {
      showToast("Hafıza güncellendi", "success");
      setLearningMemory((prev) =>
        prev.map((record) =>
          record.id === row.matchedMemoryId ? { ...record, ...memoryFields } : record
        )
      );
    } else {
      showToast("Hafıza güncellenemedi", "error");
    }
  };

  const saveAdvancedPreviewEdit = async (editingRowId, draftRow) => {
    if (!editingRowId || !draftRow) return null;

    const currentRow = standardLucaRows.find((row) => row.id === editingRowId);
    if (!currentRow) return null;

    if (draftRow.saveToMemory && !selectedCompanyId) {
      alert("Hafızaya kaydetmek için önce firma seçmelisin.");
      return null;
    }

    setIsSavingPreviewEdit(true);

    try {
      const updatedRow = finalizeStandardLucaRow(
        applyStandardLucaRowEditDraft(currentRow, draftRow)
      );

      if (draftRow.saveToMemory && selectedCompanyId) {
        const memoryPayload = buildBankStandardLucaLearningMemoryPayload(
          currentRow,
          draftRow,
          selectedCompanyId
        );

        if (!memoryPayload.keyword) {
          showToast(
            "Satır güncellendi; arama anahtarı boş olduğu için hafızaya kaydedilemedi",
            "error"
          );
        } else {
          const created = await createLearningMemoryRecord(memoryPayload);

          if (created) {
            mapLearningMemoryRecordToItem(created, draftRow, currentRow);
            setLearningMemory((prev) => [created, ...prev]);
            showToast("Satır güncellendi ve hafızaya kaydedildi", "success");
          } else {
            showToast("Satır güncellendi, hafıza kaydı oluşturulamadı", "error");
          }
        }
      } else {
        showToast("Satır güncellendi", "success");
      }

      setExportValidation(null);
      return updatedRow;
    } finally {
      setIsSavingPreviewEdit(false);
    }
  };

  const handleAccountMemorySave = (row) => {
    if (!selectedCompanyId) return;

    saveAccountMemoryFromEdit(row, {
      firmaId: selectedCompanyId,
      kaynakAdi: selectedBank,
    });
  };

  const exportExcel = (ignoreWarnings = false) => {
    const bankPrefix = `${String(selectedBank || "banka").toLowerCase()}_luca`;
    const result = exportStandardLucaExcel(standardLucaRows, {
      filePrefix: bankPrefix,
      logLabel: "banka-export",
      onValidationFail: setExportValidation,
      ignoreWarnings,
    });

    if (!result.ok) {
      if (result.reason === "warnings" && result.needsConfirm) {
        const confirmed = window.confirm(
          buildExportWarningConfirmMessage(result.validation)
        );

        if (confirmed) {
          exportExcel(true);
        }

        return;
      }

      if (result.reason === "validation") {
        showToast(
          result.validation?.hasCriticalDuplicates
            ? "Excel oluşturulamadı. Kritik mükerrer kayıtları düzeltin."
            : "Excel oluşturulamadı. Satır hatalarını düzeltin.",
          "error"
        );
      } else {
        showToast(result.message || "Önce dosyayı yükleyip ön izleme oluşturun.", "error");
      }
      return;
    }

    setExportValidation(null);
    showToast(
      result.fileCount > 1
        ? `${result.fileCount} adet Luca Excel dosyası oluşturuldu.`
        : "Luca Excel dosyası oluşturuldu.",
      "success"
    );
  };

  const handleGoToLucaProducer = (event) => {
    if (!movementRows.length || !standardLucaRows.length) {
      event.preventDefault();
      alert("Önce dosyayı yükleyip ön izleme oluşturun.");
      return;
    }

    if (!selectedCompanyId) {
      event.preventDefault();
      alert("Luca Fiş Üretici'ye geçmek için önce firma seçmelisin.");
      return;
    }

    savePendingLucaRows(
      buildStandardLucaTransferPayload({
        firmaId: selectedCompanyId,
        companyName: getCompanyDisplayName(selectedCompany),
        kaynakTipi: KAYNAK_TIPI.BANKA,
        kaynakAdi: selectedBank,
        rows: standardLucaRows,
      })
    );

    logStandardLucaReport("banka-transfer", standardLucaRows);
  };

  const markAppliedDeclarationsPaid = (declarationSummary) => {
    const ids = declarationSummary?.appliedDeclarationIds || [];
    const lateFeeIds = declarationSummary?.lateFeeDeclarationIds || [];
    const underpaidIds = declarationSummary?.underpaidDeclarationIds || [];
    if (!ids.length && !underpaidIds.length) return;

    const nextRecords = loadDeclarationAccrualRecords().map((record) =>
      ids.includes(record.id) || underpaidIds.includes(record.id)
        ? {
            ...record,
            isPaid: ids.includes(record.id) ? true : record.isPaid,
            lateFeeDetected: record.lateFeeDetected || lateFeeIds.includes(record.id),
            underpaidWarning: record.underpaidWarning || underpaidIds.includes(record.id),
            updatedAt: new Date().toISOString(),
          }
        : record
    );

    saveDeclarationAccrualRecords(nextRecords);
    setDeclarationAccrualRecords(nextRecords);
  };

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const clearPreviewState = () => {
    setRawCount(0);
    setParsedNormalizedRows([]);
    setMovementRows([]);
    setStandardLucaRows([]);
    setExportValidation(null);
  };

  /** Dosya seçimi: yalnızca state; parse başlamaz */
  const handleFileSelect = (event) => {
    const file = event.target.files?.[0] || null;

    if (!file) {
      setSelectedFile(null);
      setFileName("");
      resetFileInput();
      return;
    }

    setSelectedFile(file);
    setFileName(file.name);
    clearPreviewState();
    resetFileInput();
  };

  const queueUnrecognizedFromWorker = async (unrecognizedItems = []) => {
    if (!unrecognizedItems.length) return 0;

    try {
      const result = await queueUnrecognizedTransactions(unrecognizedItems);
      return Number(result?.inserted || 0);
    } catch (error) {
      console.error("[banka-ekstresi] unrecognized queue failed", error);
      return 0;
    }
  };

  const parseFileInWorker = async (file) => {
    const arrayBuffer = await file.arrayBuffer();

    return runBankParserWorker({
      workerUrl: new URL("./bankParser.worker.js", import.meta.url),
      arrayBuffer,
      context: {
        selectedBank,
        selectedCompany,
        companyPlans,
        companyRules,
        learningMemory,
        accountMemoryRecords: loadAccountMemoryV1Records(),
        accountingRules,
        declarationAccrualRecords,
        selectedCompanyId,
      },
      timeoutMs: 120_000,
      onProgress: (message) => {
        setParserProgress((current) => ({
          ...current,
          stage: message.stage || current.stage,
          detail: message.detail || "",
        }));
      },
    });
  };

  /** Excel okuma + parser pipeline yalnızca Ön İzleme Oluştur ile worker'da çalışır */
  const handleCreatePreview = async () => {
    if (isParsing) return;

    if (!selectedCompanyId) {
      showToast("Önce firma seçmelisin.", "error");
      return;
    }

    if (!selectedFile) {
      showToast("Önce banka ekstresi dosyası seçmelisin.", "error");
      return;
    }

    setIsParsing(true);
    setParserProgress({
      stage: BANK_PARSE_STAGES.READING,
      detail: "Worker hazırlanıyor",
      timeoutWarning: false,
    });

    timeoutWarningRef.current = setTimeout(() => {
      setParserProgress((current) => ({
        ...current,
        timeoutWarning: true,
      }));
    }, 20000);

    try {
      const result = await parseFileInWorker(selectedFile);

      setRawCount(result.rawCount || 0);
      setParsedNormalizedRows(result.normalizedRows || []);
      setMovementRows(result.movementRows || []);
      setStandardLucaRows(result.standardLucaRows || []);
      markAppliedDeclarationsPaid(result.declarationSummary);

      await recordLearningMemoryUsage(result.standardLucaRows || []);
      const queuedCount = await queueUnrecognizedFromWorker(result.unrecognizedItems || []);

      showToast(
        queuedCount > 0
          ? `${(result.normalizedRows || []).length} işlem satırı ön izlemeye alındı. ${queuedCount} tanınmayan işlem Öğrenme Merkezi'ne eklendi.`
          : `${(result.normalizedRows || []).length} işlem satırı ön izlemeye alındı.`,
        "success"
      );
    } catch (error) {
      console.error("[banka-ekstresi] preview failed", error);
      logParserError(
        error?.message || "Banka ekstresi parse hatası",
        { stack: error?.stack, bank: selectedBank },
        selectedCompanyId,
        {
          fileName: selectedFile?.name || "",
          companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
          errorType: parserProgress.timeoutWarning
            ? SYSTEM_ERROR_TYPES.TIMEOUT
            : SYSTEM_ERROR_TYPES.CORRUPT_EXCEL,
          module: "Banka Parser",
        }
      );
      clearPreviewState();
      showToast(
        error?.message ||
          "Dosya okunamadı. Excel'de açıp .xlsx olarak kaydedip tekrar deneyin.",
        "error"
      );
    } finally {
      if (timeoutWarningRef.current) {
        clearTimeout(timeoutWarningRef.current);
        timeoutWarningRef.current = null;
      }
      setIsParsing(false);
      setParserProgress((current) => ({
        ...current,
        stage: "",
        detail: "",
      }));
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur-sm ${
            toast.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/95 text-emerald-100"
              : "border-red-500/40 bg-red-950/95 text-red-100"
          }`}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              toast.type === "success" ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          {toast.message}
        </div>
      )}
      <div className="mb-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">Banka Parser Merkezi</h1>
          <p className="mt-2 text-sm text-gray-400">
            Tanınmayan işlemler otomatik olarak{" "}
            <Link
              href="/muhasebe/islem-hafizasi"
              className="font-semibold text-indigo-300 hover:text-indigo-200"
            >
              İşlem Hafızası / Öğrenme Merkezi
            </Link>
            &apos;ne düşer.
          </p>
        </div>
      </div>

      <div className="grid max-w-7xl gap-6">
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-2xl font-semibold">Firma ve Banka Ekstresi</h2>

          <label className="mb-2 block text-sm text-gray-400">Firma Seç</label>

          <select
            value={selectedCompanyId}
            disabled={isParsing}
            onChange={(e) => {
              setSelectedCompanyId(e.target.value);
              setMovementRows([]);
              setStandardLucaRows([]);
            }}
            className="mb-6 min-w-[320px] rounded-xl border border-gray-700 bg-gray-950 p-3 text-white disabled:opacity-60"
          >
            <CompanySelectOptions companies={companies} />
          </select>

          {selectedCompany && (
            <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-950/60 p-5">
              <div className="mb-4 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                <h3 className="text-base font-semibold text-gray-100">
                  Seçili Firma Kontrol Özeti
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <ControlStat
                  label="Firma"
                  value={getCompanyDisplayName(selectedCompany)}
                  clamp
                  wide
                />
                <ControlStat
                  label="Banka Hesabı"
                  value={activeBankCount}
                  status={activeBankCount > 0 ? "ready" : "missing"}
                />
                <ControlStat
                  label="Kredi Kartı"
                  value={activeCreditCardCount}
                  status={activeCreditCardCount > 0 ? "ready" : "missing"}
                />
                <ControlStat
                  label="Hesap Planı"
                  value={companyPlans.length > 0 ? "Hazır" : "Eksik"}
                  status={companyPlans.length > 0 ? "ready" : "missing"}
                />
                <ControlStat
                  label="Kural Durumu"
                  value={hasRules ? "Hazır" : "Eksik"}
                  status={hasRules ? "ready" : "missing"}
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <ControlStat
                  label="Son Hesap Planı Yükleme"
                  value={lastPlanUploadedAt || "Kayıt yok"}
                  secondary
                />
                <ControlStat
                  label="Son Kural Güncelleme"
                  value={lastRuleUpdatedAt || "Kayıt yok"}
                  secondary
                />
                <ControlStat
                  label="Bekleyen Luca Satırı"
                  value={pendingRowCount}
                  badge={pendingRowCount > 0 ? "warning" : "ok"}
                />
              </div>

              <p className="mt-4 text-xs text-gray-500">
                Banka ekstresi işleme öncesi firma yapılandırma kontrolü
              </p>
            </div>
          )}

          <label className="mb-2 block text-sm text-gray-400">Banka Seç</label>

          <select
            value={selectedBank}
            disabled={isParsing}
            onChange={(e) => {
              setSelectedBank(e.target.value);
              setSelectedFile(null);
              setFileName("");
              clearPreviewState();
              resetFileInput();
            }}
            className="mb-6 min-w-[320px] rounded-xl border border-gray-700 bg-gray-950 p-3 text-white disabled:opacity-60"
          >
            <option value="GARANTI">Garanti Bankası</option>
            <option value="VAKIFBANK">Vakıfbank</option>
            <option value="TEB">TEB</option>
            <option value="KUVEYT">Kuveyt Türk</option>
            <option value="ZIRAAT">Ziraat Bankası</option>
          </select>

          <p className="mb-6 text-gray-400">
            Banka ekstresi Excel dosyasını seçin. Okuma ve parse işlemi yalnızca{" "}
            <span className="font-semibold text-gray-300">Ön İzleme Oluştur</span>{" "}
            ile başlar.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <label
              className={`cursor-pointer rounded-lg bg-blue-600 px-5 py-2 font-medium hover:bg-blue-700 ${
                isParsing ? "pointer-events-none opacity-60" : ""
              }`}
            >
              Dosya Seç
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                disabled={isParsing}
                className="hidden"
              />
            </label>

            <span className="text-sm text-gray-300">
              {fileName ? (
                <>
                  Seçili dosya:{" "}
                  <span className="font-semibold text-white">{fileName}</span>
                </>
              ) : (
                <span className="text-gray-400">Henüz dosya seçilmedi</span>
              )}
            </span>
          </div>

          {isParsing ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-4 rounded-xl border border-indigo-500/30 bg-indigo-950/40 px-4 py-3 text-sm text-indigo-100"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-300" />
                <span className="font-semibold">
                  {parserProgress.stage || BANK_PARSE_STAGES.READING}
                </span>
                {parserProgress.detail ? (
                  <span className="text-indigo-200/80">{parserProgress.detail}</span>
                ) : null}
              </div>
              {parserProgress.timeoutWarning ? (
                <p className="mt-2 text-xs text-amber-200">
                  İşlem 20 saniyeyi geçti. Büyük dosya arka planda işlenmeye devam
                  ediyor; sayfayı kullanabilirsiniz.
                </p>
              ) : (
                <p className="mt-2 text-xs text-indigo-200/70">
                  Excel okuma, parser, Luca satırları ve öğrenme kontrolü Web Worker
                  içinde çalışıyor.
                </p>
              )}
            </div>
          ) : null}

          {rawCount > 0 && !isParsing ? (
            <p className="mt-4 text-sm text-green-400">
              Ham dosyadan {rawCount} satır okundu.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            onClick={handleCreatePreview}
            disabled={isParsing || !selectedFile}
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isParsing ? parserProgress.stage || "İşleniyor…" : "Ön İzleme Oluştur"}
          </button>

          <button
            type="button"
            onClick={exportExcel}
            disabled={isParsing}
            className="rounded-xl bg-green-600 px-6 py-3 font-semibold hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Luca Excel Oluştur
          </button>

          <Link
            href="/muhasebe/luca-donusturucu"
            onClick={handleGoToLucaProducer}
            className="rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-200 hover:bg-gray-800"
          >
            Luca Fiş Üretici →
          </Link>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-6 text-2xl font-semibold">StandardLucaRow Ön İzleme</h2>

          {standardLucaRows.length === 0 ? (
            <p className="text-gray-400">Henüz StandardLucaRow oluşturulmadı.</p>
          ) : (
            <>
              <RowSearchToolbar
                search={previewSearch}
                onSearchChange={setPreviewSearch}
                placeholder="Fiş no, hesap, açıklama, belge türü veya tutar ara..."
                filters={BANK_PREVIEW_FILTERS}
                activeFilter={previewQuickFilter}
                onFilterChange={setPreviewQuickFilter}
                shownCount={filteredStandardLucaRows.length}
                totalCount={standardLucaRows.length}
              />

              <EditableStandardLucaPreviewTable
                rows={standardLucaRows}
                onRowsChange={(nextRows) => {
                  setStandardLucaRows(nextRows);
                  setExportValidation(null);
                }}
                displayedRows={displayedStandardLucaRows}
                exportValidation={exportValidation}
                createRowContext={{
                  firmaId: selectedCompanyId,
                  kaynakTipi: KAYNAK_TIPI.BANKA,
                  kaynakAdi: selectedBank,
                  belgeTuru: "DK",
                }}
                onSaveAdvancedEdit={saveAdvancedPreviewEdit}
                onAccountFieldChange={handleAccountMemorySave}
                isSavingAdvancedEdit={isSavingPreviewEdit}
                renderKontrolCell={(row) => {
                  const movement = row._movementId
                    ? movementById.get(row._movementId)
                    : null;

                  return (
                    <div className={getMovementWarningClass(row.kontrolNotu)}>
                      <div>{row.kontrolNotu || "—"}</div>
                      {movement ? (
                        <AccountSuggestionBadges
                          suggestions={
                            movement.accountSuggestions?.length
                              ? movement.accountSuggestions
                              : parseSuggestionsFromWarning(movement.warning)
                          }
                          disabled={applyingSuggestionRowId === movement.id}
                          onSelect={(suggestion) =>
                            handleApplyAccountSuggestion(movement, suggestion)
                          }
                        />
                      ) : null}
                    </div>
                  );
                }}
              />

              <p className="mt-4 text-sm text-gray-400">
                Toplam {standardLucaRows.length} StandardLucaRow satırı oluşturuldu.
                {filteredStandardLucaRows.length !== standardLucaRows.length ||
                displayedStandardLucaRows.length !== filteredStandardLucaRows.length
                  ? ` Görünen ${displayedStandardLucaRows.length}/${filteredStandardLucaRows.length} satır.`
                  : ""}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function getMovementWarningClass(warning) {
  if (!warning) return "";

  if (hasBankMovementError({ warning })) {
    return "bg-red-900/50 font-medium text-red-200";
  }

  if (warning.includes("Önerilen hesap uygulandı")) {
    return "bg-sky-900/50 font-medium text-sky-200";
  }

  if (warning.includes("Cari hesap eşleşti")) {
    return "bg-teal-900/50 font-medium text-teal-200";
  }

  if (
    warning.includes(MEMORY_MATCH_LABEL) ||
    warning.includes("Öğrenen hafızadan eşleşti")
  ) {
    return "bg-emerald-900/50 font-medium text-emerald-200";
  }

  return "";
}

function InfoStat({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-gray-100">
        {value}
      </div>
    </div>
  );
}

function ControlStat({
  label,
  value,
  status,
  badge,
  secondary = false,
  truncate = false,
  clamp = false,
  wide = false,
}) {
  const statusStyles = {
    ready: "border-emerald-800/60 bg-emerald-950/40",
    missing: "border-red-800/60 bg-red-950/40",
  };

  const valueStyles = {
    ready: "text-emerald-300",
    missing: "text-red-300",
  };

  const cardClass = status
    ? statusStyles[status]
    : "border-gray-800 bg-gray-900/60";

  const wideClass = wide ? "sm:col-span-2 lg:col-span-2" : "";

  let valueClass = "text-white";

  if (status) valueClass = valueStyles[status];
  if (secondary) valueClass = "text-slate-100";

  const labelClass =
    "text-xs font-semibold uppercase tracking-normal text-slate-200";

  if (badge) {
    const badgeStyles = {
      ok: "bg-emerald-900/50 text-emerald-300 border border-emerald-800/60",
      warning: "bg-yellow-900/40 text-yellow-300 border border-yellow-700/60",
    };

    return (
      <div
        className={`flex h-full min-w-0 flex-col rounded-xl border p-5 ${cardClass} ${wideClass}`}
      >
        <div className={labelClass}>{label}</div>
        <div className="mt-3 flex flex-1 items-end">
          <span
            className={`inline-flex items-center rounded-lg px-4 py-1.5 text-xl font-bold ${badgeStyles[badge]}`}
          >
            {value}
          </span>
        </div>
      </div>
    );
  }

  const valueSizeClass = secondary
    ? "text-lg tracking-tight"
    : clamp
    ? "text-xl"
    : "text-2xl";

  return (
    <div
      className={`flex h-full min-w-0 flex-col rounded-xl border p-5 ${cardClass} ${wideClass}`}
    >
      <div className={labelClass}>{label}</div>
      <div
        className={`mt-3 flex flex-1 items-end font-bold leading-snug ${valueSizeClass} ${valueClass}`}
      >
        <span
          className={
            clamp
              ? "line-clamp-2 break-words"
              : truncate
              ? "truncate"
              : ""
          }
          title={truncate || clamp ? String(value) : undefined}
        >
          {value}
        </span>
      </div>
    </div>
  );
}
