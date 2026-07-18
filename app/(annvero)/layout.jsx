import { cookies } from "next/headers";
import AuthGate from "@/src/components/AuthGate";
import AnnveroAppShell from "@/src/components/AnnveroAppShell";

/**
 * Korumalı modüllerin ortak ve kalıcı layout'u.
 * Cookie adlarına bakarak AuthGate'e iyimser oturum ipucu verir (getUser yok —
 * proxy zaten doğruladı). Shell ilk HTML'de boyanır.
 */
export default async function AnnveroProtectedLayout({ children }) {
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore
    .getAll()
    .some(
      (cookie) =>
        cookie.name.startsWith("sb-") ||
        cookie.name.includes("auth-token") ||
        cookie.name.includes("supabase")
    );

  return (
    <AuthGate hasAuthCookie={hasAuthCookie}>
      <AnnveroAppShell>{children}</AnnveroAppShell>
    </AuthGate>
  );
}
