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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await getServerSupabaseUser();

  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  let profileResult = await fetchProfileByEmail(user.email);
  let profile = profileResult.profile;
  let schemaMissing = profileResult.schemaMissing;
  let provisioned = false;
  let needsInvite = false;

  if (!profile && !schemaMissing && !profileResult.error) {
    const provision = await provisionProfileForUser(user);
    profile = provision.profile;
    schemaMissing = provision.schemaMissing;
    provisioned = provision.created;
    needsInvite = Boolean(provision.needsInvite);
  } else if (!profile && schemaMissing) {
    profile = null;
  } else if (profile && user.id && profile.id !== user.id) {
    const provision = await provisionProfileForUser(user);
    profile = provision.profile || profile;
    needsInvite = Boolean(provision.needsInvite);
  }

  if (profileResult.error && !profile) {
    return NextResponse.json({
      authenticated: true,
      email: user.email,
      isAdmin: isPlatformAdmin(user),
      isPlatformAdmin: isPlatformAdmin(user),
      profile: mergeProfileWithAuth(user, null, { schemaMissing: true }),
      schemaMissing: true,
      usingFallback: true,
      warning: profileResult.error.message,
    });
  }

  if (profile?.isActive === false) {
    return NextResponse.json(
      { error: "Hesabınız pasif durumda.", authenticated: true, active: false },
      { status: 403 }
    );
  }

  const mergeOptions = { schemaMissing };
  const merged = mergeProfileWithAuth(user, profile, mergeOptions);

  if (needsInvite && !profile) {
    merged.needsInvite = true;
  }

  if (profile) await touchLastLogin(user, merged);

  return NextResponse.json({
    authenticated: true,
    email: user.email,
    isAdmin: isPlatformAdmin(user),
    isPlatformAdmin: isPlatformAdmin(user),
    active: true,
    schemaMissing,
    schemaHint: schemaMissing ? getUserProfilesSchemaErrorMessage() : "",
    provisioned,
    needsInvite: Boolean(merged.needsInvite),
    usingFallback: !profile || merged.source?.startsWith("fallback"),
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
