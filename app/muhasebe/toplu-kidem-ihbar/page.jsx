"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { FLOW_STEPS } from "@/src/config/kidemIhbarBulkDefaults";
import { DEFAULT_SEVERANCE_YEAR } from "@/src/config/severanceNoticeParameters";
import { normalizeCompanyRecord } from "@/src/utils/companyCenter";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  createEmptyPersonelRow,
  filterBulkRows,
  parsePersonelBulkSheet,
  recalculateBulkRows,
  runKidemIhbarBulkPipeline,
} from "@/src/utils/kidemIhbarBulkEngine";
import {
  downloadPersonelBulkTemplate,
  exportKidemIhbarBulkWorkbook,
} from "@/src/utils/kidemIhbarBulkExport";
import { loadSeveranceParamsForBulk } from "@/src/utils/kidemIhbarParametreleri";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

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

export default function TopluKidemIhbarPage() {
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

  const [paramSource, setParamSource] = useState("seed");
  const [globalCeiling, setGlobalCeiling] = useState("");
  const [paramsOverride, setParamsOverride] = useState(null);

  const [uploadFileName, setUploadFileName] = useState("");
  const [sourceRows, setSourceRows] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [hasCalculated, setHasCalculated] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);

  const [singleDraft, setSingleDraft] = useState(createEmptyPersonelRow(0));

  const globalParams = useMemo(
    () => ({
      year: DEFAULT_SEVERANCE_YEAR,
      severancePayCeiling: Number(globalCeiling) || paramsOverride?.severancePayCeiling || 0,
      paramsOverride,
      paramSource,
    }),
    [globalCeiling, paramsOverride, paramSource]
  );

  const currentStep = useMemo(() => {
    if (hasCalculated && rows.length) return 5;
    if (sourceRows.length) return 4;
    if (paramsOverride) return 3;
    if (selectedCompanyId) return 2;
    return 1;
  }, [hasCalculated, rows.length, sourceRows.length, paramsOverride, selectedCompanyId]);

  const displayedRows = useMemo(() => filterBulkRows(rows, search), [rows, search]);

  const showToast = (message, type = "info") => setToast({ message, type });

  useEffect(() => {
    loadSeveranceParamsForBulk(DEFAULT_SEVERANCE_YEAR).then(({ params, source }) => {
      setParamsOverride(params);
      setParamSource(source);
      if (params.severancePayCeiling > 0) {
        setGlobalCeiling(String(params.severancePayCeiling));
      }
    });
  }, []);

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const parsed = parsePersonelBulkSheet(await readExcelSheet(file));
    setSourceRows(parsed);
    setUploadFileName(file.name);
    setRows([]);
    setSummary(null);
    setHasCalculated(false);
    showToast(`${parsed.length} personel satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleAddSingle = () => {
    if (!singleDraft.adSoyad.trim()) {
      alert("Tekli hesaplama için ad soyad girin.");
      return;
    }

    setSourceRows((current) => [
      ...current,
      { ...singleDraft, id: `personel-manuel-${Date.now()}` },
    ]);
    setSingleDraft(createEmptyPersonelRow(0));
    setHasCalculated(false);
    showToast("Personel listeye eklendi.", "success");
  };

  const handleCalculate = () => {
    if (!selectedCompanyId) {
      alert("Önce firma seçin.");
      return;
    }

    if (!sourceRows.length) {
      alert("Excel yükleyin veya tekli personel ekleyin.");
      return;
    }

    const result = runKidemIhbarBulkPipeline(sourceRows, globalParams);
    setRows(result.rows);
    setSummary(result.summary);
    setHasCalculated(true);
    showToast(`${result.summary.basariliPersonel} personel hesaplandı.`, "success");
  };

  const updateRow = (rowId, patch) => {
    setRows((current) => {
      const nextSource = current.map((row) =>
        row.id === rowId ? { ...row, ...patch, manuallyEdited: true } : row
      );
      const result = recalculateBulkRows(nextSource, globalParams);
      setSummary(result.summary);
      setSourceRows(result.rows);
      return result.rows;
    });
  };

  const handleExport = () => {
    if (!rows.length) {
      alert("Önce hesaplama çalıştırın.");
      return;
    }

    exportKidemIhbarBulkWorkbook({
      rows,
      summary: summary || {},
      meta: {
        firmaAdi: getCompanyDisplayName(selectedCompany),
        paramSource,
      },
      fileName: "toplu-kidem-ihbar",
    });

    showToast("Excel raporu indirildi (3 sayfa).", "success");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Toplu Kıdem ve İhbar Tazminatı Hesaplama
          </h1>
          <p className="mt-2 max-w-3xl text-gray-400">
            Excel personel listesi veya tekli giriş ile çoklu personel için kıdem, ihbar, vergi ve
            net ödeme hesaplaması yapın.
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
            <h2 className="mb-4 text-lg font-semibold">Firma</h2>
            <select
              className={inputClassName}
              value={selectedCompanyId}
              onChange={(event) => setSelectedCompanyId(event.target.value)}
            >
              <CompanySelectOptions companies={companies} placeholder="Firma seçin" />
            </select>
          </section>

          <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold">Mevzuat Parametreleri</h2>
            <p className="mb-3 text-xs text-gray-500">Kaynak: {paramSource}</p>
            <label className="block">
              <span className="mb-1 block text-sm text-gray-400">Kıdem Tavanı (global, TL)</span>
              <input
                className={inputClassName}
                value={globalCeiling}
                onChange={(event) => setGlobalCeiling(event.target.value)}
                placeholder="Boş bırakılırsa satır bazlı tavan kullanılır"
              />
            </label>
          </section>
        </div>

        <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <h2 className="mb-4 text-lg font-semibold">Personel Yükleme</h2>
          <div className="flex flex-wrap gap-3">
            <input type="file" accept=".xlsx,.xls" onChange={handleUpload} />
            <button
              type="button"
              onClick={() => downloadPersonelBulkTemplate()}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800"
            >
              Excel Şablonu İndir
            </button>
          </div>
          {uploadFileName ? (
            <p className="mt-2 text-xs text-gray-500">
              {uploadFileName} — {sourceRows.length} satır
            </p>
          ) : null}
        </section>

        <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <h2 className="mb-4 text-lg font-semibold">Tekli Personel Ekle</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              className={inputClassName}
              placeholder="Ad Soyad"
              value={singleDraft.adSoyad}
              onChange={(event) => setSingleDraft((c) => ({ ...c, adSoyad: event.target.value }))}
            />
            <input
              className={inputClassName}
              type="date"
              value={singleDraft.iseGirisTarihi}
              onChange={(event) =>
                setSingleDraft((c) => ({ ...c, iseGirisTarihi: event.target.value }))
              }
            />
            <input
              className={inputClassName}
              type="date"
              value={singleDraft.istenCikisTarihi}
              onChange={(event) =>
                setSingleDraft((c) => ({ ...c, istenCikisTarihi: event.target.value }))
              }
            />
            <input
              className={inputClassName}
              placeholder="Brüt ücret"
              value={singleDraft.brutUcret || ""}
              onChange={(event) =>
                setSingleDraft((c) => ({ ...c, brutUcret: Number(event.target.value) || 0 }))
              }
            />
            <input
              className={inputClassName}
              placeholder="Yemek yardımı"
              value={singleDraft.yemekYardimi || ""}
              onChange={(event) =>
                setSingleDraft((c) => ({ ...c, yemekYardimi: Number(event.target.value) || 0 }))
              }
            />
            <input
              className={inputClassName}
              placeholder="Yol yardımı"
              value={singleDraft.yolYardimi || ""}
              onChange={(event) =>
                setSingleDraft((c) => ({ ...c, yolYardimi: Number(event.target.value) || 0 }))
              }
            />
            <input
              className={inputClassName}
              placeholder="Düzenli yan haklar"
              value={singleDraft.duzenliYanHaklar || ""}
              onChange={(event) =>
                setSingleDraft((c) => ({
                  ...c,
                  duzenliYanHaklar: Number(event.target.value) || 0,
                }))
              }
            />
            <input
              className={inputClassName}
              placeholder="Çıkış nedeni"
              value={singleDraft.cikisNedeni}
              onChange={(event) =>
                setSingleDraft((c) => ({ ...c, cikisNedeni: event.target.value }))
              }
            />
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={singleDraft.ihbarKullandirildi}
                onChange={(event) =>
                  setSingleDraft((c) => ({ ...c, ihbarKullandirildi: event.target.checked }))
                }
              />
              İhbar kullandırıldı
            </label>
          </div>
          <button
            type="button"
            onClick={handleAddSingle}
            className="mt-4 rounded-lg border border-indigo-600 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-950/40"
          >
            Listeye Ekle
          </button>
        </section>

        <div className="mt-6">
          <button
            type="button"
            onClick={handleCalculate}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold hover:bg-emerald-500"
          >
            Toplu Hesaplama Çalıştır
          </button>
        </div>

        {summary && (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Personel Sayısı", value: summary.personelSayisi },
              { label: "Toplam Kıdem", value: formatMoney(summary.toplamKidem) },
              { label: "Toplam İhbar", value: formatMoney(summary.toplamIhbar) },
              { label: "Toplam Vergi", value: formatMoney(summary.toplamVergi) },
              { label: "Toplam Net Ödeme", value: formatMoney(summary.toplamNetOdeme) },
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

        {rows.length > 0 && (
          <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Hesaplama Önizleme</h2>
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${inputClassName} max-w-xs`}
                  placeholder="Ara..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button
                  type="button"
                  onClick={handleExport}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
                >
                  Excel Rapor
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-800 text-gray-400">
                  <tr>
                    <th className="px-2 py-2">Personel</th>
                    <th className="px-2 py-2">Tarihler</th>
                    <th className="px-2 py-2">Ücret</th>
                    <th className="px-2 py-2">Çalışma</th>
                    <th className="px-2 py-2">Kıdem</th>
                    <th className="px-2 py-2">İhbar</th>
                    <th className="px-2 py-2">Vergi</th>
                    <th className="px-2 py-2">Net</th>
                    <th className="px-2 py-2">Durum</th>
                    <th className="px-2 py-2">Düzenle</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`border-b border-gray-800/80 align-top ${
                        row.hasError ? "bg-red-950/20" : ""
                      }`}
                    >
                      <td className="px-2 py-2">
                        <input
                          className="min-w-28 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.adSoyad}
                          onChange={(event) =>
                            updateRow(row.id, { adSoyad: event.target.value })
                          }
                        />
                        <div className="mt-1 text-xs text-gray-500">{row.tcKimlikNo || "—"}</div>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="date"
                          className="mb-1 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.iseGirisTarihi}
                          onChange={(event) =>
                            updateRow(row.id, { iseGirisTarihi: event.target.value })
                          }
                        />
                        <input
                          type="date"
                          className="rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.istenCikisTarihi}
                          onChange={(event) =>
                            updateRow(row.id, { istenCikisTarihi: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="mb-1 w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.brutUcret}
                          onChange={(event) =>
                            updateRow(row.id, { brutUcret: Number(event.target.value) || 0 })
                          }
                        />
                        <input
                          className="mb-1 w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          placeholder="Yemek"
                          value={row.yemekYardimi}
                          onChange={(event) =>
                            updateRow(row.id, { yemekYardimi: Number(event.target.value) || 0 })
                          }
                        />
                        <input
                          className="w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          placeholder="Yol"
                          value={row.yolYardimi}
                          onChange={(event) =>
                            updateRow(row.id, { yolYardimi: Number(event.target.value) || 0 })
                          }
                        />
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{row.calismaSuresi || "—"}</td>
                      <td className="px-2 py-2">{formatMoney(row.kidemTazminati)}</td>
                      <td className="px-2 py-2">{formatMoney(row.ihbarTazminati)}</td>
                      <td className="px-2 py-2">{formatMoney(row.toplamVergi)}</td>
                      <td className="px-2 py-2 font-semibold text-emerald-300">
                        {formatMoney(row.netOdeme)}
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-400 max-w-xs">
                        {(row.errors || []).join(" ")}
                        {(row.warnings || []).join(" ")}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="mb-1 min-w-28 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs"
                          placeholder="Çıkış nedeni"
                          value={row.cikisNedeni}
                          onChange={(event) =>
                            updateRow(row.id, { cikisNedeni: event.target.value })
                          }
                        />
                        <label className="mb-1 flex items-center gap-1 text-xs text-gray-500">
                          <input
                            type="checkbox"
                            checked={row.ihbarKullandirildi}
                            onChange={(event) =>
                              updateRow(row.id, { ihbarKullandirildi: event.target.checked })
                            }
                          />
                          İhbar kullandırıldı
                        </label>
                        <input
                          className="mb-1 w-20 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs"
                          placeholder="İzin gün"
                          value={row.kullanilmayanIzinGunu}
                          onChange={(event) =>
                            updateRow(row.id, {
                              kullanilmayanIzinGunu: Number(event.target.value) || 0,
                            })
                          }
                        />
                        <input
                          className="mb-1 w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs"
                          placeholder="Yan hak"
                          value={row.duzenliYanHaklar}
                          onChange={(event) =>
                            updateRow(row.id, {
                              duzenliYanHaklar: Number(event.target.value) || 0,
                            })
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
