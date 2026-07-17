"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  DEFAULT_ADAT_HESAPLARI,
  DEFAULT_FAIZ_GELIR_HESAP,
  DEFAULT_FAIZ_GIDER_HESAP,
  GUN_BAZI,
  HESAPLAMA_MODU,
} from "@/src/config/adatHesaplamaDefaults";
import {
  getAccountPlanForCompany,
  loadAccountPlansFromStorage,
  normalizeCompanyRecord,
} from "@/src/utils/companyCenter";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  buildAccountSummary,
  buildAdatLucaRows,
  buildMonthlySummary,
  parseAdatMuavinSheet,
  parseAdatMizanSheet,
  recalculateAdatPreviewRows,
  recalculateAdatSummary,
  runAdatHesaplamaPipeline,
  validateAdatBalanceFromMuavin,
} from "@/src/utils/adatHesaplamaEngine";
import {
  exportAdatFullPack,
  exportAdatLucaExcel,
  exportAdatReportWorkbook,
  validateAdatExport,
} from "@/src/utils/adatHesaplamaExport";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const FLOW_STEPS = [
  "Firma ve dönem",
  "Dosya yükle",
  "Parametreler",
  "Hesapla",
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

export default function AdatHesaplamaPage() {
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
  const [donemBaslangic, setDonemBaslangic] = useState("");
  const [donemBitis, setDonemBitis] = useState("");
  const [yillikFaizOrani, setYillikFaizOrani] = useState("");
  const [gunBazi, setGunBazi] = useState(String(GUN_BAZI[360]));
  const [hesaplamaModu, setHesaplamaModu] = useState(HESAPLAMA_MODU.GUNLUK_DETAY);
  const [negatifHaric, setNegatifHaric] = useState(false);
  const [sifirGizle, setSifirGizle] = useState(false);
  const [faizGelirHesap, setFaizGelirHesap] = useState(DEFAULT_FAIZ_GELIR_HESAP);
  const [faizGiderHesap, setFaizGiderHesap] = useState(DEFAULT_FAIZ_GIDER_HESAP);
  const [bsmvHesap, setBsmvHesap] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState(
    DEFAULT_ADAT_HESAPLARI.map((item) => item.id)
  );
  const [extraAccountInput, setExtraAccountInput] = useState("");

  const [muavinFileName, setMuavinFileName] = useState("");
  const [mizanFileName, setMizanFileName] = useState("");
  const [hesapPlaniFileName, setHesapPlaniFileName] = useState("");
  const [muavinRows, setMuavinRows] = useState([]);
  const [mizanRows, setMizanRows] = useState([]);

  const [previewRows, setPreviewRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [accountSummary, setAccountSummary] = useState([]);
  const [monthlySummary, setMonthlySummary] = useState([]);
  const [hasCalculated, setHasCalculated] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setAccountPlans(loadAccountPlansFromStorage());
  }, []);

  const companyAccountPlan = useMemo(
    () => getAccountPlanForCompany(accountPlans, selectedCompany || selectedCompanyId),
    [accountPlans, selectedCompany, selectedCompanyId]
  );

  const selectedAccountDefs = useMemo(() => {
    const defaults = DEFAULT_ADAT_HESAPLARI.filter((item) => selectedAccounts.includes(item.id));
    const extras = selectedAccounts
      .filter((id) => !DEFAULT_ADAT_HESAPLARI.some((item) => item.id === id))
      .map((prefix) => ({ id: prefix, label: `${prefix} (ek hesap)`, prefix }));
    return [...defaults, ...extras];
  }, [selectedAccounts]);

  const buildParams = () => ({
    donemBaslangic,
    donemBitis,
    yillikFaizOrani: Number(String(yillikFaizOrani).replace(",", ".")) || 0,
    gunBazi: Number(gunBazi) || GUN_BAZI[360],
    hesaplamaModu,
    negatifHaric,
    sifirGizle,
    faizGelirHesap,
    faizGiderHesap,
    bsmvHesap,
    firmaId: selectedCompanyId,
    belgeTuru: "DK",
  });

  const currentStep = useMemo(() => {
    if (hasCalculated && previewRows.length) return 5;
    if (muavinRows.length && yillikFaizOrani && donemBaslangic && donemBitis) return 4;
    if (muavinRows.length) return 3;
    if (selectedCompanyId) return 2;
    return 0;
  }, [
    hasCalculated,
    previewRows.length,
    muavinRows.length,
    yillikFaizOrani,
    donemBaslangic,
    donemBitis,
    selectedCompanyId,
  ]);

  const showToast = (message, type = "info") => setToast({ message, type });

  const toggleAccount = (accountId) => {
    setSelectedAccounts((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId]
    );
  };

  const addExtraAccount = () => {
    const prefix = extraAccountInput.trim().replace(/\./g, "");
    if (!prefix) return;
    if (!selectedAccounts.includes(prefix)) {
      setSelectedAccounts((current) => [...current, prefix]);
    }
    setExtraAccountInput("");
  };

  const handleMuavinUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const sheet = await readExcelSheet(file);
    const parsed = parseAdatMuavinSheet(sheet);
    setMuavinRows(parsed);
    setMuavinFileName(file.name);
    setHasCalculated(false);
    showToast(`${parsed.length} muavin satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleMizanUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const sheet = await readExcelSheet(file);
    const parsed = parseAdatMizanSheet(sheet);
    setMizanRows(parsed);
    setMizanFileName(file.name);
    showToast(`${parsed.length} mizan satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleHesapPlaniUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setHesapPlaniFileName(file.name);
    showToast("Hesap planı yüklendi.", "success");
    event.target.value = "";
  };

  const handleCalculate = () => {
    if (!selectedCompanyId) {
      alert("Önce firma seçin.");
      return;
    }
    if (!muavinRows.length) {
      alert("Muavin Excel dosyası yükleyin.");
      return;
    }
    if (!donemBaslangic || !donemBitis) {
      alert("Dönem başlangıç ve bitiş tarihlerini girin.");
      return;
    }
    if (yillikFaizOrani === "") {
      alert("Yıllık faiz oranını girin.");
      return;
    }
    if (!selectedAccountDefs.length) {
      alert("En az bir adat hesabı seçin.");
      return;
    }

    const result = runAdatHesaplamaPipeline({
      muavinRows,
      mizanRows,
      selectedAccounts: selectedAccountDefs,
      accountPlan: companyAccountPlan,
      ...buildParams(),
    });

    setPreviewRows(result.previewRows);
    setSummary(result.summary);
    setAccountSummary(result.accountSummary);
    setMonthlySummary(result.monthlySummary);
    setHasCalculated(true);

    showToast(
      `${result.previewRows.length} satır hesaplandı. Toplam adat: ${formatMoney(result.summary.toplamAdatTutari)}`,
      "success"
    );
  };

  const updatePreviewRow = (rowId, patch) => {
    setPreviewRows((current) => {
      const next = current.map((row) =>
        row.id === rowId ? { ...row, ...patch, manuallyEdited: true } : row
      );
      const recalculated = recalculateAdatPreviewRows(next, buildParams());
      setSummary(recalculateAdatSummary(recalculated));
      setAccountSummary(buildAccountSummary(recalculated));
      setMonthlySummary(buildMonthlySummary(recalculated));
      return recalculated;
    });
  };

  const exportMeta = useMemo(
    () => ({
      firmaAdi: getCompanyDisplayName(selectedCompany),
      donemBaslangic,
      donemBitis,
      yillikFaizOrani: Number(String(yillikFaizOrani).replace(",", ".")) || 0,
      gunBazi,
      hesaplamaModu:
        hesaplamaModu === HESAPLAMA_MODU.AYLIK_TOPLU
          ? "Aylık Toplu"
          : hesaplamaModu === HESAPLAMA_MODU.DONEM_SONU
            ? "Dönem Sonu"
            : "Günlük Detay",
    }),
    [
      selectedCompany,
      donemBaslangic,
      donemBitis,
      yillikFaizOrani,
      gunBazi,
      hesaplamaModu,
    ]
  );

  const runExportValidation = () => {
    const lucaRows = buildAdatLucaRows(
      previewRows.filter((row) => !row.disaridaBirak),
      buildParams()
    );

    return validateAdatExport({
      ...buildParams(),
      selectedAccounts: selectedAccountDefs,
      muavinLoaded: muavinRows.length > 0,
      balanceCalculable: validateAdatBalanceFromMuavin(muavinRows, selectedAccountDefs),
      previewRows: previewRows.filter((row) => !row.disaridaBirak),
      lucaRows,
    });
  };

  const handleExportReport = () => {
    const validation = runExportValidation();
    if (validation.hasBlockingErrors) {
      alert(validation.errors.join("\n"));
      return;
    }

    exportAdatReportWorkbook({
      summary: summary || {},
      meta: exportMeta,
      previewRows: previewRows.filter((row) => !row.disaridaBirak),
      accountSummary,
      monthlySummary,
      fileName: "adat-hesaplama-rapor",
    });
    showToast("Excel raporu indirildi.", "success");
  };

  const handleExportLuca = async () => {
    const validation = runExportValidation();
    if (validation.hasBlockingErrors) {
      alert(validation.errors.join("\n"));
      return;
    }

    const result = await exportAdatLucaExcel(previewRows.filter((row) => !row.disaridaBirak), {
      ...buildParams(),
      filePrefix: "adat-luca",
    });

    if (!result.ok) {
      alert(result.message || "Luca Excel oluşturulamadı.");
      return;
    }

    showToast(`${result.fileCount || 1} Luca dosyası indirildi.`, "success");
  };

  const handleExportAll = async () => {
    const validation = runExportValidation();
    if (validation.hasBlockingErrors) {
      alert(validation.errors.join("\n"));
      return;
    }

    const result = await exportAdatFullPack({
      summary: summary || {},
      meta: exportMeta,
      previewRows: previewRows.filter((row) => !row.disaridaBirak),
      accountSummary,
      monthlySummary,
      context: {
        ...buildParams(),
        reportFileName: "adat-hesaplama-rapor",
        lucaFilePrefix: "adat-luca",
      },
    });

    if (!result.ok) {
      alert(result.message || "Export tamamlanamadı.");
      return;
    }

    showToast("Rapor ve Luca dosyaları indirildi.", "success");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Adat Hesaplama ve Faiz Fiş Motoru
          </h1>
          <p className="mt-2 max-w-3xl text-gray-400">
            Cari, ortaklar cari, kasa ve grup şirket bakiyeleri üzerinden günlük adat/faiz
            hesaplayın ve Luca fiş önerisi üretin.
          </p>
        </div>

        {toast && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              toast.type === "success"
                ? "border-emerald-700 bg-emerald-950/50 text-emerald-200"
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
            <h2 className="mb-4 text-lg font-semibold">Firma ve Dönem</h2>
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
                  <label className="mb-1 block text-sm text-gray-400">Dönem Başlangıç</label>
                  <input
                    type="date"
                    className={inputClassName}
                    value={donemBaslangic}
                    onChange={(event) => setDonemBaslangic(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Dönem Bitiş</label>
                  <input
                    type="date"
                    className={inputClassName}
                    value={donemBitis}
                    onChange={(event) => setDonemBitis(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Yıllık Faiz Oranı (%)</label>
                  <input
                    className={inputClassName}
                    value={yillikFaizOrani}
                    onChange={(event) => setYillikFaizOrani(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Gün Bazı</label>
                  <select
                    className={inputClassName}
                    value={gunBazi}
                    onChange={(event) => setGunBazi(event.target.value)}
                  >
                    <option value={String(GUN_BAZI[360])}>360</option>
                    <option value={String(GUN_BAZI[365])}>365</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold">Dosya Yükleme</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-gray-400">Muavin Excel (zorunlu)</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleMuavinUpload} />
                {muavinFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {muavinFileName} — {muavinRows.length} satır
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">Mizan Excel (opsiyonel)</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleMizanUpload} />
                {mizanFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {mizanFileName} — {mizanRows.length} satır
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
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <h2 className="mb-4 text-lg font-semibold">Adat Hesapları ve Seçenekler</h2>

          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DEFAULT_ADAT_HESAPLARI.map((account) => (
              <label
                key={account.id}
                className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedAccounts.includes(account.id)}
                  onChange={() => toggleAccount(account.id)}
                />
                {account.label}
              </label>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <input
              className={`${inputClassName} max-w-xs`}
              value={extraAccountInput}
              onChange={(event) => setExtraAccountInput(event.target.value)}
              placeholder="Ek hesap kodu"
            />
            <button
              type="button"
              onClick={addExtraAccount}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800"
            >
              Hesap Ekle
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm text-gray-400">Hesaplama Modu</label>
              <select
                className={inputClassName}
                value={hesaplamaModu}
                onChange={(event) => setHesaplamaModu(event.target.value)}
              >
                <option value={HESAPLAMA_MODU.GUNLUK_DETAY}>Günlük detay</option>
                <option value={HESAPLAMA_MODU.AYLIK_TOPLU}>Aylık toplulaştır</option>
                <option value={HESAPLAMA_MODU.DONEM_SONU}>Sadece dönem sonu</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Faiz Gelir Hesabı</label>
              <input
                className={inputClassName}
                value={faizGelirHesap}
                onChange={(event) => setFaizGelirHesap(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Faiz Gider Hesabı</label>
              <input
                className={inputClassName}
                value={faizGiderHesap}
                onChange={(event) => setFaizGiderHesap(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">BSMV Hesabı (opsiyonel)</label>
              <input
                className={inputClassName}
                value={bsmvHesap}
                onChange={(event) => setBsmvHesap(event.target.value)}
                placeholder="Boş bırakılabilir"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={negatifHaric}
                onChange={(event) => setNegatifHaric(event.target.checked)}
              />
              Negatif bakiye hariç tut
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={sifirGizle}
                onChange={(event) => setSifirGizle(event.target.checked)}
              />
              Sıfır bakiyeleri gizle
            </label>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleCalculate}
              className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold hover:bg-emerald-500"
            >
              Adat Hesapla
            </button>
          </div>
        </section>

        {summary && (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Toplam Adat", value: formatMoney(summary.toplamAdatTutari) },
              { label: "Faiz Geliri", value: formatMoney(summary.toplamFaizGeliri) },
              { label: "Faiz Gideri", value: formatMoney(summary.toplamFaizGideri) },
              { label: "Ort. Bakiye", value: formatMoney(summary.gunlukOrtalamaBakiye) },
              { label: "Gün Sayısı", value: summary.hesaplananGunSayisi },
              { label: "Hesap Sayısı", value: summary.islemYapilanHesapSayisi },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-gray-800 bg-gray-900/60 p-4"
              >
                <p className="text-xs text-gray-500">{card.label}</p>
                <p className="mt-1 text-lg font-semibold">{card.value}</p>
              </div>
            ))}
          </section>
        )}

        {previewRows.length > 0 && (
          <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Adat Önizleme</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportReport}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800"
                >
                  Excel Rapor
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
                  Tüm Çıktılar
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-800 text-gray-400">
                  <tr>
                    <th className="px-2 py-2">Tarih</th>
                    <th className="px-2 py-2">Hesap</th>
                    <th className="px-2 py-2">Bakiye</th>
                    <th className="px-2 py-2">Gün</th>
                    <th className="px-2 py-2">Oran</th>
                    <th className="px-2 py-2">Faiz</th>
                    <th className="px-2 py-2">G/G</th>
                    <th className="px-2 py-2">Faiz Hes.</th>
                    <th className="px-2 py-2">Fiş Tarihi</th>
                    <th className="px-2 py-2">Dışarıda</th>
                    <th className="px-2 py-2">Açıklama</th>
                    <th className="px-2 py-2">Önerilen Fiş</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-800/80 align-top">
                      <td className="px-2 py-2 whitespace-nowrap">{row.tarih}</td>
                      <td className="px-2 py-2">
                        <div className="font-medium">{row.hesapKodu}</div>
                        <div className="text-xs text-gray-500">{row.hesapAdi}</div>
                      </td>
                      <td className="px-2 py-2">{formatMoney(row.bakiye)}</td>
                      <td className="px-2 py-2">{row.gunSayisi}</td>
                      <td className="px-2 py-2">
                        <input
                          className="w-16 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.faizOrani}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { faizOrani: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.gunlukFaiz}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { gunlukFaiz: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs"
                          value={row.faizYonu}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { faizYonu: event.target.value })
                          }
                        >
                          <option value="gelir">Gelir</option>
                          <option value="gider">Gider</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-20 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.faizHesap}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { faizHesap: event.target.value })
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
                              : row.fisTarihi || row.tarih
                          }
                          onChange={(event) => {
                            const [y, m, d] = event.target.value.split("-");
                            updatePreviewRow(row.id, { fisTarihi: `${d}.${m}.${y}` });
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={row.disaridaBirak}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { disaridaBirak: event.target.checked })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="min-w-44 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.aciklama}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { aciklama: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-400">
                        {row.oneriFis?.map((satir, index) => (
                          <div key={`${row.id}-fis-${index}`}>
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
