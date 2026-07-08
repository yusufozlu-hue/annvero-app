/**
 * Admin erişim kontrolü.
 * ANNVERO_ADMIN_EMAILS ortam değişkeni veya Supabase user metadata role=admin.
 */

import { ANNVERO_ROLES } from "@/src/config/annveroRoles";

/** Kurulum sahibi — env yoksa bile bootstrap için tanınır */
const DEFAULT_OWNER_EMAILS = ["yusufozlu@gmail.com"];

export function getAdminEmails() {
  const raw =
    process.env.ANNVERO_ADMIN_EMAILS ||
    process.env.NEXT_PUBLIC_ANNVERO_ADMIN_EMAILS ||
    "";

  return raw
    .split(/[,;\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"));
}

export function getOwnerEmails() {
  const raw =
    process.env.ANNVERO_OWNER_EMAILS ||
    process.env.NEXT_PUBLIC_ANNVERO_OWNER_EMAILS ||
    "";

  const owners = raw
    .split(/[,;\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"));

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

export function isAdminUser(user) {
  if (!user) return false;

  const email = String(user.email || "").toLowerCase();
  if (email && isAdminEmail(email)) {
    return true;
  }

  const appRole = user.app_metadata?.role;
  const userRole = user.user_metadata?.role;

  return appRole === "admin" || userRole === "admin";
}

/** Supabase Auth metadata içindeki ANNVERO rolü */
export function getAnnveroRoleFromUser(user) {
  if (!user) return "";
  const metaRole =
    user.user_metadata?.annvero_role ||
    user.user_metadata?.role ||
    user.app_metadata?.annvero_role ||
    user.app_metadata?.role ||
    "";
  return String(metaRole || "").trim();
}

/** Platform süper-admin (env allowlist veya metadata admin) */
export function isPlatformAdmin(user) {
  return isAdminUser(user);
}

/** Admin paneline erişebilen kullanıcı: platform admin veya partner/admin rolü */
export function isManagementUser(user) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  const role = getAnnveroRoleFromUser(user);
  return role === ANNVERO_ROLES.ADMIN || role === ANNVERO_ROLES.PARTNER;
}

export function isPartnerUser(user) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return false;
  return getAnnveroRoleFromUser(user) === ANNVERO_ROLES.PARTNER;
}
