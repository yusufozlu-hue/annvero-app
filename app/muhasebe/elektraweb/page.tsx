"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import AnnveroLogo from "@/app/components/AnnveroLogo";
import CompanySelectOptions from "../components/CompanySelectOptions";
import PreviewEyeButton from "../components/PreviewEyeButton";
import PreviewVoucherDetailPanel from "../components/PreviewVoucherDetailPanel";
import { useCompanyList } from "../hooks/useCompanyList";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  normalizeCompanyRecord,
  saveLucaTransferDataset,
  loadAccountPlansFromStorage,
  getCompanyAccountPlansWithDiagnostics,
  logElektrawebAccountPlanDiagnostics,
  normalizeAccountPlanForMatching,
} from "@/src/utils/companyCenter";
import {
  buildElektrawebCompanyMappings,
  buildElektrawebCombinedSearchText,
} from "@/src/utils/elektrawebAccountMatcher";
import { fetchLearningMemoryForCompany } from "@/src/utils/learningMemory";
import { loadAccountingRulesFromStorage } from "@/src/utils/accountingRuleEngine";
import {
  buildElektrawebPreviewRows,
  buildStandardLucaTransferPayload,
  getStandardLucaMissingBadges,
  logElektrawebPreviewDiagnostics,
  logStandardLucaReport,
  standardLucaRowsToExcelRows,
  stripStandardLucaRow,
} from "@/src/utils/standardLucaRow";
import { createLearningMemoryRecord } from "@/src/utils/learningMemory";
import {
  applyElektrawebEditDraft,
  buildElektrawebEditDraft,
  buildLearningMemoryPayload,
} from "@/src/utils/previewRowEdit";

type Filtre = "tumu" | "riskli" | "dengesiz" | "aciklama" | "belgeTuru";

const PAGE_SIZE = 25;

export default function ElektrawebPage() {
  const router = useRouter();

  const { companies, selectedCompanyId, setSelectedCompanyId, selectedCompany: selectedCompanyRaw } =
    useCompanyList();

  const selectedCompany = useMemo(
    () => (selectedCompanyRaw ? normalizeCompanyRecord(selectedCompanyRaw) : null),
    [selectedCompanyRaw]
  );

  const [file, setFile] = useState<File | null>(null);
  const [donem, setDonem] = useState("tum");
  const [yukleniyor, setYukleniyor] = useState(false);

  const [satirSayisi, setSatirSayisi] = useState(0);
  const [fisSayisi, setFisSayisi] = useState(0);
  const [dengeliFis, setDengeliFis] = useState(0);
  const [dengesizFis, setDengesizFis] = useState(0);
  const [aciklamaEksikSatir, setAciklamaEksikSatir] = useState(0);
  const [belgeTuruEksikSatir, setBelgeTuruEksikSatir] = useState(0);
  const [standardLucaRows, setStandardLucaRows] = useState<any[]>([]);
  const [accountPlans, setAccountPlans] = useState<Record<string, unknown>>({});
  const [learningMemory, setLearningMemory] = useState<any[]>([]);
  const [kuralMotoruRules, setKuralMotoruRules] = useState<any[]>([]);

  const { plans: companyPlans, diagnostics: accountPlanDiagnostics } = useMemo(
    () =>
      getCompanyAccountPlansWithDiagnostics(
        accountPlans,
        selectedCompany || selectedCompanyId
      ),
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
      companyId: selectedCompanyId,
      kuralMotoruRules,
      companyMappings: buildElektrawebCompanyMappings({
        ...(selectedCompany || {}),
        companyId: selectedCompanyId,
        kuralMotoruRules,
      }),
      documentSeriesRules: selectedCompany?.documentSeriesRules || [],
      accountingRules: selectedCompany?.accountingRules || {},
      employees: selectedCompany?.employees || [],
    }),
    [normalizedAccountPlan, learningMemory, kuralMotoruRules, selectedCompany, selectedCompanyId]
  );

  const rematchRows = (rows: any[], memory = learningMemory) =>
    buildElektrawebPreviewRows(rows, {
      firmaId: selectedCompanyId,
      kaynakAdi: "ELEKTRAWEB",
      ...matchingContext,
      learningMemory: memory,
    });

  useEffect(() => {
    const refreshPlans = () => {
      setAccountPlans(loadAccountPlansFromStorage());
      setKuralMotoruRules(loadAccountingRulesFromStorage());
    };
    refreshPlans();
    window.addEventListener("focus", refreshPlans);
    return () => window.removeEventListener("focus", refreshPlans);
  }, []);

  useEffect(() => {
    if (!selectedCompanyId) {
      setLearningMemory([]);
      return;
    }

    fetchLearningMemoryForCompany(selectedCompanyId).then(setLearningMemory);
  }, [selectedCompanyId]);

  const [filtre, setFiltre] = useState<Filtre>("tumu");
  const [arama, setArama] = useState("");
  const [page, setPage] = useState(1);
  const [exportAcik, setExportAcik] = useState(false);
  const [expandedPreviewRowId, setExpandedPreviewRowId] = useState<string | null>(
    null
  );
  const [previewEditDraft, setPreviewEditDraft] = useState<any>(null);
  const [isSavingPreviewEdit, setIsSavingPreviewEdit] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: string } | null>(
    null
  );

  useEffect(() => {
    setPage(1);
  }, [filtre, arama, standardLucaRows]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string, type: string) =>
    setToast({ message, type });

  const togglePreviewRowDetail = (row: any) => {
    if (expandedPreviewRowId === row.id) {
      setExpandedPreviewRowId(null);
      setPreviewEditDraft(null);
      return;
    }

    setExpandedPreviewRowId(row.id);
    setPreviewEditDraft(buildElektrawebEditDraft(row));
  };

  const cancelPreviewRowEdit = () => {
    setExpandedPreviewRowId(null);
    setPreviewEditDraft(null);
  };

  const savePreviewRowEdit = async () => {
    if (!expandedPreviewRowId || !previewEditDraft) return;

    const currentRow = standardLucaRows.find((row) => row.id === expandedPreviewRowId);
    if (!currentRow) return;

    setIsSavingPreviewEdit(true);

    try {
      const updatedRow = applyElektrawebEditDraft(currentRow, previewEditDraft);
      let nextMemory = learningMemory;

      if (previewEditDraft.saveToMemory && selectedCompanyId) {
        const memoryRecord = buildLearningMemoryPayload({
          companyId: selectedCompanyId,
          sourceModule: "elektraweb",
          description: buildElektrawebCombinedSearchText(updatedRow),
          documentSeriesRules: selectedCompany?.documentSeriesRules || [],
          accountCode: previewEditDraft.accountCode,
          documentType: previewEditDraft.documentType,
          standardDescription: previewEditDraft.description,
        });

        const created = await createLearningMemoryRecord(memoryRecord);
        if (created) {
          nextMemory = await fetchLearningMemoryForCompany(selectedCompanyId);
          setLearningMemory(nextMemory);
        }

        showToast(
          created
            ? "Satır güncellendi ve hafızaya kaydedildi; eşleşmeler yenilendi"
            : "Satır güncellendi, hafıza kaydı oluşturulamadı",
          created ? "success" : "error"
        );
      } else {
        showToast("Satır güncellendi", "success");
      }

      setStandardLucaRows((prev) => {
        const withEdit = prev.map((row) =>
          row.id === expandedPreviewRowId ? updatedRow : row
        );
        return rematchRows(withEdit, nextMemory);
      });

      cancelPreviewRowEdit();
    } finally {
      setIsSavingPreviewEdit(false);
    }
  };

  const onIzlemeOlustur = async () => {
    if (!file) {
      alert("Önce ElektraWeb fiş dosyasını seçmelisin.");
      return;
    }

    logElektrawebAccountPlanDiagnostics({
      selectedCompany,
      accountPlan: normalizedAccountPlan,
      storageKeys: accountPlanDiagnostics.storageKeys,
      matchedStorageKey: accountPlanDiagnostics.matchedStorageKey,
    });

    if (normalizedAccountPlan.length === 0) {
      alert(
        "Hesap planı yüklü değil veya seçili firma ile eşleşmiyor. Konsoldaki [elektraweb-debug] kayıtlarına bakın."
      );
      return;
    }

    setYukleniyor(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
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
        alert(data.error || "Dosya işlenirken hata oluştu.");
        return;
      }

      const previewRows = data.standardLucaRows || data.fisler || [];

      console.log("PREVIEW INPUT", previewRows.slice(0, 10));
      logElektrawebPreviewDiagnostics(previewRows, { afterMatching: true });

      const unmatchedWithPlan = previewRows.some(
        (row: any) => !String(row.hesapKodu || "").trim()
      );

      if (unmatchedWithPlan) {
        showToast(
          "Bazı satırlarda hesap planında bu açıklamaya uygun hesap bulunamadı",
          "error"
        );
      }

      logStandardLucaReport("elektraweb-preview", previewRows);

      setSatirSayisi(data.toplamSatir ?? previewRows.length);
      setFisSayisi(data.toplamFis ?? 0);
      setDengeliFis(data.dengeliFis ?? 0);
      setDengesizFis(data.dengesizFis ?? 0);
      setAciklamaEksikSatir(data.aciklamaEksikSatir ?? 0);
      setBelgeTuruEksikSatir(data.belgeTuruEksikSatir ?? 0);
      setStandardLucaRows(previewRows);
      setFiltre("tumu");
    } finally {
      setYukleniyor(false);
    }
  };

  const handleLucaAktar = () => {
    if (standardLucaRows.length === 0) {
      alert("Önce ön izleme oluşturmalısın.");
      return;
    }

    if (!selectedCompanyId) {
      alert("Luca aktarımı için önce firma seçmelisin.");
      return;
    }

    const runId = `elektraweb-${String(selectedCompanyId).slice(0, 8)}-${Date.now()}`;
    const payload = buildStandardLucaTransferPayload({
      firmaId: selectedCompanyId,
      companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
      kaynakTipi: "ELEKTRAWEB",
      kaynakAdi: "ELEKTRAWEB",
      source: "elektraweb",
      runId,
      rows: standardLucaRows,
    });

    const saved = saveLucaTransferDataset(payload);
    if (!saved.ok) {
      alert("Elektraweb aktarımı kaydedilemedi. Depolama dolu olabilir.");
      return;
    }

    logStandardLucaReport("elektraweb-transfer", standardLucaRows.map(stripStandardLucaRow));

    router.push(
      `/muhasebe/luca-donusturucu?source=elektraweb&companyId=${encodeURIComponent(
        selectedCompanyId
      )}&runId=${encodeURIComponent(runId)}`
    );
  };

  const yuksekRiskli = useMemo(
    () => standardLucaRows.filter((f) => f.riskSeviyesi === "Yüksek").length,
    [standardLucaRows]
  );

  const ortalamaRisk = useMemo(() => {
    if (standardLucaRows.length === 0) return 0;
    const toplam = standardLucaRows.reduce((acc, f) => acc + (f.riskPuani || 0), 0);
    return Math.round(toplam / standardLucaRows.length);
  }, [standardLucaRows]);

  const yuzde = (deger: number, toplam: number) =>
    toplam > 0 ? Math.round((deger / toplam) * 100) : 0;

  const filtrelenmis = useMemo(() => {
    const aramaText = arama.trim().toLocaleLowerCase("tr");

    return standardLucaRows.filter((f) => {
      if (filtre === "riskli" && f.durum !== "Riskli") return false;
      if (filtre === "dengesiz" && !f.riskler?.includes("Fiş dengesi bozuk"))
        return false;
      if (filtre === "aciklama" && !f.riskler?.includes("Açıklama boş"))
        return false;
      if (filtre === "belgeTuru" && !f.riskler?.includes("Belge türü boş"))
        return false;

      if (aramaText) {
        const hay = `${f.fisNo} ${f.fisTarihi || f.tarih} ${f.fisAciklama} ${f.detayAciklama || f.aciklama} ${f.belgeTuru} ${f.hesapKodu}`.toLocaleLowerCase(
          "tr"
        );
        if (!hay.includes(aramaText)) return false;
      }

      return true;
    });
  }, [standardLucaRows, filtre, arama]);

  const totalPages = Math.max(1, Math.ceil(filtrelenmis.length / PAGE_SIZE));
  const sayfaSatirlari = filtrelenmis.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const exportToExcel = (rows: any[]) => {
    if (rows.length === 0) {
      alert("Dışa aktarılacak satır yok.");
      return;
    }

    console.log("LUCA EXPORT INPUT", rows.slice(0, 10));

    const data = standardLucaRowsToExcelRows(rows.map(stripStandardLucaRow));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Luca Fiş");
    XLSX.writeFile(wb, "elektraweb_luca_fis_onizleme.xlsx");
    setExportAcik(false);
  };

  const filtreler: { key: Filtre; label: string }[] = [
    { key: "tumu", label: "Tüm Satırlar" },
    { key: "riskli", label: "Riskliler" },
    { key: "dengesiz", label: "Dengesiz" },
    { key: "aciklama", label: "Açıklama Eksik" },
    { key: "belgeTuru", label: "Belge Türü Eksik" },
  ];

  const statCards = [
    {
      label: "Toplam Fiş",
      value: fisSayisi,
      sub: `${satirSayisi} satır`,
      glow: "from-blue-500/20",
      icon: <FileIcon />,
      iconColor: "text-blue-300",
    },
    {
      label: "Dengeli Fiş",
      value: dengeliFis,
      sub: `%${yuzde(dengeliFis, dengeliFis + dengesizFis)}`,
      glow: "from-emerald-500/20",
      icon: <CheckIcon />,
      iconColor: "text-emerald-300",
    },
    {
      label: "Dengesiz Fiş",
      value: dengesizFis,
      sub: `%${yuzde(dengesizFis, dengeliFis + dengesizFis)}`,
      glow: "from-red-500/20",
      icon: <ScaleIcon />,
      iconColor: "text-red-300",
    },
    {
      label: "Belge Türü Eksik",
      value: belgeTuruEksikSatir,
      sub: `%${yuzde(belgeTuruEksikSatir, satirSayisi)}`,
      glow: "from-amber-500/20",
      icon: <TagIcon />,
      iconColor: "text-amber-300",
    },
    {
      label: "Yüksek Riskli",
      value: yuksekRiskli,
      sub: `%${yuzde(yuksekRiskli, satirSayisi)}`,
      glow: "from-rose-500/20",
      icon: <AlertIcon />,
      iconColor: "text-rose-300",
    },
    {
      label: "Ortalama Risk",
      value: ortalamaRisk,
      sub: "ort. puan",
      glow: "from-violet-500/20",
      icon: <GaugeIcon />,
      iconColor: "text-violet-300",
    },
  ];

  return (
    <main className="relative min-h-screen bg-slate-950 text-white">
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
      {/* Arka plan neon glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute -right-32 top-10 h-96 w-96 rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto w-full max-w-[1800px] p-6 sm:p-8">
        {/* Premium navbar */}
        <nav className="mb-8 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center px-2">
            <AnnveroLogo onLight={false} size={42} priority />
          </div>

          <div className="flex-1 lg:flex lg:justify-center">
          </div>

          <div className="flex items-center gap-3 px-2">
            <div className="text-right">
              <p className="text-sm font-semibold leading-tight">
                {selectedCompany
                  ? getCompanyDisplayName(selectedCompany)
                  : "Muhasebe"}
              </p>
              <p className="text-xs text-slate-400">ANNVERO Panel</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold">
              AN
            </span>
          </div>
        </nav>

        {/* Sayfa header */}
        <header className="mb-8 flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/30 to-rose-600/10 text-rose-200 ring-1 ring-rose-400/30">
            <RefreshIcon />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Elektraweb Fiş Dönüştürücü
            </h1>
            <p className="mt-2 text-base text-slate-400">
              Elektraweb fiş listesini Luca aktarım formatına dönüştürün.
            </p>
          </div>
        </header>

        {/* Üst işlem kartı */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/30 backdrop-blur-xl sm:p-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-400">
                Firma Seçimi
              </label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none transition focus:border-blue-500"
              >
                <CompanySelectOptions companies={companies} />
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-400">
                Dönem
              </label>
              <select
                value={donem}
                onChange={(e) => setDonem(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none transition focus:border-blue-500"
              >
                <option value="tum">Tüm Dönemler</option>
                <option value="2025">2025</option>
                <option value="2024">2024</option>
                <option value="2023">2023</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-400">
                ElektraWeb Excel Dosyası
              </label>
              <div className="flex items-center gap-3">
                <label className="cursor-pointer rounded-xl border border-slate-700 bg-slate-950 px-5 py-3 font-semibold text-slate-200 transition hover:border-blue-500 hover:text-white">
                  Dosya Seç
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
                <span className="truncate text-sm text-slate-400">
                  {file ? file.name : "Dosya seçilmedi"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-4">
            <button
              onClick={onIzlemeOlustur}
              disabled={yukleniyor}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:from-blue-500 hover:to-violet-500 disabled:opacity-60"
            >
              {yukleniyor ? "İşleniyor..." : "Ön İzleme Oluştur"}
            </button>

            <button
              onClick={handleLucaAktar}
              className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:from-emerald-500 hover:to-teal-500"
            >
              Luca Fiş Üretici’ye Aktar
            </button>
          </div>
        </section>

        {/* İstatistik kartları */}
        {standardLucaRows.length > 0 && (
          <section className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {statCards.map((card) => (
              <div
                key={card.label}
                className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur-xl"
              >
                <div
                  className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${card.glow} to-transparent blur-2xl`}
                />
                <div className={`relative ${card.iconColor}`}>{card.icon}</div>
                <p className="relative mt-3 text-sm text-slate-400">
                  {card.label}
                </p>
                <p className="relative mt-1 text-3xl font-bold">{card.value}</p>
                <p className="relative mt-1 text-xs text-slate-500">{card.sub}</p>
              </div>
            ))}
          </section>
        )}

        {/* Kontrol raporu */}
        {standardLucaRows.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/30 backdrop-blur-xl">
            <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <h2 className="text-2xl font-bold">ANNVERO Kontrol Raporu</h2>

              <div className="flex flex-wrap items-center gap-2">
                {/* Arama kutusu */}
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                    <SearchIcon />
                  </span>
                  <input
                    value={arama}
                    onChange={(e) => setArama(e.target.value)}
                    placeholder="Ara: fiş, açıklama, belge türü"
                    className="w-56 rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white outline-none transition focus:border-blue-500"
                  />
                </div>

                {/* Filtre butonu (aramayı temizler) */}
                <button
                  onClick={() => {
                    setArama("");
                    setFiltre("tumu");
                  }}
                  className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:text-white"
                >
                  <FilterIcon />
                  Sıfırla
                </button>

                {/* Excel export dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setExportAcik((v) => !v)}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-500 hover:to-teal-500"
                  >
                    <DownloadIcon />
                    Excel
                    <ChevronDownIcon />
                  </button>

                  {exportAcik && (
                    <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
                      <button
                        onClick={() => exportToExcel(standardLucaRows)}
                        className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                      >
                        Tümünü Dışa Aktar
                      </button>
                      <button
                        onClick={() => exportToExcel(filtrelenmis)}
                        className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                      >
                        Görünenleri Dışa Aktar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Filtre barı */}
            <div className="mb-5 flex flex-wrap gap-2">
              {filtreler.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFiltre(f.key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    filtre === f.key
                      ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/30"
                      : "border border-slate-700 bg-slate-950 text-slate-300 hover:text-white"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-slate-800">
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-12" />
                  <col className="w-[76px]" />
                  <col className="w-[88px]" />
                  <col className="w-[72px]" />
                  <col />
                  <col className="w-[260px]" />
                  <col className="w-[72px]" />
                  <col className="w-[72px]" />
                  <col className="w-[120px]" />
                  <col className="w-12" />
                  <col className="w-[72px]" />
                  <col />
                  <col className="w-[70px]" />
                </colgroup>
                <thead className="bg-slate-950">
                  <tr className="text-xs text-slate-400">
                    <th className="px-2 py-2.5 font-semibold">Fiş No</th>
                    <th className="px-2 py-2.5 font-semibold">Tarih</th>
                    <th className="px-2 py-2.5 font-semibold">Hesap Kodu</th>
                    <th className="px-2 py-2.5 font-semibold">Belge Türü</th>
                    <th className="px-2 py-2.5 font-semibold">Fiş Açıklama</th>
                    <th className="max-w-[260px] px-2 py-2.5 font-semibold">
                      Detay Açıklama
                    </th>
                    <th className="px-2 py-2.5 text-right font-semibold">Borç</th>
                    <th className="px-2 py-2.5 text-right font-semibold">Alacak</th>
                    <th className="px-2 py-2.5 font-semibold">Eksikler</th>
                    <th className="px-2 py-2.5 text-right font-semibold">Risk</th>
                    <th className="px-2 py-2.5 font-semibold">Seviye</th>
                    <th className="px-2 py-2.5 font-semibold">Kontrol Notu</th>
                    <th className="w-[70px] px-1 py-2.5 text-center font-semibold">
                      İşlem
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {sayfaSatirlari.map((fis) => (
                    <Fragment key={fis.id}>
                      <tr className="border-t border-slate-800 transition-colors hover:bg-slate-800/50">
                        <td className="px-2 py-2 text-xs font-medium tabular-nums">
                          {fis.fisNo}
                        </td>
                        <td className="px-2 py-2 text-xs text-slate-300">
                          {fis.fisTarihi || fis.tarih}
                        </td>
                        <td
                          className={`px-2 py-2 font-mono text-[11px] ${
                            fis.hesapKodu
                              ? "text-slate-200"
                              : "font-semibold text-red-400"
                          }`}
                        >
                          {fis.hesapKodu || "—"}
                        </td>
                        <td className="px-2 py-2">
                          <span className="inline-block rounded-md border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-200">
                            {fis.belgeTuru || "-"}
                          </span>
                        </td>
                        <ClampedCell
                          text={fis.fisAciklama}
                          className="px-2 py-2"
                        />
                        <ClampedCell
                          text={fis.detayAciklama || fis.aciklama}
                          className="max-w-[260px] px-2 py-2"
                        />
                        <td className="px-2 py-2 text-right text-xs tabular-nums">
                          {fis.borc}
                        </td>
                        <td className="px-2 py-2 text-right text-xs tabular-nums">
                          {fis.alacak}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            {fis.hesapKodu && fis.eslesmeYontemi ? (
                              <span className="rounded-full border border-emerald-700/60 bg-emerald-950/50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                                {fis.eslesmeYontemi}
                              </span>
                            ) : null}
                            {fis.riskDurumu ? (
                              <MissingFieldBadge label={fis.riskDurumu} />
                            ) : null}
                            {(fis.hesapEslesmeNotlari || []).map((note: string) => (
                              <MissingFieldBadge key={note} label={note} />
                            ))}
                            {getStandardLucaMissingBadges(fis)
                              .filter(
                                (badge) =>
                                  badge !== "Hesap eksik" && badge !== "HESAP_EKSIK"
                              )
                              .map((badge) => (
                                <MissingFieldBadge key={badge} label={badge} />
                              ))}
                            {!fis.riskDurumu &&
                            !(fis.hesapEslesmeNotlari || []).length &&
                            getStandardLucaMissingBadges(fis).length === 0 ? (
                              <span className="text-[10px] text-emerald-400">Tam</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right text-xs tabular-nums">
                          {fis.riskPuani}
                        </td>
                        <td className="px-2 py-2">
                          <RiskBadge seviye={fis.riskSeviyesi} compact />
                        </td>
                        <ClampedCell
                          text={fis.kontrolNotu || fis.risk}
                          className="px-2 py-2"
                          spanClassName={
                            fis.durum === "Riskli"
                              ? "text-yellow-300"
                              : "text-emerald-300"
                          }
                        />
                        <td className="w-[70px] px-1 py-2 text-center">
                          <PreviewEyeButton
                            active={expandedPreviewRowId === fis.id}
                            onClick={() => togglePreviewRowDetail(fis)}
                          />
                        </td>
                      </tr>

                      {expandedPreviewRowId === fis.id && previewEditDraft ? (
                        <tr className="border-t border-slate-800">
                          <td colSpan={13} className="p-4">
                            <PreviewVoucherDetailPanel
                              draft={previewEditDraft}
                              onChange={setPreviewEditDraft}
                              onSave={savePreviewRowEdit}
                              onCancel={cancelPreviewRowEdit}
                              isSaving={isSavingPreviewEdit}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}

                  {sayfaSatirlari.length === 0 && (
                    <tr>
                      <td
                        colSpan={13}
                        className="p-8 text-center text-slate-500"
                      >
                        Sonuç bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-sm text-slate-500">
                {filtrelenmis.length} kayıt · Sayfa {page}/{totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:text-white disabled:opacity-40"
                >
                  Önceki
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:text-white disabled:opacity-40"
                >
                  Sonraki
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Bilgilendirme alanı */}
        <section className="mt-6 flex items-center gap-3 rounded-2xl border border-blue-900/50 bg-blue-950/30 p-5 text-blue-200 backdrop-blur-xl">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-300">
            <InfoIcon />
          </span>
          <p className="text-sm font-medium">
            Luca’ya aktarılmadan önce fişleri kontrol edin.
          </p>
        </section>
      </div>
    </main>
  );
}

function MissingFieldBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-red-700/60 bg-red-950/50 px-2 py-0.5 text-[10px] font-semibold text-red-300">
      {label}
    </span>
  );
}

function ClampedCell({
  text,
  className = "",
  spanClassName = "text-slate-300",
}: {
  text?: string | null;
  className?: string;
  spanClassName?: string;
}) {
  const display = String(text || "").trim() || "-";

  return (
    <td className={className} title={display !== "-" ? display : undefined}>
      <span className={`line-clamp-2 break-words ${spanClassName}`}>{display}</span>
    </td>
  );
}

function RiskBadge({
  seviye,
  compact = false,
}: {
  seviye: string;
  compact?: boolean;
}) {
  const styles: Record<string, string> = {
    Yüksek: "border-red-700/60 bg-red-950/50 text-red-300",
    Orta: "border-yellow-700/60 bg-yellow-950/50 text-yellow-300",
    Düşük: "border-emerald-700/60 bg-emerald-950/50 text-emerald-300",
  };

  const cls = styles[seviye] || styles.Düşük;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${cls} ${
        compact ? "px-1.5 py-0.5 text-[10px] leading-tight" : "gap-1.5 px-3 py-1 text-xs"
      }`}
    >
      <span className={`rounded-full bg-current ${compact ? "h-1 w-1" : "h-1.5 w-1.5"}`} />
      {seviye}
    </span>
  );
}

function Svg({ children, size = 24 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function RefreshIcon() {
  return (
    <Svg size={28}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </Svg>
  );
}

function FileIcon() {
  return (
    <Svg>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </Svg>
  );
}

function ScaleIcon() {
  return (
    <Svg>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </Svg>
  );
}

function TagIcon() {
  return (
    <Svg>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </Svg>
  );
}

function AlertIcon() {
  return (
    <Svg>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

function GaugeIcon() {
  return (
    <Svg>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </Svg>
  );
}

function SearchIcon() {
  return (
    <Svg size={16}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

function FilterIcon() {
  return (
    <Svg size={16}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </Svg>
  );
}

function DownloadIcon() {
  return (
    <Svg size={16}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </Svg>
  );
}

function ChevronDownIcon() {
  return (
    <Svg size={16}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

function EyeIcon() {
  return (
    <Svg size={16}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

function InfoIcon() {
  return (
    <Svg size={18}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Svg>
  );
}
