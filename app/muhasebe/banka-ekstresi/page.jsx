"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RowSearchToolbar from "../components/RowSearchToolbar";
import EditableStandardLucaPreviewTable from "../components/EditableStandardLucaPreviewTable";
import PreviewErrorBoundary from "../components/PreviewErrorBoundary";
import {
  applySuggestionToMovement,
  buildLearningMemoryAccountUpdate,
  parseSuggestionsFromWarning,
  resolveSuggestionTargetField,
} from "@/src/utils/accountPlanSuggestions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  BANK_PARSER_OPTIONS,
} from "@/src/config/bankParserOptions";
import {
  annveroBtnPrimary,
  annveroBtnSecondary,
  annveroCardClass,
  annveroInputClass,
} from "@/src/styles/annveroDesign";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  countCompanyRules,
  countPendingLucaRowsForCompany,
  findCompanyBankAccount,
  formatDateTime,
  getAccountPlanForCompany,
  getAccountPlanUploadedAt,
  getCompanyBankLucaCode,
  getCompanyRules,
  getCompanyRulesUpdatedAt,
  loadAccountPlansFromStorage,
  loadRuleEngineFromStorage,
  normalizeCompanyRecord,
  saveLucaTransferDataset,
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
import {
  formatMemoryDecisionReportText,
  findSimilarMemoryTargets,
  loadAccountMemoryV2Records,
  migrateAccountMemoryV2InvertedDirections,
  normalizeMemoryDirection,
  saveAccountMemoryV2Decision,
} from "@/src/utils/accountMemoryV2";
import { normalizeBankAnalysisKey } from "@/src/utils/textNormalize";
import {
  buildExportWarningConfirmMessage,
  analyzeMissingHesapRows,
  buildMissingHesapSummaryText,
  downloadMissingHesapExcelReport,
  getRowAnalysisKey,
} from "@/src/utils/previewExportValidation";
import { groupUnresolvedRuleRows } from "@/src/utils/bankSmartSuggestions";
import {
  buildCariDecisionReport,
  formatCariDecisionReportText,
  groupUnresolvedCariRows,
} from "@/src/utils/cariAccountMatcher";
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
  loadDeclarationAccrualRecords,
  saveDeclarationAccrualRecords,
} from "@/src/utils/beyannameTahakkukEngine";
import ParserJobProgress from "@/src/components/ParserJobProgress";
import { useParserJob } from "@/src/hooks/useParserJob";
import { detectSourceFileType } from "@/src/utils/financialSourceArchitecture";
import {
  assertPipelineSignal,
  BANK_PARSER_DEBUG_STORAGE_KEY,
  canStartFullPipeline,
  deriveAutoMatchedMovements,
  formatDurationMs,
  getPipelinePhaseLabel,
  getPipelinePhaseTitle,
  isBankParserServiceModeVisible,
  mapLocalProgressToGlobal,
  PIPELINE_PHASES,
  shouldRunPipelineStage,
  userFacingPipelineError,
} from "@/src/utils/bankOneClickPipeline";
import {
  BankPipelineErrorCard,
  BankPipelineProgressPanel,
  BankPipelineResultCard,
} from "./BankOneClickExperience";
import CariMissingResolutionCenter from "./CariMissingResolutionCenter";
import {
  buildCariResolutionGroups,
  CARI_RESOLUTION_INITIAL_CANDIDATE_GROUPS,
  isAccountAllowedForDirection,
  isExpenseAccountCode,
  scheduleAfterPaint,
  shouldApplyCariResolutionAsyncResult,
  shouldIgnoreCariResolutionOpen,
} from "@/src/utils/cariMissingResolutionGroups";
import {
  buildParserPreviewFromNormalizedRowsAsync,
  buildLucaRowsFromMovementsAsync,
  runAccountingAnalysisOnMovementsAsync,
  remapMovementsWithCoreAsync,
  LUCA_MOVEMENT_CHUNK_SIZE,
  ACCOUNTING_ANALYSIS_CHUNK_SIZE,
} from "@/src/utils/bankParserCore";
import { isAnnveroCoreEnabled } from "@/src/config/annveroCoreFlags";
import { ANNVERO_COMPANY_CHANGED_EVENT } from "@/src/config/annveroNavConfig";
import { CORE_REVIEW_LEFT_LABEL } from "@/src/utils/bankCoreBridge";
import {
  computeCoreIntegrationSummary,
  mergeCoreDecisionIntoMovement,
  shouldShowCoreTeachButton,
  isCoreAlreadyRecognized,
  shouldOpenCoreTeachModal,
  isMovementTaughtForDisplay,
  isCoreStatusUnknown,
} from "@/src/utils/bankCorePreview";
import CorePreviewTable from "./CorePreviewTable";
import KnowledgeTeachModal from "./KnowledgeTeachModal";
import { buildTeachFormFromMovement } from "@/src/utils/knowledgeBuilderForm";
import { saveKnowledgeTeachRequest } from "@/src/utils/knowledgeBuilderClient";
import { useUserRole } from "@/src/hooks/useUserRole";
import { parseBankExcelOnMainThread } from "@/src/utils/bankExcelMainThreadParse";
import { runBankParserWorker } from "@/src/utils/workerParserBridge";
import { PARSER_WORKER_URLS } from "@/src/utils/parserWorkerUrls";
import {
  BANK_FORMAT_MISMATCH_HINT,
  BANK_FORMAT_MISMATCH_MESSAGE,
  assertSelectedBankMatchesSheet,
  resolveParserBankFromSheet,
} from "@/src/utils/bankStatementFormatGuard";
import { readSheetRowsFromArrayBuffer } from "@/src/utils/excelBufferUtils";

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
  PARSING: "Hareketler ayıklanıyor",
  PREVIEW: "Önizleme hazırlanıyor",
  ANALYSIS: "Muhasebe analizi",
  LUCA: "Luca satırları hazırlanıyor",
};

const PREVIEW_PAGE_SIZE = 50;

const PIPELINE_STEPS = [
  { id: "preview", label: "1 · Ön İzleme" },
  { id: "analysis", label: "2 · Muhasebe Analizi" },
  { id: "luca", label: "3 · Luca Hazırlama" },
  { id: "excel", label: "4 · Excel" },
];

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
    _knowledgeTeachSaved: Boolean(movement._knowledgeTeachSaved),
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

function computeMovementPreviewSummary(movements = []) {
  let recognized = 0;
  let unknown = 0;
  let risky = 0;
  for (const movement of movements) {
    const warning = String(movement?.warning || "");
    const hesap = String(
      movement?.counterAccountCode || movement?.accountCode || ""
    ).trim();
    if (
      !hesap ||
      warning.includes(CORE_REVIEW_LEFT_LABEL) ||
      warning.includes("Hesap eşleşmesi") ||
      warning.includes("Kural bulunamadı")
    ) {
      unknown += 1;
    } else if (
      warning.toLowerCase().includes("risk") ||
      movement?._coreRiskLevel === "high" ||
      movement?._coreRiskLevel === "critical"
    ) {
      risky += 1;
    } else {
      recognized += 1;
    }
  }
  return {
    totalMovements: movements.length,
    lucaRows: 0,
    recognized,
    unknown,
    risky,
    suggested: 0,
  };
}

export default function BankaParserPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const pipelineRunIdRef = useRef(0);
  const abortRef = useRef(null);
  const normalizedRef = useRef([]);
  const movementsRef = useRef([]);
  const lucaRef = useRef([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPreparingLuca, setIsPreparingLuca] = useState(false);
  const [lucaReady, setLucaReady] = useState(false);
  const [accountingAnalyzed, setAccountingAnalyzed] = useState(false);
  const [activeStep, setActiveStep] = useState("preview"); // preview|analysis|luca|excel
  const [completedSteps, setCompletedSteps] = useState({
    preview: false,
    analysis: false,
    luca: false,
    excel: false,
  });
  const [rawCount, setRawCount] = useState(0);
  /** UI dilimi — en fazla PREVIEW_PAGE_SIZE */
  const [movementRows, setMovementRows] = useState([]);
  const [totalMovementCount, setTotalMovementCount] = useState(0);
  const [movementPage, setMovementPage] = useState(0);
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
  const [missingHesapReport, setMissingHesapReport] = useState(null);
  const [ruleGroupReport, setRuleGroupReport] = useState(null);
  const [cariGroupReport, setCariGroupReport] = useState(null);
  const [cariDecisionReport, setCariDecisionReport] = useState(null);
  const [memoryDecisionReport, setMemoryDecisionReport] = useState(null);
  const [selectedRuleGroupKey, setSelectedRuleGroupKey] = useState("");
  const [standardLucaRows, setStandardLucaRows] = useState([]);
  const [totalLucaCount, setTotalLucaCount] = useState(0);
  const [lucaPage, setLucaPage] = useState(0);
  const [previewErrorDetail, setPreviewErrorDetail] = useState("");
  const [previewSummary, setPreviewSummary] = useState(null);
  const [coreIntegrationSummary, setCoreIntegrationSummary] = useState(null);
  const [coreRowsProcessed, setCoreRowsProcessed] = useState(0);
  const [isApplyingCoreAll, setIsApplyingCoreAll] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [teachMovement, setTeachMovement] = useState(null);
  const [teachFormDefaults, setTeachFormDefaults] = useState(null);
  const [isTeachModalOpen, setIsTeachModalOpen] = useState(false);
  const [isSavingTeach, setIsSavingTeach] = useState(false);
  const [lastTimings, setLastTimings] = useState(null);
  /** Tek tuş üretim hattı — idle | auto | manual */
  const [pipelineMode, setPipelineMode] = useState("idle");
  const [pipelinePhase, setPipelinePhase] = useState(PIPELINE_PHASES.IDLE);
  const [pipelineProgress, setPipelineProgress] = useState({
    percent: 0,
    label: "",
    detail: "",
    processed: null,
    total: null,
  });
  const [pipelineResult, setPipelineResult] = useState(null);
  const [pipelineError, setPipelineError] = useState(null);
  const pipelinePhaseRef = useRef(PIPELINE_PHASES.IDLE);
  const unrecognizedCountRef = useRef(0);
  /** Dosya seçiminde bir kez okunan sheet — parse aşamasında reuse */
  const fileSheetRowsRef = useRef(null);
  const fileSheetSourceRef = useRef(null);
  /** Pipeline/parse bankası — React state'ten bağımsız (stale closure yok) */
  const activeBankRef = useRef("");
  /** Aşamalar arası kısa boşlukta ikinci auto/manual start engeli */
  const [pipelineRunning, setPipelineRunning] = useState(false);
  /** idle | pending | detected | unknown | manual */
  const [bankDetection, setBankDetection] = useState({
    status: "idle",
    bankId: null,
    message: "",
  });
  const [elapsedSec, setElapsedSec] = useState(0);
  /** Servis UI: Luca önizleme; normal kullanıcı Çözüm Merkezi kullanır */
  const [showUserLucaReview, setShowUserLucaReview] = useState(false);
  const [showCariResolutionCenter, setShowCariResolutionCenter] =
    useState(false);
  const [cariResolutionSnapshot, setCariResolutionSnapshot] = useState(null);
  const [cariResolutionLoading, setCariResolutionLoading] = useState(false);
  const [cariResolutionError, setCariResolutionError] = useState("");
  const [resolvedCariGroupIds, setResolvedCariGroupIds] = useState(
    () => new Set()
  );
  const [applyingCariGroupId, setApplyingCariGroupId] = useState(null);
  const [lastCariApplyMessage, setLastCariApplyMessage] = useState("");
  const cariResolutionCancelRef = useRef(null);
  const cariResolutionGenerationRef = useRef(0);
  const showCariResolutionCenterRef = useRef(false);
  const manualDetailsRef = useRef(null);

  const { isManagementUser } = useUserRole();
  const [bankDebugFlag, setBankDebugFlag] = useState(false);

  useEffect(() => {
    try {
      setBankDebugFlag(
        window.localStorage.getItem(BANK_PARSER_DEBUG_STORAGE_KEY) === "1"
      );
    } catch {
      setBankDebugFlag(false);
    }
  }, []);

  const showBankServiceUi = isBankParserServiceModeVisible({
    isManagementUser,
    nodeEnv: process.env.NODE_ENV,
    debugFlag: bankDebugFlag,
  });

  const {
    selectedCompanyId,
    selectedCompany: selectedCompanyRaw,
    isLoading: isLoadingCompanies,
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

  const [selectedBank, setSelectedBank] = useState("");

  const getRunBank = () =>
    String(activeBankRef.current || selectedBank || "")
      .trim()
      .toUpperCase();

  const setActiveBank = (bankId, detectionPatch = null) => {
    const next = String(bankId || "")
      .trim()
      .toUpperCase();
    activeBankRef.current = next;
    setSelectedBank(next);
    if (detectionPatch) setBankDetection(detectionPatch);
  };

  const clearActiveBank = () => {
    activeBankRef.current = "";
    setSelectedBank("");
    setBankDetection({ status: "idle", bankId: null, message: "" });
  };

  const showToast = (message, type) => {
    setToast({ message, type });
  };

  /** Yönetilen pipeline hataları — Next overlay tetiklememek için console.error yok */
  const logManagedPipelineIssue = (scope, error, meta = {}) => {
    console.warn(`[banka-ekstresi] ${scope}`, {
      message: error?.message || String(error || ""),
      code: error?.code || null,
      name: error?.name || null,
      ...meta,
    });
  };

  const buildManagedFailureMessage = (error, fallbackPhase) => {
    const isFormatMismatch =
      error?.code === "BANK_FORMAT_MISMATCH" ||
      String(error?.message || "").includes(BANK_FORMAT_MISMATCH_MESSAGE);
    if (isFormatMismatch) {
      return `${BANK_FORMAT_MISMATCH_MESSAGE} ${BANK_FORMAT_MISMATCH_HINT}`;
    }
    return (
      error?.userMessage ||
      userFacingPipelineError(fallbackPhase) ||
      "İşlem tamamlanamadı. Lütfen tekrar deneyin."
    );
  };

  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!pipelineRunning) return undefined;
    const startedAt = Date.now();
    setElapsedSec(0);
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [pipelineRunning]);

  useEffect(() => {
    const reloadLocalWorkspace = () => {
      setAccountPlans(loadAccountPlansFromStorage());
      setRuleEngine(loadRuleEngineFromStorage());
      setAccountingRules(loadAccountingRulesFromStorage());
      setDeclarationAccrualRecords(loadDeclarationAccrualRecords());
    };

    reloadLocalWorkspace();
    window.addEventListener("annvero:refresh-modules", reloadLocalWorkspace);

    return () => {
      window.removeEventListener("annvero:refresh-modules", reloadLocalWorkspace);
    };
  }, []);

  useEffect(() => {
    const handleCompanyChange = () => {
      pipelineRunIdRef.current += 1;
      abortRef.current?.abort();
      setIsParsing(false);
      setIsAnalyzing(false);
      setIsPreparingLuca(false);
      setIsApplyingCoreAll(false);
      setIsExporting(false);
      setPipelineRunning(false);
      normalizedRef.current = [];
      movementsRef.current = [];
      lucaRef.current = [];
      setMovementRows([]);
      setStandardLucaRows([]);
      setTotalMovementCount(0);
      setTotalLucaCount(0);
      setLucaReady(false);
      setAccountingAnalyzed(false);
      setActiveStep("preview");
      setCompletedSteps({
        preview: false,
        analysis: false,
        luca: false,
        excel: false,
      });
      setSelectedFile(null);
      setFileName("");
      fileSheetRowsRef.current = null;
      fileSheetSourceRef.current = null;
      activeBankRef.current = "";
      setSelectedBank("");
      setBankDetection({ status: "idle", bankId: null, message: "" });
      setExportValidation(null);
      setMissingHesapReport(null);
      setRuleGroupReport(null);
      setCariGroupReport(null);
      setCariDecisionReport(null);
      setMemoryDecisionReport(null);
      setSelectedRuleGroupKey("");
      setToast(null);
      setPreviewErrorDetail("");
      setPreviewSummary(null);
      setCoreIntegrationSummary(null);
      setCoreRowsProcessed(0);
      setLastTimings(null);
      setPipelineResult(null);
      setPipelineMode("idle");
      setPipelinePhase(PIPELINE_PHASES.IDLE);
      pipelinePhaseRef.current = PIPELINE_PHASES.IDLE;
      setPipelineProgress({
        percent: 0,
        label: "",
        detail: "",
        processed: null,
        total: null,
      });
      setPipelineError(null);
      unrecognizedCountRef.current = 0;
      parserJob.reset();
    };

    window.addEventListener(ANNVERO_COMPANY_CHANGED_EVENT, handleCompanyChange);
    return () => window.removeEventListener(ANNVERO_COMPANY_CHANGED_EVENT, handleCompanyChange);
    // Mount-only: parserJob.reset is stable (useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const matchedCompanyBank = useMemo(
    () =>
      findCompanyBankAccount(selectedCompany?.bankAccounts || [], selectedBank),
    [selectedCompany, selectedBank]
  );

  const selectedBankLucaCode = useMemo(
    () =>
      getCompanyBankLucaCode(selectedCompany?.bankAccounts || [], selectedBank),
    [selectedCompany, selectedBank]
  );

  const selectedBankLucaReady =
    Boolean(String(matchedCompanyBank?.lucaAccountCode || "").trim()) &&
    String(selectedBankLucaCode || "").trim() !== "102";

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
        lucaReady ? lucaRef.current : [],
        previewSearch,
        previewQuickFilter
      ),
    // lucaReady / totalLucaCount değişince yeniden hesapla
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lucaReady, totalLucaCount, previewSearch, previewQuickFilter, standardLucaRows]
  );

  const displayedStandardLucaRows = useMemo(() => {
    const start = lucaPage * PREVIEW_PAGE_SIZE;
    return filteredStandardLucaRows.slice(start, start + PREVIEW_PAGE_SIZE);
  }, [filteredStandardLucaRows, lucaPage]);

  const canShowMoreLuca =
    (lucaPage + 1) * PREVIEW_PAGE_SIZE < filteredStandardLucaRows.length;
  const canShowPrevLuca = lucaPage > 0;
  const canShowMoreMovements =
    (movementPage + 1) * PREVIEW_PAGE_SIZE < totalMovementCount;
  const canShowPrevMovements = movementPage > 0;

  const movementById = useMemo(() => {
    const map = new Map();
    movementRows.forEach((row) => map.set(row.id, row));
    return map;
  }, [movementRows]);

  const getFullMovement = (id) => {
    if (!id) return null;
    return movementsRef.current.find((row) => row.id === id) || null;
  };

  /**
   * Hafıza öğrenme yönü/analysisKey — Luca borc/alacak kullanılmaz.
   * Kaynak movement.direction esas alınır.
   */
  const resolveMemoryLearnContext = (row = {}) => {
    const movementId = row.sourceMovementId || row._movementId || "";
    const movement = movementId ? getFullMovement(movementId) : null;

    let direction = "";
    let analysisKey = "";
    let transactionType = "";
    let description = "";

    if (movement) {
      direction = normalizeMemoryDirection(
        movement.direction || movement.yon || ""
      );
      description = String(
        movement.description ||
          movement.rawRow?.aciklama ||
          movement.rawRow?.description ||
          ""
      ).trim();
      analysisKey = String(
        movement.analysisKey ||
          normalizeBankAnalysisKey(description, direction) ||
          ""
      ).trim();
      transactionType = String(
        movement.transactionType || row.transactionType || ""
      ).trim();
    }

    if (!direction) {
      direction = normalizeMemoryDirection(row.direction || "");
    }

    if (!analysisKey && direction) {
      description =
        description ||
        String(
          row.rawDescription ||
            row.detayAciklama ||
            row.fisAciklama ||
            row.aciklama ||
            ""
        ).trim();
      analysisKey = String(
        row.analysisKey ||
          normalizeBankAnalysisKey(description, direction) ||
          ""
      ).trim();
    }

    if (!transactionType) {
      transactionType = String(row.transactionType || "").trim();
    }

    const ok = Boolean(direction && (analysisKey || description));
    return {
      ok,
      movement,
      direction,
      analysisKey:
        analysisKey ||
        (direction ? normalizeBankAnalysisKey(description, direction) : ""),
      transactionType,
      description,
      error: ok
        ? ""
        : "Kaynak hareket yönü bulunamadı; otomatik öğrenme yapılmadı. Luca borc/alacak yönü kullanılmaz.",
    };
  };

  useEffect(() => {
    const result = migrateAccountMemoryV2InvertedDirections();
    if (result.migratedCount > 0) {
      console.info("[ANNVERO][MEMORY-V2-MIGRATE]", {
        migratedCount: result.migratedCount,
        conflictCount: result.conflictCount,
        conflicts: result.conflicts,
      });
    }
  }, []);

  useEffect(() => {
    setLucaPage(0);
  }, [previewSearch, previewQuickFilter]);

  const syncMovementPage = (page = 0) => {
    const all = movementsRef.current;
    const maxPage = Math.max(0, Math.ceil(all.length / PREVIEW_PAGE_SIZE) - 1);
    const safePage = Math.min(Math.max(0, page), maxPage);
    const start = safePage * PREVIEW_PAGE_SIZE;
    setMovementPage(safePage);
    setTotalMovementCount(all.length);
    setMovementRows(
      all.slice(start, start + PREVIEW_PAGE_SIZE).map(slimMovementForUi)
    );
  };

  const syncLucaPage = (page = 0) => {
    const filtered = filterStandardLucaRows(
      lucaRef.current,
      previewSearch,
      previewQuickFilter
    );
    const maxPage = Math.max(0, Math.ceil(filtered.length / PREVIEW_PAGE_SIZE) - 1);
    const safePage = Math.min(Math.max(0, page), maxPage);
    const start = safePage * PREVIEW_PAGE_SIZE;
    setLucaPage(safePage);
    setTotalLucaCount(lucaRef.current.length);
    setStandardLucaRows(filtered.slice(start, start + PREVIEW_PAGE_SIZE));
  };

  const isJobBusy =
    isParsing ||
    isAnalyzing ||
    isPreparingLuca ||
    isApplyingCoreAll ||
    isExporting ||
    pipelineRunning;

  const beginPipelineRun = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = pipelineRunIdRef.current + 1;
    pipelineRunIdRef.current = runId;
    return { runId, signal: controller.signal };
  };

  const isRunActive = (runId) => pipelineRunIdRef.current === runId;

  const resetPipelineUiState = () => {
    setPipelineMode("idle");
    setPipelinePhase(PIPELINE_PHASES.IDLE);
    pipelinePhaseRef.current = PIPELINE_PHASES.IDLE;
    setPipelineRunning(false);
    setPipelineProgress({
      percent: 0,
      label: "",
      detail: "",
      processed: null,
      total: null,
    });
    setPipelineError(null);
  };

  const handleCancelJob = () => {
    pipelineRunIdRef.current += 1;
    abortRef.current?.abort();
    parserJob.cancel("user");
    setIsParsing(false);
    setIsAnalyzing(false);
    setIsPreparingLuca(false);
    setIsApplyingCoreAll(false);
    setIsExporting(false);
    setPipelineRunning(false);
    setPipelineMode("idle");
    setPipelinePhase(PIPELINE_PHASES.CANCELLED);
    pipelinePhaseRef.current = PIPELINE_PHASES.CANCELLED;
    setPipelineProgress((prev) => ({
      ...prev,
      percent: 0,
      label: "İşlem iptal edildi",
      detail: "",
    }));
    setPipelineError(null);
  };

  const handleApplyAccountSuggestion = async (row, suggestion) => {
    const updatedRow = applySuggestionToMovement(
      row,
      suggestion,
      selectedCompany?.bankAccounts || []
    );

    setMovementRows((prev) =>
      prev.map((item) => (item.id === row.id ? slimMovementForUi(updatedRow) : item))
    );
    movementsRef.current = movementsRef.current.map((item) =>
      item.id === row.id ? updatedRow : item
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

    const currentRow =
      lucaRef.current.find((row) => row.id === editingRowId) ||
      standardLucaRows.find((row) => row.id === editingRowId);
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

      const idx = lucaRef.current.findIndex((row) => row.id === editingRowId);
      if (idx >= 0) lucaRef.current[idx] = updatedRow;

      const wasMissing =
        !String(currentRow.hesapKodu || "").trim() ||
        currentRow.riskDurumu === "HESAP_EKSIK";
      const nowFilled = String(updatedRow.hesapKodu || "").trim();
      if (wasMissing && nowFilled) {
        const applyGroup = window.confirm(
          `Hesap ${nowFilled} kaydedildi.\nAynı analysisKey grubundaki diğer eksik satırlara da uygulansın mı?` +
            (draftRow.saveToMemory ? "\n(Bu firma için öğren seçiliyse hafızaya da yazılır.)" : "")
        );
        if (applyGroup) {
          handleApplyHesapToAnalysisGroup(updatedRow, nowFilled, {
            learn: Boolean(draftRow.saveToMemory),
          });
        } else {
          setMissingHesapReport(analyzeMissingHesapRows(lucaRef.current));
          syncLucaPage(lucaPage);
        }
      } else {
        setMissingHesapReport(analyzeMissingHesapRows(lucaRef.current));
      }

      setExportValidation(null);
      return updatedRow;
    } finally {
      setIsSavingPreviewEdit(false);
    }
  };

  const handleAccountMemorySave = (row) => {
    if (!selectedCompanyId) return;
    const learnCtx = resolveMemoryLearnContext(row);
    if (!learnCtx.ok) {
      showToast(learnCtx.error, "error");
      return;
    }
    saveAccountMemoryFromEdit(
      {
        ...row,
        analysisKey: learnCtx.analysisKey,
        direction: learnCtx.direction,
        transactionType: learnCtx.transactionType || row.transactionType || "",
        normalizedDescription: learnCtx.description,
      },
      {
        firmaId: selectedCompanyId,
        kaynakAdi: selectedBank,
      }
    );
  };

  const exportExcel = async (ignoreWarnings = false, options = {}) => {
    if (isExporting) return;

    const allowPartialMissing = Boolean(options.allowPartialMissing);
    const allRows = lucaRef.current;
    if (!lucaReady || !allRows.length) {
      showToast("Önce “Luca Satırlarını Hazırla” ile Luca satırlarını oluşturun.", "error");
      return;
    }

    const missingReport = analyzeMissingHesapRows(allRows);
    setMissingHesapReport(missingReport);

    if (missingReport.missingCount > 0 && !allowPartialMissing) {
      setExportValidation({
        hasBlockingErrors: true,
        globalErrors: [buildMissingHesapSummaryText(missingReport)],
        blockingMessages: (missingReport.categories || []).map(
          (item) => `${item.category}: ${item.count} satır`
        ),
        missingReport,
        errorCategoryCounts: { eksikHesap: missingReport.missingCount },
      });
      setPreviewQuickFilter("missingAccount");
      showToast(
        `${missingReport.missingCount} eksik hesap satırı var. İnceleyin veya kısmi export seçin.`,
        "error"
      );
      return;
    }

    const readyRows = allowPartialMissing
      ? allRows.filter((row) => {
          const hesap = String(row?.hesapKodu || "").trim();
          if (!hesap) return false;
          if (row?.riskDurumu === "HESAP_EKSIK") return false;
          return true;
        })
      : allRows;

    if (allowPartialMissing && !readyRows.length) {
      showToast("Fişe hazır satır yok. Önce hesap eşleşmelerini tamamlayın.", "error");
      return;
    }

    const { runId, signal } = beginPipelineRun();
    setIsExporting(true);
    setActiveStep("excel");
    parserJob.begin({
      stage: "Excel",
      detail: allowPartialMissing
        ? "Kısmi Luca Excel hazırlanıyor"
        : "Luca Excel hazırlanıyor",
    });

    try {
      const bankPrefix = allowPartialMissing
        ? `${String(selectedBank || "banka").toLowerCase()}_luca_partial`
        : `${String(selectedBank || "banka").toLowerCase()}_luca`;
      const result = await exportStandardLucaExcel(readyRows, {
        filePrefix: bankPrefix,
        logLabel: "banka-export",
        onValidationFail: setExportValidation,
        ignoreWarnings,
        signal,
        onProgress: (progress) => {
          if (isRunActive(runId) && !signal.aborted) {
            parserJob.onProgress(progress?.detail || "Excel hazırlanıyor…");
          }
        },
      });

      if (!isRunActive(runId) || signal.aborted || result.reason === "cancelled") {
        return;
      }

      if (!result.ok) {
        if (result.reason === "warnings" && result.needsConfirm) {
          const confirmed = window.confirm(
            buildExportWarningConfirmMessage(result.validation)
          );
          if (confirmed) {
            setIsExporting(false);
            await exportExcel(true, options);
          }
          return;
        }

        if (result.reason === "validation") {
          setExportValidation(result.validation || null);
          const report = result.validation?.duplicateReport;
          if (report?.reportLine) {
            window.alert(
              `${report.reportLine}\n\nKritik: ${report.critical || 0} · Şüpheli: ${
                report.suspicious || 0
              } · Beklenen çift: ${report.expectedPairs || 0}`
            );
          }
          showToast(
            result.validation?.missingReport?.missingCount
              ? "Excel engellendi: eksik hesap satırları var."
              : result.validation?.hasCriticalDuplicates
                ? "Excel oluşturulamadı. Kritik mükerrer kayıtları düzeltin."
                : "Excel oluşturulamadı. Satır hatalarını düzeltin.",
            "error"
          );
          parserJob.markError(
            new Error(result.message || "Excel doğrulama hatası")
          );
        } else {
          showToast(
            result.message || "Önce dosyayı yükleyip ön izleme oluşturun.",
            "error"
          );
          parserJob.markError(
            new Error(result.message || "Excel oluşturulamadı")
          );
        }
        return;
      }

      setExportValidation(null);
      setCompletedSteps((prev) => ({ ...prev, excel: true }));
      setLastTimings((prev) => ({
        ...prev,
        excelMs: Date.now(),
        excelFiles: result.fileCount || 1,
        excelPartial: allowPartialMissing,
        excelExcluded: allowPartialMissing ? missingReport.missingCount : 0,
      }));
      parserJob.markSuccess(
        allowPartialMissing
          ? `Kısmi Excel: ${readyRows.length} satır (${missingReport.missingCount} hariç)`
          : result.fileCount > 1
            ? `${result.fileCount} Excel dosyası oluşturuldu`
            : "Luca Excel oluşturuldu"
      );
      showToast(
        allowPartialMissing
          ? `Kısmi Luca Excel oluşturuldu (${readyRows.length} satır). ${missingReport.missingCount} eksik satır hariç bırakıldı.`
          : result.fileCount > 1
            ? `${result.fileCount} adet Luca Excel dosyası oluşturuldu.`
            : "Luca Excel dosyası oluşturuldu.",
        "success"
      );
    } catch (error) {
      if (error?.name === "AbortError" || signal.aborted || !isRunActive(runId)) {
        return;
      }
      console.error("[banka-ekstresi] excel export failed", error);
      parserJob.markError(error);
      showToast(error?.message || "Excel oluşturulamadı.", "error");
    } finally {
      if (isRunActive(runId)) setIsExporting(false);
    }
  };

  const rebuildCariResolutionSnapshot = ({
    includeLegacyCariGroupReport = true,
    initialCandidateGroups = CARI_RESOLUTION_INITIAL_CANDIDATE_GROUPS,
  } = {}) => {
    const report = analyzeMissingHesapRows(lucaRef.current);
    setMissingHesapReport(report);
    if (includeLegacyCariGroupReport) {
      setCariGroupReport(
        groupUnresolvedCariRows(lucaRef.current, {
          companyPlans,
          movements: movementsRef.current,
        })
      );
    }
    const snapshot = buildCariResolutionGroups(
      lucaRef.current,
      {
        companyPlans,
        selectedBank,
      },
      { initialCandidateGroups }
    );
    setCariResolutionSnapshot(snapshot);
    setPipelineResult((prev) =>
      prev
        ? {
            ...prev,
            missingCount: report.missingCount,
            autoMatchedCount: deriveAutoMatchedMovements(report.readyCount),
          }
        : prev
    );
    return { report, snapshot };
  };

  const loadCariResolutionGroupsAsync = () => {
    setCariResolutionError("");
    setCariResolutionLoading(true);
    if (cariResolutionCancelRef.current) {
      cariResolutionCancelRef.current();
    }
    const generation = ++cariResolutionGenerationRef.current;
    cariResolutionCancelRef.current = scheduleAfterPaint(() => {
      try {
        // Modal zaten açık: legacy rapor (her grup için match) peşinen koşturulmaz.
        const { report, snapshot } = rebuildCariResolutionSnapshot({
          includeLegacyCariGroupReport: false,
          initialCandidateGroups: CARI_RESOLUTION_INITIAL_CANDIDATE_GROUPS,
        });
        if (
          !shouldApplyCariResolutionAsyncResult({
            generation,
            activeGeneration: cariResolutionGenerationRef.current,
            isOpen: showCariResolutionCenterRef.current,
          })
        ) {
          return;
        }
        setCariResolutionLoading(false);
        setCariResolutionError("");
        showToast(
          report.missingCount
            ? `${report.missingCount} eksik · ${snapshot.cariMissingCount} cari / ${snapshot.groupCount} grup`
            : "Eksik hesap satırı yok.",
          report.missingCount ? "error" : "success"
        );
        // Legacy accordion raporu: modal boyanıp liste geldikten sonra (iptal edilebilir)
        cariResolutionCancelRef.current = scheduleAfterPaint(() => {
          if (
            !shouldApplyCariResolutionAsyncResult({
              generation,
              activeGeneration: cariResolutionGenerationRef.current,
              isOpen: showCariResolutionCenterRef.current,
            })
          ) {
            return;
          }
          setCariGroupReport(
            groupUnresolvedCariRows(lucaRef.current, {
              companyPlans,
              movements: movementsRef.current,
            })
          );
        });
      } catch (error) {
        if (
          !shouldApplyCariResolutionAsyncResult({
            generation,
            activeGeneration: cariResolutionGenerationRef.current,
            isOpen: showCariResolutionCenterRef.current,
          })
        ) {
          return;
        }
        setCariResolutionLoading(false);
        setCariResolutionError(
          error?.message || "Cari grupları hazırlanamadı. Tekrar deneyin."
        );
      }
    });
  };

  const handleCloseCariResolutionCenter = () => {
    if (cariResolutionCancelRef.current) {
      cariResolutionCancelRef.current();
      cariResolutionCancelRef.current = null;
    }
    cariResolutionGenerationRef.current += 1;
    showCariResolutionCenterRef.current = false;
    setShowCariResolutionCenter(false);
    setCariResolutionLoading(false);
    setCariResolutionError("");
    // resolvedCariGroupIds korunur
  };

  const handleReviewMissingAccounts = () => {
    if (
      shouldIgnoreCariResolutionOpen({
        isOpen: showCariResolutionCenter,
        isLoading: cariResolutionLoading,
      })
    ) {
      return;
    }

    setLastCariApplyMessage("");
    // 1) Modal shell anında — ağır hesap click içinde değil
    showCariResolutionCenterRef.current = true;
    setShowCariResolutionCenter(true);
    setCariResolutionLoading(true);
    setCariResolutionError("");
    setPreviewQuickFilter("missingAccount");
    setActiveStep("excel");
    if (showBankServiceUi) {
      setShowUserLucaReview(true);
    } else {
      setShowUserLucaReview(false);
    }
    // 2) Paint sonrası gruplar (+ ilk 30 aday)
    loadCariResolutionGroupsAsync();
  };

  const handleRetryCariResolutionLoad = () => {
    if (cariResolutionLoading) return;
    loadCariResolutionGroupsAsync();
  };

  const handleApplyCariResolutionGroup = ({
    group,
    accountCode,
    learn = false,
  } = {}) => {
    const code = String(accountCode || "").trim();
    if (!group?.seedRow || !code) return;
    if (!isAccountAllowedForDirection(code, group.direction)) {
      showToast(
        "Bu hesap, grubun yönü (gelen/giden) için uygun değil.",
        "error"
      );
      return;
    }
    if (group.foreignVendor && isExpenseAccountCode(code)) {
      showToast(
        "Yabancı satıcıda gider hesabı uygulanmaz; önce 320 cari seçin.",
        "error"
      );
      return;
    }

    const beforeMissing = analyzeMissingHesapRows(lucaRef.current).missingCount;
    const targetIds = new Set((group.rowIds || []).filter(Boolean));
    if (targetIds.size === 0 && group.seedRow?.id) {
      targetIds.add(group.seedRow.id);
    }

    setApplyingCariGroupId(group.id);
    try {
      const learnCtx = resolveMemoryLearnContext(group.seedRow);
      let updated = 0;
      lucaRef.current = (lucaRef.current || []).map((item) => {
        if (!targetIds.has(item.id)) return item;
        const missing =
          !String(item.hesapKodu || "").trim() ||
          item.riskDurumu === "HESAP_EKSIK";
        if (!missing) return item;
        // Yön koruması
        const itemDir = resolveMemoryLearnContext(item).direction;
        if (
          group.direction &&
          itemDir &&
          group.direction !== itemDir
        ) {
          return item;
        }
        updated += 1;
        return {
          ...item,
          hesapKodu: code,
          riskDurumu: "",
          missingHesapCategory: "",
          kontrolNotu: [
            String(item.kontrolNotu || "")
              .replace(/Hesap eşleşmesi bulunamadı/gi, "")
              .replace(/Kural bulunamadı/gi, "")
              .replace(/Cari hesap bulunamadı[^.|]*/gi, "")
              .replace(/\s+\|\s+/g, " | ")
              .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
              .trim(),
            "Çözüm Merkezi: cari gruba uygulandı",
          ]
            .filter(Boolean)
            .join(" | "),
        };
      });

      let learned = false;
      if (learn && selectedCompanyId && learnCtx.ok) {
        const saved = saveAccountMemoryV2Decision(
          {
            ...group.seedRow,
            hesapKodu: code,
            accountCode: code,
            analysisKey: learnCtx.analysisKey,
            direction: learnCtx.direction,
            transactionType:
              learnCtx.transactionType || group.seedRow.transactionType || "",
            belgeTuru: group.seedRow.belgeTuru || "",
            documentType: group.seedRow.belgeTuru || "",
            cariId: code,
            normalizedDescription: learnCtx.description,
            finalDescriptionTemplate:
              learnCtx.description ||
              group.seedRow.detayAciklama ||
              group.seedRow.fisAciklama ||
              "",
            source: "cari-resolution-center",
          },
          { firmaId: selectedCompanyId, kaynakAdi: selectedBank }
        );
        learned = Boolean(saved);
      }

      syncLucaPage(lucaPage);
      const { report, snapshot } = rebuildCariResolutionSnapshot();
      setResolvedCariGroupIds((prev) => {
        const next = new Set(prev);
        next.add(group.id);
        return next;
      });
      setLastCariApplyMessage(
        `${updated || group.count} işlem ${code} hesabıyla eşleştirildi. Eksik hesap sayısı ${beforeMissing}’ten ${report.missingCount}’e düştü.`
      );
      setCariResolutionSnapshot(snapshot);
      showToast(
        `${updated} satıra uygulandı${learned ? " (öğrenildi)" : learn && !learned ? " (öğrenme atlandı)" : ""}`,
        learned || !learn ? "success" : "error"
      );
    } finally {
      setApplyingCariGroupId(null);
    }
  };

  const handleDownloadMissingReport = async () => {
    const result = await downloadMissingHesapExcelReport(
      lucaRef.current,
      `${String(selectedBank || "banka").toLowerCase()}_eksik_hesap`
    );
    if (result?.ok) {
      showToast(`${result.count} eksik satır raporu indirildi.`, "success");
    }
  };

  const handlePartialExportConfirm = async () => {
    const report = analyzeMissingHesapRows(lucaRef.current);
    const ok = window.confirm(
      `${buildMissingHesapSummaryText(report)}\n\n` +
        `Açıkça onaylıyor musunuz?\n` +
        `“Eksik satırları hariç tutarak devam et” → kısmi Excel (_partial).\n` +
        `Hariç bırakılan satırlar ayrıca rapor olarak indirilebilir.`
    );
    if (!ok) return;
    await exportExcel(false, { allowPartialMissing: true });
  };

  const handleApplyHesapToAnalysisGroup = (
    row,
    accountCode,
    { learn = false, similar = false } = {}
  ) => {
    const code = String(accountCode || "").trim();
    if (!code || !row) return;

    const learnCtx = resolveMemoryLearnContext(row);
    const seedDirection = learnCtx.direction;
    const seedType = String(
      learnCtx.transactionType || row.transactionType || ""
    ).trim();
    const key = learnCtx.analysisKey || getRowAnalysisKey(row);
    const all = lucaRef.current || [];

    if (learn && !learnCtx.ok) {
      showToast(learnCtx.error, "error");
    }

    const similarKeys = new Set();
    if (similar && selectedCompanyId && seedDirection) {
      const similarRecords = findSimilarMemoryTargets(
        loadAccountMemoryV2Records(),
        {
          ...row,
          direction: seedDirection,
          transactionType: seedType,
          analysisKey: key,
          hesapKodu: code,
        },
        { firmaId: selectedCompanyId, kaynakAdi: selectedBank }
      );
      for (const record of similarRecords) {
        if (record.analysisKey) similarKeys.add(record.analysisKey);
      }
      if (key) similarKeys.add(key);
      const seedText = String(
        learnCtx.description ||
          row.detayAciklama ||
          row.fisAciklama ||
          row.aciklama ||
          ""
      );
      for (const item of all) {
        const itemLearn = resolveMemoryLearnContext(item);
        const itemKey = itemLearn.analysisKey || getRowAnalysisKey(item);
        if (!itemKey) continue;
        const itemDirection = itemLearn.direction;
        if (seedDirection && itemDirection && seedDirection !== itemDirection) {
          continue;
        }
        if (
          seedType &&
          itemLearn.transactionType &&
          seedType !== String(itemLearn.transactionType || "").trim()
        ) {
          continue;
        }
        const itemText = String(
          itemLearn.description ||
            item.detayAciklama ||
            item.fisAciklama ||
            item.aciklama ||
            ""
        );
        const left = seedText.toLocaleLowerCase("tr-TR");
        const right = itemText.toLocaleLowerCase("tr-TR");
        if (
          left &&
          right &&
          (left === right ||
            left.includes(right.slice(0, 24)) ||
            right.includes(left.slice(0, 24)))
        ) {
          similarKeys.add(itemKey);
        }
      }
    }

    let updated = 0;
    lucaRef.current = all.map((item) => {
      const itemLearn = resolveMemoryLearnContext(item);
      const itemKey = itemLearn.analysisKey || getRowAnalysisKey(item);
      const missing =
        !String(item.hesapKodu || "").trim() || item.riskDurumu === "HESAP_EKSIK";
      if (!missing) return item;
      if (similar) {
        if (!itemKey || !similarKeys.has(itemKey)) {
          if (!(key && itemKey && key === itemKey)) return item;
        }
        const itemDirection = itemLearn.direction;
        if (seedDirection && itemDirection && seedDirection !== itemDirection) {
          return item;
        }
        if (
          seedType &&
          itemLearn.transactionType &&
          seedType !== String(itemLearn.transactionType || "").trim()
        ) {
          return item;
        }
      } else if (key && itemKey && key !== itemKey) {
        return item;
      }
      updated += 1;
      return {
        ...item,
        hesapKodu: code,
        riskDurumu: "",
        kontrolNotu: [
          String(item.kontrolNotu || "")
            .replace(/Hesap eşleşmesi bulunamadı/gi, "")
            .replace(/Kural bulunamadı/gi, "")
            .replace(/Cari hesap bulunamadı[^.|]*/gi, "")
            .replace(/\s+\|\s+/g, " | ")
            .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
            .trim(),
          similar
            ? "Benzer açıklamalara uygulandı"
            : "Manuel hesap uygulandı",
        ]
          .filter(Boolean)
          .join(" | "),
      };
    });
    setMissingHesapReport(analyzeMissingHesapRows(lucaRef.current));
    setRuleGroupReport(
      groupUnresolvedRuleRows(lucaRef.current, {
        companyPlans,
        movements: movementsRef.current,
      })
    );
    setCariGroupReport(
      groupUnresolvedCariRows(lucaRef.current, {
        companyPlans,
        movements: movementsRef.current,
      })
    );
    syncLucaPage(lucaPage);
    let learned = false;
    if (learn && selectedCompanyId) {
      if (!learnCtx.ok) {
        // hesap uygulandı; öğrenme atlandı
      } else {
        const saved = saveAccountMemoryV2Decision(
          {
            ...row,
            hesapKodu: code,
            accountCode: code,
            analysisKey: learnCtx.analysisKey,
            direction: learnCtx.direction,
            transactionType: seedType,
            belgeTuru: row.belgeTuru || "",
            documentType: row.belgeTuru || "",
            cariId: code,
            normalizedDescription: learnCtx.description,
            finalDescriptionTemplate:
              row.fisAciklama || row.detayAciklama || row.aciklama || "",
            source: similar ? "similar-learn" : "group-learn",
          },
          { firmaId: selectedCompanyId, kaynakAdi: selectedBank }
        );
        learned = Boolean(saved);
        if (!saved) {
          showToast("Hafıza kaydı oluşturulamadı.", "error");
        }
      }
    }
    showToast(
      `${updated} satıra ${code} uygulandı${
        learned
          ? similar
            ? " (benzer + öğrenildi)"
            : " (öğrenildi)"
          : learn && !learned
            ? " (öğrenme atlandı)"
            : ""
      }.`,
      learned || !learn ? "success" : "error"
    );
  };

  const handleApplyHesapToSingleRow = (row, accountCode, { learn = false } = {}) => {
    const code = String(accountCode || "").trim();
    if (!code || !row?.id) return;
    const learnCtx = resolveMemoryLearnContext(row);
    if (learn && !learnCtx.ok) {
      showToast(learnCtx.error, "error");
    }
    lucaRef.current = (lucaRef.current || []).map((item) => {
      if (item.id !== row.id) return item;
      return {
        ...item,
        hesapKodu: code,
        riskDurumu: "",
        kontrolNotu: [
          String(item.kontrolNotu || "")
            .replace(/Hesap eşleşmesi bulunamadı/gi, "")
            .replace(/Kural bulunamadı/gi, "")
            .replace(/Cari hesap bulunamadı[^.|]*/gi, "")
            .replace(/\s+\|\s+/g, " | ")
            .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
            .trim(),
          "Manuel hesap uygulandı (tek satır)",
        ]
          .filter(Boolean)
          .join(" | "),
      };
    });
    setMissingHesapReport(analyzeMissingHesapRows(lucaRef.current));
    setRuleGroupReport(
      groupUnresolvedRuleRows(lucaRef.current, {
        companyPlans,
        movements: movementsRef.current,
      })
    );
    setCariGroupReport(
      groupUnresolvedCariRows(lucaRef.current, {
        companyPlans,
        movements: movementsRef.current,
      })
    );
    syncLucaPage(lucaPage);
    let learned = false;
    if (learn && selectedCompanyId && learnCtx.ok) {
      const saved = saveAccountMemoryV2Decision(
        {
          ...row,
          hesapKodu: code,
          accountCode: code,
          analysisKey: learnCtx.analysisKey,
          direction: learnCtx.direction,
          transactionType: learnCtx.transactionType || row.transactionType || "",
          belgeTuru: row.belgeTuru || "",
          documentType: row.belgeTuru || "",
          cariId: code,
          normalizedDescription: learnCtx.description,
          finalDescriptionTemplate:
            row.fisAciklama || row.detayAciklama || row.aciklama || "",
          source: "row-learn",
        },
        { firmaId: selectedCompanyId, kaynakAdi: selectedBank }
      );
      learned = Boolean(saved);
      if (!saved) showToast("Hafıza kaydı oluşturulamadı.", "error");
    }
    showToast(
      `1 satıra ${code} uygulandı${
        learned ? " (öğrenildi)" : learn && !learned ? " (öğrenme atlandı)" : ""
      }.`,
      learned || !learn ? "success" : "error"
    );
  };

  const handleGoToLucaProducer = async (event) => {
    event.preventDefault();

    if (!movementsRef.current.length || !lucaRef.current.length || !lucaReady) {
      alert("Önce ön izleme oluşturup Luca satırlarını hazırlayın.");
      return;
    }

    if (!selectedCompanyId) {
      alert("Luca Fiş Üretici'ye geçmek için önce firma seçmelisin.");
      return;
    }

    const runId = `bank-${selectedCompanyId.slice(0, 8)}-${Date.now()}`;
    const payload = buildStandardLucaTransferPayload({
      firmaId: selectedCompanyId,
      companyName: getCompanyDisplayName(selectedCompany),
      kaynakTipi: KAYNAK_TIPI.BANKA,
      kaynakAdi: selectedBank,
      source: "bank",
      bankId: selectedBank,
      bankName: selectedBank,
      runId,
      movementCount: movementsRef.current.length,
      rows: lucaRef.current,
    });

    const saved = await saveLucaTransferDataset(payload);
    if (!saved.ok) {
      alert(
        "Banka Parser aktarımı kaydedilemedi. Lütfen tekrar deneyin veya Excel’i buradan indirip Luca’ya yükleyin."
      );
      return;
    }

    // Eski generic cache’e banka verisi yazma — Elektraweb ile karışmasın
    setExportValidation(null);
    logStandardLucaReport("banka-transfer", lucaRef.current);
    router.push(
      `/muhasebe/luca-donusturucu?source=bank&companyId=${encodeURIComponent(
        selectedCompanyId
      )}&runId=${encodeURIComponent(runId)}`
    );
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

  /** Dosya seçimi: state + banka otomatik tespit (parse/pipeline başlamaz) */
  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0] || null;

    if (!file) {
      setSelectedFile(null);
      setFileName("");
      fileSheetRowsRef.current = null;
      fileSheetSourceRef.current = null;
      clearActiveBank();
      resetFileInput();
      return;
    }

    setSelectedFile(file);
    setFileName(file.name);
    clearPreviewState();
    setPipelineError(null);
    fileSheetRowsRef.current = null;
    fileSheetSourceRef.current = null;
    activeBankRef.current = "";
    setSelectedBank("");
    setBankDetection({
      status: "pending",
      bankId: null,
      message: "Banka formatı kontrol ediliyor…",
    });
    resetFileInput();

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (!arrayBuffer?.byteLength) {
        activeBankRef.current = "";
        setSelectedBank("");
        setBankDetection({
          status: "unknown",
          bankId: null,
          message: "Banka otomatik belirlenemedi. Lütfen bankayı seçin.",
        });
        return;
      }
      const sheetRows = readSheetRowsFromArrayBuffer(arrayBuffer);
      fileSheetRowsRef.current = sheetRows;
      fileSheetSourceRef.current = file.name;
      const resolved = resolveParserBankFromSheet(sheetRows);
      if (resolved.status === "detected" && resolved.bankId) {
        const label =
          BANK_PARSER_OPTIONS.find((b) => b.id === resolved.bankId)?.label ||
          resolved.bankId;
        // Ref önce — state güncellemesini beklemeyen pipeline için
        setActiveBank(resolved.bankId, {
          status: "detected",
          bankId: resolved.bankId,
          message: `${label} — otomatik tespit`,
        });
      } else {
        activeBankRef.current = "";
        setSelectedBank("");
        setBankDetection({
          status: "unknown",
          bankId: null,
          message: "Banka otomatik belirlenemedi. Lütfen bankayı seçin.",
        });
      }
    } catch (error) {
      logManagedPipelineIssue("bank-detect", error);
      fileSheetRowsRef.current = null;
      fileSheetSourceRef.current = null;
      activeBankRef.current = "";
      setSelectedBank("");
      setBankDetection({
        status: "unknown",
        bankId: null,
        message: "Banka otomatik belirlenemedi. Lütfen bankayı seçin.",
      });
    }
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

  const clearPreviewState = ({ resetParserJob = true } = {}) => {
    normalizedRef.current = [];
    movementsRef.current = [];
    lucaRef.current = [];
    setRawCount(0);
    setMovementRows([]);
    setTotalMovementCount(0);
    setMovementPage(0);
    setStandardLucaRows([]);
    setTotalLucaCount(0);
    setLucaPage(0);
    setLucaReady(false);
    setAccountingAnalyzed(false);
    setActiveStep("preview");
    setCompletedSteps({
      preview: false,
      analysis: false,
      luca: false,
      excel: false,
    });
    setExportValidation(null);
    setMissingHesapReport(null);
    setRuleGroupReport(null);
    setCariGroupReport(null);
    setCariDecisionReport(null);
    setMemoryDecisionReport(null);
    setSelectedRuleGroupKey("");
    setToast(null);
    setPreviewErrorDetail("");
    setPreviewSummary(null);
    setCoreIntegrationSummary(null);
    setCoreRowsProcessed(0);
    setLastTimings(null);
    setPipelineResult(null);
    setShowUserLucaReview(false);
    setShowCariResolutionCenter(false);
    setCariResolutionSnapshot(null);
    setCariResolutionLoading(false);
    setCariResolutionError("");
    setResolvedCariGroupIds(new Set());
    setApplyingCariGroupId(null);
    setLastCariApplyMessage("");
    if (cariResolutionCancelRef.current) {
      cariResolutionCancelRef.current();
      cariResolutionCancelRef.current = null;
    }
    unrecognizedCountRef.current = 0;
    resetPipelineUiState();
    if (resetParserJob) parserJob.reset();
  };

  const buildPipelineOptions = (normalizedRows, coreRowLimit, bankName) => {
    const bank = String(bankName || activeBankRef.current || selectedBank || "")
      .trim()
      .toUpperCase();
    return {
      normalizedRows,
      selectedBank: bank,
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
    };
  };

  const applyMovementPreview = (movements, coreMeta, raw) => {
    movementsRef.current = movements;
    setRawCount(raw || movements.length);
    setPreviewSummary(computeMovementPreviewSummary(movements));
    setCoreIntegrationSummary(
      coreMeta ? computeCoreIntegrationSummary(movements) : null
    );
    setCoreRowsProcessed(coreMeta?.coreLimit ?? 0);
    syncMovementPage(0);
    lucaRef.current = [];
    setLucaReady(false);
    setStandardLucaRows([]);
    setTotalLucaCount(0);
  };

  const setPipelinePhaseSafe = (phase) => {
    pipelinePhaseRef.current = phase;
    setPipelinePhase(phase);
  };

  const emitPipelineProgress = (phase, message = {}) => {
    const localPercent =
      typeof message.percent === "number" ? message.percent : 0;
    const percent = mapLocalProgressToGlobal(phase, localPercent);
    const label = getPipelinePhaseLabel(phase, message.detail || message.stage || "");
    const detail = message.detail || "";
    const processed =
      typeof message.processed === "number" ? message.processed : null;
    const total = typeof message.total === "number" ? message.total : null;
    setPipelineProgress({ percent, label, detail, processed, total });
    parserJob.onProgress({
      stage: label || message.stage || "",
      detail,
      percent,
      processed,
      total,
    });
  };

  const parseExcelFile = async (file, signal, bankName) => {
    const bank = String(bankName || activeBankRef.current || "")
      .trim()
      .toUpperCase();
    if (!bank) {
      const err = new Error("Banka otomatik belirlenemedi. Lütfen bankayı seçin.");
      err.code = "BANK_REQUIRED";
      throw err;
    }

    const onProgress = (message) => {
      if (signal?.aborted) return;
      const phase = pipelinePhaseRef.current;
      if (
        phase === PIPELINE_PHASES.PARSING ||
        phase === PIPELINE_PHASES.PREVIEW
      ) {
        emitPipelineProgress(phase, message);
      } else {
        parserJob.onProgress(message);
      }
    };

    // Dosya seçiminde cache varsa XLSX'i tekrar okuma.
    let sheetRows = null;
    if (
      fileSheetRowsRef.current &&
      fileSheetSourceRef.current === file?.name
    ) {
      sheetRows = fileSheetRowsRef.current;
    } else {
      const arrayBuffer = await file.arrayBuffer();
      if (signal?.aborted) {
        const err = new Error("İşlem iptal edildi.");
        err.name = "AbortError";
        throw err;
      }
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        const err = new Error("Dosya içeriği boş veya okunamadı.");
        err.code = "FILE_READ";
        throw err;
      }
      sheetRows = readSheetRowsFromArrayBuffer(arrayBuffer);
      fileSheetRowsRef.current = sheetRows;
      fileSheetSourceRef.current = file?.name || null;
    }

    if (signal?.aborted) {
      const err = new Error("İşlem iptal edildi.");
      err.name = "AbortError";
      throw err;
    }

    try {
      assertSelectedBankMatchesSheet(sheetRows, bank);
    } catch (mismatchError) {
      if (
        mismatchError?.code === "BANK_FORMAT_MISMATCH" ||
        String(mismatchError?.message || "").includes(BANK_FORMAT_MISMATCH_MESSAGE)
      ) {
        const err = new Error(
          `${BANK_FORMAT_MISMATCH_MESSAGE} ${BANK_FORMAT_MISMATCH_HINT}`
        );
        err.code = "BANK_FORMAT_MISMATCH";
        err.detectedBank = mismatchError?.detectedBank;
        err.selectedBank = mismatchError?.selectedBank || bank;
        throw err;
      }
      throw mismatchError;
    }

    if (signal?.aborted) {
      const err = new Error("İşlem iptal edildi.");
      err.name = "AbortError";
      throw err;
    }

    try {
      const workerResult = await runBankParserWorker({
        workerUrl: PARSER_WORKER_URLS.bankExcel,
        sheetRows,
        bankName: bank,
        options: { selectedCompanyId },
        onProgress,
        timeoutMs: 120_000,
      });
      return {
        rawCount: workerResult.rawCount || sheetRows.length,
        normalizedRows: workerResult.normalizedRows || [],
        parseMode: workerResult.parseMode || "worker",
        timings: workerResult.timings || null,
        bankName: bank,
      };
    } catch (workerError) {
      if (workerError?.name === "AbortError" || signal?.aborted) throw workerError;
      console.warn("[banka-ekstresi] worker parse fallback", {
        message: workerError?.message || String(workerError),
        code: workerError?.code || null,
        detail: workerError?.detail || null,
        phase: workerError?.phase || null,
      });
      onProgress({
        stage: BANK_PARSE_STAGES.READING,
        detail: "Worker kullanılamadı — ana thread",
      });
      return parseBankExcelOnMainThread(file, bank, onProgress, {
        sheetRows,
      });
    }
  };

  /** Stage çekirdeği — beginPipelineRun YOK; dış signal/runId kullanır */
  const runPreviewStage = async ({ signal, runId, bankName } = {}) => {
    const t0 = performance.now();
    const bank = String(bankName || getRunBank() || "")
      .trim()
      .toUpperCase();
    assertPipelineSignal(signal, isRunActive, runId);
    if (!bank) {
      const err = new Error("Banka otomatik belirlenemedi. Lütfen bankayı seçin.");
      err.code = "BANK_REQUIRED";
      throw err;
    }
    // Kapalı state’e bakmadan açık run context
    activeBankRef.current = bank;
    setAccountingAnalyzed(false);
    setPreviewErrorDetail("");
    setPreviewSummary(null);
    lucaRef.current = [];
    setLucaReady(false);
    setStandardLucaRows([]);
    setCompletedSteps({
      preview: false,
      analysis: false,
      luca: false,
      excel: false,
    });

    setPipelinePhaseSafe(PIPELINE_PHASES.PARSING);
    const mainResult = await parseExcelFile(selectedFile, signal, bank);
    assertPipelineSignal(signal, isRunActive, runId);

    normalizedRef.current = mainResult.normalizedRows || [];
    setPipelinePhaseSafe(PIPELINE_PHASES.PREVIEW);
    const previewResult = await buildParserPreviewFromNormalizedRowsAsync({
      ...buildPipelineOptions(normalizedRef.current, undefined, bank),
      signal,
      onProgress: (message) => {
        if (isRunActive(runId) && !signal.aborted) {
          emitPipelineProgress(PIPELINE_PHASES.PREVIEW, message);
        }
      },
    });
    assertPipelineSignal(signal, isRunActive, runId);

    const movements = previewResult.movementRows || [];
    applyMovementPreview(movements, null, mainResult.rawCount);
    setAccountingAnalyzed(false);
    setCompletedSteps((prev) => ({ ...prev, preview: true }));
    setActiveStep("analysis");
    const durationMs = Math.round(performance.now() - t0);
    setLastTimings((prev) => ({
      ...prev,
      previewMs: durationMs,
      movementCount: movements.length,
      parseMode: mainResult.parseMode || "main",
      bankName: bank,
    }));
    return {
      normalizedCount: (mainResult.normalizedRows || []).length,
      movementCount: movements.length,
      rawCount: mainResult.rawCount || 0,
      parseMode: mainResult.parseMode || "main",
      bankName: bank,
      durationMs,
    };
  };

  const runAccountingAnalysisStage = async ({ signal, runId, bankName } = {}) => {
    const t0 = performance.now();
    const bank = String(bankName || getRunBank() || "")
      .trim()
      .toUpperCase();
    assertPipelineSignal(signal, isRunActive, runId);
    if (!movementsRef.current.length) {
      throw new Error("Önce ön izleme oluşturun.");
    }

    const result = await runAccountingAnalysisOnMovementsAsync({
      ...buildPipelineOptions(normalizedRef.current, undefined, bank),
      movementRows: movementsRef.current,
      signal,
      onProgress: (message) => {
        if (isRunActive(runId) && !signal.aborted) {
          emitPipelineProgress(PIPELINE_PHASES.ACCOUNTING_ANALYSIS, message);
        }
      },
    });
    assertPipelineSignal(signal, isRunActive, runId);

    movementsRef.current = result.movementRows || [];
    setAccountingAnalyzed(true);
    setPreviewSummary(computeMovementPreviewSummary(movementsRef.current));
    setCoreIntegrationSummary(computeCoreIntegrationSummary(movementsRef.current));
    setCoreRowsProcessed(0);
    syncMovementPage(0);
    setExportValidation(null);
    lucaRef.current = [];
    setLucaReady(false);
    setStandardLucaRows([]);
    setTotalLucaCount(0);
    setCompletedSteps((prev) => ({
      ...prev,
      analysis: true,
      luca: false,
      excel: false,
    }));
    setActiveStep("luca");
    const durationMs = Math.round(performance.now() - t0);
    setLastTimings((prev) => ({
      ...prev,
      analysisMs: durationMs,
      analysisChunk: ACCOUNTING_ANALYSIS_CHUNK_SIZE,
      analysisProcessed: result.processedCount ?? movementsRef.current.length,
      analysisTimedOut: Boolean(result.timedOut),
      analysisTimings: result.timings || null,
      analysisCallCounts: result.callCounts || null,
      uniqueDescriptionCount:
        result.uniqueDescriptionCount ??
        result.callCounts?.uniqueDescriptionCount ??
        null,
      uniqueReport: result.uniqueReport || null,
    }));
    {
      const decisionReport = buildCariDecisionReport({
        analysisStats: result.callCounts || {},
        timings: result.timings || {},
        previousMissingCount: cariDecisionReport?.currentMissingCount ?? null,
        currentMissingCount: null,
        cariGroupReport: null,
      });
      setCariDecisionReport(decisionReport);
      console.info("[ANNVERO][CARI-DECISION]", formatCariDecisionReportText(decisionReport));
      if (result.memoryDecisionReport) {
        setMemoryDecisionReport(result.memoryDecisionReport);
        console.info(
          "[ANNVERO][MEMORY-DECISION]",
          formatMemoryDecisionReportText(result.memoryDecisionReport)
        );
      }
    }

    const uniqueCount =
      result.uniqueDescriptionCount ||
      result.callCounts?.uniqueDescriptionCount ||
      0;
    return {
      movementCount: movementsRef.current.length,
      uniqueCount,
      durationMs,
      result,
    };
  };

  const runLucaBuildStage = async ({ signal, runId, bankName } = {}) => {
    const t0 = performance.now();
    const bank = String(bankName || getRunBank() || "")
      .trim()
      .toUpperCase();
    assertPipelineSignal(signal, isRunActive, runId);
    if (!movementsRef.current.length) {
      throw new Error("Önce ön izleme oluşturun.");
    }
    setLucaReady(false);
    setExportValidation(null);

    const lucaResult = await buildLucaRowsFromMovementsAsync(
      movementsRef.current,
      buildPipelineOptions(normalizedRef.current, undefined, bank),
      {
        chunkSize: LUCA_MOVEMENT_CHUNK_SIZE,
        signal,
        earlyPreviewCount: PREVIEW_PAGE_SIZE,
        onEarlyPreview: (partialRows) => {
          if (!isRunActive(runId) || signal.aborted) return;
          setStandardLucaRows(partialRows.slice(0, PREVIEW_PAGE_SIZE));
          setTotalLucaCount(partialRows.length);
        },
        onProgress: (message) => {
          if (isRunActive(runId) && !signal.aborted) {
            emitPipelineProgress(PIPELINE_PHASES.LUCA_BUILD, message);
          }
        },
      }
    );
    assertPipelineSignal(signal, isRunActive, runId);

    lucaRef.current = lucaResult.standardLucaRows || [];
    unrecognizedCountRef.current = (lucaResult.unrecognizedItems || []).length;
    setLucaReady(true);
    setTotalLucaCount(lucaRef.current.length);
    setPreviewSummary((prev) => ({
      ...(prev || computeMovementPreviewSummary(movementsRef.current)),
      lucaRows: lucaRef.current.length,
      totalMovements: movementsRef.current.length,
    }));
    syncLucaPage(0);
    markAppliedDeclarationsPaid(lucaResult.declarationSummary);
    setCompletedSteps((prev) => ({ ...prev, luca: true }));
    setActiveStep("excel");
    const durationMs = Math.round(performance.now() - t0);
    setLastTimings((prev) => ({
      ...prev,
      lucaMs: durationMs,
      lucaChunk: LUCA_MOVEMENT_CHUNK_SIZE,
      lucaRows: lucaRef.current.length,
      lucaTimings: lucaResult.timings || null,
      lucaStats: lucaResult.lucaStats || null,
    }));

    // Deferred post-work (same as before) — do not block return
    const rowsSnapshot = lucaRef.current;
    const movementsSnapshot = movementsRef.current;
    const unrecognizedSnapshot = lucaResult.unrecognizedItems || [];
    const analysisCallCounts = lastTimings?.analysisCallCounts;
    const analysisTimings = lastTimings?.analysisTimings;
    const previousMissing =
      cariDecisionReport?.currentMissingCount ??
      cariDecisionReport?.previousMissingCount ??
      null;

    setTimeout(() => {
      if (!isRunActive(runId)) return;
      recordLearningMemoryUsage(rowsSnapshot.slice(0, 300)).catch(() => {});
      queueUnrecognizedFromWorker(unrecognizedSnapshot).catch(() => {});

      void (async () => {
        const yieldUi = () => new Promise((resolve) => setTimeout(resolve, 0));
        await yieldUi();
        if (!isRunActive(runId)) return;

        const missingReport = analyzeMissingHesapRows(rowsSnapshot);
        if (!isRunActive(runId)) return;
        setMissingHesapReport(missingReport);
        setPreviewSummary((prev) => ({
          ...(prev || {}),
          lucaRows: rowsSnapshot.length,
          ...computePreviewSummary(rowsSnapshot, null),
          totalMovements: movementsSnapshot.length,
        }));

        await yieldUi();
        if (!isRunActive(runId)) return;
        const grouped = groupUnresolvedRuleRows(rowsSnapshot, {
          companyPlans,
          movements: movementsSnapshot,
        });
        setRuleGroupReport(grouped);
        console.info("[ANNVERO][RULE-GROUPS]", {
          unresolved: grouped.totalUnresolved,
          groups: grouped.groupCount,
          top30CoveragePct: grouped.top30CoveragePct,
          top30Count: grouped.top30Coverage,
          safeFamilyGroups: grouped.safeFamilyGroupCount,
        });

        await yieldUi();
        if (!isRunActive(runId)) return;
        const cariGrouped = groupUnresolvedCariRows(rowsSnapshot, {
          companyPlans,
          movements: movementsSnapshot,
        });
        setCariGroupReport(cariGrouped);
        console.info("[ANNVERO][CARI-GROUPS]", {
          unresolved: cariGrouped.totalUnresolved,
          groups: cariGrouped.groupCount,
          top20CoveragePct: cariGrouped.top20CoveragePct,
          withSuggestion: (cariGrouped.top20 || []).filter((g) => g.suggestedAccount)
            .length,
        });

        if (analysisCallCounts || analysisTimings) {
          const decisionReport = buildCariDecisionReport({
            analysisStats: analysisCallCounts || {},
            timings: analysisTimings || {},
            previousMissingCount: previousMissing,
            currentMissingCount: missingReport.missingCount,
            cariGroupReport: cariGrouped,
          });
          setCariDecisionReport(decisionReport);
          console.info(
            "[ANNVERO][CARI-DECISION]",
            formatCariDecisionReportText(decisionReport)
          );
        }
      })();
    }, 0);

    return {
      lucaRowCount: lucaRef.current.length,
      unrecognizedCount: unrecognizedCountRef.current,
      durationMs,
      lucaStats: lucaResult.lucaStats || null,
    };
  };

  const runValidationStage = async ({ signal, runId }) => {
    const t0 = performance.now();
    assertPipelineSignal(signal, isRunActive, runId);
    const rows = lucaRef.current || [];
    const missingReport = analyzeMissingHesapRows(rows);
    setMissingHesapReport(missingReport);
    assertPipelineSignal(signal, isRunActive, runId);
    return {
      missingCount: missingReport.missingCount || 0,
      unrecognizedCount: unrecognizedCountRef.current || 0,
      readyCount: missingReport.readyCount || 0,
      totalRows: missingReport.totalRows || rows.length,
      durationMs: Math.round(performance.now() - t0),
    };
  };

  /** AŞAMA 1 — manuel */
  const handleCreatePreview = async () => {
    if (isJobBusy) return;
    if (!selectedCompanyId) {
      showToast("Önce firma seçmelisin.", "error");
      return;
    }
    if (!selectedFile) {
      showToast("Önce banka ekstresi dosyası seçmelisin.", "error");
      return;
    }
    const bank = getRunBank();
    if (!bank) {
      setPipelineError({
        phase: PIPELINE_PHASES.PARSING,
        phaseLabel: getPipelinePhaseTitle(PIPELINE_PHASES.PARSING),
        message: "Banka otomatik belirlenemedi. Lütfen bankayı seçin.",
        recoverable: false,
        tone: "error",
      });
      return;
    }

    const { runId, signal } = beginPipelineRun();
    setPipelineMode("manual");
    setPipelineError(null);
    setIsParsing(true);
    setActiveStep("preview");
    setPipelinePhaseSafe(PIPELINE_PHASES.PARSING);
    parserJob.begin({
      stage: BANK_PARSE_STAGES.READING,
      detail: "Dosya okunuyor",
    });

    try {
      const preview = await runPreviewStage({ signal, runId, bankName: bank });
      if (!isRunActive(runId) || signal.aborted) return;
      setIsParsing(false);
      parserJob.markSuccess(
        `${preview.movementCount} hareket önizlemede (muhasebe analizi ayrı)`
      );
      showToast(
        `${preview.movementCount} hareket hazır. Sonraki: Muhasebe Analizini Başlat.`,
        "success"
      );
      setPipelineMode("idle");
      setPipelinePhaseSafe(PIPELINE_PHASES.IDLE);
    } catch (error) {
      if (error?.name === "AbortError" || signal.aborted || !isRunActive(runId)) {
        setIsParsing(false);
        return;
      }
      logManagedPipelineIssue("preview failed", error);
      if (
        error?.code === "BANK_FORMAT_MISMATCH" &&
        error?.detectedBank &&
        (error.detectedBank === "VAKIFBANK" || error.detectedBank === "GARANTI")
      ) {
        const label =
          BANK_PARSER_OPTIONS.find((b) => b.id === error.detectedBank)?.label ||
          error.detectedBank;
        setActiveBank(error.detectedBank, {
          status: "detected",
          bankId: error.detectedBank,
          message: `${label} — otomatik tespit`,
        });
      }
      const detail = buildManagedFailureMessage(
        error,
        PIPELINE_PHASES.PREVIEW
      );
      setPreviewErrorDetail("");
      parserJob.reset();
      clearPreviewState({ resetParserJob: false });
      setPipelineError({
        phase: PIPELINE_PHASES.PREVIEW,
        phaseLabel: getPipelinePhaseTitle(PIPELINE_PHASES.PREVIEW),
        message:
          error?.code === "BANK_FORMAT_MISMATCH" && error?.detectedBank
            ? `Dosya ${error.detectedBank === "VAKIFBANK" ? "Vakıfbank" : "Garanti"} olarak algılandı. Banka seçimi güncellendi.`
            : detail,
        recoverable: Boolean(error?.code === "BANK_FORMAT_MISMATCH" && error?.detectedBank),
        tone:
          error?.code === "BANK_FORMAT_MISMATCH" && error?.detectedBank
            ? "info"
            : "error",
      });
      setPipelineMode("idle");
      setPipelinePhaseSafe(PIPELINE_PHASES.ERROR);
      // Hata yalnızca kartta — toast yok (çift mesaj önleme)
    } finally {
      if (isRunActive(runId)) setIsParsing(false);
    }
  };

  /** AŞAMA 2 — manuel */
  const handleStartAccountingAnalysis = async () => {
    if (isAnalyzing) return;
    if (isParsing || isPreparingLuca || isApplyingCoreAll) return;
    if (!movementsRef.current.length || !completedSteps.preview) {
      showToast("Önce ön izleme oluşturun.", "error");
      return;
    }

    const { runId, signal } = beginPipelineRun();
    const releaseAnalysisLock = () => setIsAnalyzing(false);
    setPipelineMode("manual");
    setPipelineError(null);
    setIsAnalyzing(true);
    setActiveStep("analysis");
    setPipelinePhaseSafe(PIPELINE_PHASES.ACCOUNTING_ANALYSIS);
    parserJob.begin({
      stage: BANK_PARSE_STAGES.ANALYSIS,
      detail: "Muhasebe kuralları uygulanıyor",
    });

    try {
      const analysis = await runAccountingAnalysisStage({
        signal,
        runId,
        bankName: getRunBank(),
      });
      if (!isRunActive(runId) || signal.aborted) {
        releaseAnalysisLock();
        return;
      }
      parserJob.markSuccess(
        `Muhasebe analizi tamamlandı (${analysis.movementCount} hareket · ${analysis.uniqueCount || "?"} grup)`
      );
      const legacyUnique = analysis.result?.uniqueReport?.legacyUniqueCount;
      showToast(
        analysis.uniqueCount
          ? `Yerel analiz tamam (${analysis.uniqueCount} grup${
              legacyUnique ? ` / eski ${legacyUnique} unique` : ""
            } · ${analysis.movementCount} hareket).`
          : "Yerel muhasebe analizi tamamlandı. Sonraki: Luca Satırlarını Hazırla.",
        "success"
      );
      setPipelineMode("idle");
      setPipelinePhaseSafe(PIPELINE_PHASES.IDLE);
    } catch (error) {
      if (error?.name === "AbortError" || signal.aborted || !isRunActive(runId)) {
        releaseAnalysisLock();
        return;
      }
      logManagedPipelineIssue("accounting analysis failed", error, {
        movementCount: movementsRef.current.length,
      });
      parserJob.reset();
      setPipelinePhaseSafe(PIPELINE_PHASES.ERROR);
      setPipelineError({
        phase: PIPELINE_PHASES.ACCOUNTING_ANALYSIS,
        phaseLabel: getPipelinePhaseTitle(PIPELINE_PHASES.ACCOUNTING_ANALYSIS),
        message: userFacingPipelineError(PIPELINE_PHASES.ACCOUNTING_ANALYSIS),
        recoverable: true,
        tone: "error",
      });
      setPipelineMode("idle");
    } finally {
      releaseAnalysisLock();
    }
  };

  /** AŞAMA 3 — manuel */
  const handlePrepareLuca = async () => {
    if (isPreparingLuca) return;
    if (isParsing || isAnalyzing || isApplyingCoreAll) return;
    if (!movementsRef.current.length) {
      showToast("Önce ön izleme oluşturun.", "error");
      return;
    }
    if (!accountingAnalyzed) {
      showToast("Önce Muhasebe Analizini Başlatın.", "error");
      return;
    }

    const { runId, signal } = beginPipelineRun();
    const releaseLucaLock = () => setIsPreparingLuca(false);
    setPipelineMode("manual");
    setPipelineError(null);
    setIsPreparingLuca(true);
    setActiveStep("luca");
    setPipelinePhaseSafe(PIPELINE_PHASES.LUCA_BUILD);
    parserJob.begin({
      stage: BANK_PARSE_STAGES.LUCA,
      detail: `Luca satırları hazırlanıyor (chunk ${LUCA_MOVEMENT_CHUNK_SIZE})`,
    });

    try {
      const luca = await runLucaBuildStage({
        signal,
        runId,
        bankName: getRunBank(),
      });
      if (!isRunActive(runId) || signal.aborted) {
        releaseLucaLock();
        return;
      }
      parserJob.markSuccess(
        `${luca.lucaRowCount} Luca satırı hazır (${movementsRef.current.length} hareket × çift taraflı)`
      );
      const stats = luca.lucaStats;
      showToast(
        stats
          ? `${stats.lucaRows} Luca satırı (${stats.movementsWith2Rows} hareket → 2 satır). Excel kullanılabilir.`
          : `${luca.lucaRowCount} Luca satırı hazır. Excel kullanılabilir.`,
        "success"
      );
      setPipelineMode("idle");
      setPipelinePhaseSafe(PIPELINE_PHASES.IDLE);
    } catch (error) {
      if (error?.name === "AbortError" || signal.aborted || !isRunActive(runId)) {
        releaseLucaLock();
        return;
      }
      logManagedPipelineIssue("luca prepare failed", error);
      parserJob.reset();
      setPipelinePhaseSafe(PIPELINE_PHASES.ERROR);
      setPipelineError({
        phase: PIPELINE_PHASES.LUCA_BUILD,
        phaseLabel: getPipelinePhaseTitle(PIPELINE_PHASES.LUCA_BUILD),
        message: userFacingPipelineError(PIPELINE_PHASES.LUCA_BUILD),
        recoverable: true,
        tone: "error",
      });
      setPipelineMode("idle");
    } finally {
      releaseLucaLock();
    }
  };

  /** Tek tuş — tek runId / tek AbortController */
  const runFullBankPipeline = async ({ resumeFrom = null } = {}) => {
    if (isJobBusy) {
      showToast("Başka bir işlem sürüyor.", "error");
      return;
    }
    if (!selectedCompanyId) {
      showToast("Önce firma seçmelisin.", "error");
      return;
    }
    if (!selectedFile) {
      showToast("Önce dosya seçmelisin.", "error");
      return;
    }
    const runBank = getRunBank();
    if (!runBank) {
      setPipelineError({
        phase: PIPELINE_PHASES.PARSING,
        phaseLabel: getPipelinePhaseTitle(PIPELINE_PHASES.PARSING),
        message: "Banka otomatik belirlenemedi. Lütfen bankayı seçin.",
        recoverable: false,
        tone: "error",
      });
      setPipelinePhaseSafe(PIPELINE_PHASES.ERROR);
      return;
    }

    if (
      !canStartFullPipeline({
        selectedCompanyId,
        selectedBank: runBank,
        selectedFile,
        isJobBusy: false,
        pipelinePhase,
      })
    ) {
      return;
    }

    const { runId, signal } = beginPipelineRun();
    const tPipeline0 = performance.now();
    const stageDurations = {};
    // Run context — state flush beklemeden sabit banka
    activeBankRef.current = runBank;
    setPipelineRunning(true);
    setPipelineMode("auto");
    setPipelineError(null);
    if (!resumeFrom) setPipelineResult(null);
    setPreviewErrorDetail("");

    parserJob.begin({
      stage: "Banka Ekstresi İşleniyor",
      detail: "Dosya okunuyor…",
    });

    let failedPhase = null;
    try {
      if (
        shouldRunPipelineStage(resumeFrom, "PARSING") ||
        shouldRunPipelineStage(resumeFrom, "PREVIEW")
      ) {
        setIsParsing(true);
        setActiveStep("preview");
        setPipelinePhaseSafe(PIPELINE_PHASES.PARSING);
        emitPipelineProgress(PIPELINE_PHASES.PARSING, {
          percent: 5,
          detail: "Dosya okunuyor…",
        });
        assertPipelineSignal(signal, isRunActive, runId);
        const preview = await runPreviewStage({
          signal,
          runId,
          bankName: runBank,
        });
        stageDurations.previewMs = preview.durationMs;
        stageDurations.parseMode = preview.parseMode;
        stageDurations.bankName = preview.bankName || runBank;
        setIsParsing(false);
      }

      if (shouldRunPipelineStage(resumeFrom, "ACCOUNTING_ANALYSIS")) {
        assertPipelineSignal(signal, isRunActive, runId);
        setIsAnalyzing(true);
        setActiveStep("analysis");
        setPipelinePhaseSafe(PIPELINE_PHASES.ACCOUNTING_ANALYSIS);
        emitPipelineProgress(PIPELINE_PHASES.ACCOUNTING_ANALYSIS, {
          percent: 0,
          detail: "Muhasebe kuralları uygulanıyor…",
        });
        const analysis = await runAccountingAnalysisStage({
          signal,
          runId,
          bankName: runBank,
        });
        stageDurations.analysisMs = analysis.durationMs;
        setIsAnalyzing(false);
      }

      if (shouldRunPipelineStage(resumeFrom, "LUCA_BUILD")) {
        assertPipelineSignal(signal, isRunActive, runId);
        if (
          resumeFrom === "LUCA_BUILD" &&
          !accountingAnalyzed &&
          !movementsRef.current.some((m) => m?._accountingAnalyzed)
        ) {
          throw new Error("Önce Muhasebe Analizini Başlatın.");
        }
        setIsPreparingLuca(true);
        setActiveStep("luca");
        setPipelinePhaseSafe(PIPELINE_PHASES.LUCA_BUILD);
        emitPipelineProgress(PIPELINE_PHASES.LUCA_BUILD, {
          percent: 0,
          detail: "Luca fiş satırları hazırlanıyor…",
        });
        const luca = await runLucaBuildStage({
          signal,
          runId,
          bankName: runBank,
        });
        stageDurations.lucaMs = luca.durationMs;
        setIsPreparingLuca(false);
      }

      if (shouldRunPipelineStage(resumeFrom, "VALIDATION")) {
        assertPipelineSignal(signal, isRunActive, runId);
        setPipelinePhaseSafe(PIPELINE_PHASES.VALIDATION);
        emitPipelineProgress(PIPELINE_PHASES.VALIDATION, {
          percent: 50,
          detail: "Eksik hesaplar kontrol ediliyor…",
        });
        const validation = await runValidationStage({ signal, runId });
        stageDurations.validationMs = validation.durationMs;

        const totalDurationMs = Math.round(performance.now() - tPipeline0);
        const result = {
          movementCount: movementsRef.current.length,
          lucaRowCount: lucaRef.current.length,
          missingCount: validation.missingCount,
          unrecognizedCount: validation.unrecognizedCount,
          readyCount: validation.readyCount,
          autoMatchedCount: deriveAutoMatchedMovements(validation.readyCount),
          totalDurationMs,
          stageDurations,
          parseMode: stageDurations.parseMode || null,
        };
        setPipelineResult(result);
        setPipelinePhaseSafe(PIPELINE_PHASES.READY_FOR_EXPORT);
        setPipelineProgress({
          percent: 100,
          label: "Luca dosyanız hazır.",
          detail: validation.missingCount
            ? `${validation.missingCount} eksik hesap satırı var — Excel’i yine hazırlayabilirsiniz.`
            : "Luca dosyanız hazır.",
          processed: result.movementCount,
          total: result.movementCount,
        });
        parserJob.markSuccess("Luca dosyanız hazır.");
        setPipelineMode("idle");
        showToast(
          validation.missingCount
            ? `İşlem tamamlandı. ${result.lucaRowCount} Luca satırı · ${validation.missingCount} eksik hesap.`
            : `İşlem tamamlandı. ${result.lucaRowCount} Luca satırı hazır.`,
          "success"
        );
      }
    } catch (error) {
      setIsParsing(false);
      setIsAnalyzing(false);
      setIsPreparingLuca(false);
      if (error?.name === "AbortError" || signal.aborted || !isRunActive(runId)) {
        setPipelinePhaseSafe(PIPELINE_PHASES.CANCELLED);
        setPipelineMode("idle");
        return;
      }
      failedPhase = pipelinePhaseRef.current || PIPELINE_PHASES.ERROR;
      logManagedPipelineIssue("full pipeline failed", error, {
        phase: failedPhase,
      });
      if (
        error?.code === "BANK_FORMAT_MISMATCH" &&
        error?.detectedBank &&
        (error.detectedBank === "VAKIFBANK" || error.detectedBank === "GARANTI")
      ) {
        const label =
          BANK_PARSER_OPTIONS.find((b) => b.id === error.detectedBank)?.label ||
          error.detectedBank;
        setActiveBank(error.detectedBank, {
          status: "detected",
          bankId: error.detectedBank,
          message: `${label} — otomatik tespit`,
        });
      }
      const message =
        error?.code === "BANK_FORMAT_MISMATCH" && error?.detectedBank
          ? `Dosya ${error.detectedBank === "VAKIFBANK" ? "Vakıfbank" : "Garanti"} olarak algılandı. Banka seçimi güncellendi.`
          : buildManagedFailureMessage(error, failedPhase);
      if (
        error?.code === "BANK_FORMAT_MISMATCH" ||
        failedPhase === PIPELINE_PHASES.PARSING ||
        failedPhase === PIPELINE_PHASES.PREVIEW
      ) {
        if (!movementsRef.current.length) {
          clearPreviewState({ resetParserJob: false });
        }
      }
      parserJob.reset();
      setPreviewErrorDetail("");
      setPipelineError({
        phase: failedPhase,
        phaseLabel: getPipelinePhaseTitle(failedPhase),
        message,
        recoverable:
          Boolean(error?.code === "BANK_FORMAT_MISMATCH" && error?.detectedBank) ||
          (failedPhase !== PIPELINE_PHASES.PARSING &&
          failedPhase !== PIPELINE_PHASES.PREVIEW
            ? Boolean(movementsRef.current.length)
            : false),
        tone:
          error?.code === "BANK_FORMAT_MISMATCH" && error?.detectedBank
            ? "info"
            : "error",
      });
      setPipelinePhaseSafe(PIPELINE_PHASES.ERROR);
      setPipelineMode("idle");
      // Hata yalnızca kartta — toast yok
    } finally {
      setPipelineRunning(false);
    }
  };

  const handleRetryPipeline = () => {
    // Format auto-fix sonrası veya recover edilemeyen durumda baştan çalıştır.
    if (
      !pipelineError?.recoverable ||
      !pipelineError?.phase ||
      pipelineError.phase === PIPELINE_PHASES.PARSING ||
      pipelineError.phase === PIPELINE_PHASES.PREVIEW
    ) {
      void runFullBankPipeline();
      return;
    }
    void runFullBankPipeline({ resumeFrom: pipelineError.phase });
  };

  const handleApplyCoreToAllRows = async () => {
    if (!isAnnveroCoreEnabled() || !normalizedRef.current.length || isJobBusy) return;

    const { runId, signal } = beginPipelineRun();
    setIsApplyingCoreAll(true);
    parserJob.begin({
      stage: "ANNVERO CORE",
      detail: `Tüm satırlara CORE uygulanıyor (${normalizedRef.current.length})`,
    });

    try {
      const mapped = await remapMovementsWithCoreAsync({
        ...buildPipelineOptions(normalizedRef.current, Infinity),
        signal,
        totalBudgetMs: 120_000,
      });

      if (!isRunActive(runId) || signal.aborted) return;

      movementsRef.current = mapped.movements || [];
      setAccountingAnalyzed(true);
      setCoreIntegrationSummary(computeCoreIntegrationSummary(movementsRef.current));
      setCoreRowsProcessed(normalizedRef.current.length);
      syncMovementPage(movementPage);
      lucaRef.current = [];
      setLucaReady(false);
      setStandardLucaRows([]);
      setTotalLucaCount(0);
      setPreviewSummary(computeMovementPreviewSummary(movementsRef.current));
      setCompletedSteps((prev) => ({
        ...prev,
        analysis: true,
        luca: false,
        excel: false,
      }));

      parserJob.markSuccess(`CORE ${movementsRef.current.length} harekette tamamlandı`);
      if (mapped.coreSummary?.userWarning) {
        showToast(mapped.coreSummary.userWarning, "error");
      } else {
        showToast(
          `CORE tüm ${movementsRef.current.length} harekete uygulandı. Luca’yı yeniden hazırlayın.`,
          "success"
        );
      }
    } catch (error) {
      if (error?.name === "AbortError" || signal.aborted) return;
      console.error("[banka-ekstresi] CORE apply-all failed", error);
      showToast(error?.message || "CORE tüm satırlara uygulanamadı.", "error");
      parserJob.markError(error);
    } finally {
      if (isRunActive(runId)) setIsApplyingCoreAll(false);
    }
  };

  const corePreviewMovements = movementRows;
  const canRunOptionalCore =
    isAnnveroCoreEnabled() && accountingAnalyzed && totalMovementCount > 0;

  const requestCoreTeach = (movement, row = {}) => {
    if (!selectedCompanyId || !movement) return;

    if (isCoreStatusUnknown(movement)) {
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
      return;
    }

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
    const movement = row?._movementId ? getFullMovement(row._movementId) : null;
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
    isCoreEnabled: isAnnveroCoreEnabled(),
  };

  const showCoreTeachForMovement = (movement, row = {}) =>
    shouldShowCoreTeachButton(row, movement, coreTeachOptions);

  const showCoreTeachForLucaRow = (row) => {
    const movement = row?._movementId
      ? getFullMovement(row._movementId)
      : null;
    if (
      isAnnveroCoreEnabled() &&
      (isCoreStatusUnknown(movement) || isCoreStatusUnknown(row))
    ) {
      return !isMovementTaughtForDisplay(movement || {}, row);
    }
    return showCoreTeachForMovement(movement, row);
  };

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

      const updatedMovement = {
        ...mergeCoreDecisionIntoMovement(teachMovement, result?.core_decision || null),
        _knowledgeTeachSaved: true,
      };

      movementsRef.current = movementsRef.current.map((row) =>
        row.id === teachMovement.id ? updatedMovement : row
      );
      setCoreIntegrationSummary(
        computeCoreIntegrationSummary(movementsRef.current)
      );
      setMovementRows((prev) =>
        prev.map((row) =>
          row.id === teachMovement.id ? slimMovementForUi(updatedMovement) : row
        )
      );

      const saveMeta = result?.save || {};
      const recognizedAfterTeach =
        isMovementTaughtForDisplay(updatedMovement) ||
        isCoreAlreadyRecognized(updatedMovement, {});

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
    <div className="w-full min-w-0 max-w-full pb-6">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur-sm ${
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
      <div className="mb-6 min-w-0">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Banka Parser Merkezi
        </h1>
        {showBankServiceUi ? (
          <p className="mt-2 text-sm text-slate-400">
            Tanınmayan işlemler otomatik olarak{" "}
            <Link
              href="/muhasebe/islem-hafizasi"
              className="font-semibold text-indigo-300 transition hover:text-indigo-200"
            >
              İşlem Hafızası / Öğrenme Merkezi
            </Link>
            &apos;ne düşer.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            Ekstre dosyasını seçin, banka otomatik tespit edilir ve işlem tek tuşla tamamlanır.
          </p>
        )}
      </div>

      <div className="grid w-full min-w-0 max-w-full gap-5">
        <div className={annveroCardClass}>
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-950/50 px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Aktif Firma
            </span>
            {isLoadingCompanies && !selectedCompany ? (
              <span className="h-5 w-40 animate-pulse rounded bg-slate-800/60" />
            ) : (
              <span className="text-sm font-semibold text-white">
                {selectedCompany ? getCompanyDisplayName(selectedCompany) : "Firma seçilmedi"}
              </span>
            )}
          </div>

          <div className="mb-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Dosya
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label
                className={`cursor-pointer rounded-xl px-5 py-2.5 text-sm font-semibold transition ${annveroBtnPrimary} ${
                  isJobBusy ? "pointer-events-none opacity-60" : ""
                }`}
              >
                Dosya Seç
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileSelect}
                  disabled={isJobBusy}
                  className="hidden"
                />
              </label>
              <span className="text-sm text-gray-300">
                {fileName ? (
                  <span className="font-semibold text-white">{fileName}</span>
                ) : (
                  <span className="text-gray-400">Henüz dosya seçilmedi</span>
                )}
              </span>
            </div>
          </div>

          {selectedFile ? (
            <div className="mb-5">
              {bankDetection.status === "pending" ? (
                <p className="text-xs text-slate-400">{bankDetection.message}</p>
              ) : null}

              {bankDetection.status === "detected" ? (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Banka
                  </p>
                  <p className="text-sm font-semibold text-emerald-200">
                    {bankDetection.message ||
                      `${
                        BANK_PARSER_OPTIONS.find((b) => b.id === selectedBank)
                          ?.label || selectedBank
                      } — otomatik tespit`}
                  </p>
                </div>
              ) : null}

              {bankDetection.status === "unknown" ? (
                <div>
                  <p className="mb-2 text-sm text-amber-200/95">
                    Banka otomatik belirlenemedi. Lütfen bankayı seçin.
                  </p>
                  <select
                    value={selectedBank || ""}
                    disabled={isJobBusy || isLoadingCompanies}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!next) return;
                      const label =
                        BANK_PARSER_OPTIONS.find((b) => b.id === next)?.label ||
                        next;
                      setActiveBank(next, {
                        status: "manual",
                        bankId: next,
                        message: `${label} — elle seçildi`,
                      });
                      setPipelineError(null);
                      setPreviewErrorDetail("");
                    }}
                    className={`w-full max-w-xl disabled:opacity-60 ${annveroInputClass}`}
                  >
                    <option value="">Banka seçin…</option>
                    {BANK_PARSER_OPTIONS.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {bankDetection.status === "manual" && selectedBank ? (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Banka
                  </p>
                  <p className="text-sm font-semibold text-slate-100">
                    {bankDetection.message ||
                      `${
                        BANK_PARSER_OPTIONS.find((b) => b.id === selectedBank)
                          ?.label || selectedBank
                      } — elle seçildi`}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <button
              type="button"
              onClick={() => void runFullBankPipeline()}
              disabled={
                isJobBusy ||
                !selectedCompanyId ||
                !selectedFile ||
                !getRunBank() ||
                bankDetection.status === "pending" ||
                bankDetection.status === "unknown"
              }
              className={`w-full max-w-xl rounded-xl px-7 py-3.5 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${annveroBtnPrimary}`}
            >
              {isJobBusy && pipelineMode === "auto"
                ? "İşleniyor…"
                : pipelinePhase === PIPELINE_PHASES.READY_FOR_EXPORT
                  ? "Yeniden İşle"
                  : "Ekstreyi İşle"}
            </button>
          </div>

          <BankPipelineProgressPanel
            visible={
              (pipelineMode === "auto" && isJobBusy) ||
              (pipelineRunning && pipelineMode === "auto")
            }
            phase={pipelinePhase}
            label={pipelineProgress.label}
            detail={pipelineProgress.detail}
            percent={pipelineProgress.percent}
            elapsedSeconds={elapsedSec}
            processed={
              showBankServiceUi ? pipelineProgress.processed : null
            }
            total={showBankServiceUi ? pipelineProgress.total : null}
            errorPhase={pipelineError?.phase}
            onCancel={isJobBusy ? handleCancelJob : undefined}
          />

          {showBankServiceUi && pipelineMode === "manual" && isJobBusy ? (
            <ParserJobProgress
              visible
              stage={parserJob.stage}
              detail={parserJob.detail}
              percent={parserJob.percent}
              timeoutWarning={parserJob.timeoutWarning}
              status={parserJob.status}
              error=""
              onCancel={handleCancelJob}
              className="mt-4"
            />
          ) : null}

          <BankPipelineErrorCard
            error={pipelineError}
            disabled={isJobBusy}
            onRetry={handleRetryPipeline}
            onOpenManual={
              showBankServiceUi
                ? () => {
                    if (manualDetailsRef.current) {
                      manualDetailsRef.current.open = true;
                      manualDetailsRef.current.scrollIntoView({
                        behavior: "smooth",
                        block: "nearest",
                      });
                    }
                  }
                : undefined
            }
          />

          {pipelinePhase === PIPELINE_PHASES.READY_FOR_EXPORT && pipelineResult ? (
            <BankPipelineResultCard
              result={pipelineResult}
              isExporting={isExporting}
              lucaReady={lucaReady}
              onDownloadExcel={() => exportExcel()}
              onReviewMissing={handleReviewMissingAccounts}
              onPartialExport={handlePartialExportConfirm}
              onGoToLucaProducer={handleGoToLucaProducer}
              secondaryBtnClass={annveroBtnSecondary}
              isReviewMissingLoading={cariResolutionLoading}
            />
          ) : null}

          {showBankServiceUi && previewErrorDetail && !pipelineError ? (
            <p className="mt-2 rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {previewErrorDetail}
            </p>
          ) : null}

          {showBankServiceUi &&
          rawCount > 0 &&
          !isParsing &&
          pipelinePhase !== PIPELINE_PHASES.READY_FOR_EXPORT ? (
            <p className="mt-4 text-sm text-green-400">
              Ham dosyadan {rawCount} satır okundu
              {totalMovementCount > 0 ? ` · ${totalMovementCount} hareket` : ""}.
              {!lucaReady && totalMovementCount > 0
                ? " Luca satırları henüz hazır değil."
                : ""}
            </p>
          ) : null}
        </div>

        {/* Gelişmiş / Manuel Kontrol: yalnızca servis/debug — normal kullanıcıda hiç mount edilmez */}
        {showBankServiceUi ? (
        <details
          ref={manualDetailsRef}
          className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-950/40 px-4 py-3"
        >
          <summary className="cursor-pointer select-none text-sm font-semibold text-slate-200">
            Gelişmiş / Manuel Kontrol
          </summary>
          <p className="mt-2 text-xs text-slate-500">
            Firma durumu, aşama rozetleri ve tek tek işlem butonları.
          </p>

          {selectedCompany && !isLoadingCompanies ? (
            <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                <h3 className="text-sm font-semibold text-gray-100">
                  Firma Kontrol Özeti
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            </div>
          ) : null}

          <div className="mt-4 flex min-w-0 flex-wrap gap-2">
            {PIPELINE_STEPS.map((step) => {
              const done = completedSteps[step.id];
              const active = activeStep === step.id && isJobBusy;
              const tone = done
                ? "border-emerald-600/50 bg-emerald-950/40 text-emerald-200"
                : active
                  ? "border-sky-500/50 bg-sky-950/50 text-sky-100"
                  : "border-slate-700 bg-slate-950/40 text-slate-400";
              return (
                <div
                  key={step.id}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${tone}`}
                >
                  {step.label}
                  {done ? " ✓" : active ? " …" : ""}
                </div>
              );
            })}
          </div>

          <label className="mb-2 mt-4 block text-xs font-medium text-slate-400">
            Banka (manuel değişiklik — otomatik tespiti geçersiz kılar)
          </label>
          <select
            value={selectedBank || ""}
            disabled={isJobBusy || isLoadingCompanies || !selectedFile}
            onChange={(e) => {
              const next = e.target.value;
              if (!next) return;
              const label =
                BANK_PARSER_OPTIONS.find((b) => b.id === next)?.label || next;
              setActiveBank(next, {
                status: "manual",
                bankId: next,
                message: `${label} — elle seçildi`,
              });
              setPipelineError(null);
              setPreviewErrorDetail("");
            }}
            className={`mb-3 w-full max-w-xl disabled:opacity-60 ${annveroInputClass}`}
          >
            <option value="">Banka seçin…</option>
            {BANK_PARSER_OPTIONS.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.label}
              </option>
            ))}
          </select>

          <div className="mt-3 flex min-w-0 flex-wrap gap-3">
            <button
              type="button"
              onClick={handleCreatePreview}
              disabled={isJobBusy || !selectedFile}
              className={`rounded-xl px-6 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${annveroBtnPrimary}`}
            >
              {isParsing ? parserJob.stage || "İşleniyor…" : "Ön İzleme Oluştur"}
            </button>

            <button
              type="button"
              onClick={handleStartAccountingAnalysis}
              disabled={
                isAnalyzing ||
                !completedSteps.preview ||
                isParsing ||
                isPreparingLuca ||
                isApplyingCoreAll ||
                pipelineMode === "auto"
              }
              className="rounded-xl border border-indigo-600/60 bg-indigo-950 px-6 py-3 font-semibold text-indigo-100 transition hover:bg-indigo-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAnalyzing
                ? parserJob.detail || parserJob.stage || "Analiz ediliyor…"
                : "Muhasebe Analizini Başlat"}
            </button>

            <button
              type="button"
              onClick={handlePrepareLuca}
              disabled={isJobBusy || !accountingAnalyzed}
              className="rounded-xl border border-amber-600/60 bg-amber-950 px-6 py-3 font-semibold text-amber-100 transition hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPreparingLuca
                ? parserJob.stage || "Luca hazırlanıyor…"
                : "Luca Satırlarını Hazırla"}
            </button>

            <button
              type="button"
              onClick={() => exportExcel()}
              disabled={isJobBusy || isExporting || !lucaReady}
              title={
                lucaReady
                  ? "Luca Excel oluştur"
                  : "Önce Luca Satırlarını Hazırla"
              }
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting ? "Excel hazırlanıyor…" : "Luca Excel Oluştur"}
            </button>

            {lucaReady && (missingHesapReport?.missingCount || 0) > 0 ? (
              <>
                <button
                  type="button"
                  onClick={handleReviewMissingAccounts}
                  disabled={cariResolutionLoading}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-600/60 bg-rose-950 px-4 py-3 text-sm font-semibold text-rose-100 hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cariResolutionLoading ? (
                    <>
                      <span
                        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-rose-200/30 border-t-rose-100"
                        aria-hidden="true"
                      />
                      Hazırlanıyor…
                    </>
                  ) : (
                    <>
                      Eksik Hesapları İncele ({missingHesapReport.missingCount})
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadMissingReport}
                  className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-800"
                >
                  Eksik Raporu İndir
                </button>
                <button
                  type="button"
                  onClick={handlePartialExportConfirm}
                  disabled={isJobBusy || isExporting}
                  className="rounded-xl border border-amber-600/60 bg-amber-950 px-4 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-900 disabled:opacity-50"
                >
                  Eksik satırları hariç tutarak devam et
                </button>
              </>
            ) : null}

            <button
              type="button"
              onClick={handleGoToLucaProducer}
              className={annveroBtnSecondary}
            >
              Luca Fiş Üretici →
            </button>
          </div>
        </details>
        ) : null}

        {showBankServiceUi && missingHesapReport?.missingCount > 0 ? (
          <div className="rounded-xl border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
            <p className="font-semibold">
              Eksik hesap: {missingHesapReport.missingCount} /{" "}
              {missingHesapReport.totalRows} (hazır {missingHesapReport.readyCount})
            </p>
            <ul className="mt-2 list-inside list-disc text-xs text-rose-100/90">
              {(missingHesapReport.categories || []).map((item) => (
                <li key={item.category}>
                  <button
                    type="button"
                    className="underline decoration-rose-400/60 hover:text-white"
                    onClick={() => {
                      setPreviewQuickFilter("missingAccount");
                      if (item.category === "Kural bulunamadı") {
                        setSelectedRuleGroupKey("");
                      }
                    }}
                  >
                    {item.category}: {item.count}
                  </button>
                  {item.samples?.[0]?.aciklama
                    ? ` — örn. ${String(item.samples[0].aciklama).slice(0, 60)}`
                    : ""}
                </li>
              ))}
            </ul>
            {missingHesapReport.personelSubtypeCounts &&
            Object.keys(missingHesapReport.personelSubtypeCounts).length > 0 ? (
              <p className="mt-2 text-xs text-rose-200/70">
                Personel alt dağılım:{" "}
                {Object.entries(missingHesapReport.personelSubtypeCounts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              </p>
            ) : null}
            {missingHesapReport.vergiSubtypeCounts &&
            Object.keys(missingHesapReport.vergiSubtypeCounts).length > 0 ? (
              <p className="mt-1 text-xs text-rose-200/70">
                Vergi/SGK alt tür:{" "}
                {Object.entries(missingHesapReport.vergiSubtypeCounts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-rose-200/80">
              Tam Excel engellendi. İnceleyin veya açıkça kısmi export seçin. Kayıtlar
              sessizce atılmaz.
            </p>
          </div>
        ) : null}

        {showBankServiceUi && cariDecisionReport ? (
          <div className="rounded-xl border border-teal-700/40 bg-teal-950/30 px-4 py-3 text-sm text-teal-100">
            <p className="font-semibold">Cari karar özeti</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-teal-100/90">
              {formatCariDecisionReportText(cariDecisionReport)}
            </pre>
          </div>
        ) : null}

        {showBankServiceUi && memoryDecisionReport ? (
          <div className="rounded-xl border border-violet-700/40 bg-violet-950/30 px-4 py-3 text-sm text-violet-100">
            <p className="font-semibold">Hafıza karar özeti</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-violet-100/90">
              {formatMemoryDecisionReportText(memoryDecisionReport)}
            </pre>
          </div>
        ) : null}

        {showBankServiceUi && cariGroupReport?.totalUnresolved > 0 ? (
          <div className="rounded-xl border border-cyan-700/40 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-100">
            <p className="font-semibold">
              Cari bulunamadı grupları: {cariGroupReport.totalUnresolved} satır ·{" "}
              {cariGroupReport.groupCount} grup · İlk 20 kapsama{" "}
              {cariGroupReport.top20CoveragePct}%
            </p>
            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto text-xs">
              {(cariGroupReport.top20 || []).map((group) => (
                <div
                  key={group.analysisKey}
                  className="rounded-lg border border-cyan-800/50 bg-slate-950/50 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="font-semibold text-left hover:underline"
                      onClick={() => {
                        setPreviewQuickFilter("missingAccount");
                        setPreviewSearch(group.samples?.[0]?.slice(0, 40) || "");
                      }}
                    >
                      {group.count}× · {group.extractedParty || "cari adayı yok"}
                    </button>
                    <span className="text-cyan-200/80">
                      {group.directions.join("/")}
                      {group.hasIban ? " · IBAN" : ""}
                      {group.hasVergiNo ? " · VKN" : ""}
                      {group.suggestedAccount
                        ? ` · ${group.suggestedAccount} (${group.confidence}%)`
                        : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-cyan-100/70">
                    {group.samples?.[0] || group.analysisKey}
                  </p>
                  <p className="mt-1 text-cyan-200/60">
                    {group.matchReason !== "eşleşmedi"
                      ? `${group.matchReason} · `
                      : ""}
                    {group.whyUnmatched}
                  </p>
                  {group.suggestedAccount ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded border border-slate-600/50 bg-slate-900/40 px-2 py-1 text-slate-100"
                        onClick={() => {
                          const sampleRow = lucaRef.current.find((row) =>
                            (group.rowIds || []).includes(row.id)
                          );
                          if (!sampleRow) return;
                          handleApplyHesapToSingleRow(
                            sampleRow,
                            group.suggestedAccount,
                            { learn: false }
                          );
                        }}
                      >
                        Sadece bu satır
                      </button>
                      <button
                        type="button"
                        className="rounded border border-emerald-700/50 bg-emerald-950/40 px-2 py-1 text-emerald-100"
                        onClick={() => {
                          const sampleRow = lucaRef.current.find((row) =>
                            (group.rowIds || []).includes(row.id)
                          );
                          if (!sampleRow) return;
                          handleApplyHesapToAnalysisGroup(
                            { ...sampleRow, analysisKey: group.analysisKey },
                            group.suggestedAccount,
                            { learn: false }
                          );
                        }}
                      >
                        Bu gruba uygula
                      </button>
                      <button
                        type="button"
                        className="rounded border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-amber-100"
                        onClick={() => {
                          const sampleRow = lucaRef.current.find((row) =>
                            (group.rowIds || []).includes(row.id)
                          );
                          if (!sampleRow) return;
                          handleApplyHesapToAnalysisGroup(
                            { ...sampleRow, analysisKey: group.analysisKey },
                            group.suggestedAccount,
                            { learn: true }
                          );
                        }}
                      >
                        Bu gruba uygula + firma için öğren
                      </button>
                      <button
                        type="button"
                        className="rounded border border-fuchsia-700/50 bg-fuchsia-950/40 px-2 py-1 text-fuchsia-100"
                        onClick={() => {
                          const sampleRow = lucaRef.current.find((row) =>
                            (group.rowIds || []).includes(row.id)
                          );
                          if (!sampleRow) return;
                          handleApplyHesapToAnalysisGroup(
                            { ...sampleRow, analysisKey: group.analysisKey },
                            group.suggestedAccount,
                            { learn: true, similar: true }
                          );
                        }}
                      >
                        Bu firmada benzer açıklamalara uygula
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showBankServiceUi && ruleGroupReport?.totalUnresolved > 0 ? (
          <div className="rounded-xl border border-indigo-700/40 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-100">
            <p className="font-semibold">
              Kural bulunamadı grupları: {ruleGroupReport.totalUnresolved} satır ·{" "}
              {ruleGroupReport.groupCount} grup · İlk 30 kapsama{" "}
              {ruleGroupReport.top30CoveragePct}%
            </p>
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs">
              {(ruleGroupReport.top30 || []).map((group) => (
                <div
                  key={group.analysisKey}
                  className="rounded-lg border border-indigo-800/50 bg-slate-950/50 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="font-semibold text-left hover:underline"
                      onClick={() => {
                        setSelectedRuleGroupKey(group.analysisKey);
                        setPreviewQuickFilter("missingAccount");
                        setPreviewSearch(group.samples?.[0]?.slice(0, 40) || "");
                      }}
                    >
                      {group.count}× · {group.suggestedFamily}
                    </button>
                    <span className="text-indigo-200/80">
                      {group.directions.join("/")} · öneri{" "}
                      {group.suggestedAccount || "—"}
                    </span>
                  </div>
                  <p className="mt-1 text-indigo-100/70">
                    {group.samples?.[0] || group.analysisKey}
                  </p>
                  <p className="mt-1 text-indigo-200/60">
                    {group.directions.join("/")} ·{" "}
                    {group.amountMin === group.amountMax
                      ? `${group.amountMin}`
                      : `${group.amountMin}–${group.amountMax}`}{" "}
                    · {group.whyUnmatched}
                  </p>
                  {group.suggestedAccount ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded border border-slate-600/50 bg-slate-900/40 px-2 py-1 text-slate-100"
                        onClick={() => {
                          const sampleRow = lucaRef.current.find((row) =>
                            (group.rowIds || []).includes(row.id)
                          );
                          if (!sampleRow) return;
                          handleApplyHesapToSingleRow(
                            sampleRow,
                            group.suggestedAccount,
                            { learn: false }
                          );
                        }}
                      >
                        Sadece bu satır
                      </button>
                      <button
                        type="button"
                        className="rounded border border-emerald-700/50 bg-emerald-950/40 px-2 py-1 text-emerald-100"
                        onClick={() => {
                          const sampleRow = lucaRef.current.find((row) =>
                            (group.rowIds || []).includes(row.id)
                          );
                          if (!sampleRow) return;
                          handleApplyHesapToAnalysisGroup(
                            { ...sampleRow, analysisKey: group.analysisKey },
                            group.suggestedAccount,
                            { learn: false }
                          );
                        }}
                      >
                        Bu gruba uygula
                      </button>
                      <button
                        type="button"
                        className="rounded border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-amber-100"
                        onClick={() => {
                          const sampleRow = lucaRef.current.find((row) =>
                            (group.rowIds || []).includes(row.id)
                          );
                          if (!sampleRow) return;
                          handleApplyHesapToAnalysisGroup(
                            { ...sampleRow, analysisKey: group.analysisKey },
                            group.suggestedAccount,
                            { learn: true }
                          );
                        }}
                      >
                        Bu gruba uygula + firma için öğren
                      </button>
                      <button
                        type="button"
                        className="rounded border border-fuchsia-700/50 bg-fuchsia-950/40 px-2 py-1 text-fuchsia-100"
                        onClick={() => {
                          const sampleRow = lucaRef.current.find((row) =>
                            (group.rowIds || []).includes(row.id)
                          );
                          if (!sampleRow) return;
                          handleApplyHesapToAnalysisGroup(
                            { ...sampleRow, analysisKey: group.analysisKey },
                            group.suggestedAccount,
                            { learn: true, similar: true }
                          );
                        }}
                      >
                        Bu firmada benzer açıklamalara uygula
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showBankServiceUi && selectedCompanyId && !selectedBankLucaReady ? (
          <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            <p className="font-semibold">
              {selectedBank} için Luca 102 alt hesabı tanımlı değil
            </p>
            <p className="mt-1 text-xs text-amber-100/80">
              Firma kartına banka adı, IBAN, hesap no ve Luca 102 alt hesabını
              (örn. 102.01.004) ekleyin. Aksi halde banka bacağı ham &quot;102&quot;
              kalır.
            </p>
            <Link
              href="/muhasebe/firma-yonetimi"
              className="mt-2 inline-block text-xs font-semibold underline decoration-amber-400/60 hover:text-white"
            >
              Firma kartında banka hesabı tanımla →
            </Link>
            {matchedCompanyBank ? (
              <p className="mt-1 text-xs text-amber-200/70">
                Eşleşen kayıt: {matchedCompanyBank.bankName || "—"} / IBAN{" "}
                {matchedCompanyBank.iban || "—"} / Luca kodu{" "}
                {matchedCompanyBank.lucaAccountCode || "boş"}
              </p>
            ) : null}
          </div>
        ) : null}

        {showBankServiceUi && activeBankCount === 0 && selectedCompanyId ? (
          <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Firma banka hesabı (102) tanımlı değil. Vakıfbank için Luca alt hesabını
            firma kartına ekleyin; aksi halde banka bacağı &quot;102&quot; kalabilir.
          </div>
        ) : null}

        {showBankServiceUi && completedSteps.preview && !accountingAnalyzed ? (
          <p className="text-sm text-amber-200/90">
            Parser önizlemesi hazır. Yerel hesap/kural için{" "}
            <span className="font-semibold">Muhasebe Analizini Başlat</span>.
          </p>
        ) : null}
        {showBankServiceUi && accountingAnalyzed && !lucaReady ? (
          <p className="text-sm text-amber-200/90">
            Yerel muhasebe analizi tamam. İsterseniz{" "}
            <span className="font-semibold">CORE ile Geliştir</span>
            ’i kullanın. Excel için{" "}
            <span className="font-semibold">Luca Satırlarını Hazırla</span>.
          </p>
        ) : null}

        {showBankServiceUi && totalMovementCount > 0 ? (
          <div className={`${annveroCardClass} border-indigo-900/40`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold">
                  {!accountingAnalyzed
                    ? "Banka Hareketi Önizleme (Parser)"
                    : isAnnveroCoreEnabled()
                      ? "ANNVERO CORE / Hareket Önizleme"
                      : "Banka Hareketi Önizleme"}
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  {!accountingAnalyzed
                    ? "Yalnızca parse sonucu. Hesap/kural için Muhasebe Analizini Başlatın (yerel)."
                    : isAnnveroCoreEnabled()
                      ? coreRowsProcessed > 0
                        ? `CORE ${coreRowsProcessed} harekette uygulandı; dönmeyenler “${CORE_REVIEW_LEFT_LABEL}”.`
                        : "Yerel muhasebe analizi tamam. İsterseniz CORE ile Geliştir’i kullanın."
                      : "Yerel muhasebe analizi uygulandı."}
                </p>
              </div>
              {canRunOptionalCore ? (
                <button
                  type="button"
                  onClick={handleApplyCoreToAllRows}
                  disabled={isJobBusy}
                  className="rounded-lg border border-indigo-600 bg-indigo-950 px-4 py-2 text-sm font-semibold text-indigo-100 hover:bg-indigo-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isApplyingCoreAll ? "CORE uygulanıyor…" : "CORE ile Geliştir"}
                </button>
              ) : null}
            </div>

            {coreIntegrationSummary ? (
              <div className="mb-4 grid grid-cols-2 gap-2 text-xs text-gray-300 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
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
                  label="Hafızadan"
                  value={coreIntegrationSummary.memoryFound || 0}
                  tone="sky"
                />
                <CoreSummaryCard
                  label="İncelemeye bırakıldı"
                  value={coreIntegrationSummary.reviewLeft || 0}
                  tone="amber"
                />
                <CoreSummaryCard
                  label="Timeout / atlandı"
                  value={
                    (coreIntegrationSummary.timedOut || 0) +
                    (coreIntegrationSummary.notRun || 0)
                  }
                  tone="yellow"
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
            {showBankServiceUi && accountingAnalyzed && coreIntegrationSummary ? (
              <p className="mb-3 text-xs text-slate-400">
                {coreRowsProcessed > 0
                  ? `CORE denemesi: ${coreRowsProcessed} hareket`
                  : "Analiz yerel (CORE isteğe bağlı)"}
                {coreRowsProcessed > 0 &&
                coreIntegrationSummary.coreRecognized === 0
                  ? " · Bu turda CORE eşleşmesi yok (0 tanıdı) — legacy/kural/hafıza sonuçları geçerlidir."
                  : ""}
                {lastTimings?.analysisCallCounts?.uniqueDescriptionCount ||
                lastTimings?.uniqueDescriptionCount
                  ? ` · Analiz grubu: ${
                      lastTimings.uniqueDescriptionCount ||
                      lastTimings.analysisCallCounts.uniqueDescriptionCount
                    }${
                      lastTimings.uniqueReport?.legacyUniqueCount
                        ? ` (eski unique ${lastTimings.uniqueReport.legacyUniqueCount})`
                        : ""
                    }`
                  : ""}
                {lastTimings?.analysisTimings?.totalAnalysisMs
                  ? ` · ${Math.round(
                      lastTimings.analysisTimings.totalAnalysisMs / 1000
                    )}s`
                  : ""}
                {lastTimings?.lucaStats
                  ? ` · Luca: ${lastTimings.lucaStats.lucaRows} satır (${lastTimings.lucaStats.movementsWith2Rows}×2 çift taraflı)`
                  : ""}
                {lastTimings?.analysisCallCounts?.safeSystemAutoApplied
                  ? ` · Sistem kuralı otomatik: ${lastTimings.analysisCallCounts.safeSystemAutoApplied}`
                  : ""}
                {lastTimings?.analysisCallCounts?.safeSystemHit
                  ? ` · Sistem ailesi: ${lastTimings.analysisCallCounts.safeSystemHit}`
                  : ""}
              </p>
            ) : null}

            <CorePreviewTable
              movements={corePreviewMovements}
              displayedCount={PREVIEW_PAGE_SIZE}
              onTeachClick={handleOpenTeachModal}
              showTeachButton={isAnnveroCoreEnabled()}
              showTeachForMovement={(movement) => showCoreTeachForMovement(movement)}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {canShowPrevMovements ? (
                <button
                  type="button"
                  onClick={() => syncMovementPage(movementPage - 1)}
                  className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-800"
                >
                  Önceki
                </button>
              ) : null}
              {canShowMoreMovements ? (
                <button
                  type="button"
                  onClick={() => syncMovementPage(movementPage + 1)}
                  className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-800"
                >
                  Sonraki (+{PREVIEW_PAGE_SIZE})
                </button>
              ) : null}
              <span className="text-xs text-gray-400">
                Hareket sayfa {movementPage + 1}: {movementRows.length}/
                {totalMovementCount} (state ≤{PREVIEW_PAGE_SIZE})
              </span>
            </div>
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

        <CariMissingResolutionCenter
          open={showCariResolutionCenter}
          onClose={handleCloseCariResolutionCenter}
          snapshot={cariResolutionSnapshot}
          companyPlans={companyPlans}
          resolvedGroupIds={resolvedCariGroupIds}
          onApplyGroup={handleApplyCariResolutionGroup}
          applyingId={applyingCariGroupId}
          lastApplyMessage={lastCariApplyMessage}
          loading={cariResolutionLoading}
          error={cariResolutionError}
          onRetry={handleRetryCariResolutionLoad}
        />

        {showBankServiceUi || (showUserLucaReview && lucaReady) ? (
        <div className={`min-w-0 ${annveroCardClass}`}>
          <h2 className="mb-6 text-xl font-semibold text-white sm:text-2xl">
            {showBankServiceUi
              ? "StandardLucaRow Ön İzleme"
              : "Eksik hesap satırları"}
          </h2>

          {standardLucaRows.length === 0 ? (
            <p className="text-gray-400">
              {showBankServiceUi
                ? totalMovementCount > 0
                  ? "Hareket önizlemesi hazır. Luca için “Luca Satırlarını Hazırla” butonuna basın."
                  : "Henüz StandardLucaRow oluşturulmadı."
                : "Henüz Luca satırı yok."}
            </p>
          ) : (
            <>
              {showBankServiceUi && previewSummary ? (
                <div className="mb-4 grid grid-cols-2 gap-2 text-xs text-gray-300 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2.5 shadow-sm shadow-black/10">
                    <div className="text-gray-500">Toplam hareket</div>
                    <div className="text-lg font-semibold text-white">
                      {previewSummary.totalMovements}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2.5 shadow-sm shadow-black/10">
                    <div className="text-gray-500">Luca satırı</div>
                    <div className="text-lg font-semibold text-white">
                      {previewSummary.lucaRows}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2.5 shadow-sm shadow-black/10">
                    <div className="text-gray-500">Gösterilen</div>
                    <div className="text-lg font-semibold text-white">
                      {displayedStandardLucaRows.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2.5 shadow-sm shadow-black/10">
                    <div className="text-gray-500">Tanınan</div>
                    <div className="text-lg font-semibold text-emerald-300">
                      {previewSummary.recognized}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2.5 shadow-sm shadow-black/10">
                    <div className="text-gray-500">Tanınmayan</div>
                    <div className="text-lg font-semibold text-amber-300">
                      {previewSummary.unknown}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2.5 shadow-sm shadow-black/10">
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
                    const byId = new Map(nextRows.map((row) => [row.id, row]));
                    lucaRef.current = lucaRef.current.map((row) =>
                      byId.has(row.id) ? byId.get(row.id) : row
                    );
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
                      ? getFullMovement(row._movementId) ||
                        movementById.get(row._movementId)
                      : null;
                    const suggestions = movement
                      ? movement.accountSuggestions?.length
                        ? movement.accountSuggestions
                        : parseSuggestionsFromWarning(movement.warning)
                      : [];
                    const suggestionHint =
                      suggestions.length > 0
                        ? `\nÖneriler: ${suggestions.map((s) => s.label || s.code).join(", ")}`
                        : "";

                    return (
                      <div
                        className={`max-h-10 overflow-hidden rounded-md px-1 py-0.5 text-[11px] leading-tight ${getMovementWarningClass(row.kontrolNotu)}`}
                        title={`${row.kontrolNotu || ""}${suggestionHint}`}
                      >
                        <span className="annvero-clamp-cell block">
                          {row.kontrolNotu || "—"}
                        </span>
                      </div>
                    );
                  }}
                />
              </PreviewErrorBoundary>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {canShowPrevLuca ? (
                  <button
                    type="button"
                    onClick={() => syncLucaPage(lucaPage - 1)}
                    className="rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-800"
                  >
                    Önceki sayfa
                  </button>
                ) : null}
                {canShowMoreLuca ? (
                  <button
                    type="button"
                    onClick={() => syncLucaPage(lucaPage + 1)}
                    className="rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-800"
                  >
                    Sonraki sayfa (+{PREVIEW_PAGE_SIZE})
                  </button>
                ) : null}
                {showBankServiceUi ? (
                  <p className="text-sm text-gray-400">
                    Toplam {totalLucaCount} Luca satırı.
                    {` Ekranda sayfa ${lucaPage + 1}: ${displayedStandardLucaRows.length}/${filteredStandardLucaRows.length}.`}
                    {" Excel, hazır Luca satırlarının tamamından üretilir."}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400">
                    {filteredStandardLucaRows.length} eksik hesap satırı listeleniyor.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        ) : null}
      </div>
    </div>
  );
}

function SkeletonBlock({ className = "" }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-slate-800/50 ${className}`}
      aria-hidden="true"
    />
  );
}

function CompanySelectSkeleton() {
  return null;
}

function CompanySummarySkeleton() {
  return (
    <div className="mb-6 space-y-3" aria-busy="true" aria-label="Firma bilgileri yükleniyor">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-20" />
        ))}
      </div>
    </div>
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
