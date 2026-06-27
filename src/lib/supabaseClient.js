import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

let browserClient = null;
let serverClient = null;

function normalizeSupabaseUrl(rawUrl) {
  if (!rawUrl) return "";
  return rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
}

function isValidSupabaseUrl(supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getSupabaseEnvDebugInfo() {
  const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const supabaseUrl = normalizeSupabaseUrl(rawUrl);

  return {
    supabaseUrl,
    hasAnonKey: Boolean(anonKey),
  };
}

export function getSupabaseConfig() {
  const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  if (!rawUrl || !anonKey) {
    return null;
  }

  const supabaseUrl = normalizeSupabaseUrl(rawUrl);

  if (!isValidSupabaseUrl(supabaseUrl)) {
    return null;
  }

  return { supabaseUrl, anonKey, rawUrl };
}

export function isSupabaseConfigured() {
  return getSupabaseConfig() !== null;
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
