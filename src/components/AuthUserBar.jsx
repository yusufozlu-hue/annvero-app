"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { clearClientAuthStorage } from "@/src/lib/supabase/client";
import { useAdminAccess } from "@/src/hooks/useAdminAccess";
import { useUserRole } from "@/src/hooks/useUserRole";
import { clearClientSessionCaches } from "@/src/lib/auth/clearClientSession";
import {
  beginLogoutInProgress,
  endLogoutInProgress,
} from "@/src/lib/auth/logoutInProgress";

const actionButtonClass =
  "rounded-lg border border-gray-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60";

/** Global iptal için üst süre; aşılırsa yerel oturum kapatılır, sonra yönlendirilir. */
const SIGN_OUT_GLOBAL_TIMEOUT_MS = 4000;

const adminLinkClass =
  "rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-1.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-900/50";

async function signOutSafely(supabase) {
  if (!supabase) return;

  let globalDone = false;
  try {
    const result = await Promise.race([
      supabase.auth
        .signOut({ scope: "global" })
        .then(() => "ok")
        .catch(() => "fail"),
      new Promise((resolve) => {
        window.setTimeout(() => resolve("timeout"), SIGN_OUT_GLOBAL_TIMEOUT_MS);
      }),
    ]);
    globalDone = result === "ok";
  } catch {
    globalDone = false;
  }

  // Bu tarayıcıdaki oturum/cookie her durumda kapanmalı.
  if (!globalDone) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

export default function AuthUserBar({
  variant = "standalone",
  showAdminLink = true,
}) {
  const { isAdmin } = useAdminAccess();
  const { email: roleEmail } = useUserRole();
  const [sessionEmail, setSessionEmail] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSessionEmail(data.session?.user?.email || "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const email = roleEmail || sessionEmail;

  const handleSignOut = async () => {
    if (isSigningOut) return;

    // AuthGate /login yarışını engellemek için signOut'tan önce.
    beginLogoutInProgress();
    setIsSigningOut(true);
    setSignOutError("");

    const supabase = getSupabaseClient();

    try {
      await signOutSafely(supabase);

      clearClientAuthStorage();
      clearClientSessionCaches();
      void fetch("/api/auth/return-to", {
        method: "DELETE",
        credentials: "include",
        keepalive: true,
      }).catch(() => undefined);

      window.location.replace("https://annvero.com/");
    } catch {
      endLogoutInProgress();
      setIsSigningOut(false);
      setSignOutError("Çıkış tamamlanamadı. Lütfen tekrar deneyin.");
    }
  };

  if (!email) return null;

  const controls = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="max-w-[260px] truncate text-sm text-gray-300">{email}</span>
      {showAdminLink && isAdmin ? (
        <>
          <span aria-hidden="true" className="hidden text-gray-600 sm:inline">
            |
          </span>
          <Link href="/admin/parametre-yonetimi" className={adminLinkClass}>
            Parametreler
          </Link>
        </>
      ) : null}
      <span aria-hidden="true" className="hidden text-gray-600 sm:inline">
        |
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className={actionButtonClass}
      >
        {isSigningOut ? "Çıkış..." : "Çıkış Yap"}
      </button>
      {signOutError ? (
        <span role="alert" className="w-full text-xs text-red-300">
          {signOutError}
        </span>
      ) : null}
    </div>
  );

  if (variant === "embedded") {
    return controls;
  }

  return (
    <header className="mb-6 border-b border-gray-800 bg-black px-6 py-4 sm:px-8">
      <div className="flex w-full flex-wrap items-center justify-end gap-3">{controls}</div>
    </header>
  );
}
