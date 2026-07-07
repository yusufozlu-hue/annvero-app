"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  DEFAULT_ACCOUNT_GROUPS,
  DEFAULT_KUR_FARKI_GELIR,
  DEFAULT_KUR_FARKI_GIDER,
  SUPPORTED_CURRENCIES,
} from "@/src/config/kurDegerlemeDefaults";
import {
  getAccountPlanForCompany,
  loadAccountPlansFromStorage,
  normalizeCompanyRecord,
} from "@/src/utils/companyCenter";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  buildKurDegerlemeLucaRows,
  calculateKurDegerlemeRows,
  fetchTcmbKur,
  lookupManualTcmbRate,
  parseDovizliMuavinSheet,
  parseTcmbKurListSheet,
  recalculateKurDegerlemeSummary,
  runKurDegerlemePipeline,
} from "@/src/utils/kurDegerlemeEngine";
import {
  exportKurDegerlemeFullPack,
  exportKurDegerlemeLucaExcel,
  exportKurDegerlemeReportWorkbook,
  validateKurDegerlemeLucaExport,
} from "@/src/utils/kurDegerlemeExport";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const FLOW_STEPS = [
  "Firma ve parametreler",
  "Dosya yükle",
  "Kur belirle",
  "Değerleme hesapla",
  "Önizleme ve export",
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function readExcelSheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

function tipClass(tip) {
  if (tip === "gelir") return "text-emerald-300";
  if (tip === "gider") return "text-red-300";
  return "text-gray-400";
}

export default function KurDegerlemePage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany: selectedCompanyRaw,
  } = useCompanyList();

  const selectedCompany = useMemo(
    () => (selectedCompanyRaw ? normalizeCompanyRecord(selectedCompanyRaw) : null),
    [selectedCompanyRaw]
  );

  const [accountPlans, setAccountPlans] = useState({});
  const [degerlemeTarihi, setDegerlemeTarihi] = useState("");
  const [paraBirimi, setParaBirimi] = useState("USD");
  const [selectedGroups, setSelectedGroups] = useState(
    DEFAULT_ACCOUNT_GROUPS.map((group) => group.id)
  );
  const [kurFarkiGelirHesap, setKurFarkiGelirHesap] = useState(DEFAULT_KUR_FARKI_GELIR);
  const [kurFarkiGiderHesap, setKurFarkiGiderHesap] = useState(DEFAULT_KUR_FARKI_GIDER);
  const [belgeTuru, setBelgeTuru] = useState("DK");

  const [muavinFileName, setMuavinFileName] = useState("");
  const [hesapPlaniFileName, setHesapPlaniFileName] = useState("");
  const [tcmbFileName, setTcmbFileName] = useState("");
  const [muavinRows, setMuavinRows] = useState([]);
  const [uploadedAccountPlan, setUploadedAccountPlan] = useState([]);
  const [tcmbList, setTcmbList] = useState([]);

  const [manualKur, setManualKur] = useState("");
  const [tcmbKur, setTcmbKur] = useState("");
  const [tcmbKurTarihi, setTcmbKurTarihi] = useState("");
  const [kurWarning, setKurWarning] = useState("");
  const [isFetchingKur, setIsFetchingKur] = useState(false);

  const [valuationRows, setValuationRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [hasCalculated, setHasCalculated] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setAccountPlans(loadAccountPlansFromStorage());
  }, []);

  const companyAccountPlan = useMemo(() => {
    const stored = getAccountPlanForCompany(accountPlans, selectedCompany || selectedCompanyId);
    return uploadedAccountPlan.length ? uploadedAccountPlan : stored;
  }, [accountPlans, selectedCompany, selectedCompanyId, uploadedAccountPlan]);

  const effectiveKur = useMemo(() => {
    const manual = Number(String(manualKur).replace(",", "."));
    if (manualKur !== "" && !Number.isNaN(manual) && manual > 0) return manual;
    const auto = Number(String(tcmbKur).replace(",", "."));
    return !Number.isNaN(auto) && auto > 0 ? auto : 0;
  }, [manualKur, tcmbKur]);

  const currentStep = useMemo(() => {
    if (hasCalculated && valuationRows.length) return 5;
    if (effectiveKur > 0 && muavinRows.length) return 4;
    if (muavinRows.length) return 3;
    if (selectedCompanyId && degerlemeTarihi) return 2;
    if (selectedCompanyId) return 1;
    return 0;
  }, [
    hasCalculated,
    valuationRows.length,
    effectiveKur,
    muavinRows.length,
    selectedCompanyId,
    degerlemeTarihi,
  ]);

  const showToast = (message, type = "info") => setToast({ message, type });

  const toggleGroup = (groupId) => {
    setSelectedGroups((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId]
    );
  };

  const handleMuavinUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const sheet = await readExcelSheet(file);
    const parsed = parseDovizliMuavinSheet(sheet);
    setMuavinRows(parsed);
    setMuavinFileName(file.name);
    setHasCalculated(false);
    setValuationRows([]);
    setSummary(null);
    showToast(`${parsed.length} muavin satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleHesapPlaniUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const sheet = await readExcelSheet(file);
    const parsed = sheet
      .slice(1)
      .map((row) => ({
        accountCode: String(row[0] || "").trim(),
        accountName: String(row[1] || "").trim(),
        currency: String(row[2] || "TL").trim() || "TL",
      }))
      .filter((row) => row.accountCode && row.accountName);

    setUploadedAccountPlan(parsed);
    setHesapPlaniFileName(file.name);
    showToast(`${parsed.length} hesap planı satırı yüklendi.`, "success");
    event.target.value = "";
  };

  const handleTcmbListUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const sheet = await readExcelSheet(file);
    const parsed = parseTcmbKurListSheet(sheet);
    setTcmbList(parsed);
    setTcmbFileName(file.name);
    showToast(`${parsed.length} TCMB kur satırı yüklendi.`, "success");
    event.target.value = "";
  };

  const resolveKur = async () => {
    if (!degerlemeTarihi) {
      setKurWarning("Değerleme tarihi seçin.");
      return;
    }

    setIsFetchingKur(true);
    setKurWarning("");

    const manualListRate = lookupManualTcmbRate(tcmbList, degerlemeTarihi, paraBirimi);

    if (manualListRate) {
      setTcmbKur(String(manualListRate));
      setTcmbKurTarihi(degerlemeTarihi);
      setIsFetchingKur(false);
      return;
    }

    const result = await fetchTcmbKur(degerlemeTarihi, paraBirimi);

    if (!result.ok) {
      setKurWarning(
        result.error ||
          "Kur bulunamadı. TCMB kur listesi yükleyin veya kuru manuel girin."
      );
      setTcmbKur("");
      setTcmbKurTarihi("");
    } else {
      setTcmbKur(String(result.kur));
      setTcmbKurTarihi(result.tcmbTarih || "");
    }

    setIsFetchingKur(false);
  };

  const handleCalculate = () => {
    if (!selectedCompanyId) {
      alert("Önce firma seçin.");
      return;
    }

    if (!degerlemeTarihi) {
      alert("Değerleme tarihi girin.");
      return;
    }

    if (!muavinRows.length) {
      alert("Dövizli muavin Excel dosyası yükleyin.");
      return;
    }

    if (!selectedGroups.length) {
      alert("En az bir hesap grubu seçin.");
      return;
    }

    if (!effectiveKur) {
      alert("Kur bulunamadı. TCMB kurunu getirin veya manuel girin.");
      return;
    }

    const selectedGroupDefs = DEFAULT_ACCOUNT_GROUPS.filter((group) =>
      selectedGroups.includes(group.id)
    );

    const result = runKurDegerlemePipeline({
      muavinRows,
      selectedGroups: selectedGroupDefs,
      currency: paraBirimi,
      degerlemeTarihi,
      kur: effectiveKur,
      accountPlan: companyAccountPlan,
      kurFarkiGelirHesap,
      kurFarkiGiderHesap,
      belgeTuru,
    });

    setValuationRows(result.valuationRows);
    setSummary(result.summary);
    setHasCalculated(true);

    if (!result.valuationRows.length) {
      showToast("Seçilen kriterlere uygun kur farkı oluşmadı.", "info");
    } else {
      showToast(`${result.valuationRows.length} hesap değerlendi.`, "success");
    }
  };

  const updateValuationRow = (rowId, patch) => {
    setValuationRows((current) => {
      const next = current.map((row) =>
        row.id === rowId ? { ...row, ...patch, manuallyEdited: true } : row
      );

      const recalculated = calculateKurDegerlemeRows(next, {
        degerlemeTarihi,
        paraBirimi,
        kur: effectiveKur,
        kurFarkiGelirHesap,
        kurFarkiGiderHesap,
        belgeTuru,
      });

      setSummary(recalculateKurDegerlemeSummary(recalculated));
      return recalculated;
    });
  };

  const exportMeta = useMemo(
    () => ({
      firmaAdi: getCompanyDisplayName(selectedCompany),
      degerlemeTarihi,
      paraBirimi,
      kur: effectiveKur,
      tcmbTarih: tcmbKurTarihi,
    }),
    [selectedCompany, degerlemeTarihi, paraBirimi, effectiveKur, tcmbKurTarihi]
  );

  const handleExportReport = () => {
    if (!valuationRows.length) {
      alert("Önce değerleme hesaplayın.");
      return;
    }

    exportKurDegerlemeReportWorkbook({
      valuationRows,
      summary: summary || recalculateKurDegerlemeSummary(valuationRows),
      meta: exportMeta,
      fileName: `kur-degerleme-${paraBirimi.toLowerCase()}`,
    });
    showToast("Değerleme raporu indirildi.", "success");
  };

  const handleExportLuca = () => {
    if (!valuationRows.length) {
      alert("Önce değerleme hesaplayın.");
      return;
    }

    const lucaRows = buildKurDegerlemeLucaRows(valuationRows, {
      firmaId: selectedCompanyId,
      paraBirimi,
      belgeTuru,
    });
    const validation = validateKurDegerlemeLucaExport(valuationRows, lucaRows);

    if (validation.hasBlockingErrors) {
      alert(validation.errors.join("\n"));
      return;
    }

    const result = exportKurDegerlemeLucaExcel(valuationRows, {
      firmaId: selectedCompanyId,
      paraBirimi,
      belgeTuru,
      filePrefix: `kur-degerleme-${paraBirimi.toLowerCase()}-luca`,
    });

    if (!result.ok) {
      alert(result.message || "Luca Excel oluşturulamadı.");
      return;
    }

    showToast(
      `${result.fileCount || 1} Luca dosyası indirildi (${result.rowCount || 0} satır).`,
      "success"
    );
  };

  const handleExportAll = () => {
    if (!valuationRows.length) {
      alert("Önce değerleme hesaplayın.");
      return;
    }

    const lucaRows = buildKurDegerlemeLucaRows(valuationRows, {
      firmaId: selectedCompanyId,
      paraBirimi,
      belgeTuru,
    });
    const validation = validateKurDegerlemeLucaExport(valuationRows, lucaRows);

    if (validation.hasBlockingErrors) {
      alert(validation.errors.join("\n"));
      return;
    }

    const result = exportKurDegerlemeFullPack({
      valuationRows,
      summary: summary || recalculateKurDegerlemeSummary(valuationRows),
      meta: exportMeta,
      context: {
        firmaId: selectedCompanyId,
        paraBirimi,
        belgeTuru,
        reportFileName: `kur-degerleme-${paraBirimi.toLowerCase()}-rapor`,
        lucaFilePrefix: `kur-degerleme-${paraBirimi.toLowerCase()}-luca`,
      },
    });

    if (!result.ok) {
      alert(result.message || "Export tamamlanamadı.");
      return;
    }

    showToast("Özet, detay ve Luca dosyaları indirildi.", "success");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Kur Değerleme ve Kur Farkı Fiş Motoru
          </h1>
          <p className="mt-2 max-w-3xl text-gray-400">
            Dövizli banka, cari ve kasa hesaplarının dönem sonu kur değerlemesini yapın ve Luca
            fiş formatında kur farkı fişi üretin.
          </p>
        </div>

        {toast && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              toast.type === "success"
                ? "border-emerald-700 bg-emerald-950/50 text-emerald-200"
                : toast.type === "error"
                  ? "border-red-700 bg-red-950/50 text-red-200"
                  : "border-indigo-700 bg-indigo-950/50 text-indigo-200"
            }`}
          >
            {toast.message}
          </div>
        )}

        <div className="mb-8 flex flex-wrap gap-2">
          {FLOW_STEPS.map((step, index) => (
            <span
              key={step}
              className={`rounded-full px-3 py-1 text-xs ${
                index + 1 <= currentStep
                  ? "bg-indigo-600/30 text-indigo-200 ring-1 ring-indigo-500/40"
                  : "bg-gray-900 text-gray-500 ring-1 ring-gray-800"
              }`}
            >
              {index + 1}. {step}
            </span>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold">Parametreler</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-gray-400">Firma</label>
                <select
                  className={inputClassName}
                  value={selectedCompanyId}
                  onChange={(event) => setSelectedCompanyId(event.target.value)}
                >
                  <CompanySelectOptions companies={companies} placeholder="Firma seçin" />
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Değerleme Tarihi</label>
                  <input
                    type="date"
                    className={inputClassName}
                    value={degerlemeTarihi}
                    onChange={(event) => setDegerlemeTarihi(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Para Birimi</label>
                  <select
                    className={inputClassName}
                    value={paraBirimi}
                    onChange={(event) => setParaBirimi(event.target.value)}
                  >
                    {SUPPORTED_CURRENCIES.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-gray-400">
                  Değerleme Yapılacak Hesap Grupları
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {DEFAULT_ACCOUNT_GROUPS.map((group) => (
                    <label
                      key={group.id}
                      className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedGroups.includes(group.id)}
                        onChange={() => toggleGroup(group.id)}
                      />
                      {group.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Kur Farkı Gelir</label>
                  <input
                    className={inputClassName}
                    value={kurFarkiGelirHesap}
                    onChange={(event) => setKurFarkiGelirHesap(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Kur Farkı Gider</label>
                  <input
                    className={inputClassName}
                    value={kurFarkiGiderHesap}
                    onChange={(event) => setKurFarkiGiderHesap(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Belge Türü</label>
                  <input
                    className={inputClassName}
                    value={belgeTuru}
                    onChange={(event) => setBelgeTuru(event.target.value)}
                    placeholder="DK veya boş"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold">Dosya Yükleme</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-gray-400">
                  Dövizli Muavin Excel (zorunlu)
                </label>
                <input type="file" accept=".xlsx,.xls" onChange={handleMuavinUpload} />
                {muavinFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {muavinFileName} — {muavinRows.length} satır
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-400">
                  Hesap Planı Excel (opsiyonel)
                </label>
                <input type="file" accept=".xlsx,.xls" onChange={handleHesapPlaniUpload} />
                {hesapPlaniFileName && (
                  <p className="mt-1 text-xs text-gray-500">{hesapPlaniFileName}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm text-gray-400">
                  TCMB Kur Listesi Excel (opsiyonel)
                </label>
                <input type="file" accept=".xlsx,.xls" onChange={handleTcmbListUpload} />
                {tcmbFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {tcmbFileName} — {tcmbList.length} satır
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <h2 className="mb-4 text-lg font-semibold">Kur Belirleme</h2>

          <div className="grid gap-4 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm text-gray-400">TCMB Döviz Alış Kur</label>
              <div className="flex gap-2">
                <input
                  className={inputClassName}
                  value={tcmbKur}
                  readOnly
                  placeholder="TCMB'den getir"
                />
                <button
                  type="button"
                  onClick={resolveKur}
                  disabled={isFetchingKur}
                  className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
                >
                  {isFetchingKur ? "..." : "Getir"}
                </button>
              </div>
              {tcmbKurTarihi && (
                <p className="mt-1 text-xs text-gray-500">Kur tarihi: {tcmbKurTarihi}</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm text-gray-400">Manuel Kur</label>
              <input
                className={inputClassName}
                value={manualKur}
                onChange={(event) => setManualKur(event.target.value)}
                placeholder="Manuel kur girin"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-gray-400">Kullanılacak Kur</label>
              <div className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-lg font-semibold text-emerald-300">
                {effectiveKur ? formatMoney(effectiveKur) : "—"}
              </div>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={handleCalculate}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold hover:bg-emerald-500"
              >
                Değerleme Hesapla
              </button>
            </div>
          </div>

          {kurWarning && (
            <p className="mt-3 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
              {kurWarning}
            </p>
          )}

          <p className="mt-3 text-xs text-gray-500">
            TCMB kuralı: değerleme tarihinden bir önceki iş gününün döviz alış kuru kullanılır.
            Kur bulunamazsa manuel giriş veya TCMB kur listesi yükleyin.
          </p>
        </section>

        {summary && (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Değerlenen Hesap", value: summary.degerlenenHesapSayisi },
              { label: "Toplam Döviz Bakiye", value: formatMoney(summary.toplamDovizBakiye) },
              { label: "Kur Farkı Geliri", value: formatMoney(summary.toplamKurFarkiGeliri) },
              { label: "Kur Farkı Gideri", value: formatMoney(summary.toplamKurFarkiGideri) },
              { label: "Net Kur Farkı", value: formatMoney(summary.netKurFarki) },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-gray-800 bg-gray-900/60 p-4"
              >
                <p className="text-xs text-gray-500">{card.label}</p>
                <p className="mt-1 text-xl font-semibold">{card.value}</p>
              </div>
            ))}
          </section>
        )}

        {valuationRows.length > 0 && (
          <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Değerleme Önizleme</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportReport}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800"
                >
                  Excel Rapor (Özet + Detay)
                </button>
                <button
                  type="button"
                  onClick={handleExportLuca}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
                >
                  Luca Fiş Excel
                </button>
                <button
                  type="button"
                  onClick={handleExportAll}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
                >
                  Tüm Excel Çıktıları
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-800 text-gray-400">
                  <tr>
                    <th className="px-2 py-2">Hesap</th>
                    <th className="px-2 py-2">Döviz Bak.</th>
                    <th className="px-2 py-2">Defter TL</th>
                    <th className="px-2 py-2">Kur</th>
                    <th className="px-2 py-2">Değerlenmiş TL</th>
                    <th className="px-2 py-2">Kur Farkı</th>
                    <th className="px-2 py-2">G/G</th>
                    <th className="px-2 py-2">K.F. Hesap</th>
                    <th className="px-2 py-2">Fiş Tarihi</th>
                    <th className="px-2 py-2">Tutar</th>
                    <th className="px-2 py-2">Açıklama</th>
                    <th className="px-2 py-2">Fiş Satırları</th>
                  </tr>
                </thead>
                <tbody>
                  {valuationRows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-800/80 align-top">
                      <td className="px-2 py-2">
                        <div className="font-medium">{row.hesapKodu}</div>
                        <div className="text-xs text-gray-500">{row.hesapAdi}</div>
                      </td>
                      <td className="px-2 py-2">{formatMoney(row.dovizBakiye)}</td>
                      <td className="px-2 py-2">{formatMoney(row.defterTl)}</td>
                      <td className="px-2 py-2">
                        <input
                          className="w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.kur}
                          onChange={(event) =>
                            updateValuationRow(row.id, { kur: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">{formatMoney(row.degerlenmisTl)}</td>
                      <td className="px-2 py-2">{formatMoney(row.kurFarki)}</td>
                      <td className={`px-2 py-2 ${tipClass(row.kurFarkiTip)}`}>
                        {row.kurFarkiTip === "gelir"
                          ? "Gelir"
                          : row.kurFarkiTip === "gider"
                            ? "Gider"
                            : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-20 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.kurFarkiHesap}
                          onChange={(event) =>
                            updateValuationRow(row.id, { kurFarkiHesap: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="date"
                          className="rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={
                            row.fisTarihi?.includes(".")
                              ? row.fisTarihi.split(".").reverse().join("-")
                              : row.fisTarihi || degerlemeTarihi
                          }
                          onChange={(event) => {
                            const [y, m, d] = event.target.value.split("-");
                            updateValuationRow(row.id, { fisTarihi: `${d}.${m}.${y}` });
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.tutar}
                          onChange={(event) =>
                            updateValuationRow(row.id, { tutar: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="min-w-40 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.aciklama}
                          onChange={(event) =>
                            updateValuationRow(row.id, { aciklama: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-400">
                        {row.oneriSatirlari?.map((satir, index) => (
                          <div key={`${row.id}-satir-${index}`}>
                            {satir.hesapKodu}: B {formatMoney(satir.borc)} / A{" "}
                            {formatMoney(satir.alacak)}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
