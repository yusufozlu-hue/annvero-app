"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AnnveroLogo from "@/app/components/AnnveroLogo";
import CompanySelectOptions from "@/app/(annvero)/muhasebe/components/CompanySelectOptions";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import {
  TICARET_SICIL_DOCUMENT_TEMPLATES,
  TICARET_SICIL_OPERATION_STATUS,
  TICARET_SICIL_OPERATION_TYPES,
} from "@/src/config/ticaretSicilDefaults";
import { getCompanyDisplayName } from "@/src/utils/companies";
import {
  buildOperation,
  buildTicaretSicilDashboardStats,
  buildTicaretSicilReminders,
  filterTicaretSicilOperations,
  getMissingChecklistCount,
  loadTicaretSicilDocuments,
  loadTicaretSicilOperations,
  readOperationDocumentFile,
  runTicaretSicilScenario,
  saveTicaretSicilDocuments,
  saveTicaretSicilOperations,
} from "@/src/utils/ticaretSicilEngine";

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20";

const navBtn =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white";

const STATUS_OPTIONS = ["Tümü", ...Object.values(TICARET_SICIL_OPERATION_STATUS)];
const TYPE_OPTIONS = ["Tümü", ...TICARET_SICIL_OPERATION_TYPES];

function StatCard({ label, value, tone = "default" }) {
  const tones = {
    default: "text-white",
    warning: "text-amber-300",
    success: "text-emerald-300",
    danger: "text-red-300",
  };
  return (
    <div className="min-w-[150px] flex-1 rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${tones[tone] || tones.default}`}>{value}</p>
    </div>
  );
}

export default function TicaretSicilPage() {
  const { companies, selectedCompanyId, setSelectedCompanyId, selectedCompany } =
    useCompanyList();

  const [operations, setOperations] = useState(() => loadTicaretSicilOperations());
  const [documents, setDocuments] = useState(() => loadTicaretSicilDocuments());
  const [typeFilter, setTypeFilter] = useState("Tümü");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [toast, setToast] = useState("");
  const [scenarioResult, setScenarioResult] = useState(null);

  const companyName = getCompanyDisplayName(selectedCompany);

  const filteredOperations = useMemo(
    () =>
      filterTicaretSicilOperations(operations, {
        companyId: selectedCompanyId,
        type: typeFilter,
        status: statusFilter,
        dateFrom,
        dateTo,
      }),
    [operations, selectedCompanyId, typeFilter, statusFilter, dateFrom, dateTo]
  );

  const stats = useMemo(() => buildTicaretSicilDashboardStats(operations), [operations]);
  const reminders = useMemo(() => buildTicaretSicilReminders(operations), [operations]);

  const persistOperations = (next) => {
    setOperations(next);
    saveTicaretSicilOperations(next);
  };

  const persistDocuments = (next) => {
    setDocuments(next);
    saveTicaretSicilDocuments(next);
  };

  const createOperation = () => {
    if (!selectedCompanyId) {
      setToast("Operasyon oluşturmak için firma seçin.");
      return;
    }
    const type = typeFilter !== "Tümü" ? typeFilter : "Şirket kuruluşu";
    const operation = buildOperation({
      companyId: selectedCompanyId,
      companyName,
      type,
    });
    persistOperations([operation, ...operations]);
    setExpandedId(operation.id);
    setToast(`${type} operasyonu oluşturuldu.`);
  };

  const updateOperation = (operationId, patch) => {
    persistOperations(
      operations.map((op) =>
        op.id === operationId
          ? { ...op, ...patch, updatedAt: new Date().toISOString() }
          : op
      )
    );
  };

  const toggleChecklistItem = (operationId, checklistId) => {
    const operation = operations.find((op) => op.id === operationId);
    if (!operation) return;
    updateOperation(operationId, {
      checklist: operation.checklist.map((item) =>
        item.id === checklistId ? { ...item, completed: !item.completed } : item
      ),
      dates: {
        ...operation.dates,
        lastActionDate: new Date().toISOString().slice(0, 10),
      },
    });
  };

  const handleDocumentUpload = async (operationId, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const operation = operations.find((op) => op.id === operationId);
    try {
      const parsed = await readOperationDocumentFile(file);
      persistDocuments([
        {
          ...parsed,
          companyId: operation?.companyId || "",
          companyName: operation?.companyName || "",
          operationId,
        },
        ...documents,
      ]);
      setToast(`${file.name} yüklendi.`);
    } catch (error) {
      setToast(error.message || "Dosya yüklenemedi.");
    }
    event.target.value = "";
  };

  const runScenario = () => {
    const result = runTicaretSicilScenario();
    setScenarioResult(result);
    setToast("Test senaryoları çalıştırıldı.");
  };

  return (
    <div className="min-h-screen bg-[#050816] p-6 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <AnnveroLogo />
            <h1 className="mt-4 text-2xl font-bold">Ticaret Sicil / Operasyon Merkezi</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Şirket kuruluşu, genel kurul, müdür değişikliği ve diğer ticaret sicil süreçlerini
              firma kartlarına bağlı dijital operasyon akışı olarak yönetin.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3" aria-label="Modül gezinme">
            <Link href="/dashboard" className={navBtn}>
              Dashboard
            </Link>
            <Link href="/muhasebe/firma-yonetimi" className={navBtn}>
              Firma Yönetimi
            </Link>
            <Link href="/ofis-takip" className={navBtn}>
              Ofis Takip
            </Link>
          </nav>
        </header>

        {toast ? (
          <div className="mb-4 rounded-xl border border-indigo-700/50 bg-indigo-950/40 px-4 py-3 text-sm text-indigo-100">
            {toast}
          </div>
        ) : null}

        <div className="mb-6 flex flex-wrap gap-4">
          <StatCard label="Açık Operasyon" value={stats.openOperations} />
          <StatCard label="Eksik Evrak" value={stats.missingDocuments} tone="warning" />
          <StatCard label="Bu Ay Tamamlanan" value={stats.completedThisMonth} tone="success" />
          <StatCard label="Bekleyen Tescil" value={stats.pendingRegistrations} tone="danger" />
          <StatCard label="Yaklaşan Süre" value={stats.upcomingDeadlines} tone="warning" />
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
            <span className="mb-1 block text-xs text-slate-400">Operasyon Türü</span>
            <select
              className={inputClassName}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              {TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Durum</span>
            <select
              className={inputClassName}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Başlangıç</span>
            <input
              type="date"
              className={inputClassName}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-slate-400">Bitiş</span>
            <input
              type="date"
              className={inputClassName}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={createOperation}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold hover:bg-indigo-500"
          >
            Yeni Operasyon
          </button>
          <button
            type="button"
            onClick={runScenario}
            className="rounded-xl border border-gray-700 bg-gray-950 px-5 py-2.5 text-sm font-semibold hover:border-gray-500"
          >
            Test Senaryolarını Çalıştır
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <section className="space-y-4 xl:col-span-2">
            <h2 className="text-lg font-semibold">Operasyonlar</h2>
            {filteredOperations.length === 0 ? (
              <p className="rounded-2xl border border-gray-800 bg-gray-900 p-6 text-sm text-slate-400">
                Filtrelere uygun operasyon bulunamadı.
              </p>
            ) : (
              filteredOperations.map((operation) => {
                const missing = getMissingChecklistCount(operation);
                const isExpanded = expandedId === operation.id;
                return (
                  <article
                    key={operation.id}
                    className="rounded-2xl border border-gray-800 bg-gray-900 p-5"
                  >
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-3 text-left"
                      onClick={() => setExpandedId(isExpanded ? "" : operation.id)}
                    >
                      <div>
                        <p className="font-semibold text-white">{operation.type}</p>
                        <p className="text-sm text-slate-400">{operation.companyName}</p>
                        <p className="mt-1 text-xs text-indigo-300">
                          Akıllı evrak önerisi: {operation.suggestedDocuments?.summary}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs">
                          {operation.status}
                        </span>
                        {missing > 0 ? (
                          <p className="mt-2 text-xs text-amber-300">{missing} eksik evrak</p>
                        ) : null}
                      </div>
                    </button>

                    {isExpanded ? (
                      <div className="mt-4 border-t border-gray-800 pt-4">
                        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                          {[
                            ["Başvuru", "applicationDate"],
                            ["Tescil", "registrationDate"],
                            ["İlan", "announcementDate"],
                            ["Son İşlem", "lastActionDate"],
                          ].map(([label, key]) => (
                            <label key={key} className="text-xs text-slate-400">
                              {label}
                              <input
                                type="date"
                                className={`${inputClassName} mt-1`}
                                value={operation.dates?.[key] || ""}
                                onChange={(e) =>
                                  updateOperation(operation.id, {
                                    dates: { ...operation.dates, [key]: e.target.value },
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <label className="mb-4 block text-xs text-slate-400">
                          Süre / Hatırlatma Tarihi
                          <input
                            type="date"
                            className={`${inputClassName} mt-1`}
                            value={operation.dates?.deadlineDate || ""}
                            onChange={(e) =>
                              updateOperation(operation.id, {
                                dates: { ...operation.dates, deadlineDate: e.target.value },
                              })
                            }
                          />
                        </label>
                        <select
                          className={`${inputClassName} mb-4`}
                          value={operation.status}
                          onChange={(e) =>
                            updateOperation(operation.id, { status: e.target.value })
                          }
                        >
                          {Object.values(TICARET_SICIL_OPERATION_STATUS).map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                        <div className="space-y-2">
                          {operation.checklist.map((item) => (
                            <label
                              key={item.id}
                              className="flex items-center gap-2 text-sm text-slate-200"
                            >
                              <input
                                type="checkbox"
                                checked={item.completed}
                                onChange={() => toggleChecklistItem(operation.id, item.id)}
                              />
                              {item.label}
                            </label>
                          ))}
                        </div>
                        <div className="mt-4">
                          <p className="mb-2 text-xs text-slate-400">
                            Evrak yükle (PDF, Word, Excel, görsel)
                          </p>
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
                            className="text-xs"
                            onChange={(e) => handleDocumentUpload(operation.id, e)}
                          />
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-4 text-lg font-semibold">Hatırlatmalar</h2>
              {reminders.length === 0 ? (
                <p className="text-sm text-slate-400">Aktif hatırlatma yok.</p>
              ) : (
                <div className="space-y-2">
                  {reminders.slice(0, 8).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-sm"
                    >
                      <p className="font-medium text-amber-100">{item.type}</p>
                      <p className="text-amber-200/90">{item.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-2 text-lg font-semibold">Belge Şablon Altyapısı</h2>
              <p className="mb-4 text-xs text-slate-400">
                Belge üretimi sonraki aşamada eklenecek. Şablon kayıtları hazır.
              </p>
              <div className="space-y-2">
                {TICARET_SICIL_DOCUMENT_TEMPLATES.map((template) => (
                  <div
                    key={template.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm"
                  >
                    <p className="font-medium">{template.title}</p>
                    <p className="text-xs text-slate-500">Durum: {template.status}</p>
                  </div>
                ))}
              </div>
            </section>

            {scenarioResult ? (
              <section className="rounded-2xl border border-emerald-800/40 bg-emerald-950/20 p-5 text-sm">
                <h2 className="mb-3 font-semibold text-emerald-100">Test Özeti</h2>
                <ul className="space-y-1 text-emerald-200/90">
                  <li>Şirket kuruluşu: {scenarioResult.newCompanySetup ? "OK" : "—"}</li>
                  <li>Eksik evrak uyarısı: {scenarioResult.missingDocumentWarning ? "OK" : "—"}</li>
                  <li>
                    Adres değişikliği checklist: {scenarioResult.addressChangeChecklistItems} madde
                  </li>
                  <li>Tamamlanan işlem: {scenarioResult.completedOperation ? "OK" : "—"}</li>
                  <li>
                    Genel kurul uyarısı:{" "}
                    {scenarioResult.upcomingGeneralAssemblyWarning ? "OK" : "—"}
                  </li>
                  <li>Açık operasyon: {scenarioResult.openOperations}</li>
                  <li>Eksik evrak toplam: {scenarioResult.missingDocuments}</li>
                  <li>Hatırlatma sayısı: {scenarioResult.reminderCount}</li>
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
