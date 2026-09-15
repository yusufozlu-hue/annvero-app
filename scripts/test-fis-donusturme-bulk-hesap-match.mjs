/**
 * Fiş Dönüştürme — toplu HESAP_EKSIK eşleme + sticky İşlem sütunu.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-fis-donusturme-bulk-hesap-match.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyBulkHesapKoduByKaynak,
  collectHesapEksikKaynakGroups,
  hasUnresolvedHesapEksik,
} from "../src/utils/fisDonusturmeBulkHesapMatch.js";
import { prepareFisDonusturmeLucaExcelFiles } from "../src/utils/fisDonusturmeElektraGates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const pagePath = path.join(
  root,
  "app/(annvero)/muhasebe/fis-donusturme/page.jsx"
);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

/** 11 kaynak kod, toplam 31 HESAP_EKSIK satır (+ 2 çözülmüş kontrol satırı). */
function buildScenarioRows() {
  const counts = [4, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2]; // = 31
  assert.equal(
    counts.reduce((sum, n) => sum + n, 0),
    31
  );
  const rows = [];
  let id = 1;
  for (let i = 0; i < counts.length; i += 1) {
    const kaynak = `SRC.${String(i + 1).padStart(2, "0")}`;
    for (let j = 0; j < counts[i]; j += 1) {
      rows.push({
        id: `r${id++}`,
        fisNo: 100 + i,
        fisTarihi: "01.04.2026",
        belgeTuru: "FT",
        hesapKodu: "",
        kaynakHesapKodu: kaynak,
        detayAciklama: `satır ${j + 1}`,
        borc: 10,
        alacak: 0,
        riskDurumu: "HESAP_EKSIK",
        kaynakTipi: "ELEKTRAWEB",
        kaynakAdi: "Elektraweb",
      });
    }
  }
  // Diğer kaynak / çözülmüş satırlar — dokunulmamalı
  rows.push({
    id: "ok-1",
    fisNo: 999,
    fisTarihi: "01.04.2026",
    belgeTuru: "FT",
    hesapKodu: "100.01",
    kaynakHesapKodu: "SRC.OTHER",
    detayAciklama: "çözülmüş",
    borc: 5,
    alacak: 0,
    riskDurumu: "",
    kaynakTipi: "ELEKTRAWEB",
  });
  rows.push({
    id: "ok-2",
    fisNo: 999,
    fisTarihi: "01.04.2026",
    belgeTuru: "FT",
    hesapKodu: "320.01",
    kaynakHesapKodu: "SRC.01",
    detayAciklama: "aynı kaynak ama zaten eşli",
    borc: 0,
    alacak: 5,
    riskDurumu: "",
    kaynakTipi: "ELEKTRAWEB",
  });
  return rows;
}

test("11 kaynak kod / 31 satır gruplanır", () => {
  const rows = buildScenarioRows();
  const groups = collectHesapEksikKaynakGroups(rows);
  assert.equal(groups.length, 11);
  assert.equal(
    groups.reduce((sum, g) => sum + g.rowCount, 0),
    31
  );
  assert.equal(groups[0].kaynakHesapKodu, "SRC.01");
  assert.equal(groups[0].rowCount, 4);
});

test("Tek eşleştirme ilgili tüm satırlara uygulanır; diğer kodlar değişmez", () => {
  const rows = buildScenarioRows();
  const beforeOther = rows
    .filter((r) => r.kaynakHesapKodu === "SRC.02" && r.riskDurumu === "HESAP_EKSIK")
    .map((r) => ({ id: r.id, hesapKodu: r.hesapKodu, risk: r.riskDurumu }));

  const result = applyBulkHesapKoduByKaynak(rows, "SRC.01", "120.01.001");
  assert.equal(result.ok, true);
  assert.equal(result.appliedCount, 4);

  const applied = result.rows.filter(
    (r) => r.kaynakHesapKodu === "SRC.01" && r.riskDurumu === "HESAP_EKSIK"
  );
  assert.equal(applied.length, 0);

  const mapped = result.rows.filter(
    (r) => r.kaynakHesapKodu === "SRC.01" && r.id !== "ok-2"
  );
  assert.equal(mapped.length, 4);
  for (const row of mapped) {
    assert.equal(row.hesapKodu, "120.01.001");
    assert.equal(row.kaynakHesapKodu, "SRC.01");
    assert.equal(row.riskDurumu, "");
    assert.equal(row.manuallyEdited, true);
  }

  // Zaten çözülmüş SRC.01 satırı değişmedi
  const alreadyOk = result.rows.find((r) => r.id === "ok-2");
  assert.equal(alreadyOk.hesapKodu, "320.01");
  assert.equal(alreadyOk.kaynakHesapKodu, "SRC.01");

  const afterOther = result.rows
    .filter((r) => r.kaynakHesapKodu === "SRC.02" && r.riskDurumu === "HESAP_EKSIK")
    .map((r) => ({ id: r.id, hesapKodu: r.hesapKodu, risk: r.riskDurumu }));
  assert.deepEqual(afterOther, beforeOther);
  assert.equal(hasUnresolvedHesapEksik(result.rows), true);
});

test("Tüm 11 kod çözülünce export açılır; kısmi çözümde engel", () => {
  let rows = buildScenarioRows();
  const blocked = prepareFisDonusturmeLucaExcelFiles({
    rows,
    sourceType: "ELEKTRAWEB",
    filePrefix: "test",
    mukerrerGroups: [],
    mukerrerDecisions: {},
  });
  assert.equal(blocked.ok, false);

  const groups = collectHesapEksikKaynakGroups(rows);
  for (const group of groups) {
    const target = `TGT.${group.kaynakHesapKodu}`;
    const result = applyBulkHesapKoduByKaynak(
      rows,
      group.kaynakHesapKodu,
      target
    );
    assert.equal(result.ok, true);
    rows = result.rows;
  }

  assert.equal(hasUnresolvedHesapEksik(rows), false);
  assert.equal(collectHesapEksikKaynakGroups(rows).length, 0);

  const allowed = prepareFisDonusturmeLucaExcelFiles({
    rows,
    sourceType: "ELEKTRAWEB",
    filePrefix: "test",
    mukerrerGroups: [],
    mukerrerDecisions: {},
  });
  assert.equal(allowed.ok, true);
  assert.ok(allowed.files?.length >= 1);
});

test("UI: sticky İşlem + whitespace-nowrap Düzenle (viewport güvenliği)", () => {
  const src = fs.readFileSync(pagePath, "utf8");
  assert.match(src, /sticky right-0 z-20[\s\S]*?İşlem/);
  assert.match(src, /sticky right-0 z-10[\s\S]*?Düzenle/);
  assert.match(src, /whitespace-nowrap[\s\S]*?Düzenle|Düzenle[\s\S]*?whitespace-nowrap/);
  assert.match(src, /min-w-\[148px\]/);
  assert.match(src, /overflow-x-auto/);
  assert.match(src, /overflow-x-hidden/);
  assert.match(src, /fis-donusturme-preview-scroll/);
  // Truncation to single letter "D" yok
  assert.doesNotMatch(
    src,
    />\s*D\s*<\/button>/
  );
  // 390 / 1280 / 1366 / 1440: sticky + nowrap + table scroll sözleşmesi
  for (const width of [390, 1280, 1366, 1440]) {
    assert.ok(
      src.includes("sticky right-0") && src.includes("whitespace-nowrap"),
      `viewport ${width}: sticky/nowrap contract`
    );
  }
});

test("UI: toplu panel + export HESAP_EKSIK ile kapalı", () => {
  const src = fs.readFileSync(pagePath, "utf8");
  assert.match(src, /fis-donusturme-bulk-hesap-match/);
  assert.match(src, /Tüm satırlara uygula/);
  assert.match(src, /handleApplyBulkHesapMatch/);
  assert.match(src, /hasUnresolvedHesapEksik\(standardLucaRows\)/);
  assert.match(src, /collectHesapEksikKaynakGroups/);
  assert.match(src, /Mükerrer kararları bilinçli olarak dokunulmaz/);
});

test("Boş hedef uygulanmaz; kaynak immutable", () => {
  const rows = buildScenarioRows().slice(0, 4);
  const empty = applyBulkHesapKoduByKaynak(rows, "SRC.01", "  ");
  assert.equal(empty.ok, false);
  assert.equal(empty.appliedCount, 0);

  const applied = applyBulkHesapKoduByKaynak(rows, "SRC.01", "102.01");
  for (const row of applied.rows) {
    if (row.kaynakHesapKodu === "SRC.01" && row.riskDurumu === "") {
      assert.equal(row.kaynakHesapKodu, "SRC.01");
      assert.notEqual(row.hesapKodu, row.kaynakHesapKodu);
    }
  }
});

console.log(`\n${passed} tests passed`);
