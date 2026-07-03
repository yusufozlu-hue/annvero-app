import { GIB_QUERY_STATUS } from "@/src/config/gibQueryStatuses";
import { decryptSecret } from "@/src/lib/gibCredentialsCrypto";
import { diffNewNotifications } from "@/src/utils/gibTebligatEngine";
import {
  completeGibLoginAndFetchTebligat,
  startGibLoginSession,
} from "@/src/server/gibPortalAutomation";
import {
  clearBrowserSession,
  storeBrowserSession,
  takeBrowserSession,
} from "@/src/server/gibBrowserSessionStore";

export async function loadCompanyGibCredentials(supabase, companyId) {
  const { data, error } = await supabase
    .from("company_gib_credentials")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.is_active === false) return null;

  return {
    companyId,
    gibUserCode: data.gib_user_code,
    password: decryptSecret(data.encrypted_password),
    parola: data.encrypted_parola ? decryptSecret(data.encrypted_parola) : "",
  };
}

export async function upsertCompanyQueryState(supabase, companyId, payload = {}) {
  const row = {
    company_id: companyId,
    last_query_at: payload.lastQueryAt || new Date().toISOString(),
    result_status: payload.resultStatus || GIB_QUERY_STATUS.SYSTEM_ERROR,
    last_error: payload.lastError || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("gib_company_query_state").upsert([row]);
  if (error) throw new Error(error.message);
  return row;
}

export async function createQuerySession(supabase, companyId, payload = {}) {
  const { data, error } = await supabase
    .from("gib_query_sessions")
    .insert([
      {
        company_id: companyId,
        status: payload.status || "awaiting_verification",
        result_status: payload.resultStatus || GIB_QUERY_STATUS.AWAITING_VERIFICATION,
        storage_state: payload.storageState || null,
        captcha_image_base64: payload.captchaImageBase64 || null,
        error_message: payload.errorMessage || null,
      },
    ])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getQuerySession(supabase, sessionId) {
  const { data, error } = await supabase
    .from("gib_query_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function persistNewOfficialNotifications(supabase, companyId, notifications = []) {
  const { data: existingRows, error: existingError } = await supabase
    .from("official_notifications")
    .select("*")
    .eq("company_id", companyId)
    .eq("channel", "gib");

  if (existingError) throw new Error(existingError.message);

  const incoming = notifications.map((item) => ({
    company_id: companyId,
    channel: "gib",
    title: item.title,
    summary: item.summary || "",
    reference_no: item.reference_no || item.referenceNo || "",
    notification_date: normalizeDate(item.notification_date || item.notificationDate),
    status: "unread",
    metadata: { source: "gib_automation" },
    checked_at: new Date().toISOString(),
  }));

  const newRows = diffNewNotifications(existingRows || [], incoming);
  if (!newRows.length) {
    return { inserted: [], newCount: 0 };
  }

  const { data, error } = await supabase.from("official_notifications").insert(newRows).select();
  if (error) throw new Error(error.message);

  return { inserted: data || [], newCount: (data || []).length };
}

function normalizeDate(value) {
  if (!value) return null;
  const match = String(value).match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export async function startCompanyGibQuery(supabase, companyId) {
  const credentials = await loadCompanyGibCredentials(supabase, companyId);

  if (!credentials) {
    await upsertCompanyQueryState(supabase, companyId, {
      resultStatus: GIB_QUERY_STATUS.MISSING_CREDENTIALS,
      lastError: "GİB kullanıcı bilgisi tanımlı değil.",
    });

    return {
      ok: false,
      resultStatus: GIB_QUERY_STATUS.MISSING_CREDENTIALS,
      error: "GİB kullanıcı bilgisi tanımlı değil.",
    };
  }

  await upsertCompanyQueryState(supabase, companyId, {
    resultStatus: GIB_QUERY_STATUS.QUERYING,
  });

  try {
    const loginSession = await startGibLoginSession(credentials);
    const session = await createQuerySession(supabase, companyId, {
      status: "awaiting_verification",
      resultStatus: GIB_QUERY_STATUS.AWAITING_VERIFICATION,
      storageState: loginSession.storageState,
      captchaImageBase64: loginSession.captchaImageBase64,
    });

    if (loginSession.bundle) {
      storeBrowserSession(session.id, loginSession.bundle);
    }

    await upsertCompanyQueryState(supabase, companyId, {
      resultStatus: GIB_QUERY_STATUS.AWAITING_VERIFICATION,
    });

    return {
      ok: true,
      sessionId: session.id,
      companyId,
      captchaImage: loginSession.captchaImageBase64,
      resultStatus: GIB_QUERY_STATUS.AWAITING_VERIFICATION,
    };
  } catch (error) {
    await upsertCompanyQueryState(supabase, companyId, {
      resultStatus: GIB_QUERY_STATUS.SYSTEM_ERROR,
      lastError: error.message,
    });

    return {
      ok: false,
      resultStatus: GIB_QUERY_STATUS.SYSTEM_ERROR,
      error: error.message,
    };
  }
}

export async function verifyCompanyGibQuery(supabase, sessionId, verificationCode) {
  const session = await getQuerySession(supabase, sessionId);
  if (!session) {
    return { ok: false, resultStatus: GIB_QUERY_STATUS.SYSTEM_ERROR, error: "Oturum bulunamadı." };
  }

  const companyId = session.company_id;

  await upsertCompanyQueryState(supabase, companyId, {
    resultStatus: GIB_QUERY_STATUS.QUERYING,
  });

  try {
    const bundle = takeBrowserSession(sessionId);
    const result = await completeGibLoginAndFetchTebligat({
      storageState: session.storage_state,
      verificationCode,
      bundle,
    });

    if (!result.ok) {
      clearBrowserSession(sessionId);
      await supabase
        .from("gib_query_sessions")
        .update({
          status: "failed",
          result_status: result.error || GIB_QUERY_STATUS.LOGIN_ERROR,
          error_message: result.error || GIB_QUERY_STATUS.LOGIN_ERROR,
        })
        .eq("id", sessionId);

      await upsertCompanyQueryState(supabase, companyId, {
        resultStatus: result.error || GIB_QUERY_STATUS.LOGIN_ERROR,
        lastError: result.error || GIB_QUERY_STATUS.LOGIN_ERROR,
      });

      return {
        ok: false,
        resultStatus: result.error || GIB_QUERY_STATUS.LOGIN_ERROR,
        error: result.error || GIB_QUERY_STATUS.LOGIN_ERROR,
      };
    }

    const persistResult = await persistNewOfficialNotifications(
      supabase,
      companyId,
      result.notifications || []
    );

    const resultStatus =
      persistResult.newCount > 0
        ? GIB_QUERY_STATUS.NEW_NOTIFICATION
        : GIB_QUERY_STATUS.NO_NOTIFICATION;

    await supabase
      .from("gib_query_sessions")
      .update({
        status: "completed",
        result_status: resultStatus,
        scraped_notifications: result.notifications || [],
        new_notification_count: persistResult.newCount,
      })
      .eq("id", sessionId);

    await upsertCompanyQueryState(supabase, companyId, {
      resultStatus,
      lastError: null,
    });

    return {
      ok: true,
      companyId,
      resultStatus,
      newCount: persistResult.newCount,
      inserted: persistResult.inserted,
    };
  } catch (error) {
    clearBrowserSession(sessionId);
    await supabase
      .from("gib_query_sessions")
      .update({
        status: "failed",
        result_status: GIB_QUERY_STATUS.SYSTEM_ERROR,
        error_message: error.message,
      })
      .eq("id", sessionId);

    await upsertCompanyQueryState(supabase, companyId, {
      resultStatus: GIB_QUERY_STATUS.SYSTEM_ERROR,
      lastError: error.message,
    });

    return {
      ok: false,
      resultStatus: GIB_QUERY_STATUS.SYSTEM_ERROR,
      error: error.message,
    };
  }
}
