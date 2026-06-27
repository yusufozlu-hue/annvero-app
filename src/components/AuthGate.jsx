"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AuthLoadingScreen from "@/src/components/AuthLoadingScreen";
import { buildLoginUrl } from "@/src/utils/authRedirect";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export default function AuthGate({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setStatus("unauthenticated");
      return;
    }

    let isMounted = true;

    const syncSession = (session) => {
      if (!isMounted) return;
      setStatus(session ? "authenticated" : "unauthenticated");
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      syncSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      syncSession(session);
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

  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (status === "unauthenticated") {
    return <AuthLoadingScreen message="Giriş sayfasına yönlendiriliyor..." />;
  }

  return children;
}
