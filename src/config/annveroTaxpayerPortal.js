/**
 * Mükellef (goruntuleme) portal menü ve route allowlist.
 * Ofis operasyon menüleri bu listede yoktur.
 * Not: ANNVERO_ROLES import edilmez (circular dependency önlemek için literal kullanılır).
 */

export const TAXPAYER_ROLE = "goruntuleme";
export const TAXPAYER_HOME_PATH = "/mukellef";

export const TAXPAYER_NAV_GROUPS = Object.freeze([
  { title: "Ana Sayfa", href: "/mukellef" },
  { title: "Evrak Yükle", href: "/mukellef/evrak-yukle" },
  { title: "Evraklarım", href: "/mukellef/evraklarim" },
  { title: "Bildirimler", href: "/mukellef/bildirimler" },
  { title: "Profil", href: "/mukellef/profil" },
]);

/** Mükellefin erişebileceği path önekleri (göreli). */
export const TAXPAYER_ALLOWED_PREFIXES = Object.freeze([
  "/mukellef",
  "/auth",
  "/login",
  "/api/auth",
  "/api/google-drive/files",
  "/api/google-drive/sync",
  "/api/companies",
]);

/**
 * Ofis operasyon path'leri — goruntuleme için engellenir.
 * Not: /mukellef kendi başına ofis değildir.
 */
export const OFFICE_ROUTE_PREFIXES = Object.freeze([
  "/muhasebe",
  "/dashboard",
  "/ofis-takip",
  "/admin",
  "/sistem-loglari",
  "/otomasyon",
  "/ai-ofis-asistani",
  "/evrak-havuzu",
  "/ik-personel",
  "/platform",
  "/ticaret-sicil",
]);

export function isTaxpayerRole(role = "") {
  return String(role || "") === TAXPAYER_ROLE;
}

/**
 * JWT metadata'dan mükellef rolü (middleware / login — DB yok).
 * app_metadata.role | app_metadata.annvero_role | user_metadata.annvero_role
 * Admin ipucu varsa mükellef sayılmaz.
 * @param {object | null | undefined} [user]
 */
export function isTaxpayerAuthUser(user) {
  if (!user || typeof user !== "object") return false;
  const appMeta = user.app_metadata || {};
  const userMeta = user.user_metadata || {};
  const appRole = String(appMeta.role || appMeta.annvero_role || "").trim();
  const metaRole = String(userMeta.annvero_role || userMeta.role || "").trim();
  if (appRole === "admin" || metaRole === "admin") {
    return false;
  }
  if (appRole === "partner" || metaRole === "partner") {
    return false;
  }
  return isTaxpayerRole(appRole) || isTaxpayerRole(metaRole);
}

/** Post-auth / login varsayılan yolu.
 * @param {object | null | undefined} [user]
 */
export function resolveAuthHomePathForUser(user) {
  return isTaxpayerAuthUser(user) ? TAXPAYER_HOME_PATH : "/dashboard";
}

export function isTaxpayerAllowedPath(pathname = "") {
  const path = String(pathname || "").split(/[?#]/)[0] || "";
  if (!path.startsWith("/")) return false;
  if (path === "/" || path === "/manifest.webmanifest") return true;
  return TAXPAYER_ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

export function isOfficeRoutePath(pathname = "") {
  const path = String(pathname || "").split(/[?#]/)[0] || "";
  return OFFICE_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/**
 * Mükellef ofis route'una giderse güvenli ana sayfa.
 */
export function resolveTaxpayerSafeRedirect(pathname = "") {
  if (isTaxpayerAllowedPath(pathname) && !isOfficeRoutePath(pathname)) {
    return null;
  }
  return TAXPAYER_HOME_PATH;
}
