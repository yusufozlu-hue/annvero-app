import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANNVERO_REMEMBER_ME_KEY } from "@/src/utils/authRedirect";
import { getSupabaseConfig } from "./config";

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
  // bir sonraki getSupabaseBrowserClient çağrısında isSingleton ile tek kalır.
  if (browserClientRemember !== null && browserClientRemember !== remember) {
    browserClient = null;
    browserClientRemember = null;
  }
}

export function resetSupabaseBrowserClient() {
  browserClient = null;
  browserClientRemember = null;
}

/**
 * Tek tarayıcı GoTrueClient — isSingleton:true ile Multiple GoTrueClient uyarısı önlenir.
 * "Beni hatırla" cookie maxAge tercihini ilk oluşturmada uygular.
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

  // isSingleton:true → @supabase/ssr modül önbelleği; ikinci create aynı örneği döner.
  browserClient = createBrowserClient(config.supabaseUrl, config.anonKey, {
    isSingleton: true,
    cookieOptions: remember
      ? {
          path: "/",
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 400,
        }
      : {
          path: "/",
          sameSite: "lax",
        },
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

function clearDocumentAuthCookies() {
  if (typeof document === "undefined") return;
  try {
    const cookies = document.cookie.split(";");
    for (const part of cookies) {
      const name = part.split("=")[0]?.trim();
      if (
        !name ||
        !(
          name.startsWith("sb-") ||
          name.includes("auth-token") ||
          name.includes("supabase")
        )
      ) {
        continue;
      }
      document.cookie = `${name}=; Max-Age=0; path=/`;
    }
  } catch {
    // ignore
  }
}

/** Çıkışta storage temizliği; singleton referansı sıfırlanır (sonraki sayfa yüklemesinde tek client). */
export function clearClientAuthStorage() {
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
  clearDocumentAuthCookies();
  resetSupabaseBrowserClient();
}
