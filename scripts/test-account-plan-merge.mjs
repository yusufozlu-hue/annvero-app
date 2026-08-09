/**
 * Resolution Center plan araması — accountCode birleşimi.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-account-plan-merge.mjs
 */
import assert from "node:assert/strict";
import { mergeAccountPlanRows } from "@/src/utils/accountPlanMerge.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("keeps API camelCase accountCode rows (was dropped by account_code-only merge)", () => {
  const merged = mergeAccountPlanRows(
    [{ accountCode: "9.00642", accountName: "Staging Seed Hesap 642", isActive: true }],
    [{ accountCode: "120.01.001", accountName: "Alıcı A", isActive: true }]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].accountCode, "9.00642");
  assert.equal(merged[1].accountCode, "120.01.001");
});

test("accepts snake_case and legacy code aliases", () => {
  const merged = mergeAccountPlanRows(
    [{ account_code: "320.01", accountName: "Satıcı" }],
    [{ code: "102.01", name: "Banka" }, { hesapKodu: "642.01", hesapAdi: "Faiz" }]
  );
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((r) => r.account_code || r.code || r.hesapKodu).sort(),
    ["102.01", "320.01", "642.01"]
  );
});

test("dedupes by code preferring first occurrence", () => {
  const merged = mergeAccountPlanRows(
    [{ accountCode: "120.01", accountName: "Local" }],
    [{ accountCode: "120.01", accountName: "Server" }]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].accountName, "Local");
});

console.log("OK account-plan-merge");
