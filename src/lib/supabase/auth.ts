import type { AuthError, Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKeyType, getSupabaseConfig } from "./config";

export const SUPABASE_NETWORK_ERROR_MESSAGE =
  "Supabase bağlantısı kurulamadı.";

export type SupabaseAuthSettingsCheck = {
  ok: boolean;
  issues: string[];
  supabaseUrl: string;
  hasAnonKey: boolean;
  anonKeyType: ReturnType<typeof getSupabaseAnonKeyType>;
  isBrowser: boolean;
  origin: string | null;
};

export type SupabaseAuthConnectionTest = {
  ok: boolean;
  networkError: boolean;
  error: AuthError | Error | unknown | null;
  session: Session | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return String(error);
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    return (
      message.includes("fetch") ||
      message.includes("network") ||
      message.includes("load failed")
    );
  }

  const message = getErrorMessage(error).toLowerCase();

  if (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed")
  ) {
    return true;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 0
  ) {
    return true;
  }

  return false;
}

export function logNetworkError(
  context: string,
  error: unknown,
  extra: Record<string, unknown> = {}
): void {
  const config = getSupabaseConfig();

  console.error(`[login][${context}] network error`, {
    message: getErrorMessage(error),
    name: error instanceof Error ? error.name : typeof error,
    stack: error instanceof Error ? error.stack : undefined,
    cause: error instanceof Error ? error.cause : undefined,
    origin: typeof window !== "undefined" ? window.location.origin : null,
    supabaseUrl: config?.supabaseUrl ?? null,
    hasAnonKey: Boolean(config?.anonKey),
    error,
    ...extra,
  });
}

export function checkSupabaseAuthSettings(): SupabaseAuthSettingsCheck {
  const config = getSupabaseConfig();
  const issues: string[] = [];
  const origin =
    typeof window !== "undefined" ? window.location.origin : null;

  if (!config) {
    issues.push("Supabase URL veya anon key eksik.");

    return {
      ok: false,
      issues,
      supabaseUrl: "",
      hasAnonKey: false,
      anonKeyType: "unknown",
      isBrowser: typeof window !== "undefined",
      origin,
    };
  }

  if (process.env.NODE_ENV === "production") {
    if (!config.supabaseUrl.startsWith("https://")) {
      issues.push("Production ortamında Supabase URL https olmalı.");
    }

    if (!config.supabaseUrl.includes(".supabase.co")) {
      issues.push("Supabase URL .supabase.co domain kullanmalı.");
    }

    if (origin && !origin.startsWith("https://")) {
      issues.push("Production site origin https olmalı.");
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    supabaseUrl: config.supabaseUrl,
    hasAnonKey: Boolean(config.anonKey),
    anonKeyType: getSupabaseAnonKeyType(config.anonKey),
    isBrowser: typeof window !== "undefined",
    origin,
  };
}

export async function testSupabaseAuthConnection(
  supabase: SupabaseClient
): Promise<SupabaseAuthConnectionTest> {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      return {
        ok: false,
        networkError: isNetworkError(error),
        error,
        session: null,
      };
    }

    return {
      ok: true,
      networkError: false,
      error: null,
      session: data.session,
    };
  } catch (error) {
    return {
      ok: false,
      networkError: isNetworkError(error),
      error,
      session: null,
    };
  }
}

export function getLoginErrorMessage(error: unknown): string {
  if (isNetworkError(error)) {
    return SUPABASE_NETWORK_ERROR_MESSAGE;
  }

  return getErrorMessage(error) || "Giriş başarısız.";
}
