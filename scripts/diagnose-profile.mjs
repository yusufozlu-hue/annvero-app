/**
 * Tanılama: node scripts/diagnose-profile.mjs [email]
 * .env.local içindeki Supabase anahtarlarını kullanır.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
  console.error("NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli (.env.local)");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: profile, error: profileError } = await supabase
  .from("annvero_user_profiles")
  .select("*")
  .ilike("email", email)
  .maybeSingle();

const { count: companyCount } = await supabase
  .from("companies")
  .select("id", { count: "exact", head: true });

const { count: adminCount } = await supabase
  .from("annvero_user_profiles")
  .select("id", { count: "exact", head: true })
  .eq("role", "admin");

function wouldShowBanner(role, companyIds) {
  if (role === "admin" || role === "partner" || role === "mudur") return false;
  if (!role || role === "goruntuleme") return true;
  if (!Array.isArray(companyIds) || companyIds.length === 0) return true;
  return false;
}

console.log(JSON.stringify({
  email,
  profileFound: Boolean(profile),
  profileError: profileError?.message || null,
  role: profile?.role || null,
  companyIds: profile?.company_ids || [],
  companiesInSystem: companyCount ?? 0,
  adminProfilesInDb: adminCount ?? 0,
  wouldShowBanner: profile
    ? wouldShowBanner(profile.role, profile.company_ids)
    : true,
  note: "Admin/partner için boş company_ids = tüm firmalara erişim (ayrı company_access tablosu yok)",
}, null, 2));
