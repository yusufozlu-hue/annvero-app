export const ANNVERO_USERS_CACHE_KEY = "annvero_users_cache_v1";

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function loadCachedUsers() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(ANNVERO_USERS_CACHE_KEY) || "[]", []);
}

export function saveCachedUsers(users = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ANNVERO_USERS_CACHE_KEY, JSON.stringify(users.slice(0, 500)));
}

export function upsertCachedUser(profile = {}) {
  const users = loadCachedUsers();
  const email = String(profile.email || "").toLowerCase();
  const index = users.findIndex((item) => item.email === email || item.id === profile.id);
  const next = { ...profile, email, updatedAt: new Date().toISOString() };
  if (index >= 0) users[index] = { ...users[index], ...next };
  else users.unshift(next);
  saveCachedUsers(users);
  return next;
}

export function removeCachedUser(userId = "") {
  saveCachedUsers(loadCachedUsers().filter((item) => item.id !== userId));
}
