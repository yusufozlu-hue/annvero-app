"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import PreviewVoucherDetailPanel from "../components/PreviewVoucherDetailPanel";
import AnnveroEditableDataTable from "@/src/components/AnnveroEditableDataTable";
import ParserJobProgress from "@/src/components/ParserJobProgress";
import { useParserJob } from "@/src/hooks/useParserJob";
import { logParserJobError } from "@/src/utils/parserJobLogger";
import { PARSER_WORKER_URLS } from "@/src/utils/parserWorkerUrls";
import { runFisKontrolWorker } from "@/src/utils/workerParserBridge";
import { useCompanyList } from "../hooks/useCompanyList";
import { logOperationalEvent, SYSTEM_ERROR_TYPES } from "@/src/utils/systemLogEngine";
import {
  assertLucaTransferHydrateBinding,
  clearAllLucaTransferDatasets,
  clearPendingLucaRows,
  deleteLucaTransferDataset,
  loadLucaTransferDataset,
  loadPendingLucaRows,
  resolveAuthUserIdForTransfer,
  savePendingLucaRows,
} from "@/src/utils/companyCenter";
import {
  analyzeStandardLucaRows,
  buildFisKontrolExcelRows,
  buildFisKontrolIssueExcelRows,
  buildPassedExportPayload,
  filterKontrolRows,
  filterPassedRowsForExport,
  KONTROL_DURUM,
  KONTROL_SEVIYE,
  DUPLICATE_VOUCHER_UI_MESSAGE,
} from "@/src/utils/fisKontrolMerkezi";
import {
  applyStandardLucaRowEditDraft,
  buildStandardLucaRowEditDraft,
  DOCUMENT_TYPE_OPTIONS,
  resolveStandardLucaEditRowId,
} from "@/src/utils/previewRowEdit";
import {
  buildStandardLucaTransferPayload,
  ensureStandardLucaRowIds,
  finalizeStandardLucaRow,
  isStandardLucaPayload,
} from "@/src/utils/standardLucaRow";
import {
  persistFisKontrolAccountingDecision,
  FIS_KONTROL_LEARN_MSG,
} from "@/src/utils/fisKontrolAccountingMemory";
import { loadAccountPlansFromStorage } from "@/src/utils/companyCenter";

const FILTER_OPTIONS = [
  { id: "all", label: "Tümü" },
  { id: "hata", label: "Hata" },
  { id: "uyari", label: "Uyarı" },
  { id: "gecti", label: "Geçti" },
  { id: "bilgi", label: "Bilgi" },
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getSourceLabel(payload) {
  if (!payload) return "Kaynak yok";

  const parts = [
    payload.companyName || payload.firmaId || payload.companyId,
    payload.kaynakTipi,
    payload.kaynakAdi,
  ].filter(Boolean);

  return parts.join(" · ") || "StandardLucaRows";
}

function seviyeBadgeClass(seviye) {
  if (seviye === KONTROL_SEVIYE.HATA) {
    return "bg-red-900/60 text-red-200";
  }

  if (seviye === KONTROL_SEVIYE.UYARI) {
    return "bg-amber-900/60 text-amber-200";
  }

  if (seviye === KONTROL_SEVIYE.BILGI) {
    return "bg-sky-900/60 text-sky-200";
  }

  return "bg-emerald-900/60 text-emerald-200";
}

function riskBadgeClass(riskSeviyesi) {
  if (riskSeviyesi === "Yüksek") return "text-red-300";
  if (riskSeviyesi === "Orta") return "text-amber-300";
  if (riskSeviyesi === "Düşük") return "text-sky-300";
  return "text-emerald-300";
}

function normalizeIncomingPayload(pending) {
  if (!pending?.rows?.length || !isStandardLucaPayload(pending)) return null;
  const normalizedRows = ensureStandardLucaRowIds(
    pending.rows.map((row) =>
      finalizeStandardLucaRow({
        ...row,
        firmaId: row.firmaId || pending.firmaId || pending.companyId || "",
        kaynakTipi: row.kaynakTipi || pending.kaynakTipi || "",
        kaynakAdi:
          row.kaynakAdi ||
          pending.kaynakAdi ||
          pending.bankName ||
          pending.selectedBank ||
          "",
      })
    )
  );
  return { pending, normalizedRows };
}

export default function FisKontrolPage() {
  const { getCompanyDisplayName, selectedCompanyId, selectedCompany } =
    useCompanyList();
  const searchParams = useSearchParams();
  const urlCompanyId = String(searchParams.get("companyId") || "").trim();
  const urlSource = String(searchParams.get("source") || "").trim().toLowerCase();
  const urlRunId = String(searchParams.get("runId") || "").trim();

  const [payload, setPayload] = useState(null);
  const [rows, setRows] = useState([]);
  const [hydrateEmptyMessage, setHydrateEmptyMessage] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editingRowId, setEditingRowId] = useState(null);
  const [draftRow, setDraftRow] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [analysis, setAnalysis] = useState({ rows: [], issues: [], summary: {} });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const processedKeysRef = useRef(new Set());
  const analysisAbortRef = useRef(null);
  const hydratedRunKeyRef = useRef("");

  const parserJob = useParserJob({
    logMeta: {
      module: "Fiş Kontrol Merkezi",
      companyId: payload?.companyId || payload?.firmaId || "",
      companyName: payload?.companyName || "",
      jobType: "fis-kontrol",
    },
  });

  const FIS_KONTROL_WORKER_THRESHOLD = 300;

  const showToast = (message, type) => setToast({ message, type });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const applyNormalizedPayload = useCallback((normalized) => {
    if (!normalized) {
      setPayload(null);
      setRows([]);
      setEditingRowId(null);
      setDraftRow(null);
      setEditSaving(false);
      return;
    }
    setPayload(normalized.pending);
    setRows(normalized.normalizedRows);
    setEditingRowId(null);
    setDraftRow(null);
    setEditSaving(false);
    setHydrateEmptyMessage("");
  }, []);

  const loadPendingData = useCallback(async () => {
    const activeCompanyId = String(selectedCompanyId || "").trim();
    const urlCompany = String(urlCompanyId || "").trim();
    const transferSource =
      urlSource === "bank" || urlSource === "banka"
        ? "bank"
        : urlSource === "elektraweb" || urlSource === "elektra"
          ? "elektraweb"
          : "bank";

    const authUserId = await resolveAuthUserIdForTransfer();

    // URL company manipülasyonu: aktif firma yoksa veya URL ≠ aktif → render yok
    if (urlCompany && activeCompanyId && urlCompany !== activeCompanyId) {
      setHydrateEmptyMessage(
        "Aktarım bağlantısı aktif firma ile eşleşmiyor. Doğru firmayı seçin."
      );
      applyNormalizedPayload(null);
      setAnalysis({ rows: [], issues: [], summary: {} });
      processedKeysRef.current = new Set();
      return;
    }

    if (!activeCompanyId) {
      setHydrateEmptyMessage("Fiş Kontrol için önce firma seçin.");
      applyNormalizedPayload(null);
      return;
    }

    if (!authUserId) {
      setHydrateEmptyMessage(
        "Oturum bulunamadı. Yeniden giriş yapıp Banka Parser’dan tekrar gönderin."
      );
      applyNormalizedPayload(null);
      return;
    }

    if (urlSource || urlRunId || urlCompany) {
      const transferred = await loadLucaTransferDataset({
        source: transferSource,
        companyId: activeCompanyId,
        runId: urlRunId,
        authUserId,
        urlCompanyId: urlCompany || activeCompanyId,
        strictBinding: true,
        purgeOnReject: true,
      });

      if (!transferred) {
        setHydrateEmptyMessage(
          "Aktarım verisi geçersiz, süresi dolmuş veya yetkisiz. Banka Parser’dan yeniden gönderin."
        );
        applyNormalizedPayload(null);
        setAnalysis({ rows: [], issues: [], summary: {} });
        processedKeysRef.current = new Set();
        hydratedRunKeyRef.current = "";
        return;
      }

      const binding = assertLucaTransferHydrateBinding({
        dataset: transferred,
        activeCompanyId,
        urlCompanyId: urlCompany || activeCompanyId,
        urlRunId,
        authUserId,
        expectedSource: transferSource,
      });
      if (!binding.ok) {
        if (binding.cleanup) {
          await deleteLucaTransferDataset({
            source: transferSource,
            companyId: activeCompanyId,
            runId: transferred.runId || transferred.datasetId || urlRunId,
          });
        }
        setHydrateEmptyMessage(
          "Aktarım doğrulanamadı. Hassas fiş satırları gösterilmedi."
        );
        applyNormalizedPayload(null);
        setAnalysis({ rows: [], issues: [], summary: {} });
        return;
      }

      const runKey = `${transferSource}:${binding.companyId}:${binding.runId}:${authUserId}`;
      if (hydratedRunKeyRef.current === runKey) {
        return;
      }
      hydratedRunKeyRef.current = runKey;
      applyNormalizedPayload(normalizeIncomingPayload(transferred));
      return;
    }

    // Legacy pending — yalnız aynı firma + oturum; aksi halde temizle
    const pending = loadPendingLucaRows();
    if (!pending?.rows?.length || !isStandardLucaPayload(pending)) {
      applyNormalizedPayload(null);
      setHydrateEmptyMessage(
        "Aktarım verisi bulunamadı. Banka Parser’dan “Fiş Kontrol’e Git” ile gönderin."
      );
      return;
    }

    const pendingFirma = String(pending.firmaId || pending.companyId || "").trim();
    if (!pendingFirma || pendingFirma !== activeCompanyId) {
      clearPendingLucaRows();
      setHydrateEmptyMessage(
        "Önceki firmanın bekleyen fişleri temizlendi. Aktif firma için Banka Parser’dan yeniden gönderin."
      );
      applyNormalizedPayload(null);
      processedKeysRef.current = new Set();
      hydratedRunKeyRef.current = "";
      return;
    }

    applyNormalizedPayload(normalizeIncomingPayload(pending));
  }, [
    selectedCompanyId,
    urlCompanyId,
    urlSource,
    urlRunId,
    applyNormalizedPayload,
  ]);

  // Logout / kullanıcı değişimi: satırları gizle, transfer cache temizle
  useEffect(() => {
    let cancelled = false;
    let subscription = null;
    (async () => {
      try {
        const { getSupabaseClient } = await import("@/src/lib/supabaseClient");
        const supabase = getSupabaseClient();
        if (!supabase?.auth?.onAuthStateChange) return;
        const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (cancelled) return;
          if (event === "SIGNED_OUT" || !session?.user?.id) {
            applyNormalizedPayload(null);
            setAnalysis({ rows: [], issues: [], summary: {} });
            hydratedRunKeyRef.current = "";
            await clearAllLucaTransferDatasets();
            setHydrateEmptyMessage(
              "Oturum kapandı. Fiş aktarımı için yeniden giriş yapın."
            );
          }
        });
        subscription = data?.subscription;
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
      try {
        subscription?.unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, [applyNormalizedPayload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadPendingData();
    })();
    const onFocus = () => {
      loadPendingData();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [loadPendingData]);

  useEffect(() => {
    processedKeysRef.current = new Set();
    hydratedRunKeyRef.current = "";
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPayload(null);
      setRows([]);
      setAnalysis({ rows: [], issues: [], summary: {} });
      setEditingRowId(null);
      setDraftRow(null);
      setEditSaving(false);
      loadPendingData();
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, loadPendingData]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!rows.length) {
        setAnalysis({ rows: [], issues: [], summary: {} });
        return;
      }

      const analyzeOpts = {
        firmaId: selectedCompanyId || payload?.firmaId || payload?.companyId || "",
        processedSourceKeys: processedKeysRef.current,
      };

      if (rows.length < FIS_KONTROL_WORKER_THRESHOLD) {
        setAnalysis(analyzeStandardLucaRows(rows, analyzeOpts));
        return;
      }

      setAnalysisLoading(true);
      parserJob.begin({
        stage: "Fiş kontrolü",
        detail: `${rows.length} satır analiz ediliyor`,
      });

      (async () => {
        try {
          let nextAnalysis;
          try {
            const workerResult = await runFisKontrolWorker({
              workerUrl: PARSER_WORKER_URLS.fisKontrol,
              payload: { rows, options: analyzeOpts },
              onProgress: parserJob.onProgress,
            });
            nextAnalysis = workerResult.analysis;
          } catch {
            nextAnalysis = analyzeStandardLucaRows(rows, analyzeOpts);
          }
          if (!cancelled) {
            setAnalysis(nextAnalysis);
            parserJob.markSuccess("Fiş kontrol analizi tamamlandı");
          }
        } catch (error) {
          if (!cancelled) {
            logParserJobError(error, {
              module: "Fiş Kontrol Merkezi",
              companyId: payload?.companyId || payload?.firmaId || "",
              companyName: payload?.companyName || "",
              errorType: SYSTEM_ERROR_TYPES.UNEXPECTED,
              jobType: "fis-kontrol",
            });
            parserJob.markError(error);
            setAnalysis(analyzeStandardLucaRows(rows, analyzeOpts));
          }
        } finally {
          if (!cancelled) setAnalysisLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [rows, selectedCompanyId, payload?.companyId, payload?.companyName, payload?.firmaId]);
  const riskLoggedRef = useRef("");

  useEffect(() => {
    if (!analysis.issues.length) return;
    const highRisk = analysis.issues.filter((issue) => issue.seviye === KONTROL_SEVIYE.HATA);
    if (!highRisk.length) return;

    const signature = `${payload?.companyId || ""}:${highRisk.length}:${highRisk[0]?.type || ""}`;
    if (riskLoggedRef.current === signature) return;
    riskLoggedRef.current = signature;

    logOperationalEvent({
      module: "Fiş Kontrol Merkezi",
      message: `${highRisk.length} kritik kontrol uyarısı`,
      level: "warning",
      companyId: payload?.companyId || payload?.firmaId || "",
      companyName: payload?.companyName || "",
      errorType: SYSTEM_ERROR_TYPES.RISK_FLAG,
      technicalDetail: highRisk.slice(0, 5).map((issue) => issue.message),
      suggestion: "Hatalı satırları düzenleyin veya fişi yeniden üretin.",
    });
  }, [analysis.issues, payload]);

  const filteredRows = useMemo(() => {
    const baseRows = filterKontrolRows(analysis.rows, filter);

    const query = search.trim().toLocaleLowerCase("tr");
    if (!query) return baseRows;

    return baseRows.filter((row) => {
      const haystack = [
        row.fisNo,
        row.fisTarihi,
        row.fisAciklama,
        row.detayAciklama,
        row.hesapKodu,
        row.belgeTuru,
        row.evrakNo,
        row._kontrol?.kontrolNotu,
        row._kontrol?.riskSeviyesi,
        row.kaynakTipi,
        row.kaynakAdi,
      ]
        .join(" ")
        .toLocaleLowerCase("tr");

      return haystack.includes(query);
    });
  }, [analysis.rows, filter, search]);

  const fisKontrolColumns = useMemo(
    () => [
      { key: "rowIndex", label: "#", render: (row) => row._kontrol?.rowIndex },
      { key: "fisNo", label: "Fiş", sortable: true },
      { key: "fisTarihi", label: "Tarih", sortable: true },
      {
        key: "kaynak",
        label: "Kaynak",
        render: (row) => (
          <div>
            <div>{row.kaynakTipi || "—"}</div>
            <div className="text-xs text-gray-500">{row.kaynakAdi || "—"}</div>
          </div>
        ),
      },
      {
        key: "hesapKodu",
        label: "Hesap",
        editable: true,
        editKey: "hesapKodu",
        editDisplay: (row) =>
          String(editingRowId) === String(resolveStandardLucaEditRowId(row))
            ? null
            : row.hesapKodu || "—",
      },
      {
        key: "aciklama",
        label: "Açıklama",
        editable: true,
        editKey: "fisAciklama",
        editDisplay: (row) =>
          String(editingRowId) === String(resolveStandardLucaEditRowId(row))
            ? null
            : row.detayAciklama || row.fisAciklama || "—",
      },
      {
        key: "borc",
        label: "Borç",
        render: (row) => formatMoney(row.borc),
      },
      {
        key: "alacak",
        label: "Alacak",
        render: (row) => formatMoney(row.alacak),
      },
      {
        key: "belgeTuru",
        label: "Belge",
        editable: true,
        editKey: "belgeTuru",
        editType: "select",
        editOptions: DOCUMENT_TYPE_OPTIONS.map((option) => ({ value: option, label: option })),
      },
      {
        key: "risk",
        label: "Risk",
        render: (row) => (
          <div>
            <span className={`font-semibold ${riskBadgeClass(row._kontrol.riskSeviyesi)}`}>
              {row._kontrol.riskSeviyesi}
            </span>
            <div className="mt-1">
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${seviyeBadgeClass(row._kontrol.seviye)}`}
              >
                {row._kontrol.seviye}
              </span>
            </div>
          </div>
        ),
      },
      {
        key: "kontrolNotu",
        label: "Kontrol Notu",
        render: (row) => row._kontrol.kontrolNotu || "—",
      },
    ],
    [editingRowId]
  );

  const tableDrafts = useMemo(() => {
    if (!editingRowId || !draftRow) return {};
    return { [editingRowId]: draftRow };
  }, [editingRowId, draftRow]);

  const groupedIssues = useMemo(
    () => ({
      hata: analysis.issues.filter((issue) => issue.seviye === KONTROL_SEVIYE.HATA),
      uyari: analysis.issues.filter((issue) => issue.seviye === KONTROL_SEVIYE.UYARI),
      bilgi: analysis.issues.filter((issue) => issue.seviye === KONTROL_SEVIYE.BILGI),
    }),
    [analysis.issues]
  );

  const persistRows = (nextRows) => {
    if (!payload) return;

    const nextPayload = buildStandardLucaTransferPayload({
      firmaId: payload.firmaId || payload.companyId,
      companyName:
        payload.companyName ||
        getCompanyDisplayName({ id: payload.companyId, name: payload.companyName }),
      kaynakTipi: payload.kaynakTipi,
      kaynakAdi: payload.kaynakAdi,
      rows: nextRows,
    });

    savePendingLucaRows(nextPayload);
    setPayload(nextPayload);
    setRows(nextRows);
  };

  const openEdit = (row, index = 0) => {
    // Her düzenleme oturumu taze draft — önceki satırın learn state'i taşınmaz
    const rowId = resolveStandardLucaEditRowId(row, index);
    const sourceRow =
      rows.find((item) => String(item.id) === String(rowId)) ||
      rows.find(
        (item) =>
          row?.identityKey &&
          item.identityKey &&
          String(item.identityKey) === String(row.identityKey)
      ) ||
      row;

    if (
      sourceRow &&
      rows.includes(sourceRow) &&
      (sourceRow.id === undefined ||
        sourceRow.id === null ||
        String(sourceRow.id).trim() === "")
    ) {
      setRows((prev) =>
        prev.map((item) => (item === sourceRow ? { ...item, id: rowId } : item))
      );
    }

    setEditingRowId(rowId);
    setDraftRow({
      ...buildStandardLucaRowEditDraft({ ...sourceRow, id: rowId }),
      saveToMemory: false,
      learnForCompany: false,
    });
  };

  const patchDraftField = (rowId, field, value) => {
    if (String(rowId) !== String(editingRowId)) return;
    setDraftRow((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const cancelEdit = () => {
    setEditingRowId(null);
    setDraftRow(null);
  };

  const saveEdit = async () => {
    if (!editingRowId || !draftRow || editSaving) return;

    const currentRow =
      rows.find((row) => String(row.id) === String(editingRowId)) ||
      rows.find(
        (row, index) => resolveStandardLucaEditRowId(row, index) === String(editingRowId)
      );
    if (!currentRow) return;

    // Opt-in: yalnız açıkça işaretlenmişse firma hafızasına yaz
    const learnForCompany = draftRow.saveToMemory === true;
    const updatedRow = finalizeStandardLucaRow(
      applyStandardLucaRowEditDraft(currentRow, draftRow)
    );

    const nextRows = rows.map((row) =>
      String(row.id) === String(editingRowId)
        ? {
            ...updatedRow,
            id: row.id || editingRowId,
            manuallyEdited: true,
            // Canonical öğrenme rozeti yalnız server başarı sonrası
            hafizaEslesme: false,
          }
        : row
    );

    // Satır düzeltmesi her zaman uygulanır (hafıza başarısız olsa bile)
    persistRows(nextRows);

    if (!learnForCompany) {
      showToast(FIS_KONTROL_LEARN_MSG.EDIT_ONLY, "success");
      cancelEdit();
      return;
    }

    setEditSaving(true);
    try {
      const memoryResult = await persistFisKontrolAccountingDecision({
        learnForCompany: true,
        companyId:
          selectedCompanyId ||
          payload?.firmaId ||
          payload?.companyId ||
          updatedRow.firmaId ||
          "",
        company: selectedCompany,
        currentRow,
        updatedRow,
        draft: draftRow,
        payload,
        accountPlans: loadAccountPlansFromStorage(),
        autoAnalysis: false,
      });

      if (memoryResult?.persisted || memoryResult?.toastKind === "saved") {
        const learnedRows = nextRows.map((row) =>
          String(row.id) === String(editingRowId)
            ? { ...row, hafizaEslesme: true, accountMemoryServerPersisted: true }
            : row
        );
        persistRows(learnedRows);
        showToast(FIS_KONTROL_LEARN_MSG.SAVED, "success");
      } else if (memoryResult?.skipped && memoryResult?.rejectReason === "remember_not_checked") {
        showToast(FIS_KONTROL_LEARN_MSG.EDIT_ONLY, "success");
      } else if (memoryResult?.skipped) {
        // Kapı reddi (plan/direction vb.) — satır kaydı durur, canonical öğrenme yok
        showToast(FIS_KONTROL_LEARN_MSG.EDIT_MEMORY_FAILED, "error");
      } else {
        showToast(FIS_KONTROL_LEARN_MSG.EDIT_MEMORY_FAILED, "error");
      }
    } catch {
      showToast(FIS_KONTROL_LEARN_MSG.EDIT_MEMORY_FAILED, "error");
    } finally {
      setEditSaving(false);
      cancelEdit();
    }
  };

  const exportControlReport = () => {
    if (!analysis.rows.length) {
      showToast("Dışa aktarılacak satır yok", "error");
      return;
    }

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet([
      {
        Kaynak: getSourceLabel(payload),
        "Toplam Satır": analysis.summary.totalRows,
        "Toplam Fiş": analysis.summary.totalFis,
        "Hatalı Satır": analysis.summary.hataRowCount,
        "Hata Kaydı": analysis.summary.hataIssueCount,
        "Uyarı Kaydı": analysis.summary.uyariIssueCount,
        "Bilgi Kaydı": analysis.summary.bilgiIssueCount,
        "Geçti Satır": analysis.summary.gectiRowCount,
        "Temiz Satır": analysis.summary.temizRowCount,
        "Denge Durumu": analysis.summary.balanceStatus,
      },
    ]);
    const rowsSheet = XLSX.utils.json_to_sheet(buildFisKontrolExcelRows(analysis));
    const issuesSheet = XLSX.utils.json_to_sheet(
      buildFisKontrolIssueExcelRows(analysis)
    );

    XLSX.utils.book_append_sheet(workbook, summarySheet, "Özet");
    XLSX.utils.book_append_sheet(workbook, rowsSheet, "Satırlar");
    XLSX.utils.book_append_sheet(workbook, issuesSheet, "Kontroller");

    const fileName = `Fis_Kontrol_Raporu_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    showToast("Kontrol raporu indirildi", "success");
  };

  const exportPassedOnly = () => {
    const result = buildPassedExportPayload(analysis, payload || {});
    if (!result.ok) {
      showToast(result.message || "Geçti durumunda fiş yok", "error");
      return;
    }
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(
      buildFisKontrolExcelRows({ rows: result.rows })
    );
    XLSX.utils.book_append_sheet(workbook, sheet, "Gecti");
    XLSX.writeFile(
      workbook,
      `Fis_Kontrol_Gecti_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    showToast(
      `${result.rows.length} geçen satır dışa aktarıldı (${result.batches.length} grup)`,
      "success"
    );
  };

  return (
    <main className="min-h-screen bg-gray-950 p-8 text-white">
      {toast ? (
        <div
          role="status"
          className={`fixed top-4 right-4 z-[9999] rounded-lg border px-4 py-3 text-sm font-medium shadow-xl ${
            toast.type === "success"
              ? "border-emerald-700 bg-emerald-950 text-emerald-200"
              : "border-red-700 bg-red-950 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-2 text-4xl font-bold">Fiş Kontrol Merkezi</h1>
          <p className="max-w-3xl text-gray-400">
            Banka, Elektraweb ve Luca fiş üretiminden gelen StandardLucaRows
            satırları üzerinde denge, hesap, açıklama, belge ve mükerrer kayıt
            kontrolleri yapılır. Ön izleme ekranlarındaki kaynak veri değiştirilmez;
            düzenlemeler yalnızca aktarım kuyruğuna yazılır.
          </p>
        </div>

        <ParserJobProgress
          visible={analysisLoading || parserJob.isRunning || parserJob.isError}
          stage={parserJob.stage}
          detail={parserJob.detail}
          percent={parserJob.percent}
          timeoutWarning={parserJob.timeoutWarning}
          status={parserJob.status}
          error={parserJob.error}
          onCancel={analysisLoading ? () => parserJob.cancel("user") : undefined}
          className="w-full max-w-md"
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={loadPendingData}
            className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-900"
          >
            Yenile
          </button>
          <button
            type="button"
            onClick={exportControlReport}
            disabled={!analysis.rows.length}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Kontrol Raporu Excel
          </button>
          <button
            type="button"
            onClick={exportPassedOnly}
            disabled={!filterPassedRowsForExport(analysis).length}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Yalnız Geçenleri Dışa Aktar
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-400">Aktif veri kaynağı</div>
            <div className="mt-1 text-lg font-semibold">
              {payload ? getSourceLabel(payload) : "Henüz aktarım kuyruğu boş"}
            </div>
            {payload?.createdAt ? (
              <div className="mt-1 text-sm text-gray-500">
                Son aktarım: {new Date(payload.createdAt).toLocaleString("tr-TR")}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href="/muhasebe/banka-ekstresi"
              className="rounded-lg border border-gray-700 px-3 py-2 hover:bg-gray-950"
            >
              Banka Parser
            </Link>
            <Link
              href="/muhasebe/elektraweb"
              className="rounded-lg border border-gray-700 px-3 py-2 hover:bg-gray-950"
            >
              Elektraweb
            </Link>
            <Link
              href="/muhasebe/luca-donusturucu"
              className="rounded-lg border border-gray-700 px-3 py-2 hover:bg-gray-950"
            >
              Luca Fiş Üretici
            </Link>
          </div>
        </div>
      </div>

      {!rows.length ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 p-10 text-center">
          <h2 className="text-2xl font-semibold">Kontrol edilecek satır bulunamadı</h2>
          <p className="mx-auto mt-3 max-w-2xl text-gray-400">
            {hydrateEmptyMessage ||
              "Banka Parser, Elektraweb veya Luca Fiş Üretici ekranında ön izleme oluşturduktan sonra “Fiş Kontrol’e Git” ile aktarın. İkinci dosya seçimi veya yeniden analiz gerekmez."}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Toplam Satır"
              value={analysis.summary.totalRows}
              tone="neutral"
            />
            <SummaryCard
              title="Geçti / Uyarı / Hata"
              value={`${analysis.summary.gectiRowCount || 0} / ${analysis.summary.uyariRowCount || 0} / ${analysis.summary.hataRowCount || 0}`}
              tone={analysis.summary.hataRowCount > 0 ? "error" : "success"}
            />
            <SummaryCard
              title="Uyarı / Bilgi kayıt"
              value={`${analysis.summary.uyariIssueCount} / ${analysis.summary.bilgiIssueCount}`}
              tone={
                analysis.summary.uyariIssueCount > 0 ? "warning" : "success"
              }
            />
            <SummaryCard
              title="Denge Durumu"
              value={analysis.summary.balanceStatus}
              tone={analysis.summary.isBalanced ? "success" : "error"}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <IssuePanel
              title="Hata"
              issues={groupedIssues.hata}
              emptyText="Hata bulunamadı."
            />
            <IssuePanel
              title="Uyarı"
              issues={groupedIssues.uyari}
              emptyText="Uyarı bulunamadı."
            />
            <IssuePanel
              title="Bilgi"
              issues={groupedIssues.bilgi}
              emptyText="Bilgi kaydı bulunamadı."
            />
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">Kontrol Satırları</h2>
                <p className="mt-1 text-sm text-gray-400">
                  {filteredRows.length} / {analysis.rows.length} satır gösteriliyor
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFilter(option.id)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium ${
                      filter === option.id
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="mb-4 block">
              <span className="mb-1 block text-sm text-gray-400">Satır ara</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Fiş no, hesap, açıklama, kontrol notu..."
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
              />
            </label>

            <AnnveroEditableDataTable
              columns={fisKontrolColumns}
              rows={filteredRows}
              rowKey="id"
              getRowKey={(row, index) => resolveStandardLucaEditRowId(row, index)}
              drafts={tableDrafts}
              editingRowId={editingRowId}
              onDraftChange={patchDraftField}
              onStartEdit={(rowId) => {
                const index = filteredRows.findIndex(
                  (item) => resolveStandardLucaEditRowId(item) === String(rowId)
                );
                const row =
                  index >= 0
                    ? filteredRows[index]
                    : filteredRows.find((item) => String(item.id) === String(rowId));
                if (row) openEdit(row, index >= 0 ? index : 0);
              }}
              onCancelEdit={cancelEdit}
              onCommitEdit={saveEdit}
              enableVirtualScroll={filteredRows.length > 120}
              pageSize={50}
              searchPlaceholder="Fiş, hesap, açıklama ara..."
              exportFilename="fis-kontrol.csv"
              showToolbar={false}
              renderRowActions={(row, { isEditing }) => (
                <button
                  type="button"
                  data-testid="fis-kontrol-row-edit"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (isEditing) {
                      cancelEdit();
                      return;
                    }
                    openEdit(row);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    isEditing
                      ? "border-indigo-500 bg-indigo-950 text-indigo-100"
                      : "border-indigo-700 text-indigo-200 hover:bg-indigo-950"
                  }`}
                >
                  Düzenle
                </button>
              )}
              renderExpandedRow={() =>
                editingRowId && draftRow ? (
                  <div data-testid="fis-kontrol-edit-panel">
                    <PreviewVoucherDetailPanel
                      variant="standardLuca"
                      draft={draftRow}
                      onChange={setDraftRow}
                      onSave={saveEdit}
                      onCancel={cancelEdit}
                      isSaving={editSaving}
                      showMemoryOption={true}
                      memoryLabel="Bu firma için öğren"
                    />
                  </div>
                ) : null
              }
            />
          </div>
        </>
      )}
    </main>
  );
}

function SummaryCard({ title, value, tone }) {
  const toneClasses = {
    neutral: "border-gray-700 bg-gray-950 text-white",
    success: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
    warning: "border-amber-800 bg-amber-950/40 text-amber-300",
    error: "border-red-800 bg-red-950/40 text-red-300",
  };

  return (
    <div
      className={`rounded-2xl border p-5 ${toneClasses[tone] || toneClasses.neutral}`}
    >
      <div className="text-sm text-gray-400">{title}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function IssuePanel({ title, issues, emptyText }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold">{title}</h2>
        <span className="rounded-lg bg-gray-800 px-3 py-1 text-sm text-gray-300">
          {issues.length}
        </span>
      </div>

      {issues.length === 0 ? (
        <p className="text-gray-400">{emptyText}</p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {issues.slice(0, 40).map((issue, index) => (
            <div
              key={`${issue.type}-${issue.rowIndex}-${index}`}
              className="rounded-xl border border-gray-800 bg-gray-950 p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-gray-800 px-2 py-1 text-xs font-semibold">
                  Satır {issue.rowIndex}
                </span>
                <span
                  className={`rounded-lg px-2 py-1 text-xs font-semibold ${seviyeBadgeClass(issue.seviye)}`}
                >
                  {issue.type}
                </span>
              </div>

              <p className="text-sm text-gray-300">{issue.message}</p>

              <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-gray-400 sm:grid-cols-2">
                <div>Fiş: {issue.fisNo}</div>
                <div>Hesap: {issue.hesapKodu}</div>
                <div>Tutar: {issue.tutar}</div>
                <div>Tarih: {issue.fisTarihi}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
