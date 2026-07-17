import { getServerSupabaseAdmin } from "@/src/lib/supabase/serverAdmin";
import { decryptGoogleDriveTokens, encryptGoogleDriveTokens } from "./tokenCrypto";
import { refreshGoogleAccessToken } from "./oauth";

const TABLE = "cloud_storage_connections";

function db() {
  const client = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!client) throw new Error("Supabase service role yapılandırılmamış.");
  return client;
}

export async function saveGoogleDriveConnection({ userId, accountEmail, tokens }) {
  const now = new Date().toISOString();
  const bundle = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    tokenType: tokens.token_type || "Bearer",
    scope: tokens.scope || "https://www.googleapis.com/auth/drive.file",
  };
  if (!bundle.refreshToken) throw new Error("Google refresh token döndürmedi; yeniden izin verin.");
  const { data, error } = await db().from(TABLE).upsert({
    user_id: userId,
    provider: "google_drive",
    account_email: accountEmail || null,
    access_scope: bundle.scope,
    token_reference: encryptGoogleDriveTokens(bundle),
    status: "connected",
    connected_at: now,
    last_refresh_at: now,
  }, { onConflict: "user_id,provider" }).select("id,user_id,provider,account_email,status,connected_at,last_refresh_at").single();
  if (error) throw error;
  return data;
}

export async function getGoogleDriveConnection(userId, { includeToken = false } = {}) {
  const fields = includeToken
    ? "id,user_id,provider,account_email,status,connected_at,last_refresh_at,token_reference"
    : "id,user_id,provider,account_email,status,connected_at,last_refresh_at";
  const { data, error } = await db().from(TABLE).select(fields)
    .eq("user_id", userId).eq("provider", "google_drive").maybeSingle();
  if (error) throw error;
  return data;
}

export async function getValidGoogleAccessToken(userId) {
  const connection = await getGoogleDriveConnection(userId, { includeToken: true });
  if (!connection?.token_reference || connection.status !== "connected") {
    throw new Error("Google Drive bağlantısı bulunamadı.");
  }
  const bundle = decryptGoogleDriveTokens(connection.token_reference);
  if (bundle.accessToken && Number(bundle.expiresAt || 0) > Date.now() + 60_000) {
    return { accessToken: bundle.accessToken, connection };
  }
  if (!bundle.refreshToken) throw new Error("Google Drive refresh token bulunamadı.");
  const refreshed = await refreshGoogleAccessToken(bundle.refreshToken);
  const next = {
    ...bundle,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    tokenType: refreshed.token_type || bundle.tokenType,
    scope: refreshed.scope || bundle.scope,
  };
  const { error } = await db().from(TABLE).update({
    token_reference: encryptGoogleDriveTokens(next),
    last_refresh_at: new Date().toISOString(),
    status: "connected",
  }).eq("id", connection.id).eq("user_id", userId);
  if (error) throw error;
  return { accessToken: next.accessToken, connection: { ...connection, last_refresh_at: new Date().toISOString() } };
}

export async function disconnectGoogleDrive(userId) {
  const connection = await getGoogleDriveConnection(userId, { includeToken: true });
  let revokeToken = "";
  if (connection?.token_reference) {
    try {
      const bundle = decryptGoogleDriveTokens(connection.token_reference);
      revokeToken = bundle.refreshToken || bundle.accessToken || "";
    } catch {
      // Fail-closed: bozuk token kaydı yine yerelde silinir.
    }
  }
  if (revokeToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revokeToken)}`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, cache: "no-store",
      });
    } catch {
      // Google revoke başarısız olsa da yerel credential silinir.
    }
  }
  const { error } = await db().from(TABLE).update({
    token_reference: null, status: "disconnected", connected_at: null,
  }).eq("user_id", userId).eq("provider", "google_drive");
  if (error) throw error;
}
