import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANNVERO_REMEMBER_ME_KEY } from "@/src/utils/authRedirect";
import { getSupabaseConfig } from "./config";
import {
  clearSupabaseAuthCookieHints,
  getSupabaseSsrCookieOptions,
  hasSupabaseAuthCookieHint,
} from "./ssrCookies";

let browserClient: SupabaseClient | null = null;
let browserClientRemember: boolean | null = null;

function readRememberPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(ANNVERO_REMEMBER_ME_KEY);
    if (raw == null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

export function setRememberMePreference(remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANNVERO_REMEMBER_ME_KEY, remember ? "1" : "0");
  } catch {
    // ignore
  }
  // Tercih değişince yalnız kendi referansımızı sıfırla; yeni client
  // bir sonraki getSupabaseBrowserClient çağrısında isSingleton:false ile yenilenir.
  if (browserClientRemember !== null && browserClientRemember !== remember) {
    browserClient = null;
    browserClientRemember = null;
  }
}

export function resetSupabaseBrowserClient() {
  browserClient = null;
  browserClientRemember = null;
}

export { hasSupabaseAuthCookieHint };

/**
 * Resmi @supabase/ssr createBrowserClient — oturum document.cookie üzerinden.
 * isSingleton: remember tercihi değişmedikçe tek örnek; değişince yeni client.
 */
export function getSupabaseBrowserClient(options?: {
  rememberMe?: boolean;
}): SupabaseClient | null {
  if (typeof window === "undefined") {
    return null;
  }

  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  if (typeof options?.rememberMe === "boolean") {
    setRememberMePreference(options.rememberMe);
  }

  const remember = readRememberPreference();

  if (browserClient && browserClientRemember === remember) {
    return browserClient;
  }

  // remember maxAge değişince yeni client (isSingleton:false); aksi halde
  // resmi tek örnek — clearClientAuthStorage sonrası da aynı modül önbelleği.
  const rememberChanged =
    browserClientRemember !== null && browserClientRemember !== remember;

  browserClient = createBrowserClient(config.supabaseUrl, config.anonKey, {
    isSingleton: !rememberChanged,
    cookieOptions: getSupabaseSsrCookieOptions({ rememberMe: remember }),
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  browserClientRemember = remember;

  return browserClient;
}

/**
 * Eski localStorage-only GoTrue anahtarlarını temizle (cookie modeline göç).
 * Değer okunmaz / loglanmaz; session JSON document.cookie'ye kopyalanmaz.
 */
function clearLegacyAuthStorageKeys() {
  if (typeof window === "undefined") return;
  try {
    const keys = new Set([
      "annvero-auth",
      ...Object.keys(window.localStorage).filter(
        (k) => k.startsWith("sb-") || k.includes("supabase.auth")
      ),
      ...Object.keys(window.sessionStorage).filter(
        (k) => k.startsWith("sb-") || k.includes("supabase.auth")
      ),
    ]);
    for (const key of keys) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

/** Çıkışta storage temizliği; singleton referansı sıfırlanır. */
export function clearClientAuthStorage() {
  if (typeof window === "undefined") return;
  clearLegacyAuthStorageKeys();
  clearSupabaseAuthCookieHints();
  resetSupabaseBrowserClient();
}
