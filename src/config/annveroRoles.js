export const ANNVERO_ROLES = {
  ADMIN: "admin",
  PARTNER: "partner",
  MANAGER: "mudur",
  ACCOUNTING: "muhasebe_personeli",
  PAYROLL: "bordro_personeli",
  AUDIT: "denetim_personeli",
  VIEWER: "goruntuleme",
};

export const ANNVERO_ROLE_LABELS = {
  [ANNVERO_ROLES.ADMIN]: "Admin",
  [ANNVERO_ROLES.PARTNER]: "Partner",
  [ANNVERO_ROLES.MANAGER]: "Müdür",
  [ANNVERO_ROLES.ACCOUNTING]: "Muhasebe Personeli",
  [ANNVERO_ROLES.PAYROLL]: "Bordro Personeli",
  [ANNVERO_ROLES.AUDIT]: "Denetim Personeli",
  [ANNVERO_ROLES.VIEWER]: "Görüntüleme Kullanıcısı",
};

export const ANNVERO_ROLE_STORAGE_KEY = "annvero_user_role_v1";

export const ANNVERO_PROTECTED_ROUTE_RULES = [
  { prefix: "/admin", roles: [ANNVERO_ROLES.ADMIN, ANNVERO_ROLES.PARTNER] },
  { prefix: "/admin/kullanicilar-roller", roles: [ANNVERO_ROLES.ADMIN, ANNVERO_ROLES.PARTNER] },
  { prefix: "/sistem-loglari", roles: [ANNVERO_ROLES.ADMIN, ANNVERO_ROLES.PARTNER, ANNVERO_ROLES.MANAGER, ANNVERO_ROLES.AUDIT] },
];

export const ANNVERO_NAV_ROLE_VISIBILITY = {
  "Sistem Yönetimi": [ANNVERO_ROLES.ADMIN, ANNVERO_ROLES.PARTNER],
  "Otomasyon Merkezi": [ANNVERO_ROLES.ADMIN, ANNVERO_ROLES.PARTNER, ANNVERO_ROLES.MANAGER, ANNVERO_ROLES.ACCOUNTING],
  "Risk & Denetim Merkezi": [ANNVERO_ROLES.ADMIN, ANNVERO_ROLES.PARTNER, ANNVERO_ROLES.MANAGER, ANNVERO_ROLES.AUDIT, ANNVERO_ROLES.ACCOUNTING],
};

export function canAccessRoute(role, pathname = "") {
  const normalized = String(pathname || "");
  const rule = ANNVERO_PROTECTED_ROUTE_RULES.find((item) => normalized.startsWith(item.prefix));
  if (!rule) return true;
  return rule.roles.includes(role);
}

export function canSeeNavGroup(role, groupTitle = "") {
  const allowed = ANNVERO_NAV_ROLE_VISIBILITY[groupTitle];
  if (!allowed) return true;
  return allowed.includes(role);
}

export function resolveUserRole({ isAdmin = false, storedRole = "" } = {}) {
  if (isAdmin) return ANNVERO_ROLES.ADMIN;
  if (storedRole && ANNVERO_ROLE_LABELS[storedRole]) return storedRole;
  return ANNVERO_ROLES.ACCOUNTING;
}
