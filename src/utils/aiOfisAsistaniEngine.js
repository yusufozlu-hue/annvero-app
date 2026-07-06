import {
  AI_OFIS_DOCUMENT_STATUS,
  AI_OFIS_DOCUMENT_TYPES,
  AI_OFIS_LOCAL_RULES_STORAGE_KEY,
  AI_OFIS_MODULE_ROUTES,
  AI_OFIS_REMINDER_TYPES,
  AI_OFIS_SOURCES,
  AI_OFIS_TASK_TYPES,
  AI_OFIS_TYPE_KEYWORDS,
  AI_OFIS_DOCUMENTS_STORAGE_KEY,
  AI_OFIS_HISTORY_STORAGE_KEY,
  AI_OFIS_MAILS_STORAGE_KEY,
  AI_OFIS_REMINDERS_STORAGE_KEY,
  AI_OFIS_TASKS_STORAGE_KEY,
} from "@/src/config/aiOfisAsistaniDefaults";
import { createLearningMemoryRecord } from "@/src/utils/learningMemory";
import { buildSafeLearningMemoryPayload } from "@/src/utils/learningMemorySafePayload";
import { getCompanyDisplayName } from "@/src/utils/companies";

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeText(value = "") {
  return String(value)
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^a-z0-9@._\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function loadAiOfisDocuments() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(AI_OFIS_DOCUMENTS_STORAGE_KEY) || "[]", []);
}

export function saveAiOfisDocuments(documents = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AI_OFIS_DOCUMENTS_STORAGE_KEY, JSON.stringify(documents));
}

export function loadAiOfisMails() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(AI_OFIS_MAILS_STORAGE_KEY) || "[]", []);
}

export function saveAiOfisMails(mails = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AI_OFIS_MAILS_STORAGE_KEY, JSON.stringify(mails));
}

export function loadAiOfisTasks() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(AI_OFIS_TASKS_STORAGE_KEY) || "[]", []);
}

export function saveAiOfisTasks(tasks = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AI_OFIS_TASKS_STORAGE_KEY, JSON.stringify(tasks));
}

export function loadAiOfisReminders() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(AI_OFIS_REMINDERS_STORAGE_KEY) || "[]", []);
}

export function saveAiOfisReminders(reminders = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AI_OFIS_REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
}

export function loadAiOfisHistory() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(AI_OFIS_HISTORY_STORAGE_KEY) || "[]", []);
}

export function saveAiOfisHistory(history = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AI_OFIS_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

export function loadAiOfisLocalRules() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(AI_OFIS_LOCAL_RULES_STORAGE_KEY) || "[]", []);
}

export function saveAiOfisLocalRules(rules = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AI_OFIS_LOCAL_RULES_STORAGE_KEY, JSON.stringify(rules));
}

export function appendAiOfisHistory(entry = {}) {
  const history = loadAiOfisHistory();
  const record = {
    id: `hist-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  };
  const next = [record, ...history].slice(0, 500);
  saveAiOfisHistory(next);
  return record;
}

export function getModuleRouteForType(documentType = "Diğer") {
  return AI_OFIS_MODULE_ROUTES[documentType] || AI_OFIS_MODULE_ROUTES.Diğer;
}

function scoreKeywordMatch(text, keywords = []) {
  const normalized = normalizeText(text);
  let score = 0;
  keywords.forEach((keyword) => {
    if (normalized.includes(normalizeText(keyword))) score += 20;
  });
  return score;
}

function matchCompanyFromText(text = "", companies = []) {
  const normalized = normalizeText(text);
  let best = null;
  let bestScore = 0;

  companies.forEach((company) => {
    const name = normalizeText(getCompanyDisplayName(company));
    if (!name || name.length < 3) return;
    if (normalized.includes(name)) {
      const score = name.length;
      if (score > bestScore) {
        bestScore = score;
        best = company;
      }
    }
  });

  return best;
}

function applyLocalRules(context = {}, rules = []) {
  const haystack = normalizeText(
    `${context.fileName} ${context.subject} ${context.description} ${context.sender}`
  );

  for (const rule of rules) {
    const pattern = normalizeText(rule.pattern || "");
    if (!pattern || !haystack.includes(pattern)) continue;
    return {
      companyId: rule.companyId || "",
      companyName: rule.companyName || "",
      documentType: rule.documentType || "",
      confidence: Math.max(rule.confidence || 85, 75),
      source: "local_rule",
      ruleId: rule.id,
    };
  }

  return null;
}

export function classifyAiOfisDocument(input = {}, companies = [], rules = loadAiOfisLocalRules()) {
  const fileName = input.fileName || "";
  const subject = input.subject || input.mailSubject || "";
  const description = input.description || "";
  const sender = input.sender || "";
  const combined = `${fileName} ${subject} ${description} ${sender}`;

  const localMatch = applyLocalRules(
    { fileName, subject, description, sender },
    rules
  );
  if (localMatch?.documentType) {
    const route = getModuleRouteForType(localMatch.documentType);
    return {
      companyId: localMatch.companyId,
      companyName: localMatch.companyName,
      documentType: localMatch.documentType,
      targetModule: route.label,
      targetModuleHref: route.href,
      confidence: localMatch.confidence,
      urgent: false,
      missingInfo: !localMatch.companyId,
      classificationSource: "ogrenen_hafiza",
      explanation: "Öğrenilen kural ile eşleştirildi.",
    };
  }

  let bestType = "Diğer";
  let bestScore = 0;
  AI_OFIS_DOCUMENT_TYPES.forEach((type) => {
    const keywords = AI_OFIS_TYPE_KEYWORDS[type] || [];
    const score = scoreKeywordMatch(combined, keywords);
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  });

  const company = matchCompanyFromText(combined, companies);
  const confidence = Math.min(95, 35 + bestScore + (company ? 25 : 0));
  const route = getModuleRouteForType(bestType);
  const urgentTypes = new Set([
    "SGK tahakkuk",
    "KDV beyannamesi",
    "KDV2 beyannamesi",
    "Banka ekstresi",
  ]);

  return {
    companyId: company?.id || "",
    companyName: getCompanyDisplayName(company),
    documentType: bestType,
    targetModule: route.label,
    targetModuleHref: route.href,
    confidence,
    urgent: urgentTypes.has(bestType) && confidence >= 55,
    missingInfo: !company || confidence < 60,
    classificationSource: "ai_heuristic",
    explanation:
      confidence >= 70
        ? "Dosya adı ve içerik ipuçlarına göre sınıflandırıldı."
        : "Düşük güven; manuel kontrol önerilir.",
  };
}

export function buildAiOfisDocument(input = {}, companies = []) {
  const now = new Date().toISOString();
  const classification = classifyAiOfisDocument(input, companies);
  const status =
    classification.confidence >= 75 && classification.companyId
      ? AI_OFIS_DOCUMENT_STATUS.AI_SINIFLANDIRILDI
      : classification.missingInfo
        ? AI_OFIS_DOCUMENT_STATUS.MANUEL_KONTROL
        : AI_OFIS_DOCUMENT_STATUS.YENI;

  return {
    id: input.id || `doc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    companyId: input.companyId || classification.companyId,
    companyName: input.companyName || classification.companyName,
    documentType: input.documentType || classification.documentType,
    source: input.source || AI_OFIS_SOURCES.MANUEL,
    fileName: input.fileName || "",
    fileType: input.fileType || "",
    fileSize: input.fileSize || 0,
    uploadedAt: input.uploadedAt || now,
    status: input.status || status,
    aiConfidence: input.aiConfidence ?? classification.confidence,
    targetModule: input.targetModule || classification.targetModule,
    targetModuleHref: input.targetModuleHref || classification.targetModuleHref,
    description: input.description || "",
    mailId: input.mailId || "",
    urgent: input.urgent ?? classification.urgent,
    missingInfo: input.missingInfo ?? classification.missingInfo,
    classificationSource: classification.classificationSource,
    classificationExplanation: classification.explanation,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildAiOfisMail(input = {}, companies = []) {
  const now = new Date().toISOString();
  const classification = classifyAiOfisDocument(input, companies);

  return {
    id: input.id || `mail-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    subject: input.subject || "",
    sender: input.sender || "",
    receivedAt: input.receivedAt || now,
    attachmentNames: input.attachmentNames || [],
    bodyPreview: input.bodyPreview || "",
    companyId: input.companyId || classification.companyId,
    companyName: input.companyName || classification.companyName,
    predictedDocumentType: classification.documentType,
    aiConfidence: classification.confidence,
    integrationReady: {
      imap: false,
      gmail: false,
      n8n: true,
    },
    source: input.source || AI_OFIS_SOURCES.MAIL,
    status: "Manuel aktarım",
    createdAt: now,
  };
}

export async function learnFromAiOfisCorrection({
  companyId = "",
  companyName = "",
  documentType = "",
  pattern = "",
  sender = "",
  subject = "",
  fileName = "",
}) {
  const rules = loadAiOfisLocalRules();
  const normalizedPattern =
    normalizeText(pattern) ||
    normalizeText(sender) ||
    normalizeText(subject) ||
    normalizeText(fileName).split(" ")[0];

  if (!normalizedPattern) return null;

  const rule = {
    id: `rule-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    pattern: normalizedPattern,
    companyId,
    companyName,
    documentType,
    confidence: 90,
    learnedAt: new Date().toISOString(),
  };

  const nextRules = [rule, ...rules.filter((item) => item.pattern !== normalizedPattern)].slice(
    0,
    200
  );
  saveAiOfisLocalRules(nextRules);

  if (companyId) {
    const payload = buildSafeLearningMemoryPayload({
      companyId,
      rawDescription: `${sender} ${subject} ${fileName}`.trim(),
      cleanDescription: `${documentType} | ${companyName}`,
      keyword: normalizedPattern,
      documentType,
      userCorrection: `${companyName} -> ${documentType}`,
      status: "learned",
    });

    try {
      await createLearningMemoryRecord(payload);
    } catch {
      // local rule yeterli
    }
  }

  appendAiOfisHistory({
    action: "ogrenme_kaydi",
    message: `Öğrenilen eşleşme: ${normalizedPattern} → ${companyName} / ${documentType}`,
    companyId,
    documentType,
  });

  return rule;
}

export function buildAiOfisTasksFromDocument(document = {}) {
  const tasks = [];
  const base = {
    companyId: document.companyId,
    companyName: document.companyName,
    documentId: document.id,
    createdAt: new Date().toISOString(),
    status: "Açık",
  };

  if (document.missingInfo || document.status === AI_OFIS_DOCUMENT_STATUS.EKSIK_BILGI) {
    tasks.push({
      ...base,
      id: `task-missing-${document.id}`,
      type: AI_OFIS_TASK_TYPES[0],
      title: "Eksik evrak bilgisi tamamlanmalı",
      priority: "Yüksek",
    });
  }

  if (document.documentType === "Banka ekstresi" && document.status !== AI_OFIS_DOCUMENT_STATUS.ISLENDI) {
    tasks.push({
      ...base,
      id: `task-bank-${document.id}`,
      type: AI_OFIS_TASK_TYPES[1],
      title: "İşlenecek banka ekstresi",
      priority: document.urgent ? "Yüksek" : "Orta",
    });
  }

  if (
    ["SGK tahakkuk", "KDV beyannamesi", "KDV2 beyannamesi", "MUHSGK"].includes(
      document.documentType
    ) &&
    document.status !== AI_OFIS_DOCUMENT_STATUS.ISLENDI
  ) {
    tasks.push({
      ...base,
      id: `task-decl-${document.id}`,
      type: AI_OFIS_TASK_TYPES[2],
      title: "Kontrol edilecek beyanname/tahakkuk",
      priority: "Yüksek",
    });
  }

  if (document.urgent) {
    tasks.push({
      ...base,
      id: `task-urgent-${document.id}`,
      type: AI_OFIS_TASK_TYPES[3],
      title: "Süresi yaklaşan işlem",
      priority: "Yüksek",
    });
  }

  if (document.status === AI_OFIS_DOCUMENT_STATUS.MANUEL_KONTROL) {
    tasks.push({
      ...base,
      id: `task-info-${document.id}`,
      type: AI_OFIS_TASK_TYPES[4],
      title: "Müşteriden bilgi istenecek belge",
      priority: "Orta",
    });
  }

  return tasks;
}

export function buildAiOfisReminders(documents = [], tasks = []) {
  const reminders = [];
  const openStatuses = new Set([
    AI_OFIS_DOCUMENT_STATUS.YENI,
    AI_OFIS_DOCUMENT_STATUS.AI_SINIFLANDIRILDI,
    AI_OFIS_DOCUMENT_STATUS.MANUEL_KONTROL,
    AI_OFIS_DOCUMENT_STATUS.MODULE_AKTARILDI,
    AI_OFIS_DOCUMENT_STATUS.EKSIK_BILGI,
  ]);

  documents.forEach((doc) => {
    if (!openStatuses.has(doc.status)) return;

    reminders.push({
      id: `rem-doc-${doc.id}`,
      type: AI_OFIS_REMINDER_TYPES.BEKLEYEN_EVRAK,
      message: `Bekleyen evrak: ${doc.fileName || doc.documentType}`,
      companyId: doc.companyId,
      companyName: doc.companyName,
      documentId: doc.id,
    });

    if (doc.documentType === "Banka ekstresi") {
      reminders.push({
        id: `rem-bank-${doc.id}`,
        type: AI_OFIS_REMINDER_TYPES.BANKA_EKSTRESI,
        message: `İşlenmemiş banka ekstresi: ${doc.fileName}`,
        companyId: doc.companyId,
        documentId: doc.id,
      });
    }

    if (["SGK tahakkuk", "KDV beyannamesi", "KDV2 beyannamesi", "MUHSGK"].includes(doc.documentType)) {
      reminders.push({
        id: `rem-decl-${doc.id}`,
        type: AI_OFIS_REMINDER_TYPES.BEYANNAME,
        message: `Eksik beyanname/tahakkuk kontrolü: ${doc.documentType}`,
        companyId: doc.companyId,
        documentId: doc.id,
      });
    }

    if (doc.documentType === "Personel belgesi") {
      reminders.push({
        id: `rem-hr-${doc.id}`,
        type: AI_OFIS_REMINDER_TYPES.PERSONEL,
        message: `Eksik personel belgesi: ${doc.fileName}`,
        companyId: doc.companyId,
        documentId: doc.id,
      });
    }

    if (doc.documentType === "Ticaret sicil evrakı") {
      reminders.push({
        id: `rem-ts-${doc.id}`,
        type: AI_OFIS_REMINDER_TYPES.TICARET_SICIL,
        message: `Ticaret sicil eksik evrak: ${doc.fileName}`,
        companyId: doc.companyId,
        documentId: doc.id,
      });
    }

    if (doc.status === AI_OFIS_DOCUMENT_STATUS.MANUEL_KONTROL) {
      reminders.push({
        id: `rem-cust-${doc.id}`,
        type: AI_OFIS_REMINDER_TYPES.MUSTERI_DONUS,
        message: `Müşteri dönüşü bekleniyor: ${doc.fileName || doc.documentType}`,
        companyId: doc.companyId,
        documentId: doc.id,
      });
    }
  });

  tasks
    .filter((task) => task.status === "Açık" && task.priority === "Yüksek")
    .forEach((task) => {
      reminders.push({
        id: `rem-task-${task.id}`,
        type: AI_OFIS_REMINDER_TYPES.BEKLEYEN_EVRAK,
        message: `Geciken iş: ${task.title}`,
        companyId: task.companyId,
        taskId: task.id,
      });
    });

  return reminders;
}

export function buildAiOfisDashboardStats(documents = [], tasks = []) {
  const today = new Date().toISOString().slice(0, 10);
  const openStatuses = new Set([
    AI_OFIS_DOCUMENT_STATUS.YENI,
    AI_OFIS_DOCUMENT_STATUS.AI_SINIFLANDIRILDI,
    AI_OFIS_DOCUMENT_STATUS.MANUEL_KONTROL,
    AI_OFIS_DOCUMENT_STATUS.MODULE_AKTARILDI,
    AI_OFIS_DOCUMENT_STATUS.EKSIK_BILGI,
  ]);

  return {
    incomingCount: documents.length,
    unprocessedCount: documents.filter((doc) => openStatuses.has(doc.status)).length,
    aiMatchedCount: documents.filter((doc) => doc.aiConfidence >= 75 && doc.companyId).length,
    manualReviewCount: documents.filter(
      (doc) => doc.status === AI_OFIS_DOCUMENT_STATUS.MANUEL_KONTROL
    ).length,
    tasksToday: tasks.filter((task) => String(task.createdAt || "").startsWith(today)).length,
    overdueCount: tasks.filter((task) => task.status === "Açık" && task.priority === "Yüksek")
      .length,
  };
}

export function filterAiOfisDocuments(
  documents = [],
  {
    companyId = "",
    documentType = "",
    source = "",
    status = "",
    dateFrom = "",
    dateTo = "",
    targetModule = "",
    minConfidence = 0,
  } = {}
) {
  return documents.filter((doc) => {
    if (companyId && doc.companyId !== companyId) return false;
    if (documentType && documentType !== "Tümü" && doc.documentType !== documentType) return false;
    if (source && source !== "Tümü" && doc.source !== source) return false;
    if (status && status !== "Tümü" && doc.status !== status) return false;
    if (targetModule && targetModule !== "Tümü" && doc.targetModule !== targetModule) return false;
    if (minConfidence && (doc.aiConfidence || 0) < minConfidence) return false;

    const date = String(doc.uploadedAt || "").slice(0, 10);
    if (dateFrom && date && date < dateFrom) return false;
    if (dateTo && date && date > dateTo) return false;
    return true;
  });
}

export async function readAiOfisDocumentFile(file) {
  const allowed =
    /\.(pdf|doc|docx|xls|xlsx|csv|xml|zip|jpe?g|png|webp|txt)$/i.test(file.name) ||
    [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/xml",
      "text/xml",
      "application/zip",
      "image/jpeg",
      "image/png",
      "image/webp",
      "text/plain",
    ].includes(file.type);

  if (!allowed) throw new Error("Desteklenmeyen dosya türü.");

  return {
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    fileSize: file.size,
  };
}

export function updateAiOfisDocument(documents, documentId, patch = {}) {
  return documents.map((doc) =>
    doc.id === documentId ? { ...doc, ...patch, updatedAt: new Date().toISOString() } : doc
  );
}

export function syncTasksForDocuments(documents = [], existingTasks = []) {
  const generated = documents.flatMap((doc) => buildAiOfisTasksFromDocument(doc));
  const map = new Map(existingTasks.map((task) => [task.id, task]));
  generated.forEach((task) => {
    if (!map.has(task.id)) map.set(task.id, task);
  });
  return Array.from(map.values());
}

export function runAiOfisScenario(companies = []) {
  const samples = [
    { fileName: "ABC_Ltd_Banka_Ekstre_Mart.xlsx", description: "banka ekstre" },
    { fileName: "SGK_Tahakkuk_Nisan.pdf", description: "sgk tahakkuk" },
    { fileName: "personel_ise_giris_belgesi.pdf", description: "personel belgesi" },
    { fileName: "ticaret_sicil_kurulus_evraki.pdf", description: "ticaret sicil" },
  ];

  const docs = samples.map((sample) =>
    buildAiOfisDocument(
      {
        fileName: sample.fileName,
        description: sample.description,
        source: AI_OFIS_SOURCES.MANUEL,
      },
      companies
    )
  );

  const bankDoc = docs[0];
  const sgkDoc = docs[1];
  const hrDoc = docs[2];
  const tsDoc = docs[3];

  const corrected = updateAiOfisDocument(docs, bankDoc.id, {
    companyId: companies[0]?.id || "demo-company",
    companyName: getCompanyDisplayName(companies[0]) || "Demo Firma",
    documentType: "Banka ekstresi",
    status: AI_OFIS_DOCUMENT_STATUS.AI_SINIFLANDIRILDI,
    aiConfidence: 92,
  });

  const rules = loadAiOfisLocalRules();
  const localRule = {
    id: "rule-test",
    pattern: normalizeText("abc_ltd_banka"),
    companyId: companies[0]?.id || "demo-company",
    companyName: getCompanyDisplayName(companies[0]) || "Demo Firma",
    documentType: "Banka ekstresi",
    confidence: 90,
  };
  saveAiOfisLocalRules([localRule, ...rules.filter((r) => r.id !== "rule-test")]);

  const relearned = classifyAiOfisDocument(
    { fileName: "ABC_Ltd_Banka_Ekstre_Nisan.xlsx" },
    companies,
    [localRule]
  );

  const tasks = syncTasksForDocuments(corrected, []);
  const stats = buildAiOfisDashboardStats(corrected, tasks);

  if (typeof window !== "undefined") {
    saveAiOfisDocuments(corrected);
    saveAiOfisTasks(tasks);
    saveAiOfisReminders(buildAiOfisReminders(corrected, tasks));
  }

  return {
    bankRoutedToParser:
      getModuleRouteForType(bankDoc.documentType).href === "/muhasebe/banka-ekstresi",
    sgkRoutedToDeclaration:
      getModuleRouteForType(sgkDoc.documentType).href === "/muhasebe/beyanname-tahakkuk",
    hrRoutedToIk: getModuleRouteForType(hrDoc.documentType).href === "/ik-personel",
    tradeRegistryRouted:
      getModuleRouteForType(tsDoc.documentType).href === "/ticaret-sicil",
    learningWorks: relearned.companyId === localRule.companyId,
    dashboardUpdated: stats.incomingCount === 4 && stats.unprocessedCount >= 1,
    aiMatchedCount: stats.aiMatchedCount,
    manualReviewCount: stats.manualReviewCount,
    tasksGenerated: tasks.length,
  };
}
