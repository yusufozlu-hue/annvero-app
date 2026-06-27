import { type NextRequest } from "next/server";
import { updateSession } from "@/src/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/muhasebe/:path*", "/dashboard/:path*", "/login"],
};
