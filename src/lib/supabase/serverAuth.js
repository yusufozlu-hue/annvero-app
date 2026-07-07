import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/src/lib/supabase/config";
import { isAdminUser } from "@/src/lib/auth/admin";
import { ANNVERO_ROLES } from "@/src/config/annveroRoles";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
} from "@/src/lib/supabase/serverAdmin";
import {
  mapProfileRow,
  USER_PROFILES_TABLE,
} from "@/src/lib/supabase/userProfilesSchema";

export async function getServerSupabaseUser() {
  const config = getSupabaseConfig();
  if (!config) return { supabase: null, user: null };

  const cookieStore = await cookies();

  const supabase = createServerClient(config.supabaseUrl, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // API route read-only oturum okuması
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function requireAdminUser() {
  const { supabase, user } = await getServerSupabaseUser();

  if (!user) {
    return { supabase, user: null, error: "unauthenticated" };
  }

  if (!isAdminUser(user)) {
    return { supabase, user: null, error: "forbidden" };
  }

  return { supabase, user, error: null };
}

async function fetchProfileRole(email = "") {
  const guard = getServerSupabaseAdminGuardResponse("auth:profile-role", USER_PROFILES_TABLE);
  if (guard) return "";

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("role,is_active")
    .ilike("email", email)
    .maybeSingle();

  if (error || !data || data.is_active === false) return "";
  return data.role || "";
}

export async function requireManagementUser() {
  const { supabase, user } = await getServerSupabaseUser();
  if (!user) {
    return { supabase, user: null, error: "unauthenticated" };
  }

  if (isAdminUser(user)) {
    return { supabase, user, error: null, role: ANNVERO_ROLES.ADMIN };
  }

  const profileRole = await fetchProfileRole(user.email);
  if (profileRole === ANNVERO_ROLES.PARTNER || profileRole === ANNVERO_ROLES.ADMIN) {
    return { supabase, user, error: null, role: profileRole };
  }

  return { supabase, user: null, error: "forbidden" };
}

export async function requireRole(allowedRoles = []) {
  const { supabase, user } = await getServerSupabaseUser();
  if (!user) {
    return { supabase, user: null, error: "unauthenticated", role: "" };
  }

  if (isAdminUser(user)) {
    return { supabase, user, error: null, role: ANNVERO_ROLES.ADMIN };
  }

  const profileRole = await fetchProfileRole(user.email);
  const effectiveRole = profileRole || ANNVERO_ROLES.ACCOUNTING;
  if (!allowedRoles.includes(effectiveRole)) {
    return { supabase, user: null, error: "forbidden", role: effectiveRole };
  }

  return { supabase, user, error: null, role: effectiveRole };
}
