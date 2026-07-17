"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AuthLoadingScreen from "@/src/components/AuthLoadingScreen";
import { buildLoginUrl } from "@/src/utils/authRedirect";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

/**
 * Modül düzeyinde oturum önbelleği.
 * AuthGate soft remount olsa bile tekrar tam ekran AuthLoadingScreen
 * göstermemek için; güvenlik zayıflatılmaz — getSession ve
 * onAuthStateChange arka planda doğrular, gerçek oturum düşüşünde yönlendirir.
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
      // Senkron setState-in-effect kuralını aşmak için mikro görev.
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

    router.replace(buildLoginUrl(pathname));
  }, [status, pathname, router]);

  // Tam ekran loading yalnız gerçekten bilinmeyen ilk açılışta.
  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (status === "unauthenticated") {
    return <AuthLoadingScreen message="Giriş sayfasına yönlendiriliyor..." />;
  }

  return children;
}
