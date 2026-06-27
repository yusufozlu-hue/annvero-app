export type SupabaseConfig = {
  supabaseUrl: string;
  anonKey: string;
  rawUrl: string;
};

function normalizeSupabaseUrl(rawUrl: string): string {
  if (!rawUrl) return "";

  const withProtocol = rawUrl.startsWith("http")
    ? rawUrl
    : `https://${rawUrl}`;

  return withProtocol.replace(/\/+$/, "");
}

function isValidSupabaseUrl(supabaseUrl: string): boolean {
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

export function getSupabaseConfig(): SupabaseConfig | null {
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

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}
