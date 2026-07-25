import { NextResponse } from "next/server";
import {
  ANNVERO_RETURN_TO_COOKIE,
  ANNVERO_RETURN_TO_HINT_COOKIE,
  getReturnToCookieOptions,
  getReturnToHintCookieOptions,
  getSafeNextPath,
} from "@/src/utils/authRedirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Korumalı route'tan login'e giderken dönüş yolunu httpOnly cookie'ye yazar.
 * AuthGate (istemci) bu endpoint'i çağırır; proxy da doğrudan cookie set eder.
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const safe = getSafeNextPath(body?.path, "/dashboard");
  const response = NextResponse.json({ ok: true, path: safe });
  response.cookies.set(
    ANNVERO_RETURN_TO_COOKIE,
    safe,
    getReturnToCookieOptions()
  );
  response.cookies.set(
    ANNVERO_RETURN_TO_HINT_COOKIE,
    "1",
    getReturnToHintCookieOptions()
  );
  return response;
}

function clearReturnToCookies(response) {
  response.cookies.set(
    ANNVERO_RETURN_TO_COOKIE,
    "",
    getReturnToCookieOptions({ clear: true })
  );
  response.cookies.set(
    ANNVERO_RETURN_TO_HINT_COOKIE,
    "",
    getReturnToHintCookieOptions({ clear: true })
  );
  return response;
}

/**
 * Başarılı giriş sonrası hedefi oku ve cookie'yi sil.
 */
export async function GET(request) {
  const raw = request.cookies.get(ANNVERO_RETURN_TO_COOKIE)?.value;
  const path = getSafeNextPath(raw, "/dashboard");
  return clearReturnToCookies(NextResponse.json({ ok: true, path }));
}

export async function DELETE() {
  return clearReturnToCookies(NextResponse.json({ ok: true }));
}
