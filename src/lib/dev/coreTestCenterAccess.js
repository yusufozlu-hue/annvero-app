/**
 * CORE Test Merkezi — görünürlük ve erişim (dev veya yönetim).
 */

export const CORE_TEST_CENTER_ROUTE = "/admin/core-test-merkezi";

export function isDevelopmentEnvironment() {
  return process.env.NODE_ENV === "development";
}

export function canAccessCoreTestCenter({
  isDevelopment = isDevelopmentEnvironment(),
  isManagementUser = false,
  isAdmin = false,
  isPartner = false,
} = {}) {
  if (isDevelopment) return true;
  return Boolean(isManagementUser || isAdmin || isPartner);
}

export function isCoreTestCenterPath(pathname = "") {
  return String(pathname || "").startsWith(CORE_TEST_CENTER_ROUTE);
}
