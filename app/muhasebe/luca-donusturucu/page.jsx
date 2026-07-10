"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import RowSearchToolbar from "../components/RowSearchToolbar";
import EditableStandardLucaPreviewTable from "../components/EditableStandardLucaPreviewTable";
import { useCompanyList } from "../hooks/useCompanyList";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  countCompanyRules,
  countPendingLucaRowsForCompany,
  formatDateTime,
  getAccountPlanForCompany,
  getAccountPlanUploadedAt,
  getCompanyRulesUpdatedAt,
  loadAccountPlansFromStorage,
  loadPendingLucaRows,
  loadRuleEngineFromStorage,
  normalizeAccountPlanForMatching,
  normalizeCompanyRecord,
  resolve102BankAccount,
} from "@/src/utils/companyCenter";
import { buildElektrawebCompanyMappings } from "@/src/utils/elektrawebAccountMatcher";
import { fetchLearningMemoryForCompany, createLearningMemoryRecord } from "@/src/utils/learningMemory";
import {
  findCreditCardByText,
  buildCreditCardPaymentDescription,
  getCreditCardAccount,
} from "@/src/utils/creditCardAccountResolver";
import { findCariAccountInPlan, buildStandardLucaDescription } from "@/src/utils/bankMovementMapper";
import {
  buildAccountPlanNotFoundWarning,
  collectAccountSuggestions,
} from "@/src/utils/accountPlanSuggestions";
import {
  applyStandardLucaRowEditDraft,
  buildStandardLucaLearningMemoryPayload,
} from "@/src/utils/previewRowEdit";
import { exportStandardLucaExcel } from "@/src/utils/exportStandardLucaExcel";
import ParserJobProgress from "@/src/components/ParserJobProgress";
import { useParserJob } from "@/src/hooks/useParserJob";
import { logParserJobError } from "@/src/utils/parserJobLogger";
import { PARSER_WORKER_URLS } from "@/src/utils/parserWorkerUrls";
import { runLucaExcelWorker } from "@/src/utils/workerParserBridge";
import {
  applyAccountMemoryV1ToRows,
  saveAccountMemoryFromEdit,
} from "@/src/utils/accountMemoryV1";
import { buildExportWarningConfirmMessage } from "@/src/utils/previewExportValidation";
import {
  logParserError,
  SYSTEM_ERROR_TYPES,
} from "@/src/utils/systemLogEngine";
import {
  ensureStandardLucaRowIds,
  finalizeStandardLucaRow,
  filterStandardLucaRows,
  getStandardLucaMissingBadges,
  groupStandardLucaRowsToFisler,
  isStandardLucaPayload,
  KAYNAK_TIPI,
  lucaFislerToStandardLucaRows,
  logStandardLucaReport,
  sortStandardLucaRows,
} from "@/src/utils/standardLucaRow";

const LUCA_PREVIEW_FILTERS = [
  { id: "all", label: "Tümü" },
  { id: "errors", label: "Hatalılar" },
  { id: "missingAccount", label: "Eksik Hesap" },
  { id: "unbalanced", label: "Dengesiz Fişler" },
  { id: "overFifty", label: "50 Fiş Sınırı" },
  { id: "learningMemory", label: "Öğrenen Hafıza" },
];

const SOURCE_TYPES = {
  ELEKTRAWEB: "ELEKTRAWEB",
  BANKA: "BANKA",
};

const SOURCE_UI = {
  [SOURCE_TYPES.ELEKTRAWEB]: {
    label: "Elektraweb",
    title: "Elektraweb Fiş Dosyası",
    description: "Elektraweb fiş Excel dosyasını yükleyin.",
  },
  [SOURCE_TYPES.BANKA]: {
    label: "Banka Parser",
    title: "Banka Hareket Dosyası",
    description: "Banka ekstresi Excel dosyasını yükleyin.",
  },
};

function getSourceTypeLabel(sourceType) {
  return SOURCE_UI[sourceType]?.label || SOURCE_UI[SOURCE_TYPES.ELEKTRAWEB].label;
}

function getFileSectionTitle(sourceType) {
  return (
    SOURCE_UI[sourceType]?.title || SOURCE_UI[SOURCE_TYPES.ELEKTRAWEB].title
  );
}

function getFileSectionDescription(sourceType) {
  return (
    SOURCE_UI[sourceType]?.description ||
    SOURCE_UI[SOURCE_TYPES.ELEKTRAWEB].description
  );
}

function formatRowCountLabel(count, sourceType) {
  return `${count} satır (${getSourceTypeLabel(sourceType)})`;
}

function resolvePendingSourceType(pending) {
  if (
    pending.kaynakTipi === KAYNAK_TIPI.ELEKTRAWEB ||
    pending.sourceModule === "elektraweb"
  ) {
    return SOURCE_TYPES.ELEKTRAWEB;
  }

  if (pending.kaynakTipi === KAYNAK_TIPI.BANKA) {
    return SOURCE_TYPES.BANKA;
  }

  const firstRowKaynakTipi = pending.rows?.[0]?.kaynakTipi;
  if (firstRowKaynakTipi === KAYNAK_TIPI.ELEKTRAWEB) {
    return SOURCE_TYPES.ELEKTRAWEB;
  }
  if (firstRowKaynakTipi === KAYNAK_TIPI.BANKA) {
    return SOURCE_TYPES.BANKA;
  }

  return SOURCE_TYPES.ELEKTRAWEB;
}

function resolveUrlSourceType(param) {
  const value = String(param || "").trim().toLowerCase();
  if (value === "bank" || value === "banka") return SOURCE_TYPES.BANKA;
  if (value === "elektraweb" || value === "elektra") return SOURCE_TYPES.ELEKTRAWEB;
  return null;
}

export default function LucaDonusturucuPage() {
  const searchParams = useSearchParams();
  const [sourceType, setSourceType] = useState(SOURCE_TYPES.ELEKTRAWEB);
  const [sourceLocked, setSourceLocked] = useState(false);
  const [hasTransferredRows, setHasTransferredRows] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [learningMemory, setLearningMemory] = useState([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hareketFileName, setHareketFileName] = useState("");
  const [rawRows, setRawRows] = useState([]);
  const [standardLucaRows, setStandardLucaRows] = useState([]);
  const [fisler, setFisler] = useState([]);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewQuickFilter, setPreviewQuickFilter] = useState("all");
  const [accountPlans, setAccountPlans] = useState({});
  const [ruleEngine, setRuleEngine] = useState({});
  const [previewError, setPreviewError] = useState("");
  const [isSavingPreviewEdit, setIsSavingPreviewEdit] = useState(false);
  const [exportValidation, setExportValidation] = useState(null);
  const [toast, setToast] = useState(null);

  const {
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany: selectedCompanyRaw,
  } = useCompanyList();

  useEffect(() => {
    const urlSource = resolveUrlSourceType(searchParams.get("source"));
    if (urlSource) {
      setSourceType(urlSource);
      setSourceLocked(true);
    }
  }, [searchParams]);

  const selectedCompany = useMemo(
    () => normalizeCompanyRecord(selectedCompanyRaw),
    [selectedCompanyRaw]
  );

  const parserJob = useParserJob({
    logMeta: {
      module: "Luca Dönüştürücü",
      companyId: selectedCompanyId,
      companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
      jobType: "luca-excel",
    },
  });

  const getAccountMemoryContext = (rows = []) => ({
    firmaId: selectedCompanyId,
    kaynakAdi:
      rows[0]?.kaynakAdi ||
      hareketFileName ||
      SOURCE_UI[sourceType]?.label ||
      sourceType,
  });

  const applyPreviewAccountMemory = (rows) =>
    applyAccountMemoryV1ToRows(rows, getAccountMemoryContext(rows));

  useEffect(() => {
    const refreshLocalCompanyData = () => {
      setAccountPlans(loadAccountPlansFromStorage());
      setRuleEngine(loadRuleEngineFromStorage());
    };

    refreshLocalCompanyData();

    window.addEventListener("focus", refreshLocalCompanyData);

    return () => {
      window.removeEventListener("focus", refreshLocalCompanyData);
    };
  }, []);

  useEffect(() => {
    const pending = loadPendingLucaRows();
    if (!pending?.rows?.length || !isStandardLucaPayload(pending)) return;

    if (pending.companyId) {
      setSelectedCompanyId(pending.companyId);
    }

    const pendingSourceType = resolvePendingSourceType(pending);
    setSourceType(pendingSourceType);
    setSourceLocked(true);
    setHasTransferredRows(true);

    const rows = ensureStandardLucaRowIds(
      sortStandardLucaRows(
        pending.rows.map((row) =>
          finalizeStandardLucaRow({
            ...row,
            firmaId: row.firmaId || pending.firmaId || pending.companyId || "",
            kaynakTipi:
              row.kaynakTipi ||
              pending.kaynakTipi ||
              (pendingSourceType === SOURCE_TYPES.ELEKTRAWEB
                ? KAYNAK_TIPI.ELEKTRAWEB
                : KAYNAK_TIPI.BANKA),
            kaynakAdi:
              row.kaynakAdi ||
              pending.kaynakAdi ||
              pending.selectedBank ||
              getSourceTypeLabel(pendingSourceType),
          })
        )
      )
    );
    setStandardLucaRows(applyPreviewAccountMemory(rows));
    setRawRows([]);
    setFisler(groupStandardLucaRowsToFisler(rows));
    logStandardLucaReport("luca-donusturucu-pending", rows);
    setHareketFileName(
      pending.companyName
        ? `${pending.companyName} — ${formatRowCountLabel(rows.length, pendingSourceType)}`
        : formatRowCountLabel(rows.length, pendingSourceType)
    );
  }, [setSelectedCompanyId]);

  const changeSourceType = (nextType) => {
    if (sourceLocked || nextType === sourceType) return;

    setSourceType(nextType);
    setRawRows([]);
    setStandardLucaRows([]);
    setFisler([]);
    setUploadedFile(null);
    setHareketFileName("");
    setPreviewError("");
  };

  useEffect(() => {
    if (!selectedCompanyId) {
      setLearningMemory([]);
      return;
    }

    fetchLearningMemoryForCompany(selectedCompanyId).then(setLearningMemory);
  }, [selectedCompanyId]);

  const companyPlans = useMemo(
    () => getAccountPlanForCompany(accountPlans, selectedCompany || selectedCompanyId),
    [accountPlans, selectedCompany, selectedCompanyId]
  );

  const normalizedAccountPlan = useMemo(
    () => normalizeAccountPlanForMatching(companyPlans),
    [companyPlans]
  );

  const matchingContext = useMemo(
    () => ({
      selectedCompanyAccountPlan: normalizedAccountPlan,
      normalizedAccountPlan,
      learningMemory,
      companyMappings: buildElektrawebCompanyMappings(selectedCompany || {}),
      documentSeriesRules: selectedCompany?.documentSeriesRules || [],
      accountingRules: selectedCompany?.accountingRules || {},
      employees: selectedCompany?.employees || [],
    }),
    [normalizedAccountPlan, learningMemory, selectedCompany]
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

  const readinessItems = useMemo(() => {
    if (!selectedCompanyId) {
      return [{ label: "Firma", value: "Üst menüden seçin", status: "missing" }];
    }

    return [
      {
        label: "Hesap planı",
        value: companyPlans.length > 0 ? "Hazır" : "Eksik",
        status: companyPlans.length > 0 ? "ready" : "missing",
      },
      {
        label: "Kurallar",
        value: hasRules ? "Hazır" : "Eksik",
        status: hasRules ? "ready" : "missing",
      },
      {
        label: "Banka",
        value: String(activeBankCount),
        status: activeBankCount > 0 ? "ready" : "missing",
      },
      {
        label: "Kaynak",
        value: getSourceTypeLabel(sourceType),
        status: "ready",
      },
    ];
  }, [selectedCompanyId, companyPlans.length, hasRules, activeBankCount, sourceType]);

  const showSourcePicker = !sourceLocked;
  const showFileUpload = !hasTransferredRows && standardLucaRows.length === 0;

  const documentSeriesCount = selectedCompany?.documentSeriesRules?.length || 0;

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
    [selectedCompanyId, accountPlans, rawRows]
  );

  const filteredStandardLucaRows = useMemo(
    () =>
      filterStandardLucaRows(
        standardLucaRows,
        previewSearch,
        previewQuickFilter === "missingAccount"
          ? "missingAccount"
          : previewQuickFilter === "learningMemory"
          ? "learningMemory"
          : previewQuickFilter === "errors"
          ? "errors"
          : "all"
      ),
    [standardLucaRows, previewSearch, previewQuickFilter]
  );

  const displayedStandardLucaRows = filteredStandardLucaRows.slice(0, 100);

  const normalizeText = (value) =>
    String(value || "")
      .toUpperCase()
      .replaceAll("İ", "I")
      .replaceAll("Ğ", "G")
      .replaceAll("Ü", "U")
      .replaceAll("Ş", "S")
      .replaceAll("Ö", "O")
      .replaceAll("Ç", "C")
      .replace(/[.,/()\-_*:;]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const compactText = (value) => normalizeText(value).replace(/\s+/g, "");

  const isCreditCardIslem = (type) =>
    type.includes("KREDI KARTI") || type.includes("KREDİ KARTI");

  const parseNumber = (value) => {
    if (typeof value === "number") return value;

    const cleaned = String(value || "")
      .replaceAll("TL", "")
      .replaceAll(".", "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");

    const number = Number(cleaned);
    return Number.isNaN(number) ? 0 : number;
  };

  const getValue = (row, key) => {
    const foundKey = Object.keys(row || {}).find(
      (k) => compactText(k) === compactText(key)
    );

    return foundKey ? row[foundKey] : "";
  };

  const simplifyWords = (text) =>
    normalizeText(text)
      .replace(/\bANONIM\b/g, " ")
      .replace(/\bSIRKETI\b/g, " ")
      .replace(/\bLIMITED\b/g, " ")
      .replace(/\bLTD\b/g, " ")
      .replace(/\bSTI\b/g, " ")
      .replace(/\bSANAYI\b/g, " ")
      .replace(/\bTICARET\b/g, " ")
      .replace(/\bTURIZM\b/g, " ")
      .replace(/\bOTELCILIK\b/g, " ")
      .replace(/\bVE\b/g, " ")
      .replace(/\bAS\b/g, " ")
      .replace(/\bYONETIM\b/g, "YON")
      .replace(/\bDANISMANLIGI\b/g, "DAN")
      .replace(/\bDANISMANLIK\b/g, "DAN")
      .split(/\s+/)
      .filter((word) => word.length > 2);

  const isSimilarWord = (a, b) => {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 3 && b.startsWith(a)) return true;
    if (b.length >= 3 && a.startsWith(b)) return true;
    return false;
  };

  const getAccountCode = (account) =>
    account?.accountCode || account?.hesapKodu || "";

  const findBestAccountFromDescription = (description) => {
    const descWords = simplifyWords(description);

    if (descWords.length === 0) return null;

    let bestMatch = null;
    let bestScore = 0;

    companyPlans.forEach((account) => {
      if (account.isActive === false) return;

      const accountWords = simplifyWords(
        account.accountName || account.hesapAdi || ""
      );

      if (accountWords.length === 0) return;

      let score = 0;

      accountWords.forEach((accountWord) => {
        const matched = descWords.some((descWord) =>
          isSimilarWord(descWord, accountWord)
        );

        if (matched) score += 1;
      });

      if (score > bestScore) {
        bestScore = score;
        bestMatch = account;
      }
    });

    return bestScore >= 2 ? bestMatch : null;
  };

  const isGenericCariFallback = (code) => {
    const compact = compactText(code);

    if (!compact) return true;

    return [
      compactText("HESAP PLANINDAN"),
      "320",
      compactText("320.01.001"),
      "120",
      compactText("120.01.001"),
    ].includes(compact);
  };

  const isCariCode = (code) => {
    const compact = compactText(code);
    return compact.startsWith("320") || compact.startsWith("120");
  };

  const accountExistsInPlan = (code) => {
    if (!code) return false;

    const wanted = compactText(code);

    return companyPlans.some(
      (account) => compactText(getAccountCode(account)) === wanted
    );
  };

  // Cari hesap çözümü gerekiyor mu? Genel fallback (boş/320/120) veya
  // hesap planında bulunmayan 320/120 kodları için gerçek hesap aranır.
  const needsCariResolve = (code) =>
    isGenericCariFallback(code) ||
    (isCariCode(code) && !accountExistsInPlan(code));

  const resolve102 = (accountCode, lucaBankaHesabi) =>
    resolve102BankAccount(
      selectedCompany?.bankAccounts || [],
      accountCode,
      lucaBankaHesabi
    );

  const formatLucaDate = (value) => {
    if (!value) return "";

    if (value instanceof Date) {
      const day = String(value.getDate()).padStart(2, "0");
      const month = String(value.getMonth() + 1).padStart(2, "0");
      return `${day}.${month}.${value.getFullYear()}`;
    }

    const text = String(value).trim();

    if (/^\d{2}\.\d{2}\.\d{4}$/.test(text)) return text;

    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      const [year, month, day] = text.slice(0, 10).split("-");
      return `${day}.${month}.${year}`;
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
      return text.replaceAll("/", ".");
    }

    const parsed = new Date(text);

    if (!Number.isNaN(parsed.getTime())) {
      const day = String(parsed.getDate()).padStart(2, "0");
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      return `${day}.${month}.${parsed.getFullYear()}`;
    }

    return text;
  };

  const toNumericAmount = (value) => {
    if (value === "" || value === null || value === undefined) return "";

    const number = Number(value);
    return Number.isNaN(number) ? "" : number;
  };

  const resolveBelgeTuru = ({
    explicit,
    islemTipi,
    rawDescription,
    isCreditCard,
  }) => {
    const fromExplicit = String(explicit || "").trim().toUpperCase();
    if (fromExplicit) return fromExplicit;

    if (isCreditCard) return "KR";

    const text = normalizeText(`${islemTipi} ${rawDescription}`);

    if (
      text.includes("KREDI KARTI") ||
      text.includes("EKSTRE") ||
      text.includes("KREDI KART")
    ) {
      return "KR";
    }

    if (text.includes("NOTER")) return "NM";
    if (text.includes("SMM")) return "SMM";
    if (text.includes("FATURA")) return "EF";

    if (
      text.includes("HAVALE") ||
      text.includes("EFT") ||
      text.includes("GOND HVL") ||
      text.includes("GLN HVL") ||
      text.includes("VIRMAN") ||
      text.includes("MASRAF")
    ) {
      return "DK";
    }

    return "DK";
  };

  const handleHareketFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRawRows([]);
    setStandardLucaRows([]);
    setFisler([]);
    setUploadedFile(file);

    if (sourceType === SOURCE_TYPES.ELEKTRAWEB) {
      setHareketFileName(file.name);
      e.target.value = "";
      return;
    }

    parserJob.begin({ stage: "Excel okunuyor", detail: file.name });

    try {
      const arrayBuffer = await file.arrayBuffer();
      let jsonRows;
      try {
        const workerResult = await runLucaExcelWorker({
          workerUrl: PARSER_WORKER_URLS.excelSheet,
          arrayBuffer,
          onProgress: parserJob.onProgress,
        });
        jsonRows = workerResult.rows;
      } catch (workerError) {
        console.warn("[luca] excel worker fallback", workerError);
        const workbook = XLSX.read(arrayBuffer, { cellDates: true, type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      }

      setRawRows(jsonRows);
      setHareketFileName(
        `${file.name} — ${formatRowCountLabel(jsonRows.length, sourceType)}`
      );
      parserJob.markSuccess(`${jsonRows.length} satır okundu`);
    } catch (error) {
      logParserJobError(error, {
        module: "Luca Dönüştürücü",
        companyId: selectedCompanyId,
        companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
        fileName: file.name,
        errorType: SYSTEM_ERROR_TYPES.CORRUPT_EXCEL,
        source: "excel",
        jobType: "luca-excel",
      });
      parserJob.markError(error);
      setPreviewError(error?.message || "Excel dosyası okunamadı.");
    }

    e.target.value = "";
  };

  const createElektrawebPreview = async () => {
    if (!selectedCompany) {
      setPreviewError("Ön izleme oluşturulamadı: Önce firma seçmelisin.");
      return;
    }

    if (!uploadedFile) {
      setPreviewError("Ön izleme oluşturulamadı: Önce Elektraweb fiş dosyasını yüklemelisin.");
      return;
    }

    if (normalizedAccountPlan.length === 0) {
      setPreviewError(
        "Ön izleme oluşturulamadı: Seçili firma için hesap planı bulunamadı."
      );
      return;
    }

    setYukleniyor(true);
    setPreviewError("");

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);
      formData.append(
        "matchingContext",
        JSON.stringify({
          firmaId: selectedCompanyId,
          kaynakAdi: "ELEKTRAWEB",
          ...matchingContext,
        })
      );

      const response = await fetch("/api/elektraweb", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Elektraweb dosyası işlenirken hata oluştu.");
      }

      const apiRows = Array.isArray(data.standardLucaRows)
        ? data.standardLucaRows
        : [];

      if (apiRows.length === 0) {
        throw new Error("Parser sonucu boş döndü.");
      }

      const parsedRows = ensureStandardLucaRowIds(sortStandardLucaRows(apiRows));

      setStandardLucaRows(applyPreviewAccountMemory(parsedRows));
      setFisler(groupStandardLucaRowsToFisler(parsedRows));
      setRawRows([]);
      setHareketFileName(
        `${uploadedFile.name} — ${formatRowCountLabel(parsedRows.length, sourceType)}`
      );
      logStandardLucaReport("luca-donusturucu-elektraweb", parsedRows);
    } catch (error) {
      console.error("Ön izleme hatası:", error);
      logParserError(
        error?.message || "Luca ön izleme hatası",
        { stack: error?.stack, sourceType },
        selectedCompanyId,
        {
          fileName: uploadedFile?.name || hareketFileName || "",
          companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
          module: "Luca Fiş Üretici",
          errorType: SYSTEM_ERROR_TYPES.UNEXPECTED,
        }
      );
      setPreviewError(
        `Ön izleme oluşturulamadı: ${error?.message || "Bilinmeyen hata"}`
      );
    } finally {
      setYukleniyor(false);
    }
  };

  const createPreview = async () => {
    setPreviewError("");

    if (sourceType === SOURCE_TYPES.BANKA) {
      createFisler();
      return;
    }

    await createElektrawebPreview();
  };

  const createFisler = () => {
    setPreviewError("");

    try {
      if (!selectedCompany) {
        setPreviewError("Ön izleme oluşturulamadı: Önce firma seçmelisin.");
        return;
      }

      if (!rawRows || rawRows.length === 0) {
        setPreviewError("Ön izleme oluşturulamadı: Önce standart hareket dosyası yüklemelisin.");
        return;
      }

      const createdFisler = [];

      rawRows.forEach((row, index) => {
        try {
          const islemTipi = String(getValue(row, "IslemTipi") || "");
          const rawDescription = String(getValue(row, "Aciklama") || "");
          const tarih = getValue(row, "Tarih");
          const tutar = parseNumber(getValue(row, "Tutar"));
          const lucaBankaHesabi = String(
            getValue(row, "LucaBankaHesabi") || ""
          );
          const pendingLucaAciklama = String(getValue(row, "LucaAciklama") || "");

          if (!tutar) return;

          const type = normalizeText(islemTipi);
          const descText = normalizeText(rawDescription);
          const matchedAccount = findBestAccountFromDescription(rawDescription);
          const matchedCreditCard = findCreditCardByText(
            selectedCompany.creditCards || [],
            rawDescription
          );

          let borcluHesap = String(getValue(row, "BorcluHesap") || "");
          let alacakliHesap = String(getValue(row, "AlacakliHesap") || "");
          let customAciklama = null;

          let satirUyari = String(getValue(row, "Uyari") || "");
          const isCreditCard =
            isCreditCardIslem(type) ||
            !!matchedCreditCard ||
            descText.includes("KREDI KARTI") ||
            descText.includes("KREDI KART") ||
            descText.includes("EKSTRE");

          if (isCreditCard) {
            const resolvedCard = getCreditCardAccount({
              creditCard: matchedCreditCard,
              paymentDate: tarih || new Date(),
              installmentYearShift: false,
            });

            if (!matchedCreditCard) {
              borcluHesap = "";
              satirUyari = "Kredi kartı eşleşmedi";
            } else if (resolvedCard.accountCode) {
              borcluHesap = resolvedCard.accountCode;
            } else {
              borcluHesap = "";
              satirUyari = resolvedCard.warning || "Kredi kartı hesabı çözülemedi";
            }

            customAciklama = buildCreditCardPaymentDescription({
              creditCard: matchedCreditCard,
              paymentDate: tarih || new Date(),
              rawDescription,
            });
          }

          borcluHesap = resolve102(borcluHesap, lucaBankaHesabi);
          alacakliHesap = resolve102(alacakliHesap, lucaBankaHesabi);

          if (!isCreditCard && type.includes("GELEN")) {
            borcluHesap = borcluHesap || lucaBankaHesabi;

            if (needsCariResolve(alacakliHesap)) {
              const cariKod =
                getAccountCode(matchedAccount) ||
                findCariAccountInPlan(companyPlans, rawDescription, {
                  lucaDescription: pendingLucaAciklama,
                });

              if (cariKod) {
                alacakliHesap = cariKod;
                satirUyari = satirUyari
                  ? `${satirUyari} | Cari hesap eşleşti`
                  : "Cari hesap eşleşti";
              } else {
                alacakliHesap = "";
                satirUyari = satirUyari || "Cari hesap bulunamadı";
              }
            }
          }

          if (!isCreditCard && type.includes("GIDEN")) {
            alacakliHesap = alacakliHesap || lucaBankaHesabi;

            if (needsCariResolve(borcluHesap)) {
              const cariKod =
                getAccountCode(matchedAccount) ||
                findCariAccountInPlan(companyPlans, rawDescription, {
                  lucaDescription: pendingLucaAciklama,
                });

              if (cariKod) {
                borcluHesap = cariKod;
                satirUyari = satirUyari
                  ? `${satirUyari} | Cari hesap eşleşti`
                  : "Cari hesap eşleşti";
              } else {
                borcluHesap = "";
                satirUyari = satirUyari || "Cari hesap bulunamadı";
              }
            }
          }

          if (type.includes("POS TAHSILATI")) {
            borcluHesap = borcluHesap || lucaBankaHesabi;
            alacakliHesap =
              alacakliHesap ||
              selectedCompany.accountingRules?.posAccountCode ||
              "108";
          }

          if (type.includes("POS KOMISYONU")) {
            borcluHesap = borcluHesap || "780.01.001";
            alacakliHesap = alacakliHesap || lucaBankaHesabi;
          }

          const fisAciklama =
            pendingLucaAciklama ||
            customAciklama ||
            buildStandardLucaDescription(
              {
                aciklama: rawDescription,
                description: rawDescription,
                yon: type.includes("GELEN")
                  ? "GIRIS"
                  : type.includes("GIDEN")
                    ? "CIKIS"
                    : undefined,
                matchedAccountName:
                  matchedAccount?.hesapAdi || matchedAccount?.accountName || "",
                unvan:
                  matchedAccount?.hesapAdi || matchedAccount?.accountName || "",
              },
              { islemTipi }
            );

          const belgeTuru = resolveBelgeTuru({
            explicit:
              getValue(row, "BelgeTuru") || getValue(row, "DocumentType"),
            islemTipi,
            rawDescription,
            isCreditCard,
          });

          const missingPlanAccounts = [];

          if (borcluHesap && !accountExistsInPlan(borcluHesap)) {
            missingPlanAccounts.push(borcluHesap);
          }

          if (
            alacakliHesap &&
            !accountExistsInPlan(alacakliHesap) &&
            !missingPlanAccounts.includes(alacakliHesap)
          ) {
            missingPlanAccounts.push(alacakliHesap);
          }

          let accountSuggestions = [];
          let finalUyari = satirUyari;

          if (
            missingPlanAccounts.length > 0 &&
            !String(satirUyari).includes("Öneriler:")
          ) {
            const contextText = [rawDescription, fisAciklama].join(" ");
            accountSuggestions = collectAccountSuggestions(
              companyPlans,
              missingPlanAccounts,
              contextText
            );
            const planWarning = buildAccountPlanNotFoundWarning(
              companyPlans,
              missingPlanAccounts,
              contextText
            );

            finalUyari = finalUyari
              ? `${finalUyari} | ${planWarning}`
              : planWarning;
          }

          createdFisler.push({
            fisNo: createdFisler.length + 1,
            tarih,
            aciklama: fisAciklama,
            belgeTuru,
            uyari: finalUyari,
            accountSuggestions,
            satirlar: [
              {
                hesapKodu: borcluHesap,
                aciklama: fisAciklama,
                borc: tutar,
                alacak: "",
                uyari: finalUyari,
              },
              {
                hesapKodu: alacakliHesap,
                aciklama: fisAciklama,
                borc: "",
                alacak: tutar,
              },
            ],
          });
        } catch (rowError) {
          console.error("Satır işlenemedi:", index + 1, rowError, row);
        }
      });

      setFisler(createdFisler);
      const parsedRows = ensureStandardLucaRowIds(
        lucaFislerToStandardLucaRows(createdFisler, {
          firmaId: selectedCompanyId,
          kaynakTipi: KAYNAK_TIPI.BANKA,
          kaynakAdi: hareketFileName || "MANUEL",
        })
      );

      setStandardLucaRows(applyPreviewAccountMemory(parsedRows));
      setHareketFileName(
        uploadedFile
          ? `${uploadedFile.name} — ${formatRowCountLabel(parsedRows.length, sourceType)}`
          : formatRowCountLabel(parsedRows.length, sourceType)
      );
      setPreviewError("");
    } catch (error) {
      console.error("Ön izleme genel hata:", error);
      setPreviewError(
        `Ön izleme oluşturulamadı: ${error?.message || "Bilinmeyen hata"}`
      );
    }
  };

  const showToast = (message, type) => setToast({ message, type });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const saveAdvancedPreviewEdit = async (editingRowId, draftRow) => {
    if (!editingRowId || !draftRow) return null;

    const currentRow = standardLucaRows.find((row) => row.id === editingRowId);
    if (!currentRow) return null;

    setIsSavingPreviewEdit(true);

    try {
      const updatedRow = finalizeStandardLucaRow(
        applyStandardLucaRowEditDraft(currentRow, draftRow)
      );

      if (draftRow.saveToMemory && selectedCompanyId) {
        const memoryRecord = buildStandardLucaLearningMemoryPayload(
          currentRow,
          draftRow,
          selectedCompanyId
        );

        const created = await createLearningMemoryRecord(memoryRecord);
        if (created) {
          const nextMemory = await fetchLearningMemoryForCompany(selectedCompanyId);
          setLearningMemory(nextMemory);
        }

        showToast(
          created
            ? "Satır güncellendi ve hafızaya kaydedildi"
            : "Satır güncellendi, hafıza kaydı oluşturulamadı",
          created ? "success" : "error"
        );
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

    saveAccountMemoryFromEdit(row, getAccountMemoryContext([row]));
  };

  const exportExcel = (ignoreWarnings = false) => {
    const firmaKisa = getCompanyDisplayName(selectedCompany)
      .split(" ")[0]
      .toLowerCase()
      .replaceAll("ı", "i")
      .replaceAll("ğ", "g")
      .replaceAll("ü", "u")
      .replaceAll("ş", "s")
      .replaceAll("ö", "o")
      .replaceAll("ç", "c");

    const result = exportStandardLucaExcel(standardLucaRows, {
      filePrefix: `${firmaKisa}_luca_fis`,
      logLabel: "luca-donusturucu-export",
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
        showToast(result.message || "Önce ön izleme oluşturun.", "error");
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

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      {toast && (
        <div
          role="status"
          className={`fixed top-4 right-4 z-50 rounded-lg border px-4 py-3 text-sm font-medium shadow-xl ${
            toast.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/95 text-emerald-100"
              : "border-red-500/40 bg-red-950/95 text-red-100"
          }`}
        >
          {toast.message}
        </div>
      )}
      <h1 className="mb-2 text-3xl font-bold">Luca Fiş Üretici</h1>
      <p className="mb-8 text-sm text-gray-400">
        Aktif firmayı üst menüden yönetin. Kaynak biliniyorsa seçim otomatik yapılır.
      </p>

      <div className="grid max-w-6xl gap-6">
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Hazırlık durumu
          </h2>
          <div className="flex flex-wrap gap-2">
            {readinessItems.map((item) => (
              <ReadinessBadge key={item.label} {...item} />
            ))}
          </div>
          {(lastPlanUploadedAt || lastRuleUpdatedAt || documentSeriesCount > 0) && (
            <details className="mt-4 text-xs text-gray-500">
              <summary className="cursor-pointer text-gray-400 hover:text-gray-300">
                Detaylı bilgi
              </summary>
              <ul className="mt-2 space-y-1">
                {lastPlanUploadedAt ? (
                  <li>Son hesap planı: {lastPlanUploadedAt}</li>
                ) : null}
                {lastRuleUpdatedAt ? <li>Son kural güncelleme: {lastRuleUpdatedAt}</li> : null}
                {documentSeriesCount > 0 ? (
                  <li>Belge serisi kuralı: {documentSeriesCount} kayıt</li>
                ) : null}
                {pendingRowCount > 0 ? (
                  <li>Bekleyen Luca satırı: {pendingRowCount}</li>
                ) : null}
              </ul>
            </details>
          )}
        </div>

        {(showSourcePicker || showFileUpload) && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          {showSourcePicker ? (
            <>
              <h2 className="mb-4 text-lg font-semibold">Kaynak</h2>
              <div
                className="mb-6 flex flex-wrap gap-3"
                role="radiogroup"
                aria-label="Kaynak tipi seçimi"
              >
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    sourceType === SOURCE_TYPES.ELEKTRAWEB
                      ? "bg-violet-600 text-white"
                      : "border border-gray-700 bg-gray-950 text-gray-300 hover:text-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="luca-source-type"
                    value={SOURCE_TYPES.ELEKTRAWEB}
                    checked={sourceType === SOURCE_TYPES.ELEKTRAWEB}
                    onChange={() => changeSourceType(SOURCE_TYPES.ELEKTRAWEB)}
                    className="accent-violet-500"
                  />
                  Elektraweb
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    sourceType === SOURCE_TYPES.BANKA
                      ? "bg-blue-600 text-white"
                      : "border border-gray-700 bg-gray-950 text-gray-300 hover:text-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="luca-source-type"
                    value={SOURCE_TYPES.BANKA}
                    checked={sourceType === SOURCE_TYPES.BANKA}
                    onChange={() => changeSourceType(SOURCE_TYPES.BANKA)}
                    className="accent-blue-500"
                  />
                  Banka Parser
                </label>
              </div>
            </>
          ) : (
            <p className="mb-4 text-sm text-gray-400">
              Kaynak: <span className="font-medium text-white">{getSourceTypeLabel(sourceType)}</span>
            </p>
          )}

          {showFileUpload ? (
            <>
              <h2 className="mb-2 text-lg font-semibold">{getFileSectionTitle(sourceType)}</h2>
              <p className="mb-4 text-sm text-gray-400">{getFileSectionDescription(sourceType)}</p>

              <div className="flex flex-wrap items-center gap-4">
                <label className="cursor-pointer rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium hover:bg-blue-700">
                  Dosya Seç
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleHareketFile}
                    className="hidden"
                  />
                </label>
                <span className="text-sm text-gray-400">
                  {hareketFileName || "Henüz dosya seçilmedi"}
                </span>
              </div>
            </>
          ) : hasTransferredRows ? (
            <p className="text-sm text-emerald-400">
              {hareketFileName || `${standardLucaRows.length} satır aktarıldı`}
            </p>
          ) : null}

          <ParserJobProgress
            visible={parserJob.isRunning || parserJob.isDone || parserJob.isError}
            stage={parserJob.stage}
            detail={parserJob.detail}
            percent={parserJob.percent}
            timeoutWarning={parserJob.timeoutWarning}
            status={parserJob.status}
            error={parserJob.error}
            onCancel={parserJob.isRunning ? () => parserJob.cancel("user") : undefined}
            className="mt-4"
          />

          {standardLucaRows.length > 0 && (
            <p className="mt-4 text-sm text-emerald-400">
              {standardLucaRows.length} StandardLucaRow satırı aktarıldı. Ön izleme ve
              Excel aynı normalize veriden üretilir.
            </p>
          )}

          {sourceType === SOURCE_TYPES.BANKA && rawRows.length > 0 && (
            <p className="mt-4 text-sm text-green-400">
              {formatRowCountLabel(rawRows.length, sourceType)} okundu.
            </p>
          )}

          {sourceType === SOURCE_TYPES.ELEKTRAWEB && uploadedFile && standardLucaRows.length === 0 && (
            <p className="mt-4 text-sm text-blue-300">
              {uploadedFile.name} seçildi. Ön izleme oluşturun.
            </p>
          )}
        </div>
        )}

        <div className="flex flex-wrap gap-4">
          {!(hasTransferredRows && standardLucaRows.length > 0) ? (
          <button
            type="button"
            onClick={() => void createPreview()}
            disabled={yukleniyor}
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-700 disabled:opacity-60"
          >
            {yukleniyor ? "İşleniyor..." : "Ön İzleme Oluştur"}
          </button>
          ) : null}

          <button
            onClick={exportExcel}
            className="rounded-xl bg-green-600 px-6 py-3 font-semibold hover:bg-green-700"
          >
            Luca Excel Oluştur
          </button>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-6 text-3xl font-bold">Ön İzleme</h2>

          {previewError ? (
            <p className="mb-4 rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-red-300">
              {previewError}
            </p>
          ) : null}

          {standardLucaRows.length === 0 ? (
            <p className="text-gray-400">Henüz StandardLucaRow oluşturulmadı.</p>
          ) : (
            <div className="space-y-4">
              <RowSearchToolbar
                search={previewSearch}
                onSearchChange={setPreviewSearch}
                placeholder="Fiş no, hesap, açıklama, belge türü veya tutar ara..."
                filters={LUCA_PREVIEW_FILTERS}
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
                showKaynakColumn
                exportValidation={exportValidation}
                createRowContext={{
                  firmaId: selectedCompanyId,
                  kaynakTipi: sourceType,
                  kaynakAdi: SOURCE_UI[sourceType]?.label || sourceType,
                }}
                onSaveAdvancedEdit={saveAdvancedPreviewEdit}
                onAccountFieldChange={handleAccountMemorySave}
                isSavingAdvancedEdit={isSavingPreviewEdit}
              />

              <p className="text-sm text-gray-400">
                Toplam {standardLucaRows.length} StandardLucaRow satırı.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function ReadinessBadge({ label, value, status }) {
  const tone =
    status === "ready"
      ? "border-emerald-800/50 bg-emerald-950/40 text-emerald-200"
      : status === "missing"
        ? "border-amber-800/50 bg-amber-950/40 text-amber-200"
        : "border-gray-700 bg-gray-950 text-gray-300";

  return (
    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${tone}`}>
      <span className="font-medium text-gray-400">{label}:</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
