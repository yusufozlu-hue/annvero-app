/**
 * POST /api/google-drive/folders/provision-active
 * dryRun (varsayılan): tüm firmaları sınıflandır.
 * execute: en fazla 1 companyId — management + duplicate-name yeniden doğrulanır.
 * Token / Drive ID istemciye dönmez. İstemci companyId’ye kör güvenilmez.
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
/** Tek firma execute — Vercel 60s sınırına uygun */
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

function indexClassified(classified) {
  const byId = new Map();
  for (const row of [
    ...(classified.alreadyReady || []),
    ...(classified.willCreate || []),
    ...(classified.duplicateSkipped || []),
    ...(classified.inactiveSkipped || []),
    ...(classified.failed || []),
  ]) {
    if (row?.companyId) byId.set(String(row.companyId), row);
  }
  return byId;
}

function resolveRequestedCompanyId(body) {
  const ids = Array.isArray(body?.companyIds)
    ? body.companyIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (ids.length > 1) {
    return { error: "BATCH_TOO_LARGE", message: "En fazla bir firma hazırlanabilir." };
  }
  const single = String(body?.companyId || ids[0] || "").trim();
  if (!single) {
    return {
      error: "COMPANY_ID_REQUIRED",
      message: "Hazırlama için companyId gerekli (tek firma).",
    };
  }
  return { companyId: single };
}

export async function POST(request) {
  const session = await requireApiSession();
  if (session.error) return session.error;
  if (!session.access?.isManagementUser) {
    return jsonForbidden("Bu işlem için yönetim yetkisi gerekli.");
  }

  // Önizle + N tekil execute (resume) için daha geniş pencere.
  const limited = enforceRateLimit(
    request,
    session,
    "google-drive-folders-provision-active",
    { limit: 40, windowMs: 300_000 }
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

  const resolved = resolveRequestedCompanyId(body);
  if (resolved.error) {
    return NextResponse.json(
      {
        ok: false,
        error: resolved.message,
        code: resolved.error,
      },
      { status: 400 }
    );
  }

  const companyId = resolved.companyId;
  const byId = indexClassified(classified);
  const previewRow = byId.get(companyId);
  if (!previewRow) {
    return NextResponse.json(
      {
        ok: false,
        error: "Firma bulunamadı veya hazırlama kapsamında değil.",
        code: "COMPANY_NOT_IN_SCOPE",
      },
      { status: 404 }
    );
  }

  // Mükerrer / pasif: Drive/DB yazımı yok — sunucu yeniden sınıflandırdı.
  if (previewRow.status === PROVISION_STATUS.DUPLICATE_NAME_SKIPPED) {
    return NextResponse.json({
      ok: true,
      dryRun: false,
      mode: "single",
      result: previewRow,
      created: false,
    });
  }
  if (previewRow.status === PROVISION_STATUS.INACTIVE_SKIPPED) {
    return NextResponse.json({
      ok: true,
      dryRun: false,
      mode: "single",
      result: previewRow,
      created: false,
    });
  }

  // willCreate veya alreadyReady (resume / idempotent) — ensure içinde duplicate yeniden kontrol.
  const provision = await ensureCompanyDriveProvisioned(companyId, {
    dryRun: false,
  });
  const pub = toPublicProvisionResult(provision);

  return NextResponse.json({
    ok: true,
    dryRun: false,
    mode: "single",
    result: pub,
    created: provision.status === PROVISION_STATUS.CREATED,
  });
}
