/**
 * İlk stabilizasyon paketi — sentetik doğrulama.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-bank-parser-stabilization.mjs
 */
import {
  buildUnrecognizedQueueItems,
} from "@/src/utils/bankParserLearningPipeline.js";
import {
  buildUnrecognizedFingerprint,
  isUnrecognizedStandardRow,
  collectUnrecognizedFromStandardRows,
  UNRECOGNIZED_CONFIDENCE_THRESHOLD,
} from "@/src/utils/transactionMemoryEngine.js";
import {
  buildLucaRowsFromMovementsAsync,
  TEB_LUCA_CHUNK_SIZE,
} from "@/src/utils/bankParserCore.js";
import {
  bankMovementToStandardLucaRows,
  bankMovementsToStandardLucaRows,
  sortStandardLucaRows,
} from "@/src/utils/standardLucaRow.js";

let failed = 0;
function pass(msg) {
  console.log(`PASS  ${msg}`);
}
function fail(msg) {
  console.log(`FAIL  ${msg}`);
  failed += 1;
}
function assert(cond, msg) {
  if (cond) pass(msg);
  else fail(msg);
}

// ——— 1) Tanınmayan kuyruk kriterleri ———
assert(TEB_LUCA_CHUNK_SIZE === 20, `TEB_LUCA_CHUNK_SIZE === 20 (got ${TEB_LUCA_CHUNK_SIZE})`);

assert(
  isUnrecognizedStandardRow({ hesapKodu: "", fisAciklama: "xyz odeme", borc: 10 }),
  "hesap eksik → unrecognized"
);
assert(
  !isUnrecognizedStandardRow({
    hesapKodu: "320.01.001",
    fisAciklama: "xyz",
    borc: 10,
    hafizaEslesme: true,
    memory_match: true,
    match_source: "learning_memory",
  }),
  "doğru eşleşen → kuyruğa düşmez"
);
assert(
  !isUnrecognizedStandardRow({ hesapKodu: "102.01.001", fisAciklama: "banka", borc: 10 }),
  "banka GL → kuyruğa düşmez"
);
assert(
  isUnrecognizedStandardRow({
    hesapKodu: "320.01.001",
    fisAciklama: "cari",
    borc: 10,
    kontrolNotu: "Cari bulunamadı",
  }),
  "cari çözülemedi → unrecognized"
);
assert(
  isUnrecognizedStandardRow({
    hesapKodu: "770.01",
    fisAciklama: "x",
    borc: 10,
    suggestionScore: 40,
  }),
  `güven < ${UNRECOGNIZED_CONFIDENCE_THRESHOLD} → unrecognized`
);
assert(
  !isUnrecognizedStandardRow({
    hesapKodu: "770.01",
    fisAciklama: "x",
    borc: 10,
    belgeTuru: "",
  }),
  "yalnız belge türü eksik + hesap var → kuyruğa düşmez"
);

const rows = [
  {
    id: "r1",
    firmaId: "c1",
    fisAciklama: "BILINMEYEN SATICI ODEME",
    fisTarihi: "2026-01-01",
    borc: 100,
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
  },
  {
    id: "r2",
    firmaId: "c1",
    fisAciklama: "BILINMEYEN SATICI ODEME",
    fisTarihi: "2026-01-01",
    borc: 100,
    hesapKodu: "",
    riskDurumu: "HESAP_EKSIK",
  },
  {
    id: "r3",
    firmaId: "c1",
    fisAciklama: "ESLESMIS CARI",
    fisTarihi: "2026-01-02",
    borc: 50,
    hesapKodu: "320.01.001",
    hafizaEslesme: true,
    memory_match: true,
    match_source: "learning_memory",
  },
];

const collected = collectUnrecognizedFromStandardRows(rows, {
  companyId: "c1",
  sourceModule: "banka",
  sourceBank: "VAKIFBANK",
});
assert(collected.length === 1, `dedupe: 2 aynı aday → 1 (got ${collected.length})`);
assert(
  !collected.some((c) => c.rawDescription?.includes("ESLESMIS")),
  "doğru eşleşen collect edilmez"
);

const fp1 = buildUnrecognizedFingerprint(collected[0]);
const fp2 = buildUnrecognizedFingerprint({
  ...collected[0],
  sourceRowId: "other",
});
assert(fp1 === fp2, "fingerprint sourceRowId'den bağımsız (firma|keyword|tarih|tutar)");

const queueItems = buildUnrecognizedQueueItems(rows, {
  companyId: "c1",
  sourceModule: "banka",
  sourceBank: "VAKIFBANK",
  learningMemory: [],
  skipLearningEnrichment: true,
});
assert(queueItems.length === 1, `buildUnrecognizedQueueItems skipLearning → 1 (got ${queueItems.length})`);

// ——— 2) TEB küçük dosya: chunked build vs sync referans ———
function makeMovement(i, bank = "TEB") {
  return {
    id: `m-${i}`,
    _accountingAnalyzed: true,
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    description: `TEB HAVALE ${i}`,
    lucaDescription: `TEB HAVALE ${i}`,
    direction: i % 2 === 0 ? "CIKIS" : "GIRIS",
    amount: 100 + i,
    accountCode: "102.01.001",
    counterAccountCode: i % 5 === 0 ? "" : "320.01.001",
    documentType: "DK",
    bankName: bank,
    rawRow: {
      banka: bank,
      tarih: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      aciklama: `TEB HAVALE ${i}`,
      borc: i % 2 === 0 ? 100 + i : 0,
      alacak: i % 2 === 0 ? 0 : 100 + i,
      tutar: i % 2 === 0 ? -(100 + i) : 100 + i,
      yon: i % 2 === 0 ? "CIKIS" : "GIRIS",
    },
  };
}

const smallTeb = [makeMovement(1), makeMovement(2), makeMovement(3)];
const syncRef = bankMovementsToStandardLucaRows(smallTeb, {
  firmaId: "c1",
  kaynakAdi: "TEB",
  creationSource: "bank_double_entry",
  bankAccounts: [],
});

const smallResult = await buildLucaRowsFromMovementsAsync(
  smallTeb,
  {
    selectedCompanyId: "c1",
    selectedBank: "TEB",
    learningMemory: [],
    selectedCompany: { bankAccounts: [] },
  },
  { chunkSize: 20 }
);

assert(
  smallResult.standardLucaRows.length === syncRef.length,
  `TEB small luca count: chunked=${smallResult.standardLucaRows.length} sync=${syncRef.length}`
);

const syncKeys = syncRef.map(
  (r) => `${r.fisNo}|${r.hesapKodu}|${Number(r.borc || 0)}|${Number(r.alacak || 0)}|${r.fisAciklama}`
);
const chunkKeys = smallResult.standardLucaRows.map(
  (r) => `${r.fisNo}|${r.hesapKodu}|${Number(r.borc || 0)}|${Number(r.alacak || 0)}|${r.fisAciklama}`
);
assert(
  syncKeys.join("||") === chunkKeys.join("||"),
  "TEB small: fiş/hesap/tutar/açıklama sırası birebir aynı"
);

// ——— 3) TEB büyük dosya: tamamlanır, sıra korunur (sync ref ile) ———
const bigTeb = Array.from({ length: 85 }, (_, i) => makeMovement(i + 1));
const t0 = Date.now();
const bigResult = await buildLucaRowsFromMovementsAsync(
  bigTeb,
  {
    selectedCompanyId: "c1",
    selectedBank: "TEB",
    learningMemory: [],
    selectedCompany: { bankAccounts: [] },
  },
  { chunkSize: 20 }
);
const bigMs = Date.now() - t0;
const bigSync = bankMovementsToStandardLucaRows(bigTeb, {
  firmaId: "c1",
  kaynakAdi: "TEB",
  creationSource: "bank_double_entry",
  bankAccounts: [],
});
assert(
  bigResult.standardLucaRows.length === bigSync.length,
  `TEB big luca count match (${bigResult.standardLucaRows.length}) in ${bigMs}ms`
);
assert(
  bigResult.standardLucaRows.every((r, i) => r.fisNo === bigSync[i].fisNo),
  "TEB big: fisNo sırası korunur"
);
assert(
  Array.isArray(bigResult.unrecognizedItems),
  "alreadyAnalyzed iken unrecognizedItems dizi (boş olabilir ama null değil)"
);

// ——— 4) Garanti / Vakıf regress: tek hareket 2 Luca satırı ———
for (const bank of ["GARANTI", "VAKIFBANK"]) {
  const m = makeMovement(1, bank);
  m.bankName = bank;
  m.rawRow.banka = bank;
  const res = await buildLucaRowsFromMovementsAsync(
    [m],
    {
      selectedCompanyId: "c1",
      selectedBank: bank,
      learningMemory: [],
      selectedCompany: { bankAccounts: [] },
    },
    { chunkSize: 40 }
  );
  const direct = bankMovementToStandardLucaRows(m, 1, {
    firmaId: "c1",
    kaynakAdi: bank,
    creationSource: "bank_double_entry",
  });
  assert(
    res.standardLucaRows.length === direct.length,
    `${bank}: luca satır sayısı değişmedi (${res.standardLucaRows.length})`
  );
}

// ——— 5) Boş kuyruk ———
const emptyQueue = buildUnrecognizedQueueItems(
  [
    {
      id: "ok",
      firmaId: "c1",
      fisAciklama: "OK",
      fisTarihi: "2026-01-01",
      borc: 1,
      hesapKodu: "320.01.001",
      hafizaEslesme: true,
      memory_match: true,
      match_source: "learning_memory",
    },
  ],
  { companyId: "c1", skipLearningEnrichment: true, learningMemory: [] }
);
assert(emptyQueue.length === 0, "tüm kayıtlar eşleşmişse kuyruk boş");

// ——— 6) Main-thread fallback: hazır buffer, file.arrayBuffer çağrılmaz ———
{
  const XLSX = await import("xlsx");
  const { parseBankExcelOnMainThread } = await import(
    "@/src/utils/bankExcelMainThreadParse.js"
  );
  const sheet = [
    ["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"],
    ["01.01.2026", "TEST HAVALE FALLBACK", "150,00", "", "1000"],
    ["02.01.2026", "TEST TAHSILAT FALLBACK", "", "200,00", "1200"],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheet);
  XLSX.utils.book_append_sheet(wb, ws, "Ekstre");
  const written = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  let arrayBuffer;
  if (written instanceof ArrayBuffer) {
    arrayBuffer = written;
  } else if (written?.buffer instanceof ArrayBuffer) {
    arrayBuffer = written.buffer.slice(
      written.byteOffset,
      written.byteOffset + written.byteLength
    );
  } else {
    arrayBuffer = Uint8Array.from(written).buffer;
  }

  let fileArrayBufferCalls = 0;
  const fakeFile = {
    name: "fake-teb.xlsx",
    async arrayBuffer() {
      fileArrayBufferCalls += 1;
      throw new Error("file.arrayBuffer should not be called when buffer is provided");
    },
  };

  const fallback = await parseBankExcelOnMainThread(
    fakeFile,
    "TEB",
    () => {},
    arrayBuffer
  );
  assert(fileArrayBufferCalls === 0, "fallback: file.arrayBuffer çağrılmadı");
  assert(
    fallback.parseMode === "main-thread-fallback",
    `fallback parseMode (got ${fallback.parseMode})`
  );
  assert(
    (fallback.normalizedRows || []).length >= 1,
    `fallback en az 1 hareket (got ${fallback.normalizedRows?.length || 0})`
  );

  // slice(0) detach senaryosu: orijinal buffer hâlâ okunabilir
  const workerSlice = arrayBuffer.slice(0);
  assert(
    workerSlice.byteLength === arrayBuffer.byteLength,
    "worker slice(0) boyut korunur; orijinal buffer intact"
  );
}

console.log(failed === 0 ? "\nALL PASSED" : `\nFAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
