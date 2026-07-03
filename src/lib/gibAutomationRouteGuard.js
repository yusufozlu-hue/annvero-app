import { NextResponse } from "next/server";
import {
  GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE,
  isGibAutomationServiceConfigured,
} from "@/src/lib/gibAutomationEnv";

export function getGibAutomationGuardResponse() {
  if (isGibAutomationServiceConfigured()) {
    return null;
  }

  return NextResponse.json(
    {
      ok: false,
      error: GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE,
      resultStatus: GIB_AUTOMATION_NOT_CONFIGURED_MESSAGE,
    },
    { status: 503 }
  );
}
