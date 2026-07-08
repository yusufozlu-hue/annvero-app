import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/src/lib/auth/admin";
import { mergeProfileWithAuth } from "@/src/lib/auth/userAccess";
import {
  fetchProfileByEmail,
  provisionProfileForUser,
  touchLastLogin,
} from "@/src/lib/auth/profileService";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import { getUserProfilesSchemaErrorMessage } from "@/src/lib/supabase/userProfilesSchema";
import { logOperationalEvent, SYSTEM_ERROR_TYPES } from "@/src/utils/systemLogEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function logProfileIssue(message, detail = {}, companyId = "") {
  try {
    logOperationalEvent({
      module: "Auth / Profil",
      message,
      level: "warning",
      companyId: companyId || "",
      errorType: SYSTEM_ERROR_TYPES.UNEXPECTED,
      technicalDetail: detail,
      suggestion: "SUPABASE_SERVICE_ROLE_KEY ve annvero_user_profiles tablosunu kontrol edin.",
    });
  } catch (error) {
    console.error("[auth/me] profile log failed", error);
  }
}

export async function GET() {
  const { user } = await getServerSupabaseUser();

  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  let profileResult = await fetchProfileByEmail(user.email);
  let profile = profileResult.profile;
  let schemaMissing = Boolean(profileResult.schemaMissing);
  let adminUnavailable = Boolean(profileResult.adminUnavailable);
  let provisioned = false;
  let needsInvite = false;
  let dbUnreachable = schemaMissing || adminUnavailable;

  if (profileResult.error && !profile && !dbUnreachable) {
    logProfileIssue("Profil okuma hatası", {
      email: user.email,
      error: profileResult.error?.message || String(profileResult.error),
      code: profileResult.error?.code || null,
    });
  }

  // Tablo/admin erişilebilirken profil yoksa veya auth id eşleşmiyorsa otomatik oluştur/bağla.
  if (!dbUnreachable && (!profile || (profile && user.id && profile.id !== user.id))) {
    const provision = await provisionProfileForUser(user);
    profile = provision.profile || profile;
    schemaMissing = Boolean(provision.schemaMissing);
    adminUnavailable = Boolean(provision.adminUnavailable) || adminUnavailable;
    dbUnreachable = schemaMissing || adminUnavailable;
    provisioned = Boolean(provision.created);
    needsInvite = Boolean(provision.needsInvite);

    if (provision.error) {
      logProfileIssue("Profil oluşturma/bağlama hatası", {
        email: user.email,
        error: provision.error?.message || String(provision.error),
      });
    }
  }

  if (dbUnreachable) {
    logProfileIssue(
      adminUnavailable
        ? "Profil servisi kullanılamıyor (service role yok)"
        : "Profil tablosu okunamadı — metadata fallback",
      {
        email: user.email,
        schemaMissing,
        adminUnavailable,
        schemaHint: getUserProfilesSchemaErrorMessage(),
      }
    );

    const merged = mergeProfileWithAuth(user, null, { schemaMissing: true });
    return NextResponse.json({
      authenticated: true,
      email: user.email,
      isAdmin: isPlatformAdmin(user),
      isPlatformAdmin: isPlatformAdmin(user),
      active: true,
      schemaMissing,
      adminUnavailable,
      schemaHint: getUserProfilesSchemaErrorMessage(),
      provisioned: false,
      needsInvite: false,
      usingFallback: true,
      profile: merged,
      access: {
        role: merged.role,
        permissions: merged.permissions,
        companyIds: merged.companyIds,
        modules: merged.modules,
        isPartner: merged.isPartner,
        isManagementUser: merged.isManagementUser,
      },
    });
  }

  if (profile?.isActive === false) {
    return NextResponse.json(
      { error: "Hesabınız pasif durumda.", authenticated: true, active: false },
      { status: 403 }
    );
  }

  // Profil hâlâ yoksa (beklenmeyen durum): otomatik oluşturmayı tekrar dene, yoksa daraltılmış erişim.
  if (!profile) {
    const provision = await provisionProfileForUser(user);
    profile = provision.profile;
    provisioned = provisioned || Boolean(provision.created);
    needsInvite = Boolean(provision.needsInvite);

    if (!profile) {
      logProfileIssue("Profil oluşturulamadı; daraltılmış erişim", {
        email: user.email,
        needsInvite,
        error: provision.error?.message || null,
      });
      const merged = mergeProfileWithAuth(user, null, { schemaMissing: false });
      return NextResponse.json({
        authenticated: true,
        email: user.email,
        isAdmin: isPlatformAdmin(user),
        isPlatformAdmin: isPlatformAdmin(user),
        active: true,
        schemaMissing: false,
        provisioned: false,
        needsInvite: true,
        usingFallback: false,
        profile: { ...merged, needsInvite: true, source: "restricted" },
        access: {
          role: merged.role,
          permissions: merged.permissions,
          companyIds: merged.companyIds,
          modules: merged.modules,
          isPartner: merged.isPartner,
          isManagementUser: merged.isManagementUser,
        },
      });
    }
  }

  const merged = mergeProfileWithAuth(user, profile, { schemaMissing: false });
  merged.source = "database";
  merged.needsInvite = false;

  try {
    await touchLastLogin(user, merged);
  } catch (error) {
    logProfileIssue("last_login güncellenemedi", {
      email: user.email,
      error: error?.message || String(error),
    });
  }

  return NextResponse.json({
    authenticated: true,
    email: user.email,
    isAdmin: isPlatformAdmin(user),
    isPlatformAdmin: isPlatformAdmin(user),
    active: true,
    schemaMissing: false,
    schemaHint: "",
    provisioned,
    needsInvite: false,
    usingFallback: false,
    profile: merged,
    access: {
      role: merged.role,
      permissions: merged.permissions,
      companyIds: merged.companyIds,
      modules: merged.modules,
      isPartner: merged.isPartner,
      isManagementUser: merged.isManagementUser,
    },
  });
}
