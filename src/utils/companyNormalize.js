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
  },
};

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
    },

    bankAccounts: (source.bankAccounts || []).map((account) => ({
      id: account.id || crypto.randomUUID(),
      bankName: account.bankName || "",
      accountName: account.accountName || "",
      iban: account.iban || "",
      currency: account.currency || "TL",
      accountType: account.accountType || "VADESIZ",
      lucaAccountCode: account.lucaAccountCode || "",
      isPosAccount: account.isPosAccount ?? false,
      isActive: account.isActive ?? true,
    })),

    creditCards: (source.creditCards || []).map((card) => ({
      id: card.id || crypto.randomUUID(),
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

    documentSeriesRules: (source.documentSeriesRules || []).map((rule) => ({
      id: rule.id || crypto.randomUUID(),
      prefix: rule.prefix || "",
      documentType: rule.documentType || "EA",
      description: rule.description || "",
    })),

    vehicles: (source.vehicles || []).map((vehicle) => ({
      id: vehicle.id || crypto.randomUUID(),
      plate: vehicle.plate || "",
      brand: vehicle.brand || "",
      model: vehicle.model || "",
      vehicleType: vehicle.vehicleType || "BINEK",
      policyExpenseMethod: vehicle.policyExpenseMethod || "AYLIK",
      lucaExpenseAccount: vehicle.lucaExpenseAccount || "",
      isActive: vehicle.isActive ?? true,
    })),

    employees: (source.employees || []).map((employee) => ({
      id: employee.id || crypto.randomUUID(),
      fullName: employee.fullName || "",
      tcNo: employee.tcNo || "",
      position: employee.position || "",
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
