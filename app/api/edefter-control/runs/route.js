import { NextResponse } from "next/server";
import {
  applyCompanyScopeToQuery,
  requireAuthenticatedApi,
  resolveCompanyId,
} from "@/src/lib/auth/apiGuard";
import { excludeSoftDeleted } from "@/src/lib/softDelete";
import {
  assertNoRawDocumentLeak,
  buildSafeEdefterMetadata,
  EDEFTER_AUDIT_EVENT_TYPES,
  publicEdefterFindingView,
  publicEdefterRunView,
} from "@/src/utils/eDefterPersistSafe";

const RUNS_TABLE = "edefter_control_runs";
const FINDINGS_TABLE = "edefter_control_findings";
const AUDIT_TABLE = "edefter_control_audit_events";

const FORBIDDEN_KEY_RE =
  /xml|zip|iban|vkn|mersis|token|secret|password|raw|content|drive.?file|file.?id|payload|body|document.?text|satir|row.?data|belge.?metin/i;

function sanitizeText(value, max = 280) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

function sanitizeJson(value, depth = 0) {
  if (depth > 3) return Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) {
    return value
      .slice(0, 40)
      .map((item) =>
        typeof item === "string"
          ? sanitizeText(item, 120)
          : typeof item === "number" && Number.isFinite(item)
            ? item
            : typeof item === "boolean"
              ? item
              : null
      )
      .filter((item) => item !== null);
  }
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (FORBIDDEN_KEY_RE.test(key)) continue;
    const safeKey = sanitizeText(key, 64);
    if (typeof raw === "string") out[safeKey] = sanitizeText(raw, 240);
    else if (typeof raw === "number" && Number.isFinite(raw)) out[safeKey] = raw;
    else if (typeof raw === "boolean") out[safeKey] = raw;
    else if (Array.isArray(raw) || (raw && typeof raw === "object")) {
      out[safeKey] = sanitizeJson(raw, depth + 1);
    }
  }
  return out;
}

function sanitizeIncomingRun(body = {}) {
  const companyId = resolveCompanyId(body);
  const findings = Array.isArray(body.findings) ? body.findings : [];
  const run = {
    company_id: companyId,
    period: sanitizeText(body.period, 32),
    status: sanitizeText(body.status || "completed", 32) || "completed",
    engine_version: sanitizeText(body.engine_version || body.engineVersion, 40),
    source_fingerprint: sanitizeText(
      body.source_fingerprint || body.sourceFingerprint,
      128
    ),
    journal_fingerprint: sanitizeText(
      body.journal_fingerprint || body.journalFingerprint,
      128
    ),
    ledger_fingerprint: sanitizeText(
      body.ledger_fingerprint || body.ledgerFingerprint,
      128
    ),
    document_types: Array.isArray(body.document_types)
      ? body.document_types.map((t) => sanitizeText(t, 40)).filter(Boolean).slice(0, 20)
      : [],
    document_count: Math.max(0, Number(body.document_count || 0) || 0),
    row_count: Math.max(0, Number(body.row_count || 0) || 0),
    opening_balance_summary: sanitizeJson(body.opening_balance_summary),
    closing_balance_summary: sanitizeJson(body.closing_balance_summary),
    reconciliation_status:
      sanitizeText(body.reconciliation_status || "skipped", 32) || "skipped",
    reconciliation_summary: sanitizeJson(body.reconciliation_summary),
    severity_counts: sanitizeJson(body.severity_counts),
    result_summary: sanitizeJson(body.result_summary),
    started_at: body.started_at || null,
    completed_at: body.completed_at || new Date().toISOString(),
  };

  const safeFindings = findings.slice(0, 500).map((item) => ({
    code: sanitizeText(item.code, 80),
    severity: sanitizeText(item.severity || "info", 32) || "info",
    category: sanitizeText(item.category, 80),
    safe_reference: sanitizeText(item.safe_reference, 160),
    summary: sanitizeText(item.summary, 280)
      .replace(/\bTR\d{2}\s?\d{4}[\d\s]{10,}\b/gi, "TR**")
      .replace(/\b\d{10,11}\b/g, (m) => `${m.slice(0, 2)}****${m.slice(-2)}`),
    occurrence_count: Math.max(1, Number(item.occurrence_count || 1) || 1),
    resolution_status: sanitizeText(item.resolution_status || "open", 32) || "open",
  }));

  return { run, findings: safeFindings, retry: Boolean(body.retry) };
}

async function writeEdefterAudit(supabase, {
  runId = null,
  companyId = "",
  eventType,
  actorId = "",
  metadata = {},
}) {
  const { error } = await supabase.from(AUDIT_TABLE).insert([
    {
      run_id: runId,
      company_id: companyId,
      event_type: eventType,
      actor_id: String(actorId || ""),
      safe_metadata: buildSafeEdefterMetadata(metadata),
    },
  ]);
  if (error) {
    console.error("[edefter-audit]", error.message);
  }
}

export async function GET(request) {
  const companyId = resolveCompanyId({
    companyId: request.nextUrl.searchParams.get("companyId"),
  });
  const period = String(request.nextUrl.searchParams.get("period") || "").trim();
  const status = String(request.nextUrl.searchParams.get("status") || "").trim();
  const risk = String(request.nextUrl.searchParams.get("risk") || "").trim();

  const ctx = await requireAuthenticatedApi("edefter-control-runs:get", RUNS_TABLE, {
    companyId,
  });
  if (ctx.error) return ctx.error;
  if (!companyId) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }

  let query = ctx.supabase
    .from(RUNS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  query = excludeSoftDeleted(query);
  const scoped = applyCompanyScopeToQuery(query, ctx.access, companyId);
  if (!scoped) {
    return NextResponse.json({ data: [] });
  }
  query = scoped;

  if (period) query = query.eq("period", period);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = (data || []).map((row) => publicEdefterRunView(row));
  if (risk) {
    const riskKey = risk.toLocaleLowerCase("tr-TR");
    rows = rows.filter((row) => {
      const counts = row.severity_counts || {};
      if (riskKey.includes("kritik") || riskKey === "critical") {
        return Number(counts.critical || 0) > 0;
      }
      if (riskKey.includes("uyarı") || riskKey.includes("uyari") || riskKey === "warning") {
        return Number(counts.warning || 0) > 0;
      }
      return true;
    });
  }

  return NextResponse.json({ data: rows });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  try {
    assertNoRawDocumentLeak(body);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { run, findings, retry } = sanitizeIncomingRun(body);
  if (!run.company_id) {
    return NextResponse.json({ error: "companyId zorunludur." }, { status: 400 });
  }
  if (!run.engine_version) {
    return NextResponse.json({ error: "engine_version zorunludur." }, { status: 400 });
  }
  if (!run.source_fingerprint) {
    return NextResponse.json(
      { error: "source_fingerprint zorunludur." },
      { status: 400 }
    );
  }

  const ctx = await requireAuthenticatedApi("edefter-control-runs:post", RUNS_TABLE, {
    companyId: run.company_id,
  });
  if (ctx.error) return ctx.error;

  // Idempotent: aynı company + fingerprint + engine → mevcut run
  const { data: existing, error: existingError } = await ctx.supabase
    .from(RUNS_TABLE)
    .select("*")
    .eq("company_id", run.company_id)
    .eq("source_fingerprint", run.source_fingerprint)
    .eq("engine_version", run.engine_version)
    .is("deleted_at", null)
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (existing) {
    await writeEdefterAudit(ctx.supabase, {
      runId: existing.id,
      companyId: run.company_id,
      eventType: retry
        ? EDEFTER_AUDIT_EVENT_TYPES.SAVE_RETRY
        : EDEFTER_AUDIT_EVENT_TYPES.RUN_IDEMPOTENT_HIT,
      actorId: ctx.user?.id || "",
      metadata: {
        engine_version: run.engine_version,
        period: run.period,
        idempotent: true,
        retry: Boolean(retry),
      },
    });

    const { data: existingFindings } = await ctx.supabase
      .from(FINDINGS_TABLE)
      .select("*")
      .eq("run_id", existing.id)
      .eq("company_id", run.company_id)
      .is("deleted_at", null);

    return NextResponse.json({
      data: publicEdefterRunView({ ...existing, idempotent: true }),
      findings: (existingFindings || []).map(publicEdefterFindingView),
      idempotent: true,
      created: false,
    });
  }

  // Önceki motor sürümü varsa revision + supersedes bağla
  const { data: previous } = await ctx.supabase
    .from(RUNS_TABLE)
    .select("id, revision, engine_version")
    .eq("company_id", run.company_id)
    .eq("source_fingerprint", run.source_fingerprint)
    .is("deleted_at", null)
    .neq("status", "deleted")
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();

  const revision = previous ? Number(previous.revision || 1) + 1 : 1;
  const insertPayload = {
    ...run,
    revision,
    supersedes_run_id: previous?.id || null,
    created_by: String(ctx.user?.id || ctx.user?.email || ""),
  };

  const { data: created, error: insertError } = await ctx.supabase
    .from(RUNS_TABLE)
    .insert([insertPayload])
    .select("*")
    .maybeSingle();

  if (insertError) {
    // Unique race → mevcut kaydı dön
    if (String(insertError.code || "") === "23505" || /duplicate|unique/i.test(insertError.message || "")) {
      const { data: raced } = await ctx.supabase
        .from(RUNS_TABLE)
        .select("*")
        .eq("company_id", run.company_id)
        .eq("source_fingerprint", run.source_fingerprint)
        .eq("engine_version", run.engine_version)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (raced) {
        return NextResponse.json({
          data: publicEdefterRunView({ ...raced, idempotent: true }),
          findings: [],
          idempotent: true,
          created: false,
        });
      }
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  let createdFindings = [];
  if (findings.length) {
    const findingRows = findings.map((item) => ({
      ...item,
      run_id: created.id,
      company_id: run.company_id,
    }));
    const { data: insertedFindings, error: findingsError } = await ctx.supabase
      .from(FINDINGS_TABLE)
      .insert(findingRows)
      .select("*");
    if (findingsError) {
      console.error("[edefter-findings]", findingsError.message);
    } else {
      createdFindings = insertedFindings || [];
    }
  }

  if (previous?.id) {
    await ctx.supabase
      .from(RUNS_TABLE)
      .update({ status: "superseded", updated_at: new Date().toISOString() })
      .eq("id", previous.id)
      .eq("company_id", run.company_id);

    await writeEdefterAudit(ctx.supabase, {
      runId: created.id,
      companyId: run.company_id,
      eventType: EDEFTER_AUDIT_EVENT_TYPES.RUN_SUPERSEDED,
      actorId: ctx.user?.id || "",
      metadata: {
        engine_version: run.engine_version,
        superseded_run_id: previous.id,
        revision,
      },
    });
  }

  await writeEdefterAudit(ctx.supabase, {
    runId: created.id,
    companyId: run.company_id,
    eventType: EDEFTER_AUDIT_EVENT_TYPES.RUN_CREATED,
    actorId: ctx.user?.id || "",
    metadata: {
      engine_version: run.engine_version,
      period: run.period,
      revision,
      document_count: run.document_count,
      row_count: run.row_count,
      reconciliation_status: run.reconciliation_status,
      severity_counts: run.severity_counts,
      overall_sonuc: run.result_summary?.overall_sonuc,
      retry: Boolean(retry),
    },
  });

  return NextResponse.json({
    data: publicEdefterRunView(created),
    findings: createdFindings.map(publicEdefterFindingView),
    idempotent: false,
    created: true,
  });
}
