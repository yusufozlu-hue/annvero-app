/**
 * Luca REPEATED_JOURNAL_BLOCK yevmiye parser regressions.
 * Run: npm run test:luca-block-yevmiye-parser
 */
import fs from "node:fs";
import path from "node:path";
import {
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
  E_DEFTER_KAYNAK,
} from "@/src/config/eDefterKontrolDefaults.js";
import {
  analyzeEDefterRows,
  detectYevmiyeLayout,
  parseLucaRepeatedJournalBlockYevmiyeSheet,
  parseMuavinSheet,
  parseYevmiyeBlockHeaderCell,
  parseYevmiyeSheet,
  resolveVoucherCounterparts,
  YEVMIYE_LAYOUT,
} from "@/src/utils/eDefterKontrolEngine.js";
import {
  classifyLedgerDocumentType,
  GENEL_MUHASEBE_DOC_CLASS,
  reconcileMuavinYevmiye,
  runGenelMuhasebeKontrol,
} from "@/src/utils/genelMuhasebeKontrolEngine.js";
import { readSheetRowsFromArrayBuffer } from "@/src/utils/excelBufferUtils.js";
import {
  buildLucaBlockYevmiyeFixture,
  LUCA_BLOCK_YEVMIYE_ROWS,
} from "./fixtures/luca-block-yevmiye.mjs";
import {
  buildLucaMultiAccountMuavinFixture,
} from "./fixtures/luca-multi-account-muavin.mjs";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  } else {
    console.log(`PASS  ${msg}`);
  }
}

function assertThrows(fn, code, msg) {
  try {
    fn();
    failed += 1;
    console.error(`FAIL  ${msg} (expected ${code})`);
  } catch (err) {
    assert(err?.code === code, `${msg} → ${code}`);
  }
}

const fixture = buildLucaBlockYevmiyeFixture();

// 1 — layout detection (content-only, not file name)
{
  assert(
    detectYevmiyeLayout(fixture) === YEVMIYE_LAYOUT.REPEATED_JOURNAL_BLOCK,
    "layout REPEATED_JOURNAL_BLOCK"
  );
  assert(
    detectYevmiyeLayout([["TARİH", "FİŞ NO", "BORÇ", "ALACAK"]]) ===
      YEVMIYE_LAYOUT.UNKNOWN,
    "flat unknown layout"
  );
  assert(
    classifyLedgerDocumentType(fixture) === GENEL_MUHASEBE_DOC_CLASS.YEVMIYE,
    "classify YEVMIYE from structure"
  );
}

// 2 — block header parse + leading zeros
{
  const header = parseYevmiyeBlockHeaderCell("00001-----00001-----AÇILIŞ-----01/01/2026");
  assert(header?.fisNo === "00001", "header fisNo zeros");
  assert(header?.yevmiyeNo === "00001", "header yevmiyeNo zeros");
  assert(header?.fisTuru === "AÇILIŞ", "header fisTuru");
  assert(header?.tarihRaw === "01/01/2026", "header tarihRaw slash format");
  assert(header?.tarih === "01.01.2026", "header tarih DD/MM slash");
  const jan5 = parseYevmiyeBlockHeaderCell("00007-----00007-----MAHSUP-----05/01/2026");
  assert(jan5?.tarih === "05.01.2026", "05/01/2026 is Jan 5 not May 1");
}

// 3 — leaf movements only (4 rows, 2 fiş)
{
  const rows = parseLucaRepeatedJournalBlockYevmiyeSheet(fixture);
  assert(rows.length === 4, "fixture movement count");
  const fis = new Set(rows.map((r) => r.fisNo));
  assert(fis.size === 2, "fixture fis count");
  assert(rows.every((r) => r.kaynak === E_DEFTER_KAYNAK.YEVMIYE), "kaynak YEVMİYE");
  assert(rows.every((r) => String(r.hesapKodu || "").trim()), "no empty hesapKodu");
  const leak = rows.filter((r) =>
    /toplam|genel|hesap kodu|yevmiye/i.test(`${r.hesapKodu}${r.hesapAdi}${r.aciklama}`)
  );
  assert(leak.length === 0, "no header/total leak");
}

// 4 — borç/alacak from DETAY + side inheritance
{
  const rows = parseLucaRepeatedJournalBlockYevmiyeSheet(fixture);
  const kasa = rows.find((r) => r.hesapKodu === "100.01");
  const gelir = rows.find((r) => r.hesapKodu === "600.01");
  assert(kasa?.borc === 1000 && kasa?.alacak === 0, "DETAY borç side");
  assert(gelir?.borc === 0 && gelir?.alacak === 500, "DETAY alacak side");
  assert(kasa?.fisNo === "00001" && gelir?.fisNo === "00002", "fisNo propagated");
  assert(kasa?.tarih === "01.01.2026" && gelir?.tarih === "15.01.2026", "tarih propagated");
}

// 5 — parseYevmiyeSheet routes block layout
{
  const rows = parseYevmiyeSheet(fixture);
  assert(rows.length === 4, "parseYevmiyeSheet block rows");
}

// 6 — block layout with zero leaf movements
{
  const broken = [
    ["00001-----00001-----AÇILIŞ-----01/01/2026"],
    ["HESAP KODU", "HESAP ADI", "AÇIKLAMA", "DETAY", "BORÇ", "ALACAK"],
    ["100", "KASA", "", "", "1000", "0"],
    ["TOPLAM", "", "", "1000", "1000", "0"],
  ];
  const brokenRows = parseYevmiyeSheet(broken);
  assert(brokenRows.length === 0, "block layout zero leaf rows");
}

// 7 — fail-closed: selected yevmiye must not silently drop
{
  assertThrows(
    () =>
      runGenelMuhasebeKontrol({
        companyId: "anon",
        period: "2026/03",
        yevmiyeSheetRows: [["TARİH", "BORÇ", "ALACAK"], ["garbage", "1", "0"]],
      }),
    "UNSUPPORTED_YEVMIYE_LAYOUT",
    "GM unsupported yevmiye layout"
  );
  assertThrows(
    () =>
      runGenelMuhasebeKontrol({
        companyId: "anon",
        period: "2026/03",
        yevmiyeSheetRows: [
          ["00001-----00001-----AÇILIŞ-----01/01/2026"],
          ["HESAP KODU", "HESAP ADI", "AÇIKLAMA", "DETAY", "BORÇ", "ALACAK"],
          ["TOPLAM", "", "", "0", "0", "0"],
        ],
      }),
    "EMPTY_YEVMIYE_PARSE",
    "GM empty yevmiye parse"
  );
}

// 8 — yevmiye evidence + cumulative period Q1
{
  const result = runGenelMuhasebeKontrol({
    companyId: "anon",
    period: "2026/03",
    yevmiyeSheetRows: fixture,
    accountPlanAccounts: [{ account_code: "100.01" }, { account_code: "500.01" }],
    accountPlanStatus: "loaded",
  });
  assert(result.summary.yevmiyeEvidence === "PRESENT", "yevmiye evidence present");
  assert(result.summary.yevmiyeHareketSatir === 4, "summary yevmiye hareket");
  assert(result.summary.yevmiyeFis === 2, "summary yevmiye fiş");
  assert(result.summary.toplamSatir === 4, "analysis uses yevmiye rows");
  assert(result.counters.persistInvocations === 0, "persist=0");
  const oop = result.rows.filter((r) =>
    (r.issueDetails || []).some((i) => i.code === E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD)
  );
  assert(oop.length === 0, "Q1 yevmiye not DATE_OUT_OF_PERIOD for 2026/03");
}

// 9 — yevmiye counterparts preferred over muavin-only guess
{
  const rows = parseYevmiyeSheet(fixture);
  const analyzed = analyzeEDefterRows(rows, {
    expectedPeriod: "2026/03",
    cumulativePeriod: true,
    yevmiyeEvidencePresent: true,
  });
  const map = resolveVoucherCounterparts(
    analyzed.map((r) => ({ ...r, kaynak: E_DEFTER_KAYNAK.YEVMIYE }))
  );
  const opening = analyzed.filter((r) => r.fisNo === "00001");
  const resolved = opening.filter((r) => {
    const c = map.get(r.id);
    return c?.counterAccountCode || c?.karsiHesapKodu;
  });
  assert(resolved.length >= 2, "yevmiye opening voucher counterparts from fiş legs");
}

// 10 — muavin↔yevmiye reconcile reports gaps, not raw count as error
{
  const muavin = buildLucaMultiAccountMuavinFixture();
  const rec = reconcileMuavinYevmiye({
    muavinRows: parseMuavinSheet(muavin),
    yevmiyeRows: parseYevmiyeSheet(fixture),
  });
  assert(rec.muavinMovements === 5, "reconcile muavin movement count");
  assert(rec.yevmiyeMovements === 4, "reconcile yevmiye movement count");
  assert(rec.status === "MISMATCH" || rec.status === "MATCHED", "reconcile status emitted");
  assert(Array.isArray(rec.differences), "differences array present");
  const combo = runGenelMuhasebeKontrol({
    companyId: "anon",
    period: "2026/03",
    muavinSheetRows: muavin,
    yevmiyeSheetRows: fixture,
  });
  assert(combo.summary.muavinHareketSatir === 5, "muavin still parsed alongside yevmiye");
  assert(combo.summary.yevmiyeHareketSatir === 4, "yevmiye parsed alongside muavin");
  assert(combo.summary.muavinYevmiye?.status !== undefined, "muavin↔yevmiye summary emitted");
  assert(
    combo.summary.muavinYevmiye.userLabel.includes("eşleşti") ||
      combo.summary.muavinYevmiye.userLabel.includes("Karşılaştırılamadı"),
    "userLabel readable"
  );
}

// 10b — full match UI label + no MUAVIN_YEVMIYE warning
{
  const yev = parseYevmiyeSheet(fixture);
  const twin = yev.map((row) => ({
    ...row,
    id: `muavin-twin-${row.id}`,
    kaynak: E_DEFTER_KAYNAK.MUAVIN,
  }));
  const rec = reconcileMuavinYevmiye({ muavinRows: twin, yevmiyeRows: yev });
  assert(rec.matched === true, "full match");
  assert(rec.matchedCount === 4 && rec.denominator === 4, "545-style 4/4 counts");
  assert(rec.userLabel == null, "raw reconcile has message not userLabel");
  assert(rec.message === "Tam eşleşti (4/4)", "full match message");
  assert(rec.differences.length === 0, "no diffs on full match");

  // Engine path with identical sides via sheet: build matching muavin from yev rows is hard;
  // assert finding code presence only on mismatch path below.
}

// 10c — mismatch findings searchable as MUAVIN_YEVMIYE_MISMATCH, no double-count
{
  const muavinSheet = [
    ["102.01.001 ANON BANKA"],
    ["TARİH", "TİP", "FİŞ NO", "AÇIKLAMA", "BORÇ", "ALACAK", "BAKİYE", "B/A"],
    ["01.01.2026", "AÇ", "00001", "Açılış", 1000, 0, 1000, "B"],
    ["15.01.2026", "FT", "00002", "Hareket", 0, 250, 750, "B"],
  ];
  const yevSheet = [
    ["00001-----00001-----AÇILIŞ-----01/01/2026"],
    ["HESAP KODU", "HESAP ADI", "AÇIKLAMA", "DETAY", "BORÇ", "ALACAK"],
    ["100", "KASA", "", "", "1000", "0"],
    [" 100.01", "Kasa TL", "Açılış", "1000", "", ""],
    ["500", "SERMAYE", "", "", "0", "1000"],
    [" 500.01", "Sermaye", "Açılış", "1000", "", ""],
    ["00002-----00002-----MAHSUP-----15/01/2026"],
    ["HESAP KODU", "HESAP ADI", "AÇIKLAMA", "DETAY", "BORÇ", "ALACAK"],
    ["320", "ALACAKLAR", "", "", "500", "0"],
    [" 320.01", "Cari", "Satış", "500", "", ""],
    ["600", "GELİR", "", "", "0", "500"],
    [" 600.01", "Gelir", "Satış", "500", "", ""],
  ];
  const result = runGenelMuhasebeKontrol({
    companyId: "anon",
    period: "2026/03",
    muavinSheetRows: muavinSheet,
    yevmiyeSheetRows: yevSheet,
  });
  const my = result.summary.muavinYevmiye;
  assert(my.status === "MISMATCH", "10c mismatch status");
  assert(typeof my.matchedCount === "number" && my.denominator === 4, "10c denominator from yev");
  assert(my.userLabel === `${my.matchedCount}/${my.denominator} eşleşti`, "10c userLabel pattern");
  assert(my.differences.length === my.counts.total, "10c counts.total == differences");
  const fingerprint = new Set(
    my.differences.map(
      (d) =>
        `${d.status}|${d.fisNo}|${d.tarih}|${d.hesapKodu}|${d.muavin?.borc}|${d.muavin?.alacak}|${d.yevmiye?.borc}|${d.yevmiye?.alacak}`
    )
  );
  assert(fingerprint.size === my.differences.length, "10c no duplicate diff fingerprints");
  const mismatchFindings = (result.findingExtras || []).filter(
    (f) => f.code === E_DEFTER_ISSUE_CODE.MUAVIN_YEVMIYE_MISMATCH
  );
  assert(mismatchFindings.length >= 1 + my.differences.length, "10c findings include details");
  assert(
    mismatchFindings.some((f) => f.severity === E_DEFTER_ISSUE_SEVERITY.UYARI),
    "10c summary uyarı present"
  );
  // Opaque warning without details must not happen
  assert(my.differences.length > 0, "10c no bare warning without details");
  assert(result.counters.persistInvocations === 0, "10c persist=0");
}

// 10d — amount soft-diff classified once (no double only-side)
{
  const muavinRows = [
    {
      fisNo: "00001",
      tarih: "01.01.2026",
      hesapKodu: "100.01",
      borc: 100,
      alacak: 0,
    },
  ];
  const yevmiyeRows = [
    {
      fisNo: "00001",
      tarih: "01.01.2026",
      hesapKodu: "100.01",
      borc: 120,
      alacak: 0,
    },
  ];
  const rec = reconcileMuavinYevmiye({ muavinRows, yevmiyeRows });
  assert(rec.counts.amountDiff === 1, "10d amountDiff=1");
  assert(rec.counts.onlyMuavin === 0 && rec.counts.onlyYevmiye === 0, "10d not double-counted alone");
  assert(rec.differences.length === 1, "10d single difference");
  assert(rec.differences[0].statusLabel === "Tutar farklı", "10d label");
}

// 11 — muavin-only regression preserved
{
  const muavin = buildLucaMultiAccountMuavinFixture();
  const only = runGenelMuhasebeKontrol({
    companyId: "luca-co",
    period: "2026/03",
    muavinSheetRows: muavin,
    accountPlanAccounts: [{ account_code: "102.01.012" }],
    accountPlanStatus: "loaded",
  });
  assert(only.summary.yevmiyeEvidence === "MISSING", "muavin-only no yevmiye evidence");
  assert(only.summary.toplamSatir === 5, "muavin-only five movements");
}

// 12 — main-thread idempotent parity (worker uses same motor)
{
  const input = {
    companyId: "anon",
    period: "2026/03",
    yevmiyeSheetRows: LUCA_BLOCK_YEVMIYE_ROWS,
    accountPlanAccounts: [{ account_code: "100.01" }],
    accountPlanStatus: "loaded",
  };
  const a = runGenelMuhasebeKontrol({ ...input, spies: { parseInvocations: 0, analysisInvocations: 0, persistInvocations: 0 } });
  const b = runGenelMuhasebeKontrol({ ...input, spies: { parseInvocations: 0, analysisInvocations: 0, persistInvocations: 0 } });
  assert(a.summary.yevmiyeHareketSatir === b.summary.yevmiyeHareketSatir, "engine parity row count");
  assert(
    JSON.stringify(a.summary) === JSON.stringify(b.summary),
    "engine parity summary"
  );
}

// 13 — optional real-file smoke (never committed; skip when absent)
{
  const realPath =
    process.env.LUCA_YEVMIYE_SMOKE ||
    path.join(process.env.USERPROFILE || "", "Desktop", "yevmiye_defteri_mare.xlsx");
  if (!fs.existsSync(realPath)) {
    console.log("SKIP  real-file smoke (yevmiye_defteri_mare.xlsx not on Desktop)");
  } else {
    const buf = fs.readFileSync(realPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const sheet = readSheetRowsFromArrayBuffer(ab);
    const rows = parseYevmiyeSheet(sheet);
    const fis = new Set(rows.map((r) => r.fisNo));
    const empty = rows.filter((r) => !String(r.hesapKodu || "").trim()).length;
    const analyzed = analyzeEDefterRows(rows, {
      expectedPeriod: "2026/03",
      cumulativePeriod: true,
      yevmiyeEvidencePresent: true,
    });
    const dup = analyzed.filter((r) =>
      (r.issueDetails || []).some((i) => i.code === E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY)
    ).length;
    const oop = analyzed.filter((r) =>
      (r.issueDetails || []).some((i) => i.code === E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD)
    ).length;
    const leak = rows.filter((r) =>
      /toplam|hesap kodu|yevmiye defteri|genel toplam/i.test(
        `${r.hesapKodu}${r.hesapAdi}${r.aciklama}`
      )
    ).length;
    assert(rows.length === 545, "real smoke yevmiye hareket (545 = muavin parity)");
    assert(fis.size === 115, "real smoke yevmiye fiş");
    assert(empty === 0, "real smoke empty hesapKodu");
    assert(leak === 0, "real smoke header/total leak");
    assert(oop === 0, "real smoke dönem dışı");
    assert(dup === 0, "real smoke duplicate");

    const muavinPath = path.join(
      process.env.USERPROFILE || "",
      "Desktop",
      "muavin_mare.xlsx"
    );
    if (fs.existsSync(muavinPath)) {
      const mBuf = fs.readFileSync(muavinPath);
      const mAb = mBuf.buffer.slice(mBuf.byteOffset, mBuf.byteOffset + mBuf.byteLength);
      const mSheet = readSheetRowsFromArrayBuffer(mAb);
      const combo = runGenelMuhasebeKontrol({
        companyId: "mare",
        period: "2026/03",
        muavinSheetRows: mSheet,
        yevmiyeSheetRows: sheet,
        accountPlanAccounts: [],
        accountPlanStatus: "missing",
      });
      const my = combo.summary.muavinYevmiye;
      assert(my.matchedCount === 517, "real smoke matched 517");
      assert(my.denominator === 545, "real smoke denom 545");
      assert(my.userLabel === "517/545 eşleşti", "real smoke userLabel");
      assert(my.counts.onlyMuavin === 28, "real smoke onlyMuavin 28");
      assert(my.counts.onlyYevmiye === 28, "real smoke onlyYevmiye 28");
      assert(my.counts.amountDiff === 0, "real smoke amountDiff 0");
      assert(my.counts.dateDiff === 0, "real smoke dateDiff 0");
      assert(my.counts.fisDiff === 0, "real smoke fisDiff 0");
      assert(my.differences.length === 56, "real smoke 56 alone-side diffs");
      assert(
        (combo.findingExtras || []).some(
          (f) => f.code === E_DEFTER_ISSUE_CODE.MUAVIN_YEVMIYE_MISMATCH
        ),
        "real smoke MUAVIN_YEVMIYE_MISMATCH findings"
      );
      assert(combo.counters.persistInvocations === 0, "real smoke persist=0");
    }
  }
}

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll luca block yevmiye parser tests passed.");
