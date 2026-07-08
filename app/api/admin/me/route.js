import { NextResponse } from "next/server";
import { isManagementUser, isPlatformAdmin } from "@/src/lib/auth/admin";
import { mergeProfileWithAuth } from "@/src/lib/auth/userAccess";
import {
  fetchProfileByEmail,
  provisionProfileForUser,
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

  let profileResult = await fetchProfileByEmail(user.email);
  let profile = profileResult.profile;
  const dbUnreachable =
    Boolean(profileResult.schemaMissing) || Boolean(profileResult.adminUnavailable);

  if (!dbUnreachable && (!profile || (profile && user.id && profile.id !== user.id))) {
    const provision = await provisionProfileForUser(user);
    profile = provision.profile || profile;
  }

  const merged = mergeProfileWithAuth(user, profile, {
    schemaMissing: Boolean(profileResult.schemaMissing) || Boolean(profileResult.adminUnavailable),
  });

  const usingFallback =
    Boolean(profileResult.schemaMissing) ||
    Boolean(profileResult.adminUnavailable) ||
    merged.source === "fallback";

  return NextResponse.json({
    authenticated: true,
    email: user.email,
    isAdmin: isPlatformAdmin(user),
    isPlatformAdmin: isPlatformAdmin(user),
    isManagementUser: isManagementUser(user) || merged.isManagementUser,
    isPartner: merged.isPartner,
    role: merged.role,
    schemaMissing: Boolean(profileResult.schemaMissing),
    usingFallback,
  });
}
