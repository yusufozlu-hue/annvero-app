import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type CompanyMigrateRecord = {
  id: string;
  company_name: string;
  data: Record<string, unknown>;
  updated_at?: string;
};

type MigrateRequestBody = {
  company?: CompanyMigrateRecord[];
  companies?: CompanyMigrateRecord[];
};

function createSupabaseServerClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!rawUrl || !anonKey) {
    return null;
  }

  const supabaseUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  return createClient(supabaseUrl, anonKey);
}

function extractCompanyArray(body: MigrateRequestBody | CompanyMigrateRecord[] | null) {
  if (!body) return [];

  if (Array.isArray(body)) {
    return body;
  }

  if (Array.isArray(body.companies)) {
    return body.companies;
  }

  if (Array.isArray(body.company)) {
    return body.company;
  }

  return [];
}

function normalizeRecords(records: CompanyMigrateRecord[]) {
  const now = new Date().toISOString();

  return records
    .filter((record) => record?.id && record?.company_name)
    .map((record) => ({
      id: record.id,
      company_name: record.company_name,
      data: record.data ?? {},
      updated_at: record.updated_at || now,
    }));
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json(
      {
        success: false,
        error: "Supabase istemcisi yapılandırılmamış.",
      },
      { status: 500 }
    );
  }

  let body: MigrateRequestBody | CompanyMigrateRecord[] | null = null;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Geçersiz istek gövdesi.",
      },
      { status: 400 }
    );
  }

  const records = normalizeRecords(extractCompanyArray(body));

  if (records.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: "Geçerli firma kaydı bulunamadı.",
      },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("companies").upsert(records, {
    onConflict: "id",
  });

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    count: records.length,
  });
}
