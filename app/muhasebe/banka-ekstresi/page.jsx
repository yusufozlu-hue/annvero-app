"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import RowSearchToolbar from "../components/RowSearchToolbar";
import AccountSuggestionBadges from "../components/AccountSuggestionBadges";
import PreviewEyeButton from "../components/PreviewEyeButton";
import PreviewVoucherDetailPanel from "../components/PreviewVoucherDetailPanel";
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
import {
  bankMovementsToStandardLucaRows,
  buildStandardLucaTransferPayload,
  filterStandardLucaRows,
  getStandardLucaMissingBadges,
  KAYNAK_TIPI,
  logStandardLucaReport,
  LUCA_EXPORT_HEADERS,
  standardLucaRowsToExcelRows,
} from "@/src/utils/standardLucaRow";
import {
  formatParserDate,
  mapParsedRowsToStandardMovements,
  normalizeParserText,
} from "@/src/utils/bankMovementMapper";
import {
  fetchLearningMemoryForCompany,
  createLearningMemoryRecord,
  recordLearningMemoryUsage,
  updateLearningMemoryRecord,
} from "@/src/utils/learningMemory";
import {
  applyMovementEditDraft,
  buildLearningMemoryFromMovementRow,
  buildMovementEditDraft,
  MEMORY_MATCH_LABEL,
} from "@/src/utils/previewRowEdit";
import { hasBankMovementError } from "@/src/utils/tableSearch";
import { parseGarantiEkstre } from "../../../parsers/garantiParser";
import { parseVakifbankEkstre } from "../../../parsers/vakifbankParser";
import { bankaKurallari } from "../../../parsers/bankaKurallari";

const BANK_PREVIEW_FILTERS = [
  { id: "all", label: "Tümü" },
  { id: "errors", label: "Hatalılar" },
  { id: "missingAccount", label: "Hesap Eksik" },
  { id: "learningMemory", label: "Öğrenen Hafıza" },
  { id: "missingDescription", label: "Açıklama Eksik" },
  { id: "missingDocumentType", label: "Belge Türü Eksik" },
];

export default function BankaParserPage() {
  const [fileName, setFileName] = useState("");
  const [rawCount, setRawCount] = useState(0);
  const [parsedNormalizedRows, setParsedNormalizedRows] = useState([]);
  const [movementRows, setMovementRows] = useState([]);
  const [accountPlans, setAccountPlans] = useState({});
  const [ruleEngine, setRuleEngine] = useState({});
  const [learningMemory, setLearningMemory] = useState([]);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewQuickFilter, setPreviewQuickFilter] = useState("all");
  const [toast, setToast] = useState(null);
  const [applyingSuggestionRowId, setApplyingSuggestionRowId] = useState(null);
  const [expandedPreviewRowId, setExpandedPreviewRowId] = useState(null);
  const [previewEditDraft, setPreviewEditDraft] = useState(null);
  const [isSavingPreviewEdit, setIsSavingPreviewEdit] = useState(false);

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

  const formatAmount = (value) =>
    Number(value || 0).toLocaleString("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const standardLucaRows = useMemo(
    () =>
      bankMovementsToStandardLucaRows(movementRows, {
        firmaId: selectedCompanyId,
        kaynakAdi: selectedBank,
      }),
    [movementRows, selectedCompanyId, selectedBank]
  );

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

  const parseMoney = (value) => {
    if (typeof value === "number") return value;

    const text = String(value || "")
      .replaceAll("TL", "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");

    const number = Number(text);
    return Number.isNaN(number) ? 0 : number;
  };

  const findHeaderRowIndex = (rows) =>
    rows.findIndex((row) => {
      const text = row.map((cell) => normalizeParserText(cell)).join(" ");
      return text.includes("TARIH") && text.includes("ACIKLAMA");
    });

  const getCell = (row, headers, names) => {
    const list = Array.isArray(names) ? names : [names];

    for (const name of list) {
      const wanted = normalizeParserText(name).replace(/\s+/g, "");
      const index = headers.findIndex((header) =>
        normalizeParserText(header).replace(/\s+/g, "").includes(wanted)
      );

      if (index >= 0) return row[index];
    }

    return "";
  };

  const parseGenericBankEkstre = (sheetRows, bankaAdi) => {
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

        const dekontNo =
          getCell(row, headers, ["DEKONT", "DEKONT NO", "FİŞ NO", "FIS NO", "İŞLEM NO", "ISLEM NO"]) ||
          "";

        let borc = parseMoney(getCell(row, headers, ["BORÇ", "BORC", "ÇIKIŞ", "CIKIS"]));
        let alacak = parseMoney(getCell(row, headers, ["ALACAK", "GİRİŞ", "GIRIS"]));
        let tutar = parseMoney(getCell(row, headers, ["TUTAR", "İŞLEM TUTARI", "ISLEM TUTARI"]));

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
          borc: yon === "GIRIS" ? Math.abs(tutar) : 0,
          alacak: yon === "CIKIS" ? Math.abs(tutar) : 0,
          bakiye,
          tutar,
          yon,
          islemTipi: "DIGER",
        };
      })
      .filter(Boolean);
  };

  const normalizeStandardRow = (row) => {
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
      borc: borc || (yon === "GIRIS" ? Math.abs(tutar) : 0),
      alacak: alacak || (yon === "CIKIS" ? Math.abs(tutar) : 0),
      bakiye: row.bakiye || row.Bakiye || "",
      tutar: tutar || (yon === "GIRIS" ? Math.abs(borc) : -Math.abs(alacak)),
      yon,
      islemTipi: row.islemTipi || row.IslemTipi || "DIGER",
    };
  };

  const enrichParsedRows = (parsedRows) =>
    mapParsedRowsToStandardMovements(parsedRows, {
      selectedCompany,
      companyPlans,
      companyRules,
      selectedBank,
      legacyRules: bankaKurallari,
      learningMemory,
    });

  const applyPreviewRows = async (parsedRows) => {
    const rows = enrichParsedRows(parsedRows);
    setMovementRows(rows);
    await recordLearningMemoryUsage(rows);
  };

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

  const buildCariOptions = (row) =>
    (row.cariSuggestions || []).map((suggestion) => ({
      value: suggestion.code,
      label: `${suggestion.code} - ${suggestion.name || suggestion.label || ""}`.trim(),
    }));

  const togglePreviewRowDetail = (standardRow) => {
    const movementId = standardRow._movementId;
    if (!movementId) return;

    if (expandedPreviewRowId === movementId) {
      setExpandedPreviewRowId(null);
      setPreviewEditDraft(null);
      return;
    }

    const movement = movementById.get(movementId);
    if (!movement) return;

    setExpandedPreviewRowId(movementId);
    setPreviewEditDraft(buildMovementEditDraft(movement));
  };

  const cancelPreviewRowEdit = () => {
    setExpandedPreviewRowId(null);
    setPreviewEditDraft(null);
  };

  const savePreviewRowEdit = async () => {
    if (!expandedPreviewRowId || !previewEditDraft) return;

    const currentRow = movementRows.find((row) => row.id === expandedPreviewRowId);
    if (!currentRow) return;

    setIsSavingPreviewEdit(true);

    try {
      const updatedRow = applyMovementEditDraft(currentRow, previewEditDraft);

      setMovementRows((prev) =>
        prev.map((row) => (row.id === expandedPreviewRowId ? updatedRow : row))
      );

      if (previewEditDraft.saveToMemory && selectedCompanyId) {
        const memoryRecord = buildLearningMemoryFromMovementRow(
          currentRow,
          previewEditDraft,
          {
            companyId: selectedCompanyId,
            sourceModule: "banka",
            documentSeriesRules: selectedCompany?.documentSeriesRules || [],
          }
        );

        const created = await createLearningMemoryRecord(memoryRecord);

        if (created) {
          setLearningMemory((prev) => [created, ...prev]);
          showToast("Düzeltme hafızaya kaydedildi", "success");
        } else {
          showToast("Satır güncellendi, hafıza kaydı oluşturulamadı", "error");
        }
      } else {
        showToast("Satır güncellendi", "success");
      }

      cancelPreviewRowEdit();
    } finally {
      setIsSavingPreviewEdit(false);
    }
  };

  const exportExcel = () => {
    if (standardLucaRows.length === 0) {
      alert("Önce standart hareket oluşturmalısın.");
      return;
    }

    const excelRows = standardLucaRowsToExcelRows(standardLucaRows);
    const fisMap = {};

    excelRows.forEach((row) => {
      const fisNo = row["Fiş No"];
      if (!fisMap[fisNo]) fisMap[fisNo] = [];
      fisMap[fisNo].push(row);
    });

    const allFisler = Object.values(fisMap);
    const chunkSize = 50;

    for (let i = 0; i < allFisler.length; i += chunkSize) {
      const chunk = allFisler.slice(i, i + chunkSize);
      const chunkRows = chunk.flat();

      const worksheet = XLSX.utils.json_to_sheet(chunkRows, {
        header: LUCA_EXPORT_HEADERS,
      });

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Luca Fisleri");

      const ilkFis = i + 1;
      const sonFis = Math.min(i + chunkSize, allFisler.length);

      XLSX.writeFile(
        workbook,
        `${selectedBank.toLowerCase()}_luca_${ilkFis}-${sonFis}.xlsx`
      );
    }

    logStandardLucaReport("banka-export", standardLucaRows);
  };

  const handleGoToLucaProducer = (event) => {
    if (standardLucaRows.length === 0) {
      event.preventDefault();
      alert("Önce banka ekstresi yükleyip ön izleme oluşturmalısın.");
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

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setRawCount(0);
    setMovementRows([]);

    let workbook;

    try {
      const data = await file.arrayBuffer();

      workbook = XLSX.read(data, {
        cellDates: true,
        type: "array",
      });
    } catch {
      try {
        const text = await file.text();

        workbook = XLSX.read(text, {
          type: "string",
          cellDates: true,
        });
      } catch {
        alert(
          "Bu dosya Excel olarak okunamadı. Lütfen dosyayı Excel'de açıp .xlsx olarak Farklı Kaydet yapıp tekrar yükle."
        );
        return;
      }
    }

    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

    const sheetRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
    });

    setRawCount(sheetRows.length);

    let parsedRows = [];

    if (selectedBank === "GARANTI") parsedRows = parseGarantiEkstre(sheetRows);
    if (selectedBank === "VAKIFBANK") parsedRows = parseVakifbankEkstre(sheetRows);
    if (selectedBank === "TEB") parsedRows = parseGenericBankEkstre(sheetRows, "TEB");
    if (selectedBank === "KUVEYT") parsedRows = parseGenericBankEkstre(sheetRows, "KUVEYT");
    if (selectedBank === "ZIRAAT") parsedRows = parseGenericBankEkstre(sheetRows, "ZIRAAT");

    const normalizedRows = parsedRows.map(normalizeStandardRow);
    setParsedNormalizedRows(normalizedRows);
    await applyPreviewRows(normalizedRows);
  };

  const handleCreatePreview = async () => {
    if (!selectedCompanyId) {
      alert("Önce firma seçmelisin.");
      return;
    }

    if (parsedNormalizedRows.length === 0) {
      alert("Önce banka ekstresi yüklemelisin.");
      return;
    }

    await applyPreviewRows(parsedNormalizedRows);
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
      <MuhasebeMenu />

      <h1 className="mb-10 text-4xl font-bold">Banka Parser Merkezi</h1>

      <div className="grid max-w-7xl gap-6">
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-2xl font-semibold">Firma ve Banka Ekstresi</h2>

          <label className="mb-2 block text-sm text-gray-400">Firma Seç</label>

          <select
            value={selectedCompanyId}
            onChange={(e) => {
              setSelectedCompanyId(e.target.value);
              setMovementRows([]);
            }}
            className="mb-6 min-w-[320px] rounded-xl border border-gray-700 bg-gray-950 p-3 text-white"
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
            onChange={(e) => {
              setSelectedBank(e.target.value);
              setMovementRows([]);
              setFileName("");
              setRawCount(0);
            }}
            className="mb-6 min-w-[320px] rounded-xl border border-gray-700 bg-gray-950 p-3 text-white"
          >
            <option value="GARANTI">Garanti Bankası</option>
            <option value="VAKIFBANK">Vakıfbank</option>
            <option value="TEB">TEB</option>
            <option value="KUVEYT">Kuveyt Türk</option>
            <option value="ZIRAAT">Ziraat Bankası</option>
          </select>

          <p className="mb-6 text-gray-400">
            Banka ekstresi Excel dosyasını yükleyin.
          </p>

          <div className="flex items-center gap-4">
            <label className="cursor-pointer rounded-lg bg-blue-600 px-5 py-2 font-medium hover:bg-blue-700">
              Dosya Seç
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFile}
                className="hidden"
              />
            </label>

            <span className="text-gray-400">
              {fileName || "Henüz dosya seçilmedi"}
            </span>
          </div>

          {rawCount > 0 && (
            <p className="mt-4 text-sm text-green-400">
              Ham dosyadan {rawCount} satır okundu.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <button
            onClick={handleCreatePreview}
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-700"
          >
            Ön İzleme Oluştur
          </button>

          <button
            onClick={exportExcel}
            className="rounded-xl bg-green-600 px-6 py-3 font-semibold hover:bg-green-700"
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

              <div className="overflow-auto">
              <table className="w-full min-w-[1800px] text-sm">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="p-3 text-left">Fiş No</th>
                    <th className="p-3 text-left">Fiş Tarihi</th>
                    <th className="p-3 text-left">Hesap Kodu</th>
                    <th className="p-3 text-left">Belge Türü</th>
                    <th className="p-3 text-left">Fiş Açıklama</th>
                    <th className="p-3 text-left">Detay Açıklama</th>
                    <th className="p-3 text-right">Borç</th>
                    <th className="p-3 text-right">Alacak</th>
                    <th className="p-3 text-left">Risk</th>
                    <th className="p-3 text-left">Kontrol Notu</th>
                    <th className="p-3 text-center">Detay</th>
                  </tr>
                </thead>

                <tbody>
                  {displayedStandardLucaRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={11}
                        className="p-6 text-center text-gray-400"
                      >
                        Arama veya filtreye uygun satır bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    displayedStandardLucaRows.map((row) => {
                      const movement = row._movementId
                        ? movementById.get(row._movementId)
                        : null;

                      return (
                      <Fragment key={row.id}>
                        <tr className="border-t border-gray-800">
                          <td className="p-3">{row.fisNo}</td>
                          <td className="p-3">{row.fisTarihi}</td>
                          <td className="p-3 font-mono text-xs">{row.hesapKodu || "—"}</td>
                          <td className="p-3">{row.belgeTuru || "—"}</td>
                          <td className="p-3">{row.fisAciklama || "—"}</td>
                          <td className="p-3">{row.detayAciklama || "—"}</td>
                          <td className="p-3 text-right">{formatAmount(row.borc)}</td>
                          <td className="p-3 text-right">{formatAmount(row.alacak)}</td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {row.riskDurumu ? (
                                <span className="rounded-full border border-red-700/60 bg-red-950/50 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                                  {row.riskDurumu}
                                </span>
                              ) : null}
                              {getStandardLucaMissingBadges(row)
                                .filter((badge) => badge !== "Hesap eksik")
                                .map((badge) => (
                                  <span
                                    key={badge}
                                    className="rounded-full border border-red-700/60 bg-red-950/50 px-2 py-0.5 text-[10px] font-semibold text-red-300"
                                  >
                                    {badge}
                                  </span>
                                ))}
                              {row.hafizaEslesme ? (
                                <span className="rounded-full border border-emerald-700/60 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                  Hafızadan eşleşti
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className={`p-3 ${getMovementWarningClass(row.kontrolNotu)}`}>
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
                          </td>
                          <td className="p-3 text-center">
                            {movement ? (
                              <PreviewEyeButton
                                active={expandedPreviewRowId === movement.id}
                                onClick={() => togglePreviewRowDetail(row)}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>

                        {movement &&
                        expandedPreviewRowId === movement.id &&
                        previewEditDraft ? (
                          <tr className="border-t border-gray-800">
                            <td colSpan={11} className="p-4">
                              <PreviewVoucherDetailPanel
                                draft={previewEditDraft}
                                onChange={setPreviewEditDraft}
                                onSave={savePreviewRowEdit}
                                onCancel={cancelPreviewRowEdit}
                                cariOptions={buildCariOptions(movement)}
                                isSaving={isSavingPreviewEdit}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                    })
                  )}
                </tbody>
              </table>
              </div>

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
