/**
 * Canonical client logout — fence → signOut → transfer cleanup → session clear → redirect.
 * Cleanup hatası logout’u kilitlemez; retry-pending bırakır.
 */

import { clearClientAuthStorage } from "@/src/lib/supabase/client";
import { clearClientSessionCaches } from "@/src/lib/auth/clearClientSession";
import {
  beginLogoutInProgress,
  endLogoutInProgress,
} from "@/src/lib/auth/logoutInProgress";
import {
  clearAllTransferCache,
  markTransferCleanupRetryPending,
  synchronouslyFenceAllTransfers,
} from "@/src/utils/transferCacheLifecycle";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

const SIGN_OUT_GLOBAL_TIMEOUT_MS = 4000;
const SIGN_OUT_TIMEOUT_MS = 750;
const CLEANUP_TIMEOUT_MS = 2500;

async function signOutSafely(supabase) {
  if (!supabase) return;

  let globalDone = false;
  try {
    const result = await Promise.race([
      supabase.auth
        .signOut({ scope: "global" })
        .then(() => "ok")
        .catch(() => "fail"),
      new Promise((resolve) => {
        window.setTimeout(() => resolve("timeout"), SIGN_OUT_GLOBAL_TIMEOUT_MS);
      }),
    ]);
    globalDone = result === "ok";
  } catch {
    globalDone = false;
  }

  if (!globalDone) {
    await Promise.race([
      supabase.auth.signOut({ scope: "local" }).catch(() => undefined),
      new Promise((resolve) => {
        window.setTimeout(resolve, SIGN_OUT_TIMEOUT_MS);
      }),
    ]);
  }
}

async function awaitTransferCleanup() {
  return Promise.race([
    clearAllTransferCache(),
    new Promise((resolve) => {
      window.setTimeout(
        () => resolve({ ok: false, timedOut: true, code: "timeout" }),
        CLEANUP_TIMEOUT_MS
      );
    }),
  ]);
}

/**
 * @param {{ redirectUrl?: string, supabase?: ReturnType<typeof getSupabaseClient> }} [options]
 * @returns {Promise<{ ok: boolean, cleanupOk?: boolean }>}
 */
export async function performClientLogout(options = {}) {
  const redirectUrl = options.redirectUrl || "https://annvero.com/";
  beginLogoutInProgress();

  const supabase = options.supabase || getSupabaseClient();

  try {
    // 1) Fence senkron — late write stale
    synchronouslyFenceAllTransfers();
    // 2) Retry işareti cleanup başlamadan (timeout/abort güvenliği)
    markTransferCleanupRetryPending({ type: "all" });
    // 3) signOut
    await signOutSafely(supabase);
    // 4) Transfer cleanup (timeout’lu; başarıda pending kalkar)
    const cleanup = await awaitTransferCleanup();
    if (cleanup?.timedOut || cleanup?.ok === false) {
      markTransferCleanupRetryPending({ type: "all" });
    }
    // 5) Session / role caches (TRANSFER_CLEANUP_PENDING_KEY silinmez)
    clearClientAuthStorage();
    clearClientSessionCaches();

    void fetch("/api/auth/return-to", {
      method: "DELETE",
      credentials: "include",
      keepalive: true,
    }).catch(() => undefined);

    // 6) Redirect en sonda — cleanup beklemeyi sonsuza uzatmaz
    window.location.replace(redirectUrl);
    return { ok: true, cleanupOk: Boolean(cleanup?.ok) };
  } catch {
    markTransferCleanupRetryPending({ type: "all" });
    endLogoutInProgress();
    return { ok: false, cleanupOk: false };
  }
}

/** Login formu: mevcut oturumu kapatırken transfer residue temizliği. */
export async function clearExistingSessionTransfersBeforeLogin() {
  try {
    synchronouslyFenceAllTransfers();
    markTransferCleanupRetryPending({ type: "all" });
    await awaitTransferCleanup();
  } catch {
    markTransferCleanupRetryPending({ type: "all" });
  }
}
