/**
 * Geçici çıkış durumu — yalnız bellek içi.
 * Kalıcı tarayıcı deposuna yazılmaz; token/şifre taşımaz.
 * Sayfa yenilenince sıfırlanır → AuthGate normal korumaya döner.
 */

export const ANNVERO_LOGOUT_IN_PROGRESS_EVENT = "annvero:logout-in-progress";

let logoutInProgress = false;

export function isLogoutInProgress() {
  return logoutInProgress;
}

export function beginLogoutInProgress() {
  logoutInProgress = true;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(ANNVERO_LOGOUT_IN_PROGRESS_EVENT, {
        detail: { active: true },
      })
    );
  } catch {
    // ignore
  }
}

/** Yalnız çıkış başarısız olup uygulamada kalındığında çağrılır. */
export function endLogoutInProgress() {
  logoutInProgress = false;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(ANNVERO_LOGOUT_IN_PROGRESS_EVENT, {
        detail: { active: false },
      })
    );
  } catch {
    // ignore
  }
}
