"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AnnveroLogo from "@/app/components/AnnveroLogo";
import AuthLoadingScreen from "@/src/components/AuthLoadingScreen";
import { buildLoginErrorRedirect } from "@/src/lib/auth/authCallback";
import { resolveAuthHomePathForUser } from "@/src/config/annveroTaxpayerPortal";
import {
  getSupabaseBrowserClient,
  hasSupabaseAuthCookieHint,
} from "@/src/lib/supabase/client";
import { consumeReturnToPathClient } from "@/src/utils/authRedirect";

const MIN_PASSWORD_LENGTH = 8;

export default function SetPasswordForm() {
  const router = useRouter();
  const submitLock = useRef(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) router.replace(buildLoginErrorRedirect("supabase_config_missing"));
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!data.session || !hasSupabaseAuthCookieHint()) {
        router.replace(buildLoginErrorRedirect("auth_callback_missing_token"));
        return;
      }

      setIsCheckingSession(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLock.current || isLoading) return;

    setError("");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Şifreler eşleşmiyor.");
      return;
    }

    submitLock.current = true;
    setIsLoading(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Kimlik doğrulama yapılandırması eksik.");
      setIsLoading(false);
      submitLock.current = false;
      return;
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      if (!hasSupabaseAuthCookieHint()) {
        throw new Error("session_refresh_failed");
      }

      try {
        await fetch("/api/auth/me", {
          credentials: "include",
          cache: "no-store",
        });
      } catch {
        // best-effort
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const defaultPath =
        resolveAuthHomePathForUser(sessionData.session?.user) || "/dashboard";
      const target = await consumeReturnToPathClient(defaultPath);
      router.replace(target);
    } catch {
      setError("Şifre kaydedilemedi. Lütfen tekrar deneyin.");
      setIsLoading(false);
      submitLock.current = false;
    }
  };

  if (isCheckingSession) {
    return <AuthLoadingScreen message="Oturum doğrulanıyor..." />;
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden bg-[#05070c] px-4 py-10 text-white">
      <div className="relative w-full max-w-[420px] rounded-2xl border border-white/10 bg-zinc-950/90 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-sm sm:p-10">
        <div className="flex justify-center">
          <AnnveroLogo onLight={false} size={40} priority />
        </div>

        <h1 className="mt-6 text-center text-2xl font-semibold tracking-tight text-white">
          Şifre Belirle
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-400">
          Davetinizi tamamlamak için hesabınıza bir şifre oluşturun.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="annvero-new-password" className="text-sm font-medium text-zinc-300">
              Yeni şifre
            </label>
            <input
              id="annvero-new-password"
              type="password"
              name="password"
              value={password}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              disabled={isLoading}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-black/60 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-sky-500/60 disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="En az 8 karakter"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="annvero-confirm-password" className="text-sm font-medium text-zinc-300">
              Şifre tekrar
            </label>
            <input
              id="annvero-confirm-password"
              type="password"
              name="confirmPassword"
              value={confirmPassword}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              disabled={isLoading}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-black/60 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-sky-500/60 disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="Şifrenizi tekrar girin"
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex w-full items-center justify-center rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Kaydediliyor..." : "Şifreyi kaydet ve devam et"}
          </button>
        </form>
      </div>
    </main>
  );
}
