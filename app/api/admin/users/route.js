import { NextResponse } from "next/server";
import { requireManagementUser } from "@/src/lib/supabase/serverAuth";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";
import { getDefaultPermissionsForRole } from "@/src/lib/auth/permissions";
import { ANNVERO_ROLE_LABELS } from "@/src/config/annveroRoles";
import {
  mapProfileRow,
  mapProfileToRecord,
  USER_PROFILES_TABLE,
  isUserProfilesSchemaCacheError,
  getUserProfilesSchemaErrorMessage,
} from "@/src/lib/supabase/userProfilesSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validateRole(role = "") {
  return Boolean(ANNVERO_ROLE_LABELS[role]);
}

export async function GET() {
  const { error } = await requireManagementUser();
  if (error === "unauthenticated") {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }
  if (error === "forbidden") {
    return NextResponse.json({ error: "Yetkisiz erişim." }, { status: 403 });
  }

  const guard = getServerSupabaseAdminGuardResponse("admin:users:get", USER_PROFILES_TABLE);
  if (guard) {
    return NextResponse.json({
      users: [],
      schemaMissing: true,
      hint: getUserProfilesSchemaErrorMessage(),
    });
  }

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  const { data, error: dbError } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("*")
    .order("updated_at", { ascending: false });

  if (dbError) {
    logSupabaseQueryError("admin:users:get", dbError, USER_PROFILES_TABLE);
    if (isUserProfilesSchemaCacheError(dbError)) {
      return NextResponse.json({
        users: [],
        schemaMissing: true,
        hint: getUserProfilesSchemaErrorMessage(),
      });
    }
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({
    users: (data || []).map(mapProfileRow),
    roles: Object.entries(ANNVERO_ROLE_LABELS).map(([id, label]) => ({ id, label })),
  });
}

export async function POST(request) {
  const { user, error } = await requireManagementUser();
  if (error === "unauthenticated") {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }
  if (error === "forbidden") {
    return NextResponse.json({ error: "Yetkisiz erişim." }, { status: 403 });
  }

  const guard = getServerSupabaseAdminGuardResponse("admin:users:post", USER_PROFILES_TABLE);
  if (guard) return guard;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const role = String(body?.role || "muhasebe_personeli");
  const displayName = String(body?.displayName || body?.display_name || email).trim();

  if (!email) {
    return NextResponse.json({ error: "E-posta zorunludur." }, { status: 400 });
  }
  if (!validateRole(role)) {
    return NextResponse.json({ error: "Geçersiz rol." }, { status: 400 });
  }

  const record = mapProfileToRecord({
    id: body?.id || `pending-${email}`,
    email,
    displayName,
    role,
    permissions: body?.permissions || getDefaultPermissionsForRole(role),
    companyIds: body?.companyIds || body?.company_ids || [],
    teamId: body?.teamId || body?.team_id || "",
    isActive: body?.isActive ?? body?.is_active ?? true,
  });

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  const { data, error: dbError } = await supabase
    .from(USER_PROFILES_TABLE)
    .upsert(record, { onConflict: "email" })
    .select("*")
    .single();

  if (dbError) {
    logSupabaseQueryError("admin:users:post", dbError, USER_PROFILES_TABLE);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ user: mapProfileRow(data), createdBy: user.email });
}

export async function PUT(request) {
  const { error } = await requireManagementUser();
  if (error === "unauthenticated") {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }
  if (error === "forbidden") {
    return NextResponse.json({ error: "Yetkisiz erişim." }, { status: 403 });
  }

  const guard = getServerSupabaseAdminGuardResponse("admin:users:put", USER_PROFILES_TABLE);
  if (guard) return guard;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "E-posta zorunludur." }, { status: 400 });
  }

  const role = body?.role ? String(body.role) : undefined;
  if (role && !validateRole(role)) {
    return NextResponse.json({ error: "Geçersiz rol." }, { status: 400 });
  }

  const record = mapProfileToRecord({
    id: body?.id || `pending-${email}`,
    email,
    displayName: body?.displayName || body?.display_name,
    role: role || body?.role,
    permissions: body?.permissions,
    companyIds: body?.companyIds || body?.company_ids,
    teamId: body?.teamId || body?.team_id,
    isActive: body?.isActive ?? body?.is_active,
    passwordResetRequestedAt: body?.requestPasswordReset
      ? new Date().toISOString()
      : body?.passwordResetRequestedAt,
  });

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  const { data, error: dbError } = await supabase
    .from(USER_PROFILES_TABLE)
    .upsert(record, { onConflict: "email" })
    .select("*")
    .single();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ user: mapProfileRow(data) });
}

export async function DELETE(request) {
  const { error } = await requireManagementUser();
  if (error === "unauthenticated") {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }
  if (error === "forbidden") {
    return NextResponse.json({ error: "Yetkisiz erişim." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const email = String(searchParams.get("email") || "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email parametresi gerekli." }, { status: 400 });
  }

  const guard = getServerSupabaseAdminGuardResponse("admin:users:delete", USER_PROFILES_TABLE);
  if (guard) return guard;

  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  const { error: dbError } = await supabase.from(USER_PROFILES_TABLE).delete().eq("email", email);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
