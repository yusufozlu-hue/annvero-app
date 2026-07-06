"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { downloadIkPersonelTemplate, parseIkPersonelExcelFile } from "@/src/utils/ikPersonelExcel";
import {
  buildIkDashboardStats,
  buildLeaveRecord,
  buildMovement,
  buildPayrollRisks,
  buildSgkChecks,
  calculateLeaveBalance,
  filterEmployeeCards,
  getIkProfile,
  importRowsToEmployeeRecords,
  loadIkLeaves,
  loadIkMovements,
  mergeEmployeeCard,
  saveIkLeaves,
  saveIkMovements,
  saveIkProfile,
  saveKidemIhbarPrefill,
  validateIkPersonelImport,
} from "@/src/utils/ikPersonelEngine";

const inputClassName =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500";

export default function IkPersonelCompanyPanel({
  company = {},
  setCompany,
  view = "personnel",
}) {
  const [movements, setMovements] = useState(() => loadIkMovements());
  const [leaves, setLeaves] = useState(() => loadIkLeaves());
  const [toast, setToast] = useState("");
  const [importReport, setImportReport] = useState(null);
  const [movementType, setMovementType] = useState(IK_MOVEMENT_TYPES[0]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");

  const companyId = company.id || "";
  const cards = useMemo(
    () => (company.employees || []).map((employee) => mergeEmployeeCard(company, employee)),
    [company]
  );
  const companyMovements = useMemo(
    () => movements.filter((item) => item.companyId === companyId),
    [movements, companyId]
  );
  const companyLeaves = useMemo(
    () => leaves.filter((item) => item.companyId === companyId),
    [leaves, companyId]
  );
  const sgkChecks = useMemo(() => buildSgkChecks(cards), [cards]);
  const payrollRisks = useMemo(() => buildPayrollRisks(cards), [cards]);
  const stats = useMemo(
    () => buildIkDashboardStats(cards, companyLeaves, sgkChecks, payrollRisks),
    [cards, companyLeaves, sgkChecks, payrollRisks]
  );

  const persistMovements = (next) => {
    setMovements(next);
    saveIkMovements(next);
  };

  const persistLeaves = (next) => {
    setLeaves(next);
    saveIkLeaves(next);
  };

  const updateEmployee = (employeeId, employeePatch, profilePatch) => {
    const employees = (company.employees || []).map((employee) =>
      employee.id === employeeId ? { ...employee, ...employeePatch } : employee
    );
    setCompany({ ...company, employees });
    if (profilePatch) saveIkProfile(companyId, employeeId, profilePatch);
  };

  const handleExcelUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !companyId) return;
    try {
      const rows = await parseIkPersonelExcelFile(file);
      const validation = validateIkPersonelImport(rows, cards);
      setImportReport(validation);
      if (!validation.valid) {
        setToast("Excel yükleme doğrulaması başarısız.");
        return;
      }
      const records = importRowsToEmployeeRecords(rows, companyId);
      const newEmployees = [...(company.employees || [])];
      records.forEach(({ employee, profile }) => {
        const id = employee.id;
        profile.employeeId = id;
        newEmployees.push(employee);
        saveIkProfile(companyId, id, profile);
      });
      setCompany({ ...company, employees: newEmployees });
      setToast(`${records.length} personel yüklendi.`);
    } catch (error) {
      setToast(error.message || "Excel okunamadı.");
    }
    event.target.value = "";
  };

  const addMovement = () => {
    const card = cards.find((item) => item.id === selectedEmployeeId);
    if (!card) {
      setToast("Hareket için personel seçin.");
      return;
    }
    const movement = buildMovement({
      companyId,
      companyName: company.companyName,
      employeeId: card.id,
      employeeName: card.fullName,
      type: movementType,
      effectiveDate: new Date().toISOString().slice(0, 10),
    });
    persistMovements([movement, ...movements]);
    setToast(`${movementType} hareketi eklendi.`);
  };

  const addLeave = () => {
    const card = cards.find((item) => item.id === selectedEmployeeId);
    if (!card) {
      setToast("İzin için personel seçin.");
      return;
    }
    const balance = calculateLeaveBalance(card, companyLeaves);
    const leave = buildLeaveRecord({
      companyId,
      companyName: company.companyName,
      employeeId: card.id,
      employeeName: card.fullName,
      type: "Yıllık izin",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      entitledDays: balance.entitledDays,
      usedDays: 1,
      remainingDays: Math.max(balance.remainingDays - 1, 0),
    });
    persistLeaves([leave, ...leaves]);
    setToast("İzin kaydı eklendi.");
  };

  if (!companyId) {
    return <p className="text-sm text-slate-400">Personel işlemleri için önce firma seçin.</p>;
  }

  if (view === "personnel") {
    return (
      <Panel toast={toast}>
        <div className="mb-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={downloadIkPersonelTemplate}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
          >
            Excel Şablonu
          </button>
          <label className="cursor-pointer rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold hover:bg-violet-500">
            Excel Yükle
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
          </label>
        </div>
        {importReport ? (
          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-950/70 p-3 text-xs">
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
        <div className="space-y-3">
          {cards.length === 0 ? (
            <p className="text-sm text-slate-400">Personel kaydı yok.</p>
          ) : (
            cards.map((card) => (
              <article key={card.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{card.fullName}</p>
                    <p className="text-xs text-slate-400">
                      {card.department} · {card.position} · {card.isActive ? "Aktif" : "Pasif"}
                    </p>
                  </div>
                  <Link
                    href="/hesaplama-araclari/kidem-ihbar"
                    onClick={() => saveKidemIhbarPrefill(card)}
                    className="text-xs text-violet-300 hover:text-violet-200"
                  >
                    Kıdem/İhbar Hesapla →
                  </Link>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="T.C. No">
                    <input
                      className={inputClassName}
                      value={card.tcNo}
                      onChange={(e) => updateEmployee(card.id, { tcNo: e.target.value })}
                    />
                  </Field>
                  <Field label="SGK Sicil No">
                    <input
                      className={inputClassName}
                      value={card.sgkSicilNo}
                      onChange={(e) =>
                        updateEmployee(card.id, {}, { ...getIkProfile(companyId, card.id), sgkSicilNo: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Brüt Ücret">
                    <input
                      type="number"
                      className={inputClassName}
                      value={card.grossSalary || ""}
                      onChange={(e) =>
                        updateEmployee(
                          card.id,
                          {},
                          {
                            ...getIkProfile(companyId, card.id),
                            grossSalary: Number(e.target.value) || 0,
                            lastSalaryChangeDate: new Date().toISOString().slice(0, 10),
                          }
                        )
                      }
                    />
                  </Field>
                  <Field label="Net Ücret">
                    <input
                      type="number"
                      className={inputClassName}
                      value={card.netSalary || ""}
                      onChange={(e) =>
                        updateEmployee(
                          card.id,
                          {},
                          {
                            ...getIkProfile(companyId, card.id),
                            netSalary: Number(e.target.value) || 0,
                          }
                        )
                      }
                    />
                  </Field>
                  <Field label="Çalışma Türü">
                    <select
                      className={inputClassName}
                      value={card.workType}
                      onChange={(e) =>
                        updateEmployee(card.id, {}, { ...getIkProfile(companyId, card.id), workType: e.target.value })
                      }
                    >
                      {IK_WORK_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Durum">
                    <select
                      className={inputClassName}
                      value={card.isActive ? "Aktif" : "Pasif"}
                      onChange={(e) =>
                        updateEmployee(card.id, { isActive: e.target.value === "Aktif" })
                      }
                    >
                      <option value="Aktif">Aktif</option>
                      <option value="Pasif">Pasif</option>
                    </select>
                  </Field>
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>
    );
  }

  if (view === "movements") {
    return (
      <Panel toast={toast}>
        <div className="mb-4 flex flex-wrap gap-3">
          <select
            className={`${inputClassName} max-w-xs`}
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
          >
            <option value="">Personel seç</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.fullName}
              </option>
            ))}
          </select>
          <select
            className={`${inputClassName} max-w-xs`}
            value={movementType}
            onChange={(e) => setMovementType(e.target.value)}
          >
            {IK_MOVEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addMovement}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold hover:bg-violet-500"
          >
            Hareket Ekle
          </button>
        </div>
        <div className="space-y-2">
          {companyMovements.length === 0 ? (
            <p className="text-sm text-slate-400">Hareket kaydı yok.</p>
          ) : (
            companyMovements.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-800 px-3 py-2 text-sm">
                <p className="font-medium">{item.type}</p>
                <p className="text-slate-400">
                  {item.employeeName} · {item.effectiveDate}
                </p>
              </div>
            ))
          )}
        </div>
      </Panel>
    );
  }

  if (view === "leaves") {
    return (
      <Panel toast={toast}>
        <div className="mb-4 flex flex-wrap gap-3">
          <select
            className={`${inputClassName} max-w-xs`}
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
          >
            <option value="">Personel seç</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.fullName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addLeave}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold hover:bg-violet-500"
          >
            İzin Ekle
          </button>
        </div>
        <div className="space-y-3">
          {cards.map((card) => {
            const balance = calculateLeaveBalance(card, companyLeaves);
            return (
              <div key={card.id} className="rounded-lg border border-slate-800 px-3 py-2 text-sm">
                <p className="font-medium">{card.fullName}</p>
                <p className="text-slate-400">
                  Hak: {balance.entitledDays} · Kullanılan: {balance.usedDays} · Kalan:{" "}
                  {balance.remainingDays}
                </p>
              </div>
            );
          })}
          {companyLeaves.map((leave) => (
            <div key={leave.id} className="rounded-lg border border-violet-900/40 bg-violet-950/20 px-3 py-2 text-sm">
              <p className="font-medium">{leave.employeeName}</p>
              <p className="text-slate-300">
                {leave.type} · {leave.startDate} - {leave.endDate} · {leave.days} gün
              </p>
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  if (view === "sgk") {
    return (
      <Panel toast={toast}>
        <MiniStats stats={stats} />
        <div className="mt-4 space-y-2">
          {sgkChecks.length === 0 ? (
            <p className="text-sm text-slate-400">SGK kontrol uyarısı yok.</p>
          ) : (
            sgkChecks.map((item) => (
              <div key={item.id} className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-sm">
                <p className="font-medium text-amber-100">{item.type}</p>
                <p className="text-amber-200/90">{item.message}</p>
              </div>
            ))
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel toast={toast}>
      <MiniStats stats={stats} />
      <div className="mt-4 space-y-2">
        {payrollRisks.length === 0 ? (
          <p className="text-sm text-slate-400">Bordro riski bulunamadı.</p>
        ) : (
          payrollRisks.map((item) => (
            <div key={item.id} className="rounded-lg border border-red-800/40 bg-red-950/20 px-3 py-2 text-sm">
              <p className="font-medium text-red-100">
                {item.type} · {item.level}
              </p>
              <p className="text-red-200/90">{item.message}</p>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function Panel({ children, toast }) {
  return (
    <div>
      {toast ? (
        <div className="mb-3 rounded-lg border border-violet-700 bg-violet-950/50 px-3 py-2 text-sm text-violet-100">
          {toast}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function MiniStats({ stats }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      <MiniStat label="Aktif" value={stats.activePersonnel} />
      <MiniStat label="Eksik SGK" value={stats.missingSgkInfo} />
      <MiniStat label="Bordro Risk" value={stats.payrollRiskCount} />
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
