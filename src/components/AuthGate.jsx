"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AuthLoadingScreen from "@/src/components/AuthLoadingScreen";
import { buildLoginUrl } from "@/src/utils/authRedirect";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

/**
 * Modül düzeyinde oturum önbelleği — soft remount'ta tam ekran loading yok.
 */
let cachedAuthStatus = /** @type {"loading"|"authenticated"|"unauthenticated"} */ (
  "loading"
);

export default function AuthGate({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState(cachedAuthStatus);

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseClient();

    const applyStatus = (next) => {
      cachedAuthStatus = next;
      if (isMounted) setStatus(next);
    };

    if (!supabase) {
      queueMicrotask(() => applyStatus("unauthenticated"));
      return () => {
        isMounted = false;
      };
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      applyStatus(session ? "authenticated" : "unauthenticated");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applyStatus(session ? "authenticated" : "unauthenticated");
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (status !== "unauthenticated") return;

    let cancelled = false;
    (async () => {
      try {
        await fetch("/api/auth/return-to", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: pathname }),
        });
      } catch {
        // Cookie yazılamasa da temiz /login'e git
      }
      if (!cancelled) {
        router.replace(buildLoginUrl());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, pathname, router]);

  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (status === "unauthenticated") {
    return <AuthLoadingScreen message="Giriş sayfasına yönlendiriliyor..." />;
  }

  return children;
}
