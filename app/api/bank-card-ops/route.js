import { NextResponse } from "next/server";
import {
  createNormalizedFinancialTransaction,
  summarizeRecognitionStatuses,
  toPersistedFinancialTransaction,
} from "@/src/models/normalizedFinancialTransaction";
import { buildBankCardOpsDashboard } from "@/src/utils/bankCardOpsCenter";
import {
  getServerSupabaseAdmin,
  getServerSupabaseAdminGuardResponse,
  logSupabaseQueryError,
} from "@/src/lib/supabase/serverAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "normalized_financial_transactions";

function getClient() {
  const guard = getServerSupabaseAdminGuardResponse("bank-card-ops", TABLE);
  if (guard) return { supabase: null, guard };
  const supabase = getServerSupabaseAdmin({ requireServiceRole: true });
  if (!supabase) {
    return {
      supabase: null,
      guard: NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY yapılandırılmamış." },
        { status: 500 }
      ),
    };
  }
  return { supabase, guard: null };
}

/** GET ?companyId= — oturum/özet veya DB satırları */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const companyId = String(searchParams.get("companyId") || "").trim();

  const { supabase, guard } = getClient();
  if (guard) return guard;

  let query = supabase.from(TABLE).select("*").order("created_at", { ascending: false }).limit(500);
  if (companyId) query = query.eq("company_id", companyId);

  const { data, error } = await query;
  if (error) {
    logSupabaseQueryError("bank-card-ops:list", error, TABLE);
    // Tablo yoksa boş özet dön (migration henüz uygulanmamış olabilir)
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

/** POST — toplu upsert (parser sonucu) */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.transactions) ? body.transactions : [];

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "transactions boş." }, { status: 400 });
  }

  const { supabase, guard } = getClient();
  if (guard) return guard;

  const records = rows.map((row) => toPersistedFinancialTransaction(createNormalizedFinancialTransaction(row)));

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
      companyId: body.company_id || records[0]?.company_id || "",
      bankName: body.bank_name || "",
      sourceFileName: body.source_file_name || "",
    }),
  });
}
