import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

let browserClient = null;
let serverClient = null;

function getSupabaseConfig() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!rawUrl || !anonKey) {
    return null;
  }

  const supabaseUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

  return { supabaseUrl, anonKey };
}

export function getSupabaseClient() {
  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  if (typeof window !== "undefined") {
    if (!browserClient) {
      browserClient = createBrowserClient(config.supabaseUrl, config.anonKey);
    }
    return browserClient;
  }

  if (!serverClient) {
    serverClient = createClient(config.supabaseUrl, config.anonKey);
  }

  return serverClient;
}
