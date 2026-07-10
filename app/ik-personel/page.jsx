"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AnnveroLogo from "@/app/components/AnnveroLogo";
import CompanySelectOptions from "@/app/muhasebe/components/CompanySelectOptions";
import { useCompanyList } from "@/app/muhasebe/hooks/useCompanyList";
import { IK_MOVEMENT_TYPES } from "@/src/config/ikPersonelDefaults";
import { downloadIkPersonelTemplate, parseIkPersonelExcelFile } from "@/src/utils/ikPersonelExcel";
import {
  buildIkDashboardStats,
  buildMovement,
  buildPayrollRisks,
  buildSgkChecks,
  collectEmployeeCards,
  filterEmployeeCards,
  importRowsToEmployeeRecords,
  loadIkLeaves,
  loadIkMovements,
  runIkPersonelScenario,
  saveIkMovements,
  saveIkProfile,
  saveKidemIhbarPrefill,
  validateIkPersonelImport,
} from "@/src/utils/ikPersonelEngine";
import { persistCompaniesToLocalStorage } from "@/src/utils/companies";

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20";

const navBtn =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white";

function StatCard({ label, value, tone = "default" }) {
  const tones = {
    default: "text-white",
    warning: "text-amber-300",
    success: "text-emerald-300",
    danger: "text-red-300",
  };
  return (
    <div className="min-w-[140px] flex-1 rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${tones[tone] || tones.default}`}>{value}</p>
    </div>
  );
}

export default function IkPersonelPage() {
  const { companies, selectedCompanyId, setSelectedCompanyId, refreshCompanies } =
    useCompanyList();

  const [movements, setMovements] = useState(() => loadIkMovements());
  const [leaves, setLeaves] = useState(() => loadIkLeaves());
  const [activeFilter, setActiveFilter] = useState("Tümü");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [department, setDepartment] = useState("Tümü");
  const [riskFilter, setRiskFilter] = useState("Tümü");
  const [toast, setToast] = useState("");
  const [scenarioResult, setScenarioResult] = useState(null);
  const [importReport, setImportReport] = useState(null);

  const allCards = useMemo(() => collectEmployeeCards(companies), [companies]);
  const payrollRisks = useMemo(() => buildPayrollRisks(allCards), [allCards]);
  const sgkChecks = useMemo(() => buildSgkChecks(allCards), [allCards]);
  const stats = useMemo(
    () => buildIkDashboardStats(allCards, leaves, sgkChecks, payrollRisks),
    [allCards, leaves, sgkChecks, payrollRisks]
  );

  const departments = useMemo(() => {
    const set = new Set(allCards.map((card) => card.department).filter(Boolean));
    return ["Tümü", ...Array.from(set).sort((a, b) => a.localeCompare(b, "tr"))];
  }, [allCards]);

  const filteredCards = useMemo(
    () =>
      filterEmployeeCards(
        allCards,
        {
          companyId: selectedCompanyId,
          activeFilter,
          dateFrom,
          dateTo,
          department,
          riskFilter,
        },
        payrollRisks
      ),
    [allCards, selectedCompanyId, activeFilter, dateFrom, dateTo, department, riskFilter, payrollRisks]
  );

  const handleExcelUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!selectedCompanyId) {
      setToast("Excel yüklemek için firma seçin.");
      return;
    }
    try {
      const rows = await parseIkPersonelExcelFile(file);
      const companyCards = allCards.filter((card) => card.companyId === selectedCompanyId);
      const validation = validateIkPersonelImport(rows, companyCards);
      setImportReport(validation);
      if (!validation.valid) {
        setToast("Excel doğrulama hatası.");
        return;
      }
      const records = importRowsToEmployeeRecords(rows, selectedCompanyId);
      const updatedCompanies = companies.map((company) => {
        if (company.id !== selectedCompanyId) return company;
        const newEmployees = [...(company.employees || [])];
        records.forEach(({ employee, profile }) => {
          profile.employeeId = employee.id;
          newEmployees.push(employee);
          saveIkProfile(selectedCompanyId, employee.id, profile);
        });
        return { ...company, employees: newEmployees };
      });
      persistCompaniesToLocalStorage(updatedCompanies);
      await refreshCompanies();
      setToast(`${records.length} personel yüklendi.`);
    } catch (error) {
      setToast(error.message || "Excel okunamadı.");
    }
    event.target.value = "";
  };

  const addSampleMovement = () => {
    const card = filteredCards[0];
    if (!card) {
      setToast("Hareket eklemek için personel gerekli.");
      return;
    }
    const movement = buildMovement({
      companyId: card.companyId,
      companyName: card.companyName,
      employeeId: card.id,
      employeeName: card.fullName,
      type: IK_MOVEMENT_TYPES[0],
    });
    const next = [movement, ...movements];
    setMovements(next);
    saveIkMovements(next);
    setToast("Örnek işe giriş hareketi eklendi.");
  };

  const runScenario = () => {
    setScenarioResult(runIkPersonelScenario());
    setToast("Test senaryoları çalıştırıldı.");
  };

  return (
    <div className="min-h-screen bg-[#050816] p-6 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <AnnveroLogo />
            <h1 className="mt-4 text-2xl font-bold">İK / Personel Operasyon Merkezi</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Personel kayıtları, işe giriş/çıkış, izin, SGK kontrolü ve bordro risk analizini
              firma kartlarına bağlı tek merkezden yönetin.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <Link href="/dashboard" className={navBtn}>
              Dashboard
            </Link>
            <Link href="/muhasebe/firma-yonetimi" className={navBtn}>
              Firma Yönetimi
            </Link>
            <Link href="/ik-personel/kidem-ihbar" className={navBtn}>
              Kıdem/İhbar
            </Link>
          </nav>
        </header>

        {toast ? (
          <div className="mb-4 rounded-xl border border-violet-700/50 bg-violet-950/40 px-4 py-3 text-sm">
            {toast}
          </div>
        ) : null}

        <div className="mb-6 flex flex-wrap gap-4">
          <StatCard label="Aktif Personel" value={stats.activePersonnel} />
          <StatCard label="Bu Ay İşe Giren" value={stats.hiredThisMonth} tone="success" />
          <StatCard label="Bu Ay İşten Çıkan" value={stats.terminatedThisMonth} tone="warning" />
          <StatCard label="Eksik SGK Bilgisi" value={stats.missingSgkInfo} tone="danger" />
          <StatCard label="Bordro Riskleri" value={stats.payrollRiskCount} tone="danger" />
          <StatCard label="Yaklaşan İzinler" value={stats.upcomingLeaves} tone="warning" />
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 lg:grid-cols-5">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Firma</span>
            <select
              className={inputClassName}
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
            >
              <option value="">Tüm firmalar</option>
              <CompanySelectOptions companies={companies} />
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Aktif/Pasif</span>
            <select
              className={inputClassName}
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value)}
            >
              {["Tümü", "Aktif", "Pasif"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">İşe Giriş Başlangıç</span>
            <input
              type="date"
              className={inputClassName}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">İşe Giriş Bitiş</span>
            <input
              type="date"
              className={inputClassName}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Departman</span>
            <select
              className={inputClassName}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              {departments.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm lg:col-span-5">
            <span className="mb-1 block text-xs text-slate-400">Risk Durumu</span>
            <select
              className={inputClassName}
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
            >
              {["Tümü", "Riskli", "Temiz"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={downloadIkPersonelTemplate}
            className="rounded-xl border border-gray-700 bg-gray-950 px-5 py-2.5 text-sm font-semibold hover:border-gray-500"
          >
            Excel Şablonu
          </button>
          <label className="cursor-pointer rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold hover:bg-violet-500">
            Excel Yükle
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
          </label>
          <button
            type="button"
            onClick={addSampleMovement}
            className="rounded-xl border border-gray-700 bg-gray-950 px-5 py-2.5 text-sm font-semibold hover:border-gray-500"
          >
            Hareket Ekle
          </button>
          <button
            type="button"
            onClick={runScenario}
            className="rounded-xl border border-gray-700 bg-gray-950 px-5 py-2.5 text-sm font-semibold hover:border-gray-500"
          >
            Test Senaryolarını Çalıştır
          </button>
        </div>

        {importReport ? (
          <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm">
            {importReport.errors.map((item) => (
              <p key={item} className="text-red-300">
                {item}
              </p>
            ))}
            {importReport.warnings.map((item) => (
              <p key={item} className="text-amber-300">
                {item}
              </p>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <section className="space-y-3 xl:col-span-2">
            <h2 className="text-lg font-semibold">Personel Kartları</h2>
            {filteredCards.length === 0 ? (
              <p className="rounded-2xl border border-gray-800 bg-gray-900 p-6 text-sm text-slate-400">
                Filtrelere uygun personel bulunamadı.
              </p>
            ) : (
              filteredCards.map((card) => (
                <article
                  key={`${card.companyId}-${card.id}`}
                  className="rounded-2xl border border-gray-800 bg-gray-900 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{card.fullName}</p>
                      <p className="text-sm text-slate-400">{card.companyName}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {card.department} · {card.position} · {card.workType} ·{" "}
                        {card.isActive ? "Aktif" : "Pasif"}
                      </p>
                    </div>
                    <Link
                      href="/ik-personel/kidem-ihbar"
                      onClick={() => saveKidemIhbarPrefill(card)}
                      className="text-xs font-semibold text-violet-300 hover:text-violet-200"
                    >
                      Kıdem/İhbar →
                    </Link>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300 md:grid-cols-4">
                    <span>T.C.: {card.tcNo || "—"}</span>
                    <span>SGK: {card.sgkSicilNo || "—"}</span>
                    <span>Giriş: {card.hireDate || "—"}</span>
                    <span>Çıkış: {card.terminationDate || "—"}</span>
                    <span>Brüt: {card.grossSalary?.toLocaleString("tr-TR") || "—"}</span>
                    <span>Net: {card.netSalary?.toLocaleString("tr-TR") || "—"}</span>
                    <span>Meslek: {card.sgkCode || "—"}</span>
                  </div>
                </article>
              ))
            )}
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-3 text-lg font-semibold">SGK Kontrolleri</h2>
              {sgkChecks.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="mb-2 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-sm"
                >
                  <p className="font-medium text-amber-100">{item.type}</p>
                  <p className="text-amber-200/90">{item.message}</p>
                </div>
              ))}
              {sgkChecks.length === 0 ? (
                <p className="text-sm text-slate-400">Uyarı yok.</p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-3 text-lg font-semibold">Bordro Riskleri</h2>
              {payrollRisks.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="mb-2 rounded-lg border border-red-800/40 bg-red-950/20 px-3 py-2 text-sm"
                >
                  <p className="font-medium text-red-100">
                    {item.type} · {item.level}
                  </p>
                  <p className="text-red-200/90">{item.message}</p>
                </div>
              ))}
              {payrollRisks.length === 0 ? (
                <p className="text-sm text-slate-400">Risk bulunamadı.</p>
              ) : null}
            </section>

            {scenarioResult ? (
              <section className="rounded-2xl border border-emerald-800/40 bg-emerald-950/20 p-5 text-sm">
                <h2 className="mb-3 font-semibold text-emerald-100">Test Özeti</h2>
                <ul className="space-y-1 text-emerald-200/90">
                  <li>Excel yükleme: {scenarioResult.excelImportReady ? "OK" : "—"}</li>
                  <li>Mükerrer T.C. uyarısı: {scenarioResult.duplicateTcWarning ? "OK" : "—"}</li>
                  <li>Kıdem/ihbar aktarımı: {scenarioResult.kidemIhbarPrefill ? "OK" : "—"}</li>
                  <li>
                    Yıllık izin bakiyesi: {scenarioResult.entitledDays} / {scenarioResult.usedDays}{" "}
                    (kalan {scenarioResult.annualLeaveBalance ? "OK" : "—"})
                  </li>
                  <li>SGK eksik bilgi: {scenarioResult.sgkMissingInfoWarning ? "OK" : "—"}</li>
                  <li>Bordro riski: {scenarioResult.payrollRiskGenerated ? "OK" : "—"}</li>
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
