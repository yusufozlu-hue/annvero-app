import {
  isOfficeRoutePath,
  isTaxpayerRole,
  TAXPAYER_HOME_PATH,
} from "./annveroTaxpayerPortal.js";

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
  {
    prefix: "/admin/kullanicilar-roller",
    roles: [ANNVERO_ROLES.ADMIN, ANNVERO_ROLES.PARTNER],
  },
  {
    prefix: "/sistem-loglari",
    roles: [
      ANNVERO_ROLES.ADMIN,
      ANNVERO_ROLES.PARTNER,
      ANNVERO_ROLES.MANAGER,
      ANNVERO_ROLES.AUDIT,
    ],
  },
];

const OFFICE_STAFF_ROLES = [
  ANNVERO_ROLES.ADMIN,
  ANNVERO_ROLES.PARTNER,
  ANNVERO_ROLES.MANAGER,
  ANNVERO_ROLES.ACCOUNTING,
  ANNVERO_ROLES.PAYROLL,
  ANNVERO_ROLES.AUDIT,
];

export const ANNVERO_NAV_ROLE_VISIBILITY = {
  "Sistem Yönetimi": [ANNVERO_ROLES.ADMIN, ANNVERO_ROLES.PARTNER],
  "Otomasyon Merkezi": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.ACCOUNTING,
  ],
  "Risk & Denetim Merkezi": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.AUDIT,
    ANNVERO_ROLES.ACCOUNTING,
  ],
  Dashboard: OFFICE_STAFF_ROLES.filter((r) => r !== ANNVERO_ROLES.VIEWER),
  "Muhasebe Merkezi": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.ACCOUNTING,
    ANNVERO_ROLES.AUDIT,
  ],
  "E-Defter Merkezi": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.ACCOUNTING,
    ANNVERO_ROLES.AUDIT,
  ],
  "Beyanname Merkezi": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.ACCOUNTING,
    ANNVERO_ROLES.PAYROLL,
  ],
  "İK / Personel Merkezi": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.PAYROLL,
  ],
  "Ticaret Sicil Merkezi": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.ACCOUNTING,
  ],
  "AI Ofis Asistanı": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.ACCOUNTING,
  ],
  "Evrak Havuzu": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.ACCOUNTING,
  ],
  "Finansal Analiz Merkezi": [
    ANNVERO_ROLES.ADMIN,
    ANNVERO_ROLES.PARTNER,
    ANNVERO_ROLES.MANAGER,
    ANNVERO_ROLES.ACCOUNTING,
  ],
  "Hesaplama Araçları": OFFICE_STAFF_ROLES.filter(
    (r) => r !== ANNVERO_ROLES.VIEWER
  ),
};

export function canAccessRoute(role, pathname = "") {
  const normalized = String(pathname || "");
  if (isTaxpayerRole(role)) {
    if (normalized.startsWith("/mukellef")) return true;
    if (isOfficeRoutePath(normalized)) return false;
  }
  const rule = ANNVERO_PROTECTED_ROUTE_RULES.find((item) =>
    normalized.startsWith(item.prefix)
  );
  if (!rule) return true;
  return rule.roles.includes(role);
}

export function getTaxpayerHomePath() {
  return TAXPAYER_HOME_PATH;
}

export function canSeeNavGroup(role, groupTitle = "") {
  if (isTaxpayerRole(role)) {
    return false;
  }
  const allowed = ANNVERO_NAV_ROLE_VISIBILITY[groupTitle];
  if (!allowed) return true;
  return allowed.includes(role);
}

export function canSeeNavItem(role, item = {}) {
  if (!item?.roles?.length) return true;
  return item.roles.includes(role);
}

export function isManagementRole(role = "") {
  return role === ANNVERO_ROLES.ADMIN || role === ANNVERO_ROLES.PARTNER;
}

export function isPlatformAdminRole(role = "", isPlatformAdminFlag = false) {
  return isPlatformAdminFlag || role === ANNVERO_ROLES.ADMIN;
}

export function resolveUserRole({
  isAdmin = false,
  storedRole = "",
  profileRole = "",
} = {}) {
  if (isAdmin) return ANNVERO_ROLES.ADMIN;
  if (profileRole && ANNVERO_ROLE_LABELS[profileRole]) return profileRole;
  if (storedRole && ANNVERO_ROLE_LABELS[storedRole]) return storedRole;
  return ANNVERO_ROLES.ACCOUNTING;
}
