import { GIB_PUSH_MESSAGES } from "@/src/config/resmiBildirimDefaults";

export async function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { ok: false, error: "Tarayıcı bildirim desteklemiyor." };
  }

  if (Notification.permission === "granted") {
    return { ok: true, permission: "granted" };
  }

  if (Notification.permission === "denied") {
    return { ok: false, error: "Bildirim izni reddedildi." };
  }

  const permission = await Notification.requestPermission();
  return {
    ok: permission === "granted",
    permission,
    error: permission === "granted" ? null : "Bildirim izni verilmedi.",
  };
}

export async function showLocalPushNotification(title, options = {}) {
  if (typeof window === "undefined") return false;

  const permission = await requestNotificationPermission();
  if (!permission.ok) return false;

  const payload = {
    body: options.body || "",
    icon: options.icon || "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    tag: options.tag || "annvero-notification",
    data: options.data || {},
  };

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    if (registration?.showNotification) {
      await registration.showNotification(title, payload);
      return true;
    }
  }

  new Notification(title, payload);
  return true;
}

export function notifyGibCheckDue() {
  return showLocalPushNotification(GIB_PUSH_MESSAGES.CHECK_DUE, {
    tag: "gib-check-due",
    body: "Ofis Takip > Resmi Bildirimler ekranından kontrol yapabilirsiniz.",
    data: { url: "/dashboard/ofis-takip/resmi-bildirimler/gib" },
  });
}

export function notifyNewGibTebligat(count = 1) {
  return showLocalPushNotification(GIB_PUSH_MESSAGES.NEW_NOTIFICATION, {
    tag: "gib-new-notification",
    body: count > 1 ? `${count} yeni tebligat kaydı eklendi.` : "Yeni tebligat kaydı eklendi.",
    data: { url: "/dashboard/ofis-takip/resmi-bildirimler/gib" },
  });
}

export async function savePushSubscription(subscription, userId = "") {
  if (!subscription) return null;

  const json = subscription.toJSON();
  const response = await fetch("/api/push-subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId || null,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    }),
  });

  if (!response.ok) return null;
  const body = await response.json();
  return body.data;
}
