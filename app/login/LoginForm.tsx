"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AnnveroLogo from "@/app/components/AnnveroLogo";
import {
  checkSupabaseAuthSettings,
  getLoginErrorMessage,
  isNetworkError,
  logNetworkError,
  SUPABASE_NETWORK_ERROR_MESSAGE,
} from "@/src/lib/supabase/auth";
import { getSupabaseConfig } from "@/src/lib/supabase/config";
import {
  clearClientAuthStorage,
  getSupabaseBrowserClient,
  setRememberMePreference,
} from "@/src/lib/supabase/client";
import {
  ANNVERO_REMEMBER_ME_KEY,
  getSafeNextPath,
} from "@/src/utils/authRedirect";

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

function readInitialRememberMe(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(ANNVERO_REMEMBER_ME_KEY);
    if (raw == null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

async function consumeReturnToPath(): Promise<string> {
  try {
    const res = await fetch("/api/auth/return-to", {
      credentials: "include",
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { path?: string };
      return getSafeNextPath(data?.path, "/dashboard");
    }
  } catch {
    // fallback
  }
  return "/dashboard";
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3 3l18 18M10.5 10.6a2.5 2.5 0 003.5 3.5M9.9 5.2A10.5 10.5 0 0112 5c5 0 9.3 3.1 10.8 7.5a11.4 11.4 0 01-4.2 5.3M6.6 6.6A11.3 11.3 0 001.2 12.5C2.7 16.9 7 20 12 20c1.4 0 2.7-.2 3.9-.7"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.2 12.5C3.7 8.1 7.9 5 12.9 5c5 0 9.2 3.1 10.7 7.5-1.5 4.4-5.7 7.5-10.7 7.5-5 0-9.2-3.1-10.7-7.5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12.9" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 11V8a4 4 0 018 0v3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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

export default function LoginForm() {
  const router = useRouter();
  const submitLock = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isConfigMissing, setIsConfigMissing] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [pageOrigin, setPageOrigin] = useState("");
  const [authSettingsIssues, setAuthSettingsIssues] = useState<string[]>([]);
  const [debugSupabaseUrl, setDebugSupabaseUrl] = useState("");
  const [debugAnonKeyType, setDebugAnonKeyType] = useState("unknown");

  const hasSupabaseUrl = Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
  );
  const hasAnonKey = Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()
  );

  // Form her zaman boyanır — oturum / profil beklemez.
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const remember = readInitialRememberMe();
      const origin = window.location.origin;
      const params = new URLSearchParams(window.location.search);
      const debug = params.get("debug") === "1";

      if (cancelled) return;
      setRememberMe(remember);
      setPageOrigin(origin);
      setShowDebug(debug);

      const legacyNext = params.get("next");
      if (legacyNext) {
        try {
          await fetch("/api/auth/return-to", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: legacyNext }),
          });
        } catch {
          // best-effort
        }
        if (!cancelled) {
          window.history.replaceState({}, "", "/login");
        }
      } else if (params.has("error") || params.has("debug")) {
        const clean = new URLSearchParams();
        if (debug) clean.set("debug", "1");
        if (params.get("error")) clean.set("error", params.get("error") || "");
        const qs = clean.toString();
        window.history.replaceState({}, "", qs ? `/login?${qs}` : "/login");
      }

      const authSettings = checkSupabaseAuthSettings();
      if (cancelled) return;
      setAuthSettingsIssues(authSettings.issues);
      setDebugSupabaseUrl(authSettings.supabaseUrl);
      setDebugAnonKeyType(authSettings.anonKeyType);

      const config = getSupabaseConfig();
      if (!config) {
        setIsConfigMissing(true);
        setError(getConfigMissingMessage());
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setIsConfigMissing(true);
        setError(getConfigMissingMessage());
        return;
      }

      try {
        // Token refresh asla formu bekletmesin / sonsuza asılmasın
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: null } }>((resolve) => {
            setTimeout(() => resolve({ data: { session: null } }), 1200);
          }),
        ]);
        const session = sessionResult.data.session;
        if (cancelled || !session) return;
        const target = await consumeReturnToPath();
        if (!cancelled) router.replace(target);
      } catch {
        // Form görünür kalsın; kullanıcı manuel giriş yapabilir
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLock.current || isLoading) return;
    submitLock.current = true;
    setError("");
    setIsLoading(true);

    const config = getSupabaseConfig();
    if (!config) {
      setIsConfigMissing(true);
      setError(getConfigMissingMessage());
      setIsLoading(false);
      submitLock.current = false;
      return;
    }

    try {
      setRememberMePreference(rememberMe);
      clearClientAuthStorage();
      const { clearClientSessionCaches } = await import(
        "@/src/lib/auth/clearClientSession"
      );
      clearClientSessionCaches();
      const supabase = getSupabaseBrowserClient({ rememberMe });
      if (!supabase) {
        setIsConfigMissing(true);
        setError(getConfigMissingMessage());
        setIsLoading(false);
        submitLock.current = false;
        return;
      }

      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (signInError) {
        logLoginError(signInError);
        if (isNetworkError(signInError)) {
          logNetworkError("signInWithPassword", signInError, {
            email: email.trim(),
          });
          setError(`Giriş başarısız: ${SUPABASE_NETWORK_ERROR_MESSAGE}`);
        } else {
          setError(`Giriş başarısız: ${signInError.message}`);
        }
        setIsLoading(false);
        submitLock.current = false;
        return;
      }

      if (!signInData.session || !signInData.user) {
        setError("Giriş başarısız: Oturum oluşturulamadı");
        setIsLoading(false);
        submitLock.current = false;
        return;
      }

      try {
        const meResponse = await fetch("/api/auth/me", {
          cache: "no-store",
          credentials: "include",
        });
        const meData = await meResponse.json();

        if (meData.active === false || meResponse.status === 403) {
          setError("Hesabınız pasif durumda. Yöneticinize başvurun.");
          await supabase.auth.signOut();
          clearClientAuthStorage();
          setIsLoading(false);
          submitLock.current = false;
          return;
        }

        void fetch("/api/auth/login-event", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "password_login",
            event_type: "login",
          }),
        });
      } catch {
        // profil kontrolü başarısız olsa bile oturum varsa devam
      }

      const redirectTarget = await consumeReturnToPath();
      router.refresh();
      router.push(redirectTarget);
    } catch (caughtError) {
      logLoginError(caughtError);
      if (isNetworkError(caughtError)) {
        logNetworkError("signInWithPassword-catch", caughtError, {
          email: email.trim(),
        });
        setError(`Giriş başarısız: ${SUPABASE_NETWORK_ERROR_MESSAGE}`);
      } else {
        setError(`Giriş başarısız: ${getLoginErrorMessage(caughtError)}`);
      }
      setIsLoading(false);
      submitLock.current = false;
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden bg-[#05070c] px-4 py-10 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.08),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(99,102,241,0.06),_transparent_50%)]"
      />

      <div className="relative w-full max-w-[420px] rounded-2xl border border-white/10 bg-zinc-950/90 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-sm sm:p-10">
        <div className="flex justify-center">
          <AnnveroLogo onLight={false} size={40} priority />
        </div>

        <p className="mt-5 text-center text-[11px] font-semibold tracking-[0.22em] text-sky-300/80">
          ANNVERO PLATFORM
        </p>
        <h1 className="mt-2 text-center text-2xl font-semibold tracking-tight text-white">
          Hesabınıza giriş yapın
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-400">
          Muhasebe ve vergi operasyonlarınızı güvenli şekilde yönetin.
        </p>

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

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5" noValidate={false}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="annvero-email" className="text-sm font-medium text-zinc-300">
              E-posta
            </label>
            <input
              id="annvero-email"
              type="email"
              name="email"
              value={email}
              autoComplete="email"
              required
              disabled={isConfigMissing || isLoading}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-black/60 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-sky-500/60 disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="ornek@firma.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="annvero-password" className="text-sm font-medium text-zinc-300">
              Şifre
            </label>
            <div className="relative">
              <input
                id="annvero-password"
                type={showPassword ? "text" : "password"}
                name="password"
                value={password}
                autoComplete="current-password"
                required
                disabled={isConfigMissing || isLoading}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-black/60 px-4 py-3 pr-12 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-sky-500/60 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 transition hover:text-zinc-200"
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
              <input
                type="checkbox"
                checked={rememberMe}
                disabled={isLoading}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-600 bg-black text-sky-500 focus:ring-sky-500/40"
              />
              Beni hatırla
            </label>
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <LockIcon />
              Güvenli oturum
            </span>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isLoading || isConfigMissing}
            className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3.5 text-sm font-semibold text-black transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Giriş yapılıyor…" : "Giriş Yap"}
            {!isLoading ? <ArrowIcon /> : null}
          </button>
        </form>
      </div>
    </main>
  );
}
