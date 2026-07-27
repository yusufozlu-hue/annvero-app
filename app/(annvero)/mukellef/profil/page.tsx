"use client";

import { useState } from "react";
import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import { useUserRole } from "@/src/hooks/useUserRole";
import { ANNVERO_ROLE_LABELS } from "@/src/config/annveroRoles";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { clearClientAuthStorage } from "@/src/lib/supabase/client";
import { clearClientSessionCaches } from "@/src/lib/auth/clearClientSession";
import {
  beginLogoutInProgress,
  endLogoutInProgress,
} from "@/src/lib/auth/logoutInProgress";

const SIGN_OUT_GLOBAL_TIMEOUT_MS = 4000;
const SIGN_OUT_TIMEOUT_MS = 750;

async function signOutSafely(supabase: ReturnType<typeof getSupabaseClient>) {
  if (!supabase) return;

  let globalDone = false;
  try {
    const result = await Promise.race([
      supabase.auth
        .signOut({ scope: "global" })
        .then(() => "ok")
        .catch(() => "fail"),
      new Promise<"timeout">((resolve) => {
        window.setTimeout(() => resolve("timeout"), SIGN_OUT_GLOBAL_TIMEOUT_MS);
      }),
    ]);
    globalDone = result === "ok";
  } catch {
    globalDone = false;
  }

  if (!globalDone) {
    await Promise.race([
      supabase.auth.signOut({ scope: "local" }).catch(() => undefined),
      new Promise((resolve) => {
        window.setTimeout(resolve, SIGN_OUT_TIMEOUT_MS);
      }),
    ]);
  }
}

export default function MukellefProfilPage() {
  const { email, role } = useUserRole();
  const { companies, selectedCompany } = useCompanyList();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  const roleLabel =
    ANNVERO_ROLE_LABELS[role as keyof typeof ANNVERO_ROLE_LABELS] ||
    role ||
    "Görüntüleme Kullanıcısı";

  const companyNames = companies.length
    ? companies.map((company) => getCompanyDisplayName(company)).filter(Boolean)
    : selectedCompany
      ? [getCompanyDisplayName(selectedCompany)].filter(Boolean)
      : [];

  const handleSignOut = async () => {
    if (isSigningOut) return;
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

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-400/80">
          Mükellef Portalı
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
          Profil
        </h1>
      </header>

      <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            E-posta
          </p>
          <p className="mt-1 text-sm text-zinc-100">{email || "—"}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Rol
          </p>
          <p className="mt-1 text-sm text-zinc-100">{roleLabel}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Firma{companyNames.length > 1 ? "lar" : ""}
          </p>
          {companyNames.length ? (
            <ul className="mt-1 space-y-1 text-sm text-zinc-100">
              {companyNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">Atanmış firma yok</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={isSigningOut}
          className="mt-2 w-full rounded-xl border border-zinc-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSigningOut ? "Çıkış..." : "Çıkış Yap"}
        </button>
        {signOutError ? (
          <p role="alert" className="text-xs text-rose-300">
            {signOutError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
