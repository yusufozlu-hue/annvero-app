import { type NextRequest } from "next/server";
import { updateSession } from "@/src/lib/supabase/updateSession";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/muhasebe",
    "/muhasebe/:path*",
    "/dashboard",
    "/dashboard/:path*",
    "/login",
  ],
};
