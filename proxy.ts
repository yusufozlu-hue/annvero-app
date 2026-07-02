import { type NextRequest } from "next/server";
import { updateSession } from "@/src/lib/supabase/updateSession";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/muhasebe",
    "/muhasebe/:path*",
    "/dashboard",
    "/dashboard/:path*",
    "/ofis-takip",
    "/ofis-takip/:path*",
    "/admin",
    "/admin/:path*",
    "/login",
  ],
};
