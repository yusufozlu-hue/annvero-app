/**
 * Kurulum sahibini admin yapar (prod/staging DB).
 * Kullanım: node scripts/bootstrap-owner-admin.mjs [email]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ADMIN_PERMISSIONS = ["view", "edit", "export", "approve", "admin"];

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

const email = (process.argv[2] || "yusufozlu@gmail.com").trim().toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 200 });
const authUser = (authList?.users || []).find(
  (u) => String(u.email || "").toLowerCase() === email
);

const { data: existing } = await supabase
  .from("annvero_user_profiles")
  .select("*")
  .ilike("email", email)
  .maybeSingle();

const record = {
  id: authUser?.id || existing?.id || `pending-${email}`,
  email,
  display_name:
    existing?.display_name ||
    authUser?.user_metadata?.display_name ||
    authUser?.user_metadata?.full_name ||
    email,
  role: "admin",
  permissions: ADMIN_PERMISSIONS,
  company_ids: [],
  team_id: existing?.team_id || authUser?.user_metadata?.team_id || "",
  is_active: true,
  last_login_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const { data: saved, error } = await supabase
  .from("annvero_user_profiles")
  .upsert(record, { onConflict: "email" })
  .select("*")
  .single();

if (error) {
  console.error("Upsert failed:", error.message);
  process.exit(1);
}

if (authUser?.id) {
  await supabase.auth.admin.updateUserById(authUser.id, {
    user_metadata: {
      annvero_role: "admin",
      display_name: record.display_name,
      company_ids: [],
      team_id: record.team_id,
    },
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      email,
      role: saved.role,
      companyIds: saved.company_ids,
      authUserLinked: Boolean(authUser?.id),
      bannerWouldShow: false,
    },
    null,
    2
  )
);
