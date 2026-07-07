import { NextResponse } from "next/server";
import { isAdminUser } from "@/src/lib/auth/admin";
import { buildFallbackProfile, mergeProfileWithAuth } from "@/src/lib/auth/userAccess";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
} from "@/src/lib/supabase/serverAdmin";
import {
  mapProfileRow,
  USER_PROFILES_TABLE,
  isUserProfilesSchemaCacheError,
  getUserProfilesSchemaErrorMessage,
} from "@/src/lib/supabase/userProfilesSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchProfileByEmail(email = "") {
  const guard = getServerSupabaseAdminGuardResponse("auth:me", USER_PROFILES_TABLE);
  if (guard) return { profile: null, schemaMissing: true };

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("*")
    .ilike("email", email)
    .maybeSingle();

  if (error) {
    if (isUserProfilesSchemaCacheError(error)) {
      return { profile: null, schemaMissing: true };
    }
    return { profile: null, error };
  }

  return { profile: data ? mapProfileRow(data) : null, schemaMissing: false };
}

async function touchLastLogin(user, profile) {
  if (!user?.email || !profile) return;
  const guard = getServerSupabaseAdminGuardResponse("auth:touch-login", USER_PROFILES_TABLE);
  if (guard) return;

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  await supabase
    .from(USER_PROFILES_TABLE)
    .update({
      id: user.id,
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("email", user.email.toLowerCase());
}

export async function GET() {
  const { user } = await getServerSupabaseUser();

  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  const { profile, schemaMissing, error } = await fetchProfileByEmail(user.email);

  if (error) {
    return NextResponse.json({
      authenticated: true,
      email: user.email,
      isAdmin: isAdminUser(user),
      profile: mergeProfileWithAuth(user, null),
      schemaMissing: false,
      warning: error.message,
    });
  }

  if (profile?.isActive === false) {
    return NextResponse.json(
      { error: "Hesabınız pasif durumda.", authenticated: true, active: false },
      { status: 403 }
    );
  }

  const merged = mergeProfileWithAuth(user, profile);
  if (profile) await touchLastLogin(user, profile);

  return NextResponse.json({
    authenticated: true,
    email: user.email,
    isAdmin: isAdminUser(user),
    active: true,
    schemaMissing,
    schemaHint: schemaMissing ? getUserProfilesSchemaErrorMessage() : "",
    profile: merged,
    access: {
      role: merged.role,
      permissions: merged.permissions,
      companyIds: merged.companyIds,
      modules: merged.modules,
    },
  });
}
