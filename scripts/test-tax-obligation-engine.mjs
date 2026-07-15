/**
 * Mali Yükümlülük Merkezi V1 — unit tests
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-tax-obligation-engine.mjs
 */
import assert from "node:assert/strict";
import {
  OBLIGATION_TYPE,
  DOCUMENT_TYPE,
  REVISION_TYPE,
  LINE_TYPE,
  ACCOUNTING_ROLE,
  MATCH_STATUS,
  PAYMENT_SCENARIO,
  MAPPING_STATUS,
  buildObligationAccrual,
  buildObligationAccrualLine,
  buildObligationChainKey,
  resolveSgkAccountingRole,
  resolveSgkMappedAccount,
  applySgkLineMapping,
  decideAccrualMatch,
  proposeMultiAccrualAllocation,
  proposeMultiPaymentCoverage,
  classifyPaymentScenario,
  buildDistributionLegs,
  parseObligationDocument,
  upsertObligationAccrual,
  hashUtf8String,
  classifyObligationPayment,
  buildTaxObligationResolutionGroups,
} from "@/src/utils/taxObligation/index.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const companyMaps = {
  sgkMainAccount: "361.01.001",
  unemploymentAccount: "361.01.002",
  sgdpAccount: "361.03.001",
  sgkIncentiveIncomeAccount: "602.01.010",
  extraMappings: [
    { id: "UCRET_STOPAJ", label: "Ücret stopaj", lucaAccountCode: "360.01.001" },
    { id: "KIRA_STOPAJ", label: "Kira stopaj", lucaAccountCode: "360.01.003" },
    { id: "DAMGA_VERGISI", label: "Damga", lucaAccountCode: "360.01.002" },
    { id: "KDV2_TEVKIFAT", label: "KDV2", lucaAccountCode: "360.01.011" },
  ],
};

test("1) MUHSGK çoklu 360/361 dağılımı", () => {
  const accrual = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.MUHSGK,
    period_key: "2026-01",
    lines: [
      {
        description: "Ücret gelir vergisi",
        principal_amount: 10000,
        accounting_role: ACCOUNTING_ROLE.UCRET_STOPAJ,
        mapped_account_code: "360.01.001",
      },
      {
        description: "Kira stopajı",
        principal_amount: 3000,
        accounting_role: ACCOUNTING_ROLE.KIRA_STOPAJ,
        mapped_account_code: "360.01.003",
      },
      {
        description: "Damga vergisi",
        principal_amount: 200,
        line_type: LINE_TYPE.STAMP_TAX,
        accounting_role: ACCOUNTING_ROLE.DAMGA_VERGISI,
        mapped_account_code: "360.01.002",
      },
      {
        description: "SGK primi",
        principal_amount: 5000,
        accounting_role: ACCOUNTING_ROLE.SGK_NORMAL,
        mapped_account_code: "361.01.001",
      },
    ],
  });
  const dist = buildDistributionLegs({
    accrual,
    bankAmount: 18200,
    bankAccountCode: "102.01",
    taxSgkAccountMappings: companyMaps,
  });
  const codes = dist.legs.filter((l) => l.side === "BORC").map((l) => l.accountCode);
  assert.ok(codes.includes("360.01.001"));
  assert.ok(codes.includes("360.01.003"));
  assert.ok(codes.includes("361.01.001"));
  assert.equal(codes.includes("360"), false);
  assert.ok(dist.balanced);
});

test("2) KDV2 çoklu 360 dağılımı", () => {
  const accrual = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.KDV2,
    period_key: "2026-02",
    lines: [
      {
        description: "Tevkifat A",
        principal_amount: 4000,
        accounting_role: ACCOUNTING_ROLE.KDV2_TEVKIFAT,
        mapped_account_code: "360.01.011",
      },
      {
        description: "Tevkifat B",
        principal_amount: 1500,
        accounting_role: ACCOUNTING_ROLE.KDV2_TEVKIFAT,
        mapped_account_code: "360.01.012",
      },
    ],
  });
  const dist = buildDistributionLegs({
    accrual,
    bankAmount: 5500,
    bankAccountCode: "102.01",
  });
  assert.equal(dist.legs.filter((l) => l.side === "BORC").length, 2);
  assert.ok(dist.balanced);
});

test("3-5) 5510 / 6661 / 14857 → normal SGK hesabı", () => {
  for (const law of ["5510", "6661", "14857"]) {
    const role = resolveSgkAccountingRole({ lawCode: law, description: "Normal" });
    assert.equal(role, ACCOUNTING_ROLE.SGK_NORMAL);
    const mapped = resolveSgkMappedAccount({
      accountingRole: role,
      taxSgkAccountMappings: companyMaps,
    });
    assert.equal(mapped.mapped_account_code, "361.01.001");
  }
});

test("6) SGDP → ayrı SGDP hesabı", () => {
  const role = resolveSgkAccountingRole({
    lawCode: "",
    description: "SGDP emekli destek primi",
  });
  assert.equal(role, ACCOUNTING_ROLE.SGDP);
  const mapped = resolveSgkMappedAccount({
    accountingRole: role,
    taxSgkAccountMappings: companyMaps,
  });
  assert.equal(mapped.mapped_account_code, "361.03.001");
});

test("7) Aynı ay birden fazla SGK tahakkuku", () => {
  const a = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.SGK,
    period_key: "2026-03",
    accrual_number: "T-5510",
    revision_no: 0,
    lines: [
      buildObligationAccrualLine({
        law_code: "5510",
        principal_amount: 8000,
        description: "5510",
      }),
    ],
  });
  const b = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.SGK,
    period_key: "2026-03",
    accrual_number: "T-6661",
    revision_no: 0,
    lines: [
      buildObligationAccrualLine({
        law_code: "6661",
        principal_amount: 2000,
        description: "6661",
      }),
    ],
  });
  assert.notEqual(a.id, b.id);
  const d1 = decideAccrualMatch([a, b], {
    companyId: "c1",
    obligationType: "SGK",
    accrualNumber: "T-6661",
    amount: 2000,
    periodKey: "2026-03",
  });
  assert.equal(d1.autoApply, true);
  assert.equal(d1.selected.accrual_number, "T-6661");
});

test("8-9) Normal + düzeltme zinciri; Düzeltme-01 + 02", () => {
  const n = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.MUHSGK,
    period_key: "2026-01",
    revision_type: REVISION_TYPE.NORMAL,
    revision_no: 0,
    document_type: DOCUMENT_TYPE.TAHAKKUK,
    lines: [{ principal_amount: 10000, description: "asıl" }],
  });
  const d1 = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.MUHSGK,
    period_key: "2026-01",
    revision_type: REVISION_TYPE.DUZELTME,
    revision_no: 1,
    document_type: DOCUMENT_TYPE.TAHAKKUK,
    lines: [{ principal_amount: 12000, description: "düzeltme 01" }],
  });
  const d2 = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.MUHSGK,
    period_key: "2026-01",
    revision_type: REVISION_TYPE.DUZELTME,
    revision_no: 2,
    document_type: DOCUMENT_TYPE.TAHAKKUK,
    lines: [{ principal_amount: 11500, description: "düzeltme 02" }],
  });
  assert.notEqual(n.chain_key, d1.chain_key);
  assert.notEqual(d1.chain_key, d2.chain_key);
  assert.equal(d1.revision_no, 1);
  assert.equal(d2.revision_no, 2);
  // Eski silinmez — üçü de tutulur
  const store = upsertObligationAccrual([], n);
  const store2 = upsertObligationAccrual(store.records, d1);
  const store3 = upsertObligationAccrual(store2.records, d2);
  assert.equal(store3.records.length, 3);
});

test("10) Vergi aslı + damga + pişmanlık zammı", () => {
  const accrual = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.KDV1,
    period_key: "2026-01",
    lines: [
      { description: "KDV aslı", principal_amount: 50000 },
      {
        description: "Damga",
        principal_amount: 100,
        line_type: LINE_TYPE.STAMP_TAX,
      },
      {
        description: "Pişmanlık zammı",
        penalty_amount: 250,
        line_type: LINE_TYPE.PENALTY,
      },
    ],
  });
  assert.equal(accrual.total_principal, 50100);
  assert.ok(accrual.total_penalty >= 250);
  assert.ok(accrual.total_payable >= 50350);
});

test("11) Geç ödeme + teşvik iptali", () => {
  const accrual = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.SGK,
    period_key: "2026-01",
    total_payable: 10000,
    lines: [{ principal_amount: 10000 }],
  });
  const s = classifyPaymentScenario({
    bankAmount: 12500,
    accrual,
    verifiedIncentiveCancellationAmount: 2000,
    verifiedLateFeeAmount: 500,
  });
  assert.equal(s.scenario, PAYMENT_SCENARIO.LATE_INCENTIVE_CANCEL);
  assert.equal(s.incentive_cancellation_amount, 2000);
  assert.equal(s.late_fee_amount, 500);
  assert.equal(s.incentive_income_amount, 0);
  assert.equal(s.status, MATCH_STATUS.FULL_MATCH);
});

test("12) Destek doğrulanmadı → 602 otomatik yok", () => {
  const accrual = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.SGK,
    period_key: "2026-01",
    total_payable: 10000,
    lines: [{ principal_amount: 10000 }],
  });
  const s = classifyPaymentScenario({
    bankAmount: 8500,
    accrual,
    taxSgkAccountMappings: companyMaps,
  });
  assert.equal(s.autoApplyIncentiveIncome, false);
  assert.equal(s.incentive_income_amount, 0);
  assert.equal(s.status, MATCH_STATUS.UNRESOLVED_DIFFERENCE);
});

test("13) Destek doğrulandı → firma 602", () => {
  const accrual = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.SGK,
    period_key: "2026-01",
    total_payable: 10000,
    lines: [{ principal_amount: 10000 }],
  });
  const s = classifyPaymentScenario({
    bankAmount: 8500,
    accrual,
    verifiedSupportAmount: 1500,
    taxSgkAccountMappings: companyMaps,
  });
  assert.equal(s.autoApplyIncentiveIncome, true);
  assert.equal(s.incentiveAccountCode, "602.01.010");
  assert.equal(s.incentive_income_amount, 1500);
});

test("14) Kısmi ödeme", () => {
  const accrual = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.KDV1,
    period_key: "2026-01",
    total_payable: 20000,
    lines: [{ principal_amount: 20000 }],
  });
  const s = classifyPaymentScenario({
    bankAmount: 5000,
    accrual,
    assumePartial: true,
  });
  assert.equal(s.scenario, PAYMENT_SCENARIO.PARTIAL);
  assert.equal(s.unmatched_amount, 15000);
});

test("15) Bir ödeme birden fazla tahakkuk", () => {
  const a = buildObligationAccrual({
    id: "a1",
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.SGK,
    period_key: "2026-01",
    total_payable: 3000,
    lines: [{ principal_amount: 3000 }],
  });
  const b = buildObligationAccrual({
    id: "a2",
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.SGK,
    period_key: "2026-01",
    total_payable: 7000,
    lines: [{ principal_amount: 7000 }],
  });
  const plan = proposeMultiAccrualAllocation([a, b], 10000);
  assert.equal(plan.allocations.length, 2);
  assert.equal(plan.unmatched_amount, 0);
});

test("16) Bir tahakkuk birden fazla ödeme", () => {
  const accrual = buildObligationAccrual({
    id: "acc1",
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.MUHSGK,
    period_key: "2026-01",
    total_payable: 10000,
    lines: [{ principal_amount: 10000 }],
  });
  const cov = proposeMultiPaymentCoverage(accrual, [
    { id: "m1", amount: 4000 },
    { id: "m2", amount: 6000 },
  ]);
  assert.equal(cov.fullyCovered, true);
  assert.equal(cov.links.length, 2);
});

test("17) Mükerrer belge hash kontrolü — firma bazlı", () => {
  const hash = hashUtf8String('{"x":1}');
  const accrual = {
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.KDV1,
    period_key: "2026-01",
    source_file_hash: hash,
    lines: [{ principal_amount: 1 }],
  };
  const first = upsertObligationAccrual([], accrual);
  const second = upsertObligationAccrual(first.records, {
    ...accrual,
    lines: [{ principal_amount: 99 }],
  });
  assert.equal(second.duplicate, true);
  assert.equal(second.records.length, 1);

  const otherCompany = upsertObligationAccrual(second.records, {
    ...accrual,
    company_id: "c2",
    lines: [{ principal_amount: 1 }],
  });
  assert.equal(otherCompany.duplicate, false);
  assert.equal(otherCompany.created, true);
  assert.equal(otherCompany.records.length, 2);
});

test("FIXTURE A) SGK 5510 → SGK_NORMAL + sgkMainAccount", () => {
  const parsed = parseObligationDocument({
    fixture: {
      company_id: "c1",
      obligation_type: "SGK",
      period_key: "2026-05",
      tax_period_start: "2026-05",
      tax_period_end: "2026-05",
      lines: [
        {
          law_code: "5510",
          description: "5510 normal çalışan",
          principal_amount: 12000,
        },
      ],
    },
    fileMeta: { name: "sgk-5510.json", companyId: "c1" },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.accrual.period_key, "2026-05");
  const line = applySgkLineMapping(parsed.accrual.lines[0], {
    taxSgkAccountMappings: companyMaps,
  });
  assert.equal(line.accounting_role, ACCOUNTING_ROLE.SGK_NORMAL);
  assert.equal(line.mapped_account_code, "361.01.001");
});

test("FIXTURE B) SGDP → sgdpAccount", () => {
  const parsed = parseObligationDocument({
    fixture: {
      company_id: "c1",
      obligation_type: "SGDP",
      period_key: "2026-05",
      lines: [
        {
          description: "SGDP emekli destek primi",
          principal_amount: 2500,
        },
      ],
    },
    fileMeta: { name: "sgdp.json", companyId: "c1" },
  });
  const line = applySgkLineMapping(parsed.accrual.lines[0], {
    taxSgkAccountMappings: companyMaps,
  });
  assert.equal(line.accounting_role, ACCOUNTING_ROLE.SGDP);
  assert.equal(line.mapped_account_code, "361.03.001");
});

test("FIXTURE C) Doğrulanmamış destek farkı → 602 yok", () => {
  const accrual = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.SGK,
    period_key: "2026-05",
    total_payable: 10000,
    lines: [{ law_code: "5510", principal_amount: 10000 }],
  });
  const s = classifyPaymentScenario({
    bankAmount: 8200,
    accrual,
    taxSgkAccountMappings: companyMaps,
  });
  assert.equal(s.autoApplyIncentiveIncome, false);
  assert.equal(s.incentive_income_amount, 0);
  assert.ok(
    s.status === MATCH_STATUS.UNRESOLVED_DIFFERENCE ||
      s.status === MATCH_STATUS.MANUAL_REVIEW
  );
  const dist = buildDistributionLegs({
    accrual,
    bankAmount: 8200,
    bankAccountCode: "102.01",
    taxSgkAccountMappings: companyMaps,
    scenarioResult: s,
  });
  assert.ok(
    !dist.legs.some((l) => String(l.accountCode || "").startsWith("602"))
  );
});

test("FIXTURE D) Doğrulanmış destek → 602 önerisi", () => {
  const accrual = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.SGK,
    period_key: "2026-05",
    total_payable: 10000,
    lines: [{ law_code: "5510", principal_amount: 10000 }],
  });
  const s = classifyPaymentScenario({
    bankAmount: 8500,
    accrual,
    verifiedSupportAmount: 1500,
    taxSgkAccountMappings: companyMaps,
  });
  assert.equal(s.autoApplyIncentiveIncome, true);
  assert.equal(s.incentiveAccountCode, "602.01.010");
  const dist = buildDistributionLegs({
    accrual,
    bankAmount: 8500,
    bankAccountCode: "102.01",
    taxSgkAccountMappings: companyMaps,
    scenarioResult: s,
  });
  assert.ok(dist.legs.some((l) => l.accountCode === "602.01.010"));
});

test("FIXTURE E) Düzeltme zinciri — eski silinmez", () => {
  let store = { records: [] };
  for (const [revType, revNo, amount] of [
    [REVISION_TYPE.NORMAL, 0, 10000],
    [REVISION_TYPE.DUZELTME, 1, 11000],
    [REVISION_TYPE.DUZELTME, 2, 10500],
  ]) {
    store = upsertObligationAccrual(store.records, {
      company_id: "c1",
      obligation_type: OBLIGATION_TYPE.MUHSGK,
      period_key: "2026-05",
      revision_type: revType,
      revision_no: revNo,
      document_type: DOCUMENT_TYPE.TAHAKKUK,
      lines: [{ principal_amount: amount, description: `r${revNo}` }],
    });
  }
  assert.equal(store.records.length, 3);
  assert.ok(store.records.some((r) => r.revision_no === 0));
  assert.ok(store.records.some((r) => r.revision_no === 1));
  assert.ok(store.records.some((r) => r.revision_no === 2));
});

test("Vergi/SGK çözüm grubu — uygulama kapalı, sade mesaj", () => {
  const groups = buildTaxObligationResolutionGroups(
    [
      {
        id: "r1",
        detayAciklama: "SGK PRIM ODEME MAYIS 2026",
        transactionType: "SGK",
        missingHesapCategory: "Vergi/SGK",
        borc: 1000,
        alacak: 0,
        riskDurumu: "HESAP_EKSIK",
      },
    ],
    [],
    { companyId: "c1" }
  );
  assert.ok(groups.length >= 1);
  assert.equal(groups[0].applyDisabled, true);
  assert.ok(
    /sonraki pakette|tahakkuk kaydı bulunamadı/i.test(groups[0].vendorMessage || "")
  );
  assert.ok(!/JSON|debug|chain_key/i.test(JSON.stringify(groups[0].vendorMessage)));
});

test("18) Tahakkuk bulunamadı", () => {
  const d = decideAccrualMatch([], {
    companyId: "c1",
    obligationType: "MUHSGK",
    amount: 1000,
  });
  assert.equal(d.status, MATCH_STATUS.ACCRUAL_PENDING);
  assert.equal(d.autoApply, false);
});

test("19) Birden fazla tahakkuk adayı", () => {
  const a = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.MUHSGK,
    period_key: "2026-01",
    total_payable: 5000,
    lines: [{ principal_amount: 5000 }],
  });
  const b = buildObligationAccrual({
    company_id: "c1",
    obligation_type: OBLIGATION_TYPE.MUHSGK,
    period_key: "2026-01",
    total_payable: 5000,
    lines: [{ principal_amount: 5000 }],
  });
  const d = decideAccrualMatch([a, b], {
    companyId: "c1",
    obligationType: "MUHSGK",
    amount: 5000,
    periodKey: "2026-01",
  });
  assert.equal(d.status, MATCH_STATUS.MULTIPLE_CANDIDATES);
  assert.equal(d.autoApply, false);
});

test("classify: Turizm daraltma — çıplak TURIZM değil", () => {
  assert.equal(
    classifyObligationPayment("TURIZM OTEL REZERVASYON").isObligationPayment,
    false
  );
  assert.equal(
    classifyObligationPayment("TURIZM PAYI ODEMESI").obligationType,
    OBLIGATION_TYPE.TURIZM_PAYI
  );
});

test("parse fixture adapter", () => {
  const r = parseObligationDocument({
    fixture: {
      company_id: "c1",
      obligation_type: "SGK",
      period_key: "2026-04",
      lines: [
        { law_code: "5510", principal_amount: 1000, description: "5510" },
      ],
    },
    fileMeta: { name: "sgk.json", companyId: "c1" },
  });
  assert.equal(r.ok, true);
  assert.equal(r.accrual.obligation_type, "SGK");
  const line = applySgkLineMapping(r.accrual.lines[0], {
    taxSgkAccountMappings: companyMaps,
  });
  assert.equal(line.accounting_role, ACCOUNTING_ROLE.SGK_NORMAL);
  assert.equal(line.mapped_account_code, "361.01.001");
});

test("mapping yoksa MANUAL — kod üretme", () => {
  const mapped = resolveSgkMappedAccount({
    accountingRole: ACCOUNTING_ROLE.SGK_NORMAL,
    taxSgkAccountMappings: {},
  });
  assert.equal(mapped.mapped_account_code, "");
  assert.equal(mapped.mapping_status, MAPPING_STATUS.MANUAL);
});

test("chain key stabil", () => {
  const k = buildObligationChainKey({
    companyId: "c1",
    obligationType: "MUHSGK",
    periodKey: "2026-01",
    revisionNo: 2,
    documentType: DOCUMENT_TYPE.TAHAKKUK,
  });
  assert.equal(k, "c1|MUHSGK|2026-01|2|TAHAKKUK");
});

console.log("\nAll tax obligation engine tests passed.");
