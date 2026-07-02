"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { KDV_KAYNAK, KDV_KONTROL_GRUP, RISK_BAND } from "@/src/config/kdvMatrahKontrolDefaults";
import { normalizeCompanyRecord } from "@/src/utils/companyCenter";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  filterKdvMatrahRows,
  parseFaturaListSheet,
  parseKdvListSheet,
  parseMuavinKdvSheet,
  recalculateKdvMatrahRows,
  runKdvMatrahKontrolPipeline,
} from "@/src/utils/kdvMatrahKontrolEngine";
import { exportKdvMatrahReportWorkbook } from "@/src/utils/kdvMatrahKontrolExport";

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

function riskClass(band) {
  if (band === RISK_BAND.YUKSEK) return "text-red-300";
  if (band === RISK_BAND.KONTROL) return "text-amber-300";
  return "text-emerald-300";
}

function riskBadgeClass(score) {
  if (score >= 70) return "bg-red-900/70 text-red-100";
  if (score >= 31) return "bg-amber-900/70 text-amber-100";
  return "bg-emerald-900/70 text-emerald-100";
}

function grupClass(grup) {
  if (grup === KDV_KONTROL_GRUP.HATASIZ) return "bg-emerald-900/50 text-emerald-200";
  if (
    [KDV_KONTROL_GRUP.KDV_FARKI, KDV_KONTROL_GRUP.ORAN_HATASI, KDV_KONTROL_GRUP.MUKERRER].includes(
      grup
    )
  ) {
    return "bg-red-900/50 text-red-200";
  }
  return "bg-amber-900/50 text-amber-200";
}

async function readExcelSheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

export default function KdvMatrahKontrolPage() {
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

  const [alisFileName, setAlisFileName] = useState("");
  const [satisFileName, setSatisFileName] = useState("");
  const [kdvFileName, setKdvFileName] = useState("");
  const [muavinFileName, setMuavinFileName] = useState("");
  const [alisRows, setAlisRows] = useState([]);
  const [satisRows, setSatisRows] = useState([]);
  const [kdvListRows, setKdvListRows] = useState([]);
  const [muavinRows, setMuavinRows] = useState([]);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [groupCounts, setGroupCounts] = useState([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [activeGroup, setActiveGroup] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);

  const totalUploaded =
    alisRows.length + satisRows.length + kdvListRows.length + muavinRows.length;

  const currentStep = useMemo(() => {
    if (hasAnalyzed && rows.length) return 5;
    if (totalUploaded) return 3;
    if (selectedCompanyId) return 2;
    return 1;
  }, [hasAnalyzed, rows.length, totalUploaded, selectedCompanyId]);

  const displayedRows = useMemo(
    () => filterKdvMatrahRows(rows, { grup: activeGroup, search }),
    [rows, activeGroup, search]
  );

  const showToast = (message, type = "info") => setToast({ message, type });

  const handleAlisUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseFaturaListSheet(await readExcelSheet(file), KDV_KAYNAK.ALIS);
    setAlisRows(parsed);
    setAlisFileName(file.name);
    setHasAnalyzed(false);
    showToast(`${parsed.length} alış faturası okundu.`, "success");
    event.target.value = "";
  };

  const handleSatisUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseFaturaListSheet(await readExcelSheet(file), KDV_KAYNAK.SATIS);
    setSatisRows(parsed);
    setSatisFileName(file.name);
    setHasAnalyzed(false);
    showToast(`${parsed.length} satış faturası okundu.`, "success");
    event.target.value = "";
  };

  const handleKdvUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseKdvListSheet(await readExcelSheet(file));
    setKdvListRows(parsed);
    setKdvFileName(file.name);
    setHasAnalyzed(false);
    showToast(`${parsed.length} KDV listesi satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleMuavinUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseMuavinKdvSheet(await readExcelSheet(file));
    setMuavinRows(parsed);
    setMuavinFileName(file.name);
    setHasAnalyzed(false);
    showToast(`${parsed.length} muavin satırı okundu.`, "success");
    event.target.value = "";
  };

  const handleAnalyze = () => {
    if (!selectedCompanyId) {
      alert("Önce firma seçin.");
      return;
    }

    if (!totalUploaded) {
      alert("En az bir Excel dosyası yükleyin.");
      return;
    }

    const result = runKdvMatrahKontrolPipeline({
      alisRows,
      satisRows,
      kdvListRows,
      muavinRows,
    });

    setRows(result.rows);
    setSummary(result.summary);
    setGroupCounts(result.groupCounts);
    setHasAnalyzed(true);
    showToast(`${result.rows.length} belge kontrol edildi.`, "success");
  };

  const updateRow = (rowId, patch) => {
    setRows((current) => {
      const next = current.map((row) =>
        row.id === rowId ? { ...row, ...patch, manuallyEdited: true } : row
      );
      const result = recalculateKdvMatrahRows(next);
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

    exportKdvMatrahReportWorkbook({
      rows,
      summary: summary || {},
      meta: { firmaAdi: getCompanyDisplayName(selectedCompany) },
      fileName: "kdv-matrah-kontrol",
    });

    showToast("Excel raporu indirildi (5 sayfa).", "success");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <MuhasebeMenu />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            KDV Matrah Kontrol Merkezi
          </h1>
          <p className="mt-2 max-w-3xl text-gray-400">
            Alış/satış faturaları, KDV listeleri ve muavin üzerinden matrah-KDV kontrolü yapın,
            hatalı oranları ve tutarsız kayıtları tespit edin.
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
                <label className="mb-1 block text-sm text-gray-400">Alış Faturaları</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleAlisUpload} />
                {alisFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {alisFileName} — {alisRows.length}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">Satış Faturaları</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleSatisUpload} />
                {satisFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {satisFileName} — {satisRows.length}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">KDV Listesi</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleKdvUpload} />
                {kdvFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {kdvFileName} — {kdvListRows.length}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">Muavin (opsiyonel)</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleMuavinUpload} />
                {muavinFileName && (
                  <p className="mt-1 text-xs text-gray-500">
                    {muavinFileName} — {muavinRows.length}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleAnalyze}
              className="mt-4 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold hover:bg-emerald-500"
            >
              KDV Kontrolü Çalıştır
            </button>
          </section>
        </div>

        {summary && (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Toplam Belge", value: summary.toplamBelge },
              { label: "Hatasız", value: summary.hatasizBelge },
              { label: "Riskli", value: summary.riskliBelge },
              { label: "KDV Farkı Toplamı", value: formatMoney(summary.kdvFarkiToplami) },
              { label: "Mükerrer Risk", value: summary.mukerrerRiskSayisi },
              { label: "Eksik Bilgi", value: summary.eksikBilgiSayisi },
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
                    <th className="px-2 py-2">Belge</th>
                    <th className="px-2 py-2">Cari</th>
                    <th className="px-2 py-2">Matrah</th>
                    <th className="px-2 py-2">Oran</th>
                    <th className="px-2 py-2">KDV</th>
                    <th className="px-2 py-2">Toplam</th>
                    <th className="px-2 py-2">Grup</th>
                    <th className="px-2 py-2">Risk</th>
                    <th className="px-2 py-2">Sorunlar</th>
                    <th className="px-2 py-2">Düzenle</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-800/80 align-top">
                      <td className="px-2 py-2 whitespace-nowrap">{row.tarih}</td>
                      <td className="px-2 py-2">
                        <input
                          className="w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.belgeNo}
                          onChange={(event) =>
                            updateRow(row.id, { belgeNo: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="min-w-32 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.cariUnvan}
                          onChange={(event) =>
                            updateRow(row.id, { cariUnvan: event.target.value })
                          }
                        />
                        <div className="mt-1 text-xs text-gray-500">{row.vergiNo || "—"}</div>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.matrah}
                          onChange={(event) =>
                            updateRow(row.id, { matrah: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-16 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.kdvOrani}
                          onChange={(event) =>
                            updateRow(row.id, { kdvOrani: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="w-24 rounded border border-gray-700 bg-gray-950 px-2 py-1"
                          value={row.kdvTutari}
                          onChange={(event) =>
                            updateRow(row.id, { kdvTutari: event.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">{formatMoney(row.toplamTutar)}</td>
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
                          value={row.aciklama}
                          placeholder="Açıklama"
                          onChange={(event) =>
                            updateRow(row.id, { aciklama: event.target.value })
                          }
                        />
                        <input
                          className="mb-1 min-w-28 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs"
                          value={row.kontrolDurumu}
                          placeholder="Kontrol durumu"
                          onChange={(event) =>
                            updateRow(row.id, { kontrolDurumu: event.target.value })
                          }
                        />
                        <label className="flex items-center gap-1 text-xs text-gray-500">
                          <input
                            type="checkbox"
                            checked={row.disaridaBirak}
                            onChange={(event) =>
                              updateRow(row.id, { disaridaBirak: event.target.checked })
                            }
                          />
                          Dışarıda bırak
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
