/**
 * POST /api/google-drive/folders/provision-active
 * Aktif firmaların Drive arşivini toplu hazırla (dryRun varsayılan true).
 * Yalnız management/admin. Token / Drive ID istemciye dönmez.
 * Aynı unvanlı distinct company_id grupları otomatik oluşturulmaz.
 */

import { NextResponse } from "next/server";
import {
  getApiSupabase,
  jsonForbidden,
  requireApiSession,
} from "@/src/lib/auth/apiGuard";
import { enforceRateLimit } from "@/src/lib/security/rateLimit";
import {
  classifyCompaniesForProvision,
  ensureCompanyDriveProvisioned,
  PROVISION_STATUS,
  toPublicProvisionResult,
} from "@/src/lib/googleDrive/ensureCompanyDriveProvisioned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function publicBatchPayload({
  dryRun,
  alreadyReady,
  willCreate,
  inactiveSkipped,
  duplicateSkipped,
  failed,
  results,
  createdCount,
}) {
  const dup = duplicateSkipped || [];
  return {
    ok: true,
    dryRun: Boolean(dryRun),
    summary: {
      alreadyReady: alreadyReady.length,
      willCreate: willCreate.length,
      inactiveSkipped: inactiveSkipped.length,
      duplicateSkipped: dup.length,
      failed: failed.length,
      created: createdCount ?? 0,
    },
    alreadyReady,
    willCreate,
    inactiveSkipped,
    duplicateSkipped: dup,
    failed,
    results: results || undefined,
  };
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  if (!session.access?.isManagementUser) {
    return jsonForbidden("Bu işlem için yönetim yetkisi gerekli.");
  }

  const limited = enforceRateLimit(
    request,
    session,
    "google-drive-folders-provision-active",
    { limit: 6, windowMs: 300_000 }
  );
  if (limited) return limited;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // dryRun varsayılan true — execute için açıkça false gerekir.
  const dryRun = body?.dryRun !== false && body?.execute !== true;

  const { supabase, guard } = getApiSupabase(
    "google-drive-folders-provision-active",
    "company_cloud_folders"
  );
  if (guard) return guard;

  const classified = await classifyCompaniesForProvision(supabase);

  if (dryRun) {
    return NextResponse.json(
      publicBatchPayload({
        dryRun: true,
        ...classified,
        createdCount: 0,
      })
    );
  }

  const results = [];
  const created = [];
  const alreadyReady = [...classified.alreadyReady];
  const inactiveSkipped = [...classified.inactiveSkipped];
  const duplicateSkipped = [...(classified.duplicateSkipped || [])];
  const failed = [];
  let createdCount = 0;

  // Mükerrer unvan grubu willCreate’de yoktur; yine de execute savunması.
  for (const item of classified.willCreate) {
    const provision = await ensureCompanyDriveProvisioned(item.companyId, {
      dryRun: false,
    });
    const pub = toPublicProvisionResult(provision);
    results.push(pub);

    if (provision.status === PROVISION_STATUS.CREATED) {
      created.push(pub);
      createdCount += 1;
    } else if (provision.status === PROVISION_STATUS.ALREADY_READY) {
      alreadyReady.push(pub);
    } else if (provision.status === PROVISION_STATUS.INACTIVE_SKIPPED) {
      inactiveSkipped.push(pub);
    } else if (provision.status === PROVISION_STATUS.DUPLICATE_NAME_SKIPPED) {
      duplicateSkipped.push(pub);
    } else {
      failed.push(pub);
    }
  }

  return NextResponse.json(
    publicBatchPayload({
      dryRun: false,
      alreadyReady,
      willCreate: created,
      inactiveSkipped,
      duplicateSkipped,
      failed,
      results,
      createdCount,
    })
  );
}
