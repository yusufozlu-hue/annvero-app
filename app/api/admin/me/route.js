import { NextResponse } from "next/server";
import { isAdminUser } from "@/src/lib/auth/admin";
import { getServerSupabaseUser } from "@/src/lib/supabase/serverAuth";

export async function GET() {
  const { user } = await getServerSupabaseUser();

  if (!user) {
    return NextResponse.json({ isAdmin: false, authenticated: false });
  }

  return NextResponse.json({
    isAdmin: isAdminUser(user),
    authenticated: true,
    email: user.email,
  });
}
