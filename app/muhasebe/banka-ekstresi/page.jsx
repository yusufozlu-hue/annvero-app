"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CompanySelectOptions from "../components/CompanySelectOptions";
import RowSearchToolbar from "../components/RowSearchToolbar";
import AccountSuggestionBadges from "../components/AccountSuggestionBadges";
import EditableStandardLucaPreviewTable from "../components/EditableStandardLucaPreviewTable";
import PreviewErrorBoundary from "../components/PreviewErrorBoundary";
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
  SYSTEM_ERROR_TYPES,
} from "@/src/utils/systemLogEngine";
import {
  loadDeclarationAccrualRecords,
  saveDeclarationAccrualRecords,
} from "@/src/utils/beyannameTahakkukEngine";
import ParserJobProgress from "@/src/components/ParserJobProgress";
import { useParserJob } from "@/src/hooks/useParserJob";
import { logParserJobError } from "@/src/utils/parserJobLogger";
import { saveBankCardOpsSession } from "@/src/utils/bankCardOpsCenter";
import { buildBankCardOpsSideOutput } from "@/src/utils/bankCardOpsSideOutput";
import { detectSourceFileType } from "@/src/utils/financialSourceArchitecture";
import { buildBankParserResultFromNormalizedRowsAsync } from "@/src/utils/bankParserCore";
import { isAnnveroCoreEnabled } from "@/src/config/annveroCoreFlags";
import { DEFAULT_CORE_PREVIEW_LIMIT } from "@/src/utils/bankCoreBridge";
import { computeCoreIntegrationSummary, mergeCoreDecisionIntoMovement, shouldShowCoreTeachButton, isCoreAlreadyRecognized, shouldOpenCoreTeachModal } from "@/src/utils/bankCorePreview";
import CorePreviewTable from "./CorePreviewTable";
import KnowledgeTeachModal from "./KnowledgeTeachModal";
import { buildTeachFormFromMovement } from "@/src/utils/knowledgeBuilderForm";
import { saveKnowledgeTeachRequest } from "@/src/utils/knowledgeBuilderClient";
import { useUserRole } from "@/src/hooks/useUserRole";
import { parseBankExcelOnMainThread } from "@/src/utils/bankExcelMainThreadParse";
// Worker geçici olarak kapalı — bankParser.worker.js dosyası duruyor, çağrılmıyor.
// import { runBankParserWorker } from "@/src/utils/workerParserBridge";

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

const PREVIEW_PAGE_SIZE = 100;

function slimMovementForUi(movement = {}) {
  return {
    id: movement.id,
    description: movement.description || movement.lucaDescription || "",
    accountSuggestions: Array.isArray(movement.accountSuggestions)
      ? movement.accountSuggestions
      : [],
    warning: movement.warning || "",
    matchedMemoryId: movement.matchedMemoryId || null,
    accountCode: movement.accountCode || "",
    counterAccountCode: movement.counterAccountCode || "",
    documentType: movement.documentType || "",
    coreMatched: Boolean(movement._coreMatched),
    coreFallback: Boolean(movement._coreFallback),
    coreSkipped: Boolean(movement._coreSkipped),
    coreDebug: movement._coreDebug || "",
    coreDecisionSource: movement._coreDecisionSource || "",
    corePreview: movement.corePreview || null,
    _coreMatched: movement._coreMatched,
    _coreFallback: movement._coreFallback,
    _coreSkipped: movement._coreSkipped,
    _coreStatus: movement._coreStatus,
    _coreConfidence: movement._coreConfidence,
    _coreRiskLevel: movement._coreRiskLevel,
    _coreDecisionSource: movement._coreDecisionSource,
  };
}

function computePreviewSummary(lucaRows = [], opsDashboard = null) {
  const metrics = opsDashboard?.metrics;
  if (metrics) {
    return {
      totalMovements: metrics.total || Math.ceil((lucaRows.length || 0) / 2),
      lucaRows: lucaRows.length,
      recognized: metrics.recognized || 0,
      unknown: metrics.unknown || 0,
      risky: metrics.risky || 0,
      suggested: metrics.suggested || 0,
    };
  }

  let recognized = 0;
  let unknown = 0;
  let risky = 0;
  for (const row of lucaRows) {
    const warning = String(row?.kontrolNotu || row?.uyari || row?.warning || "");
    const hesap = String(row?.hesapKodu || "").trim();
    if (!hesap || warning.includes("Hesap eşleşmesi") || warning.includes("Kural bulunamadı")) {
      unknown += 1;
    } else if (warning.includes("risk") || row?.riskDurumu) {
      risky += 1;
    } else {
      recognized += 1;
    }
  }

  return {
    totalMovements: Math.ceil((lucaRows.length || 0) / 2),
    lucaRows: lucaRows.length,
    recognized,
    unknown,
    risky,
    suggested: 0,
  };
}

export default function BankaParserPage() {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [rawCount, setRawCount] = useState(0);
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
  const [parseModeDebug, setParseModeDebug] = useState("");
  const [previewErrorDetail, setPreviewErrorDetail] = useState("");
  const [previewLimit, setPreviewLimit] = useState(PREVIEW_PAGE_SIZE);
  const [previewSummary, setPreviewSummary] = useState(null);
  const [normalizedRowsCache, setNormalizedRowsCache] = useState([]);
  const [fullMovementRows, setFullMovementRows] = useState([]);
  const [coreIntegrationSummary, setCoreIntegrationSummary] = useState(null);
  const [coreRowsProcessed, setCoreRowsProcessed] = useState(0);
  const [isApplyingCoreAll, setIsApplyingCoreAll] = useState(false);
  const [teachMovement, setTeachMovement] = useState(null);
  const [teachFormDefaults, setTeachFormDefaults] = useState(null);
  const [isTeachModalOpen, setIsTeachModalOpen] = useState(false);
  const [isSavingTeach, setIsSavingTeach] = useState(false);

  const { isManagementUser } = useUserRole();

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

  const parserJob = useParserJob({
    logMeta: {
      module: "Banka Parser",
      companyId: selectedCompanyId,
      companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
      fileName,
    },
  });

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
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const filteredStandardLucaRows = useMemo(
    () =>
      filterStandardLucaRows(
        standardLucaRows,
        previewSearch,
        previewQuickFilter
      ),
    [standardLucaRows, previewSearch, previewQuickFilter]
  );

  const displayedStandardLucaRows = useMemo(
    () => filteredStandardLucaRows.slice(0, previewLimit),
    [filteredStandardLucaRows, previewLimit]
  );

  const canShowMore = displayedStandardLucaRows.length < filteredStandardLucaRows.length;

  const movementById = useMemo(() => {
    const map = new Map();
    movementRows.forEach((row) => map.set(row.id, row));
    return map;
  }, [movementRows]);

  const fullMovementById = useMemo(() => {
    const map = new Map();
    const source = fullMovementRows.length ? fullMovementRows : movementRows;
    source.forEach((row) => map.set(row.id, row));
    return map;
  }, [fullMovementRows, movementRows]);

  useEffect(() => {
    setPreviewLimit(PREVIEW_PAGE_SIZE);
  }, [previewSearch, previewQuickFilter]);

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
    const allRows = standardLucaRows || [];
    if (!allRows.length) {
      showToast("Önce dosyayı yükleyip ön izleme oluşturun.", "error");
      return;
    }

    const readyRows = allRows.filter((row) => {
      const hesap = String(row?.hesapKodu || "").trim();
      const karsi = String(row?.karsiHesapKodu || "").trim();
      const warning = String(row?.uyari || row?.warning || "");
      if (!hesap) return false;
      if (warning.includes("Hesap eşleşmesi bulunamadı")) return false;
      if (row?.riskDurumu === "HESAP_EKSIK") return false;
      // Çift satırlı fişlerde karşı hesap boş olabilir (banka satırı); en az banka hesabı olsun
      return Boolean(hesap || karsi);
    });

    const unknownCount = allRows.length - readyRows.length;
    if (unknownCount > 0 && !ignoreWarnings) {
      const confirmed = window.confirm(
        `${unknownCount} satır hesap eşleşmesi olmadığı için Excel’e alınmayacak.\n` +
          `${readyRows.length} fişe hazır satır dışa aktarılsın mı?`
      );
      if (!confirmed) return;
      if (!readyRows.length) {
        showToast("Fişe hazır satır yok. Önce hesap eşleşmelerini tamamlayın.", "error");
        return;
      }
    }

    const rowsToExport = readyRows.length ? readyRows : allRows;
    const bankPrefix = `${String(selectedBank || "banka").toLowerCase()}_luca`;
    const result = exportStandardLucaExcel(rowsToExport, {
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
        : unknownCount > 0
          ? `Luca Excel oluşturuldu (${readyRows.length} hazır / ${unknownCount} atlandı).`
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
    setMovementRows([]);
    setStandardLucaRows([]);
    setExportValidation(null);
    setPreviewErrorDetail("");
    setPreviewLimit(PREVIEW_PAGE_SIZE);
    setPreviewSummary(null);
    setNormalizedRowsCache([]);
    setFullMovementRows([]);
    setCoreIntegrationSummary(null);
    setCoreRowsProcessed(0);
  };

  const buildPipelineOptions = (normalizedRows, coreRowLimit) => ({
    normalizedRows,
    selectedBank,
    selectedCompany,
    companyPlans,
    companyRules,
    learningMemory,
    accountMemoryRecords: loadAccountMemoryV1Records(),
    accountingRules,
    declarationAccrualRecords,
    selectedCompanyId,
    sourceFileName: selectedFile?.name || "",
    sourceFileType: detectSourceFileType(
      selectedFile?.name || "",
      selectedFile?.type || ""
    ),
    sourceType: "bank",
    coreRowLimit,
  });

  const applyPipelineResult = (mainResult, pipelineResult, coreRowLimit) => {
    const result = buildBankCardOpsSideOutput(
      {
        ...pipelineResult,
        rawCount: mainResult.rawCount || 0,
      },
      {
        selectedBank,
        selectedCompanyId,
        sourceFileName: selectedFile?.name || "",
        sourceFileType: detectSourceFileType(
          selectedFile?.name || "",
          selectedFile?.type || ""
        ),
        sourceType: "bank",
        learningMemory,
        accountingRules,
        companyRules,
      }
    );

    const lucaRows = result.standardLucaRows || [];
    const movements = result.movementRows || [];
    const slimMovements = movements.map(slimMovementForUi);
    const summary = computePreviewSummary(lucaRows, result.opsDashboard);
    const coreSummary = computeCoreIntegrationSummary(movements);
    const coreMeta = pipelineResult?.opsMeta?.coreSummary;

    setRawCount(result.rawCount || mainResult.rawCount || 0);
    setPreviewSummary(summary);
    setPreviewLimit(PREVIEW_PAGE_SIZE);
    setMovementRows(slimMovements);
    setFullMovementRows(movements);
    setCoreIntegrationSummary(coreSummary);
    setCoreRowsProcessed(coreMeta?.coreLimit ?? coreRowLimit ?? DEFAULT_CORE_PREVIEW_LIMIT);
    setStandardLucaRows(lucaRows);
    markAppliedDeclarationsPaid(result.declarationSummary);

    if (coreMeta?.enabled) {
      setParseModeDebug(
        `ANNVERO CORE — ${coreMeta.core} CORE / ${coreMeta.fallback} legacy (${coreMeta.coreLimit}/${coreMeta.total} satır)`
      );
    }

    return { result, summary, lucaRows, movements, coreMeta };
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

  const parseFileOnMainThread = async (file) => {
    return parseBankExcelOnMainThread(file, selectedBank, (message) => {
      parserJob.onProgress(message);
    });
  };

  /** Geçici: worker kapalı — Excel/parse ana thread'de */
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
    setPreviewErrorDetail("");
    setPreviewLimit(PREVIEW_PAGE_SIZE);
    setPreviewSummary(null);
    setParseModeDebug(
      isAnnveroCoreEnabled()
        ? "ANNVERO CORE aktif — karar motoru server-side"
        : "Worker bypass — ana thread fallback parse"
    );
    parserJob.begin({
      stage: BANK_PARSE_STAGES.READING,
      detail: "Ana thread fallback — dosya okunuyor",
    });

    try {
      const mainResult = await parseFileOnMainThread(selectedFile);
      setNormalizedRowsCache(mainResult.normalizedRows || []);

      parserJob.onProgress({
        stage: BANK_PARSE_STAGES.LUCA,
        detail: "Luca satırları oluşturuluyor (ana thread)",
      });

      // Büyük dosyalarda UI'nın nefes alması için yield
      await new Promise((r) => setTimeout(r, 0));

      const coreRowLimit = isAnnveroCoreEnabled() ? DEFAULT_CORE_PREVIEW_LIMIT : undefined;
      const pipelineResult = await buildBankParserResultFromNormalizedRowsAsync(
        buildPipelineOptions(mainResult.normalizedRows || [], coreRowLimit)
      );

      if (pipelineResult?.opsMeta?.coreSummary) {
        console.info("[banka-ekstresi] ANNVERO CORE özeti", pipelineResult.opsMeta.coreSummary);
      }

      await new Promise((r) => setTimeout(r, 0));

      const { result, summary, lucaRows } = applyPipelineResult(
        mainResult,
        pipelineResult,
        coreRowLimit
      );

      // Loading'i state commit'ten ÖNCE kapat — progress takılı kalmasın
      setIsParsing(false);
      parserJob.markSuccess(`${summary.totalMovements || lucaRows.length} hareket hazır`);

      if (!isAnnveroCoreEnabled()) {
        setParseModeDebug(
          `Worker bypass · ana thread · ${selectedBank} · ${summary.totalMovements} hareket · gösterilen ${PREVIEW_PAGE_SIZE}`
        );
      }

      // Ops session: tüm işlemleri tut (export/ops merkezi) ama UI'ya basma
      if (Array.isArray(result.financialTransactions)) {
        try {
          saveBankCardOpsSession({
            company_id: selectedCompanyId,
            bank_name: selectedBank,
            source_file_name: selectedFile?.name || "",
            transactions: result.financialTransactions,
            dashboard: result.opsDashboard,
            declarationSummary: result.declarationSummary,
          });
        } catch (sessionError) {
          console.error("[banka-ekstresi] ops session save failed", sessionError);
        }
      }

      // Ağır yan işler — UI render'ını engellemesin
      setTimeout(() => {
        recordLearningMemoryUsage(lucaRows).catch((err) =>
          console.error("[banka-ekstresi] learning usage failed", err)
        );
        queueUnrecognizedFromWorker(result.unrecognizedItems || [])
          .then((queuedCount) => {
            showToast(
              queuedCount > 0
                ? `${summary.totalMovements} hareket ön izlemeye alındı. ${queuedCount} tanınmayan işlem kuyruğa eklendi.`
                : `${summary.totalMovements} hareket ön izlemeye alındı (ekranda ilk ${PREVIEW_PAGE_SIZE} satır).`,
              "success"
            );
          })
          .catch((err) => {
            console.error("[banka-ekstresi] unrecognized queue failed", err);
            showToast(
              `${summary.totalMovements} hareket ön izlemeye alındı (ekranda ilk ${PREVIEW_PAGE_SIZE} satır).`,
              "success"
            );
          });
      }, 0);
    } catch (error) {
      console.error("[banka-ekstresi] preview failed (main-thread)", error);
      const detail =
        error?.userMessage ||
        error?.message ||
        "Dosya okunamadı. Excel'de açıp .xlsx olarak kaydedip tekrar deneyin.";
      setPreviewErrorDetail(detail);
      setParseModeDebug("Worker bypass — ana thread fallback (hata)");
      logParserJobError(error, {
        module: "Banka Parser",
        companyId: selectedCompanyId,
        companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
        fileName: selectedFile?.name || "",
        errorType: SYSTEM_ERROR_TYPES.CORRUPT_EXCEL,
        source: "parser-main-thread",
        jobType: "bank-excel-main-thread",
      });
      parserJob.markError(error);
      clearPreviewState();
      showToast(detail, "error");
    } finally {
      setIsParsing(false);
    }
  };

  const handleApplyCoreToAllRows = async () => {
    if (!isAnnveroCoreEnabled() || !normalizedRowsCache.length || isApplyingCoreAll) return;

    setIsApplyingCoreAll(true);
    parserJob.begin({
      stage: "ANNVERO CORE",
      detail: `Tüm satırlara CORE uygulanıyor (${normalizedRowsCache.length})`,
    });

    try {
      const pipelineResult = await buildBankParserResultFromNormalizedRowsAsync(
        buildPipelineOptions(normalizedRowsCache, Infinity)
      );

      const { summary, lucaRows } = applyPipelineResult(
        { rawCount: rawCount || normalizedRowsCache.length },
        pipelineResult,
        normalizedRowsCache.length
      );

      parserJob.markSuccess(`CORE ${summary.totalMovements || lucaRows.length} satırda tamamlandı`);
      showToast(
        `CORE tüm ${summary.totalMovements || fullMovementRows.length} harekete uygulandı.`,
        "success"
      );
    } catch (error) {
      console.error("[banka-ekstresi] CORE apply-all failed", error);
      showToast(error?.message || "CORE tüm satırlara uygulanamadı.", "error");
      parserJob.markError(error);
    } finally {
      setIsApplyingCoreAll(false);
    }
  };

  const corePreviewMovements = fullMovementRows.length ? fullMovementRows : movementRows;
  const hasMoreCoreRows =
    isAnnveroCoreEnabled() &&
    coreIntegrationSummary?.notRun > 0 &&
    normalizedRowsCache.length > 0;

  const requestCoreTeach = (movement, row = {}) => {
    if (!selectedCompanyId || !movement) return;

    if (isCoreAlreadyRecognized(movement, row)) {
      showToast("Bu işlem CORE tarafından zaten tanındı.", "success");
      return;
    }

    if (!shouldOpenCoreTeachModal(movement, row)) {
      showToast("Bu işlem CORE tarafından zaten tanındı.", "success");
      return;
    }

    setTeachMovement(movement);
    setTeachFormDefaults(
      buildTeachFormFromMovement(movement, {
        selectedCompanyId,
        companyName: getCompanyDisplayName(selectedCompany),
        selectedBank,
        sourceType: "bank",
      })
    );
    setIsTeachModalOpen(true);
  };

  const handleOpenTeachModal = (movement) => {
    requestCoreTeach(movement, {});
  };

  const handleOpenTeachFromLucaRow = (row) => {
    const movement = row?._movementId ? fullMovementById.get(row._movementId) : null;
    if (movement) {
      requestCoreTeach(movement, row);
      return;
    }

    requestCoreTeach(
      {
        id: row?._movementId || row?.id,
        description: row?.aciklama || row?.fisAciklama || "",
        counterAccountCode: row?.karsiHesapKodu || "",
        documentType: row?.belgeTuru || "",
        bankName: selectedBank,
        rawRow: {
          aciklama: row?.aciklama || row?.fisAciklama || "",
          belgeTuru: row?.belgeTuru || "",
          banka: selectedBank,
        },
      },
      row
    );
  };

  const coreTeachOptions = {
    isManagementUser,
    isCoreEnabled: isAnnveroCoreEnabled(),
  };

  const showCoreTeachForMovement = (movement, row = {}) =>
    shouldShowCoreTeachButton(row, movement, coreTeachOptions);

  const showCoreTeachForLucaRow = (row) =>
    showCoreTeachForMovement(
      row?._movementId ? fullMovementById.get(row._movementId) : null,
      row
    );

  const handleCloseTeachModal = () => {
    if (isSavingTeach) return;
    setIsTeachModalOpen(false);
    setTeachMovement(null);
    setTeachFormDefaults(null);
  };

  const handleSaveKnowledgeTeach = async (form) => {
    if (!teachMovement || !selectedCompanyId) return;

    setIsSavingTeach(true);
    try {
      const result = await saveKnowledgeTeachRequest({
        teach: {
          ...form,
          company_id: selectedCompanyId,
        },
        movement: teachMovement,
        movementContext: {
          selected_bank: selectedBank,
          sourceType: "bank",
        },
      });

      const updatedMovement = mergeCoreDecisionIntoMovement(
        teachMovement,
        result?.core_decision || null
      );

      const applyMovementUpdate = (rows = []) =>
        rows.map((row) => (row.id === teachMovement.id ? updatedMovement : row));

      setFullMovementRows((prev) => {
        const next = applyMovementUpdate(prev);
        setCoreIntegrationSummary(computeCoreIntegrationSummary(next));
        return next;
      });
      setMovementRows((prev) => applyMovementUpdate(prev).map(slimMovementForUi));

      const saveMeta = result?.save || {};
      const recognizedAfterTeach = isCoreAlreadyRecognized(updatedMovement, {});

      showToast(
        recognizedAfterTeach
          ? "CORE öğretme kaydı tamamlandı — işlem artık company_memory ile tanınıyor."
          : saveMeta.warning
            ? `Kaydedildi (${saveMeta.action}). ${saveMeta.warning}`
            : `CORE öğretme kaydı tamamlandı (${saveMeta.action || "CREATE"}).`,
        "success"
      );
      handleCloseTeachModal();
    } catch (error) {
      console.error("[banka-ekstresi] knowledge teach failed", error);
      showToast(error?.message || "CORE öğretme kaydı başarısız.", "error");
    } finally {
      setIsSavingTeach(false);
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

          <ParserJobProgress
            visible={isParsing || parserJob.isDone || parserJob.isError}
            stage={parserJob.stage}
            detail={parserJob.detail}
            percent={parserJob.percent}
            timeoutWarning={parserJob.timeoutWarning}
            status={parserJob.status}
            error={parserJob.error}
            onCancel={isParsing ? () => parserJob.cancel("user") : undefined}
            className="mt-4"
          />

          {parseModeDebug ? (
            <p className="mt-2 text-[11px] text-amber-300/90">
              Debug: {parseModeDebug}
            </p>
          ) : null}

          {previewErrorDetail ? (
            <p className="mt-2 rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {previewErrorDetail}
            </p>
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
            {isParsing ? parserJob.stage || "İşleniyor…" : "Ön İzleme Oluştur"}
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

        {isAnnveroCoreEnabled() && corePreviewMovements.length > 0 ? (
          <div className="rounded-2xl border border-indigo-900/50 bg-gray-900 p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold">ANNVERO CORE Entegrasyon Önizleme</h2>
                <p className="mt-1 text-sm text-gray-400">
                  İlk {coreRowsProcessed} satırda CORE kararı çalıştırıldı.
                  {hasMoreCoreRows ? " Kalan satırlar legacy mapping ile işlendi." : ""}
                </p>
              </div>
              {hasMoreCoreRows ? (
                <button
                  type="button"
                  onClick={handleApplyCoreToAllRows}
                  disabled={isApplyingCoreAll || isParsing}
                  className="rounded-lg border border-indigo-600 bg-indigo-950 px-4 py-2 text-sm font-semibold text-indigo-100 hover:bg-indigo-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isApplyingCoreAll ? "CORE uygulanıyor…" : "Tüm satırlara CORE uygula"}
                </button>
              ) : null}
            </div>

            {coreIntegrationSummary ? (
              <div className="mb-4 grid grid-cols-2 gap-2 text-xs text-gray-300 sm:grid-cols-3 lg:grid-cols-6">
                <CoreSummaryCard label="Toplam hareket" value={coreIntegrationSummary.total} />
                <CoreSummaryCard
                  label="CORE tanıdı"
                  value={coreIntegrationSummary.coreRecognized}
                  tone="emerald"
                />
                <CoreSummaryCard
                  label="Kural buldu"
                  value={coreIntegrationSummary.ruleFound}
                  tone="sky"
                />
                <CoreSummaryCard
                  label="Manuel inceleme"
                  value={coreIntegrationSummary.manualReview}
                  tone="amber"
                />
                <CoreSummaryCard
                  label="Düşük güven"
                  value={coreIntegrationSummary.lowConfidence}
                  tone="yellow"
                />
                <CoreSummaryCard
                  label="Riskli"
                  value={coreIntegrationSummary.risky}
                  tone="red"
                />
              </div>
            ) : null}

            <CorePreviewTable
              movements={corePreviewMovements}
              displayedCount={PREVIEW_PAGE_SIZE}
              onTeachClick={handleOpenTeachModal}
              showTeachButton={isManagementUser && isAnnveroCoreEnabled()}
              showTeachForMovement={(movement) => showCoreTeachForMovement(movement)}
            />
          </div>
        ) : null}

        <KnowledgeTeachModal
          open={isTeachModalOpen}
          initialForm={teachFormDefaults || {}}
          canTeachGlobal={isManagementUser}
          isSaving={isSavingTeach}
          onClose={handleCloseTeachModal}
          onSubmit={handleSaveKnowledgeTeach}
        />

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-6 text-2xl font-semibold">StandardLucaRow Ön İzleme</h2>

          {standardLucaRows.length === 0 ? (
            <p className="text-gray-400">Henüz StandardLucaRow oluşturulmadı.</p>
          ) : (
            <>
              {previewSummary ? (
                <div className="mb-4 grid grid-cols-2 gap-2 text-xs text-gray-300 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-gray-500">Toplam hareket</div>
                    <div className="text-lg font-semibold text-white">
                      {previewSummary.totalMovements}
                    </div>
                  </div>
                  <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-gray-500">Luca satırı</div>
                    <div className="text-lg font-semibold text-white">
                      {previewSummary.lucaRows}
                    </div>
                  </div>
                  <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-gray-500">Gösterilen</div>
                    <div className="text-lg font-semibold text-white">
                      {displayedStandardLucaRows.length}
                    </div>
                  </div>
                  <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-gray-500">Tanınan</div>
                    <div className="text-lg font-semibold text-emerald-300">
                      {previewSummary.recognized}
                    </div>
                  </div>
                  <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-gray-500">Tanınmayan</div>
                    <div className="text-lg font-semibold text-amber-300">
                      {previewSummary.unknown}
                    </div>
                  </div>
                  <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-gray-500">Riskli</div>
                    <div className="text-lg font-semibold text-red-300">
                      {previewSummary.risky}
                    </div>
                  </div>
                </div>
              ) : null}

              <RowSearchToolbar
                search={previewSearch}
                onSearchChange={setPreviewSearch}
                placeholder="Fiş no, hesap, açıklama, belge türü veya tutar ara..."
                filters={BANK_PREVIEW_FILTERS}
                activeFilter={previewQuickFilter}
                onFilterChange={setPreviewQuickFilter}
                shownCount={displayedStandardLucaRows.length}
                totalCount={filteredStandardLucaRows.length}
              />

              <PreviewErrorBoundary>
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
                  onCoreTeachClick={handleOpenTeachFromLucaRow}
                  showCoreTeachForRow={showCoreTeachForLucaRow}
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
              </PreviewErrorBoundary>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {canShowMore ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewLimit((prev) => prev + PREVIEW_PAGE_SIZE)
                    }
                    className="rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-800"
                  >
                    Daha fazla göster (+{PREVIEW_PAGE_SIZE})
                  </button>
                ) : null}
                <p className="text-sm text-gray-400">
                  Toplam {standardLucaRows.length} Luca satırı.
                  {` Ekranda ${displayedStandardLucaRows.length}/${filteredStandardLucaRows.length}.`}
                  {" Luca Excel tüm satırlar üzerinden çalışır."}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function CoreSummaryCard({ label, value, tone = "default" }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "sky"
        ? "text-sky-300"
        : tone === "amber"
          ? "text-amber-300"
          : tone === "yellow"
            ? "text-yellow-300"
            : tone === "red"
              ? "text-red-300"
              : "text-white";

  return (
    <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
      <div className="text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
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
