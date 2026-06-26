import { createClient } from "@supabase/supabase-js";

let client = null;

export function getSupabaseClient() {
  if (client) return client;

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!rawUrl || !anonKey) {
    return null;
  }

  const supabaseUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  client = createClient(supabaseUrl, anonKey);
  return client;
}
