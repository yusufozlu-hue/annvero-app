"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { E_DEFTER_KONTROL_GRUP } from "@/src/config/eDefterKontrolDefaults";
import { normalizeCompanyRecord } from "@/src/utils/companyCenter";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  filterEDefterRows,
  parseEDefterListeSheet,
  parseMizanSheet,
  parseMuavinSheet,
  parseYevmiyeSheet,
  recalculateEDefterRows,
  runEDefterKontrolPipeline,
} from "@/src/utils/eDefterKontrolEngine";
import { exportEDefterReportWorkbook } from "@/src/utils/eDefterKontrolExport";

const inputClassName =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none focus:border-indigo-500";

const FLOW_STEPS = [
  "Firma seç",
  "Dosya yükle",
  "Kontrol çalıştır",
  "Önizleme",
  "Rapor export",
];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function riskBadgeClass(score) {
  if (score >= 70) return "bg-red-900/70 text-red-100";
  if (score >= 31) return "bg-amber-900/70 text-amber-100";
  return "bg-emerald-900/70 text-emerald-100";
}

function grupClass(grup) {
  if (grup === E_DEFTER_KONTROL_GRUP.HATASIZ) return "bg-emerald-900/50 text-emerald-200";
  if (
    [E_DEFTER_KONTROL_GRUP.KRITIK, E_DEFTER_KONTROL_GRUP.MUKERRER, E_DEFTER_KONTROL_GRUP.TERS_BAKIYE].includes(
      grup
    )
  ) {
    return "bg-red-900/50 text-red-200";
  }
  if (grup === E_DEFTER_KONTROL_GRUP.KDV_KONTROL) return "bg-purple-900/50 text-purple-200";
  if (grup === E_DEFTER_KONTROL_GRUP.DONEM_SONU) return "bg-blue-900/50 text-blue-200";
  return "bg-amber-900/50 text-amber-200";
}

async function readExcelSheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

export default function EDefterKontrolPage() {
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

  const [muavinFileName, setMuavinFileName] = useState("");
  const [yevmiyeFileName, setYevmiyeFileName] = useState("");
  const [mizanFileName, setMizanFileName] = useState("");
  const [edefterFileName, setEdefterFileName] = useState("");
  const [muavinRows, setMuavinRows] = useState([]);
  const [yevmiyeRows, setYevmiyeRows] = useState([]);
  const [mizanRows, setMizanRows] = useState([]);
  const [edefterListeRows, setEdefterListeRows] = useState([]);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [groupCounts, setGroupCounts] = useState([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [activeGroup, setActiveGroup] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);

  const totalUploaded =
    muavinRows.length + yevmiyeRows.length + mizanRows.length + edefterListeRows.length;

  const currentStep = useMemo(() => {
    if (hasAnalyzed && rows.length) return 5;
    if (totalUploaded) return 3;
    if (selectedCompanyId) return 2;
    return 1;
  }, [hasAnalyzed, rows.length, totalUploaded, selectedCompanyId]);

  const displayedRows = useMemo(
    () => filterEDefterRows(rows, { grup: activeGroup, search }),
    [rows, activeGroup, search]
  );

  const showToast = (message, type = "info") => setToast({ message, type });

  const handleMuavinUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseMuavinSheet(await readExcelSheet(file));
    setMuavinRows(parsed);
    setMuavinFileName(file.name);
    setHasAnalyzed(false);
    showToast(`${parsed.length} muavin satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleYevmiyeUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseYevmiyeSheet(await readExcelSheet(file));
    setYevmiyeRows(parsed);
    setYevmiyeFileName(file.name);
    setHasAnalyzed(false);
    showToast(`${parsed.length} yevmiye satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleMizanUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseMizanSheet(await readExcelSheet(file));
    setMizanRows(parsed);
    setMizanFileName(file.name);
    setHasAnalyzed(false);
    showToast(`${parsed.length} mizan satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleEdefterUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseEDefterListeSheet(await readExcelSheet(file));
    setEdefterListeRows(parsed);
    setEdefterFileName(file.name);
    setHasAnalyzed(false);
    showToast(`${parsed.length} e-defter kontrol satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleAnalyze = () => {
    if (!selectedCompanyId) {
      alert("Önce firma seçin.");
      return;
    }

    if (!muavinRows.length && !yevmiyeRows.length) {
      alert("En az muavin veya yevmiye Excel dosyası yükleyin.");
      return;
    }

    const result = runEDefterKontrolPipeline({
      muavinRows,
      yevmiyeRows,
      mizanRows,
      edefterListeRows,
    });

    setRows(result.rows);
    setSummary(result.summary);
    setGroupCounts(result.groupCounts);
    setHasAnalyzed(true);
    showToast(`${result.rows.length} kayıt kontrol edildi.`, "success");
  };

  const updateRow = (rowId, patch) => {
    setRows((current) => {
      const next = current.map((row) =>
        row.id === rowId ? { ...row, ...patch, manuallyEdited: true } : row
      );
      const result = recalculateEDefterRows(next);
      setSummary(result.summary);
      setGroupCounts(result.groupCounts);
      return result.rows;
    });
  };

  const handleExport = () => {
    if (!rows.length) {
      alert("Önce kontrol çalıştırın.");
      return;
    }

    exportEDefterReportWorkbook({
      rows,
      summary: summary || {},
      meta: { firmaAdi: getCompanyDisplayName(selectedCompany) },
      fileName: "e-defter-kontrol",
    });

    showToast("Excel raporu indirildi (6 sayfa).", "success");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <MuhasebeMenu />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            E-Defter Kontrol Merkezi
          </h1>
          <p className="mt-2 max-w-3xl text-gray-400">
            E-defter berat öncesi muavin, yevmiye ve mizan kayıtlarını kontrol edin; riskli
            fişleri, ters bakiyeleri ve dönem sonu eksiklerini tespit edin.
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
            <h2 className="mb-4 text-lg font-semibold">Dosya Yükleme</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-gray-400">Muavin Excel</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleMuavinUpload} />
                {muavinFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {muavinFileName} — {muavinRows.length}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">Yevmiye Excel</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleYevmiyeUpload} />
                {yevmiyeFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {yevmiyeFileName} — {yevmiyeRows.length}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">Mizan Excel (opsiyonel)</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleMizanUpload} />
                {mizanFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {mizanFileName} — {mizanRows.length}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">
                  E-defter Kontrol Listesi (opsiyonel)
                </label>
                <input type="file" accept=".xlsx,.xls" onChange={handleEdefterUpload} />
                {edefterFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {edefterFileName} — {edefterListeRows.length}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleAnalyze}
              className="mt-4 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold hover:bg-emerald-500"
            >
              E-Defter Kontrolü Çalıştır
            </button>
          </section>
        </div>

        {summary && (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {[
              { label: "Toplam Fiş", value: summary.toplamFis },
              { label: "Toplam Satır", value: summary.toplamSatir },
              { label: "Kritik Hata", value: summary.kritikHata },
              { label: "Yüksek Risk", value: summary.yuksekRisk },
              { label: "Mükerrer Risk", value: summary.mukerrerRisk },
              { label: "Ters Bakiye", value: summary.tersBakiye },
              { label: "Eksik Bilgi", value: summary.eksikBilgi },
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

        {groupCounts.length > 0 && (
          <section className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveGroup("")}
              className={`rounded-full px-3 py-1 text-xs ${
                !activeGroup
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              Tümü ({rows.filter((r) => !r.disaridaBirak).length})
            </button>
            {groupCounts.map(({ grup, count }) => (
              <button
                key={grup}
                type="button"
                onClick={() => setActiveGroup(grup)}
                className={`rounded-full px-3 py-1 text-xs ${
                  activeGroup === grup
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {grup} ({count})
              </button>
            ))}
          </section>
        )}

        {rows.length > 0 && (
          <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Kontrol Önizleme</h2>
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
                    <th className="px-2 py-2">Tarih</th>
                    <th className="px-2 py-2">Fiş No</th>
                    <th className="px-2 py-2">Yevmiye</th>
                    <th className="px-2 py-2">Hesap</th>
                    <th className="px-2 py-2">Açıklama</th>
                    <th className="px-2 py-2">Belge</th>
                    <th className="px-2 py-2">Borç</th>
                    <th className="px-2 py-2">Alacak</th>
                    <th className="px-2 py-2">Grup</th>
                    <th className="px-2 py-2">Risk</th>
                    <th className="px-2 py-2">Sorunlar</th>
                    <th className="px-2 py-2">Düzenle</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-800/80 align-top">
                      <td className="px-2 py-2 whitespace-nowrap">{row.tarih || "—"}</td>
                      <td className="px-2 py-2">{row.fisNo || "—"}</td>
                      <td className="px-2 py-2">{row.yevmiyeNo || "—"}</td>
                      <td className="px-2 py-2">
                        <div>{row.hesapKodu || "—"}</div>
                        <div className="text-xs text-gray-500">{row.hesapAdi || ""}</div>
                      </td>
                      <td className="px-2 py-2 max-w-xs">{row.aciklama || "—"}</td>
                      <td className="px-2 py-2">
                        <div>{row.belgeTuru || "—"}</div>
                        <div className="text-xs text-gray-500">{row.belgeNo || ""}</div>
                      </td>
                      <td className="px-2 py-2">{formatMoney(row.borc)}</td>
                      <td className="px-2 py-2">{formatMoney(row.alacak)}</td>
                      <td className="px-2 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${grupClass(row.grup)}`}>
                          {row.grup}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${riskBadgeClass(row.riskScore)}`}
                        >
                          {row.riskScore} — {row.riskBand}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-400 max-w-xs">
                        {(row.issues || []).join(" ")}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="mb-1 min-w-28 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs"
                          value={row.kontrolDurumu}
                          placeholder="Kontrol durumu"
                          onChange={(event) =>
                            updateRow(row.id, { kontrolDurumu: event.target.value })
                          }
                        />
                        <input
                          className="mb-1 min-w-28 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs"
                          value={row.not}
                          placeholder="Açıklama / not"
                          onChange={(event) => updateRow(row.id, { not: event.target.value })}
                        />
                        <label className="mb-1 flex items-center gap-1 text-xs text-gray-500">
                          <input
                            type="checkbox"
                            checked={row.duzeltildiMi}
                            onChange={(event) =>
                              updateRow(row.id, { duzeltildiMi: event.target.checked })
                            }
                          />
                          Düzeltildi
                        </label>
                        <label className="flex items-center gap-1 text-xs text-gray-500">
                          <input
                            type="checkbox"
                            checked={row.disaridaBirak}
                            onChange={(event) =>
                              updateRow(row.id, { disaridaBirak: event.target.checked })
                            }
                          />
                          Hariç tut
                        </label>
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
