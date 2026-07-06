import {
  TICARET_SICIL_CHECKLISTS,
  TICARET_SICIL_DOCUMENTS_STORAGE_KEY,
  TICARET_SICIL_DOCUMENT_TEMPLATES,
  TICARET_SICIL_OPERATION_STATUS,
  TICARET_SICIL_OPERATIONS_STORAGE_KEY,
  TICARET_SICIL_PROFILE_STORAGE_KEY,
  TICARET_SICIL_REMINDER_TYPES,
} from "@/src/config/ticaretSicilDefaults";

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function emptyTicaretSicilProfile(companyId = "") {
  return {
    companyId,
    companyType: "",
    mersisNo: "",
    taxNumber: "",
    tradeRegistryNo: "",
    foundedAt: "",
    headquartersAddress: "",
    partnerStructure: "",
    managerInfo: "",
    updatedAt: new Date().toISOString(),
  };
}

export function buildChecklistForType(type) {
  return (TICARET_SICIL_CHECKLISTS[type] || []).map((label, index) => ({
    id: `chk-${index + 1}`,
    label,
    completed: false,
    documentId: "",
  }));
}

export function buildOperation(input = {}) {
  const type = input.type || "Şirket kuruluşu";
  const checklist = input.checklist?.length ? input.checklist : buildChecklistForType(type);
  const now = new Date().toISOString();

  return {
    id: input.id || `op-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    companyId: input.companyId || "",
    companyName: input.companyName || "",
    type,
    status: input.status || TICARET_SICIL_OPERATION_STATUS.EVRAK_BEKLENIYOR,
    checklist,
    suggestedDocuments: suggestDocumentsForOperation(type),
    dates: {
      applicationDate: input.dates?.applicationDate || "",
      registrationDate: input.dates?.registrationDate || "",
      announcementDate: input.dates?.announcementDate || "",
      lastActionDate: input.dates?.lastActionDate || now.slice(0, 10),
      deadlineDate: input.dates?.deadlineDate || "",
    },
    notes: input.notes || "",
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function suggestDocumentsForOperation(type) {
  const checklist = TICARET_SICIL_CHECKLISTS[type] || [];
  const templateMap = {
    "Genel kurul": ["genel-kurul-karari"],
    "Müdür değişikliği": ["mudur-karari"],
    "Adres değişikliği": ["adres-degisikligi-karari"],
    "Sermaye artırımı": ["sermaye-artirimi-karari"],
    "Sermaye azaltımı": ["sermaye-artirimi-karari"],
  };
  const templateIds = templateMap[type] || [];
  const templates = TICARET_SICIL_DOCUMENT_TEMPLATES.filter((item) =>
    templateIds.includes(item.id)
  );

  return {
    checklistItems: checklist,
    templates,
    summary: `${type} için ${checklist.length} evrak önerildi.`,
  };
}

export function loadTicaretSicilProfiles() {
  if (typeof window === "undefined") return {};
  return safeParseJson(localStorage.getItem(TICARET_SICIL_PROFILE_STORAGE_KEY) || "{}", {});
}

export function saveTicaretSicilProfiles(profiles = {}) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TICARET_SICIL_PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

export function getTicaretSicilProfile(companyId, fallback = {}) {
  const profiles = loadTicaretSicilProfiles();
  return {
    ...emptyTicaretSicilProfile(companyId),
    ...profiles[companyId],
    companyId,
    taxNumber: profiles[companyId]?.taxNumber || fallback.taxNumber || "",
    headquartersAddress:
      profiles[companyId]?.headquartersAddress || fallback.address || "",
  };
}

export function saveTicaretSicilProfile(companyId, profile = {}) {
  const profiles = loadTicaretSicilProfiles();
  profiles[companyId] = {
    ...emptyTicaretSicilProfile(companyId),
    ...profile,
    companyId,
    updatedAt: new Date().toISOString(),
  };
  saveTicaretSicilProfiles(profiles);
  return profiles[companyId];
}

export function loadTicaretSicilOperations() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(TICARET_SICIL_OPERATIONS_STORAGE_KEY) || "[]", []);
}

export function saveTicaretSicilOperations(operations = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TICARET_SICIL_OPERATIONS_STORAGE_KEY, JSON.stringify(operations));
}

export function loadTicaretSicilDocuments() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(TICARET_SICIL_DOCUMENTS_STORAGE_KEY) || "[]", []);
}

export function saveTicaretSicilDocuments(documents = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TICARET_SICIL_DOCUMENTS_STORAGE_KEY, JSON.stringify(documents));
}

export function getMissingChecklistCount(operation = {}) {
  return (operation.checklist || []).filter((item) => !item.completed).length;
}

export function buildTicaretSicilDashboardStats(operations = []) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const openStatuses = new Set([
    TICARET_SICIL_OPERATION_STATUS.EVRAK_BEKLENIYOR,
    TICARET_SICIL_OPERATION_STATUS.HAZIRLANIYOR,
    TICARET_SICIL_OPERATION_STATUS.IMZAYA_GONDERILDI,
    TICARET_SICIL_OPERATION_STATUS.BASVURU_YAPILDI,
    TICARET_SICIL_OPERATION_STATUS.TESCIL_BEKLIYOR,
  ]);

  const openOperations = operations.filter((op) => openStatuses.has(op.status));
  const missingDocuments = operations.reduce(
    (sum, op) => sum + getMissingChecklistCount(op),
    0
  );
  const completedThisMonth = operations.filter(
    (op) =>
      op.status === TICARET_SICIL_OPERATION_STATUS.TAMAMLANDI &&
      String(op.updatedAt || "").startsWith(currentMonth)
  ).length;
  const pendingRegistrations = operations.filter(
    (op) => op.status === TICARET_SICIL_OPERATION_STATUS.TESCIL_BEKLIYOR
  ).length;

  const upcomingDeadlines = operations.filter((op) => {
    const deadline = op.dates?.deadlineDate;
    if (!deadline) return false;
    const target = new Date(deadline);
    const diffDays = Math.ceil((target.getTime() - now.getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= 30 && openStatuses.has(op.status);
  }).length;

  return {
    openOperations: openOperations.length,
    missingDocuments,
    completedThisMonth,
    pendingRegistrations,
    upcomingDeadlines,
  };
}

export function buildTicaretSicilReminders(operations = []) {
  const reminders = [];
  const now = new Date();

  operations.forEach((operation) => {
    const missing = getMissingChecklistCount(operation);
    if (missing > 0 && operation.status !== TICARET_SICIL_OPERATION_STATUS.TAMAMLANDI) {
      reminders.push({
        id: `rem-missing-${operation.id}`,
        companyId: operation.companyId,
        companyName: operation.companyName,
        operationId: operation.id,
        type: TICARET_SICIL_REMINDER_TYPES.EKSIK_EVRAK,
        message: `${operation.type} operasyonunda ${missing} eksik evrak var.`,
        dueDate: operation.dates?.deadlineDate || "",
      });
    }

    if (operation.type === "Genel kurul" && operation.dates?.deadlineDate) {
      const due = new Date(operation.dates.deadlineDate);
      const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86400000);
      if (diffDays >= 0 && diffDays <= 45) {
        reminders.push({
          id: `rem-gk-${operation.id}`,
          companyId: operation.companyId,
          companyName: operation.companyName,
          operationId: operation.id,
          type: TICARET_SICIL_REMINDER_TYPES.GENEL_KURUL,
          message: `Yaklaşan genel kurul: ${operation.companyName} (${diffDays} gün)`,
          dueDate: operation.dates.deadlineDate,
        });
      }
    }

    if (
      (operation.type === "Sermaye artırımı" || operation.type === "Şirket kuruluşu") &&
      operation.dates?.deadlineDate
    ) {
      const due = new Date(operation.dates.deadlineDate);
      const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86400000);
      if (diffDays >= 0 && diffDays <= 30) {
        reminders.push({
          id: `rem-capital-${operation.id}`,
          companyId: operation.companyId,
          companyName: operation.companyName,
          operationId: operation.id,
          type: TICARET_SICIL_REMINDER_TYPES.SERMAYE_SURESI,
          message: `Sermaye süresi yaklaşıyor: ${operation.type}`,
          dueDate: operation.dates.deadlineDate,
        });
      }
    }

    if (operation.status === TICARET_SICIL_OPERATION_STATUS.TESCIL_BEKLIYOR) {
      reminders.push({
        id: `rem-tescil-${operation.id}`,
        companyId: operation.companyId,
        companyName: operation.companyName,
        operationId: operation.id,
        type: TICARET_SICIL_REMINDER_TYPES.ISLEM_HATIRLATMA,
        message: `Tescil bekleyen işlem: ${operation.type}`,
        dueDate: operation.dates?.applicationDate || "",
      });
    }
  });

  return reminders;
}

export function filterTicaretSicilOperations(
  operations = [],
  { companyId = "", type = "", status = "", dateFrom = "", dateTo = "" } = {}
) {
  return operations.filter((operation) => {
    if (companyId && operation.companyId !== companyId) return false;
    if (type && type !== "Tümü" && operation.type !== type) return false;
    if (status && status !== "Tümü" && operation.status !== status) return false;

    const actionDate = operation.dates?.lastActionDate || operation.updatedAt?.slice(0, 10) || "";
    if (dateFrom && actionDate && actionDate < dateFrom) return false;
    if (dateTo && actionDate && actionDate > dateTo) return false;

    return true;
  });
}

export async function readOperationDocumentFile(file) {
  const allowed = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|doc|docx|xls|xlsx|jpe?g|png|webp)$/i)) {
    throw new Error("Desteklenmeyen dosya türü.");
  }

  const dataUrl =
    file.size <= 1024 * 1024
      ? await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("Dosya okunamadı."));
          reader.readAsDataURL(file);
        })
      : "";

  return {
    id: `doc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    fileSize: file.size,
    uploadedAt: new Date().toISOString(),
    dataUrl,
    storageNote: dataUrl ? "local" : "metadata-only",
  };
}

export function runTicaretSicilScenario() {
  const companyId = "test-company";
  const kurulus = buildOperation({
    companyId,
    companyName: "Test A.Ş.",
    type: "Şirket kuruluşu",
    status: TICARET_SICIL_OPERATION_STATUS.EVRAK_BEKLENIYOR,
    dates: { deadlineDate: "2026-08-01", lastActionDate: "2026-07-01" },
  });
  const adres = buildOperation({
    companyId,
    companyName: "Test A.Ş.",
    type: "Adres değişikliği",
    status: TICARET_SICIL_OPERATION_STATUS.HAZIRLANIYOR,
    checklist: buildChecklistForType("Adres değişikliği").map((item, index) => ({
      ...item,
      completed: index < 2,
    })),
  });
  const tamamlanan = buildOperation({
    companyId,
    companyName: "Test A.Ş.",
    type: "Müdür değişikliği",
    status: TICARET_SICIL_OPERATION_STATUS.TAMAMLANDI,
    checklist: buildChecklistForType("Müdür değişikliği").map((item) => ({
      ...item,
      completed: true,
    })),
    updatedAt: new Date().toISOString(),
  });
  const genelKurul = buildOperation({
    companyId,
    companyName: "Test A.Ş.",
    type: "Genel kurul",
    status: TICARET_SICIL_OPERATION_STATUS.HAZIRLANIYOR,
    dates: {
      deadlineDate: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
      lastActionDate: new Date().toISOString().slice(0, 10),
    },
  });

  const operations = [kurulus, adres, tamamlanan, genelKurul];
  const stats = buildTicaretSicilDashboardStats(operations);
  const reminders = buildTicaretSicilReminders(operations);

  return {
    newCompanySetup: kurulus.type === "Şirket kuruluşu",
    missingDocumentWarning: reminders.some((item) => item.type === TICARET_SICIL_REMINDER_TYPES.EKSIK_EVRAK),
    addressChangeChecklistItems: adres.checklist.length,
    completedOperation: tamamlanan.status === TICARET_SICIL_OPERATION_STATUS.TAMAMLANDI,
    upcomingGeneralAssemblyWarning: reminders.some(
      (item) => item.type === TICARET_SICIL_REMINDER_TYPES.GENEL_KURUL
    ),
    openOperations: stats.openOperations,
    missingDocuments: stats.missingDocuments,
    reminderCount: reminders.length,
  };
}
