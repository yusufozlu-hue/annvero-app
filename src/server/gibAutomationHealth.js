import { getGibAutomationServiceUrl } from "@/src/lib/gibAutomationEnv";

export const EXPECTED_PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.61.1-jammy";

export function isLibglibError(message) {
  return /libglib-2\.0\.so\.0|error while loading shared libraries/i.test(
    String(message || "")
  );
}

export function logLibglibStaleDeployWarning(errorMessage, health = null) {
  console.warn(
    "[gib-query] libglib hatası alındı — Railway büyük olasılıkla yeni Playwright Docker deploy'unu kullanmıyor.",
    {
      error: errorMessage,
      health,
      expectedDockerImage: EXPECTED_PLAYWRIGHT_IMAGE,
      hint: "Railway servisinde Root Directory=services/gib-automation ve config=/services/gib-automation/railway.json olmalı.",
    }
  );
}

export async function checkGibAutomationHealth() {
  const baseUrl = getGibAutomationServiceUrl();
  if (!baseUrl) {
    return { ok: false, error: "GIB_AUTOMATION_SERVICE_URL tanımlı değil." };
  }

  const headers = {};
  const token = String(process.env.GIB_AUTOMATION_SERVICE_TOKEN || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));

    const health = {
      ok: response.ok && payload.ok !== false,
      status: response.status,
      verified: payload.verified === true,
      service: payload.service || null,
      runtime: payload.runtime || null,
      image: payload.image || payload.playwrightImage || null,
      deploy: payload.deploy || null,
      playwright: payload.playwright || null,
      commit: payload.commit || payload.version || null,
    };

    console.info("[gib-query] automation /health", health);

    if (health.ok && !health.verified) {
      console.warn(
        "[gib-query] automation servisi online ancak Docker/Playwright doğrulaması başarısız.",
        health
      );
    }

    if (health.ok && health.runtime !== "docker-playwright") {
      console.warn(
        "[gib-query] automation servisi online ancak docker-playwright runtime raporlamıyor.",
        health
      );
    }

    return health;
  } catch (error) {
    const failed = {
      ok: false,
      error: error?.message || "GİB robot servisi /health yanıt vermedi.",
    };
    console.error("[gib-query] automation /health failed", failed);
    return failed;
  }
}
