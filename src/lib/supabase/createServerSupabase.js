import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/src/lib/supabase/config";
import { getSupabaseSsrCookieOptions } from "@/src/lib/supabase/ssrCookies";

/**
 * createServerClient — getAll/setAll zorunlu (resmi SSR sözleşmesi).
 * @param {{ getAll: Function, setAll: Function }} cookieMethods
 */
export function createAnnveroServerSupabase(cookieMethods) {
  const config = getSupabaseConfig();
  if (!config) return null;

  return createServerClient(config.supabaseUrl, config.anonKey, {
    cookieOptions: getSupabaseSsrCookieOptions({ rememberMe: true }),
    cookies: {
      getAll() {
        return cookieMethods.getAll();
      },
      setAll(cookiesToSet) {
        return cookieMethods.setAll(cookiesToSet);
      },
    },
  });
}
