/**
 * Kullanıcı bildirimleri API istemcisi.
 */

export function formatNotificationBadgeCount(unreadCount = 0) {
  const n = Math.max(0, Number(unreadCount) || 0);
  if (n <= 0) return null;
  if (n > 99) return "99+";
  return String(n);
}

export async function fetchUserNotifications({
  page = 1,
  pageSize = 20,
  unreadOnly = false,
} = {}) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (unreadOnly) params.set("unreadOnly", "1");
  const response = await fetch(`/api/user-notifications?${params}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 401) {
      return { data: [], unreadCount: 0, page: 1, pageCount: 1 };
    }
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Bildirimler yüklenemedi.");
  }
  return response.json();
}

export async function fetchUnreadNotificationCount() {
  const response = await fetch("/api/user-notifications?countOnly=1", {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) return 0;
  const body = await response.json().catch(() => ({}));
  return Number(body.unreadCount) || 0;
}

export async function markNotificationRead(id) {
  const response = await fetch("/api/user-notifications", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, read: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.error || "Bildirim güncellenemedi.");
    err.status = response.status;
    throw err;
  }
  return body;
}

export async function markAllNotificationsRead() {
  const response = await fetch("/api/user-notifications", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markAllRead: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Bildirimler güncellenemedi.");
  }
  return body;
}
