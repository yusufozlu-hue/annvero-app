import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/src/lib/supabase/config";
import { isAdminUser } from "@/src/lib/auth/admin";

export async function getServerSupabaseUser() {
  const config = getSupabaseConfig();
  if (!config) return { supabase: null, user: null };

  const cookieStore = await cookies();

  const supabase = createServerClient(config.supabaseUrl, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // API route read-only oturum okuması
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function requireAdminUser() {
  const { supabase, user } = await getServerSupabaseUser();

  if (!user) {
    return { supabase, user: null, error: "unauthenticated" };
  }

  if (!isAdminUser(user)) {
    return { supabase, user: null, error: "forbidden" };
  }

  return { supabase, user, error: null };
}
