/**
 * Firma bazlı sync lease — aynı company_id için eşzamanlı iki sync engeli.
 * company_cloud_folders.sync_status = 'syncing' + updated_at stale takeover.
 */

export const SYNC_LEASE_STALE_MS = 90_000;

/**
 * @returns {Promise<{ acquired: boolean }>}
 */
export async function acquireCompanySyncLease(supabase, companyId) {
  if (!supabase || !companyId) return { acquired: false };

  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - SYNC_LEASE_STALE_MS).toISOString();

  const { data: fresh, error: freshError } = await supabase
    .from("company_cloud_folders")
    .update({ sync_status: "syncing", updated_at: now })
    .eq("company_id", String(companyId))
    .neq("sync_status", "syncing")
    .select("company_id")
    .maybeSingle();

  if (freshError) return { acquired: false };
  if (fresh?.company_id) return { acquired: true };

  const { data: stale, error: staleError } = await supabase
    .from("company_cloud_folders")
    .update({ sync_status: "syncing", updated_at: now })
    .eq("company_id", String(companyId))
    .eq("sync_status", "syncing")
    .lt("updated_at", staleBefore)
    .select("company_id")
    .maybeSingle();

  if (staleError) return { acquired: false };
  return { acquired: Boolean(stale?.company_id) };
}

export async function releaseCompanySyncLease(supabase, companyId, { status = "idle" } = {}) {
  if (!supabase || !companyId) return;
  const syncStatus =
    status === "ok" || status === "error" || status === "idle" || status === "disconnected"
      ? status
      : "idle";
  await supabase
    .from("company_cloud_folders")
    .update({ sync_status: syncStatus, updated_at: new Date().toISOString() })
    .eq("company_id", String(companyId))
    .eq("sync_status", "syncing");
}
