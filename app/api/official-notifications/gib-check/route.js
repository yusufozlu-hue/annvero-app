import { NextResponse } from "next/server";
import {
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import {
  buildGibCheckPayload,
  computeNextCheckAt,
  diffNewNotifications,
  validateVerificationCode,
} from "@/src/utils/gibTebligatEngine";
import { toOfficialNotificationDbRow } from "@/src/utils/officialNotificationSchema";

async function performGibCheck(supabase, body = {}) {
  const companyId = String(body?.company_id || body?.companyId || "").trim();
  const verificationCode = body?.verification_code || body?.verificationCode || "";
  const foundNotifications = body?.found_notifications || body?.foundNotifications || [];
  const intervalDays = Number(body?.interval_days || body?.intervalDays || 1);

  const checkPayload = buildGibCheckPayload({
    companyId,
    verificationCode,
    foundNotifications,
  });

  if (!checkPayload.ok) {
    return { ok: false, status: 400, error: checkPayload.error };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("official_notifications")
    .select("*")
    .eq("company_id", companyId)
    .eq("source", "gib");

  if (existingError) {
    return { ok: false, status: 500, error: existingError.message };
  }

  const newRows = diffNewNotifications(
    existingRows || [],
    checkPayload.notifications.map((item) =>
      toOfficialNotificationDbRow({
        company_id: companyId,
        source: "gib",
        notification_type: "tebligat",
        title: item.title,
        description: item.summary,
        reference_no: item.referenceNo,
        served_date: item.notificationDate,
        status: "unread",
        priority: "normal",
      })
    )
  );
  let inserted = [];

  if (newRows.length) {
    const { data, error } = await supabase.from("official_notifications").insert(newRows).select();
    if (error) {
      return { ok: false, status: 500, error: error.message };
    }
    inserted = data || [];
  }

  const checkedAt = checkPayload.checkedAt;
  const nextCheckAt = computeNextCheckAt(checkedAt, intervalDays);

  const { data: reminderRow } = await supabase
    .from("gib_check_reminders")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  const reminderPayload = {
    company_id: companyId,
    enabled: reminderRow?.enabled ?? true,
    interval_days: intervalDays,
    reminder_time: reminderRow?.reminder_time || "09:00",
    last_check_at: checkedAt,
    next_check_at: nextCheckAt,
    push_enabled: reminderRow?.push_enabled ?? true,
    updated_at: new Date().toISOString(),
  };

  if (reminderRow?.id) {
    await supabase.from("gib_check_reminders").update(reminderPayload).eq("id", reminderRow.id);
  } else {
    await supabase.from("gib_check_reminders").insert([reminderPayload]);
  }

  return {
    ok: true,
    companyId,
    checkedAt,
    nextCheckAt,
    newCount: inserted.length,
    inserted,
    verificationAccepted: true,
  };
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const companyId = String(body?.company_id || body?.companyId || "").trim();
  const accessCheck = assertCompanyAccess(session.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const { supabase, guard } = getApiSupabase("official-notifications:gib-check", "official_notifications");
  if (guard) return guard;

  const result = await performGibCheck(supabase, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result);
}

export async function PUT(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const companyIds = Array.isArray(body?.company_ids || body?.companyIds)
    ? body.company_ids || body.companyIds
    : [];
  const verificationCode = body?.verification_code || body?.verificationCode || "";

  const validation = validateVerificationCode(verificationCode);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  if (!companyIds.length) {
    return NextResponse.json({ error: "En az bir firma seçilmelidir." }, { status: 400 });
  }

  for (const companyId of companyIds) {
    const check = assertCompanyAccess(session.access, companyId, { required: true });
    if (!check.ok) return check.response;
  }

  const { supabase, guard } = getApiSupabase("official-notifications:gib-check-bulk", "official_notifications");
  if (guard) return guard;

  const results = [];

  for (const companyId of companyIds) {
    const result = await performGibCheck(supabase, {
      company_id: companyId,
      verification_code: verificationCode,
      found_notifications: [],
      interval_days: body?.interval_days || body?.intervalDays || 1,
    });

    results.push({
      companyId,
      ...result,
    });
  }

  const successCount = results.filter((item) => item.ok).length;
  const newTotal = results.reduce((sum, item) => sum + Number(item.newCount || 0), 0);

  return NextResponse.json({
    ok: successCount === results.length,
    successCount,
    total: results.length,
    newTotal,
    results,
  });
}
