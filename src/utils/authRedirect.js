export function getSafeNextPath(nextPath, fallback = "/dashboard") {
  if (!nextPath || typeof nextPath !== "string") {
    return fallback;
  }

  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return fallback;
  }

  if (
    !nextPath.startsWith("/muhasebe") &&
    !nextPath.startsWith("/dashboard") &&
    !nextPath.startsWith("/ofis-takip")
  ) {
    return fallback;
  }

  return nextPath;
}

export function buildLoginUrl(pathname = "/muhasebe") {
  const next = encodeURIComponent(pathname);
  return `/login?next=${next}`;
}
