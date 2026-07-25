import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readRememberedEmailState } from "@/src/utils/authRedirect";
import { getSupabaseConfig } from "./config";
import {
  clearSupabaseAuthCookieHints,
  getSupabaseSsrCookieOptions,
  hasSupabaseAuthCookieHint,
} from "./ssrCookies";

let browserClient: SupabaseClient | null = null;
let browserClientRemember: boolean | null = null;

/**
 * Tercih tek kaynaktan (annvero_remembered_email): kayıtlı e-posta varsa
 * kalıcı çerez; kullanıcı hatırlamayı kapattıysa oturum çerezi; hiç tercih
 * yoksa mevcut varsayılan (kalıcı) korunur. Ayrı boolean bayrak tutulmaz.
 */
function readRememberPreference(): boolean {
  if (typeof window === "undefined") return true;
  const { email, optedOut } = readRememberedEmailState();
  if (email) return true;
  return !optedOut;
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

  // Giriş anında checkbox açıkça iletilir; sonraki çağrılarda kayıtlı
  // e-posta tercihinden türetilir.
  const remember =
    typeof options?.rememberMe === "boolean"
      ? options.rememberMe
      : readRememberPreference();

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
