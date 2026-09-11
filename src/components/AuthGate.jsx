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
import {
  ANNVERO_LOGOUT_IN_PROGRESS_EVENT,
  isLogoutInProgress,
} from "@/src/lib/auth/logoutInProgress";
import { hasSupabaseAuthCookieHint } from "@/src/lib/supabase/client";
import { buildLoginUrl } from "@/src/utils/authRedirect";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  handleAuthenticatedUserTransition,
  retryPendingTransferCleanupIfNeeded,
} from "@/src/utils/transferCacheLifecycle";

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
 * Logout devam ederken /login yönlendirmesi yapılmaz.
 */
export default function AuthGate({ children, hasAuthCookie = false }) {
  const router = useRouter();
  const pathname = usePathname();
  const [logoutActive, setLogoutActive] = useState(() => isLogoutInProgress());
  const [status, setStatus] = useState(() => {
    if (isLogoutInProgress()) return "loading";
    const cached = getCachedAuthStatus();
    if (cached !== "loading") return cached;
    if (hasAuthCookie) return "authenticated";
    return "loading";
  });

  useEffect(() => {
    const syncLogout = () => setLogoutActive(isLogoutInProgress());
    syncLogout();
    window.addEventListener(ANNVERO_LOGOUT_IN_PROGRESS_EVENT, syncLogout);
    return () => {
      window.removeEventListener(ANNVERO_LOGOUT_IN_PROGRESS_EVENT, syncLogout);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseClient();
    /** @type {string} */
    let lastKnownUserId = "";
    let bootstrapped = false;

    const applyStatus = (next) => {
      setCachedAuthStatus(next);
      if (isMounted) setStatus(next);
    };

    /** Retry-pending hydrate’den önce; unmount sonrası setState yok. */
    const enterAuthenticated = async (uid = "") => {
      const nextUid = String(uid || "").trim();
      lastKnownUserId = nextUid;
      bootstrapped = true;
      try {
        await retryPendingTransferCleanupIfNeeded();
      } catch {
        // ignore — fail-closed retry bir sonraki boot’ta
      }
      if (!isMounted) return;
      if (isLogoutInProgress()) {
        setLogoutActive(true);
        return;
      }
      applyStatus("authenticated");
    };

    const markUnauthenticated = () => {
      if (isLogoutInProgress()) {
        if (isMounted) setLogoutActive(true);
        return;
      }
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
      if (isLogoutInProgress()) {
        if (isMounted) setLogoutActive(true);
        return;
      }
      try {
        const { data } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_CHECK_TIMEOUT_MS
        );
        if (!isMounted) return;
        if (isLogoutInProgress()) {
          setLogoutActive(true);
          return;
        }
        // Bellek/localStorage-only oturum: API cookie yoksa fail-closed.
        if (data.session && hasSupabaseAuthCookieHint()) {
          const uid = String(data.session.user?.id || "").trim();
          await enterAuthenticated(uid);
          return;
        }
        if (data.session && !hasSupabaseAuthCookieHint()) {
          markUnauthenticated();
          return;
        }
        markUnauthenticated();
      } catch {
        if (isLogoutInProgress()) {
          if (isMounted) setLogoutActive(true);
          return;
        }
        try {
          const { data } = await withTimeout(
            supabase.auth.getUser(),
            REVERIFY_TIMEOUT_MS
          );
          if (!isMounted) return;
          if (isLogoutInProgress()) {
            setLogoutActive(true);
            return;
          }
          if (data.user && hasSupabaseAuthCookieHint()) {
            await enterAuthenticated(String(data.user.id || "").trim());
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
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (isLogoutInProgress()) {
        if (isMounted) setLogoutActive(true);
        return;
      }

      // TOKEN_REFRESHED / INITIAL_SESSION null: wipe yok
      if (event === "TOKEN_REFRESHED") {
        if (session && hasSupabaseAuthCookieHint()) {
          applyStatus("authenticated");
        }
        return;
      }

      const nextUserId = String(session?.user?.id || "").trim();

      if (event === "SIGNED_OUT") {
        const prev = lastKnownUserId;
        lastKnownUserId = "";
        bootstrapped = true;
        void handleAuthenticatedUserTransition(prev, "");
        markUnauthenticated();
        return;
      }

      if (session && hasSupabaseAuthCookieHint() && nextUserId) {
        if (bootstrapped && lastKnownUserId && lastKnownUserId !== nextUserId) {
          const prev = lastKnownUserId;
          void (async () => {
            await handleAuthenticatedUserTransition(prev, nextUserId);
            if (!isMounted) return;
            await enterAuthenticated(nextUserId);
          })();
          return;
        }
        void enterAuthenticated(nextUserId);
        return;
      }

      // session yok ama SIGNED_OUT değil (bootstrap / loading) — wipe yok
      if (!session?.user?.id) {
        if (bootstrapped && lastKnownUserId && event !== "INITIAL_SESSION") {
          // Belirsiz null: yalnız cookie yoksa unauthenticated; transfer wipe Auth transition ile
          if (!hasSupabaseAuthCookieHint()) {
            const prev = lastKnownUserId;
            lastKnownUserId = "";
            void handleAuthenticatedUserTransition(prev, "");
            markUnauthenticated();
          }
        }
        return;
      }

      markUnauthenticated();
    });

    const onAuthInvalid = () => markUnauthenticated();
    window.addEventListener(ANNVERO_AUTH_INVALID_EVENT, onAuthInvalid);

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      window.removeEventListener(ANNVERO_AUTH_INVALID_EVENT, onAuthInvalid);
    };
  }, [hasAuthCookie]);

  // Supabase invite/implicit flows token'ları çoğunlukla URL fragment/query içinde gelir.
  // Güvenlik için token'ları uygulama oturumunu kurduktan sonra URL'den temizliyoruz.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const cleanUrlIfAuthTokensPresent = () => {
      try {
        const url = new URL(window.location.href);
        const hash = url.hash || "";
        const hasTokenInHash =
          /(^#|&)access_token=/.test(hash) || hash.includes("refresh_token=");
        const hasTokenInQuery =
          url.searchParams.has("access_token") ||
          url.searchParams.has("refresh_token");

        if (!hasTokenInHash && !hasTokenInQuery) return;

        // Token'ları temizle, diğer query parametreleri (ör. error/next) bırak.
        if (hasTokenInHash) url.hash = "";
        if (hasTokenInQuery) {
          url.searchParams.delete("access_token");
          url.searchParams.delete("refresh_token");
          url.search = url.searchParams.toString()
            ? `?${url.searchParams.toString()}`
            : "";
        }

        window.history.replaceState(window.history.state, "", url.toString());
      } catch {
        // ignore
      }
    };

    // Supabase'in detectSessionInUrl akışı token'ları okuyup oturum kurabilsin.
    const t = window.setTimeout(cleanUrlIfAuthTokensPresent, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (logoutActive || isLogoutInProgress()) return;
    if (status !== "unauthenticated") return;

    void fetch("/api/auth/return-to", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
    }).catch(() => {});

    router.replace(buildLoginUrl());
  }, [status, pathname, router, logoutActive]);

  if (logoutActive || isLogoutInProgress()) {
    return <AuthLoadingScreen message="Çıkış yapılıyor..." />;
  }

  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (status === "unauthenticated") {
    return <AuthLoadingScreen message="Giriş sayfasına yönlendiriliyor..." />;
  }

  return children;
}
