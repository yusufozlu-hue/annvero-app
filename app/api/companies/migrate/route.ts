import { NextResponse } from "next/server";
import {
  getApiSupabase,
  requireManagementUser,
} from "@/src/lib/auth/apiGuard";
import {
  buildAuditContextFromRequest,
  writeAuditEvent,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
} from "@/src/lib/audit/auditEvents";

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
  const mgmt = await requireManagementUser();
  if (mgmt.error === "unauthenticated") {
    return NextResponse.json({ success: false, error: "Oturum gerekli." }, { status: 401 });
  }
  if (mgmt.error === "forbidden") {
    return NextResponse.json({ success: false, error: "Yetkisiz erişim." }, { status: 403 });
  }

  const { supabase, guard } = getApiSupabase("companies:migrate", "companies");
  if (guard) {
    return NextResponse.json({ success: false, error: "Supabase yapılandırılmamış." }, { status: 500 });
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

  const { error } = await supabase!.from("companies").upsert(records, {
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

  void writeAuditEvent({
    ...buildAuditContextFromRequest(request, { user: mgmt.user }),
    companyId: "",
    entityType: AUDIT_ENTITY_TYPES.COMPANY,
    entityId: "bulk-migrate",
    action: AUDIT_ACTIONS.IMPORT,
    metadata: { count: records.length },
  });

  return NextResponse.json({
    success: true,
    count: records.length,
  });
}
