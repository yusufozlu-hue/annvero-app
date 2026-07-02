/**
 * Admin erişim kontrolü.
 * ANNVERO_ADMIN_EMAILS ortam değişkeni veya Supabase user metadata role=admin.
 */

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

export function isAdminEmail(email) {
  if (!email) return false;
  return getAdminEmails().includes(String(email).trim().toLowerCase());
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
