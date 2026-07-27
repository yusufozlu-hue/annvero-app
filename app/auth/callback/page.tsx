import AuthCallbackClient from "./AuthCallbackClient";

export const dynamic = "force-dynamic";

/**
 * Supabase auth callback — PKCE, token_hash ve fragment akışlarını istemci işler.
 * Fragment tokenları sunucuya gönderilmez.
 */
export default function AuthCallbackPage() {
  return <AuthCallbackClient />;
}
