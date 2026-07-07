import { ANNVERO_ROLES } from "@/src/config/annveroRoles";

export const ANNVERO_MODULES = {
  DASHBOARD: "dashboard",
  MUHASEBE: "muhasebe",
  BANKA_PARSER: "banka_parser",
  FIS_KONTROL: "fis_kontrol",
  BEYANNAME: "beyanname",
  E_DEFTER: "e_defter",
  RISK: "risk",
  IK: "ik",
  EVRAK: "evrak",
  OTOMASYON: "otomasyon",
  SISTEM: "sistem",
  ADMIN: "admin",
};

export const ANNVERO_PERMISSIONS = {
  VIEW: "view",
  EDIT: "edit",
  EXPORT: "export",
  APPROVE: "approve",
  ADMIN: "admin",
};

const ROLE_MODULE_MATRIX = {
  [ANNVERO_ROLES.ADMIN]: Object.values(ANNVERO_MODULES),
  [ANNVERO_ROLES.PARTNER]: Object.values(ANNVERO_MODULES).filter((m) => m !== ANNVERO_MODULES.ADMIN),
  [ANNVERO_ROLES.MANAGER]: [
    ANNVERO_MODULES.DASHBOARD,
    ANNVERO_MODULES.MUHASEBE,
    ANNVERO_MODULES.BANKA_PARSER,
    ANNVERO_MODULES.FIS_KONTROL,
    ANNVERO_MODULES.BEYANNAME,
    ANNVERO_MODULES.E_DEFTER,
    ANNVERO_MODULES.RISK,
    ANNVERO_MODULES.EVRAK,
    ANNVERO_MODULES.OTOMASYON,
    ANNVERO_MODULES.SISTEM,
  ],
  [ANNVERO_ROLES.ACCOUNTING]: [
    ANNVERO_MODULES.DASHBOARD,
    ANNVERO_MODULES.MUHASEBE,
    ANNVERO_MODULES.BANKA_PARSER,
    ANNVERO_MODULES.FIS_KONTROL,
    ANNVERO_MODULES.BEYANNAME,
    ANNVERO_MODULES.E_DEFTER,
    ANNVERO_MODULES.EVRAK,
  ],
  [ANNVERO_ROLES.PAYROLL]: [
    ANNVERO_MODULES.DASHBOARD,
    ANNVERO_MODULES.IK,
    ANNVERO_MODULES.EVRAK,
    ANNVERO_MODULES.BEYANNAME,
  ],
  [ANNVERO_ROLES.AUDIT]: [
    ANNVERO_MODULES.DASHBOARD,
    ANNVERO_MODULES.RISK,
    ANNVERO_MODULES.E_DEFTER,
    ANNVERO_MODULES.FIS_KONTROL,
    ANNVERO_MODULES.SISTEM,
    ANNVERO_MODULES.EVRAK,
  ],
  [ANNVERO_ROLES.VIEWER]: [
    ANNVERO_MODULES.DASHBOARD,
    ANNVERO_MODULES.MUHASEBE,
    ANNVERO_MODULES.EVRAK,
  ],
};

const ROLE_DEFAULT_PERMISSIONS = {
  [ANNVERO_ROLES.ADMIN]: Object.values(ANNVERO_PERMISSIONS),
  [ANNVERO_ROLES.PARTNER]: [
    ANNVERO_PERMISSIONS.VIEW,
    ANNVERO_PERMISSIONS.EDIT,
    ANNVERO_PERMISSIONS.EXPORT,
    ANNVERO_PERMISSIONS.APPROVE,
  ],
  [ANNVERO_ROLES.MANAGER]: [
    ANNVERO_PERMISSIONS.VIEW,
    ANNVERO_PERMISSIONS.EDIT,
    ANNVERO_PERMISSIONS.EXPORT,
    ANNVERO_PERMISSIONS.APPROVE,
  ],
  [ANNVERO_ROLES.ACCOUNTING]: [
    ANNVERO_PERMISSIONS.VIEW,
    ANNVERO_PERMISSIONS.EDIT,
    ANNVERO_PERMISSIONS.EXPORT,
  ],
  [ANNVERO_ROLES.PAYROLL]: [ANNVERO_PERMISSIONS.VIEW, ANNVERO_PERMISSIONS.EDIT],
  [ANNVERO_ROLES.AUDIT]: [
    ANNVERO_PERMISSIONS.VIEW,
    ANNVERO_PERMISSIONS.EXPORT,
    ANNVERO_PERMISSIONS.APPROVE,
  ],
  [ANNVERO_ROLES.VIEWER]: [ANNVERO_PERMISSIONS.VIEW],
};

export function getModulesForRole(role = "") {
  return ROLE_MODULE_MATRIX[role] || ROLE_MODULE_MATRIX[ANNVERO_ROLES.VIEWER];
}

export function getDefaultPermissionsForRole(role = "") {
  return ROLE_DEFAULT_PERMISSIONS[role] || [ANNVERO_PERMISSIONS.VIEW];
}

export function canAccessModule(role, moduleId, extraPermissions = []) {
  const modules = getModulesForRole(role);
  if (!modules.includes(moduleId)) return false;
  if (extraPermissions.includes(ANNVERO_PERMISSIONS.ADMIN)) return true;
  return true;
}

export function hasPermission(role, permission, extraPermissions = []) {
  const base = getDefaultPermissionsForRole(role);
  const merged = new Set([...base, ...extraPermissions]);
  if (merged.has(ANNVERO_PERMISSIONS.ADMIN)) return true;
  return merged.has(permission);
}

export function canAccessCompany(role, companyId, companyIds = []) {
  if (!companyId) return true;
  if (role === ANNVERO_ROLES.ADMIN || role === ANNVERO_ROLES.PARTNER) return true;
  if (!Array.isArray(companyIds) || companyIds.length === 0) return true;
  return companyIds.includes(companyId);
}
