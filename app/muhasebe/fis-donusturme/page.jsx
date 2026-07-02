"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import RowSearchToolbar from "../components/RowSearchToolbar";
import PreviewVoucherDetailPanel from "../components/PreviewVoucherDetailPanel";
import { useCompanyList } from "../hooks/useCompanyList";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  getAccountPlanForCompany,
  getCompanyRules,
  loadAccountPlansFromStorage,
  loadRuleEngineFromStorage,
  normalizeAccountPlanForMatching,
  normalizeCompanyRecord,
  savePendingLucaRows,
} from "@/src/utils/companyCenter";
import {
  formatAccountingRuleTemplate,
  loadAccountingRulesFromStorage,
  matchAccountingRule,
} from "@/src/utils/accountingRuleEngine";
import {
  bankMovementsToStandardLucaRows,
  buildStandardLucaTransferPayload,
  ensureStandardLucaRowIds,
  filterStandardLucaRows,
  finalizeStandardLucaRow,
  getRowValue,
  getStandardLucaMissingBadges,
  KAYNAK_TIPI,
  LUCA_EXPORT_HEADERS,
  sortStandardLucaRows,
  standardLucaRowsToExcelRows,
} from "@/src/utils/standardLucaRow";
import {
  mapParsedRowsToStandardMovements,
  normalizeParserText,
} from "@/src/utils/bankMovementMapper";
import { enrichTebParsedRows } from "@/src/utils/tebHavaleGrouping";
import { applyLearningMemoryToStandardLucaRows } from "@/src/utils/bankLearningMemory";
import {
  buildElektrawebCompanyMappings,
} from "@/src/utils/elektrawebAccountMatcher";
import {
  createLearningMemoryRecord,
  fetchLearningMemoryForCompany,
} from "@/src/utils/learningMemory";
import {
  applyStandardLucaRowEditDraft,
  buildStandardLucaLearningMemoryPayload,
  buildStandardLucaRowEditDraft,
} from "@/src/utils/previewRowEdit";
import { enforceLucaExportDateStrings, formatDateTR } from "@/src/utils/formatDateTR";
import {
  analyzeStandardLucaRows,
  buildFisKontrolExcelRows,
  buildFisKontrolIssueExcelRows,
  KONTROL_SEVIYE,
} from "@/src/utils/fisKontrolMerkezi";
import { parseGarantiEkstre } from "../../../parsers/garantiParser";
import { parseVakifbankEkstre } from "../../../parsers/vakifbankParser";
import { bankaKurallari } from "../../../parsers/bankaKurallari";

const SOURCE_TYPES = {
  BANKA: "BANKA",
  ELEKTRAWEB: "ELEKTRAWEB",
  KREDI_KARTI: "KREDI_KARTI",
  XML_EFATURA: "XML_EFATURA",
  MANUEL: "MANUEL",
};

const SOURCE_OPTIONS = [
  {
    id: SOURCE_TYPES.BANKA,
    label: "Banka Ekstresi",
    ruleType: "Banka",
    kaynakTipi: KAYNAK_TIPI.BANKA,
    needsBank: true,
    accept: ".xlsx,.xls,.csv",
    uploadTitle: "Banka Ekstresi Excel",
    uploadDesc: "Seçili bankanın ekstre Excel dosyasını yükleyin.",
  },
  {
    id: SOURCE_TYPES.ELEKTRAWEB,
    label: "Elektraweb",
    ruleType: "Elektraweb",
    kaynakTipi: KAYNAK_TIPI.ELEKTRAWEB,
    accept: ".xlsx,.xls",
    uploadTitle: "Elektraweb Fiş Excel",
    uploadDesc: "Elektraweb fiş listesi Excel dosyasını yükleyin.",
  },
  {
    id: SOURCE_TYPES.KREDI_KARTI,
    label: "Kredi Kartı",
    ruleType: "Kredi Kartı",
    kaynakTipi: "KREDI_KARTI",
    generic: true,
    accept: ".xlsx,.xls,.csv",
    uploadTitle: "Kredi Kartı Ekstresi Excel",
    uploadDesc:
      "Kredi kartı ekstresini standart kolonlarla (Tarih, Açıklama, Tutar...) yükleyin.",
  },
  {
    id: SOURCE_TYPES.XML_EFATURA,
    label: "XML/e-Fatura",
    ruleType: "XML/e-Fatura",
    kaynakTipi: "XML_EFATURA",
    generic: true,
    accept: ".xlsx,.xls,.csv",
    uploadTitle: "e-Fatura / XML (Excel) Dosyası",
    uploadDesc:
      "e-Fatura veya XML kaynaklı Excel dosyasını standart kolonlarla yükleyin.",
  },
  {
    id: SOURCE_TYPES.MANUEL,
    label: "Manuel Excel",
    ruleType: "Manuel",
    kaynakTipi: "MANUEL",
    generic: true,
    accept: ".xlsx,.xls,.csv",
    uploadTitle: "Manuel Excel Dosyası",
    uploadDesc:
      "Standart Luca kolonlarına sahip (Fiş No, Tarih, Hesap Kodu, Borç, Alacak...) Excel yükleyin.",
  },
];

const BANK_OPTIONS = [
  { id: "GARANTI", label: "Garanti Bankası" },
  { id: "VAKIFBANK", label: "Vakıfbank" },
  { id: "TEB", label: "TEB" },
  { id: "KUVEYT", label: "Kuveyt Türk" },
  { id: "ZIRAAT", label: "Ziraat Bankası" },
];

const PREVIEW_FILTERS = [
  { id: "all", label: "Tümü" },
  { id: "errors", label: "Hatalılar" },
  { id: "missingAccount", label: "Hesap Eksik" },
  { id: "learningMemory", label: "Öğrenen Hafıza" },
  { id: "missingDescription", label: "Açıklama Eksik" },
  { id: "missingDocumentType", label: "Belge Türü Eksik" },
];

const PIPELINE_STEPS = [
  "Upload",
  "Parser",
  "StandardLucaRows",
  "Öğrenen Hafıza",
  "Kural Motoru",
  "Kontrol Merkezi",
  "Ön İzleme",
  "Excel Export",
];

function getSourceMeta(sourceType) {
  return SOURCE_OPTIONS.find((option) => option.id === sourceType) || SOURCE_OPTIONS[0];
}

// ---- Banka ekstresi jenerik parser yardımcıları (banka-ekstresi sayfası ile aynı mantık) ----
function parseMoney(value) {
  if (typeof value === "number") return value;
  const text = String(value || "")
    .replaceAll("TL", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const number = Number(text);
  return Number.isNaN(number) ? 0 : number;
}

function findHeaderRowIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return text.includes("TARIH") && text.includes("ACIKLAMA");
  });
}

function getCell(row, headers, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const wanted = normalizeParserText(name).replace(/\s+/g, "");
    const index = headers.findIndex((header) =>
      normalizeParserText(header).replace(/\s+/g, "").includes(wanted)
    );
    if (index >= 0) return row[index];
  }
  return "";
}

function parseGenericBankEkstre(sheetRows, bankaAdi) {
  if (!sheetRows || sheetRows.length === 0) return [];

  const headerIndex = findHeaderRowIndex(sheetRows);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const tarih =
        getCell(row, headers, ["TARİH", "TARIH", "İŞLEM TARİHİ", "ISLEM TARIHI"]) ||
        row[0] ||
        "";
      const aciklama =
        getCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "İŞLEM", "ISLEM"]) ||
        row[1] ||
        "";
      const unvan =
        getCell(row, headers, [
          "ÜNVAN",
          "UNVAN",
          "ALICI",
          "ALICI ÜNVAN",
          "ALICI UNVAN",
          "KARSI HESAP",
          "KARŞI HESAP",
        ]) || "";
      const dekontNo =
        getCell(row, headers, [
          "DEKONT",
          "DEKONT NO",
          "FİŞ NO",
          "FIS NO",
          "İŞLEM NO",
          "ISLEM NO",
        ]) || "";

      let borc = parseMoney(getCell(row, headers, ["BORÇ", "BORC", "ÇIKIŞ", "CIKIS"]));
      let alacak = parseMoney(getCell(row, headers, ["ALACAK", "GİRİŞ", "GIRIS"]));
      let tutar = parseMoney(
        getCell(row, headers, ["TUTAR", "İŞLEM TUTARI", "ISLEM TUTARI"])
      );

      if (!borc && !alacak && tutar) {
        if (tutar > 0) alacak = Math.abs(tutar);
        else borc = Math.abs(tutar);
      }
      if (!tutar) {
        tutar = alacak > 0 ? alacak : -borc;
      }

      const bakiye = parseMoney(getCell(row, headers, ["BAKİYE", "BAKIYE"]));
      const yon = tutar > 0 ? "GIRIS" : "CIKIS";

      if (!tarih || !aciklama || !tutar) return null;

      return {
        banka: bankaAdi,
        tarih,
        dekontNo: dekontNo || `${bankaAdi}-${index + 1}`,
        aciklama,
        unvan,
        borc: yon === "GIRIS" ? Math.abs(tutar) : 0,
        alacak: yon === "CIKIS" ? Math.abs(tutar) : 0,
        bakiye,
        tutar,
        yon,
        islemTipi: "DIGER",
      };
    })
    .filter(Boolean);
}

function normalizeStandardBankRow(row, selectedBank) {
  const tutar = Number(row.tutar ?? row.Tutar ?? 0);
  const borc = Number(row.borc ?? row.Borc ?? 0);
  const alacak = Number(row.alacak ?? row.Alacak ?? 0);

  let yon = row.yon || row.Yon || "";
  if (!yon) {
    if (borc > 0) yon = "GIRIS";
    else if (alacak > 0) yon = "CIKIS";
    else yon = tutar > 0 ? "GIRIS" : "CIKIS";
  }

  return {
    banka: row.banka || row.Banka || selectedBank,
    tarih: row.tarih || row.Tarih || "",
    dekontNo: row.dekontNo || row.FisNo || row.Dekont || "",
    aciklama: row.aciklama || row.Aciklama || row.HamAciklama || "",
    unvan: row.unvan || row.Unvan || "",
    borc: borc || (yon === "GIRIS" ? Math.abs(tutar) : 0),
    alacak: alacak || (yon === "CIKIS" ? Math.abs(tutar) : 0),
    bakiye: row.bakiye || row.Bakiye || "",
    tutar: tutar || (yon === "GIRIS" ? Math.abs(borc) : -Math.abs(alacak)),
    yon,
    islemTipi: row.islemTipi || row.IslemTipi || "DIGER",
  };
}

// ---- Jenerik (Kredi Kartı / XML / Manuel) StandardLucaRow eşleyici ----
function mapGenericExcelRowToStandardLuca(raw, index, context) {
  const fisNo =
    getRowValue(raw, "Fiş No", "Fis No", "FisNo", "Fiş Numarası", "No") || index + 1;
  const fisTarihi = getRowValue(raw, "Fiş Tarihi", "Fis Tarihi", "Tarih", "İşlem Tarihi");
  const hesapKodu = getRowValue(raw, "Hesap Kodu", "HesapKodu", "Hesap", "Kod");
  const fisAciklama = getRowValue(raw, "Fiş Açıklama", "Fis Aciklama", "Açıklama", "Aciklama");
  const detayAciklama =
    getRowValue(raw, "Detay Açıklama", "Detay Aciklama", "Açıklama", "Aciklama") ||
    fisAciklama;
  const belgeTuru = getRowValue(raw, "Belge Türü", "Belge Turu", "BelgeTuru", "Tür");
  const evrakNo = getRowValue(raw, "Evrak No", "EvrakNo", "Belge No", "Fatura No", "Dekont No");
  const evrakTarihi = getRowValue(raw, "Evrak Tarihi", "EvrakTarihi") || fisTarihi;

  let borc = getRowValue(raw, "Borç", "Borc");
  let alacak = getRowValue(raw, "Alacak");
  const tutar = getRowValue(raw, "Tutar", "İşlem Tutarı", "Islem Tutari");

  if (!String(borc).trim() && !String(alacak).trim() && String(tutar).trim()) {
    borc = tutar;
  }

  return finalizeStandardLucaRow({
    id: index + 1,
    firmaId: context.firmaId || "",
    kaynakTipi: context.kaynakTipi || "MANUEL",
    kaynakAdi: context.kaynakAdi || "",
    fisNo,
    fisTarihi,
    fisAciklama,
    detayAciklama,
    aciklama: detayAciklama || fisAciklama,
    belgeTuru,
    evrakNo,
    evrakTarihi,
    hesapKodu,
    borc,
    alacak,
  });
}

// Hesap kodu boş satırlara kural motorunu uygula.
function applyRuleEngineToRows(rows, { accountingRules, companyId, ruleType }) {
  if (!accountingRules?.length) return rows;

  return rows.map((row) => {
    if (String(row.hesapKodu || "").trim()) return row;

    const text = [row.detayAciklama, row.fisAciklama, row.aciklama, row.evrakNo]
      .filter(Boolean)
      .join(" ");

    const rule = matchAccountingRule(text, {
      companyId,
      kaynakTipi: ruleType,
      rules: accountingRules,
    });

    if (!rule) return row;

    const ruleAciklama = formatAccountingRuleTemplate(rule.fisAciklamaSablonu, text);

    return finalizeStandardLucaRow({
      ...row,
      hesapKodu: String(rule.hesapKodu || "").trim(),
      belgeTuru: String(rule.belgeTuru || row.belgeTuru || "").trim().toUpperCase(),
      fisAciklama: ruleAciklama || row.fisAciklama,
      detayAciklama: row.detayAciklama || ruleAciklama || row.fisAciklama,
      kontrolNotu: row.kontrolNotu
        ? `${row.kontrolNotu} | Kural motorundan eşleşti`
        : "Kural motorundan eşleşti",
      kuralMotoruEslesme: true,
    });
  });
}

function rowMatchedByRuleEngine(row) {
  if (row.kuralMotoruEslesme) return true;
  const method = normalizeParserText(row.eslesmeYontemi || "");
  if (method.includes("KURAL")) return true;
  return normalizeParserText(row.kontrolNotu || "").includes("KURAL MOTOR");
}

export default function FisDonusturmePage() {
  const router = useRouter();

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

  const [sourceType, setSourceType] = useState(SOURCE_TYPES.BANKA);
  const [selectedBank, setSelectedBank] = useState("GARANTI");

  const [accountPlans, setAccountPlans] = useState({});
  const [ruleEngine, setRuleEngine] = useState({});
  const [accountingRules, setAccountingRules] = useState([]);
  const [learningMemory, setLearningMemory] = useState([]);

  const [fileName, setFileName] = useState("");
  const [rawCount, setRawCount] = useState(0);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [parsedBankRows, setParsedBankRows] = useState([]);
  const [genericRawRows, setGenericRawRows] = useState([]);

  const [standardLucaRows, setStandardLucaRows] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineError, setPipelineError] = useState("");

  const [previewSearch, setPreviewSearch] = useState("");
  const [previewQuickFilter, setPreviewQuickFilter] = useState("all");

  const [editingRowId, setEditingRowId] = useState(null);
  const [draftRow, setDraftRow] = useState(null);
  const [isSavingPreviewEdit, setIsSavingPreviewEdit] = useState(false);

  const [toast, setToast] = useState(null);

  const showToast = (message, type) => setToast({ message, type });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const refresh = () => {
      setAccountPlans(loadAccountPlansFromStorage());
      setRuleEngine(loadRuleEngineFromStorage());
      setAccountingRules(loadAccountingRulesFromStorage());
      refreshCompanies();
    };

    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refreshCompanies]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setLearningMemory([]);
      return;
    }
    fetchLearningMemoryForCompany(selectedCompanyId).then(setLearningMemory);
  }, [selectedCompanyId]);

  const sourceMeta = getSourceMeta(sourceType);

  const companyPlans = useMemo(
    () => getAccountPlanForCompany(accountPlans, selectedCompany || selectedCompanyId),
    [accountPlans, selectedCompany, selectedCompanyId]
  );

  const normalizedAccountPlan = useMemo(
    () => normalizeAccountPlanForMatching(companyPlans),
    [companyPlans]
  );

  const companyRules = useMemo(
    () => getCompanyRules(ruleEngine, selectedCompanyId),
    [ruleEngine, selectedCompanyId]
  );

  const analysis = useMemo(
    () => analyzeStandardLucaRows(standardLucaRows),
    [standardLucaRows]
  );

  const analyzedRows = analysis.rows;

  const controlSummary = useMemo(() => {
    const eksikHesap = standardLucaRows.filter(
      (row) => !String(row.hesapKodu || "").trim()
    ).length;
    const hafiza = standardLucaRows.filter((row) => row.hafizaEslesme).length;
    const kural = standardLucaRows.filter(rowMatchedByRuleEngine).length;

    return {
      eksikHesap,
      dengesizFis: analysis.summary.unbalancedFisCount,
      riskliKayit: analysis.summary.hataRowCount,
      hafizaEslesme: hafiza,
      kuralEslesme: kural,
    };
  }, [standardLucaRows, analysis]);

  const filteredRows = useMemo(
    () => filterStandardLucaRows(analyzedRows, previewSearch, previewQuickFilter),
    [analyzedRows, previewSearch, previewQuickFilter]
  );

  const displayedRows = filteredRows.slice(0, 150);

  const resetPipelineOutput = () => {
    setStandardLucaRows([]);
    setEditingRowId(null);
    setDraftRow(null);
    setPipelineError("");
  };

  const changeSourceType = (nextType) => {
    if (nextType === sourceType) return;
    setSourceType(nextType);
    setUploadedFile(null);
    setFileName("");
    setRawCount(0);
    setParsedBankRows([]);
    setGenericRawRows([]);
    resetPipelineOutput();
  };

  const readWorkbook = async (file) => {
    const data = await file.arrayBuffer();
    try {
      return XLSX.read(data, { cellDates: true, type: "array" });
    } catch {
      const text = await file.text();
      return XLSX.read(text, { type: "string", cellDates: true });
    }
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setFileName(file.name);
    setRawCount(0);
    setParsedBankRows([]);
    setGenericRawRows([]);
    resetPipelineOutput();

    if (sourceType === SOURCE_TYPES.ELEKTRAWEB) {
      event.target.value = "";
      return;
    }

    let workbook;
    try {
      workbook = await readWorkbook(file);
    } catch {
      showToast("Dosya Excel olarak okunamadı. .xlsx olarak kaydedip tekrar deneyin.", "error");
      event.target.value = "";
      return;
    }

    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

    if (sourceType === SOURCE_TYPES.BANKA) {
      const sheetRows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
      });
      setRawCount(sheetRows.length);

      let parsedRows = [];
      if (selectedBank === "GARANTI") parsedRows = parseGarantiEkstre(sheetRows);
      else if (selectedBank === "VAKIFBANK") parsedRows = parseVakifbankEkstre(sheetRows);
      else if (selectedBank === "TEB")
        parsedRows = enrichTebParsedRows(parseGenericBankEkstre(sheetRows, "TEB"));
      else parsedRows = parseGenericBankEkstre(sheetRows, selectedBank);

      const normalizedRows = parsedRows.map((row) =>
        normalizeStandardBankRow(row, selectedBank)
      );
      setParsedBankRows(normalizedRows);
    } else {
      const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      setRawCount(jsonRows.length);
      setGenericRawRows(jsonRows);
    }

    event.target.value = "";
  };

  const buildBankPipeline = () => {
    const movements = mapParsedRowsToStandardMovements(parsedBankRows, {
      selectedCompany,
      companyPlans,
      companyRules,
      selectedBank,
      legacyRules: bankaKurallari,
      learningMemory,
      accountingRules,
      selectedCompanyId,
    });

    const baseRows = bankMovementsToStandardLucaRows(movements, {
      firmaId: selectedCompanyId,
      kaynakAdi: selectedBank,
    });

    return applyLearningMemoryToStandardLucaRows(
      ensureStandardLucaRowIds(baseRows),
      learningMemory,
      {
        firmaId: selectedCompanyId,
        kaynakTipi: KAYNAK_TIPI.BANKA,
        kaynakAdi: selectedBank,
      }
    );
  };

  const buildElektrawebPipeline = async () => {
    const matchingContext = {
      selectedCompanyAccountPlan: normalizedAccountPlan,
      normalizedAccountPlan,
      learningMemory,
      companyId: selectedCompanyId,
      kuralMotoruRules: accountingRules,
      companyMappings: buildElektrawebCompanyMappings({
        ...(selectedCompany || {}),
        companyId: selectedCompanyId,
        kuralMotoruRules: accountingRules,
      }),
      documentSeriesRules: selectedCompany?.documentSeriesRules || [],
      accountingRules: selectedCompany?.accountingRules || {},
      employees: selectedCompany?.employees || [],
    };

    const formData = new FormData();
    formData.append("file", uploadedFile);
    formData.append(
      "matchingContext",
      JSON.stringify({ firmaId: selectedCompanyId, kaynakAdi: "ELEKTRAWEB", ...matchingContext })
    );

    const response = await fetch("/api/elektraweb", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Elektraweb dosyası işlenirken hata oluştu.");
    }

    const apiRows = Array.isArray(data.standardLucaRows) ? data.standardLucaRows : [];
    if (!apiRows.length) {
      throw new Error("Elektraweb parser sonucu boş döndü.");
    }

    // API kural motorunu uygulamadıysa burada tamamla.
    const withRules = applyRuleEngineToRows(apiRows, {
      accountingRules,
      companyId: selectedCompanyId,
      ruleType: sourceMeta.ruleType,
    });

    return ensureStandardLucaRowIds(sortStandardLucaRows(withRules));
  };

  const buildGenericPipeline = () => {
    const mapped = genericRawRows
      .map((raw, index) =>
        mapGenericExcelRowToStandardLuca(raw, index, {
          firmaId: selectedCompanyId,
          kaynakTipi: sourceMeta.kaynakTipi,
          kaynakAdi: sourceMeta.label,
        })
      )
      .filter((row) => String(row.borc || row.alacak || "").trim() || row.hesapKodu);

    const withRules = applyRuleEngineToRows(mapped, {
      accountingRules,
      companyId: selectedCompanyId,
      ruleType: sourceMeta.ruleType,
    });

    const withMemory = applyLearningMemoryToStandardLucaRows(withRules, learningMemory, {
      firmaId: selectedCompanyId,
      kaynakTipi: sourceMeta.kaynakTipi,
      kaynakAdi: sourceMeta.label,
    });

    return ensureStandardLucaRowIds(sortStandardLucaRows(withMemory));
  };

  const handleRunPipeline = async () => {
    if (!selectedCompanyId) {
      showToast("Önce firma seçmelisin.", "error");
      return;
    }

    if (sourceType === SOURCE_TYPES.BANKA && !parsedBankRows.length) {
      showToast("Önce banka ekstresi yüklemelisin.", "error");
      return;
    }

    if (sourceType === SOURCE_TYPES.ELEKTRAWEB && !uploadedFile) {
      showToast("Önce Elektraweb fiş dosyasını yüklemelisin.", "error");
      return;
    }

    if (sourceMeta.generic && !genericRawRows.length) {
      showToast("Önce dosya yüklemelisin.", "error");
      return;
    }

    if (
      (sourceType === SOURCE_TYPES.ELEKTRAWEB) &&
      normalizedAccountPlan.length === 0
    ) {
      showToast("Seçili firma için hesap planı bulunamadı.", "error");
      return;
    }

    setIsProcessing(true);
    setPipelineError("");
    setEditingRowId(null);
    setDraftRow(null);

    try {
      let rows = [];
      if (sourceType === SOURCE_TYPES.BANKA) {
        rows = buildBankPipeline();
      } else if (sourceType === SOURCE_TYPES.ELEKTRAWEB) {
        rows = await buildElektrawebPipeline();
      } else {
        rows = buildGenericPipeline();
      }

      setStandardLucaRows(rows);

      if (!rows.length) {
        setPipelineError("Dönüştürülecek geçerli satır bulunamadı.");
      } else {
        showToast(`${rows.length} satır dönüştürüldü.`, "success");
      }
    } catch (error) {
      console.error("Fiş dönüştürme hatası:", error);
      setPipelineError(error?.message || "Dönüştürme sırasında hata oluştu.");
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleRowEdit = (row) => {
    if (editingRowId === row.id) {
      setEditingRowId(null);
      setDraftRow(null);
      return;
    }
    setEditingRowId(row.id);
    setDraftRow(buildStandardLucaRowEditDraft(row));
  };

  const cancelRowEdit = () => {
    setEditingRowId(null);
    setDraftRow(null);
  };

  const addNewRow = () => {
    const newRow = finalizeStandardLucaRow({
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      firmaId: selectedCompanyId,
      kaynakTipi: sourceMeta.kaynakTipi,
      kaynakAdi: sourceMeta.label,
      fisNo: "",
      fisTarihi: "",
      fisAciklama: "",
      belgeTuru: "",
      hesapKodu: "",
      detayAciklama: "",
      borc: "",
      alacak: "",
    });

    console.log("ADDED ROW", newRow);

    setStandardLucaRows((prev) => [...prev, newRow]);
    // Yeni satır her zaman görünür olsun.
    setPreviewSearch("");
    setPreviewQuickFilter("all");
    setEditingRowId(newRow.id);
    setDraftRow(buildStandardLucaRowEditDraft(newRow));
  };

  const deleteRow = (row) => {
    console.log("DELETED ROW", row);

    setStandardLucaRows((prev) => prev.filter((item) => item.id !== row.id));

    if (editingRowId === row.id) {
      setEditingRowId(null);
      setDraftRow(null);
    }

    showToast("Satır silindi", "success");
  };

  const saveRowEdit = async () => {
    if (!editingRowId || !draftRow) return;

    const currentRow = standardLucaRows.find((row) => row.id === editingRowId);
    if (!currentRow) return;

    if (draftRow.saveToMemory && !selectedCompanyId) {
      showToast("Hafızaya kaydetmek için önce firma seçmelisin.", "error");
      return;
    }

    setIsSavingPreviewEdit(true);

    try {
      const updatedRow = finalizeStandardLucaRow(
        applyStandardLucaRowEditDraft(currentRow, draftRow)
      );

      console.log("UPDATED ROW", updatedRow);

      if (draftRow.saveToMemory && selectedCompanyId) {
        const payload = buildStandardLucaLearningMemoryPayload(
          currentRow,
          draftRow,
          selectedCompanyId
        );

        if (!payload.keyword) {
          showToast(
            "Satır güncellendi; arama anahtarı boş olduğu için hafızaya kaydedilemedi",
            "error"
          );
        } else {
          const created = await createLearningMemoryRecord(payload);
          if (created) {
            const nextMemory = await fetchLearningMemoryForCompany(selectedCompanyId);
            setLearningMemory(nextMemory);
            showToast("Satır güncellendi ve hafızaya kaydedildi", "success");
          } else {
            showToast("Satır güncellendi, hafıza kaydı oluşturulamadı", "error");
          }
        }
      } else {
        showToast("Satır güncellendi", "success");
      }

      setStandardLucaRows((prev) =>
        prev.map((row) => (row.id === editingRowId ? updatedRow : row))
      );
      cancelRowEdit();
    } finally {
      setIsSavingPreviewEdit(false);
    }
  };

  const exportLucaExcel = () => {
    if (!standardLucaRows.length) {
      showToast("Önce dönüştürme yapın.", "error");
      return;
    }

    const rows = sortStandardLucaRows(standardLucaRows);
    const uniqueFisNo = [...new Set(rows.map((row) => row.fisNo))];
    const chunkSize = 50;
    const totalFiles = Math.ceil(uniqueFisNo.length / chunkSize);
    const prefix = (sourceMeta.label || "fis")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    for (let fileIndex = 0; fileIndex < totalFiles; fileIndex += 1) {
      const chunkFisNos = new Set(
        uniqueFisNo.slice(fileIndex * chunkSize, fileIndex * chunkSize + chunkSize)
      );
      const chunkRows = rows.filter((row) => chunkFisNos.has(row.fisNo));
      const excelRows = standardLucaRowsToExcelRows(chunkRows);

      const worksheet = XLSX.utils.json_to_sheet(excelRows, {
        header: LUCA_EXPORT_HEADERS,
      });
      enforceLucaExportDateStrings(worksheet, ["Fiş Tarihi", "Evrak Tarihi"]);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Luca Fişleri");

      const suffix = totalFiles === 1 ? "luca" : `luca_${fileIndex + 1}`;
      XLSX.writeFile(workbook, `${prefix}_${suffix}.xlsx`);
    }

    if (totalFiles > 1) {
      showToast(`${totalFiles} adet Luca Excel dosyası oluşturuldu.`, "success");
    }
  };

  const exportControlReport = () => {
    if (!standardLucaRows.length) {
      showToast("Önce dönüştürme yapın.", "error");
      return;
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(buildFisKontrolExcelRows(analysis)),
      "Kontrol"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(buildFisKontrolIssueExcelRows(analysis)),
      "Bulgular"
    );
    XLSX.writeFile(workbook, "kontrol_raporu.xlsx");
  };

  const exportErrorReport = () => {
    if (!standardLucaRows.length) {
      showToast("Önce dönüştürme yapın.", "error");
      return;
    }

    const errorAnalysis = {
      issues: analysis.issues.filter(
        (issue) => issue.seviye === KONTROL_SEVIYE.HATA
      ),
    };

    if (!errorAnalysis.issues.length) {
      showToast("Hata seviyesinde kayıt bulunamadı.", "success");
      return;
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(buildFisKontrolIssueExcelRows(errorAnalysis)),
      "Hatalar"
    );
    XLSX.writeFile(workbook, "hata_raporu.xlsx");
  };

  const handleTransferToLuca = () => {
    if (!standardLucaRows.length) {
      showToast("Önce dönüştürme yapın.", "error");
      return;
    }
    if (!selectedCompanyId) {
      showToast("Önce firma seçmelisin.", "error");
      return;
    }

    savePendingLucaRows(
      buildStandardLucaTransferPayload({
        firmaId: selectedCompanyId,
        companyName: getCompanyDisplayName(selectedCompany),
        kaynakTipi: sourceMeta.kaynakTipi,
        kaynakAdi: sourceMeta.label,
        rows: standardLucaRows,
      })
    );

    router.push("/muhasebe/luca-donusturucu");
  };

  const formatAmount = (value) =>
    value === "" || value === null || value === undefined
      ? "—"
      : Number(value || 0).toLocaleString("tr-TR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

  return (
    <main className="relative min-h-screen bg-gray-950 p-6 text-white sm:p-8">
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

      <div className="mx-auto max-w-[1800px]">
        <MuhasebeMenu />

        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Fiş Dönüştürme Merkezi
          </h1>
          <p className="mt-2 text-gray-400">
            Tüm kaynakları tek pipeline ile StandardLucaRow formatına dönüştürün.
          </p>
        </header>

        {/* Pipeline akış çubuğu */}
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-800 bg-gray-900/60 p-3 text-xs">
          {PIPELINE_STEPS.map((step, index) => (
            <Fragment key={step}>
              <span className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 font-medium text-gray-300">
                {step}
              </span>
              {index < PIPELINE_STEPS.length - 1 && (
                <span className="text-gray-600">→</span>
              )}
            </Fragment>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          {/* SOL: konfigürasyon + önizleme */}
          <div className="space-y-6">
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <h2 className="mb-4 text-xl font-semibold">1. Firma & Kaynak</h2>

              <label className="mb-2 block text-sm text-gray-400">Firma Seç</label>
              <select
                value={selectedCompanyId}
                onChange={(e) => {
                  setSelectedCompanyId(e.target.value);
                  resetPipelineOutput();
                }}
                className="mb-6 w-full max-w-md rounded-xl border border-gray-700 bg-gray-950 p-3 text-white"
              >
                <CompanySelectOptions companies={companies} />
              </select>

              <label className="mb-2 block text-sm text-gray-400">Kaynak Tipi</label>
              <div className="mb-6 flex flex-wrap gap-2" role="radiogroup">
                {SOURCE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => changeSourceType(option.id)}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      sourceType === option.id
                        ? "bg-blue-600 text-white shadow-lg shadow-blue-500/30"
                        : "border border-gray-700 bg-gray-950 text-gray-300 hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {sourceMeta.needsBank && (
                <>
                  <label className="mb-2 block text-sm text-gray-400">Banka Seç</label>
                  <select
                    value={selectedBank}
                    onChange={(e) => {
                      setSelectedBank(e.target.value);
                      setParsedBankRows([]);
                      setUploadedFile(null);
                      setFileName("");
                      setRawCount(0);
                      resetPipelineOutput();
                    }}
                    className="mb-6 w-full max-w-md rounded-xl border border-gray-700 bg-gray-950 p-3 text-white"
                  >
                    {BANK_OPTIONS.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.label}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <label className="mb-2 block text-sm text-gray-400">
                {sourceMeta.uploadTitle}
              </label>
              <p className="mb-3 text-xs text-gray-500">{sourceMeta.uploadDesc}</p>

              <div className="flex flex-wrap items-center gap-4">
                <label className="cursor-pointer rounded-lg bg-blue-600 px-5 py-2 font-medium hover:bg-blue-700">
                  Dosya Seç
                  <input
                    type="file"
                    accept={sourceMeta.accept}
                    onChange={handleFile}
                    className="hidden"
                  />
                </label>
                <span className="text-sm text-gray-400">
                  {fileName || "Henüz dosya seçilmedi"}
                </span>
              </div>

              {rawCount > 0 && (
                <p className="mt-3 text-sm text-emerald-400">
                  Ham dosyadan {rawCount} satır okundu.
                </p>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleRunPipeline}
                  disabled={isProcessing}
                  className="rounded-xl bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-700 disabled:opacity-60"
                >
                  {isProcessing ? "İşleniyor..." : "Dönüştür (Pipeline Çalıştır)"}
                </button>
                <button
                  type="button"
                  onClick={handleTransferToLuca}
                  className="rounded-xl border border-gray-700 px-6 py-3 font-semibold text-gray-200 hover:bg-gray-800"
                >
                  Luca Fiş Üretici'ye Aktar →
                </button>
              </div>

              {pipelineError && (
                <p className="mt-4 rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                  {pipelineError}
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Ön İzleme</h2>
                <button
                  type="button"
                  onClick={addNewRow}
                  className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-950/70"
                >
                  + Yeni Satır Ekle
                </button>
              </div>

              {standardLucaRows.length === 0 ? (
                <p className="text-gray-400">
                  Henüz dönüştürme yapılmadı. Dosya yükleyip pipeline'ı çalıştırın veya
                  “Yeni Satır Ekle” ile manuel satır oluşturun.
                </p>
              ) : (
                <>
                  <RowSearchToolbar
                    search={previewSearch}
                    onSearchChange={setPreviewSearch}
                    placeholder="Fiş no, hesap, açıklama, belge türü veya tutar ara..."
                    filters={PREVIEW_FILTERS}
                    activeFilter={previewQuickFilter}
                    onFilterChange={setPreviewQuickFilter}
                    shownCount={filteredRows.length}
                    totalCount={standardLucaRows.length}
                  />

                  <div className="mt-4 overflow-auto">
                    <table className="w-full min-w-[1500px] text-sm">
                      <thead className="bg-gray-800">
                        <tr>
                          <th className="p-3 text-left">Fiş No</th>
                          <th className="p-3 text-left">Tarih</th>
                          <th className="p-3 text-left">Kaynak</th>
                          <th className="p-3 text-left">Hesap Kodu</th>
                          <th className="p-3 text-left">Belge Türü</th>
                          <th className="p-3 text-left">Açıklama</th>
                          <th className="p-3 text-right">Borç</th>
                          <th className="p-3 text-right">Alacak</th>
                          <th className="p-3 text-left">Risk / Kontrol</th>
                          <th className="p-3 text-center">İşlem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedRows.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-6 text-center text-gray-400">
                              Arama veya filtreye uygun satır bulunamadı.
                            </td>
                          </tr>
                        ) : (
                          displayedRows.map((row) => (
                            <Fragment key={row.id}>
                              <tr className="border-t border-gray-800">
                                <td className="p-3">{row.fisNo}</td>
                                <td className="p-3">{formatDateTR(row.fisTarihi)}</td>
                                <td className="p-3 text-xs text-gray-400">
                                  {row.kaynakAdi || row.kaynakTipi}
                                </td>
                                <td className="p-3 font-mono text-xs">
                                  {row.hesapKodu || "—"}
                                </td>
                                <td className="p-3">{row.belgeTuru || "—"}</td>
                                <td className="p-3">
                                  {row.detayAciklama || row.fisAciklama || "—"}
                                </td>
                                <td className="p-3 text-right">{formatAmount(row.borc)}</td>
                                <td className="p-3 text-right">{formatAmount(row.alacak)}</td>
                                <td className="p-3">
                                  <div className="flex flex-col gap-1">
                                    <div className="flex flex-wrap gap-1">
                                      {row._kontrol?.seviye &&
                                      row._kontrol.seviye !== "Temiz" ? (
                                        <RiskPill seviye={row._kontrol.riskSeviyesi} />
                                      ) : null}
                                      {row.hafizaEslesme ? (
                                        <span className="rounded-full border border-emerald-700/60 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                          Hafıza
                                        </span>
                                      ) : null}
                                      {rowMatchedByRuleEngine(row) ? (
                                        <span className="rounded-full border border-amber-700/60 bg-amber-950/50 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                                          Kural
                                        </span>
                                      ) : null}
                                      {getStandardLucaMissingBadges(row).map((badge) => (
                                        <span
                                          key={badge}
                                          className="rounded-full border border-red-700/60 bg-red-950/50 px-2 py-0.5 text-[10px] font-semibold text-red-300"
                                        >
                                          {badge}
                                        </span>
                                      ))}
                                    </div>
                                    {row._kontrol?.kontrolNotu ? (
                                      <span className="text-[11px] text-gray-400">
                                        {row._kontrol.kontrolNotu}
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center justify-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => toggleRowEdit(row)}
                                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                                        editingRowId === row.id
                                          ? "border-indigo-500 bg-indigo-950/60 text-indigo-200"
                                          : "border-gray-700 bg-gray-950 text-gray-300 hover:border-indigo-500 hover:text-white"
                                      }`}
                                    >
                                      Düzenle
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteRow(row)}
                                      className="rounded-lg border border-red-700/60 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-950/60"
                                    >
                                      Sil
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {editingRowId === row.id && draftRow ? (
                                <tr className="border-t border-gray-800">
                                  <td colSpan={10} className="p-4">
                                    <PreviewVoucherDetailPanel
                                      variant="standardLuca"
                                      draft={draftRow}
                                      onChange={setDraftRow}
                                      onSave={saveRowEdit}
                                      onCancel={cancelRowEdit}
                                      isSaving={isSavingPreviewEdit}
                                      showMemoryOption={false}
                                    />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-4 text-sm text-gray-400">
                    Toplam {standardLucaRows.length} satır.
                    {filteredRows.length !== standardLucaRows.length ||
                    displayedRows.length !== filteredRows.length
                      ? ` Görünen ${displayedRows.length}/${filteredRows.length}.`
                      : ""}
                  </p>
                </>
              )}
            </section>
          </div>

          {/* SAĞ: kontrol özeti + export */}
          <aside className="space-y-6">
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-4 text-lg font-semibold">Kontrol Özeti</h2>

              <div className="space-y-3">
                <SummaryRow
                  label="Eksik hesap"
                  value={controlSummary.eksikHesap}
                  tone={controlSummary.eksikHesap > 0 ? "danger" : "ok"}
                />
                <SummaryRow
                  label="Dengesiz fiş"
                  value={controlSummary.dengesizFis}
                  tone={controlSummary.dengesizFis > 0 ? "danger" : "ok"}
                />
                <SummaryRow
                  label="Riskli kayıt"
                  value={controlSummary.riskliKayit}
                  tone={controlSummary.riskliKayit > 0 ? "warning" : "ok"}
                />
                <SummaryRow
                  label="Öğrenen hafıza eşleşmesi"
                  value={controlSummary.hafizaEslesme}
                  tone="info"
                />
                <SummaryRow
                  label="Kural motoru eşleşmesi"
                  value={controlSummary.kuralEslesme}
                  tone="info"
                />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
                <MiniStat
                  label="Hata"
                  value={analysis.summary.hataIssueCount}
                  tone="danger"
                />
                <MiniStat
                  label="Uyarı"
                  value={analysis.summary.uyariIssueCount}
                  tone="warning"
                />
                <MiniStat
                  label="Bilgi"
                  value={analysis.summary.bilgiIssueCount}
                  tone="info"
                />
              </div>
            </section>

            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-4 text-lg font-semibold">Dışa Aktar</h2>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={exportLucaExcel}
                  className="rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold hover:bg-green-700"
                >
                  Luca Excel
                </button>
                <button
                  type="button"
                  onClick={exportControlReport}
                  className="rounded-xl border border-gray-700 bg-gray-950 px-4 py-2.5 text-sm font-semibold text-gray-200 hover:bg-gray-800"
                >
                  Kontrol Raporu
                </button>
                <button
                  type="button"
                  onClick={exportErrorReport}
                  className="rounded-xl border border-red-700/60 bg-red-950/30 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-950/60"
                >
                  Hata Raporu
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function RiskPill({ seviye }) {
  const styles = {
    Yüksek: "border-red-700/60 bg-red-950/50 text-red-300",
    Orta: "border-yellow-700/60 bg-yellow-950/50 text-yellow-300",
    Düşük: "border-emerald-700/60 bg-emerald-950/50 text-emerald-300",
  };
  const cls = styles[seviye] || styles.Düşük;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {seviye}
    </span>
  );
}

function SummaryRow({ label, value, tone = "ok" }) {
  const toneStyles = {
    ok: "text-emerald-300",
    danger: "text-red-300",
    warning: "text-yellow-300",
    info: "text-sky-300",
  };
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
      <span className="text-sm text-gray-300">{label}</span>
      <span className={`text-lg font-bold ${toneStyles[tone]}`}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value, tone = "info" }) {
  const toneStyles = {
    danger: "border-red-800/60 bg-red-950/40 text-red-300",
    warning: "border-yellow-700/60 bg-yellow-950/40 text-yellow-300",
    info: "border-sky-800/60 bg-sky-950/40 text-sky-300",
  };
  return (
    <div className={`rounded-lg border p-2 ${toneStyles[tone]}`}>
      <div className="text-base font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}
