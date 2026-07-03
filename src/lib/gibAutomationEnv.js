export const GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE =
  "GİB robot servisi yapılandırılmamış";

export function getGibAutomationServiceUrl() {
  const raw = process.env.GIB_AUTOMATION_SERVICE_URL || "";
  return raw.trim().replace(/\/+$/, "");
}

export function isGibAutomationServiceConfigured() {
  return Boolean(getGibAutomationServiceUrl());
}
