import {
  N8N_AUTOMATION_APPROVALS_STORAGE_KEY,
  N8N_AUTOMATION_ERRORS_STORAGE_KEY,
  N8N_AUTOMATION_LOGS_STORAGE_KEY,
  N8N_AUTOMATION_QUEUE_STORAGE_KEY,
  N8N_AUTOMATION_RULES_STORAGE_KEY,
  N8N_AUTOMATION_SCHEDULES_STORAGE_KEY,
  N8N_AUTOMATION_TRIGGERS_STORAGE_KEY,
  N8N_CRITICAL_FLOWS,
  N8N_FLOW_DEFINITIONS,
  N8N_FLOW_MODULE_ROUTES,
  N8N_JOB_STATUS,
  N8N_MAX_RETRY,
  N8N_SCHEDULE_TYPES,
} from "@/src/config/n8nOtomasyonDefaults";
import { buildAiOfisDocument } from "@/src/utils/aiOfisAsistaniEngine";

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = "") {
  return String(value)
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .replace(/[^a-z0-9@._\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function loadAutomationQueue() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(N8N_AUTOMATION_QUEUE_STORAGE_KEY) || "[]", []);
}

export function saveAutomationQueue(queue = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(N8N_AUTOMATION_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

export function loadAutomationLogs() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(N8N_AUTOMATION_LOGS_STORAGE_KEY) || "[]", []);
}

export function appendAutomationLog(entry = {}) {
  const logs = loadAutomationLogs();
  const record = {
    id: `log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: nowIso(),
    durationMs: entry.durationMs ?? 0,
    hasError: Boolean(entry.hasError),
    ...entry,
  };
  const next = [record, ...logs].slice(0, 1000);
  if (typeof window !== "undefined") {
    localStorage.setItem(N8N_AUTOMATION_LOGS_STORAGE_KEY, JSON.stringify(next));
  }
  return record;
}

export function loadAutomationErrors() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(N8N_AUTOMATION_ERRORS_STORAGE_KEY) || "[]", []);
}

export function saveAutomationErrors(errors = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(N8N_AUTOMATION_ERRORS_STORAGE_KEY, JSON.stringify(errors));
}

export function loadAutomationTriggers() {
  if (typeof window === "undefined") return [];
  const stored = safeParseJson(localStorage.getItem(N8N_AUTOMATION_TRIGGERS_STORAGE_KEY) || "[]", []);
  if (stored.length) return stored;
  return N8N_FLOW_DEFINITIONS.map((flow) => ({
    id: `trg-${flow.id}`,
    flowId: flow.id,
    name: flow.name,
    type: "webhook",
    enabled: true,
    createdAt: nowIso(),
  }));
}

export function saveAutomationTriggers(triggers = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(N8N_AUTOMATION_TRIGGERS_STORAGE_KEY, JSON.stringify(triggers));
}

export function loadAutomationSchedules() {
  if (typeof window === "undefined") return [];
  const stored = safeParseJson(localStorage.getItem(N8N_AUTOMATION_SCHEDULES_STORAGE_KEY) || "[]", []);
  if (stored.length) return stored;
  return [
    {
      id: "sch-risk-daily",
      flowId: "risk-daily",
      name: "Günlük Risk Analizi",
      scheduleType: N8N_SCHEDULE_TYPES.DAILY,
      cronHint: "0 2 * * *",
      enabled: true,
      lastRunAt: "",
      nextRunAt: "",
    },
    {
      id: "sch-bank-weekly",
      flowId: "bank-parser",
      name: "Haftalık Banka Parser Kontrolü",
      scheduleType: N8N_SCHEDULE_TYPES.WEEKLY,
      cronHint: "0 6 * * 1",
      enabled: false,
      lastRunAt: "",
      nextRunAt: "",
    },
    {
      id: "sch-decl-monthly",
      flowId: "declaration-distribution",
      name: "Aylık Beyanname Dağılım Kontrolü",
      scheduleType: N8N_SCHEDULE_TYPES.MONTHLY,
      cronHint: "0 7 1 * *",
      enabled: false,
      lastRunAt: "",
      nextRunAt: "",
    },
  ];
}

export function saveAutomationSchedules(schedules = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(N8N_AUTOMATION_SCHEDULES_STORAGE_KEY, JSON.stringify(schedules));
}

export function loadAutomationRules() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(N8N_AUTOMATION_RULES_STORAGE_KEY) || "[]", []);
}

export function saveAutomationRules(rules = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(N8N_AUTOMATION_RULES_STORAGE_KEY, JSON.stringify(rules));
}

export function loadAutomationApprovals() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(N8N_AUTOMATION_APPROVALS_STORAGE_KEY) || "[]", []);
}

export function saveAutomationApprovals(approvals = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(N8N_AUTOMATION_APPROVALS_STORAGE_KEY, JSON.stringify(approvals));
}

export function getFlowDefinition(flowId = "") {
  return N8N_FLOW_DEFINITIONS.find((flow) => flow.id === flowId) || null;
}

export function resolveFlowFromPayload(payload = {}, rules = loadAutomationRules()) {
  if (payload.flowId) return payload.flowId;

  const haystack = normalizeText(
    `${payload.fileName} ${payload.subject} ${payload.sender} ${payload.documentType} ${payload.bankName}`
  );

  for (const rule of rules) {
    const pattern = normalizeText(rule.pattern || "");
    if (pattern && haystack.includes(pattern)) return rule.flowId;
  }

  if (haystack.includes("mail") || haystack.includes("ek dosya")) return "mail-to-pool";
  if (haystack.includes("banka") || haystack.includes("ekstre")) return "bank-parser";
  if (haystack.includes("sgk") || haystack.includes("tahakkuk") || haystack.includes("beyan"))
    return "declaration-distribution";
  if (haystack.includes("edefter") || haystack.includes("xml") || haystack.includes("zip"))
    return "edefter-check";
  if (payload.scheduled) return "risk-daily";

  return payload.flowId || "mail-to-pool";
}

export function buildAutomationJob(input = {}) {
  const flowId = input.flowId || "mail-to-pool";
  const flow = getFlowDefinition(flowId);
  const now = nowIso();

  return {
    id: input.id || `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: input.name || flow?.name || "Otomasyon işi",
    flowId,
    module: input.module || flow?.module || "Sistem",
    status: input.status || N8N_JOB_STATUS.BEKLIYOR,
    startedAt: input.startedAt || "",
    finishedAt: input.finishedAt || "",
    errorMessage: input.errorMessage || "",
    retryCount: input.retryCount || 0,
    aiNote: input.aiNote || "",
    companyId: input.companyId || "",
    companyName: input.companyName || "",
    triggeredBy: input.triggeredBy || "sistem",
    payload: input.payload || {},
    requiresApproval: N8N_CRITICAL_FLOWS.has(flowId) && input.requiresApproval !== false,
    approvalStatus: input.approvalStatus || "none",
    createdAt: now,
    updatedAt: now,
  };
}

export function learnAutomationRule({
  flowId = "",
  pattern = "",
  documentType = "",
  sender = "",
  bankName = "",
  userId = "",
}) {
  const normalizedPattern =
    normalizeText(pattern) ||
    normalizeText(sender) ||
    normalizeText(bankName) ||
    normalizeText(documentType);

  if (!normalizedPattern || !flowId) return null;

  const rules = loadAutomationRules();
  const rule = {
    id: `rule-${Date.now()}`,
    flowId,
    pattern: normalizedPattern,
    documentType,
    sender,
    bankName,
    learnedBy: userId || "kullanici",
    learnedAt: nowIso(),
  };
  const next = [rule, ...rules.filter((item) => item.pattern !== normalizedPattern)].slice(0, 200);
  saveAutomationRules(next);
  appendAutomationLog({
    action: "ogrenme",
    flowId,
    message: `Öğrenilen otomasyon kuralı: ${normalizedPattern} → ${flowId}`,
    userId,
  });
  return rule;
}

async function simulateFlowExecution(job = {}, companies = []) {
  const flowId = job.flowId;
  const started = Date.now();
  let aiNote = "";
  let status = N8N_JOB_STATUS.TAMAMLANDI;
  let errorMessage = "";
  const payload = job.payload || {};

  try {
    switch (flowId) {
      case "mail-to-pool": {
        const doc = buildAiOfisDocument(
          {
            fileName: payload.fileName || "mail_eki.pdf",
            source: "n8n",
            subject: payload.subject,
            sender: payload.sender,
            description: payload.description || "Mail eki otomasyon",
          },
          companies
        );
        aiNote = `Evrak havuzuna eklendi: ${doc.documentType} (%${doc.aiConfidence})`;
        break;
      }
      case "bank-parser": {
        aiNote = "Banka parser simülasyonu çalıştı; öğrenen hafıza kontrol edildi.";
        if (!payload.fileName) {
          status = N8N_JOB_STATUS.UYARI;
          aiNote = "Unknown queue: dosya adı eksik, manuel kontrol önerildi.";
        }
        break;
      }
      case "declaration-distribution": {
        aiNote = "Tahakkuk evrağı dağılım merkezine yönlendirildi.";
        if (!payload.companyId) {
          status = N8N_JOB_STATUS.UYARI;
          aiNote = "Eksik firma eşleşmesi; görev oluşturuldu.";
        }
        break;
      }
      case "risk-daily": {
        aiNote = "Günlük risk analizi tamamlandı; kritik bulgular dashboard'a yazıldı.";
        break;
      }
      case "edefter-check": {
        aiNote = "E-defter XML/ZIP kontrolü tamamlandı.";
        if (payload.hasTechnicalError) {
          status = N8N_JOB_STATUS.UYARI;
          aiNote = "Teknik hata loglandı.";
        }
        break;
      }
      default:
        aiNote = "Akış tamamlandı.";
    }
  } catch (error) {
    status = N8N_JOB_STATUS.HATA;
    errorMessage = error.message || "Bilinmeyen hata";
  }

  return {
    status,
    errorMessage,
    aiNote,
    durationMs: Date.now() - started,
    targetHref: N8N_FLOW_MODULE_ROUTES[flowId] || "/otomasyon",
  };
}

export async function processAutomationJob(jobId, companies = [], userId = "sistem") {
  const queue = loadAutomationQueue();
  const index = queue.findIndex((job) => job.id === jobId);
  if (index < 0) return null;

  const job = queue[index];
  if (job.requiresApproval && job.approvalStatus !== "approved") {
    const approvals = loadAutomationApprovals();
    saveAutomationApprovals([
      {
        id: `appr-${job.id}`,
        jobId: job.id,
        flowId: job.flowId,
        status: "pending",
        requestedAt: nowIso(),
        requestedBy: userId,
      },
      ...approvals,
    ]);
    queue[index] = {
      ...job,
      status: N8N_JOB_STATUS.BEKLIYOR,
      aiNote: "Kritik işlem onayı bekliyor.",
      updatedAt: nowIso(),
    };
    saveAutomationQueue(queue);
    return queue[index];
  }

  queue[index] = {
    ...job,
    status: N8N_JOB_STATUS.CALISIYOR,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  saveAutomationQueue(queue);

  const result = await simulateFlowExecution(queue[index], companies);

  queue[index] = {
    ...queue[index],
    status: result.status,
    finishedAt: nowIso(),
    errorMessage: result.errorMessage,
    aiNote: result.aiNote,
    updatedAt: nowIso(),
  };
  saveAutomationQueue(queue);

  appendAutomationLog({
    action: "flow_run",
    jobId: job.id,
    flowId: job.flowId,
    module: job.module,
    companyId: job.companyId,
    companyName: job.companyName,
    userId,
    message: result.aiNote,
    durationMs: result.durationMs,
    hasError: result.status === N8N_JOB_STATUS.HATA,
    targetHref: result.targetHref,
  });

  if (result.status === N8N_JOB_STATUS.HATA) {
    const errors = loadAutomationErrors();
    saveAutomationErrors([
      {
        id: `err-${job.id}-${Date.now()}`,
        jobId: job.id,
        flowId: job.flowId,
        message: result.errorMessage || result.aiNote,
        createdAt: nowIso(),
        retryCount: job.retryCount,
      },
      ...errors,
    ]);
  }

  return queue[index];
}

export function retryAutomationJob(jobId) {
  const queue = loadAutomationQueue();
  const index = queue.findIndex((job) => job.id === jobId);
  if (index < 0) return null;

  const job = queue[index];
  if (job.retryCount >= N8N_MAX_RETRY) {
    queue[index] = {
      ...job,
      status: N8N_JOB_STATUS.HATA,
      errorMessage: "Maksimum retry sayısına ulaşıldı.",
      updatedAt: nowIso(),
    };
    saveAutomationQueue(queue);
    return queue[index];
  }

  queue[index] = {
    ...job,
    status: N8N_JOB_STATUS.RETRY,
    retryCount: (job.retryCount || 0) + 1,
    errorMessage: "",
    startedAt: "",
    finishedAt: "",
    updatedAt: nowIso(),
  };
  saveAutomationQueue(queue);
  return queue[index];
}

export function enqueueAutomationJob(input = {}, companies = []) {
  const flowId = resolveFlowFromPayload(input.payload || input, loadAutomationRules());
  const job = buildAutomationJob({
    ...input,
    flowId,
    payload: input.payload || input,
  });
  const queue = loadAutomationQueue();
  const next = [job, ...queue];
  saveAutomationQueue(next);
  appendAutomationLog({
    action: "enqueue",
    jobId: job.id,
    flowId: job.flowId,
    message: `${job.name} kuyruğa eklendi`,
    userId: input.triggeredBy || "sistem",
    companyId: job.companyId,
    companyName: job.companyName,
  });
  return job;
}

export function buildAutomationDashboardStats(queue = [], errors = []) {
  const today = new Date().toISOString().slice(0, 10);
  const activeFlows = N8N_FLOW_DEFINITIONS.length;
  const todayJobs = queue.filter((job) => String(job.createdAt || "").startsWith(today));
  const successJobs = queue.filter((job) => job.status === N8N_JOB_STATUS.TAMAMLANDI);
  const failedJobs = queue.filter(
    (job) => job.status === N8N_JOB_STATUS.HATA || job.status === N8N_JOB_STATUS.UYARI
  );
  const retryPending = queue.filter((job) => job.status === N8N_JOB_STATUS.RETRY);
  const criticalAlerts = errors.filter((err) =>
    ["risk-daily", "bank-parser"].includes(err.flowId)
  ).length;

  return {
    activeFlows,
    todayJobCount: todayJobs.length,
    successCount: successJobs.length,
    failedCount: failedJobs.length,
    retryPendingCount: retryPending.length,
    criticalAlertCount: criticalAlerts,
  };
}

export function filterAutomationQueue(
  queue = [],
  { status = "", module = "", flowId = "", dateFrom = "", dateTo = "" } = {}
) {
  return queue.filter((job) => {
    if (status && status !== "Tümü" && job.status !== status) return false;
    if (module && module !== "Tümü" && job.module !== module) return false;
    if (flowId && flowId !== "Tümü" && job.flowId !== flowId) return false;
    const date = String(job.createdAt || "").slice(0, 10);
    if (dateFrom && date && date < dateFrom) return false;
    if (dateTo && date && date > dateTo) return false;
    return true;
  });
}

export function approveAutomationJob(jobId, userId = "admin") {
  const queue = loadAutomationQueue();
  const index = queue.findIndex((job) => job.id === jobId);
  if (index < 0) return null;
  queue[index] = {
    ...queue[index],
    approvalStatus: "approved",
    aiNote: `${userId} tarafından onaylandı.`,
    updatedAt: nowIso(),
  };
  saveAutomationQueue(queue);
  const approvals = loadAutomationApprovals().map((item) =>
    item.jobId === jobId ? { ...item, status: "approved", approvedBy: userId, approvedAt: nowIso() } : item
  );
  saveAutomationApprovals(approvals);
  return queue[index];
}

export function buildJobFromWebhookPayload(body = {}) {
  const flowId = resolveFlowFromPayload(body);
  const flow = getFlowDefinition(flowId);
  return buildAutomationJob({
    flowId,
    name: body.name || flow?.name,
    module: flow?.module,
    companyId: body.companyId || "",
    companyName: body.companyName || "",
    triggeredBy: body.triggeredBy || "n8n_webhook",
    payload: body,
  });
}

export async function runN8nAutomationScenario(companies = []) {
  const mailJob = enqueueAutomationJob(
    {
      triggeredBy: "test",
      payload: {
        fileName: "musteri_mail_eki_fatura.pdf",
        subject: "Fatura eki",
        sender: "muhasebe@musteri.com",
      },
    },
    companies
  );

  await processAutomationJob(mailJob.id, companies, "test");

  const bankJob = enqueueAutomationJob(
    {
      triggeredBy: "test",
      payload: { fileName: "ziraat_ekstre_ocak.xlsx", bankName: "ziraat" },
    },
    companies
  );
  await processAutomationJob(bankJob.id, companies, "test");

  learnAutomationRule({
    flowId: "bank-parser",
    bankName: "ziraat",
    userId: "test",
  });

  const relearnedFlow = resolveFlowFromPayload(
    { fileName: "ziraat_hesap_ozeti.xlsx", bankName: "ziraat" },
    loadAutomationRules()
  );

  const riskJob = enqueueAutomationJob(
    { flowId: "risk-daily", triggeredBy: "scheduler", payload: { scheduled: true } },
    companies
  );
  await processAutomationJob(riskJob.id, companies, "test");

  const failedJob = buildAutomationJob({
    flowId: "bank-parser",
    status: N8N_JOB_STATUS.HATA,
    errorMessage: "Parser timeout",
    retryCount: 0,
    payload: { fileName: "" },
  });
  const queue = loadAutomationQueue();
  saveAutomationQueue([failedJob, ...queue]);
  const retried = retryAutomationJob(failedJob.id);

  const finalQueue = loadAutomationQueue();
  const errors = loadAutomationErrors();
  const stats = buildAutomationDashboardStats(finalQueue, errors);

  return {
    mailToPool: mailJob.flowId === "mail-to-pool",
    bankToParser: bankJob.flowId === "bank-parser",
    learningMemoryFlow: relearnedFlow === "bank-parser",
    scheduledRisk: riskJob.flowId === "risk-daily",
    retryQueued: retried?.status === N8N_JOB_STATUS.RETRY,
    dashboardCounts: stats.todayJobCount >= 1 && stats.activeFlows >= 5,
    successCount: stats.successCount,
    failedCount: stats.failedCount,
    retryPendingCount: stats.retryPendingCount,
  };
}
