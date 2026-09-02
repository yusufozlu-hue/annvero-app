/**
 * Banka hesap → Luca 102 eşleme kapsamları.
 *
 * EXACT_ACCOUNT: belirli hesap no / IBAN → 102 (istisna)
 * BANK_PRODUCT_CURRENCY: firma + banka + ürün (VADELI/VADESIZ) + PB → ortak 102
 *
 * Öncelik: exact > product/currency > kullanıcı seçimi
 */

import { normalizeParserText } from "@/src/utils/textNormalize";

export const BANK_ACCOUNT_MAPPING_SCOPE = Object.freeze({
  EXACT_ACCOUNT: "EXACT_ACCOUNT",
  BANK_PRODUCT_CURRENCY: "BANK_PRODUCT_CURRENCY",
});

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function compactCode(value = "") {
  return String(value || "").trim().replace(/\s+/g, "");
}

function listCompanyBankAccountsLocal(company = null) {
  if (!company) return [];
  const list = [
    ...(Array.isArray(company.bankAccounts) ? company.bankAccounts : []),
    ...(Array.isArray(company.banks) ? company.banks : []),
  ];
  const seen = new Set();
  const out = [];
  for (const bank of list) {
    if (!bank || typeof bank !== "object") continue;
    const code = compactCode(bank.lucaAccountCode || bank.accountCode || "");
    const key = `${code}|${String(bank.iban || "")}|${digitsOnly(
      bank.accountNumber || bank.hesapNo || ""
    )}|${String(bank.id || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(bank);
  }
  return out;
}

function bankNameTokens(name = "") {
  const text = normalizeParserText(name).toUpperCase();
  const tokens = new Set();
  if (!text) return tokens;
  if (/VAKIF|VAKIFLAR/.test(text)) tokens.add("VAKIFBANK");
  if (/ZIRAAT|T\.?C\.?\s*ZIRAAT/.test(text)) tokens.add("ZIRAAT");
  if (/IS\s*BANK|TURKIYE\s*IS/.test(text)) tokens.add("ISBANK");
  if (/GARANTI|GARANTİ/.test(text)) tokens.add("GARANTI");
  if (/YAPI\s*KREDI|YAPIKREDI/.test(text)) tokens.add("YAPIKREDI");
  if (/AKBANK/.test(text)) tokens.add("AKBANK");
  if (/HALK/.test(text)) tokens.add("HALKBANK");
  tokens.add(text.replace(/\s+/g, ""));
  return tokens;
}

function bankNamesCompatibleLocal(a = "", b = "") {
  const left = bankNameTokens(a);
  const right = bankNameTokens(b);
  if (!left.size || !right.size) return false;
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

export function normalizeMappingCurrency(value = "TL") {
  const raw = String(value || "TL").trim().toUpperCase();
  if (!raw || raw === "TRY" || raw === "TL." || raw === "YTL") return "TL";
  return raw;
}

export function normalizeMappingAccountType(value = "") {
  const t = String(value || "").trim().toUpperCase();
  if (t === "VADELI" || t === "TERM" || t === "TIME") return "VADELI";
  if (t === "VADESIZ" || t === "DEMAND" || t === "CHECKING") return "VADESIZ";
  return t || "";
}

function isLeaf102(code = "") {
  const c = compactCode(code);
  return /^102\./.test(c) && c !== "102";
}

function bankCanonicalKey(bankName = "") {
  const n = normalizeParserText(bankName).toUpperCase();
  if (/VAKIF/.test(n)) return "VAKIFBANK";
  if (/ZIRAAT/.test(n)) return "ZIRAAT";
  if (/IS\s*BANK|TURKIYE\s*IS/.test(n)) return "ISBANK";
  if (/GARANTI/.test(n)) return "GARANTI";
  if (/YAPI\s*KREDI|YAPIKREDI/.test(n)) return "YAPIKREDI";
  if (/AKBANK/.test(n)) return "AKBANK";
  if (/HALK/.test(n)) return "HALKBANK";
  return n.replace(/\s+/g, "") || "";
}

export function listBankProductMappings(company = null) {
  const list = Array.isArray(company?.bankProductMappings)
    ? company.bankProductMappings
    : [];
  return list.filter((m) => m && typeof m === "object");
}

/**
 * Exact: firma bankAccounts içinde hesap no / IBAN tam eşleşme.
 */
export function resolveExactBankAccountMapping({
  company = null,
  accountNumber = "",
  iban = "",
  accountType = "",
} = {}) {
  const wantDigits = digitsOnly(accountNumber);
  const wantIban = String(iban || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const wantType = normalizeMappingAccountType(accountType);
  const banks = listCompanyBankAccountsLocal(company);

  for (const bank of banks) {
    if (bank?.isActive === false) continue;
    const code = compactCode(bank.lucaAccountCode || bank.accountCode || "");
    if (!isLeaf102(code)) continue;
    const bankDigits = digitsOnly(bank.accountNumber || bank.hesapNo || "");
    const bankIban = String(bank.iban || "")
      .replace(/\s+/g, "")
      .toUpperCase();
    const bankType = normalizeMappingAccountType(bank.accountType);

    let exact = false;
    if (wantIban && bankIban && wantIban === bankIban) exact = true;
    if (wantDigits && bankDigits && wantDigits === bankDigits) exact = true;
    if (!exact) continue;
    if (wantType && bankType && wantType !== bankType) continue;

    return {
      ok: true,
      scope: BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT,
      code,
      bank,
      currency: normalizeMappingCurrency(bank.currency || bank.paraBirimi || "TL"),
      accountType: bankType || wantType,
      bankName: bank.bankName || "",
    };
  }
  return { ok: false, scope: BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT };
}

/**
 * BANK_PRODUCT_CURRENCY: firma + banka + ürün + PB ortak hesabı.
 */
export function resolveBankProductCurrencyMapping({
  company = null,
  bankName = "",
  accountType = "VADELI",
  currency = "TL",
} = {}) {
  const wantType = normalizeMappingAccountType(accountType);
  const wantCurrency = normalizeMappingCurrency(currency);
  const wantBank = bankCanonicalKey(bankName);
  if (!wantType || !wantBank) {
    return { ok: false, scope: BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY };
  }

  const mappings = listBankProductMappings(company).filter(
    (m) =>
      String(m.scope || "") === BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY ||
      !m.scope
  );

  const hits = [];
  for (const m of mappings) {
    const mType = normalizeMappingAccountType(m.accountType);
    const mCurrency = normalizeMappingCurrency(m.currency || "TL");
    const mBank = bankCanonicalKey(m.bankName || "");
    const code = compactCode(m.lucaAccountCode || m.accountCode || "");
    if (!isLeaf102(code)) continue;
    if (mType !== wantType) continue;
    if (mCurrency !== wantCurrency) continue;
    if (mBank !== wantBank && !bankNamesCompatibleLocal(m.bankName || "", bankName)) {
      continue;
    }
    hits.push({ mapping: m, code });
  }

  if (hits.length === 1) {
    return {
      ok: true,
      scope: BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY,
      code: hits[0].code,
      mapping: hits[0].mapping,
      currency: wantCurrency,
      accountType: wantType,
      bankName: wantBank,
    };
  }
  if (hits.length > 1) {
    const codes = new Set(hits.map((h) => h.code));
    if (codes.size === 1) {
      return {
        ok: true,
        scope: BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY,
        code: hits[0].code,
        mapping: hits[0].mapping,
        currency: wantCurrency,
        accountType: wantType,
        bankName: wantBank,
      };
    }
    return {
      ok: false,
      ambiguous: true,
      scope: BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY,
      reason: "ambiguous_product_mapping",
    };
  }

  // Legacy: tek VADELI bankAccount aynı banka+PB (hesap no farklı olsa da)
  // yalnız mapping yokken ve tek aday varken — bilinçli ürün kuralı yoksa
  // sessiz fallback yapma; kullanıcı onboarding ile kaydetsin.
  return { ok: false, scope: BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY };
}

/**
 * Öncelik: exact account → bank/product/currency.
 */
export function resolveStatementAccountMapping({
  company = null,
  accountNumber = "",
  iban = "",
  bankName = "",
  currency = "TL",
  accountType = "",
} = {}) {
  const exact = resolveExactBankAccountMapping({
    company,
    accountNumber,
    iban,
    accountType,
  });
  if (exact.ok) {
    return exact;
  }

  const wantType = normalizeMappingAccountType(accountType);
  // Product mapping yalnız tür biliniyorsa (özellikle VADELI)
  if (wantType) {
    const product = resolveBankProductCurrencyMapping({
      company,
      bankName,
      accountType: wantType,
      currency,
    });
    if (product.ok) return product;
  }

  return {
    ok: false,
    scope: "",
    reason: exact.reason || "no_mapping",
  };
}

/**
 * BANK_PRODUCT_CURRENCY kuralı kaydet / alias ekle.
 * Hesap planında yeni alt hesap oluşturmaz.
 */
export function mergeBankProductCurrencyLearning(
  company = null,
  {
    bankName = "",
    accountType = "VADELI",
    currency = "TL",
    lucaAccountCode = "",
    aliasAccountNumber = "",
  } = {}
) {
  if (!company || typeof company !== "object") {
    return { company, changed: false, reason: "no_company" };
  }
  const code = compactCode(lucaAccountCode);
  if (!isLeaf102(code)) {
    return { company, changed: false, reason: "invalid_102" };
  }
  const wantType = normalizeMappingAccountType(accountType) || "VADELI";
  const wantCurrency = normalizeMappingCurrency(currency);
  const wantBank =
    bankCanonicalKey(bankName) || String(bankName || "VAKIFBANK").toUpperCase();
  const alias = digitsOnly(aliasAccountNumber);

  const mappings = [...listBankProductMappings(company)];
  const idx = mappings.findIndex((m) => {
    if (
      String(m.scope || BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY) !==
      BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY
    ) {
      return false;
    }
    return (
      normalizeMappingAccountType(m.accountType) === wantType &&
      normalizeMappingCurrency(m.currency || "TL") === wantCurrency &&
      (bankCanonicalKey(m.bankName || "") === wantBank ||
        bankNamesCompatibleLocal(m.bankName || "", bankName))
    );
  });

  if (idx >= 0) {
    const prev = mappings[idx];
    const aliases = Array.isArray(prev.aliases) ? [...prev.aliases] : [];
    const prevAliasesDigits = aliases.map(digitsOnly).filter(Boolean);
    let changed = false;
    const nextCode = compactCode(prev.lucaAccountCode || prev.accountCode || "");
    let luca = nextCode;
    if (nextCode !== code) {
      // Aynı ürün grubunda kullanıcı yeni 102 seçti → güncelle
      luca = code;
      changed = true;
    }
    if (alias && !prevAliasesDigits.includes(alias)) {
      aliases.push(alias);
      changed = true;
    }
    if (!changed && luca === code) {
      return { company, changed: false, reason: "already_linked" };
    }
    const next = {
      ...prev,
      scope: BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY,
      bankName: prev.bankName || wantBank,
      accountType: wantType,
      currency: wantCurrency,
      lucaAccountCode: luca,
      accountCode: luca,
      aliases,
      updatedAt: new Date().toISOString(),
    };
    const nextMappings = mappings.map((m, i) => (i === idx ? next : m));
    return {
      company: { ...company, bankProductMappings: nextMappings },
      changed: true,
      reason: "updated_product_mapping",
      mapping: next,
    };
  }

  const created = {
    id: `bpm-${wantBank}-${wantType}-${wantCurrency}`.toLowerCase(),
    scope: BANK_ACCOUNT_MAPPING_SCOPE.BANK_PRODUCT_CURRENCY,
    bankName: wantBank,
    accountType: wantType,
    currency: wantCurrency,
    lucaAccountCode: code,
    accountCode: code,
    aliases: alias ? [alias] : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return {
    company: {
      ...company,
      bankProductMappings: [...mappings, created],
    },
    changed: true,
    reason: "created_product_mapping",
    mapping: created,
  };
}

/**
 * Exact istisna: belirli hesap no → 102 (ürün kuralını geçersiz kılar).
 */
export function mergeExactVadeliAccountLearning(
  company = null,
  {
    bankName = "",
    accountNumber = "",
    lucaAccountCode = "",
    currency = "TL",
  } = {}
) {
  if (!company || typeof company !== "object") {
    return { company, changed: false, reason: "no_company" };
  }
  const code = compactCode(lucaAccountCode);
  const dig = digitsOnly(accountNumber);
  if (!isLeaf102(code)) {
    return { company, changed: false, reason: "invalid_102" };
  }
  if (dig.length < 8) {
    return { company, changed: false, reason: "invalid_account_number" };
  }

  const banks = [...listCompanyBankAccountsLocal(company)];
  const idx = banks.findIndex((b) => {
    const bd = digitsOnly(b.accountNumber || b.hesapNo || "");
    return bd && (bd === dig || bd.endsWith(dig) || dig.endsWith(bd));
  });

  let nextBanks;
  if (idx >= 0) {
    const prev = banks[idx];
    if (
      compactCode(prev.lucaAccountCode || prev.accountCode) === code &&
      String(prev.accountType || "").toUpperCase() === "VADELI"
    ) {
      return { company, changed: false, reason: "already_linked" };
    }
    nextBanks = banks.map((b, i) =>
      i === idx
        ? {
            ...prev,
            accountNumber: dig,
            hesapNo: dig,
            lucaAccountCode: code,
            accountCode: code,
            accountType: "VADELI",
            mappingScope: BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT,
            bankName: prev.bankName || bankName || "VAKIFBANK",
            currency: prev.currency || currency,
            isActive: prev.isActive !== false,
          }
        : b
    );
  } else {
    nextBanks = [
      ...banks,
      {
        id: `bank-exact-vadeli-${dig.slice(-8)}`,
        bankName: bankName || "VAKIFBANK",
        accountName: `Vadeli exact …${dig.slice(-4)}`,
        accountNumber: dig,
        hesapNo: dig,
        lucaAccountCode: code,
        accountCode: code,
        accountType: "VADELI",
        mappingScope: BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT,
        currency: normalizeMappingCurrency(currency),
        isActive: true,
      },
    ];
  }

  return {
    company: { ...company, bankAccounts: nextBanks, banks: nextBanks },
    changed: true,
    reason: idx >= 0 ? "updated_exact" : "created_exact",
  };
}
