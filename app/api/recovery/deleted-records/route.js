import { NextResponse } from "next/server";
import { requireManagementApi } from "@/src/lib/auth/apiGuard";
import { listDeletedRecords } from "@/src/lib/recovery/deletedRecords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const ctx = await requireManagementApi("recovery:deleted-records", "companies");
  if (ctx.error) return ctx.error;

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId") || "";
  const table = params.get("table") || "";
  const limit = params.get("limit") || "";

  const result = await listDeletedRecords(ctx.supabase, ctx.access, {
    companyId,
    table,
    limit,
  });

  if (result.meta?.error) {
    return NextResponse.json({ error: result.meta.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
