/**
 * Canlı sürüm etiketi için build bilgisi.
 * Vercel: VERCEL_GIT_COMMIT_SHA otomatik gelir.
 */

function shortHash(value) {
  const hash = String(value || "local");
  return hash.length > 7 ? hash.slice(0, 7) : hash;
}

function formatBuildDate(isoValue) {
  if (!isoValue) return "-";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return isoValue;
  return date.toLocaleString("tr-TR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getBuildInfo() {
  const commit =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "local";

  const builtAt =
    process.env.NEXT_PUBLIC_BUILD_TIME ||
    process.env.BUILD_TIME ||
    new Date().toISOString();

  return {
    commit: shortHash(commit),
    fullCommit: commit,
    builtAt,
    builtAtLabel: formatBuildDate(builtAt),
    label: `ANNVERO build: ${shortHash(commit)} · ${formatBuildDate(builtAt)}`,
  };
}
