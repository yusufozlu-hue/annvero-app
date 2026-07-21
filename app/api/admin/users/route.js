import { NextResponse } from "next/server";
import { requireManagementUser } from "@/src/lib/supabase/serverAuth";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";
import { getDefaultPermissionsForRole } from "@/src/lib/auth/permissions";
import {
  inviteAuthUser,
  sendPasswordRecoveryEmail,
  syncAnnveroUserMetadata,
  upsertProfile,
} from "@/src/lib/auth/profileService";
import { syncCompanyMembership, fetchActiveMembershipCompanyIds } from "@/src/lib/auth/companyMembership";
import { normalizeCompanyIds, isAuthUserUuid } from "@/src/lib/auth/companyAccessPolicy";
import { ANNVERO_ROLE_LABELS, ANNVERO_ROLES } from "@/src/config/annveroRoles";
import {
  mapProfileRow,
  USER_PROFILES_TABLE,
  isUserProfilesSchemaCacheError,
  getUserProfilesSchemaErrorMessage,
} from "@/src/lib/supabase/userProfilesSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validateRole(role = "") {
  return Boolean(ANNVERO_ROLE_LABELS[role]);
}

function canAssignRole(callerRole = "", targetRole = "") {
  if (callerRole === ANNVERO_ROLES.PARTNER && targetRole === ANNVERO_ROLES.ADMIN) {
    return false;
  }
  return true;
}

async function attachMembershipCompanyIds(mapped) {
  const uid =
    mapped.authUserId || (isAuthUserUuid(mapped.id) ? mapped.id : "");
  if (!uid) return mapped;
  const membership = await fetchActiveMembershipCompanyIds(uid);
  if (!membership.ok) {
    return { ...mapped, companyIds: [], companyIdsSource: "none" };
  }
  return {
    ...mapped,
    companyIds: membership.companyIds,
    companyIdsSource: "membership",
  };
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

  const users = [];
  for (const row of data || []) {
    users.push(await attachMembershipCompanyIds(mapProfileRow(row)));
  }

  return NextResponse.json({
    users,
    roles: Object.entries(ANNVERO_ROLE_LABELS).map(([id, label]) => ({ id, label })),
  });
}

export async function POST(request) {
  const { user, error, role: callerRole } = await requireManagementUser();
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
  if (!canAssignRole(callerRole, role)) {
    return NextResponse.json({ error: "Partner kullanıcıları admin rolü atayamaz." }, { status: 403 });
  }

  const profileDraft = {
    id: body?.id || `pending-${email}`,
    email,
    displayName,
    role,
    permissions: body?.permissions || getDefaultPermissionsForRole(role),
    companyIds: normalizeCompanyIds(body?.companyIds || body?.company_ids || []),
    teamId: body?.teamId || body?.team_id || "",
    isActive: body?.isActive ?? body?.is_active ?? true,
  };

  let invited = false;
  let inviteError = null;

  if (body?.invite === true) {
    const inviteResult = await inviteAuthUser({
      email,
      role,
      displayName,
    });
    invited = inviteResult.invited;
    inviteError = inviteResult.error;
    if (inviteResult.user?.id) {
      profileDraft.id = inviteResult.user.id;
    }
  }

  const saved = await upsertProfile(profileDraft);

  if (saved.error) {
    logSupabaseQueryError("admin:users:post", saved.error, USER_PROFILES_TABLE);
    return NextResponse.json({ error: saved.error.message }, { status: 500 });
  }

  let membershipSynced = false;
  let membershipPending = false;

  if (saved.profile?.id && !String(saved.profile.id).startsWith("pending-")) {
    await syncAnnveroUserMetadata(saved.profile.id, saved.profile);
    // DB doğruluk kaynağı: membership — admin'in verdiği companyIds (mapProfileRow yetki vermez)
    try {
      await syncCompanyMembership(saved.profile.id, profileDraft.companyIds, user?.id);
      membershipSynced = true;
    } catch (membershipError) {
      return NextResponse.json(
        {
          error: membershipError.message || "Firma erişimi güncellenemedi.",
          code: membershipError.code || null,
          membershipSynced: false,
          user: {
            ...saved.profile,
            companyIds: [],
            companyIdsSource: "none",
          },
          warning:
            "Kullanıcı kaydedildi ancak firma erişimi atanamadı; kullanıcı şu anda hiçbir firmaya erişemiyor.",
        },
        { status: 500 }
      );
    }
  } else if (saved.profile?.id) {
    // Pending kullanıcı: gerçek auth kullanıcısı yok; membership davet kabulünde atanacak.
    membershipPending = true;
  }

  return NextResponse.json({
    user: {
      ...saved.profile,
      companyIds: membershipSynced ? profileDraft.companyIds : [],
      companyIdsSource: membershipSynced ? "membership" : "none",
    },
    createdBy: user.email,
    invited,
    inviteError: inviteError?.message || null,
    membershipSynced,
    membershipPending,
  });
}

export async function PUT(request) {
  const { user, error, role: callerRole } = await requireManagementUser();
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
  if (role && !canAssignRole(callerRole, role)) {
    return NextResponse.json({ error: "Partner kullanıcıları admin rolü atayamaz." }, { status: 403 });
  }

  let recoverySent = false;
  let recoveryError = null;

  if (body?.requestPasswordReset) {
    const recovery = await sendPasswordRecoveryEmail(email);
    recoverySent = recovery.sent;
    recoveryError = recovery.error;
  }

  const assignedCompanyIds =
    body?.companyIds !== undefined || body?.company_ids !== undefined
      ? normalizeCompanyIds(body?.companyIds || body?.company_ids || [])
      : null;

  const saved = await upsertProfile({
    email,
    displayName: body?.displayName || body?.display_name,
    role: role || body?.role,
    permissions: body?.permissions,
    companyIds: assignedCompanyIds === null ? undefined : assignedCompanyIds,
    teamId: body?.teamId || body?.team_id,
    isActive: body?.isActive ?? body?.is_active,
    id: body?.id || `pending-${email}`,
    passwordResetRequestedAt: body?.requestPasswordReset
      ? new Date().toISOString()
      : body?.passwordResetRequestedAt,
  });

  if (saved.error) {
    return NextResponse.json({ error: saved.error.message }, { status: 500 });
  }

  let membershipSynced = false;
  let membershipPending = false;
  let responseCompanyIds = [];

  if (saved.profile?.id && !String(saved.profile.id).startsWith("pending-")) {
    await syncAnnveroUserMetadata(saved.profile.id, saved.profile);
    if (assignedCompanyIds !== null) {
      try {
        await syncCompanyMembership(saved.profile.id, assignedCompanyIds, user?.id);
        membershipSynced = true;
        responseCompanyIds = assignedCompanyIds;
      } catch (membershipError) {
        return NextResponse.json(
          {
            error: membershipError.message || "Firma erişimi güncellenemedi.",
            code: membershipError.code || null,
            membershipSynced: false,
            user: {
              ...saved.profile,
              companyIds: [],
              companyIdsSource: "none",
            },
            warning:
              "Profil güncellendi ancak firma erişimi güncellenemedi; önceki firma erişimi korundu.",
          },
          { status: 500 }
        );
      }
    } else {
      const membership = await fetchActiveMembershipCompanyIds(saved.profile.id);
      if (membership.ok) {
        responseCompanyIds = membership.companyIds;
        membershipSynced = true;
      }
    }
  } else if (saved.profile?.id) {
    membershipPending = true;
  }

  return NextResponse.json({
    user: {
      ...saved.profile,
      companyIds: responseCompanyIds,
      companyIdsSource: membershipSynced ? "membership" : "none",
    },
    recoverySent,
    recoveryError: recoveryError?.message || null,
    membershipSynced,
    membershipPending,
  });
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
