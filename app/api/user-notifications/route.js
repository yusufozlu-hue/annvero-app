import { NextResponse } from "next/server";
import {
  getApiSupabase,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";

const TABLE = "user_app_notifications";

function isMissingRelation(error) {
  const msg = String(error?.message || error?.code || "");
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist|Could not find the table/i.test(msg)
  );
}

function publicNotification(row) {
  return {
    id: row.id,
    companyId: row.company_id || "",
    title: row.title,
    body: row.body || "",
    createdAt: row.created_at,
    readAt: row.read_at,
    unread: !row.read_at,
  };
}

export async function GET(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const userId = session.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  const { supabase, guard } = getApiSupabase("user-notifications:get", TABLE);
  if (guard) return guard;

  const countOnly = request.nextUrl.searchParams.get("countOnly") === "1";
  const unreadOnly = request.nextUrl.searchParams.get("unreadOnly") === "1";
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const pageSize = Math.min(
    50,
    Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 20))
  );

  try {
    let unreadQuery = supabase
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null)
      .is("read_at", null);
    const { count: unreadCount, error: cErr } = await unreadQuery;
    if (cErr) throw cErr;

    if (countOnly) {
      return NextResponse.json({ unreadCount: unreadCount || 0 });
    }

    let listQuery = supabase
      .from(TABLE)
      .select("id, company_id, title, body, created_at, read_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (unreadOnly) listQuery = listQuery.is("read_at", null);

    const { data, error } = await listQuery;
    if (error) throw error;

    const totalUnread = unreadCount || 0;
    return NextResponse.json({
      data: (data || []).map(publicNotification),
      unreadCount: totalUnread,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(Math.max(totalUnread, page * pageSize) / pageSize)),
    });
  } catch (error) {
    if (isMissingRelation(error)) {
      return NextResponse.json({
        data: [],
        unreadCount: 0,
        page: 1,
        pageSize,
        pageCount: 1,
        code: "SCHEMA_MISSING",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const userId = session.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const { supabase, guard } = getApiSupabase("user-notifications:patch", TABLE);
  if (guard) return guard;

  const now = new Date().toISOString();

  try {
    if (body.markAllRead === true) {
      const { error } = await supabase
        .from(TABLE)
        .update({ read_at: now })
        .eq("user_id", userId)
        .is("deleted_at", null)
        .is("read_at", null);
      if (error) throw error;
      return NextResponse.json({ ok: true, unreadCount: 0 });
    }

    const id = String(body.id || "");
    if (!id) {
      return NextResponse.json({ error: "id zorunlu." }, { status: 400 });
    }

    // Ownership enforced: only own rows
    const { data: existing, error: findErr } = await supabase
      .from(TABLE)
      .select("id, user_id, read_at")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: "Bildirim bulunamadı." }, { status: 403 });
    }

    if (body.read === true && !existing.read_at) {
      const { error } = await supabase
        .from(TABLE)
        .update({ read_at: now })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw error;
    }

    const { count } = await supabase
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null)
      .is("read_at", null);

    return NextResponse.json({ ok: true, unreadCount: count || 0 });
  } catch (error) {
    if (isMissingRelation(error)) {
      return NextResponse.json({ ok: true, unreadCount: 0, code: "SCHEMA_MISSING" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** Server-side create with dedupe (used by internal callers / tests via POST). */
export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  if (!session.access?.isManagementUser) {
    return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const userId = String(body.userId || session.user?.id || "");
  const title = String(body.title || "").trim().slice(0, 160);
  const safeBody = String(body.body || "").trim().slice(0, 280);
  const companyId = String(body.companyId || "").slice(0, 80);
  const dedupeKey = String(body.dedupeKey || `${title}|${companyId}|${Date.now()}`).slice(
    0,
    200
  );

  if (!userId || !title) {
    return NextResponse.json({ error: "userId ve title zorunlu." }, { status: 400 });
  }

  const { supabase, guard } = getApiSupabase("user-notifications:post", TABLE);
  if (guard) return guard;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          company_id: companyId,
          dedupe_key: dedupeKey,
          title,
          body: safeBody,
        },
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
      )
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      notification: data ? publicNotification(data) : null,
      deduped: !data,
    });
  } catch (error) {
    if (isMissingRelation(error)) {
      return NextResponse.json(
        {
          error: "Bildirim tablosu henüz uygulanmadı.",
          code: "SCHEMA_MISSING",
          migration: "029_account_plan_uploads_and_user_notifications.sql",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
