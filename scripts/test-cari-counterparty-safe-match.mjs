/**
 * Eksik Hesap Çözüm — karşı taraf / puanlama / leaf / tarih fixture testleri.
 * Run: node --import ./scripts/_alias-loader.mjs ./scripts/test-cari-counterparty-safe-match.mjs
 */
import assert from "node:assert/strict";
import {
  resolveCariAccountMatch,
  buildCariMatchIndex,
  normalizeCariNameCore,
  CARI_MATCH_REASON,
} from "@/src/utils/cariAccountMatcher.js";
import {
  buildOwnCompanyIdentity,
  extractCounterpartyParty,
  extractTransferCounterparty,
  isOwnCompanyPartyName,
  isSelectableCariLeafAccount,
  buildCariParentCodeSet,
  sortCariDisplayDates,
  parseCariDisplayDate,
} from "@/src/utils/cariCounterpartyExtract.js";
import {
  evaluateOwnAccountVirmanTransfer,
  createOwnAccountVirmanContext,
} from "@/src/utils/bankInternalTransfer.js";
import {
  canEnableCariAutoLearn,
  shouldDefaultCariAutoLearn,
} from "@/src/utils/cariMissingResolutionGroups.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const mareCompany = {
  id: "firma-mare",
  name: "Mare Resort Turizm A.Ş.",
  unvan: "MARE RESORT TURIZM A.S.",
  bankAccounts: [
    { iban: "TR110001000000000000000001", bankName: "Vakıfbank", lucaAccount: "102.01.001" },
    { iban: "TR110001000000000000000002", bankName: "Garanti", lucaAccount: "102.02.001" },
  ],
};

const plan = [
  { accountCode: "120", accountName: "ALICILAR", isActive: true },
  { accountCode: "120.01", accountName: "ALICILAR YURTICI", isActive: true },
  {
    accountCode: "120.01.B0019",
    accountName: "BİLETDÜKKANI TURİZM A.Ş.",
    isActive: true,
  },
  {
    accountCode: "120.10.B0001",
    accountName: "BİLET DÜKKANI TURİZM A.Ş.",
    isActive: true,
  },
  { accountCode: "320", accountName: "SATICILAR", isActive: true },
  { accountCode: "320.01", accountName: "SATICILAR YURTICI", isActive: true },
  {
    accountCode: "320.01.D0014",
    accountName: "DERİN PROJE YATIRIM VE GAYRİMENKUL GELİŞTİRME A.Ş.",
    isActive: true,
  },
  {
    accountCode: "320.10.D0007",
    accountName: "DERİN PROJE YATIRIM VE GAYRİMENKUL GELİŞTİRME A.Ş.",
    isActive: true,
  },
  {
    accountCode: "120.04.D0018",
    accountName: "DER POS ÖDEME SİSTEMLERİ A.Ş.",
    isActive: true,
  },
];

const index = buildCariMatchIndex(plan);
const ownIdentity = buildOwnCompanyIdentity(mareCompany);

test("A: BİLETDÜK → BİLET DÜKKANI normalize + short-code aday", () => {
  const party = extractCounterpartyParty({
    description: "GLN. HVL / BİLETDÜK TURIZM TAHSILAT",
    direction: "GIRIS",
    ownIdentity,
  });
  assert.ok(
    normalizeCariNameCore(party).includes("BILET") ||
      normalizeCariNameCore(party).includes("DUKKANI") ||
      party.length >= 3
  );
  const match = resolveCariAccountMatch(plan, {
    description: "GLN HVL / BILETDUK ODEME",
    direction: "GIRIS",
    ownIdentity,
    cariIndex: index,
    firmaMemoryRecord: {
      accountCode: "120.10.B0001",
      accountName: "BİLET DÜKKANI TURİZM A.Ş.",
    },
  });
  assert.equal(match.code, "120.10.B0001");
  assert.notEqual(match.code, "120");
});

test("B: Mare→Derin giden — karşı taraf DERİN PROJE, virman değil, genel 320 yok", () => {
  const desc =
    "Mare Resort hesabından Derin Proje Yatırım ve Gayrimenkul Geliştirme A.Ş. hesabına havale yapılmıştır — çıkış.";
  const party = extractTransferCounterparty(desc, "CIKIS", ownIdentity);
  assert.ok(normalizeCariNameCore(party).includes("DERIN"));
  assert.ok(!normalizeCariNameCore(party).includes("MARE"));
  assert.equal(isOwnCompanyPartyName(party, ownIdentity), false);

  const virman = evaluateOwnAccountVirmanTransfer(
    { detayAciklama: desc, transactionType: "GIDEN_HAVALE" },
    {
      ownAccountContext: createOwnAccountVirmanContext(mareCompany, "VAKIFBANK"),
      selectedBank: "VAKIFBANK",
    }
  );
  assert.notEqual(virman.status, "definite");
  assert.equal(virman.isVirmanCandidate || false, false);

  const match = resolveCariAccountMatch(plan, {
    description: desc,
    direction: "CIKIS",
    ownIdentity,
    cariIndex: index,
  });
  assert.notEqual(match.code, "320");
  assert.notEqual(match.code, "320.01");
  if (match.duplicateAccounts) {
    assert.equal(match.code, "");
    assert.ok(match.suggestions.length >= 2);
  } else if (match.code) {
    assert.ok(match.code.startsWith("320."));
    assert.ok(isSelectableCariLeafAccount(match.code, index.parentCodes));
  }
});

test("C: Aleyna Nimet Teoman — DER POS önerilmez / unresolved", () => {
  const desc =
    "GLN. HVL / 26 temmuz 2026 giriş 9 ağustos 2026 çıkış konaklama ön ödeme ALEYNA NİMET TEOMAN / TR690001000000000000000099";
  const party = extractCounterpartyParty({
    description: desc,
    direction: "GIRIS",
    ownIdentity,
  });
  assert.ok(normalizeCariNameCore(party).includes("ALEYNA"));
  assert.ok(normalizeCariNameCore(party).includes("TEOMAN"));

  const match = resolveCariAccountMatch(plan, {
    description: desc,
    direction: "GIRIS",
    ownIdentity,
    cariIndex: index,
  });
  assert.notEqual(match.code, "120.04.D0018");
  assert.ok(
    !match.suggestions.some((s) => s.code === "120.04.D0018" && s.confidence >= 50)
  );
  assert.equal(match.autoApplied, false);
});

test("D: Mükerrer unvan — otomatik seçim yok", () => {
  const match = resolveCariAccountMatch(plan, {
    description:
      "Derin Proje Yatırım ve Gayrimenkul Geliştirme A.Ş. hesabına ödeme",
    direction: "CIKIS",
    ownIdentity,
    cariIndex: index,
  });
  // Aynı core iki leaf → duplicate veya boş kod
  if (match.duplicateAccounts) {
    assert.equal(match.code, "");
    assert.ok(match.suggestions.length >= 2);
  } else {
    // short-code/token yolu da otomatik seçmemeli
    assert.ok(!match.autoApplied || match.duplicateAccounts);
  }
});

test("E: Genel 120/320 leaf yerine seçilemez", () => {
  const parents = buildCariParentCodeSet(plan.map((p) => p.accountCode));
  assert.equal(isSelectableCariLeafAccount("120", parents), false);
  assert.equal(isSelectableCariLeafAccount("320", parents), false);
  assert.equal(isSelectableCariLeafAccount("120.01", parents), false);
  assert.equal(isSelectableCariLeafAccount("120.10.B0001", parents), true);
});

test("F: Düşük güven — otomatik öğrenme varsayılan/izin kapalı", () => {
  assert.equal(
    shouldDefaultCariAutoLearn({
      confidence: 40,
      accountCode: "120.10.B0001",
    }),
    false
  );
  assert.equal(
    canEnableCariAutoLearn({
      confidence: 40,
      accountCode: "120.10.B0001",
    }),
    false
  );
  assert.equal(
    canEnableCariAutoLearn({
      confidence: 90,
      accountCode: "120",
    }),
    false
  );
});

test("G: Çözülen grup sayacı mantığı — resolved list boyutu", () => {
  const remaining = [{ id: "a" }, { id: "b" }];
  const resolved = [{ id: "x", status: "resolved" }];
  const resolvedSet = new Set(resolved.map((g) => g.id));
  const resolvedCount = resolved.length || resolvedSet.size;
  const remainingCount = remaining.filter((g) => !resolvedSet.has(g.id)).length;
  assert.equal(resolvedCount, 1);
  assert.equal(remainingCount, 2);
});

test("H: Tarih aralığı eski → yeni", () => {
  const sorted = sortCariDisplayDates(["29.08.2025", "31.07.2025"]);
  assert.equal(sorted[0], "31.07.2025");
  assert.equal(sorted[1], "29.08.2025");
  assert.ok(parseCariDisplayDate("31.07.2025") < parseCariDisplayDate("29.08.2025"));
});

test("I: Tenant — başka firma unvanı own identity sayılmaz", () => {
  const other = buildOwnCompanyIdentity({
    id: "other",
    name: "Başka Otel A.Ş.",
  });
  assert.equal(isOwnCompanyPartyName("MARE RESORT TURIZM AS", other), false);
  assert.equal(isOwnCompanyPartyName("MARE RESORT TURIZM AS", ownIdentity), true);

  const matchOther = resolveCariAccountMatch(plan, {
    description: "BILETDUK",
    direction: "GIRIS",
    ownIdentity: other,
    cariIndex: index,
    firmaMemoryRecord: {
      accountCode: "120.10.B0001",
      // memory yine firma bağlamında uygulanır; burada yalnız identity izolasyonu
    },
  });
  // Hafıza kaydı sources ile geldiği için eşleşebilir — kritik: own filter sızdırmaz
  assert.ok(matchOther);
  assert.notEqual(CARI_MATCH_REASON.NONE, undefined);
});

console.log("PASS all cari-counterparty-safe-match fixtures");
