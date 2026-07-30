/**
 * Muhasebe hafızası kabul matrisi.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-account-memory-stabilize.mjs
 */
import fs from "node:fs";
import path from "node:path";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else {
    console.log(`PASS  ${msg}`);
  }
}

// Node localStorage shim for accountMemoryV2
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const {
  saveAccountMemoryV2Decision,
  resolveAccountMemoryV2Decision,
  loadAccountMemoryV2Records,
  persistAccountMemoryV2Records,
  listCompanyMemoryConflicts,
  resolveMemoryConflictKeep,
  reactivateAccountMemoryV2Record,
  deleteAccountMemoryV2Record,
  buildAccountMemoryV2Index,
  MEMORY_DECISION_CODE,
  MEMORY_AUTO_APPLY_MIN_CONFIDENCE,
  MEMORY_SUGGEST_MIN_CONFIDENCE,
  buildMemoryApplyReason,
  evaluateCoreMemoryOverride,
  buildCariMemoryCanonicalKey,
} = await import("@/src/utils/accountMemoryV2.js");

const {
  MEMORY_PRIORITY,
  resolveConfidenceBand,
} = await import("@/src/utils/accountMemoryPolicy.js");

store.clear();

function learn(partial, companyId = "c1") {
  return saveAccountMemoryV2Decision(
    {
      analysisKey: partial.analysisKey || "TEST KEY|GIRIS",
      normalizedDescription: partial.desc || "TEST KEY",
      accountCode: partial.accountCode || "320.01.TEST",
      direction: partial.direction || "GIRIS",
      documentType: partial.documentType || "DK",
      transactionType: partial.transactionType || "",
      source: "user-learn",
      ...partial,
    },
    { firmaId: companyId, companyId, source: "user-learn" }
  );
}

// Policy thresholds
assert(MEMORY_AUTO_APPLY_MIN_CONFIDENCE === 90, "auto eşik 90");
assert(MEMORY_SUGGEST_MIN_CONFIDENCE === 70, "öneri eşik 70");
assert(resolveConfidenceBand(95) === "high", "band high");
assert(resolveConfidenceBand(75) === "medium", "band medium");
assert(resolveConfidenceBand(40) === "low", "band low");
assert(MEMORY_PRIORITY.CORE_MEVZUAT > MEMORY_PRIORITY.FIRM_LEARNED, "öncelik CORE>öğrenilmiş");

// 1) İlk öğrenme
{
  store.clear();
  const saved = learn({
    analysisKey: "GLN HVL ACME|GIRIS",
    desc: "GLN HVL ACME",
    accountCode: "102.01.001",
  });
  assert(Boolean(saved?.id), "ilk öğrenme kaydı");
  assert(saved.companyId === "c1", "firma id");
  assert(saved.confidence >= 90, "öğrenme confidence");
}

// 2) Sonraki otomatik uygulama
{
  const decision = resolveAccountMemoryV2Decision(
    {
      companyId: "c1",
      analysisKey: "GLN HVL ACME|GIRIS",
      direction: "GIRIS",
      normalizedDescription: "GLN HVL ACME",
    },
    loadAccountMemoryV2Records()
  );
  assert(decision.autoApply === true || decision.confidence >= 90, "sonraki ay otomatik");
  assert(decision.record?.accountCode === "102.01.001", "hesap eşleşti");
}

// 3) Firma izolasyonu
{
  const other = resolveAccountMemoryV2Decision(
    {
      companyId: "c2",
      analysisKey: "GLN HVL ACME|GIRIS",
      direction: "GIRIS",
      normalizedDescription: "GLN HVL ACME",
    },
    loadAccountMemoryV2Records()
  );
  assert(!other.autoApply, "başka firma otomatik yok");
  assert(!other.record || other.record.companyId === "c2", "tenant sızıntı yok");
}

// 4) Idempotency — aynı düzeltme tek kural
{
  const before = loadAccountMemoryV2Records().filter(
    (r) => r.companyId === "c1" && r.isActive !== false
  ).length;
  learn({
    analysisKey: "GLN HVL ACME|GIRIS",
    desc: "GLN HVL ACME",
    accountCode: "102.01.001",
  });
  const after = loadAccountMemoryV2Records().filter(
    (r) =>
      r.companyId === "c1" &&
      r.isActive !== false &&
      r.accountCode === "102.01.001" &&
      r.analysisKey === "GLN HVL ACME|GIRIS"
  );
  assert(after.length === 1, "idempotent tek aktif kural");
}

// 5) Çelişki
{
  store.clear();
  // Force two active different accounts same key via direct persist
  const a = learn({
    analysisKey: "CONFLICT KEY|GIRIS",
    desc: "CONFLICT KEY",
    accountCode: "120.01.AAA",
  });
  const records = loadAccountMemoryV2Records();
  records.unshift({
    ...a,
    id: "amv2-conflict-b",
    accountCode: "120.01.BBB",
    isActive: true,
    confidence: 95,
  });
  persistAccountMemoryV2Records(records);
  const conflicts = listCompanyMemoryConflicts("c1");
  assert(conflicts.length >= 1, "MEMORY_CONFLICT listelenir");
  const decision = resolveAccountMemoryV2Decision(
    {
      companyId: "c1",
      analysisKey: "CONFLICT KEY|GIRIS",
      direction: "GIRIS",
      normalizedDescription: "CONFLICT KEY",
    },
    loadAccountMemoryV2Records()
  );
  assert(
    decision.mode === "conflict" || decision.decisionCode === MEMORY_DECISION_CODE.CONFLICT || !decision.autoApply,
    "çelişkide otomatik yok"
  );
  const resolved = resolveMemoryConflictKeep(a.id, "c1");
  assert(resolved.ok, "çelişki çözümü");
  const again = resolveMemoryConflictKeep(a.id, "c1");
  assert(
    again.code === MEMORY_DECISION_CODE.IDEMPOTENT || again.ok,
    "çözüm idempotent"
  );
}

// 6) Pasifleştir / geri al
{
  store.clear();
  const saved = learn({
    analysisKey: "REACT KEY|CIKIS",
    desc: "REACT KEY",
    accountCode: "320.01.XYZ",
    direction: "CIKIS",
  });
  deleteAccountMemoryV2Record(saved.id, { soft: true });
  const inactive = loadAccountMemoryV2Records().find((r) => r.id === saved.id);
  assert(inactive?.isActive === false, "soft pasif");
  const re = reactivateAccountMemoryV2Record(saved.id, "c1");
  assert(re?.record?.isActive !== false, "geri al aktif");
  const re2 = reactivateAccountMemoryV2Record(saved.id, "c1");
  assert(re2?.code === MEMORY_DECISION_CODE.IDEMPOTENT, "geri al idempotent");
}

// 7) CORE üstünlüğü
{
  const gate = evaluateCoreMemoryOverride({
    description: "SGDP prim ödemesi",
    accountCode: "361.01",
  });
  assert(gate.blocked === true, "SGDP CORE engeli");
  const delay = evaluateCoreMemoryOverride({
    description: "KDV gecikme zammı",
    accountCode: "360.01",
  });
  assert(delay.blocked === true, "gecikme CORE engeli");
  const ok = evaluateCoreMemoryOverride({
    description: "Normal EFT",
    accountCode: "102.01",
  });
  assert(ok.blocked === false, "normal işlem serbest");
}

// 8) Gerekçe metinleri
{
  const high = buildMemoryApplyReason({
    tier: "ANALYSIS_KEY",
    confidence: 95,
    usageCount: 7,
    successCount: 7,
  });
  assert(/fingerprint|onaylandı|otomatik/i.test(high.text), "yüksek gerekçe");
  const low = buildMemoryApplyReason({ confidence: 40 });
  assert(/Düşük güven/i.test(low.text), "düşük gerekçe");
  const conf = buildMemoryApplyReason({ conflict: true });
  assert(conf.code === MEMORY_DECISION_CODE.CONFLICT, "conflict code");
}

// 9) Canonical key
{
  const k1 = buildCariMemoryCanonicalKey("GLN HVL ACME", "GIRIS");
  const k2 = buildCariMemoryCanonicalKey("GLN HVL ACME", "GIRIS");
  assert(k1 === k2, "canonical deterministik");
}

// 10) Orta/düşük güven davranışı (sentetik kayıt)
{
  store.clear();
  const mid = learn({
    analysisKey: "MID KEY|GIRIS",
    desc: "MID KEY",
    accountCode: "120.01.MID",
  });
  const records = loadAccountMemoryV2Records().map((r) =>
    r.id === mid.id ? { ...r, confidence: 75, usageCount: 1, successCount: 1 } : r
  );
  persistAccountMemoryV2Records(records);
  const decision = resolveAccountMemoryV2Decision(
    {
      companyId: "c1",
      analysisKey: "MID KEY|GIRIS",
      direction: "GIRIS",
      normalizedDescription: "MID KEY",
    },
    loadAccountMemoryV2Records(),
    { allowAuto: true }
  );
  // 75 < 90 → autoApply false beklenir (eligible da confidence kontrol eder)
  assert(decision.autoApply !== true, "orta güven otomatik değil");
}

// 11) 1416 offline hafıza eşleştirme süresi
{
  const realPath = path.join(
    process.env.USERPROFILE || "",
    "Desktop",
    "VAKIFBANK ÖRNEK.xlsx"
  );
  if (!fs.existsSync(realPath)) {
    console.log("INFO  real xlsx yok — 1416 memory perf skip");
  } else {
    const { parseBankExcelOnMainThread } = await import(
      "@/src/utils/bankExcelMainThreadParse.js"
    );
    const {
      buildParserPreviewFromNormalizedRowsAsync,
      runAccountingAnalysisOnMovementsAsync,
    } = await import("@/src/utils/bankParserCore.js");
    const buf = fs.readFileSync(realPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parsed = await parseBankExcelOnMainThread(null, "VAKIFBANK", null, {
      arrayBuffer: ab,
    });
    assert((parsed.normalizedRows || []).length === 1416, "1416 parse");

    // Seed a few memory rules without logging content
    store.clear();
    for (let i = 0; i < 20; i += 1) {
      learn({
        analysisKey: `SEED${i}|GIRIS`,
        desc: `SEED${i}`,
        accountCode: `120.01.S${i}`,
      });
    }
    const index = buildAccountMemoryV2Index(loadAccountMemoryV2Records(), "offline");
    const preview = await buildParserPreviewFromNormalizedRowsAsync({
      normalizedRows: parsed.normalizedRows,
      selectedCompanyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    const t0 = performance.now();
    const analysis = await runAccountingAnalysisOnMovementsAsync({
      normalizedRows: parsed.normalizedRows,
      movementRows: preview.movementRows || [],
      selectedCompanyId: "offline",
      selectedBank: "VAKIFBANK",
      accountMemoryV2Index: index,
    });
    const matchMs = Math.round(performance.now() - t0);
    assert(matchMs <= 20_000, `parser+hafıza ≤20s (got ${matchMs}ms)`);
    // Hafıza eşleştirme tek başına da makul olmalı
    const t1 = performance.now();
    let hits = 0;
    for (const move of (preview.movementRows || []).slice(0, 1416)) {
      const d = resolveAccountMemoryV2Decision(
        {
          companyId: "offline",
          analysisKey: move.analysisKey || "",
          direction: move.direction || "",
          normalizedDescription: move.description || move.lucaDescription || "",
        },
        index
      );
      if (d.record) hits += 1;
    }
    const memMs = Math.round(performance.now() - t1);
    assert(memMs <= 5_000, `hafıza eşleştirme ≤5s (got ${memMs}ms)`);
    void analysis;
    console.log(
      JSON.stringify({
        memory1416: { matchPipelineMs: matchMs, memoryLookupMs: memMs, hits },
      })
    );
  }
}

console.log(failed === 0 ? "\nALL PASSED" : `\nFAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
