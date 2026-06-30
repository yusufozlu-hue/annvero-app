import { getCompanyDisplayName, isCompanyActive } from "@/src/utils/companies";
import {
  normalizeContacts,
  resolveContactWhatsApp,
  sortContactsWithDefaultFirst,
} from "@/src/utils/companyContacts";

export function resolveCompanyId(record = {}) {
  return record.companyId || record.firmaId || record.mukellefId || "";
}

export function getActiveCompanies(companies = []) {
  return companies.filter(isCompanyActive);
}

export function findCompanyById(companies, companyId) {
  if (!companyId) return null;
  return companies.find((company) => company.id === companyId) || null;
}

export function getSortedCompanyContacts(company) {
  if (!company) return [];
  return sortContactsWithDefaultFirst(normalizeContacts(company.contacts, company));
}

export function getDefaultCompanyContact(company) {
  return getSortedCompanyContacts(company)[0] || null;
}

export function getCompanyContactSummary(company) {
  if (!company) {
    return {
      name: "—",
      taxNumber: "",
      taxOffice: "",
      contactPerson: "",
      contactPeople: [],
      contacts: [],
      phone: "",
      whatsappPhone: "",
      email: "",
      address: "",
      notes: "",
    };
  }

  const contactPeople = getSortedCompanyContacts(company);
  const defaultContact = contactPeople[0] || null;

  return {
    name: getCompanyDisplayName(company),
    taxNumber: company.taxNumber || "",
    taxOffice: company.taxOffice || "",
    contactPerson: defaultContact?.name || "",
    contactPeople,
    contacts: contactPeople.map((contact) => contact.name).filter(Boolean),
    phone: defaultContact?.phone || "",
    whatsappPhone: defaultContact ? resolveContactWhatsApp(defaultContact) : "",
    email: defaultContact?.email || "",
    address: company.address || "",
    notes: company.notes || "",
  };
}

export function getCompanyPhone(companies, companyId) {
  return getCompanyContactSummary(findCompanyById(companies, companyId)).phone;
}

export function getCompanyWhatsAppPhone(companies, companyId, contactId = "") {
  const company = findCompanyById(companies, companyId);
  const contacts = getSortedCompanyContacts(company);

  if (contactId) {
    const selected = contacts.find((contact) => contact.id === contactId);
    return selected ? resolveContactWhatsApp(selected) : "";
  }

  const defaultContact = contacts[0];
  return defaultContact ? resolveContactWhatsApp(defaultContact) : "";
}

export function getCompanyEmail(companies, companyId, contactId = "") {
  const company = findCompanyById(companies, companyId);
  const contacts = getSortedCompanyContacts(company);

  if (contactId) {
    return contacts.find((contact) => contact.id === contactId)?.email || "";
  }

  return contacts[0]?.email || "";
}

export function getCompanyName(companies, companyId) {
  return getCompanyContactSummary(findCompanyById(companies, companyId)).name;
}

function buildLegacyIdMap(legacyMukellefler = [], companies = []) {
  const idMap = new Map();

  for (const legacy of legacyMukellefler) {
    const legacyName = String(legacy.unvan || "")
      .trim()
      .toLocaleLowerCase("tr");
    const legacyTax = String(legacy.vergiNo || legacy.taxNumber || "").trim();

    const match = companies.find((company) => {
      const companyName = getCompanyDisplayName(company).toLocaleLowerCase("tr");
      const companyTax = String(company.taxNumber || "").trim();

      if (legacyTax && companyTax && legacyTax === companyTax) {
        return true;
      }

      return legacyName && companyName && legacyName === companyName;
    });

    if (match?.id) {
      idMap.set(legacy.id, match.id);
    }
  }

  return idMap;
}

function remapCompanyId(record, idMap) {
  const currentId = resolveCompanyId(record);

  if (!currentId) {
    return { ...record, companyId: "" };
  }

  const mappedId = idMap.get(currentId) || currentId;
  const next = {
    ...record,
    companyId: mappedId,
  };

  delete next.mukellefId;
  delete next.firmaId;

  return next;
}

export function migrateOfisTakipToCompanies(state, companies = []) {
  const legacyMukellefler = state._legacyMukellefler || state.mukellefler || [];
  const idMap = buildLegacyIdMap(legacyMukellefler, companies);

  return {
    version: state.version || 1,
    settings: state.settings || {},
    yapilacaklar: (state.yapilacaklar || []).map((item) =>
      remapCompanyId(item, idMap)
    ),
    hatirlatmalar: (state.hatirlatmalar || []).map((item) =>
      remapCompanyId(item, idMap)
    ),
    vergiTakvimi: (state.vergiTakvimi || []).map((item) =>
      remapCompanyId(item, idMap)
    ),
    _migrationApplied: true,
  };
}

export function filterCompaniesForSearch(companies, query) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("tr");

  if (!normalizedQuery) {
    return getActiveCompanies(companies);
  }

  return getActiveCompanies(companies).filter((company) => {
    const summary = getCompanyContactSummary(company);
    const contactHaystack = summary.contactPeople
      .flatMap((contact) => [
        contact.name,
        contact.title,
        contact.phone,
        contact.whatsapp,
        contact.email,
        contact.note,
      ])
      .join(" ");

    const haystack = [
      summary.name,
      summary.taxNumber,
      summary.taxOffice,
      summary.address,
      summary.notes,
      contactHaystack,
    ]
      .join(" ")
      .toLocaleLowerCase("tr");

    return haystack.includes(normalizedQuery);
  });
}

export function formatContactValue(value) {
  const text = String(value || "").trim();
  return text || "—";
}

export { resolveContactWhatsApp };
