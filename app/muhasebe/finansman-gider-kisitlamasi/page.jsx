"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  DEFAULT_FINANSMAN_HESAPLARI,
  DEFAULT_KKEG_HESAP,
  DISARIDA_BIRAKMA_NEDENLERI,
} from "@/src/config/finansmanGiderKisitlamasiDefaults";
import {
  getAccountPlanForCompany,
  loadAccountPlansFromStorage,
  normalizeCompanyRecord,
} from "@/src/utils/companyCenter";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  buildAccountDistribution,
  computeSuggestedKisitlamaOrani,
  parseFinansmanMuavinSheet,
  parseMizanSheet,
  recalculateWithRowOverrides,
  runFinansmanGiderKisitlamasiPipeline,
} from "@/src/utils/finansmanGiderKisitlamasiEngine";
import {
  exportFinansmanGiderReportWorkbook,
  validateFinansmanGiderExport,
} from "@/src/utils/finansmanGiderKisitlamasiExport";

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

function parseNumberInput(value) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function readExcelSheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

export default function FinansmanGiderKisitlamasiPage() {
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
  const [donemYili, setDonemYili] = useState(String(new Date().getFullYear()));
  const [donemBaslangic, setDonemBaslangic] = useState("");
  const [donemBitis, setDonemBitis] = useState("");
  const [kisitlamaOrani, setKisitlamaOrani] = useState("");
  const [ozKaynak, setOzKaynak] = useState("");
  const [yabanciKaynak, setYabanciKaynak] = useState("");
  const [kkegHesap, setKkegHesap] = useState(DEFAULT_KKEG_HESAP);
  const [nazimHesap, setNazimHesap] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState(
    DEFAULT_FINANSMAN_HESAPLARI.map((item) => item.id)
  );
  const [extraAccountInput, setExtraAccountInput] = useState("");

  const [muavinFileName, setMuavinFileName] = useState("");
  const [mizanFileName, setMizanFileName] = useState("");
  const [hesapPlaniFileName, setHesapPlaniFileName] = useState("");
  const [muavinRows, setMuavinRows] = useState([]);
  const [mizanRows, setMizanRows] = useState([]);
  const [uploadedAccountPlan, setUploadedAccountPlan] = useState([]);

  const [previewRows, setPreviewRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [accountDistribution, setAccountDistribution] = useState([]);
  const [kkegList, setKkegList] = useState([]);
  const [lucaSuggestion, setLucaSuggestion] = useState(null);
  const [hasCalculated, setHasCalculated] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setAccountPlans(loadAccountPlansFromStorage());
  }, []);

  const companyAccountPlan = useMemo(() => {
    const stored = getAccountPlanForCompany(accountPlans, selectedCompany || selectedCompanyId);
    return uploadedAccountPlan.length ? uploadedAccountPlan : stored;
  }, [accountPlans, selectedCompany, selectedCompanyId, uploadedAccountPlan]);

  const selectedAccountDefs = useMemo(() => {
    const defaults = DEFAULT_FINANSMAN_HESAPLARI.filter((item) =>
      selectedAccounts.includes(item.id)
    );
    const extras = selectedAccounts
      .filter((id) => !DEFAULT_FINANSMAN_HESAPLARI.some((item) => item.id === id))
      .map((prefix) => ({ id: prefix, label: `${prefix} (ek hesap)`, prefix }));

    return [...defaults, ...extras];
  }, [selectedAccounts]);

  const suggestedOran = useMemo(
    () => computeSuggestedKisitlamaOrani(parseNumberInput(ozKaynak), parseNumberInput(yabanciKaynak)),
    [ozKaynak, yabanciKaynak]
  );

  const kisitlamaUygulanir = parseNumberInput(yabanciKaynak) > parseNumberInput(ozKaynak);

  const currentStep = useMemo(() => {
    if (hasCalculated && previewRows.length) return 5;
    if (ozKaynak && yabanciKaynak && (muavinRows.length || mizanRows.length)) return 4;
    if (muavinRows.length || mizanRows.length) return 3;
    if (selectedCompanyId && donemYili) return 2;
    if (selectedCompanyId) return 1;
    return 0;
  }, [
    hasCalculated,
    previewRows.length,
    ozKaynak,
    yabanciKaynak,
    muavinRows.length,
    mizanRows.length,
    selectedCompanyId,
    donemYili,
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
    const parsed = parseFinansmanMuavinSheet(sheet);
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
    const parsed = parseMizanSheet(sheet);
    setMizanRows(parsed);
    setMizanFileName(file.name);
    showToast(`${parsed.length} mizan satırı okundu.`, "success");
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
      }))
      .filter((row) => row.accountCode && row.accountName);

    setUploadedAccountPlan(parsed);
    setHesapPlaniFileName(file.name);
    showToast(`${parsed.length} hesap planı satırı yüklendi.`, "success");
    event.target.value = "";
  };

  const buildParams = () => ({
    ozKaynak: parseNumberInput(ozKaynak),
    yabanciKaynak: parseNumberInput(yabanciKaynak),
    kisitlamaOrani: kisitlamaOrani !== "" ? parseNumberInput(kisitlamaOrani) : suggestedOran,
    donemYili,
    donemBaslangic,
    donemBitis,
    kkegHesap,
    nazimHesap,
    firmaId: selectedCompanyId,
  });

  const handleCalculate = () => {
    if (!selectedCompanyId) {
      alert("Önce firma seçin.");
      return;
    }

    if (!muavinRows.length) {
      alert("Muavin Excel dosyası yükleyin.");
      return;
    }

    if (!selectedAccountDefs.length) {
      alert("En az bir finansman gideri hesabı seçin.");
      return;
    }

    if (ozKaynak === "" || yabanciKaynak === "") {
      alert("Öz kaynak ve yabancı kaynak tutarlarını girin.");
      return;
    }

    const result = runFinansmanGiderKisitlamasiPipeline({
      muavinRows,
      mizanRows,
      selectedAccounts: selectedAccountDefs,
      accountPlan: companyAccountPlan,
      donemBaslangic,
      donemBitis,
      ...buildParams(),
    });

    setPreviewRows(result.rows);
    setSummary(result.summary);
    setAccountDistribution(result.accountDistribution);
    setKkegList(result.kkegList);
    setLucaSuggestion(result.lucaSuggestion);
    setHasCalculated(true);

    if (!kisitlamaOrani && result.summary.suggestedOran > 0) {
      setKisitlamaOrani(String(result.summary.suggestedOran));
    }

    showToast(
      result.summary.kisitlamaUygulanir
        ? `${result.rows.length} satır hesaplandı. KKEG: ${formatMoney(result.summary.kkegTutari)}`
        : result.summary.uyari,
      result.summary.kisitlamaUygulanir ? "success" : "info"
    );
  };

  const updatePreviewRow = (rowId, patch) => {
    setPreviewRows((current) => {
      const next = current.map((row) =>
        row.id === rowId ? { ...row, ...patch, manuallyEdited: true } : row
      );

      const result = recalculateWithRowOverrides(next, buildParams());
      setSummary(result.summary);
      setAccountDistribution(buildAccountDistribution(result.rows));
      setKkegList(result.kkegList);
      setLucaSuggestion(result.lucaSuggestion);
      return result.rows;
    });
  };

  const exportMeta = useMemo(
    () => ({
      firmaAdi: getCompanyDisplayName(selectedCompany),
      donemYili,
      donemBaslangic,
      donemBitis,
    }),
    [selectedCompany, donemYili, donemBaslangic, donemBitis]
  );

  const handleExport = () => {
    const validation = validateFinansmanGiderExport({
      muavinFileLoaded: muavinRows.length > 0,
      mizanFileLoaded: mizanRows.length > 0,
      kisitlamaOrani: kisitlamaOrani !== "" ? parseNumberInput(kisitlamaOrani) : suggestedOran,
      ozKaynak: parseNumberInput(ozKaynak),
      yabanciKaynak: parseNumberInput(yabanciKaynak),
      selectedAccounts: selectedAccountDefs,
      previewRows,
      kisitlamaUygulanir,
    });

    if (validation.hasBlockingErrors) {
      alert(validation.errors.join("\n"));
      return;
    }

    exportFinansmanGiderReportWorkbook({
      summary: summary || {},
      meta: exportMeta,
      accountDistribution,
      previewRows,
      kkegList,
      lucaSuggestion,
      fileName: `finansman-gider-kisitlamasi-${donemYili}`,
    });

    showToast("Excel raporu indirildi (5 sayfa).", "success");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <MuhasebeMenu />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Finansman Gider Kısıtlaması Motoru
          </h1>
          <p className="mt-2 max-w-3xl text-gray-400">
            Finansman gider kısıtlamasına tabi giderleri hesaplayın, KKEG ayrımını yapın ve rapor
            üretin.
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

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Dönem Yılı</label>
                  <input
                    className={inputClassName}
                    value={donemYili}
                    onChange={(event) => setDonemYili(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Başlangıç</label>
                  <input
                    type="date"
                    className={inputClassName}
                    value={donemBaslangic}
                    onChange={(event) => setDonemBaslangic(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Bitiş</label>
                  <input
                    type="date"
                    className={inputClassName}
                    value={donemBitis}
                    onChange={(event) => setDonemBitis(event.target.value)}
                  />
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
                <label className="mb-1 block text-sm text-gray-400">Mizan Excel</label>
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
          <h2 className="mb-4 text-lg font-semibold">Finansman Gideri Hesapları ve Parametreler</h2>

          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DEFAULT_FINANSMAN_HESAPLARI.map((account) => (
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
            {selectedAccounts
              .filter((id) => !DEFAULT_FINANSMAN_HESAPLARI.some((item) => item.id === id))
              .map((prefix) => (
                <label
                  key={prefix}
                  className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-sm"
                >
                  <input type="checkbox" checked onChange={() => toggleAccount(prefix)} />
                  {prefix} (ek hesap)
                </label>
              ))}
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <input
              className={`${inputClassName} max-w-xs`}
              value={extraAccountInput}
              onChange={(event) => setExtraAccountInput(event.target.value)}
              placeholder="Ek hesap kodu (ör. 780)"
            />
            <button
              type="button"
              onClick={addExtraAccount}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800"
            >
              Hesap Ekle
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-sm text-gray-400">Öz Kaynak (TL)</label>
              <input
                className={inputClassName}
                value={ozKaynak}
                onChange={(event) => setOzKaynak(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Yabancı Kaynak (TL)</label>
              <input
                className={inputClassName}
                value={yabanciKaynak}
                onChange={(event) => setYabanciKaynak(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Kısıtlama Oranı (%)</label>
              <input
                className={inputClassName}
                value={kisitlamaOrani}
                onChange={(event) => setKisitlamaOrani(event.target.value)}
                placeholder={suggestedOran ? String(suggestedOran) : "0"}
              />
              {suggestedOran > 0 && (
                <p className="mt-1 text-xs text-gray-500">Önerilen: %{formatMoney(suggestedOran)}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">KKEG Hesabı</label>
              <input
                className={inputClassName}
                value={kkegHesap}
                onChange={(event) => setKkegHesap(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Nazım / Karşı Hesap</label>
              <input
                className={inputClassName}
                value={nazimHesap}
                onChange={(event) => setNazimHesap(event.target.value)}
                placeholder="Opsiyonel"
              />
            </div>
          </div>

          {!kisitlamaUygulanir && ozKaynak !== "" && yabanciKaynak !== "" && (
            <p className="mt-4 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
              Yabancı kaynak öz kaynağa eşit veya daha düşük; finansman gider kısıtlaması
              uygulanmaz.
            </p>
          )}

          <div className="mt-4">
            <button
              type="button"
              onClick={handleCalculate}
              className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold hover:bg-emerald-500"
            >
              Kısıtlama Hesapla
            </button>
          </div>
        </section>

        {summary && (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {[
              { label: "Toplam Finansman Gideri", value: formatMoney(summary.toplamFinansmanGideri) },
              { label: "Kısıtlamaya Tabi", value: formatMoney(summary.kisitlamayaTabiGider) },
              { label: "Kısıtlama Dışı", value: formatMoney(summary.kisitlamaDisiGider) },
              { label: "KKEG Tutarı", value: formatMoney(summary.kkegTutari) },
              { label: "Kabul Edilen Gider", value: formatMoney(summary.kabulEdilenGider) },
              { label: "Öz Kaynak", value: formatMoney(summary.ozKaynak) },
              { label: "Yabancı Kaynak", value: formatMoney(summary.yabanciKaynak) },
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

        {lucaSuggestion?.enabled && (
          <section className="mt-6 rounded-xl border border-indigo-800/50 bg-indigo-950/20 p-5">
            <h2 className="mb-2 text-lg font-semibold text-indigo-200">Luca KKEG Fiş Önerisi</h2>
            <p className="text-sm text-gray-400">{lucaSuggestion.fisAciklama}</p>
            <p className="mt-2 text-sm">
              {lucaSuggestion.kkegHesap} ↔ {lucaSuggestion.nazimHesap || lucaSuggestion.kkegHesap}{" "}
              — {formatMoney(summary?.kkegTutari)} TL
            </p>
            <p className="mt-1 text-xs text-gray-500">
              İleride Luca fiş üretimine bağlanmaya hazır yapı. Detay Excel raporunda ayrı sayfada.
            </p>
          </section>
        )}

        {previewRows.length > 0 && (
          <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Muavin Önizleme</h2>
              <button
                type="button"
                onClick={handleExport}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
              >
                Excel Rapor İndir
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-800 text-gray-400">
                  <tr>
                    <th className="px-2 py-2">Tarih</th>
                    <th className="px-2 py-2">Hesap</th>
                    <th className="px-2 py-2">Açıklama</th>
                    <th className="px-2 py-2">Borç</th>
                    <th className="px-2 py-2">Alacak</th>
                    <th className="px-2 py-2">Net Gider</th>
                    <th className="px-2 py-2">Tabi</th>
                    <th className="px-2 py-2">Dışarıda</th>
                    <th className="px-2 py-2">Neden</th>
                    <th className="px-2 py-2">KKEG</th>
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
                      <td className="px-2 py-2 max-w-xs truncate">{row.aciklama}</td>
                      <td className="px-2 py-2">{formatMoney(row.borc)}</td>
                      <td className="px-2 py-2">{formatMoney(row.alacak)}</td>
                      <td className="px-2 py-2">{formatMoney(row.netFinansmanGideri)}</td>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={row.kisitlamayaTabi}
                          disabled={row.disaridaBirak}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { kisitlamayaTabi: event.target.checked })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={row.disaridaBirak}
                          onChange={(event) =>
                            updatePreviewRow(row.id, {
                              disaridaBirak: event.target.checked,
                              kisitlamayaTabi: event.target.checked ? false : row.kisitlamayaTabi,
                              disaridaNeden: event.target.checked ? row.disaridaNeden : "",
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs"
                          value={row.disaridaNeden || ""}
                          disabled={!row.disaridaBirak}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { disaridaNeden: event.target.value })
                          }
                        >
                          <option value="">—</option>
                          {DISARIDA_BIRAKMA_NEDENLERI.map((reason) => (
                            <option key={reason.id} value={reason.id}>
                              {reason.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 text-amber-300">{formatMoney(row.kkegTutari)}</td>
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
