/**
 * Fixture rehearsal for AYSU-like duplicate merge (no production writes).
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-company-duplicate-merge.mjs
 */
import assert from "node:assert/strict";
import {
  areClearlyDistinctLegalEntities,
  buildAmbiguousSameNameCompanyIdSet,
  findActiveCompanyWithSameVkn,
  formatCompanyDisplayName,
  isValidVkn,
} from "@/src/utils/companyIdentity.js";
import {
  choosePrimaryCompany,
  classifyDuplicatePair,
  rehearseCompanyMerge,
  relatedDataWeight,
} from "@/src/utils/companyDuplicateMerge.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test("identity: distinct VKN → case A", () => {
  const a = { id: "1", data: { taxNumber: "1111111111" } };
  const b = { id: "2", data: { taxNumber: "2222222222" } };
  assert.equal(areClearlyDistinctLegalEntities(a, b), true);
  assert.equal(classifyDuplicatePair(a, b).decision, "A");
});

test("identity: same VKN → case B", () => {
  const a = {
    id: "f672",
    company_id: "f672",
    created_at: "2026-06-26T08:43:45Z",
    data: { taxNumber: "1234562045", isActive: true },
    json_counts: {},
    related_total: 1,
    has_drive_binding: false,
  };
  const b = {
    id: "e878",
    company_id: "e878",
    created_at: "2026-06-27T10:09:03Z",
    data: {
      taxNumber: "1234562045",
      isActive: true,
      bankAccounts: [{}],
      creditCards: [{}],
      employees: [{}],
      vehicles: [{}],
      documentSeriesRules: [{}, {}],
      contacts: [{}],
    },
    json_counts: {
      bankAccounts: 1,
      creditCards: 1,
      employees: 1,
      vehicles: 1,
      documentSeriesRules: 2,
      contacts: 1,
    },
    related_total: 0,
    has_drive_binding: false,
  };
  assert.equal(classifyDuplicatePair(a, b).decision, "B");
  assert.ok(relatedDataWeight(b) > relatedDataWeight(a));
  const primary = choosePrimaryCompany(a, b);
  assert.equal(primary.company_id, "e878");
});

test("display: VKN son 4 hane disambiguator", () => {
  const peers = [
    {
      id: "a",
      company_name: "AYSU DIŞ TİCARET VE YAPI SANAYİ A.Ş",
      data: { taxNumber: "1111111111", isActive: true },
    },
    {
      id: "b",
      company_name: "AYSU DIŞ TİCARET VE YAPI SANAYİ A.Ş",
      data: { taxNumber: "2222222222", isActive: true },
    },
  ];
  const name = formatCompanyDisplayName(peers[0], peers);
  assert.match(name, /VKN son 4 hane 1111/);
});

test("active VKN conflict finder", () => {
  const companies = [
    { id: "a", data: { taxNumber: "1111111111", isActive: true } },
    { id: "b", data: { taxNumber: "1111111111", isActive: false } },
  ];
  assert.ok(findActiveCompanyWithSameVkn(companies, "1111111111", "x"));
  assert.equal(
    findActiveCompanyWithSameVkn(companies, "1111111111", "a"),
    null
  );
  assert.equal(isValidVkn("123"), false);
});

test("ambiguous set ignores inactive / duplicate_of peers", () => {
  const set = buildAmbiguousSameNameCompanyIdSet([
    {
      id: "active",
      company_name: "AYSU",
      data: { taxNumber: "1234562045", isActive: true },
    },
    {
      id: "dup",
      company_name: "AYSU",
      data: {
        taxNumber: "1234562045",
        isActive: false,
        duplicate_of: "active",
      },
    },
  ]);
  assert.equal(set.size, 0);
});

test("ambiguous set ignores distinct VKN peers", () => {
  const set = buildAmbiguousSameNameCompanyIdSet([
    {
      id: "a",
      company_name: "AYSU",
      data: { taxNumber: "1111111111" },
    },
    {
      id: "b",
      company_name: "aysu",
      data: { taxNumber: "2222222222" },
    },
  ]);
  assert.equal(set.size, 0);
});

test("merge rehearsal: soft-deactivate + move counts", () => {
  const plan = rehearseCompanyMerge({
    primary: {
      id: "e878",
      data: {
        companyName: "AYSU",
        taxNumber: "1234562045",
        bankAccounts: [{ id: "1" }],
        isActive: true,
      },
    },
    duplicate: {
      id: "f672",
      data: {
        companyName: "AYSU",
        taxNumber: "1234562045",
        isActive: true,
      },
    },
    relatedMoves: { learning_memory: ["row-1"] },
  });
  assert.equal(plan.primaryId, "e878");
  assert.equal(plan.duplicateData.isActive, false);
  assert.equal(plan.duplicateData.duplicate_of, "e878");
  assert.equal(plan.moved.learning_memory, 1);
  assert.equal(plan.driveNote.action, "ensure_primary_tree");
});

test("merge rehearsal: two Drive roots kept", () => {
  const plan = rehearseCompanyMerge({
    primary: { id: "p", data: {} },
    duplicate: { id: "d", data: {} },
    primaryFolder: { root_folder_id: "root-a" },
    duplicateFolder: { root_folder_id: "root-b" },
  });
  assert.equal(plan.driveNote.action, "keep_both_roots");
  assert.equal(plan.driveNote.secondary, "inceleme_bekleyen_eski_kok");
});

console.log("done");
