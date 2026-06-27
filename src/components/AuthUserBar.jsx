"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

export default function AuthUserBar() {
  const router = useRouter();
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

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-gray-700/80 bg-gray-950/95 px-4 py-2 text-sm shadow-xl backdrop-blur-sm">
      <span className="max-w-[220px] truncate text-gray-300">{email}</span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="rounded-lg border border-gray-600 px-3 py-1.5 font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSigningOut ? "Çıkış..." : "Çıkış Yap"}
      </button>
    </div>
  );
}
