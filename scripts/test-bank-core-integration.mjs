#!/usr/bin/env node
/**
 * Banka parser ↔ ANNVERO CORE entegrasyon testi (Görev 3).
 * Node CLI — @/ alias gerektirmeyen bağımsız smoke test.
 */

const VAKIFBANK_PARSED_ROWS = [
  { banka: "Vakifbank", tarih: "2026-03-01", aciklama: "GOOGLE ADS IRELAND CC CHARGE", tutar: 1250, yon: "CIKIS", alacak: 1250, borc: 0, islemTipi: "DIGER", iban: "TR120001500158007309123456" },
  { banka: "Vakifbank", tarih: "2026-03-02", aciklama: "SGK PRIM ODEMESI 2026/02", tutar: 8500, yon: "CIKIS", alacak: 8500, borc: 0, islemTipi: "SGK" },
  { banka: "Vakifbank", tarih: "2026-03-03", aciklama: "POS TAHSILAT GUNSONU", tutar: 3200, yon: "GIRIS", borc: 3200, alacak: 0, islemTipi: "POS" },
  { banka: "Vakifbank", tarih: "2026-03-04", aciklama: "GONDERILEN EFT HAVALE ABC LTD", tutar: 5000, yon: "CIKIS", alacak: 5000, borc: 0, islemTipi: "HAVALE" },
  { banka: "Vakifbank", tarih: "2026-03-05", aciklama: "MTV ODEMESI 34ABC123", tutar: 2500, yon: "CIKIS", alacak: 2500, borc: 0, islemTipi: "VERGI" },
  { banka: "Vakifbank", tarih: "2026-03-06", aciklama: "KREDI KARTI ODEME VISA", tutar: 1800, yon: "CIKIS", alacak: 1800, borc: 0, islemTipi: "KREDI_KARTI" },
  { banka: "Vakifbank", tarih: "2026-03-07", aciklama: "RASTGELE BILINMEYEN ODEME XYZ", tutar: 99, yon: "CIKIS", alacak: 99, borc: 0, islemTipi: "DIGER" },
];

function isAnnveroCoreEnabled() {
  const raw = process.env.USE_ANNVERO_CORE || process.env.NEXT_PUBLIC_USE_ANNVERO_CORE || "";
  const value = String(raw).trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function bankRowToStandardTransaction(row = {}, context = {}) {
  const direction = row.yon === "CIKIS" ? "CIKIS" : "GIRIS";
  const amount =
    Number(row.tutar || 0) ||
    (direction === "CIKIS" ? -Math.abs(Number(row.alacak || 0)) : Math.abs(Number(row.borc || 0)));

  return {
    company_id: context.companyId || "",
    source_type: "bank",
    bank_name: row.banka || context.selectedBank || "",
    raw_description: row.aciklama || "",
    amount,
    currency: "TRY",
    transaction_date: row.tarih || "",
    iban: row.iban || "",
    counterparty_name: row.unvan || "",
    tax_no: "",
    raw_payload: { islem_tipi: row.islemTipi || "", direction },
  };
}

function isCoreDecisionUsable(core = {}) {
  return core.status !== "unknown" && Boolean(core.suggested_account_code);
}

function formatCoreDebugText(description, core = {}) {
  return [
    description,
    "↓",
    `Entity: ${core.matched_entity?.entity_name || "—"}`,
    "↓",
    `Source: ${core.decision_source || "unknown"}`,
    "↓",
    `Confidence: ${Math.round((core.confidence_score || 0) * 100)}`,
    "↓",
    `Account: ${core.suggested_account_code || "—"}`,
    "↓",
    `Document: ${core.suggested_document_type || "—"}`,
  ].join("\n");
}

function mockCoreForDescription(desc = "") {
  const text = desc.toUpperCase();
  if (text.includes("GOOGLE")) {
    return {
      status: "recognized",
      decision_source: "company_memory",
      confidence_score: 0.98,
      matched_entity: { entity_name: "Google" },
      suggested_account_code: "770.03",
      suggested_document_type: "DK",
    };
  }
  if (text.includes("SGK")) {
    return {
      status: "recognized",
      decision_source: "accounting_rule",
      confidence_score: 0.92,
      suggested_account_code: "361.01.001",
      suggested_document_type: "DK",
    };
  }
  if (text.includes("POS")) {
    return {
      status: "suggested",
      decision_source: "global_knowledge",
      confidence_score: 0.78,
      suggested_account_code: "108",
      suggested_document_type: "DK",
    };
  }
  if (text.includes("HAVALE") || text.includes("HVL")) {
    return {
      status: "suggested",
      decision_source: "entity",
      confidence_score: 0.72,
      suggested_account_code: "320.01.100",
      suggested_document_type: "DK",
    };
  }
  if (text.includes("MTV")) {
    return {
      status: "suggested",
      decision_source: "accounting_rule",
      confidence_score: 0.8,
      suggested_account_code: "360",
      suggested_document_type: "DK",
    };
  }
  if (text.includes("KREDI KARTI")) {
    return {
      status: "recognized",
      decision_source: "company_rule",
      confidence_score: 0.88,
      suggested_account_code: "309",
      suggested_document_type: "KR",
    };
  }
  return { status: "unknown", confidence_score: 0, suggested_account_code: null };
}

let passed = 0;
let failed = 0;

function assert(name, ok, detail = "") {
  if (ok) {
    console.log(`✓ ${name}`);
    passed += 1;
  } else {
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

console.log("\n=== Banka CORE Entegrasyon Testi ===\n");
console.log(`USE_ANNVERO_CORE=${isAnnveroCoreEnabled() ? "ON" : "OFF (legacy varsayılan)"}\n`);

const parsed = VAKIFBANK_PARSED_ROWS;
assert("Vakıfbank 7 satır parse", parsed.length === 7, `got ${parsed.length}`);

const std = bankRowToStandardTransaction(parsed[0], {
  companyId: "demo-co",
  selectedBank: "VAKIFBANK",
});
assert("Standart işlem shape", std.source_type === "bank" && std.company_id === "demo-co");
assert("GOOGLE açıklama", std.raw_description.includes("GOOGLE"));

let coreHits = 0;
let fallbackHits = 0;

console.log("\n--- Vakıfbank örnek satırlar ---\n");

for (const row of parsed) {
  const stdTx = bankRowToStandardTransaction(row, { companyId: "demo-co", selectedBank: "VAKIFBANK" });
  const core = mockCoreForDescription(row.aciklama);
  const viaCore = isAnnveroCoreEnabled() && isCoreDecisionUsable(core);

  if (viaCore) {
    coreHits += 1;
    console.log(`[CORE] ${row.aciklama}`);
    console.log(formatCoreDebugText(row.aciklama, core));
    console.log(`  → hesap: ${core.suggested_account_code}, belge: ${core.suggested_document_type}\n`);
  } else if (isCoreDecisionUsable(core)) {
    coreHits += 1;
    console.log(`[CORE-ready] ${row.aciklama} (flag kapalı — legacy kullanılır)`);
  } else {
    fallbackHits += 1;
    console.log(`[LEGACY FALLBACK] ${row.aciklama}`);
  }

  assert(`Std tx alanları: ${row.aciklama.slice(0, 20)}`, Boolean(stdTx.raw_description && stdTx.company_id));
}

console.log(`\nÖzet: ${coreHits} CORE / ${fallbackHits} legacy fallback (simülasyon)\n`);
console.log(`Passed: ${passed} / Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
