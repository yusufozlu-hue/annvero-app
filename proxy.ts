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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
