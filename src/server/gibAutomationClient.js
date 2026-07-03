import {
  GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE,
  getGibAutomationServiceUrl,
} from "@/src/lib/gibAutomationEnv";

export class GibAutomationNotConfiguredError extends Error {
  constructor() {
    super(GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE);
    this.name = "GibAutomationNotConfiguredError";
  }
}

async function requestAutomation(path, body) {
  const baseUrl = getGibAutomationServiceUrl();
  if (!baseUrl) {
    throw new GibAutomationNotConfiguredError();
  }

  const headers = { "Content-Type": "application/json" };
  const token = String(process.env.GIB_AUTOMATION_SERVICE_TOKEN || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(115_000),
    });
  } catch (error) {
    throw new Error(error?.message || "GİB robot servisine ulaşılamadı.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload.error || payload.message || `GİB robot servisi hatası (${response.status})`
    );
  }

  return payload;
}

export async function startGibAutomationQuery({ sessionId, companyId, credentials }) {
  return requestAutomation("/query/start", {
    sessionId,
    companyId,
    gibUserCode: credentials.gibUserCode,
    password: credentials.password,
    parola: credentials.parola || "",
  });
}

export async function verifyGibAutomationQuery({
  sessionId,
  verificationCode,
  storageState,
}) {
  return requestAutomation("/query/verify", {
    sessionId,
    verificationCode,
    storageState,
  });
}
