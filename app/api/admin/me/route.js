import { NextResponse } from "next/server";
import { isManagementUser, isPlatformAdmin } from "@/src/lib/auth/admin";
import { mergeProfileWithAuth } from "@/src/lib/auth/userAccess";
import { fetchProfileByEmail } from "@/src/lib/auth/profileService";
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

  const profileResult = await fetchProfileByEmail(user.email);
  const merged = mergeProfileWithAuth(user, profileResult.profile);

  return NextResponse.json({
    authenticated: true,
    email: user.email,
    isAdmin: isPlatformAdmin(user),
    isPlatformAdmin: isPlatformAdmin(user),
    isManagementUser: isManagementUser(user) || merged.isManagementUser,
    isPartner: merged.isPartner,
    role: merged.role,
    schemaMissing: profileResult.schemaMissing,
    usingFallback: !profileResult.profile || merged.source === "fallback",
  });
}
