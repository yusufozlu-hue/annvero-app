import { normalizeContacts } from "@/src/utils/companyContacts";

export const emptyCompany = {
  id: "",
  companyName: "",
  taxNumber: "",
  taxOffice: "",
  address: "",
  notes: "",
  contactPerson: "",
  contactPhone: "",
  whatsappPhone: "",
  contactEmail: "",
  contacts: [],

  accountingSoftware: "LUCA",
  hotelSoftware: "YOK",

  hasForeignCurrency: false,
  isActive: true,

  enabledModules: {
    lucaExport: true,
    bankaParser: true,
    elektraweb: false,
    fifoFunds: false,
    payroll: false,
    taxControl: true,
    audit: true,
    officeManagement: true,
    policyExpense: true,
  },

  bankAccounts: [],
  creditCards: [],
  cashAccounts: [],
  posMerchantAccounts: [],
  checkAccountMappings: {
    receivedChecksAccount: "",
    givenChecksAccount: "",
    useMonthlyGivenChecks: true,
    bankGivenChecks: [],
  },
  taxSgkAccountMappings: {
    sgkMainAccount: "",
    sgdpAccount: "",
    unemploymentAccount: "",
    extraMappings: [],
  },
  accountMappingResults: [],
  accountMappingSummary: null,
  documentSeriesRules: [],
  vehicles: [],
  employees: [],

  accountingRules: {
    mtvExpenseAccount: "",
    posAccountCode: "",
    salaryAccountCode: "",
    advanceAccountCode: "",
    businessAdvanceAccountCode: "",
    policyExpenseMethod: "AYLIK",
    exchangeDifferenceMethod: "DONEM_SONU",
    transferToleranceDays: 1,
    /** Firma Muhasebe Politikası — senaryo katmanı */
    useGivenChecksAccount: true,
    useReceivedChecksAccount: true,
    usePos108Accounts: true,
    useCash100Account: true,
    useFxSeparate102Accounts: true,
  },
};

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeAliasList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCashAccounts(list = []) {
  return (list || []).map((row) => ({
    id: row.id || newId(),
    name: String(row.name || row.cashName || "").trim(),
    currency: String(row.currency || "TL").trim() || "TL",
    lucaAccountCode: String(row.lucaAccountCode || "").trim(),
    aliases: normalizeAliasList(row.aliases),
    isActive: row.isActive !== false,
  }));
}

function normalizePosMerchantAccounts(list = []) {
  return (list || []).map((row) => ({
    id: row.id || newId(),
    bankName: String(row.bankName || "").trim(),
    merchantNo: String(row.merchantNo || row.isyeriNo || "").trim(),
    posNo: String(row.posNo || "").trim(),
    alias: String(row.alias || "").trim(),
    lucaAccountCode: String(row.lucaAccountCode || "").trim(),
    isActive: row.isActive !== false,
  }));
}

function normalizeCheckAccountMappings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    receivedChecksAccount: String(source.receivedChecksAccount || "").trim(),
    givenChecksAccount: String(source.givenChecksAccount || "").trim(),
    useMonthlyGivenChecks: source.useMonthlyGivenChecks !== false,
    bankGivenChecks: (source.bankGivenChecks || []).map((row) => ({
      id: row.id || newId(),
      bankName: String(row.bankName || "").trim(),
      lucaAccountCode: String(row.lucaAccountCode || "").trim(),
    })),
  };
}

function normalizeTaxSgkAccountMappings(value = {}, accountingRules = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    sgkMainAccount: String(
      source.sgkMainAccount || accountingRules.sgkMainAccount || ""
    ).trim(),
    sgdpAccount: String(source.sgdpAccount || "").trim(),
    unemploymentAccount: String(source.unemploymentAccount || "").trim(),
    extraMappings: (source.extraMappings || []).map((row) => ({
      id: row.id || newId(),
      label: String(row.label || "").trim(),
      lucaAccountCode: String(row.lucaAccountCode || "").trim(),
    })),
  };
}

export function normalizeCompany(c) {
  const source = c || {};

  return {
    ...emptyCompany,
    ...source,

    id: source.id || "",
    companyName: source.companyName || "",
    address: source.address || "",
    notes: source.notes || "",
    contactPerson: source.contactPerson || "",
    contactPhone: source.contactPhone || "",
    whatsappPhone: source.whatsappPhone || "",
    contactEmail: source.contactEmail || "",
    contacts: normalizeContacts(source.contacts, source),

    enabledModules: {
      ...emptyCompany.enabledModules,
      ...(source.enabledModules || {}),
    },

    accountingRules: {
      ...emptyCompany.accountingRules,
      ...(source.accountingRules || {}),
      transferToleranceDays: Number(
        (source.accountingRules || {}).transferToleranceDays ??
          emptyCompany.accountingRules.transferToleranceDays
      ),
      useGivenChecksAccount:
        (source.accountingRules || {}).useGivenChecksAccount !== false,
      useReceivedChecksAccount:
        (source.accountingRules || {}).useReceivedChecksAccount !== false,
      usePos108Accounts:
        (source.accountingRules || {}).usePos108Accounts !== false,
      useCash100Account:
        (source.accountingRules || {}).useCash100Account !== false,
      useFxSeparate102Accounts:
        (source.accountingRules || {}).useFxSeparate102Accounts !== false,
    },

    bankAccounts: (source.bankAccounts || [])
      .map((account) => ({
        id: account.id || newId(),
        bankName: account.bankName || "",
        accountName: account.accountName || "",
        iban: account.iban || "",
        accountNumber: String(
          account.accountNumber || account.hesapNo || ""
        ).trim(),
        currency: account.currency || "TL",
        accountType: account.accountType || "VADESIZ",
        lucaAccountCode: account.lucaAccountCode || "",
        isPosAccount: account.isPosAccount ?? false,
        isActive: account.isActive ?? true,
      }))
      .sort((a, b) =>
        (a.bankName || a.accountName || "").localeCompare(
          b.bankName || b.accountName || "",
          "tr",
          { sensitivity: "base" }
        )
      ),

    creditCards: (source.creditCards || []).map((card) => ({
      id: card.id || newId(),
      bankName: card.bankName || "",
      cardName: card.cardName || "",
      lastFourDigits: card.lastFourDigits || "",
      currency: card.currency || "TL",
      trackingMethod: card.trackingMethod || "TEK_HESAP",
      statementPeriodRule: card.statementPeriodRule || "ONCEKI_AY",
      singleLucaAccountCode:
        card.singleLucaAccountCode || card.lucaAccountCode || "",
      lucaAccountCode: card.lucaAccountCode || card.singleLucaAccountCode || "",
      monthly309BaseAccount:
        card.monthly309BaseAccount || card.monthly309BaseAccountCode || "",
      monthly309BaseAccountCode:
        card.monthly309BaseAccountCode || card.monthly309BaseAccount || "",
      monthly409BaseAccount:
        card.monthly409BaseAccount || card.monthly409BaseAccountCode || "",
      monthly409BaseAccountCode:
        card.monthly409BaseAccountCode || card.monthly409BaseAccount || "",
      isActive: card.isActive ?? true,
    })),

    cashAccounts: normalizeCashAccounts(source.cashAccounts),
    posMerchantAccounts: normalizePosMerchantAccounts(
      source.posMerchantAccounts || source.posAccounts
    ),
    checkAccountMappings: normalizeCheckAccountMappings(
      source.checkAccountMappings
    ),
    taxSgkAccountMappings: normalizeTaxSgkAccountMappings(
      source.taxSgkAccountMappings,
      source.accountingRules || {}
    ),
    accountMappingResults: Array.isArray(source.accountMappingResults)
      ? source.accountMappingResults
      : [],
    accountMappingSummary: source.accountMappingSummary || null,

    documentSeriesRules: (source.documentSeriesRules || []).map((rule) => ({
      id: rule.id || newId(),
      prefix: rule.prefix || "",
      documentType: rule.documentType || "EA",
      description: rule.description || "",
    })),

    vehicles: (source.vehicles || []).map((vehicle) => ({
      id: vehicle.id || newId(),
      plate: vehicle.plate || "",
      brand: vehicle.brand || "",
      model: vehicle.model || "",
      vehicleType: vehicle.vehicleType || "BINEK",
      policyExpenseMethod: vehicle.policyExpenseMethod || "AYLIK",
      lucaExpenseAccount: vehicle.lucaExpenseAccount || "",
      isActive: vehicle.isActive ?? true,
    })),

    employees: (source.employees || []).map((employee) => ({
      id: employee.id || newId(),
      fullName: employee.fullName || "",
      tcNo: employee.tcNo || "",
      phone: employee.phone || "",
      email: employee.email || "",
      position: employee.position || "",
      department: employee.department || "",
      hireDate: employee.hireDate || "",
      sgkCode: employee.sgkCode || "",
      salaryAccountCode: employee.salaryAccountCode || "335",
      advanceAccountCode: employee.advanceAccountCode || "196",
      isActive: employee.isActive ?? true,
    })),
  };
}

export function formatCompanyFromSupabaseRow(item) {
  if (!item?.id) return null;

  return normalizeCompany({
    ...(item.data || {}),
    id: item.id,
    companyName: item.data?.companyName || item.company_name || "",
  });
}
