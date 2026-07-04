"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  ARAC_TIPI,
  DEFAULT_BINEK_KISIT_ORANI,
  DEFAULT_GELECEK_DONEM_HESABI,
  DEFAULT_GIDER_HESABI,
  GIDERLESTIRME_TIPI,
} from "@/src/config/policeGiderlestirmeDefaults";
import { normalizeCompanyRecord } from "@/src/utils/companyCenter";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  buildAracDistribution,
  createManualPoliceEntry,
  parseAracListSheet,
  parsePoliceListSheet,
  recalculatePolicePreviewRows,
  recalculatePoliceSummary,
  runPoliceGiderlestirmePipeline,
} from "@/src/utils/policeGiderlestirmeEngine";
import {
  exportPoliceGiderlestirmeReportWorkbook,
  validatePoliceGiderlestirmeExport,
} from "@/src/utils/policeGiderlestirmeExport";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const FLOW_STEPS = [
  "Firma ve dönem",
  "Dosya yükle",
  "Poliçe / araç",
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

export default function PoliceGiderlestirmePage() {
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


  const [donemYili, setDonemYili] = useState(String(new Date().getFullYear()));
  const [giderlestirmeTipi, setGiderlestirmeTipi] = useState(GIDERLESTIRME_TIPI.AYLIK);
  const [defaultGiderHesabi, setDefaultGiderHesabi] = useState(DEFAULT_GIDER_HESABI);
  const [defaultGelecekDonemHesabi, setDefaultGelecekDonemHesabi] = useState(
    DEFAULT_GELECEK_DONEM_HESABI
  );
  const [kisitOrani, setKisitOrani] = useState(String(DEFAULT_BINEK_KISIT_ORANI));
  const [kisitLimit, setKisitLimit] = useState("");

  const [policeFileName, setPoliceFileName] = useState("");
  const [aracFileName, setAracFileName] = useState("");
  const [hesapPlaniFileName, setHesapPlaniFileName] = useState("");
  const [policeList, setPoliceList] = useState([]);
  const [aracList, setAracList] = useState([]);

  const [manualForm, setManualForm] = useState({
    policeNo: "",
    plaka: "",
    baslangic: "",
    bitis: "",
    toplamTutar: "",
    aracTipi: ARAC_TIPI.BINEK,
    giderHesabi: "",
    gelecekDonemHesabi: "",
    aciklama: "trafik sigortası",
  });

  const [previewRows, setPreviewRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [aracDistribution, setAracDistribution] = useState([]);
  const [kkegList, setKkegList] = useState([]);
  const [lucaGiderlestirme, setLucaGiderlestirme] = useState(null);
  const [lucaKkeg, setLucaKkeg] = useState(null);
  const [hasCalculated, setHasCalculated] = useState(false);
  const [toast, setToast] = useState(null);

  const buildParams = () => ({
    donemYili,
    giderlestirmeTipi,
    kisitOrani: Number(kisitOrani) || DEFAULT_BINEK_KISIT_ORANI,
    kisitLimit: Number(kisitLimit) || 0,
    defaultGiderHesabi,
    defaultGelecekDonemHesabi,
    firmaId: selectedCompanyId,
  });

  const currentStep = useMemo(() => {
    if (hasCalculated && previewRows.length) return 5;
    if (policeList.length) return 4;
    if (selectedCompanyId && donemYili) return 2;
    if (selectedCompanyId) return 1;
    return 0;
  }, [hasCalculated, previewRows.length, policeList.length, selectedCompanyId, donemYili]);

  const showToast = (message, type = "info") => setToast({ message, type });

  const handlePoliceUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const sheet = await readExcelSheet(file);
    const parsed = parsePoliceListSheet(sheet);
    setPoliceList((current) => [...current, ...parsed]);
    setPoliceFileName(file.name);
    setHasCalculated(false);
    showToast(`${parsed.length} poliçe satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleAracUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const sheet = await readExcelSheet(file);
    const parsed = parseAracListSheet(sheet);
    setAracList(parsed);
    setAracFileName(file.name);
    showToast(`${parsed.length} araç kartı okundu.`, "success");
    event.target.value = "";
  };

  const handleHesapPlaniUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setHesapPlaniFileName(file.name);
    showToast("Hesap planı yüklendi.", "success");
    event.target.value = "";
  };

  const handleAddManualPolice = () => {
    const entry = createManualPoliceEntry({
      ...manualForm,
      donemYili,
      giderHesabi: manualForm.giderHesabi || defaultGiderHesabi,
      gelecekDonemHesabi: manualForm.gelecekDonemHesabi || defaultGelecekDonemHesabi,
    });

    if (!entry) {
      alert("Plaka, tarih aralığı ve tutar zorunludur.");
      return;
    }

    setPoliceList((current) => [...current, entry]);
    setHasCalculated(false);
    showToast("Manuel poliçe eklendi.", "success");
  };

  const handleCalculate = () => {
    if (!selectedCompanyId) {
      alert("Önce firma seçin.");
      return;
    }

    if (!policeList.length) {
      alert("Poliçe listesi yükleyin veya manuel poliçe ekleyin.");
      return;
    }

    const result = runPoliceGiderlestirmePipeline({
      policeList,
      aracList,
      ...buildParams(),
    });

    setPreviewRows(result.previewRows);
    setSummary(result.summary);
    setAracDistribution(result.aracDistribution);
    setKkegList(result.kkegList);
    setLucaGiderlestirme(result.lucaGiderlestirme);
    setLucaKkeg(result.lucaKkeg);
    setHasCalculated(true);

    showToast(
      `${result.previewRows.length} dönem satırı hesaplandı. KKEG: ${formatMoney(result.summary.kkegTutari)}`,
      "success"
    );
  };

  const updatePreviewRow = (rowId, patch) => {
    setPreviewRows((current) => {
      const next = current.map((row) =>
        row.id === rowId ? { ...row, ...patch, manuallyEdited: true } : row
      );

      const recalculated = recalculatePolicePreviewRows(next, buildParams());
      setSummary(recalculatePoliceSummary(recalculated, policeList, buildParams()));
      setAracDistribution(buildAracDistribution(recalculated));
      setKkegList(recalculated.filter((row) => row.kkegTutari > 0));
      return recalculated;
    });
  };

  const exportMeta = useMemo(
    () => ({
      firmaAdi: getCompanyDisplayName(selectedCompany),
      donemYili,
      giderlestirmeTipi:
        giderlestirmeTipi === GIDERLESTIRME_TIPI.Uc_AYLIK ? "3 Aylık" : "Aylık",
    }),
    [selectedCompany, donemYili, giderlestirmeTipi]
  );

  const handleExport = () => {
    const validation = validatePoliceGiderlestirmeExport({
      policeList,
      previewRows,
      donemYili,
    });

    if (validation.hasBlockingErrors) {
      alert(validation.errors.join("\n"));
      return;
    }

    exportPoliceGiderlestirmeReportWorkbook({
      summary: summary || {},
      meta: exportMeta,
      previewRows,
      aracDistribution,
      kkegList,
      lucaGiderlestirme,
      lucaKkeg,
      fileName: `police-giderlestirme-${donemYili}`,
    });

    showToast("Excel raporu indirildi (5 sayfa).", "success");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <MuhasebeMenu />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Poliçe Giderleştirme ve Araç Gider Kısıtı Motoru
          </h1>
          <p className="mt-2 max-w-3xl text-gray-400">
            Sigorta poliçelerini aylık veya 3 aylık dönemlerde giderleştirin, binek/ticari araç
            gider kısıtını hesaplayın ve rapor üretin.
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
                  <label className="mb-1 block text-sm text-gray-400">Dönem Yılı</label>
                  <input
                    className={inputClassName}
                    value={donemYili}
                    onChange={(event) => setDonemYili(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Giderleştirme Tipi</label>
                  <select
                    className={inputClassName}
                    value={giderlestirmeTipi}
                    onChange={(event) => setGiderlestirmeTipi(event.target.value)}
                  >
                    <option value={GIDERLESTIRME_TIPI.AYLIK}>Aylık</option>
                    <option value={GIDERLESTIRME_TIPI.Uc_AYLIK}>3 Aylık</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-gray-400">Varsayılan Gider Hesabı</label>
                  <input
                    className={inputClassName}
                    value={defaultGiderHesabi}
                    onChange={(event) => setDefaultGiderHesabi(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">
                    Gelecek Aylara/Yıllara Ait Gider
                  </label>
                  <input
                    className={inputClassName}
                    value={defaultGelecekDonemHesabi}
                    onChange={(event) => setDefaultGelecekDonemHesabi(event.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-gray-400">
                    Binek Gider Kısıt Oranı (%)
                  </label>
                  <input
                    className={inputClassName}
                    value={kisitOrani}
                    onChange={(event) => setKisitOrani(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-400">
                    Binek KKEG Limiti (TL, opsiyonel)
                  </label>
                  <input
                    className={inputClassName}
                    value={kisitLimit}
                    onChange={(event) => setKisitLimit(event.target.value)}
                    placeholder="Boş bırakılabilir"
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
                  Poliçe Listesi Excel (zorunlu)
                </label>
                <input type="file" accept=".xlsx,.xls" onChange={handlePoliceUpload} />
                {policeFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {policeFileName} — toplam {policeList.length} poliçe
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">
                  Araç Listesi Excel (opsiyonel)
                </label>
                <input type="file" accept=".xlsx,.xls" onChange={handleAracUpload} />
                {aracFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {aracFileName} — {aracList.length} araç kartı
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
          <h2 className="mb-4 text-lg font-semibold">Manuel Poliçe Ekle</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <input
              className={inputClassName}
              placeholder="Poliçe no"
              value={manualForm.policeNo}
              onChange={(event) => setManualForm((f) => ({ ...f, policeNo: event.target.value }))}
            />
            <input
              className={inputClassName}
              placeholder="Plaka *"
              value={manualForm.plaka}
              onChange={(event) => setManualForm((f) => ({ ...f, plaka: event.target.value }))}
            />
            <input
              className={inputClassName}
              placeholder="Başlangıç tarihi (01.06 veya 01.06.2026)"
              value={manualForm.baslangic}
              onChange={(event) => setManualForm((f) => ({ ...f, baslangic: event.target.value }))}
            />
            <input
              className={inputClassName}
              placeholder="Bitiş tarihi (01/06 veya 01/06/2027)"
              value={manualForm.bitis}
              onChange={(event) => setManualForm((f) => ({ ...f, bitis: event.target.value }))}
            />
            <input
              className={inputClassName}
              placeholder="Toplam tutar *"
              value={manualForm.toplamTutar}
              onChange={(event) =>
                setManualForm((f) => ({ ...f, toplamTutar: event.target.value }))
              }
            />
            <select
              className={inputClassName}
              value={manualForm.aracTipi}
              onChange={(event) => setManualForm((f) => ({ ...f, aracTipi: event.target.value }))}
            >
              <option value={ARAC_TIPI.BINEK}>Binek</option>
              <option value={ARAC_TIPI.TICARI}>Ticari</option>
            </select>
            <input
              className={inputClassName}
              placeholder="Açıklama"
              value={manualForm.aciklama}
              onChange={(event) => setManualForm((f) => ({ ...f, aciklama: event.target.value }))}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleAddManualPolice}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800"
            >
              Poliçe Ekle
            </button>
            <button
              type="button"
              onClick={handleCalculate}
              className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold hover:bg-emerald-500"
            >
              Giderleştirme Hesapla
            </button>
          </div>
        </section>

        {aracList.length > 0 && (
          <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold">Araç Kartları</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-800 text-gray-400">
                  <tr>
                    <th className="px-2 py-2">Plaka</th>
                    <th className="px-2 py-2">Araç</th>
                    <th className="px-2 py-2">Tip</th>
                    <th className="px-2 py-2">Sahiplik</th>
                    <th className="px-2 py-2">Kısıt Tabi</th>
                    <th className="px-2 py-2">Gider Hesabı</th>
                  </tr>
                </thead>
                <tbody>
                  {aracList.map((arac) => (
                    <tr key={arac.id} className="border-b border-gray-800/80">
                      <td className="px-2 py-2">{arac.plaka}</td>
                      <td className="px-2 py-2">{arac.aracAdi}</td>
                      <td className="px-2 py-2">{arac.aracTipi}</td>
                      <td className="px-2 py-2">{arac.sahiplik}</td>
                      <td className="px-2 py-2">{arac.kisitTabi ? "Evet" : "Hayır"}</td>
                      <td className="px-2 py-2">{arac.giderHesabi || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {summary && (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              {[
                { label: "Toplam Poliçe", value: formatMoney(summary.toplamPoliceTutari) },
                { label: "Cari Yıl Gideri / 770", value: formatMoney(summary.buDonemGider) },
                { label: "Aynı Yıl Gelecek Ay / 180", value: formatMoney(summary.gelecekAyGider) },
                { label: "Sonraki Mali Yıl / 280", value: formatMoney(summary.gelecekYilGider) },
                { label: "Toplam Kontrol", value: formatMoney(summary.dagitimToplami) },
                { label: "Kabul Edilen", value: formatMoney(summary.kabulEdilenGider) },
                { label: "KKEG", value: formatMoney(summary.kkegTutari) },
                { label: "Poliçe Sayısı", value: `${summary.binekPoliceSayisi}/${summary.ticariPoliceSayisi}` },
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
            {!summary.kontrolEsit ? (
              <div className="mt-4 rounded-xl border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                Poliçe toplamı ile dağıtım toplamı eşleşmiyor.
              </div>
            ) : null}
          </>
        )}

        {(lucaGiderlestirme?.enabled || lucaKkeg?.enabled) && (
          <section className="mt-6 rounded-xl border border-indigo-800/50 bg-indigo-950/20 p-5">
            <h2 className="mb-2 text-lg font-semibold text-indigo-200">Luca Fiş Önerisi</h2>
            <p className="text-sm text-gray-400">
              Giderleştirme ve KKEG fişleri ileride Luca üretimine bağlanmaya hazır. Detay Excel
              raporunda ayrı sayfada.
            </p>
          </section>
        )}

        {previewRows.length > 0 && (
          <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Giderleştirme Önizleme</h2>
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
                    <th className="px-2 py-2">Plaka</th>
                    <th className="px-2 py-2">Poliçe</th>
                    <th className="px-2 py-2">Tarih</th>
                    <th className="px-2 py-2">Dönem</th>
                    <th className="px-2 py-2">Sınıf</th>
                    <th className="px-2 py-2">Giderleşecek</th>
                    <th className="px-2 py-2">Kabul</th>
                    <th className="px-2 py-2">KKEG</th>
                    <th className="px-2 py-2">Hesap</th>
                    <th className="px-2 py-2">KKEG?</th>
                    <th className="px-2 py-2">Açıklama</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-800/80 align-top">
                      <td className="px-2 py-2">{row.plaka}</td>
                      <td className="px-2 py-2">{row.policeNo}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-500">
                        {row.baslangic} – {row.bitis}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.donem}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { donem: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        {row.giderSinifi === "gelecek_yil"
                          ? "280"
                          : row.giderSinifi === "gelecek_ay"
                            ? "180"
                            : "770"}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.giderlesecekTutar}
                          onChange={(event) =>
                            updatePreviewRow(row.id, {
                              giderlesecekTutar: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-emerald-300">
                        {formatMoney(row.kabulEdilenGider)}
                      </td>
                      <td className="px-2 py-2 text-amber-300">{formatMoney(row.kkegTutari)}</td>
                      <td className="px-2 py-2">
                        <input
                          className="w-20 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.giderHesabi}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { giderHesabi: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={row.kkegDurumu !== false}
                          disabled={row.aracTipi === ARAC_TIPI.TICARI}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { kkegDurumu: event.target.checked })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="min-w-48 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.aciklama}
                          onChange={(event) =>
                            updatePreviewRow(row.id, { aciklama: event.target.value })
                          }
                        />
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
