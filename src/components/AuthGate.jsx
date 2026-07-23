"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AuthLoadingScreen from "@/src/components/AuthLoadingScreen";
import {
  ANNVERO_AUTH_INVALID_EVENT,
  getCachedAuthStatus,
  setCachedAuthStatus,
} from "@/src/components/authGateCache";
import { clearClientSessionCaches } from "@/src/lib/auth/clearClientSession";
import { hasSupabaseAuthCookieHint } from "@/src/lib/supabase/client";
import { buildLoginUrl } from "@/src/utils/authRedirect";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

const SESSION_CHECK_TIMEOUT_MS = 2500;
const REVERIFY_TIMEOUT_MS = 4000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("auth_session_timeout")), ms);
    }),
  ]);
}

/**
 * hasAuthCookie yalnız ilk paint ipucudur — yetki kaynağı değildir.
 * getSession timeout sonrası getUser ile yeniden doğrulanır; başarısızsa /login.
 */
export default function AuthGate({ children, hasAuthCookie = false }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState(() => {
    const cached = getCachedAuthStatus();
    if (cached !== "loading") return cached;
    if (hasAuthCookie) return "authenticated";
    return "loading";
  });

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseClient();

    const applyStatus = (next) => {
      setCachedAuthStatus(next);
      if (isMounted) setStatus(next);
    };

    const markUnauthenticated = () => {
      clearClientSessionCaches();
      applyStatus("unauthenticated");
    };

    if (!supabase) {
      queueMicrotask(() => markUnauthenticated());
      return () => {
        isMounted = false;
      };
    }

    const verifySession = async () => {
      try {
        const { data } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_CHECK_TIMEOUT_MS
        );
        if (!isMounted) return;
        // Bellek/localStorage-only oturum: API cookie yoksa fail-closed.
        if (data.session && hasSupabaseAuthCookieHint()) {
          applyStatus("authenticated");
          return;
        }
        if (data.session && !hasSupabaseAuthCookieHint()) {
          markUnauthenticated();
          return;
        }
        markUnauthenticated();
      } catch {
        try {
          const { data } = await withTimeout(
            supabase.auth.getUser(),
            REVERIFY_TIMEOUT_MS
          );
          if (!isMounted) return;
          if (data.user && hasSupabaseAuthCookieHint()) {
            applyStatus("authenticated");
            return;
          }
        } catch {
          // fall through
        }
        if (isMounted) markUnauthenticated();
      }
    };

    void verifySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && hasSupabaseAuthCookieHint()) applyStatus("authenticated");
      else markUnauthenticated();
    });

    const onAuthInvalid = () => markUnauthenticated();
    window.addEventListener(ANNVERO_AUTH_INVALID_EVENT, onAuthInvalid);

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      window.removeEventListener(ANNVERO_AUTH_INVALID_EVENT, onAuthInvalid);
    };
  }, [hasAuthCookie]);

  useEffect(() => {
    if (status !== "unauthenticated") return;

    void fetch("/api/auth/return-to", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
    }).catch(() => {});

    router.replace(buildLoginUrl());
  }, [status, pathname, router]);

  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (status === "unauthenticated") {
    return <AuthLoadingScreen message="Giriş sayfasına yönlendiriliyor..." />;
  }

  return children;
}
