"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { useAdminAccess } from "@/src/hooks/useAdminAccess";

const actionButtonClass =
  "rounded-lg border border-gray-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60";

const adminLinkClass =
  "rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-1.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-900/50";

export default function AuthUserBar({
  variant = "standalone",
  showAdminLink = true,
}) {
  const router = useRouter();
  const { isAdmin } = useAdminAccess();
  const [email, setEmail] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email || "");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email || "");
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || isSigningOut) return;

    setIsSigningOut(true);

    try {
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setIsSigningOut(false);
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
