/**
 * Admin erişim kontrolü.
 *
 * Platform admin = AND(
 *   app_metadata.role === "admin" (veya annvero_role),
 *   email server-side allowlist içinde
 * )
 *
 * Email tek başına VEYA app_metadata tek başına admin yetkisi VERMEZ.
 * user_metadata.role / company_ids yetkilendirmede kullanılmaz.
 */

import { ANNVERO_ROLES } from "@/src/config/annveroRoles";

/** Kurulum sahibi allowlist varsayılanı — yalnız AND koşulunun email ayağı */
const DEFAULT_OWNER_EMAILS = ["yusufozlu@gmail.com"];

function splitEmailList(raw = "") {
  return String(raw || "")
    .split(/[,;\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"));
}

export function getAdminEmails() {
  const fromEnv = [
    ...splitEmailList(process.env.ANNVERO_ADMIN_EMAILS),
    ...splitEmailList(process.env.NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS),
  ];
  return [...new Set([...fromEnv, ...DEFAULT_OWNER_EMAILS])];
}

export function getOwnerEmails() {
  const owners = [
    ...splitEmailList(process.env.ANNVERO_OWNER_EMAILS),
    ...splitEmailList(process.env.NEXT_PUBLIC_ANNVERO_OWNER_EMAILS),
  ];
  return [...new Set([...owners, ...getAdminEmails(), ...DEFAULT_OWNER_EMAILS])];
}

export function isOwnerEmail(email) {
  if (!email) return false;
  return getOwnerEmails().includes(String(email).trim().toLowerCase());
}

export function isAdminEmail(email) {
  if (!email) return false;
  return getOwnerEmails().includes(String(email).trim().toLowerCase());
}

function normalizeElevatedRole(value = "") {
  return String(value || "").trim().toLowerCase();
}

/**
 * Yalnız app_metadata (kullanıcı değiştiremez).
 */
export function getTrustedAppRole(user) {
  if (!user) return "";
  return normalizeElevatedRole(
    user.app_metadata?.annvero_role || user.app_metadata?.role || ""
  );
}

export function isTrustedAppAdminRole(role = "") {
  const r = normalizeElevatedRole(role);
  return r === "admin" || r === String(ANNVERO_ROLES.ADMIN).toLowerCase();
}

export function isTrustedAppPartnerRole(role = "") {
  const r = normalizeElevatedRole(role);
  return r === "partner" || r === String(ANNVERO_ROLES.PARTNER).toLowerCase();
}

/**
 * Bilgilendirici rol — elevated claim için kullanılmaz.
 * user_metadata asla elevated rol döndürmez.
 */
export function getAnnveroRoleFromUser(user) {
  if (!user) return "";
  return getTrustedAppRole(user);
}

/**
 * Platform admin: app_metadata admin AND email allowlist (AND, OR değil).
 */
export function isAdminUser(user) {
  if (!user) return false;

  const email = String(user.email || "").trim().toLowerCase();
  const emailOk = Boolean(email && isAdminEmail(email));
  const appOk = isTrustedAppAdminRole(getTrustedAppRole(user));

  return emailOk && appOk;
}

/** Platform süper-admin — isAdminUser ile aynı (AND) */
export function isPlatformAdmin(user) {
  return isAdminUser(user);
}

/**
 * Yönetim: platform admin (AND) veya trusted app_metadata partner.
 * user_metadata ile partner/admin olunamaz.
 */
export function isManagementUser(user) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  return isTrustedAppPartnerRole(getTrustedAppRole(user));
}

export function isPartnerUser(user) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return false;
  return isTrustedAppPartnerRole(getTrustedAppRole(user));
}

/**
 * Test / denetim: AND koşulunun her iki ayağını ayrı doğrular.
 */
export function explainAdminGate(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  const appRole = getTrustedAppRole(user);
  const emailOk = Boolean(email && isAdminEmail(email));
  const appOk = isTrustedAppAdminRole(appRole);
  return {
    emailOk,
    appOk,
    isAdmin: emailOk && appOk,
    usedOrInsteadOfAnd: false,
    appRole,
  };
}
