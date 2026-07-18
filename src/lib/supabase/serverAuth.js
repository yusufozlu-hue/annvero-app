import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/src/lib/supabase/config";
import { isManagementUser, isPlatformAdmin, getAnnveroRoleFromUser } from "@/src/lib/auth/admin";
import { ANNVERO_ROLES } from "@/src/config/annveroRoles";
import { fetchProfileByEmail } from "@/src/lib/auth/profileService";

/**
 * Request başına tek getUser — React cache() ile RSC/API içinde tekilleştirilir.
 * getClaims: JWKS boş (simetrik JWT) projelerde Auth sunucusuna düşer; körlemesine
 * değiştirilmedi. Asimetrik JWT opt-in sonrası ayrı doğrulama ile geçilebilir.
 */
export const getServerSupabaseUser = cache(async () => {
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
});

export async function requireAdminUser() {
  const { supabase, user } = await getServerSupabaseUser();

  if (!user) {
    return { supabase, user: null, error: "unauthenticated" };
  }

  if (!isPlatformAdmin(user)) {
    return { supabase, user: null, error: "forbidden" };
  }

  return { supabase, user, error: null };
}

async function fetchProfileRole(email = "") {
  const result = await fetchProfileByEmail(email);
  if (!result.profile || result.profile.isActive === false) return "";
  return result.profile.role || "";
}

export async function requireManagementUser() {
  const { supabase, user } = await getServerSupabaseUser();
  if (!user) {
    return { supabase, user: null, error: "unauthenticated", role: "" };
  }

  if (isPlatformAdmin(user)) {
    return { supabase, user, error: null, role: ANNVERO_ROLES.ADMIN };
  }

  const profileRole = await fetchProfileRole(user.email);
  if (profileRole === ANNVERO_ROLES.PARTNER || profileRole === ANNVERO_ROLES.ADMIN) {
    return { supabase, user, error: null, role: profileRole };
  }

  if (isManagementUser(user)) {
    return {
      supabase,
      user,
      error: null,
      role: profileRole || getAnnveroRoleFromUser(user) || ANNVERO_ROLES.PARTNER,
    };
  }

  return { supabase, user: null, error: "forbidden", role: profileRole || "" };
}

export async function requireRole(allowedRoles = []) {
  const { supabase, user } = await getServerSupabaseUser();
  if (!user) {
    return { supabase, user: null, error: "unauthenticated", role: "" };
  }

  if (isPlatformAdmin(user)) {
    return { supabase, user, error: null, role: ANNVERO_ROLES.ADMIN };
  }

  const profileRole = await fetchProfileRole(user.email);
  const effectiveRole = profileRole || ANNVERO_ROLES.ACCOUNTING;
  if (!allowedRoles.includes(effectiveRole)) {
    return { supabase, user: null, error: "forbidden", role: effectiveRole };
  }

  return { supabase, user, error: null, role: effectiveRole };
}
