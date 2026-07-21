import { NextResponse } from "next/server";
import { isManagementUser, isPlatformAdmin } from "@/src/lib/auth/admin";
import { mergeProfileWithAuth, shouldShowAccessWarning } from "@/src/lib/auth/userAccess";
import { ensureBootstrapAdmin } from "@/src/lib/auth/bootstrapAdmin";
import {
  fetchHydratedProfileForUser,
  provisionProfileForUser,
  hydrateProfileWithMembership,
} from "@/src/lib/auth/profileService";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await getServerSupabaseUser();

  if (!user) {
    return NextResponse.json({
      authenticated: false,
      isAdmin: false,
      isPlatformAdmin: false,
      isManagementUser: false,
      isPartner: false,
    });
  }

  let profileResult = await fetchHydratedProfileForUser(user);
  let profile = profileResult.profile;
  const dbUnreachable =
    Boolean(profileResult.schemaMissing) || Boolean(profileResult.adminUnavailable);

  if (!dbUnreachable && (!profile || (profile && user.id && profile.id !== user.id))) {
    const provision = await provisionProfileForUser(user);
    profile = provision.profile || profile;
    if (profile) {
      const hydrated = await hydrateProfileWithMembership(
        { ...profile, authUserId: profile.authUserId || user.id },
        user.id,
        user
      );
      if (hydrated.ok) profile = hydrated.profile;
    }
  }

  const merged = mergeProfileWithAuth(user, profile, {
    schemaMissing: Boolean(profileResult.schemaMissing) || Boolean(profileResult.adminUnavailable),
  });

  const bootstrap = await ensureBootstrapAdmin(user, merged);
  const finalProfile = mergeProfileWithAuth(user, bootstrap.profile || merged, {
    schemaMissing: Boolean(profileResult.schemaMissing) || Boolean(profileResult.adminUnavailable),
  });

  const usingFallback =
    Boolean(profileResult.schemaMissing) ||
    Boolean(profileResult.adminUnavailable) ||
    finalProfile.source === "fallback";

  const platformAdmin = isPlatformAdmin(user);
  const management = isManagementUser(user) || Boolean(finalProfile.isManagementUser);

  return NextResponse.json({
    authenticated: true,
    email: user.email,
    isAdmin: platformAdmin,
    isPlatformAdmin: platformAdmin,
    isManagementUser: management,
    isPartner: finalProfile.isPartner,
    role: finalProfile.role,
    companyIds: finalProfile.companyIds || [],
    companyIdsSource: finalProfile.companyIdsSource || "none",
    schemaMissing: Boolean(profileResult.schemaMissing),
    usingFallback,
    showAccessWarning: shouldShowAccessWarning(finalProfile),
    bootstrapped: bootstrap.bootstrapped,
  });
}
