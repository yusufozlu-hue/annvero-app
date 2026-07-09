/**
 * ANNVERO CORE feature flag — kontrollü geçiş.
 *
 * USE_ANNVERO_CORE=true  → banka parser CORE karar motorunu kullanır
 * USE_ANNVERO_CORE=false → mevcut parser mantığı (varsayılan)
 */

function readFlagValue() {
  const raw =
    process.env.USE_ANNVERO_CORE ??
    process.env.NEXT_PUBLIC_USE_ANNVERO_CORE ??
    "";
  return String(raw).trim().toLowerCase();
}

export function isAnnveroCoreEnabled() {
  const value = readFlagValue();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function isAnnveroCoreDebugEnabled() {
  const raw =
    process.env.ANNVERO_CORE_DEBUG ??
    process.env.NEXT_PUBLIC_ANNVERO_CORE_DEBUG ??
    "";
  const value = String(raw).trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  return isAnnveroCoreEnabled() && process.env.NODE_ENV === "development";
}
