import { type NextRequest } from "next/server";
import { updateSession } from "@/src/lib/supabase/updateSession";

/**
 * Next.js 16 proxy (eski middleware).
 * /api dahil — TOKEN_REFRESHED Set-Cookie route handler'dan önce uygulanır.
 * /login getUser atlanır (updateSession içinde).
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Statik varlıklar hariç tüm path'ler (API dahil).
     * Resmi Supabase SSR: her istekte cookie yenileme.
     */
    /*
     * `/workers/*` classic IIFE assets must bypass session middleware so the
     * static JS (not an HTML rewrite) is what fetch/Worker bootstrap reads.
     */
    "/((?!_next/static|_next/image|favicon.ico|workers(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
