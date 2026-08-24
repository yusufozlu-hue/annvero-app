/**
 * E-Defter kalıcı kayıt — güvenli payload, idempotency, tenant fail-closed.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-edefter-persist.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let failed = 0;
function check(cond, msg) {
  try {
    assert.ok(cond, msg);
    console.log(`PASS  ${msg}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
    console.error(`      ${error.message}`);
  }
}

const {
  E_DEFTER_ENGINE_VERSION,
  assertNoRawDocumentLeak,
  buildSafeEdefterMetadata,
  buildSafeEdefterPersistPayload,
  EDEFTER_SAFE_METADATA_KEYS,
  publicEdefterRunView,
} = await import("@/src/utils/eDefterPersistSafe.js");

const {
  E_DEFTER_KAYNAK,
  E_DEFTER_SONUC_SEVIYE,
  E_DEFTER_KONTROL_GRUP,
  E_DEFTER_ENGINE_VERSION: DEFAULT_ENGINE,
} = await import("@/src/config/eDefterKontrolDefaults.js");

const { buildEDefterResultFingerprints } = await import(
  "@/src/utils/eDefterKontrolEngine.js"
);

const root = process.cwd();

// --- Engine version shared ---
check(E_DEFTER_ENGINE_VERSION === DEFAULT_ENGINE, "engine version shared constant");

// --- Safe payload: no raw XML/ZIP/VKN dump ---
{
  const payload = buildSafeEdefterPersistPayload({
    companyId: "company-a",
    period: "2026/05",
    engineVersion: E_DEFTER_ENGINE_VERSION,
    fingerprints: {
      source: "abc123src",
      journal: "j1",
      ledger: "l1",
    },
    summary: {
      overallSonuc: E_DEFTER_SONUC_SEVIYE.UYARI,
      edefterUygun: false,
      canApproveExport: true,
      kritikHata: 1,
      uyariSayisi: 2,
      teknikHata: 0,
      vergiselRisk: 0,
      toplamSatir: 3,
      toplamFis: 1,
      yuklenenDefterSayisi: 2,
    },
    rows: [
      {
        id: "1",
        kaynak: E_DEFTER_KAYNAK.YEVMIYE_XML,
        grup: E_DEFTER_KONTROL_GRUP.KRITIK,
        code: "JOURNAL_LEDGER_MISMATCH",
        fisNo: "10",
        yevmiyeNo: "1",
        hesapKodu: "100.01",
        belgeNo: "B-1",
        aciklama: "Fark var TR33 0001 0002 0003 0004 0005 00 ve 1234567890",
        issues: ["Yevmiye-kebir toplam farkı"],
        riskLevel: "Kritik",
        hataTuru: "Muhasebesel",
        cozumDurumu: "Yeni",
      },
      {
        id: "2",
        kaynak: E_DEFTER_KAYNAK.YEVMIYE_XML,
        grup: "Hatasız kayıtlar",
        aciklama: "should be skipped",
      },
    ],
    journalLedger: {
      matched: false,
      skipped: false,
      findings: [{ code: "JOURNAL_LEDGER_MISMATCH" }],
      yTotals: { borc: 100, alacak: 100 },
      kTotals: { borc: 90, alacak: 90 },
    },
    documentTypes: ["Yevmiye", "Kebir"],
  });

  check(payload.company_id === "company-a", "payload company_id");
  check(payload.engine_version === E_DEFTER_ENGINE_VERSION, "payload engine_version");
  check(payload.source_fingerprint === "abc123src", "payload source fingerprint");
  check(payload.findings.length === 1, "hatasız satırlar persist edilmez");
  check(!/TR33 0001/.test(JSON.stringify(payload)), "IBAN maskelenir");
  check(!/1234567890/.test(payload.findings[0].summary), "VKN benzeri maskelenir");
  check(!payload.findings[0].aciklama, "ham aciklama alanı yok");
  check(payload.reconciliation_status === "mismatched", "reconciliation status");
  check(!("xml" in payload) && !("rows" in payload), "ham rows alanı yok");
  assertNoRawDocumentLeak(payload);
  check(true, "assertNoRawDocumentLeak clean payload");
}

{
  let threw = false;
  try {
    assertNoRawDocumentLeak({ note: "<?xml version='1.0'?><JournalEntries/>" });
  } catch (error) {
    threw = error.code === "RAW_PAYLOAD_FORBIDDEN";
  }
  check(threw, "raw XML payload rejected");
}

{
  const meta = buildSafeEdefterMetadata({
    engine_version: "3.1.0",
    period: "2026/05",
    token: "secret-should-drop",
    drive_file_id: "should-drop",
    raw_xml: "<a/>",
    idempotent: true,
    severity_counts: { critical: 1 },
  });
  check(meta.engine_version === "3.1.0", "metadata allowlist keeps engine_version");
  check(meta.idempotent === true, "metadata allowlist keeps idempotent");
  check(meta.token === undefined, "metadata drops token");
  check(meta.drive_file_id === undefined, "metadata drops drive_file_id");
  check(meta.raw_xml === undefined, "metadata drops raw_xml");
  check(
    EDEFTER_SAFE_METADATA_KEYS.includes("engine_version"),
    "engine_version in allowlist"
  );
}

// --- Fingerprint + revision semantics (unit) ---
{
  const fp1 = buildEDefterResultFingerprints({
    sourceFingerprint: "same-src",
    journalRows: [{ fisNo: "1", yevmiyeNo: "1", hesapKodu: "100", borc: 10, alacak: 0 }],
    ledgerRows: [{ fisNo: "1", yevmiyeNo: "1", hesapKodu: "100", borc: 10, alacak: 0 }],
    companyId: "a",
    period: "2026/05",
    summary: { overallSonuc: "Uyarı", toplamSatir: 1, kritikHata: 0 },
  });
  const fp2 = buildEDefterResultFingerprints({
    sourceFingerprint: "same-src",
    journalRows: [{ fisNo: "1", yevmiyeNo: "1", hesapKodu: "100", borc: 10, alacak: 0 }],
    ledgerRows: [{ fisNo: "1", yevmiyeNo: "1", hesapKodu: "100", borc: 10, alacak: 0 }],
    companyId: "a",
    period: "2026/05",
    summary: { overallSonuc: "Uyarı", toplamSatir: 1, kritikHata: 0 },
  });
  check(fp1.source === fp2.source, "same inputs → same source fingerprint");
  check(fp1.journal === fp2.journal, "same journal fingerprint");

  const idempotencyKey = (companyId, source, engine) =>
    `${companyId}|${source}|${engine}`;
  const k1 = idempotencyKey("a", fp1.source, "3.1.0");
  const k2 = idempotencyKey("a", fp1.source, "3.1.0");
  const k3 = idempotencyKey("a", fp1.source, "3.2.0");
  check(k1 === k2, "idempotent key stable for same engine");
  check(k1 !== k3, "new engine_version → new revision key");
}

// --- Public view strips nothing secret-bearing ---
{
  const view = publicEdefterRunView({
    id: "r1",
    company_id: "a",
    period: "2026/05",
    status: "completed",
    engine_version: "3.1.0",
    source_fingerprint: "s",
    journal_fingerprint: "j",
    ledger_fingerprint: "l",
    document_types: ["Yevmiye"],
    document_count: 1,
    row_count: 2,
    opening_balance_summary: {},
    closing_balance_summary: {},
    reconciliation_status: "matched",
    reconciliation_summary: {},
    severity_counts: { critical: 0 },
    result_summary: { overall_sonuc: "Uygun" },
    revision: 1,
    supersedes_run_id: null,
    started_at: null,
    completed_at: "2026-05-01T00:00:00Z",
    created_by: "u1",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    raw_xml: "SHOULD_NOT_APPEAR",
    drive_file_id: "SHOULD_NOT_APPEAR",
  });
  check(!("raw_xml" in view), "public view drops raw_xml");
  check(!("drive_file_id" in view), "public view drops drive_file_id");
}

// --- Migration contract ---
{
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/028_edefter_control_persistence.sql"),
    "utf8"
  );
  check(/create table if not exists public\.edefter_control_runs/i.test(sql), "028 runs table");
  check(/create table if not exists public\.edefter_control_findings/i.test(sql), "028 findings table");
  check(/create table if not exists public\.edefter_control_audit_events/i.test(sql), "028 audit table");
  check(/uq_edefter_control_runs_idempotent/i.test(sql), "028 unique idempotent index");
  check(/enable row level security/i.test(sql), "028 RLS enabled");
  check(/annvero_can_access_company/i.test(sql), "028 membership gate");
  check(!/\bdrop table\b/i.test(sql), "028 no drop table");
  check(!/\btruncate\b/i.test(sql), "028 no truncate");
  check(!/\bdelete from\b/i.test(sql), "028 no delete from");
}

{
  const sql027 = fs.readFileSync(
    path.join(root, "supabase/migrations/027_learning_memory_lookup_indexes.sql"),
    "utf8"
  );
  for (const idx of [
    "idx_learning_memory_company_active",
    "idx_learning_memory_company_keyword_active",
    "idx_learning_memory_company_usage",
    "idx_learning_memory_company_last_used",
  ]) {
    check(sql027.includes(idx), `027 defines ${idx}`);
    check(/create index if not exists/i.test(sql027), "027 idempotent IF NOT EXISTS");
  }
}

// --- API route fail-closed markers ---
{
  const runsRoute = fs.readFileSync(
    path.join(root, "app/api/edefter-control/runs/route.js"),
    "utf8"
  );
  const detailRoute = fs.readFileSync(
    path.join(root, "app/api/edefter-control/runs/[id]/route.js"),
    "utf8"
  );
  const findingRoute = fs.readFileSync(
    path.join(root, "app/api/edefter-control/findings/[id]/route.js"),
    "utf8"
  );
  check(/requireAuthenticatedApi/.test(runsRoute), "runs API requireAuthenticatedApi");
  check(
    /edefter_persist_control_run_atomic|callEdefterAtomicPersistRpc/.test(runsRoute),
    "runs API uses atomic persist RPC"
  );
  check(/created:\s*false/.test(runsRoute), "runs API fail-closed created:false");
  check(/status\",\s*\"completed\"|eq\(\"status\", \"completed\"\)/.test(runsRoute), "GET defaults to completed history");
  check(/requireAuthenticatedApi/.test(detailRoute), "detail API gated");
  check(/eq\("company_id", companyId\)/.test(detailRoute), "detail company scoped");
  check(/requireAuthenticatedApi/.test(findingRoute), "finding API gated");
  check(/eq\("company_id", companyId\)/.test(findingRoute), "finding company scoped");
}

{
  const sql035 = fs.readFileSync(
    path.join(root, "supabase/migrations/035_edefter_atomic_control_persist.sql"),
    "utf8"
  );
  check(/edefter_persist_control_run_atomic/i.test(sql035), "035 atomic RPC defined");
  check(/security definer/i.test(sql035), "035 SECURITY DEFINER");
  check(/search_path\s*=\s*pg_catalog,\s*pg_temp/i.test(sql035), "035 fixed search_path");
  check(/grant execute[\s\S]*service_role/i.test(sql035), "035 execute service_role");
  check(/revoke all[\s\S]*from anon, authenticated/i.test(sql035), "035 revoke anon/authenticated");
  check(!/^\s*drop table\b/im.test(sql035), "035 no drop table");
  check(!/^\s*truncate\b/im.test(sql035), "035 no truncate");
  check(!/^\s*delete from\b/im.test(sql035), "035 no delete from");
}

// --- UI: company clear + retry + no separate save button ---
{
  const page = fs.readFileSync(
    path.join(root, "app/(annvero)/muhasebe/e-defter-kontrol/page.jsx"),
    "utf8"
  );
  check(/Kaydı yeniden dene/.test(page), "UI retry button");
  check(/Kontrol Geçmişi/.test(page), "UI history section");
  check(/clearEDefterUiCaches/.test(page), "UI clears caches on company change");
  check(/persistAnalysisResult/.test(page), "UI auto-persist after analyze");
  check(!/>\s*Kaydet\s*</.test(page), "no separate Kaydet button");
  check(/clearEDefterLegacyLocalStorage/.test(page), "clears legacy localStorage after save");
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll edefter persist checks passed.");
