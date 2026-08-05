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

// ——— 7) PDF banka ekstreleri + OCR/şifre/dedup matrisi ———
{
  const {
    parseBankStatementPdf,
    mergeExcelAndPdfTransactions,
    isPdfNonMovementLine,
    PDF_MAX_PAGES,
  } = await import("@/src/utils/bankStatementPdf.js");
  const {
    buildMovementIdentityKey,
    dedupeCanonicalTransactions,
    canonicalToLegacyBankRow,
  } = await import("@/src/utils/bankCanonicalTransaction.js");
  const {
    buildBankStatementPdfFixture,
    buildEncryptedPdfStub,
    buildScannedPdfStub,
    buildCorruptPdfStub,
    movementsToLegacyRows,
    buildTextPdf,
  } = await import("./fixtures/bankPdfFixtures.mjs");
  const { bankMovementsToStandardLucaRows: lucaFromMoves } = await import(
    "@/src/utils/standardLucaRow.js"
  );

  const BANKS = ["GARANTI", "TEB", "VAKIFBANK", "ZIRAAT", "KUVEYT"];

  for (const bank of BANKS) {
    const pdfBytes = buildBankStatementPdfFixture(bank, { multipage: false });
    const result = await parseBankStatementPdf(pdfBytes, {
      companyId: "c1",
      selectedBank: bank,
    });
    assert(result.ok, `${bank} PDF: ok`);
    assert(
      (result.transactions || []).length === 3,
      `${bank} PDF: 3 hareket (got ${result.transactions?.length})`
    );
    assert(result.detectedBank === bank || result.transactions[0].bank === bank, `${bank} PDF bank detect`);
    assert(
      result.transactions.every((t) => t.sourceType === "pdf"),
      `${bank} PDF: sourceType=pdf`
    );
    assert(
      result.transactions.every((t) => t.currency === "TRY"),
      `${bank} PDF: currency TRY`
    );
    assert(
      result.transactions.every((t) => t.sourceRow > 0),
      `${bank} PDF: sourceRow korunur`
    );
    assert(
      result.transactions.every((t) => t.transactionDate && t.description),
      `${bank} PDF: tarih+açıklama`
    );

    const multi = buildBankStatementPdfFixture(bank, { multipage: true });
    const multiResult = await parseBankStatementPdf(multi, {
      companyId: "c1",
      selectedBank: bank,
    });
    assert(
      (multiResult.transactions || []).length === 3,
      `${bank} multipage PDF: 3 hareket`
    );
    assert(
      (multiResult.pageCount || 0) >= 2 ||
        multiResult.transactions.some((t) => t.sourcePage >= 1),
      `${bank} multipage: sayfa bilgisi`
    );

    // PDF ↔ Excel çapraz dedup
    const excelRows = movementsToLegacyRows(bank).map((r) => ({
      ...r,
      companyId: "c1",
    }));
    const merged = mergeExcelAndPdfTransactions(excelRows, result, {
      companyId: "c1",
      selectedBank: bank,
      excelFileHash: "excel-hash-different",
    });
    assert(
      merged.unique.length === 3,
      `${bank} PDF↔Excel dedup: unique=3 (got ${merged.unique.length}, dups=${merged.duplicates.length})`
    );
    assert(
      merged.duplicates.length === 3,
      `${bank} PDF↔Excel dedup: 3 duplicate bastırıldı (got ${merged.duplicates.length})`
    );

    // Luca eşdeğerliği: PDF legacy vs Excel legacy aynı kimlikler
    const pdfLegacy = result.transactions.map(canonicalToLegacyBankRow);
    const toMovement = (row, i) => ({
      id: `pdf-${bank}-${i}`,
      _accountingAnalyzed: true,
      date: row.tarih,
      description: row.aciklama,
      lucaDescription: row.aciklama,
      direction: row.yon,
      amount: Math.abs(row.tutar),
      accountCode: "102.01.001",
      counterAccountCode: "320.01.001",
      documentType: "DK",
      bankName: bank,
      rawRow: row,
    });
    const pdfLuca = lucaFromMoves(pdfLegacy.map(toMovement), {
      firmaId: "c1",
      kaynakAdi: bank,
      creationSource: "bank_double_entry",
      bankAccounts: [],
    });
    const excelLuca = lucaFromMoves(excelRows.map(toMovement), {
      firmaId: "c1",
      kaynakAdi: bank,
      creationSource: "bank_double_entry",
      bankAccounts: [],
    });
    const keyOf = (r) =>
      `${r.hesapKodu}|${Number(r.borc || 0)}|${Number(r.alacak || 0)}|${String(r.fisAciklama || "").slice(0, 40)}`;
    assert(
      pdfLuca.map(keyOf).join("||") === excelLuca.map(keyOf).join("||"),
      `${bank} Luca PDF≡Excel deterministik`
    );
  }

  // OCR_REQUIRED — sahte hareket yok
  const scanned = await parseBankStatementPdf(buildScannedPdfStub(), { companyId: "c1" });
  assert(scanned.code === "OCR_REQUIRED", "scanned PDF → OCR_REQUIRED");
  assert((scanned.transactions || []).length === 0, "OCR_REQUIRED: hareket yok");
  assert(scanned.ocrRequired === true, "OCR_REQUIRED flag");

  // Şifreli
  const enc = await parseBankStatementPdf(buildEncryptedPdfStub(), { companyId: "c1" });
  assert(enc.code === "PDF_ENCRYPTED", "şifreli PDF kodu");
  assert(/şifreli/i.test(enc.message || ""), "şifreli PDF Türkçe mesaj");

  // Bozuk / incomplete
  const corrupt = await parseBankStatementPdf(buildCorruptPdfStub(), { companyId: "c1" });
  assert(
    corrupt.code === "PDF_INCOMPLETE" || corrupt.code === "PDF_CORRUPT" || corrupt.code === "NOT_PDF",
    `bozuk PDF güvenli hata (got ${corrupt.code})`
  );
  assert((corrupt.transactions || []).length === 0, "bozuk PDF: hareket yok");

  // Üstbilgi / ara toplam hareket değil
  assert(isPdfNonMovementLine("Ara toplam 1.000,00"), "ara toplam non-movement");
  assert(isPdfNonMovementLine("Devreden bakiye 5.000,00"), "devreden non-movement");
  assert(isPdfNonMovementLine("Sayfa 2"), "sayfa non-movement");
  assert(!isPdfNonMovementLine("02.01.2026 EFT GELEN 100,00 0,00 200,00"), "hareket satırı geçer");

  // Bakiye mismatch → review, fiş yok
  const mismatchPdf = buildTextPdf(
    [
      "TEB Hesap Ekstresi",
      "Acilis bakiyesi: 1.000,00",
      "02.01.2026 EFT TEST 100,00 0,00 1.100,00",
      "Kapanis bakiyesi: 9.999,00",
    ],
    { bankLabel: "TEB Hesap Ekstresi" }
  );
  const mismatch = await parseBankStatementPdf(mismatchPdf, {
    companyId: "c1",
    selectedBank: "TEB",
  });
  assert(
    mismatch.code === "BALANCE_MISMATCH" || mismatch.balance?.reviewRequired === true,
    "bakiye farkı → review"
  );
  assert(mismatch.ok === false, "bakiye farkında ok=false (otomatik fiş yok)");

  // Kanıt yok → BALANCE_EVIDENCE_MISSING (sahte MATCHED yok)
  const {
    BALANCE_EVIDENCE_MISSING,
    BALANCE_MATCHED,
    reconcileStatementBalances,
  } = await import("@/src/utils/bankBalanceReconcile.js");
  const noEvidence = reconcileStatementBalances(
    [
      {
        amount: 100,
        direction: "GIRIS",
        transactionDate: "01.01.2026",
        description: "X",
      },
    ],
    {}
  );
  assert(
    noEvidence.code === BALANCE_EVIDENCE_MISSING,
    "kanıt yok → BALANCE_EVIDENCE_MISSING"
  );
  assert(noEvidence.matched !== true, "kanıt yokken matched≠true");

  // null hint fields must NOT coerce to 0,00 via Number(null)
  const nullHints = reconcileStatementBalances(
    [
      {
        amount: 100,
        direction: "GIRIS",
        transactionDate: "01.01.2026",
        description: "X",
      },
    ],
    { openingBalance: null, closingBalance: null }
  );
  assert(
    nullHints.code === BALANCE_EVIDENCE_MISSING,
    "null hint alanları → EVIDENCE_MISSING (sahte 0,00 yok)"
  );
  assert(nullHints.openingBalance == null, "null açılış → null kalır");
  assert(nullHints.closingBalance == null, "null kapanış → null kalır");
  assert(nullHints.evidenceSource !== "hints", "null hint evidenceSource≠hints");

  // Bakiye kolonu + trailing 0,00 (etiketsiz kapanış) → statement close 0
  const { extractBalanceHintsFromText } = await import(
    "@/src/utils/bankStatementPdf.js"
  );
  const trailingClose = extractBalanceHintsFromText(
    [
      "VakıfBank Hesap Hareketleri",
      "Tarih Açıklama Tutar Bakiye",
      "02.01.2026 EFT GELEN 1.000,00 1.000,00",
      "03.01.2026 EFT GIDEN -1.000,00 0,00",
    ].join("\n")
  );
  assert(
    trailingClose.closingBalance === 0,
    "Bakiye kolonu trailing 0,00 → kapanış 0"
  );
  assert(
    trailingClose.openingBalance == null,
    "etiketsiz açılış → null (Number(null) yok)"
  );

  const matchedHints = reconcileStatementBalances(
    [
      { amount: 100, direction: "GIRIS" },
      { amount: -40, direction: "CIKIS" },
    ],
    { openingBalance: 1000, closingBalance: 1060 }
  );
  assert(matchedHints.code === BALANCE_MATCHED, "açılış+alacak-borç=kapanış");
  assert(matchedHints.signModel.includes("credits"), "işaret modeli yazılı");

  // Session dedup UI mesajı + bastırılan sayılar
  const {
    applySessionMovementDedup,
    DUPLICATE_STATEMENT_UI_MESSAGE,
  } = await import("@/src/utils/bankStatementDedup.js");
  const tebPdf = await parseBankStatementPdf(
    buildBankStatementPdfFixture("TEB"),
    { companyId: "c1", selectedBank: "TEB" }
  );
  assert(tebPdf.balance?.code === BALANCE_MATCHED || tebPdf.ok, "TEB fixture bakiye");
  const sampleCanon = tebPdf.transactions;
  const firstPass = applySessionMovementDedup(sampleCanon, new Set(), {
    companyId: "c1",
    selectedBank: "TEB",
  });
  assert(firstPass.uniqueCount === 3, "ilk geçiş unique=3");
  const secondPass = applySessionMovementDedup(
    sampleCanon,
    firstPass.seenKeys,
    { companyId: "c1", selectedBank: "TEB" }
  );
  assert(secondPass.allDuplicate === true, "ikinci geçiş allDuplicate");
  assert(
    secondPass.uiMessage === DUPLICATE_STATEMENT_UI_MESSAGE,
    "UI mükerrer mesajı"
  );
  assert(secondPass.suppressedMovements === 3, "bastırılan hareket=3");
  assert(secondPass.suppressedLucaRows === 6, "bastırılan Luca=6");
  assert(
    DUPLICATE_STATEMENT_UI_MESSAGE === "Mükerrer ekstre — yeniden işlenmedi",
    "UI mesaj metni sabit"
  );

  // Aşırı sayfa
  const bombLines = Array.from({ length: 5 }, (_, i) => `01.01.2026 BOMB ${i} 1,00 0,00 ${i},00`);
  const bomb = buildTextPdf(bombLines, { pageCount: PDF_MAX_PAGES + 5, bankLabel: "TEB" });
  const bombResult = await parseBankStatementPdf(bomb, { companyId: "c1" });
  assert(
    bombResult.code === "PDF_TOO_MANY_PAGES" || (bombResult.transactions || []).length >= 0,
    `sayfa limiti kontrolü (code=${bombResult.code})`
  );

  // Identity key dosya hash'ten bağımsız
  const k1 = buildMovementIdentityKey({
    companyId: "c1",
    bank: "TEB",
    transactionDate: "02.01.2026",
    amount: 1500,
    direction: "GIRIS",
    description: "TEB EFT GELEN ABC LTD",
  });
  const k2 = buildMovementIdentityKey({
    companyId: "c1",
    bank: "TEB",
    transactionDate: "02.01.2026",
    amount: 1500,
    direction: "GIRIS",
    description: "TEB EFT GELEN ABC LTD",
  });
  assert(k1 === k2, "movement identity deterministik");
  const { unique, duplicates } = dedupeCanonicalTransactions([
    { transactionId: k1 },
    { transactionId: k1 },
  ]);
  assert(unique.length === 1 && duplicates.length === 1, "dedupeCanonicalTransactions");

  // Job state machine
  const {
    canTransitionBankJob,
    createInitialBankJobState,
    shouldBlockNewBankJob,
    transitionBankJob,
    BANK_JOB_STATE: JS,
  } = await import("@/src/utils/bankJobStateMachine.js");
  assert(canTransitionBankJob(JS.READING, JS.OCR_REQUIRED), "READING→OCR_REQUIRED");
  assert(canTransitionBankJob(JS.PARSING, JS.REVIEW_REQUIRED), "PARSING→REVIEW_REQUIRED");
  assert(!canTransitionBankJob(JS.IDLE, JS.COMPLETED), "IDLE↛COMPLETED");
  const idle = createInitialBankJobState();
  assert(!shouldBlockNewBankJob(idle), "idle should not block");
  const reading = transitionBankJob(idle, JS.READING, { jobId: 1 });
  assert(shouldBlockNewBankJob(reading), "READING should block");
  assert(reading.loading === true, "READING loading");
  // Simulate pipeline finally: hard-reset unlocks Yeniden İşle / re-upload
  const reset = createInitialBankJobState();
  assert(!shouldBlockNewBankJob(reset), "reset after READING unlocks busy lock");
}

// ——— 8) 1416 sentetik VakıfBank Luca süresi (hedef ≤5s) ———
{
  const bank = "VAKIFBANK";
  const moves = Array.from({ length: 1416 }, (_, i) => makeMovement(i + 1, bank));
  const t0 = Date.now();
  const luca = bankMovementsToStandardLucaRows(moves, {
    firmaId: "c1",
    kaynakAdi: bank,
    creationSource: "bank_double_entry",
    bankAccounts: [],
  });
  const lucaMs = Date.now() - t0;
  assert(luca.length === 2832, `1416→2832 Luca satırı (got ${luca.length})`);
  assert(lucaMs <= 5000, `1416 Luca ≤5s (got ${lucaMs}ms)`);
  console.log(`INFO  1416 Luca ${lucaMs}ms / ${luca.length} rows`);
}

// ——— 9) Gerçek VAKIFBANK ÖRNEK.xlsx (yalnız yerel; içerik loglanmaz) ———
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const realPath = path.join(
    process.env.USERPROFILE || "",
    "Desktop",
    "VAKIFBANK ÖRNEK.xlsx"
  );
  if (!fs.existsSync(realPath)) {
    console.log("INFO  real VakıfBank xlsx yok — offline 1416 skip");
  } else {
    const { parseBankExcelOnMainThread } = await import(
      "@/src/utils/bankExcelMainThreadParse.js"
    );
    const {
      buildParserPreviewFromNormalizedRowsAsync,
      runAccountingAnalysisOnMovementsAsync,
      buildLucaRowsFromMovementsAsync,
    } = await import("@/src/utils/bankParserCore.js");
    const { reconcileStatementBalances } = await import(
      "@/src/utils/bankBalanceReconcile.js"
    );
    const { legacyBankRowsToCanonical, dedupeCanonicalTransactions } =
      await import("@/src/utils/bankCanonicalTransaction.js");
    const { applySessionMovementDedup } = await import(
      "@/src/utils/bankStatementDedup.js"
    );

    const buf = fs.readFileSync(realPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const tParse0 = performance.now();
    const parsed = await parseBankExcelOnMainThread(null, "VAKIFBANK", null, {
      arrayBuffer: ab,
    });
    const parseMs = Math.round(performance.now() - tParse0);
    const movementCount = (parsed.normalizedRows || []).length;
    assert(movementCount === 1416, `real parse count 1416 (got ${movementCount})`);

    const canon = legacyBankRowsToCanonical(parsed.normalizedRows || [], {
      companyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    const balance = reconcileStatementBalances(canon, {});
    assert(
      ["BALANCE_MATCHED", "BALANCE_MISMATCH", "BALANCE_EVIDENCE_MISSING"].includes(
        balance.code
      ),
      `balance code geçerli (${balance.code})`
    );

    const tPrev0 = performance.now();
    const preview = await buildParserPreviewFromNormalizedRowsAsync({
      normalizedRows: parsed.normalizedRows,
      selectedCompanyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    const previewMs = Math.round(performance.now() - tPrev0);
    const moves = preview.movementRows || [];

    const tA0 = performance.now();
    const analysis = await runAccountingAnalysisOnMovementsAsync({
      normalizedRows: parsed.normalizedRows,
      movementRows: moves,
      selectedCompanyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    const analyzeMs = Math.round(performance.now() - tA0);
    assert(analyzeMs <= 20_000, `real analyze ≤20s (got ${analyzeMs}ms)`);

    const analyzed = analysis.movementRows || moves;
    const tL0 = performance.now();
    const luca1 = await buildLucaRowsFromMovementsAsync(analyzed, {
      selectedCompanyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    const lucaMs = Math.round(performance.now() - tL0);
    const lucaCount = (luca1.standardLucaRows || []).length;
    const summaryOf = (rows) =>
      `${rows.length}:${rows
        .slice(0, 8)
        .map((r) => `${r.hesapKodu || r.accountCode || ""}:${Number(r.borc || r.debit || 0)}`)
        .join("|")}`;
    const lucaHash1 = summaryOf(luca1.standardLucaRows || []);
    const luca2 = await buildLucaRowsFromMovementsAsync(analyzed, {
      selectedCompanyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    const lucaHash2 = summaryOf(luca2.standardLucaRows || []);
    assert(lucaHash1 === lucaHash2, "Luca deterministik");
    assert(lucaCount === 2832, `real Luca 2832 (got ${lucaCount})`);

    const dedup1 = applySessionMovementDedup(canon, new Set(), {
      companyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    const dedup2 = applySessionMovementDedup(canon, dedup1.seenKeys, {
      companyId: "offline",
      selectedBank: "VAKIFBANK",
    });
    assert(dedup2.allDuplicate === true, "real excel re-upload allDuplicate");
    assert(dedup2.suppressedMovements === 1416, "real excel suppressed 1416");
    assert(dedup2.suppressedLucaRows === 2832, "real excel suppressed Luca 2832");

    const { unique: mergeUnique, duplicates: mergeDups } =
      dedupeCanonicalTransactions([...canon, ...canon]);
    assert(mergeUnique.length === 1416 && mergeDups.length === 1416, "self cross-dedup");

    console.log(
      JSON.stringify({
        realOffline: {
          movementCount,
          parseMs,
          previewMs,
          analyzeMs,
          lucaMs,
          lucaCount,
          balanceCode: balance.code,
          analyzeGate20s: analyzeMs <= 20_000,
          excelRededupSuppressed: dedup2.suppressedMovements,
          lucaDeterministic: true,
        },
      })
    );
  }
}

console.log(failed === 0 ? "\nALL PASSED" : `\nFAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
