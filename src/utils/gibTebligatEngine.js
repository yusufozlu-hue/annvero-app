import { DEFAULT_GIB_REMINDER } from "@/src/config/resmiBildirimDefaults";
import { buildOfficialNotificationDedupeKey } from "@/src/utils/officialNotificationSchema";

export function validateVerificationCode(code = "") {
  const normalized = String(code || "").trim();
  if (normalized.length < 4) {
    return { ok: false, error: "Doğrulama kodu en az 4 karakter olmalıdır." };
  }
  return { ok: true, value: normalized };
}

export function computeNextCheckAt(lastCheckAt, intervalDays = DEFAULT_GIB_REMINDER.intervalDays) {
  const base = lastCheckAt ? new Date(lastCheckAt) : new Date();
  const next = new Date(base);
  next.setDate(next.getDate() + Number(intervalDays || 1));
  return next.toISOString();
}

export function isCheckDue(reminder = {}, now = new Date()) {
  if (reminder.enabled === false) return false;
  if (!reminder.next_check_at) return true;

  return new Date(reminder.next_check_at).getTime() <= now.getTime();
}

export function buildGibCheckPayload({
  companyId,
  verificationCode,
  foundNotifications = [],
  checkedAt = new Date().toISOString(),
}) {
  const validation = validateVerificationCode(verificationCode);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  if (!companyId) {
    return { ok: false, error: "Firma seçimi zorunludur." };
  }

  const notifications = (Array.isArray(foundNotifications) ? foundNotifications : [])
    .filter((item) => item?.title)
    .map((item) => ({
      company_id: companyId,
      source: "gib",
      notification_type: "tebligat",
      title: String(item.title).trim(),
      description: item.summary ? String(item.summary).trim() : "",
      reference_no: item.referenceNo ? String(item.referenceNo).trim() : "",
      served_date: item.notificationDate || null,
      status: "unread",
      priority: "normal",
    }));

  return {
    ok: true,
    companyId,
    verificationCode: validation.value,
    checkedAt,
    notifications,
  };
}

export function diffNewNotifications(existing = [], incoming = []) {
  const existingKeys = new Set(existing.map((row) => buildOfficialNotificationDedupeKey(row)));

  return incoming.filter((row) => !existingKeys.has(buildOfficialNotificationDedupeKey(row)));
}

export function formatTrDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("tr-TR");
}
