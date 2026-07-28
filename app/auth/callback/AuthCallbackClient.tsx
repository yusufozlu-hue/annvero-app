"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthLoadingScreen from "@/src/components/AuthLoadingScreen";
import {
  AUTH_CALLBACK_ERROR_CODES,
  buildLoginErrorRedirect,
  detectAuthCallbackMode,
  mapSupabaseAuthErrorToCode,
  parseHashParams,
  resolvePostAuthPath,
  stripSensitiveAuthParamsFromUrl,
  urlHasSensitiveAuthTokens,
} from "@/src/lib/auth/authCallback";
import {
  getSupabaseBrowserClient,
  hasSupabaseAuthCookieHint,
} from "@/src/lib/supabase/client";
import { consumeReturnToPathClient } from "@/src/utils/authRedirect";

const LOGIN_EVENT_TYPE = "oauth_callback";

function logAuthCallbackFailure(context: string, error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : "unknown";
  console.error(`[auth/callback] ${context}`, { message });
}

async function syncProfileAndAudit() {
  try {
    await fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    // profil senkronu sonraki istekte tamamlanır
  }

  try {
    await fetch("/api/auth/login-event", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: LOGIN_EVENT_TYPE,
        source: "auth_callback",
        success: true,
      }),
    });
  } catch {
    // fire-and-forget
  }
}

export default function AuthCallbackClient() {
  const router = useRouter();
  const handledRef = useRef(false);
  const [message, setMessage] = useState("Oturum doğrulanıyor...");

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    void (async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        router.replace(buildLoginErrorRedirect(AUTH_CALLBACK_ERROR_CODES.CONFIG_MISSING));
        return;
      }

      const initialHref = window.location.href;
      const url = new URL(initialHref);
      const hashParams = parseHashParams(url.hash);
      const mode = detectAuthCallbackMode(url.searchParams, hashParams);

      if (urlHasSensitiveAuthTokens(url)) {
        const cleaned = stripSensitiveAuthParamsFromUrl(initialHref);
        window.history.replaceState(window.history.state, "", cleaned);
      }

      try {
        if (mode.mode === "none") {
          const { data } = await supabase.auth.getSession();
          if (data.session && hasSupabaseAuthCookieHint()) {
            const target = resolvePostAuthPath({
              user: data.session.user,
              nextPath: await consumeReturnToPathClient(),
            });
            router.replace(target);
            return;
          }
          router.replace(
            buildLoginErrorRedirect(AUTH_CALLBACK_ERROR_CODES.MISSING_TOKEN)
          );
          return;
        }

        let session = null;
        let authType = mode.type || "";

        if (mode.mode === "pkce" && mode.code) {
          setMessage("Oturum oluşturuluyor...");
          const { data, error } = await supabase.auth.exchangeCodeForSession(
            mode.code
          );
          if (error) throw error;
          session = data.session;
          authType = authType || String(url.searchParams.get("type") || "");
          window.history.replaceState(
            window.history.state,
            "",
            stripSensitiveAuthParamsFromUrl(window.location.href, {
              stripCode: true,
            })
          );
        } else if (mode.mode === "token_hash" && mode.tokenHash && mode.type) {
          setMessage("Davet doğrulanıyor...");
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: mode.tokenHash,
            type: mode.type as "invite" | "recovery" | "signup" | "email",
          });
          if (error) throw error;
          session = data.session;
          authType = mode.type;
          window.history.replaceState(
            window.history.state,
            "",
            stripSensitiveAuthParamsFromUrl(window.location.href, {
              stripOtp: true,
            })
          );
        } else if (
          mode.mode === "fragment" &&
          mode.accessToken &&
          mode.refreshToken
        ) {
          setMessage("Davet doğrulanıyor...");
          const { data, error } = await supabase.auth.setSession({
            access_token: mode.accessToken,
            refresh_token: mode.refreshToken,
          });
          if (error) throw error;
          session = data.session;
          authType = mode.type || authType;
        }

        if (!session?.user) {
          router.replace(
            buildLoginErrorRedirect(AUTH_CALLBACK_ERROR_CODES.FAILED)
          );
          return;
        }

        if (!hasSupabaseAuthCookieHint()) {
          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }

        if (!hasSupabaseAuthCookieHint()) {
          router.replace(
            buildLoginErrorRedirect(AUTH_CALLBACK_ERROR_CODES.FAILED)
          );
          return;
        }

        await syncProfileAndAudit();

        const nextPath = await consumeReturnToPathClient();
        const target = resolvePostAuthPath({
          authType,
          user: session.user,
          nextPath,
        });
        router.replace(target);
      } catch (error) {
        logAuthCallbackFailure("session_setup_failed", error);
        router.replace(
          buildLoginErrorRedirect(mapSupabaseAuthErrorToCode(error))
        );
      }
    })();
  }, [router]);

  return (
    <AuthLoadingScreen
      message={message}
    />
  );
}
