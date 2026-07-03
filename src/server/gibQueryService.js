import { GIB_QUERY_STATUS } from "@/src/config/gibQueryStatuses";
import { GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE } from "@/src/lib/gibAutomationEnv";
import { decryptSecret } from "@/src/lib/gibCredentialsCrypto";
import {
  GibAutomationNotConfiguredError,
  startGibAutomationQuery,
  verifyGibAutomationQuery,
} from "@/src/server/gibAutomationClient";
import {
  checkGibAutomationHealth,
  isLibglibError,
  logLibglibStaleDeployWarning,
} from "@/src/server/gibAutomationHealth";
import { diffNewNotifications } from "@/src/utils/gibTebligatEngine";
import { toOfficialNotificationDbRow } from "@/src/utils/officialNotificationSchema";

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
    last_query_at: payload.lastQueryAt ?? new Date().toISOString(),
    result_status: payload.resultStatus ?? GIB_QUERY_STATUS.SYSTEM_ERROR,
    last_error: Object.prototype.hasOwnProperty.call(payload, "lastError")
      ? payload.lastError
      : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("gib_company_query_state").upsert([row]);
  if (error) throw new Error(error.message);
  return row;
}

export async function resetCompanyQueryStateForNewQuery(supabase, companyId) {
  await upsertCompanyQueryState(supabase, companyId, {
    resultStatus: GIB_QUERY_STATUS.QUERYING,
    lastError: null,
    lastQueryAt: new Date().toISOString(),
  });

  await supabase
    .from("gib_query_sessions")
    .update({
      status: "superseded",
      error_message: null,
      result_status: GIB_QUERY_STATUS.QUERYING,
    })
    .eq("company_id", companyId)
    .in("status", ["awaiting_verification", "failed"]);
}

export async function createQuerySession(supabase, companyId, payload = {}) {
  const row = {
    company_id: companyId,
    status: payload.status || "awaiting_verification",
    result_status: payload.resultStatus || GIB_QUERY_STATUS.AWAITING_VERIFICATION,
    storage_state: payload.storageState || null,
    captcha_image_base64: payload.captchaImageBase64 || null,
    error_message: payload.errorMessage || null,
  };

  if (payload.id) {
    row.id = payload.id;
  }

  const { data, error } = await supabase
    .from("gib_query_sessions")
    .insert([row])
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
    .eq("source", "gib");

  if (existingError) throw new Error(existingError.message);

  const incoming = notifications.map((item) =>
    toOfficialNotificationDbRow({
      company_id: companyId,
      source: "gib",
      notification_type: "tebligat",
      title: item.title,
      description: item.summary || "",
      reference_no: item.reference_no || item.referenceNo || "",
      served_date: normalizeDate(item.notification_date || item.notificationDate),
      status: "unread",
      priority: "normal",
    })
  );

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

function isAutomationNotConfiguredError(error) {
  return (
    error instanceof GibAutomationNotConfiguredError ||
    error?.message === GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE
  );
}

function handleAutomationFailure(message, health = null) {
  if (isLibglibError(message)) {
    logLibglibStaleDeployWarning(message, health);
  }
  return message;
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

  const health = await checkGibAutomationHealth();
  await resetCompanyQueryStateForNewQuery(supabase, companyId);

  const sessionId = crypto.randomUUID();

  try {
    const loginSession = await startGibAutomationQuery({
      sessionId,
      companyId,
      credentials,
    });

    if (!loginSession?.ok) {
      throw new Error(loginSession?.error || "GİB sorgusu başlatılamadı.");
    }

    const session = await createQuerySession(supabase, companyId, {
      id: sessionId,
      status: "awaiting_verification",
      resultStatus: GIB_QUERY_STATUS.AWAITING_VERIFICATION,
      storageState: loginSession.storageState || null,
      captchaImageBase64: loginSession.captchaImageBase64 || null,
      errorMessage: null,
    });

    await upsertCompanyQueryState(supabase, companyId, {
      resultStatus: GIB_QUERY_STATUS.AWAITING_VERIFICATION,
      lastError: null,
    });

    return {
      ok: true,
      sessionId: session.id,
      companyId,
      captchaImage: loginSession.captchaImageBase64,
      resultStatus: GIB_QUERY_STATUS.AWAITING_VERIFICATION,
      automationHealth: health,
    };
  } catch (error) {
    const rawMessage = isAutomationNotConfiguredError(error)
      ? GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE
      : error.message;
    const message = handleAutomationFailure(rawMessage, health);

    await upsertCompanyQueryState(supabase, companyId, {
      resultStatus: GIB_QUERY_STATUS.SYSTEM_ERROR,
      lastError: message,
    });

    return {
      ok: false,
      resultStatus: GIB_QUERY_STATUS.SYSTEM_ERROR,
      error: message,
      automationHealth: health,
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
    lastError: null,
  });

  const health = await checkGibAutomationHealth();

  try {
    const result = await verifyGibAutomationQuery({
      sessionId,
      verificationCode,
      storageState: session.storage_state,
    });

    if (!result?.ok) {
      const errorMessage = handleAutomationFailure(
        result.error || GIB_QUERY_STATUS.LOGIN_ERROR,
        health
      );

      await supabase
        .from("gib_query_sessions")
        .update({
          status: "failed",
          result_status: GIB_QUERY_STATUS.LOGIN_ERROR,
          error_message: errorMessage,
        })
        .eq("id", sessionId);

      await upsertCompanyQueryState(supabase, companyId, {
        resultStatus: GIB_QUERY_STATUS.LOGIN_ERROR,
        lastError: errorMessage,
      });

      return {
        ok: false,
        resultStatus: GIB_QUERY_STATUS.LOGIN_ERROR,
        error: errorMessage,
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
    const rawMessage = isAutomationNotConfiguredError(error)
      ? GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE
      : error.message;
    const message = handleAutomationFailure(rawMessage, health);

    await supabase
      .from("gib_query_sessions")
      .update({
        status: "failed",
        result_status: GIB_QUERY_STATUS.SYSTEM_ERROR,
        error_message: message,
      })
      .eq("id", sessionId);

    await upsertCompanyQueryState(supabase, companyId, {
      resultStatus: GIB_QUERY_STATUS.SYSTEM_ERROR,
      lastError: message,
    });

    return {
      ok: false,
      resultStatus: GIB_QUERY_STATUS.SYSTEM_ERROR,
      error: message,
    };
  }
}
