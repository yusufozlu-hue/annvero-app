"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthLoadingScreen from "@/src/components/AuthLoadingScreen";
import { getSafeNextPath } from "@/src/utils/authRedirect";
import {
  checkSupabaseAuthSettings,
  getLoginErrorMessage,
  isNetworkError,
  logNetworkError,
  SUPABASE_NETWORK_ERROR_MESSAGE,
  testSupabaseAuthConnection,
} from "@/src/lib/supabase/auth";
import { getSupabaseConfig } from "@/src/lib/supabase/config";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";

const CONFIG_MISSING_MESSAGE = "Supabase bağlantı bilgileri eksik";
const CONFIG_MISSING_PRODUCTION_MESSAGE =
  "Supabase bağlantı bilgileri production ortamında eksik.";

function getConfigMissingMessage() {
  if (process.env.NODE_ENV === "production") {
    return CONFIG_MISSING_PRODUCTION_MESSAGE;
  }

  return CONFIG_MISSING_MESSAGE;
}

function logLoginError(error: unknown) {
  console.error("LOGIN ERROR:", error);

  if (isNetworkError(error)) {
    logNetworkError("login", error);
  }
}

function LoginDebugPanel({
  hasSupabaseUrl,
  hasAnonKey,
  pageOrigin,
  supabaseUrl,
  anonKeyType,
  authSettingsIssues,
}: {
  hasSupabaseUrl: boolean;
  hasAnonKey: boolean;
  pageOrigin: string;
  supabaseUrl: string;
  anonKeyType: string;
  authSettingsIssues: string[];
}) {
  return (
    <div className="mt-4 rounded-xl border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-xs text-amber-100">
      <p className="font-semibold text-amber-200">Debug</p>
      <ul className="mt-2 space-y-1">
        <li>Supabase URL mevcut mu? {hasSupabaseUrl ? "Evet" : "Hayır"}</li>
        <li>Supabase URL: {supabaseUrl || "-"}</li>
        <li>Anon key mevcut mu? {hasAnonKey ? "Evet" : "Hayır"}</li>
        <li>Anon key tipi: {anonKeyType}</li>
        <li>window.location.origin: {pageOrigin || "-"}</li>
        {authSettingsIssues.length > 0 ? (
          <li>Auth ayar uyarıları: {authSettingsIssues.join(" | ")}</li>
        ) : (
          <li>Auth ayarları: OK</li>
        )}
      </ul>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isConfigMissing, setIsConfigMissing] = useState(false);
  const [pageOrigin, setPageOrigin] = useState("");
  const [authSettingsIssues, setAuthSettingsIssues] = useState<string[]>([]);
  const [debugSupabaseUrl, setDebugSupabaseUrl] = useState("");
  const [debugAnonKeyType, setDebugAnonKeyType] = useState("unknown");

  const showDebug =
    process.env.NODE_ENV === "development" ||
    searchParams.get("debug") === "1";
  const hasSupabaseUrl = Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  );
  const hasAnonKey = Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()
  );

  useEffect(() => {
    console.log("SUPABASE URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log(
      "SUPABASE KEY EXISTS:",
      !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    setPageOrigin(window.location.origin);

    const authSettings = checkSupabaseAuthSettings();
    setAuthSettingsIssues(authSettings.issues);
    setDebugSupabaseUrl(authSettings.supabaseUrl);
    setDebugAnonKeyType(authSettings.anonKeyType);

    if (!authSettings.ok) {
      console.warn("[login] Supabase auth settings:", authSettings);
    }
  }, []);

  useEffect(() => {
    const config = getSupabaseConfig();

    if (!config) {
      setIsConfigMissing(true);
      setError(getConfigMissingMessage());
      setIsCheckingSession(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setIsConfigMissing(true);
      setError(getConfigMissingMessage());
      setIsCheckingSession(false);
      return;
    }

    void (async () => {
      try {
        const connectionTest = await testSupabaseAuthConnection(supabase);

        if (!connectionTest.ok) {
          logLoginError(connectionTest.error);

          if (connectionTest.networkError) {
            logNetworkError("initial-getSession", connectionTest.error);
            setError(SUPABASE_NETWORK_ERROR_MESSAGE);
          } else if (connectionTest.error instanceof Error) {
            setError(connectionTest.error.message);
          } else if (
            typeof connectionTest.error === "object" &&
            connectionTest.error !== null &&
            "message" in connectionTest.error
          ) {
            setError(String((connectionTest.error as { message: string }).message));
          }

          setIsCheckingSession(false);
          return;
        }

        if (connectionTest.session) {
          router.replace(getSafeNextPath(searchParams.get("next")));
          return;
        }

        setIsCheckingSession(false);
      } catch (caughtError) {
        logLoginError(caughtError);

        if (isNetworkError(caughtError)) {
          logNetworkError("initial-session-check", caughtError);
          setError(SUPABASE_NETWORK_ERROR_MESSAGE);
        } else {
          setError(getLoginErrorMessage(caughtError));
        }

        setIsCheckingSession(false);
      }
    })();
  }, [router, searchParams]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const config = getSupabaseConfig();

    if (!config) {
      setIsConfigMissing(true);
      setError(getConfigMissingMessage());
      setIsLoading(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setIsConfigMissing(true);
      setError(getConfigMissingMessage());
      setIsLoading(false);
      return;
    }

    try {
      const connectionTest = await testSupabaseAuthConnection(supabase);

      if (!connectionTest.ok && connectionTest.networkError) {
        logLoginError(connectionTest.error);
        logNetworkError("pre-signin-getSession", connectionTest.error, {
          email: email.trim(),
        });
        setError(SUPABASE_NETWORK_ERROR_MESSAGE);
        setIsLoading(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        logLoginError(signInError);

        if (isNetworkError(signInError)) {
          logNetworkError("signInWithPassword", signInError, {
            email: email.trim(),
          });
          setError(SUPABASE_NETWORK_ERROR_MESSAGE);
        } else {
          setError(signInError.message);
        }

        setIsLoading(false);
        return;
      }

      router.push(getSafeNextPath(searchParams.get("next")));
      router.refresh();
    } catch (caughtError) {
      logLoginError(caughtError);

      if (isNetworkError(caughtError)) {
        logNetworkError("signInWithPassword-catch", caughtError, {
          email: email.trim(),
        });
        setError(SUPABASE_NETWORK_ERROR_MESSAGE);
      } else {
        setError(getLoginErrorMessage(caughtError));
      }

      setIsLoading(false);
    }
  };

  if (isCheckingSession) {
    return <AuthLoadingScreen message="Oturum kontrol ediliyor..." />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-zinc-900 p-10">
        <h1 className="text-center text-3xl font-bold">ANNVERO</h1>

        <p className="mt-2 text-center text-gray-400">Platform Girişi</p>

        {showDebug ? (
          <LoginDebugPanel
            hasSupabaseUrl={hasSupabaseUrl}
            hasAnonKey={hasAnonKey}
            pageOrigin={pageOrigin}
            supabaseUrl={debugSupabaseUrl}
            anonKeyType={debugAnonKeyType}
            authSettingsIssues={authSettingsIssues}
          />
        ) : null}

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <input
            type="email"
            placeholder="E-posta"
            value={email}
            autoComplete="email"
            required
            disabled={isConfigMissing}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-xl border border-gray-700 bg-black px-4 py-3 outline-none focus:border-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
          />

          <input
            type="password"
            placeholder="Şifre"
            value={password}
            autoComplete="current-password"
            required
            disabled={isConfigMissing}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-xl border border-gray-700 bg-black px-4 py-3 outline-none focus:border-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
          />

          {error ? (
            <p className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isLoading || isConfigMissing}
            className="mt-2 rounded-xl bg-white py-3 text-center font-semibold text-black transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthLoadingScreen message="Oturum kontrol ediliyor..." />}>
      <LoginForm />
    </Suspense>
  );
}
