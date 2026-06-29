import { getCompanyDisplayName, isCompanyActive } from "@/src/utils/companies";

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

export function getCompanyContactSummary(company) {
  if (!company) {
    return {
      name: "—",
      taxNumber: "",
      contacts: [],
      phone: "",
      email: "",
    };
  }

  const employees = (company.employees || []).filter(
    (employee) => employee.isActive !== false && employee.fullName
  );

  return {
    name: getCompanyDisplayName(company),
    taxNumber: company.taxNumber || "",
    contacts: employees.map((employee) => employee.fullName),
    phone:
      company.contactPhone ||
      company.phone ||
      company.telefon ||
      company.gsm ||
      "",
    email: company.contactEmail || company.email || company.mail || "",
  };
}

export function getCompanyPhone(companies, companyId) {
  return getCompanyContactSummary(findCompanyById(companies, companyId)).phone;
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
    const haystack = [
      summary.name,
      summary.taxNumber,
      summary.phone,
      summary.email,
      ...summary.contacts,
    ]
      .join(" ")
      .toLocaleLowerCase("tr");

    return haystack.includes(normalizedQuery);
  });
}
