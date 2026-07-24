/**
 * Admin erişim kontrolü.
 *
 * Platform admin = AND(
 *   app_metadata.role === "admin" (veya annvero_role),
 *   email explicit server-only ANNVERO_ADMIN_EMAILS içinde
 * )
 *
 * Email tek başına VEYA app_metadata tek başına admin yetkisi VERMEZ.
 * Hardcoded email, NEXT_PUBLIC_* allowlist, owner email, DB profile role,
 * user_metadata ve login provisioning admin yetkisi VERMEZ.
 */

import { ANNVERO_ROLES } from "@/src/config/annveroRoles";

function splitEmailList(raw = "") {
  return String(raw || "")
    .split(/[,;\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"));
}

/**
 * Yalnız server-side ANNVERO_ADMIN_EMAILS.
 * NEXT_PUBLIC_* ve hardcoded varsayılan yok.
 */
export function getAdminEmails() {
  return [...new Set(splitEmailList(process.env.ANNVERO_ADMIN_EMAILS))];
}

/**
 * Owner e-posta listesi bilgilendirici / ops ayrımı içindir.
 * Owner email tek başına platform admin yetkisi VERMEZ.
 * NEXT_PUBLIC_* owner env yetki kaynağı değildir.
 */
export function getOwnerEmails() {
  return [...new Set(splitEmailList(process.env.ANNVERO_OWNER_EMAILS))];
}

export function isOwnerEmail(email) {
  if (!email) return false;
  return getOwnerEmails().includes(String(email).trim().toLowerCase());
}

/** Explicit ANNVERO_ADMIN_EMAILS — owner listesi dahil edilmez. */
export function isAdminEmail(email) {
  if (!email) return false;
  return getAdminEmails().includes(String(email).trim().toLowerCase());
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
 * Eski/canonical admin hesaplarını güvenli biçimde geri kazanır:
 * explicit server allowlist AND canonical DB profile admin.
 * Email veya DB rolü tek başına elevated yetki vermez.
 */
export function isCanonicalProfileAdmin(user, profile = null) {
  if (!user || !profile) return false;

  const email = String(user.email || profile.email || "").trim().toLowerCase();
  const emailOk = Boolean(email && isAdminEmail(email));
  const profileOk = isTrustedAppAdminRole(profile.role || "");

  return emailOk && profileOk;
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
 * DB profile role / owner email / user_metadata ile management olunamaz.
 */
export function isManagementUser(user) {
  if (!user) return false;
  if (isPlatformAdmin(user)) return true;
  return isTrustedAppPartnerRole(getTrustedAppRole(user));
}

/**
 * Yönetim kapısı (saf): platform AND admin veya trusted app_metadata partner.
 * DB profile role bu kararın parçası değildir.
 */
export function evaluateManagementGate(user) {
  if (!user) {
    return { allowed: false, role: "", reason: "unauthenticated" };
  }
  if (isPlatformAdmin(user)) {
    return { allowed: true, role: "admin", reason: "platform_admin_and" };
  }
  if (isTrustedAppPartnerRole(getTrustedAppRole(user))) {
    return { allowed: true, role: "partner", reason: "trusted_app_partner" };
  }
  return { allowed: false, role: "", reason: "forbidden" };
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
