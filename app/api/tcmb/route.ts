import { NextResponse } from "next/server";
import { requireApiSession } from "@/src/lib/auth/apiGuard";
import { enforceDurableRateLimit } from "@/src/lib/security/rateLimitDurable";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "@/src/lib/security/requestId";
import { applyCorsHeaders } from "@/src/lib/security/cors";

const ALLOWED_DOVIZ = new Set(["USD", "EUR", "GBP", "CHF", "JPY", "SAR", "AUD", "CAD", "SEK", "NOK", "DKK"]);

function formatDate(date: Date) {
  const gun = String(date.getDate()).padStart(2, "0");
  const ay = String(date.getMonth() + 1).padStart(2, "0");
  const yil = date.getFullYear();
  return { gun, ay, yil };
}

async function getKurFromDate(date: Date, doviz: string): Promise<number | null> {
  const { gun, ay, yil } = formatDate(date);
  const url = `https://www.tcmb.gov.tr/kurlar/${yil}${ay}/${gun}${ay}${yil}.xml`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const xml = await response.text();
    const regex = new RegExp(
      `<Currency Kod="${doviz}">([\\s\\S]*?)<ForexBuying>(.*?)</ForexBuying>`,
      "i"
    );
    const match = xml.match(regex);
    if (!match) return null;
    const kur = Number(match[2].replace(",", ".").trim());
    return Number.isFinite(kur) ? kur : null;
  } catch {
    return null;
  }
}

/**
 * GET-only TCMB kur proxy.
 * Tüketici: muhasebe kur değerleme (oturumlu). Public hesaplama araçları kullanmıyor.
 * Oturum + durable rate limit + parametre allowlist.
 */
export async function GET(req: Request) {
  const requestId = getOrCreateRequestId(req);

  const session = await requireApiSession();
  if (session.error) {
    session.error.headers.set(REQUEST_ID_HEADER, requestId);
    return session.error;
  }

  const rateLimited = await enforceDurableRateLimit(
    req,
    session,
    "tcmb:kur",
    { limit: 60, windowMs: 300_000 }
  );
  if (rateLimited) {
    rateLimited.headers.set(REQUEST_ID_HEADER, requestId);
    return rateLimited;
  }

  const { searchParams } = new URL(req.url);
  const tarih = searchParams.get("tarih");
  const dovizRaw = searchParams.get("doviz");

  // Parametre allowlist — başka query yok sayılır
  if (!tarih || !dovizRaw) {
    return NextResponse.json(
      { error: "Eksik parametre", requestId },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}/.test(tarih) && Number.isNaN(Date.parse(tarih))) {
    return NextResponse.json(
      { error: "Geçersiz tarih", requestId },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  const doviz = String(dovizRaw).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  if (!ALLOWED_DOVIZ.has(doviz)) {
    return NextResponse.json(
      { error: "İzin verilmeyen döviz kodu", requestId },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
    );
  }

  const kontrolTarih = new Date(tarih);
  kontrolTarih.setDate(kontrolTarih.getDate() - 1);

  for (let i = 0; i < 10; i++) {
    const kur = await getKurFromDate(kontrolTarih, doviz);
    if (kur) {
      const response = NextResponse.json(
        { kur, tarih: kontrolTarih, requestId },
        {
          headers: {
            [REQUEST_ID_HEADER]: requestId,
            "Cache-Control": "private, max-age=300",
          },
        }
      );
      return applyCorsHeaders(response, req);
    }
    kontrolTarih.setDate(kontrolTarih.getDate() - 1);
  }

  const response = NextResponse.json(
    { error: "Kur bulunamadı", requestId },
    { status: 404, headers: { [REQUEST_ID_HEADER]: requestId } }
  );
  return applyCorsHeaders(response, req);
}
