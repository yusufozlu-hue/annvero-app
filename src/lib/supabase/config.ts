export type SupabaseConfig = {
  supabaseUrl: string;
  anonKey: string;
  rawUrl: string;
};

export type SupabaseAnonKeyType = "jwt" | "publishable" | "secret" | "unknown";

function normalizeEnvValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function normalizeSupabaseUrl(rawUrl: string): string {
  if (!rawUrl) return "";

  const withProtocol = rawUrl.startsWith("http")
    ? rawUrl
    : `https://${rawUrl}`;

  return withProtocol.replace(/\/+$/, "");
}

export function getSupabaseAnonKeyType(anonKey: string): SupabaseAnonKeyType {
  if (anonKey.startsWith("eyJ")) {
    return "jwt";
  }

  if (anonKey.startsWith("sb_publishable_")) {
    return "publishable";
  }

  if (anonKey.startsWith("sb_secret_")) {
    return "secret";
  }

  return "unknown";
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
  const rawUrl = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const anonKey = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  const supabaseUrl = normalizeSupabaseUrl(rawUrl);

  return {
    supabaseUrl,
    hasAnonKey: Boolean(anonKey),
    anonKeyType: getSupabaseAnonKeyType(anonKey),
  };
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const rawUrl = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const anonKey = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");

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
