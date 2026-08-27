/**
 * Luca REPEATED_JOURNAL_BLOCK yevmiye parser regressions.
 * Run: npm run test:luca-block-yevmiye-parser
 */
import fs from "node:fs";
import path from "node:path";
import {
  E_DEFTER_ISSUE_CODE,
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
  const combo = runGenelMuhasebeKontrol({
    companyId: "anon",
    period: "2026/03",
    muavinSheetRows: muavin,
    yevmiyeSheetRows: fixture,
  });
  assert(combo.summary.muavinHareketSatir === 5, "muavin still parsed alongside yevmiye");
  assert(combo.summary.yevmiyeHareketSatir === 4, "yevmiye parsed alongside muavin");
  assert(combo.summary.muavinYevmiye?.status !== undefined, "muavin↔yevmiye summary emitted");
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
  }
}

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll luca block yevmiye parser tests passed.");
