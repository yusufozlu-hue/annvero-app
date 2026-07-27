/**
 * POST /api/google-drive/reconcile
 * HMAC shared-secret ile sistem reconcile — üretim schedule bu turda yok.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getApiSupabase } from "@/src/lib/auth/apiGuard";
import { getValidGoogleAccessTokenByConnectionId } from "@/src/lib/googleDrive/connectionStore";
import { requiresStrictRuntimeSecrets } from "@/src/lib/security/envGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import { ANNVERO_SYSTEM_FOLDER } from "@/src/utils/cloudStorage/types.js";
import { runCompanyDriveSync } from "@/src/utils/cloudStorage/runCompanyDriveSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SAFE = Object.freeze({
  SECRET_MISSING: "Reconcile secret yapılandırılmamış.",
  UNAUTHORIZED: "Yetkisiz.",
  RATE_LIMITED: "Çok fazla istek.",
  COMPANY_NOT_FOUND: "Firma bulunamadı.",
  COMPANY_INACTIVE: "Pasif firma atlandı.",
  FOLDER_MISSING: "Drive klasörü yok.",
  CONNECTION_MISSING: "Drive bağlantısı yok.",
  SYNC_FAILED: "Senkron başarısız.",
});

function safeEqualSecret(provided, expected) {
  const left = Buffer.from(String(provided || ""), "utf8");
  const right = Buffer.from(String(expected || ""), "utf8");
  if (left.length !== right.length) {
    const fill = Buffer.alloc(left.length);
    timingSafeEqual(left, fill);
    return false;
  }
  if (left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function readReconcileSecret() {
  const a = String(process.env.ANNVERO_RECONCILE_SECRET || "").trim();
  const b = String(process.env.CRON_SECRET || "").trim();
  return a || b || "";
}

function isCompanyActive(company) {
  return company?.data?.isActive !== false;
}

function authorizeReconcile(request) {
  const expected = readReconcileSecret();
  if (!expected) {
    if (requiresStrictRuntimeSecrets()) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, code: "SECRET_MISSING", message: SAFE.SECRET_MISSING },
          { status: 503 }
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", message: SAFE.UNAUTHORIZED },
        { status: 401 }
      ),
    };
  }
  const provided = request.headers.get("x-annvero-reconcile-secret") || "";
  if (!safeEqualSecret(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", message: SAFE.UNAUTHORIZED },
        { status: 401 }
      ),
    };
  }
  return { ok: true };
}

async function reconcileOneCompany(supabase, companyId) {
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id,data")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError || !company) {
    return { companyId, code: "COMPANY_NOT_FOUND", ok: false };
  }
  if (!isCompanyActive(company)) {
    return { companyId, code: "COMPANY_INACTIVE", ok: false, skipped: true };
  }

  const { data: folder, error: folderError } = await supabase
    .from("company_cloud_folders")
    .select("root_folder_id,connection_id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (folderError || !folder?.root_folder_id) {
    return { companyId, code: "FOLDER_MISSING", ok: false, skipped: true };
  }
  if (!folder.connection_id) {
    return { companyId, code: "CONNECTION_MISSING", ok: false, skipped: true };
  }

  let accessToken;
  try {
    const token = await getValidGoogleAccessTokenByConnectionId(folder.connection_id);
    accessToken = token.accessToken;
  } catch {
    return { companyId, code: "CONNECTION_MISSING", ok: false, skipped: true };
  }

  try {
    const result = await runCompanyDriveSync({
      supabase,
      accessToken,
      companyId,
      rootFolderId: folder.root_folder_id,
      writeSyncEvents: true,
      extraEvents: [
        {
          eventType: "reconcile",
          status: "ok",
          errorMessage: null,
        },
      ],
    });
    return {
      companyId,
      ok: true,
      code: "OK",
      stats: result.stats,
      lastSyncAt: result.lastSyncAt,
    };
  } catch {
    return { companyId, code: "SYNC_FAILED", ok: false };
  }
}

export async function POST(request) {
  const auth = authorizeReconcile(request);
  if (!auth.ok) return auth.response;

  const limited = enforceRateLimit(request, null, "google-drive-reconcile", {
    limit: 10,
    windowMs: 300_000,
  });
  if (limited) return limited;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { supabase, guard } = getApiSupabase(
    "google-drive-reconcile",
    "document_index"
  );
  if (guard) return guard;

  const singleCompanyId = String(body?.companyId || "").trim();

  if (singleCompanyId) {
    const result = await reconcileOneCompany(supabase, singleCompanyId);
    return NextResponse.json({
      ok: result.ok,
      code: result.code,
      results: [result],
      // Güvenli kodlar — secret / token yok
      skippedSystemFolder: ANNVERO_SYSTEM_FOLDER,
    });
  }

  const { data: folders, error: foldersError } = await supabase
    .from("company_cloud_folders")
    .select("company_id,root_folder_id,connection_id")
    .not("root_folder_id", "is", null);

  if (foldersError) {
    return NextResponse.json(
      { ok: false, code: "SYNC_FAILED", message: SAFE.SYNC_FAILED },
      { status: 500 }
    );
  }

  const companyIds = [
    ...new Set(
      (folders || [])
        .map((f) => String(f.company_id || "").trim())
        .filter(Boolean)
    ),
  ];

  const results = [];
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const companyId of companyIds) {
    const result = await reconcileOneCompany(supabase, companyId);
    results.push({
      companyId: result.companyId,
      ok: result.ok,
      code: result.code,
      skipped: Boolean(result.skipped),
      stats: result.stats || undefined,
    });
    if (result.ok) okCount += 1;
    else if (result.skipped) skipCount += 1;
    else failCount += 1;
  }

  return NextResponse.json({
    ok: failCount === 0,
    code: "BATCH_DONE",
    summary: { okCount, skipCount, failCount, total: results.length },
    results,
  });
}
