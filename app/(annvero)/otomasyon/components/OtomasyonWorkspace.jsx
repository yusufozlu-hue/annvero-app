"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AnnveroLogo from "@/app/components/AnnveroLogo";
import AnnveroDataTable from "@/src/components/AnnveroDataTable";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import { useAdminAccess } from "@/src/hooks/useAdminAccess";
import {
  N8N_FLOW_DEFINITIONS,
  N8N_FLOW_MODULE_ROUTES,
  N8N_INTEGRATION_PLACEHOLDERS,
  N8N_JOB_STATUS,
} from "@/src/config/n8nOtomasyonDefaults";
import {
  buildAutomationDashboardStats,
  enqueueAutomationJob,
  filterAutomationQueue,
  learnAutomationRule,
  loadAutomationErrors,
  loadAutomationLogs,
  loadAutomationQueue,
  loadAutomationSchedules,
  loadAutomationTriggers,
  processAutomationJob,
  retryAutomationJob,
  runN8nAutomationScenario,
  saveAutomationQueue,
  saveAutomationSchedules,
  saveAutomationTriggers,
} from "@/src/utils/n8nOtomasyonEngine";

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500/60 focus:ring-2 focus:ring-orange-500/20";

const navBtn =
  "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-white/20 hover:bg-white/10";

const STATUS_OPTIONS = ["Tümü", ...Object.values(N8N_JOB_STATUS)];

function StatCard({ label, value, tone = "default" }) {
  const tones = {
    default: "text-white",
    warning: "text-amber-300",
    success: "text-emerald-300",
    danger: "text-red-300",
  };
  return (
    <div className="min-w-[120px] flex-1 rounded-2xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tones[tone] || tones.default}`}>{value}</p>
    </div>
  );
}

export default function OtomasyonWorkspace({ view = "flows" }) {
  const { companies } = useCompanyList();
  const { isAdmin } = useAdminAccess();

  const [queue, setQueue] = useState(() => loadAutomationQueue());
  const [logs, setLogs] = useState(() => loadAutomationLogs());
  const [errors, setErrors] = useState(() => loadAutomationErrors());
  const [triggers, setTriggers] = useState(() => loadAutomationTriggers());
  const [schedules, setSchedules] = useState(() => loadAutomationSchedules());
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [flowFilter, setFlowFilter] = useState("Tümü");
  const [toast, setToast] = useState("");
  const [scenarioResult, setScenarioResult] = useState(null);
  const [learnPattern, setLearnPattern] = useState("");
  const [learnFlowId, setLearnFlowId] = useState(N8N_FLOW_DEFINITIONS[0]?.id || "");

  const stats = useMemo(() => buildAutomationDashboardStats(queue, errors), [queue, errors]);
  const filteredQueue = useMemo(
    () => filterAutomationQueue(queue, { status: statusFilter, flowId: flowFilter }),
    [queue, statusFilter, flowFilter]
  );

  const refresh = () => {
    setQueue(loadAutomationQueue());
    setLogs(loadAutomationLogs());
    setErrors(loadAutomationErrors());
  };

  const runJob = async (jobId) => {
    await processAutomationJob(jobId, companies, isAdmin ? "admin" : "kullanici");
    refresh();
    setToast("İşlem çalıştırıldı.");
  };

  const handleRetry = async (jobId) => {
    retryAutomationJob(jobId);
    refresh();
    await runJob(jobId);
  };

  const triggerFlow = async (flowId) => {
    const job = enqueueAutomationJob({ flowId, triggeredBy: isAdmin ? "admin" : "kullanici" }, companies);
    refresh();
    await processAutomationJob(job.id, companies, isAdmin ? "admin" : "kullanici");
    refresh();
    setToast(`${flowId} akışı tetiklendi.`);
  };

  const syncWebhookQueue = async () => {
    try {
      const response = await fetch("/api/automation/webhook");
      if (!response.ok) {
        setToast("Webhook kuyruğu alınamadı.");
        return;
      }
      const payload = await response.json();
      const jobs = payload.jobs || [];
      if (!jobs.length) {
        setToast("Webhook kuyruğunda yeni iş yok.");
        return;
      }
      const current = loadAutomationQueue();
      saveAutomationQueue([...jobs, ...current]);
      refresh();
      setToast(`${jobs.length} webhook işi senkronize edildi.`);
    } catch {
      setToast("Webhook senkronizasyonu başarısız.");
    }
  };

  const runScenario = async () => {
    const result = await runN8nAutomationScenario(companies);
    setScenarioResult(result);
    refresh();
    setToast("Test senaryoları çalıştırıldı.");
  };

  const saveLearnRule = () => {
    learnAutomationRule({
      flowId: learnFlowId,
      pattern: learnPattern,
      userId: isAdmin ? "admin" : "kullanici",
    });
    setLearnPattern("");
    refresh();
    setToast("Otomasyon kuralı öğrenildi.");
  };

  return (
    <div className="min-h-screen bg-[#050816] p-6 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <AnnveroLogo />
            <h1 className="mt-4 text-2xl font-bold">Otomasyon Merkezi (n8n)</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Muhasebe, evrak, mail, banka, SGK, GİB ve operasyon süreçlerini otomatik akışlarla
              yönetin. Arka panel entegrasyon motoru.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <Link href="/dashboard" className={navBtn}>
              Dashboard
            </Link>
            <Link href="/ai-ofis-asistani" className={navBtn}>
              AI Ofis Asistanı
            </Link>
          </nav>
        </header>

        {!isAdmin ? (
          <div className="mb-4 rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
            Kritik işlem onayı ve bazı yönetim aksiyonları yalnızca admin kullanıcılar için
            etkindir.
          </div>
        ) : null}

        {toast ? (
          <div className="mb-4 rounded-xl border border-orange-700/50 bg-orange-950/40 px-4 py-3 text-sm">
            {toast}
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-3">
          <StatCard label="Aktif Otomasyon" value={stats.activeFlows} />
          <StatCard label="Bugünkü İşlem" value={stats.todayJobCount} />
          <StatCard label="Başarılı" value={stats.successCount} tone="success" />
          <StatCard label="Hatalı" value={stats.failedCount} tone="danger" />
          <StatCard label="Retry Bekleyen" value={stats.retryPendingCount} tone="warning" />
          <StatCard label="Kritik Uyarı" value={stats.criticalAlertCount} tone="danger" />
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={syncWebhookQueue}
            className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold hover:bg-orange-500"
          >
            Webhook Kuyruğunu Senkronize Et
          </button>
          <button
            type="button"
            onClick={runScenario}
            className="rounded-xl border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-semibold hover:border-gray-500"
          >
            Test Senaryolarını Çalıştır
          </button>
        </div>

        {view === "flows" && (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {N8N_FLOW_DEFINITIONS.map((flow) => (
              <article key={flow.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
                <h2 className="font-semibold">{flow.name}</h2>
                <p className="mt-1 text-sm text-slate-400">{flow.module}</p>
                <p className="mt-2 text-xs text-slate-500">{flow.description}</p>
                <p className="mt-2 text-xs text-orange-300">
                  Adımlar: {flow.steps.join(" → ")}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => triggerFlow(flow.id)}
                    className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold hover:bg-orange-500"
                  >
                    Manuel Tetikle
                  </button>
                  {N8N_FLOW_MODULE_ROUTES[flow.id] ? (
                    <Link
                      href={N8N_FLOW_MODULE_ROUTES[flow.id]}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800"
                    >
                      Modüle Git
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </section>
        )}

        {view === "triggers" && (
          <section className="space-y-3">
            {triggers.map((trigger) => (
              <div
                key={trigger.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
              >
                <div>
                  <p className="font-medium">{trigger.name}</p>
                  <p className="text-xs text-slate-400">
                    {trigger.flowId} · {trigger.type} · Webhook: /api/automation/webhook
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={trigger.enabled}
                    onChange={(e) => {
                      const next = triggers.map((item) =>
                        item.id === trigger.id ? { ...item, enabled: e.target.checked } : item
                      );
                      setTriggers(next);
                      saveAutomationTriggers(next);
                    }}
                  />
                  Aktif
                </label>
              </div>
            ))}
          </section>
        )}

        {view === "queue" && (
          <section className="space-y-3">
            <div className="mb-4 flex flex-wrap gap-3">
              <select
                className={`${inputClassName} max-w-xs`}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                className={`${inputClassName} max-w-xs`}
                value={flowFilter}
                onChange={(e) => setFlowFilter(e.target.value)}
              >
                <option value="Tümü">Tüm akışlar</option>
                {N8N_FLOW_DEFINITIONS.map((flow) => (
                  <option key={flow.id} value={flow.id}>
                    {flow.name}
                  </option>
                ))}
              </select>
            </div>
            {filteredQueue.length === 0 ? (
              <p className="text-sm text-slate-400">Kuyrukta iş yok.</p>
            ) : (
              <AnnveroDataTable
                rows={filteredQueue}
                showToolbar={false}
                pageSize={20}
                exportFilename="otomasyon-kuyruk.csv"
                columns={[
                  { key: "name", label: "Görev", filterable: true },
                  { key: "module", label: "Modül", filterable: true },
                  { key: "status", label: "Durum", filterable: true },
                  { key: "retryCount", label: "Retry", sortable: true },
                  {
                    key: "startedAt",
                    label: "Başlangıç",
                    sortValue: (row) => row.startedAt,
                    render: (row) => row.startedAt?.slice(0, 19).replace("T", " ") || "—",
                  },
                  {
                    key: "errorMessage",
                    label: "Hata",
                    render: (row) => (
                      <span className="text-xs text-red-300">{row.errorMessage || "—"}</span>
                    ),
                  },
                  {
                    key: "actions",
                    label: "İşlem",
                    sortable: false,
                    render: (row) => (
                      <div className="flex flex-wrap gap-2">
                        {row.status === N8N_JOB_STATUS.BEKLIYOR ||
                        row.status === N8N_JOB_STATUS.RETRY ? (
                          <button
                            type="button"
                            onClick={() => runJob(row.id)}
                            className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold"
                          >
                            Çalıştır
                          </button>
                        ) : null}
                        {row.status === N8N_JOB_STATUS.HATA ? (
                          <button
                            type="button"
                            onClick={() => handleRetry(row.id)}
                            className="rounded-lg border border-amber-700 px-3 py-1 text-xs"
                          >
                            Retry
                          </button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </section>
        )}

        {view === "logs" && (
          <section className="space-y-2">
            <p className="mb-2 text-xs text-slate-500">İşlem logları silinemez (append-only).</p>
            {logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-slate-800 px-3 py-2 text-sm">
                <p className="font-medium">{log.action}</p>
                <p className="text-slate-400">
                  {log.message} · {log.userId || "sistem"} · {log.companyName || "—"} ·{" "}
                  {log.durationMs || 0}ms · {log.hasError ? "Hata" : "OK"}
                </p>
                <p className="text-xs text-slate-500">
                  {log.createdAt?.slice(0, 19).replace("T", " ")}
                </p>
              </div>
            ))}
          </section>
        )}

        {view === "errors" && (
          <section className="space-y-2">
            {errors.length === 0 ? (
              <p className="text-sm text-slate-400">Hata kaydı yok.</p>
            ) : (
              errors.map((err) => (
                <div
                  key={err.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium text-red-100">{err.flowId}</p>
                    <p className="text-red-200/90">{err.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRetry(err.jobId)}
                    className="rounded-lg border border-red-700 px-3 py-1 text-xs"
                  >
                    Retry
                  </button>
                </div>
              ))
            )}
          </section>
        )}

        {view === "schedules" && (
          <section className="space-y-3">
            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
              >
                <div>
                  <p className="font-medium">{schedule.name}</p>
                  <p className="text-xs text-slate-400">
                    {schedule.scheduleType} · cron: {schedule.cronHint} · Son:{" "}
                    {schedule.lastRunAt || "—"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => triggerFlow(schedule.flowId)}
                    className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold"
                  >
                    Manuel Tetikle
                  </button>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={schedule.enabled}
                      onChange={(e) => {
                        const next = schedules.map((item) =>
                          item.id === schedule.id ? { ...item, enabled: e.target.checked } : item
                        );
                        setSchedules(next);
                        saveAutomationSchedules(next);
                      }}
                    />
                    Aktif
                  </label>
                </div>
              </div>
            ))}
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <p className="mb-2 text-sm font-medium">Öğrenen Otomasyon Kuralı</p>
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${inputClassName} max-w-sm`}
                  placeholder="Desen (gönderen, banka, evrak türü)"
                  value={learnPattern}
                  onChange={(e) => setLearnPattern(e.target.value)}
                />
                <select
                  className={`${inputClassName} max-w-xs`}
                  value={learnFlowId}
                  onChange={(e) => setLearnFlowId(e.target.value)}
                >
                  {N8N_FLOW_DEFINITIONS.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={saveLearnRule}
                  className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold"
                >
                  Kural Öğret
                </button>
              </div>
            </div>
          </section>
        )}

        {view === "integrations" && (
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {N8N_INTEGRATION_PLACEHOLDERS.map((item) => (
              <div key={item.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                <p className="font-medium">{item.label}</p>
                <p className="text-xs text-slate-400">Durum: {item.status}</p>
                {item.id === "n8n" ? (
                  <p className="mt-2 text-xs text-orange-300">POST /api/automation/webhook</p>
                ) : null}
              </div>
            ))}
          </section>
        )}

        {scenarioResult ? (
          <section className="mt-6 rounded-2xl border border-emerald-800/40 bg-emerald-950/20 p-5 text-sm">
            <h2 className="mb-3 font-semibold text-emerald-100">Test Özeti</h2>
            <ul className="space-y-1 text-emerald-200/90">
              <li>Mail → Evrak Havuzu: {scenarioResult.mailToPool ? "OK" : "—"}</li>
              <li>Banka → Parser: {scenarioResult.bankToParser ? "OK" : "—"}</li>
              <li>Öğrenen otomasyon: {scenarioResult.learningMemoryFlow ? "OK" : "—"}</li>
              <li>Risk zamanlanmış görev: {scenarioResult.scheduledRisk ? "OK" : "—"}</li>
              <li>Retry kuyruğu: {scenarioResult.retryQueued ? "OK" : "—"}</li>
              <li>Dashboard sayaçları: {scenarioResult.dashboardCounts ? "OK" : "—"}</li>
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
