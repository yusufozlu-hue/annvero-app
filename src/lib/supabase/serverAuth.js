import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/src/lib/supabase/config";
import {
  getAnnveroRoleFromUser,
  evaluateManagementGate,
  isPlatformAdmin,
  isTrustedAppPartnerRole,
  getTrustedAppRole,
} from "@/src/lib/auth/admin";
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

/**
 * Yönetim: platform admin (AND) VEYA trusted app_metadata partner.
 * DB profile role=admin/partner tek başına kabul edilmez.
 */
export async function requireManagementUser() {
  const { supabase, user } = await getServerSupabaseUser();
  const gate = evaluateManagementGate(user);

  if (gate.reason === "unauthenticated") {
    return { supabase, user: null, error: "unauthenticated", role: "" };
  }

  if (gate.allowed) {
    return {
      supabase,
      user,
      error: null,
      role:
        gate.role === "admin"
          ? ANNVERO_ROLES.ADMIN
          : getAnnveroRoleFromUser(user) || ANNVERO_ROLES.PARTNER,
    };
  }

  // Profil rolü bilgilendirici — management kapısı açmaz
  const profileRole = user?.email ? await fetchProfileRole(user.email) : "";
  return { supabase, user: null, error: "forbidden", role: profileRole || "" };
}

/**
 * Non-elevated uygulama rolleri için.
 * Admin/partner profile role tek başına requireRole ile elevated sayılmaz;
 * elevated allowedRoles yalnız trusted kapıdan geçer.
 */
export async function requireRole(allowedRoles = []) {
  const { supabase, user } = await getServerSupabaseUser();
  if (!user) {
    return { supabase, user: null, error: "unauthenticated", role: "" };
  }

  if (isPlatformAdmin(user)) {
    return { supabase, user, error: null, role: ANNVERO_ROLES.ADMIN };
  }

  if (
    allowedRoles.includes(ANNVERO_ROLES.PARTNER) &&
    isTrustedAppPartnerRole(getTrustedAppRole(user))
  ) {
    return { supabase, user, error: null, role: ANNVERO_ROLES.PARTNER };
  }

  const profileRole = await fetchProfileRole(user.email);
  const elevatedDb =
    profileRole === ANNVERO_ROLES.ADMIN || profileRole === ANNVERO_ROLES.PARTNER;
  const effectiveRole = elevatedDb
    ? ANNVERO_ROLES.VIEWER
    : profileRole || ANNVERO_ROLES.ACCOUNTING;

  if (!allowedRoles.includes(effectiveRole)) {
    return { supabase, user: null, error: "forbidden", role: effectiveRole };
  }

  return { supabase, user, error: null, role: effectiveRole };
}
