const ALLOWED_PREFIXES = [
  "/dashboard",
  "/muhasebe",
  "/ofis-takip",
  "/admin",
  "/sistem-loglari",
  "/otomasyon",
  "/ai-ofis-asistani",
  "/ik-personel",
  "/hesaplama-araclari",
  "/ticaret-sicil",
  "/mevzuat-hap-notlari",
];

export function getSafeNextPath(nextPath, fallback = "/dashboard") {
  if (!nextPath || typeof nextPath !== "string") {
    return fallback;
  }

  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return fallback;
  }

  const allowed = ALLOWED_PREFIXES.some((prefix) => nextPath.startsWith(prefix));
  if (!allowed) return fallback;

  return nextPath;
}

export function buildLoginUrl(pathname = "/muhasebe") {
  const next = encodeURIComponent(pathname);
  return `/login?next=${next}`;
}
