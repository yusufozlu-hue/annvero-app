import { NextResponse } from "next/server";
import {
  applyCompanyScopeToQuery,
  assertCompanyAccess,
  getApiSupabase,
  requireApiSession,
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import { summarizeRecognitionStatuses, toPersistedFinancialTransaction, createNormalizedFinancialTransaction } from "@/src/models/normalizedFinancialTransaction";
import { buildBankCardOpsDashboard } from "@/src/utils/bankCardOpsCenter";
import { logSupabaseQueryError } from "@/src/lib/supabase/serverAdmin";
import { excludeSoftDeleted } from "@/src/lib/softDelete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "normalized_financial_transactions";

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });

  const ctx = await requireAuthenticatedApi("bank-card-ops:get", TABLE, { companyId });
  if (ctx.error) return ctx.error;

  let query = ctx.supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  query = excludeSoftDeleted(query);
  const scoped = applyCompanyScopeToQuery(query, ctx.access, companyId);
  if (!scoped) {
    return NextResponse.json({
      ok: true,
      tableReady: true,
      transactions: [],
      dashboard: buildBankCardOpsDashboard([], { companyId }),
      summary: summarizeRecognitionStatuses([]),
    });
  }

  const { data, error } = await scoped;
  if (error) {
    logSupabaseQueryError("bank-card-ops:list", error, TABLE);
    return NextResponse.json({
      ok: true,
      tableReady: false,
      transactions: [],
      dashboard: buildBankCardOpsDashboard([], { companyId }),
      summary: summarizeRecognitionStatuses([]),
      hint: "014_normalized_financial_transactions.sql migration çalıştırın.",
    });
  }

  const transactions = data || [];
  return NextResponse.json({
    ok: true,
    tableReady: true,
    transactions,
    dashboard: buildBankCardOpsDashboard(transactions, { companyId }),
    summary: summarizeRecognitionStatuses(transactions),
  });
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;

  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.transactions) ? body.transactions : [];

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "transactions boş." }, { status: 400 });
  }

  const companyId = resolveCompanyId(body) || resolveCompanyId(rows[0]);
  const accessCheck = assertCompanyAccess(session.access, companyId, { required: true });
  if (!accessCheck.ok) return accessCheck.response;

  const { supabase, guard } = getApiSupabase("bank-card-ops:post", TABLE);
  if (guard) return guard;

  const records = rows.map((row) =>
    toPersistedFinancialTransaction(createNormalizedFinancialTransaction(row))
  );

  const { data, error } = await supabase.from(TABLE).upsert(records, { onConflict: "id" }).select("id");

  if (error) {
    logSupabaseQueryError("bank-card-ops:upsert", error, TABLE);
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        persistedLocally: true,
        hint: "DB yazılamadı; client session (localStorage) kullanın.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    upserted: data?.length || 0,
    dashboard: buildBankCardOpsDashboard(records, {
      companyId,
      bankName: body.bank_name || "",
      sourceFileName: body.source_file_name || "",
    }),
  });
}
