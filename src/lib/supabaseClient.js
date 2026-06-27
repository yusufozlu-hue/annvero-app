import { createClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./supabase/client";
import {
  getSupabaseConfig,
  getSupabaseEnvDebugInfo,
  isSupabaseConfigured,
} from "./supabase/config";

let serverClient = null;

export { getSupabaseConfig, getSupabaseEnvDebugInfo, isSupabaseConfigured };

export function getSupabaseClient() {
  if (typeof window !== "undefined") {
    return getSupabaseBrowserClient();
  }

  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  if (!serverClient) {
    serverClient = createClient(config.supabaseUrl, config.anonKey);
  }

  return serverClient;
}
