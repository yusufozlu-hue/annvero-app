import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/src/lib/auth/admin";
import {
  buildAccessDebugPayload,
  mergeProfileWithAuth,
  shouldShowAccessWarning,
} from "@/src/lib/auth/userAccess";
import {
  fetchHydratedProfileForUser,
  provisionProfileForUser,
  touchLastLogin,
  hydrateProfileWithMembership,
} from "@/src/lib/auth/profileService";
import { ensureBootstrapAdmin } from "@/src/lib/auth/bootstrapAdmin";
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

function withAccessFields(payload, user, profile) {
  const debug = buildAccessDebugPayload(user, profile, {
    isAdmin: payload.isAdmin || payload.isPlatformAdmin,
  });

  return {
    ...payload,
    email: debug.email || user?.email || payload.email,
    role: debug.role,
    isAdmin: debug.isAdmin,
    isPartner: debug.isPartner,
    isPlatformAdmin: debug.isPlatformAdmin,
    companyIds: debug.companyIds,
    companyIdsSource: profile?.companyIdsSource || "none",
    showAccessWarning: debug.showAccessWarning,
    warningReason: debug.warningReason,
  };
}

export async function GET() {
  const { user } = await getServerSupabaseUser();

  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  let profileResult = await fetchHydratedProfileForUser(user);
  let profile = profileResult.profile;
  let schemaMissing = Boolean(profileResult.schemaMissing);
  let adminUnavailable = Boolean(profileResult.adminUnavailable);
  let provisioned = false;
  let needsInvite = false;
  let dbUnreachable = schemaMissing || adminUnavailable;

  if (profileResult.membershipError && !profile && !dbUnreachable) {
    logProfileIssue("Firma üyeliği okunamadı (fail-closed)", {
      email: user.email,
      error: profileResult.membershipError?.message || String(profileResult.membershipError),
    });
    return NextResponse.json(
      {
        authenticated: true,
        email: user.email,
        error: "Firma üyeliği doğrulanamadı. Erişim reddedildi.",
        active: true,
        companyIds: [],
        companyIdsSource: "none",
        isAdmin: false,
        isPlatformAdmin: false,
      },
      { status: 403 }
    );
  }

  if (profileResult.error && !profile && !dbUnreachable && !profileResult.membershipError) {
    logProfileIssue("Profil okuma hatası", {
      email: user.email,
      error: profileResult.error?.message || String(profileResult.error),
      code: profileResult.error?.code || null,
    });
  }

  // Profil yoksa veya auth id eşleşmiyorsa provision, sonra membership hydrate
  if (!dbUnreachable && (!profile || (profile && user.id && profile.id !== user.id))) {
    const provision = await provisionProfileForUser(user);
    profile = provision.profile || profile;
    schemaMissing = Boolean(provision.schemaMissing);
    adminUnavailable = Boolean(provision.adminUnavailable) || adminUnavailable;
    dbUnreachable = schemaMissing || adminUnavailable;
    provisioned = Boolean(provision.created);
    needsInvite = Boolean(provision.needsInvite);

    if (profile && !dbUnreachable) {
      const hydrated = await hydrateProfileWithMembership(
        { ...profile, authUserId: profile.authUserId || user.id },
        user.id,
        user
      );
      if (!hydrated.ok) {
        logProfileIssue("Provision sonrası membership hydrate başarısız", {
          email: user.email,
          error: hydrated.error?.message || hydrated.deniedReason,
        });
        return NextResponse.json(
          {
            authenticated: true,
            email: user.email,
            error: "Firma üyeliği doğrulanamadı. Erişim reddedildi.",
            companyIds: [],
            companyIdsSource: "none",
          },
          { status: 403 }
        );
      }
      profile = hydrated.profile;
    }

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
        : "Profil tablosu okunamadı — kısıtlı erişim",
      {
        email: user.email,
        schemaMissing,
        adminUnavailable,
        schemaHint: getUserProfilesSchemaErrorMessage(),
      }
    );

    const merged = mergeProfileWithAuth(user, null, { schemaMissing: true });
    const platformAdmin = isPlatformAdmin(user);

    return NextResponse.json(
      withAccessFields(
        {
          authenticated: true,
          email: user.email,
          isAdmin: platformAdmin,
          isPlatformAdmin: platformAdmin,
          active: true,
          schemaMissing,
          adminUnavailable,
          schemaHint: getUserProfilesSchemaErrorMessage(),
          provisioned: false,
          needsInvite: !platformAdmin,
          usingFallback: true,
          profile: merged,
          access: {
            role: merged.role,
            permissions: merged.permissions,
            companyIds: [],
            companyIdsSource: "none",
            modules: merged.modules,
            isPartner: merged.isPartner,
            isManagementUser: merged.isManagementUser,
          },
        },
        user,
        merged
      )
    );
  }

  if (profile?.isActive === false) {
    return NextResponse.json(
      { error: "Hesabınız pasif durumda.", authenticated: true, active: false },
      { status: 403 }
    );
  }

  if (!profile) {
    const provision = await provisionProfileForUser(user);
    profile = provision.profile;
    provisioned = provisioned || Boolean(provision.created);
    needsInvite = Boolean(provision.needsInvite);

    if (profile) {
      const hydrated = await hydrateProfileWithMembership(
        { ...profile, authUserId: profile.authUserId || user.id },
        user.id,
        user
      );
      if (hydrated.ok) profile = hydrated.profile;
      else profile = null;
    }

    if (!profile) {
      logProfileIssue("Profil oluşturulamadı; daraltılmış erişim", {
        email: user.email,
        needsInvite,
        error: provision.error?.message || null,
      });
      const merged = mergeProfileWithAuth(user, null, { schemaMissing: false });
      const platformAdmin = isPlatformAdmin(user);

      return NextResponse.json(
        withAccessFields(
          {
            authenticated: true,
            email: user.email,
            isAdmin: platformAdmin,
            isPlatformAdmin: platformAdmin,
            active: true,
            schemaMissing: false,
            provisioned: false,
            needsInvite: !platformAdmin,
            showAccessWarning: shouldShowAccessWarning(merged),
            usingFallback: false,
            profile: {
              ...merged,
              needsInvite: !platformAdmin,
              source: "restricted",
            },
            access: {
              role: merged.role,
              permissions: merged.permissions,
              companyIds: [],
              companyIdsSource: "none",
              modules: merged.modules,
              isPartner: merged.isPartner,
              isManagementUser: merged.isManagementUser,
            },
          },
          user,
          merged
        )
      );
    }
  }

  const merged = mergeProfileWithAuth(user, profile, { schemaMissing: false });
  merged.source = "database";
  merged.needsInvite = false;

  const bootstrap = await ensureBootstrapAdmin(user, merged);
  let finalProfile = mergeProfileWithAuth(user, bootstrap.profile || merged, {
    schemaMissing: false,
  });
  finalProfile.source = "database";
  finalProfile.needsInvite = false;

  // Bootstrap sonrası membership bilgisini koru / yeniden bağla
  if (finalProfile.companyIdsSource !== "membership" && !finalProfile.isPlatformAdmin) {
    const rehydrated = await hydrateProfileWithMembership(
      {
        ...finalProfile,
        authUserId: finalProfile.authUserId || user.id,
        legacyCompanyIds: profile.legacyCompanyIds || [],
      },
      user.id,
      user
    );
    if (rehydrated.ok) {
      finalProfile = mergeProfileWithAuth(user, rehydrated.profile, { schemaMissing: false });
    }
  } else if (profile.companyIdsSource === "membership") {
    finalProfile.companyIds = profile.companyIds;
    finalProfile.companyIdsSource = "membership";
  }

  if (bootstrap.bootstrapped) {
    logProfileIssue("Trusted admin profil senkronu uygulandı", {
      email: user.email,
      role: finalProfile.role,
      upsertOk: Boolean(bootstrap.upsertOk),
    });
  }

  void touchLastLogin(user, finalProfile).catch((error) => {
    logProfileIssue("last_login güncellenemedi", {
      email: user.email,
      error: error?.message || String(error),
    });
  });

  const platformAdmin = isPlatformAdmin(user);

  return NextResponse.json(
    withAccessFields(
      {
        authenticated: true,
        email: user.email,
        isAdmin: platformAdmin,
        isPlatformAdmin: platformAdmin,
        active: true,
        schemaMissing: false,
        schemaHint: "",
        provisioned: provisioned || bootstrap.bootstrapped,
        needsInvite: false,
        usingFallback: false,
        bootstrapped: bootstrap.bootstrapped,
        upsertOk: bootstrap.upsertOk ?? null,
        profile: finalProfile,
        access: {
          role: finalProfile.role,
          permissions: finalProfile.permissions,
          companyIds: finalProfile.companyIds,
          companyIdsSource: finalProfile.companyIdsSource,
          modules: finalProfile.modules,
          isPartner: finalProfile.isPartner,
          isManagementUser: finalProfile.isManagementUser,
        },
      },
      user,
      finalProfile
    )
  );
}
