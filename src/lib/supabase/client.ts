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
    // Anahtar yoksa mevcut oturumları bozmamak için kalıcı kabul et.
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
  if (browserClientRemember !== remember) {
    browserClient = null;
    browserClientRemember = null;
  }
}

export function resetSupabaseBrowserClient() {
  browserClient = null;
  browserClientRemember = null;
}

/**
 * "Beni hatırla" açık: kalıcı auth cookie (maxAge).
 * Kapalı: session cookie (tarayıcı kapanınca düşer).
 *
 * Not: @supabase/ssr createBrowserClient cookie storage kullanır;
 * auth.storage override edilmez. isSingleton:false ile tercih değişiminde
 * istemci yeniden oluşturulur.
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

  browserClient = createBrowserClient(config.supabaseUrl, config.anonKey, {
    isSingleton: false,
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

/** Çıkışta hem storage hem document auth cookie temizliği. */
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
