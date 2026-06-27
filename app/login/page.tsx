"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthLoadingScreen from "@/src/components/AuthLoadingScreen";
import { getSafeNextPath } from "@/src/utils/authRedirect";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setIsCheckingSession(false);
      return;
    }

    void (async () => {
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        router.replace(getSafeNextPath(searchParams.get("next")));
        return;
      }

      setIsCheckingSession(false);
    })();
  }, [router, searchParams]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const supabase = getSupabaseClient();

    if (!supabase) {
      setError("Supabase yapılandırması bulunamadı.");
      setIsLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setIsLoading(false);
      return;
    }

    router.push(getSafeNextPath(searchParams.get("next")));
    router.refresh();
  };

  if (isCheckingSession) {
    return <AuthLoadingScreen message="Oturum kontrol ediliyor..." />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-zinc-900 p-10">
        <h1 className="text-center text-3xl font-bold">ANNVERO</h1>

        <p className="mt-2 text-center text-gray-400">Platform Girişi</p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <input
            type="email"
            placeholder="E-posta"
            value={email}
            autoComplete="email"
            required
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-xl border border-gray-700 bg-black px-4 py-3 outline-none focus:border-gray-500"
          />

          <input
            type="password"
            placeholder="Şifre"
            value={password}
            autoComplete="current-password"
            required
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-xl border border-gray-700 bg-black px-4 py-3 outline-none focus:border-gray-500"
          />

          {error ? (
            <p className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isLoading}
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
