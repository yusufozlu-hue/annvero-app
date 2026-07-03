export async function fetchOfficialNotifications(params = {}) {
  const search = new URLSearchParams();
  if (params.channel) search.set("channel", params.channel);
  if (params.companyId) search.set("companyId", params.companyId);
  if (params.status) search.set("status", params.status);

  const response = await fetch(`/api/official-notifications?${search.toString()}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Bildirimler yüklenemedi.");
  }

  const body = await response.json();
  return body.data || [];
}

export async function createOfficialNotifications(records = []) {
  const payload = Array.isArray(records) ? records : [records];
  const response = await fetch("/api/official-notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ records: payload }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Bildirim kaydedilemedi.");
  }

  const body = await response.json();
  return body.data || [];
}

export async function patchOfficialNotification(id, patch = {}) {
  const response = await fetch("/api/official-notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Bildirim güncellenemedi.");
  }

  const body = await response.json();
  return body.data;
}

export async function runGibCheckRequest(payload) {
  const response = await fetch("/api/official-notifications/gib-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "GİB kontrolü tamamlanamadı.");
  }

  return response.json();
}

export async function fetchGibReminders(companyId) {
  const search = new URLSearchParams();
  if (companyId) search.set("companyId", companyId);

  const response = await fetch(`/api/gib-check-reminders?${search.toString()}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Hatırlatmalar yüklenemedi.");
  }

  const body = await response.json();
  return body.data || [];
}

export async function saveGibReminder(payload) {
  const response = await fetch("/api/gib-check-reminders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Hatırlatma kaydedilemedi.");
  }

  const body = await response.json();
  return body.data;
}
