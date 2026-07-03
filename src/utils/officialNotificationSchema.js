const VALID_SOURCES = new Set(["gib", "sgk", "uets", "kep"]);
const VALID_STATUS = new Set(["unread", "read", "archived"]);
const VALID_PRIORITY = new Set(["low", "normal", "high", "urgent"]);

export function normalizeOfficialNotificationSource(value = "gib") {
  const source = String(value || "gib").trim().toLowerCase();
  return VALID_SOURCES.has(source) ? source : "gib";
}

export function toOfficialNotificationDbRow(input = {}) {
  const source = normalizeOfficialNotificationSource(input.source || input.channel);

  return {
    company_id: input.company_id,
    source,
    notification_type: input.notification_type || input.notificationType || "tebligat",
    title: input.title,
    reference_no: input.reference_no || input.referenceNo || null,
    served_date: input.served_date || input.notification_date || input.servedDate || null,
    due_date: input.due_date || input.dueDate || null,
    status: VALID_STATUS.has(input.status) ? input.status : "unread",
    priority: VALID_PRIORITY.has(input.priority) ? input.priority : "normal",
    description: input.description || input.summary || null,
    file_url: input.file_url || input.fileUrl || null,
    updated_at: new Date().toISOString(),
  };
}

export function fromOfficialNotificationDbRow(row = {}) {
  return {
    ...row,
    channel: row.source,
    summary: row.description,
    notification_date: row.served_date,
  };
}

export function mapOfficialNotificationRows(rows = []) {
  return rows.map(fromOfficialNotificationDbRow);
}

export function buildOfficialNotificationDedupeKey(row = {}) {
  return [
    row.company_id,
    row.source || row.channel || "",
    row.reference_no || "",
    row.title || "",
    row.served_date || row.notification_date || "",
  ].join("|");
}
