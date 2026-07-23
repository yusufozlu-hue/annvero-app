/**
 * Recovery API enable gate — envGuard merkezli, next/server bağımlılığı yok.
 */

import {
  isLocalDevOrTestEnv,
  resolveAnnveroAppEnv,
} from "@/src/lib/security/envGuard";

/**
 * Production / staging / Vercel Preview: yalnız RECOVERY_API_ENABLED=true.
 * Missing / false / 0 / boş → fail-closed.
 * Local development/test (Preview değil): varsayılan açık; explicit false/0 kapatır.
 * RESTORE_CONFIRM yetki değildir.
 */
export function isRecoveryApiEnabled() {
  const appEnv = resolveAnnveroAppEnv();
  const flag = String(process.env.RECOVERY_API_ENABLED || "").trim().toLowerCase();
  const explicitOn = flag === "true";

  if (isLocalDevOrTestEnv(appEnv)) {
    if (flag === "false" || flag === "0") return false;
    return true;
  }

  return explicitOn;
}
