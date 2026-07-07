"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import {
  E_DEFTER_FINDING_STATUS,
  E_DEFTER_HATA_TURU,
  E_DEFTER_KONTROL_GRUP,
  E_DEFTER_KONTROL_STATUS,
  E_DEFTER_RISK_LEVEL,
  riskLevelBadgeClass,
} from "@/src/config/eDefterKontrolDefaults";
import { normalizeCompanyRecord } from "@/src/utils/companyCenter";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  buildEDefterUploadRecord,
  filterEDefterRows,
  loadEDefterKontrolRecords,
  parseEDefterListeSheet,
  parseMizanSheet,
  parseMuavinSheet,
  parseYevmiyeSheet,
  recalculateEDefterRows,
  runEDefterKontrolPipeline,
  saveEDefterKontrolRecords,
} from "@/src/utils/eDefterKontrolEngine";
import {
  exportEDefterReportWorkbook,
  prepareEDefterPdfReport,
} from "@/src/utils/eDefterKontrolExport";
import { parseEDefterUploadFile } from "@/src/utils/eDefterXmlParser";
import {
  logExcelError,
  logXmlError,
  SYSTEM_ERROR_TYPES,
} from "@/src/utils/systemLogEngine";
import AnnveroDataTable from "@/src/components/AnnveroDataTable";

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20";

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

function grupClass(grup) {
  if (grup === E_DEFTER_KONTROL_GRUP.HATASIZ) return "bg-emerald-900/50 text-emerald-200";
  if ([E_DEFTER_KONTROL_GRUP.KRITIK, E_DEFTER_KONTROL_GRUP.TEKNIK].includes(grup)) {
    return "bg-red-900/50 text-red-200";
  }
  if (grup === E_DEFTER_KONTROL_GRUP.VERGISEL) return "bg-purple-900/50 text-purple-200";
  return "bg-amber-900/50 text-amber-200";
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

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [records, setRecords] = useState(() => loadEDefterKontrolRecords());

  const [muavinRows, setMuavinRows] = useState([]);
  const [yevmiyeRows, setYevmiyeRows] = useState([]);
  const [mizanRows, setMizanRows] = useState([]);
  const [edefterListeRows, setEdefterListeRows] = useState([]);
  const [xmlRows, setXmlRows] = useState([]);
  const [technicalFindings, setTechnicalFindings] = useState([]);
  const [uploadMeta, setUploadMeta] = useState(null);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [groupCounts, setGroupCounts] = useState([]);
  const [activeGroup, setActiveGroup] = useState("");
  const [search, setSearch] = useState("");
  const [riskLevelFilter, setRiskLevelFilter] = useState("Tümü");
  const [hataTuruFilter, setHataTuruFilter] = useState("Tümü");
  const [cozumFilter, setCozumFilter] = useState("Tümü");
  const [expandedId, setExpandedId] = useState("");
  const [toast, setToast] = useState("");

  const period = `${year}/${month}`;
  const companyRecords = useMemo(
    () => records.filter((record) => !selectedCompanyId || record.companyId === selectedCompanyId),
    [records, selectedCompanyId]
  );

  const displayedRows = useMemo(
    () =>
      filterEDefterRows(rows, {
        grup: activeGroup,
        search,
        riskLevel: riskLevelFilter,
        hataTuru: hataTuruFilter,
        cozumDurumu: cozumFilter,
      }),
    [rows, activeGroup, search, riskLevelFilter, hataTuruFilter, cozumFilter]
  );

  const persistRecord = (record) => {
    const next = [record, ...records.filter((item) => item.id !== record.id)];
    setRecords(next);
    saveEDefterKontrolRecords(next);
  };

  const handleXmlUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseEDefterUploadFile(file);
      setXmlRows(parsed.rows);
      setTechnicalFindings(parsed.technicalFindings);
      setUploadMeta(parsed);
      setToast(`${parsed.rows.length} XML satırı, ${parsed.technicalFindings.length} teknik bulgu okundu.`);
    } catch (error) {
      logXmlError(error.message || "XML/ZIP okunamadı.", { stack: error?.stack }, selectedCompanyId, {
        fileName: file.name,
        companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
        errorType: SYSTEM_ERROR_TYPES.CORRUPT_XML,
        module: "XML / e-Defter",
      });
      setToast(error.message || "XML/ZIP okunamadı.");
    }
    event.target.value = "";
  };

  const handleMuavinUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setMuavinRows(parseMuavinSheet(await readExcelSheet(file)));
      setToast("Muavin Excel yüklendi.");
    } catch (error) {
      logExcelError(error.message || "Muavin Excel okunamadı.", { stack: error?.stack }, selectedCompanyId, {
        fileName: file.name,
        errorType: SYSTEM_ERROR_TYPES.CORRUPT_EXCEL,
        module: "XML / e-Defter",
      });
      setToast(error.message || "Muavin Excel okunamadı.");
    }
    event.target.value = "";
  };

  const handleYevmiyeUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setYevmiyeRows(parseYevmiyeSheet(await readExcelSheet(file)));
    setToast("Yevmiye Excel yüklendi.");
    event.target.value = "";
  };

  const handleMizanUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMizanRows(parseMizanSheet(await readExcelSheet(file)));
    setToast("Mizan Excel yüklendi.");
    event.target.value = "";
  };

  const handleEdefterUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setEdefterListeRows(parseEDefterListeSheet(await readExcelSheet(file)));
    setToast("E-defter liste Excel yüklendi.");
    event.target.value = "";
  };

  const handleAnalyze = () => {
    if (!selectedCompanyId) {
      setToast("Önce firma seçin.");
      return;
    }
    if (!muavinRows.length && !yevmiyeRows.length && !xmlRows.length) {
      setToast("En az muavin, yevmiye veya XML/ZIP dosyası yükleyin.");
      return;
    }

    const result = runEDefterKontrolPipeline({
      muavinRows,
      yevmiyeRows,
      mizanRows,
      edefterListeRows,
      xmlRows,
      technicalFindings,
      companyId: selectedCompanyId,
      period,
    });

    setRows(result.rows);
    setSummary(result.summary);
    setGroupCounts(result.groupCounts);

    persistRecord(
      buildEDefterUploadRecord({
        companyId: selectedCompanyId,
        year,
        month,
        period,
        defterType: uploadMeta?.defterType || "Excel/XML",
        fileName: uploadMeta?.fileName || "excel-yukleme",
        controlStatus: E_DEFTER_KONTROL_STATUS.TAMAMLANDI,
        errorCount: result.summary.kritikHata + result.summary.teknikHata,
        warningCount: result.summary.uyariSayisi,
        uploadedAt: new Date().toISOString(),
      })
    );

    setToast(`${result.rows.length} kayıt kontrol edildi.`);
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
      setToast("Önce kontrol çalıştırın.");
      return;
    }
    exportEDefterReportWorkbook({
      rows,
      summary: summary || {},
      meta: { firmaAdi: getCompanyDisplayName(selectedCompany), donem: period },
      fileName: "e-defter-kontrol",
    });
    setToast("Excel raporu indirildi.");
  };

  const handlePdf = () => {
    setToast(prepareEDefterPdfReport().message);
  };

  return (
    <main className="min-h-screen bg-[#050816] px-4 py-6 text-white sm:px-6 lg:px-8">
      {toast ? (
        <div className="fixed right-4 top-4 z-[9999] rounded-xl border border-indigo-500/40 bg-indigo-950/95 px-4 py-3 text-sm font-medium text-indigo-100 shadow-xl">
          {toast}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300/80">
            E-Defter
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">E-Defter Kontrol Merkezi</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400 sm:text-base">
            Yevmiye/kebir XML, berat ve ZIP dosyalarını analiz ederek teknik, muhasebesel ve vergisel
            hataları berat öncesi tespit edin.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleAnalyze}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40"
          >
            Kontrol Çalıştır
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-white/10"
          >
            Excel İndir
          </button>
          <button
            type="button"
            onClick={handlePdf}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-gray-400 hover:bg-white/10"
          >
            PDF (Yakında)
          </button>
        </div>
      </div>

      {summary ? (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Yüklenen Defter" value={summary.yuklenenDefterSayisi} />
          <StatCard label="Kritik Hata" value={summary.kritikHata} tone="red" />
          <StatCard label="Uyarı" value={summary.uyariSayisi} tone="amber" />
          <StatCard label="Teknik Hata" value={summary.teknikHata} />
          <StatCard label="Vergisel Risk" value={summary.vergiselRisk} tone="purple" />
        </div>
      ) : null}

      <section className="mb-6 rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <h2 className="mb-4 text-xl font-semibold">Firma ve Dönem</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Firma">
            <select
              value={selectedCompanyId}
              onChange={(event) => setSelectedCompanyId(event.target.value)}
              className={inputClassName}
            >
              <option value="">Firma seçin</option>
              <CompanySelectOptions companies={companies} />
            </select>
          </Field>
          <Field label="Yıl">
            <input value={year} onChange={(event) => setYear(event.target.value)} className={inputClassName} />
          </Field>
          <Field label="Ay">
            <input value={month} onChange={(event) => setMonth(event.target.value)} className={inputClassName} />
          </Field>
          <Field label="Dönem">
            <input value={period} readOnly className={inputClassName} />
          </Field>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <h2 className="mb-4 text-xl font-semibold">Dosya Yükleme</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Yevmiye / Kebir XML veya ZIP">
            <input type="file" accept=".xml,.zip" onChange={handleXmlUpload} className={inputClassName} />
          </Field>
          <Field label="Muavin Excel">
            <input type="file" accept=".xlsx,.xls" onChange={handleMuavinUpload} className={inputClassName} />
          </Field>
          <Field label="Yevmiye Excel">
            <input type="file" accept=".xlsx,.xls" onChange={handleYevmiyeUpload} className={inputClassName} />
          </Field>
          <Field label="Mizan Excel">
            <input type="file" accept=".xlsx,.xls" onChange={handleMizanUpload} className={inputClassName} />
          </Field>
          <Field label="E-defter Liste Excel">
            <input type="file" accept=".xlsx,.xls" onChange={handleEdefterUpload} className={inputClassName} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          XML: {xmlRows.length} satır · Teknik bulgu: {technicalFindings.length} · Muavin: {muavinRows.length} ·
          Yevmiye: {yevmiyeRows.length} · Mizan: {mizanRows.length}
        </p>
      </section>

      {companyRecords.length > 0 ? (
        <section className="mb-6 rounded-2xl border border-white/10 bg-gray-900/70 p-5">
          <h2 className="mb-4 text-xl font-semibold">Yükleme Kayıtları</h2>
          <AnnveroDataTable
            showToolbar={false}
            pageSize={15}
            exportFilename="edefter-yukleme-kayitlari.csv"
            rows={companyRecords}
            columns={[
              { key: "period", label: "Dönem", filterable: true },
              { key: "defterType", label: "Defter Türü", filterable: true },
              {
                key: "uploadedAt",
                label: "Yükleme",
                sortValue: (row) => row.uploadedAt,
                render: (row) => new Date(row.uploadedAt).toLocaleString("tr-TR"),
              },
              { key: "controlStatus", label: "Durum", filterable: true },
              { key: "errorCount", label: "Hata", sortable: true },
              { key: "warningCount", label: "Uyarı", sortable: true },
            ]}
          />
        </section>
      ) : null}

      <section className="mb-4 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Ara..."
          className={`${inputClassName} max-w-sm`}
        />
        <select
          value={riskLevelFilter}
          onChange={(event) => setRiskLevelFilter(event.target.value)}
          className={`${inputClassName} max-w-[180px]`}
        >
          <option value="Tümü">Tüm Riskler</option>
          {Object.values(E_DEFTER_RISK_LEVEL).map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <select
          value={hataTuruFilter}
          onChange={(event) => setHataTuruFilter(event.target.value)}
          className={`${inputClassName} max-w-[180px]`}
        >
          <option value="Tümü">Tüm Hata Türleri</option>
          {Object.values(E_DEFTER_HATA_TURU).map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          value={cozumFilter}
          onChange={(event) => setCozumFilter(event.target.value)}
          className={`${inputClassName} max-w-[180px]`}
        >
          <option value="Tümü">Tümü</option>
          <option value="Çözüldü">Çözüldü</option>
          <option value="Çözülmedi">Çözülmedi</option>
        </select>
      </section>

      {groupCounts.length > 0 ? (
        <section className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveGroup("")}
            className={`rounded-full px-3 py-1 text-xs ${!activeGroup ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300"}`}
          >
            Tümü
          </button>
          {groupCounts.map(({ grup, count }) => (
            <button
              key={grup}
              type="button"
              onClick={() => setActiveGroup(grup)}
              className={`rounded-full px-3 py-1 text-xs ${activeGroup === grup ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300"}`}
            >
              {grup} ({count})
            </button>
          ))}
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-gray-900/70 p-5 shadow-xl shadow-black/20">
        <h2 className="mb-4 text-xl font-semibold">Kontrol Sonuçları</h2>
        {displayedRows.length === 0 ? (
          <p className="py-8 text-center text-gray-400">
            Henüz sonuç yok. XML/ZIP veya Excel yükleyip kontrol çalıştırın.
          </p>
        ) : (
          <div className="space-y-3">
            {displayedRows
              .filter((row) => row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ)
              .map((row) => (
                <article key={row.id} className="rounded-xl border border-white/10 bg-gray-950/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${riskLevelBadgeClass(row.riskLevel)}`}>
                          {row.riskLevel || "-"}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${grupClass(row.grup)}`}>
                          {row.grup}
                        </span>
                        <span className="text-xs text-gray-500">{row.hataTuru}</span>
                      </div>
                      <p className="text-sm text-white">
                        {row.yevmiyeNo ? `Yevmiye ${row.yevmiyeNo}` : ""}
                        {row.fisNo ? ` · Fiş ${row.fisNo}` : ""}
                        {row.hesapKodu ? ` · ${row.hesapKodu}` : ""}
                      </p>
                      <p className="mt-1 text-sm text-gray-300">{row.aciklama || (row.issues || []).join(" ")}</p>
                      <p className="mt-2 text-sm text-indigo-200">{row.onerilenKontrol}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold tabular-nums">{formatMoney(row.tutar || row.borc || row.alacak)} TL</p>
                      <select
                        value={row.cozumDurumu || E_DEFTER_FINDING_STATUS.YENI}
                        onChange={(event) => updateRow(row.id, { cozumDurumu: event.target.value })}
                        className={`${inputClassName} mt-2 min-w-[150px] text-xs`}
                      >
                        {Object.values(E_DEFTER_FINDING_STATUS).map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedId((current) => (current === row.id ? "" : row.id))}
                    className="mt-3 text-xs font-semibold text-indigo-300"
                  >
                    {expandedId === row.id ? "Akıllı açıklamayı gizle" : "Akıllı açıklamayı göster"}
                  </button>
                  {expandedId === row.id ? (
                    <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-gray-300">
                      {row.smartExplanation}
                    </pre>
                  ) : null}
                </article>
              ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function StatCard({ label, value, tone = "default" }) {
  const toneClass =
    tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : tone === "purple" ? "text-purple-300" : "text-white";
  return (
    <div className="rounded-2xl border border-white/10 bg-gray-900/70 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${toneClass}`}>{value ?? 0}</p>
    </div>
  );
}
