"use client";

import {
  getCompanyDisplayName,
  groupCompaniesForDisplay,
} from "@/src/utils/companies";

export default function CompanySelectOptions({ companies }) {
  const { activeCompanies, passiveCompanies } =
    groupCompaniesForDisplay(companies);

  return (
    <>
      {activeCompanies.map((company) => (
        <option key={`company-${company.id}`} value={company.id}>
          {getCompanyDisplayName(company)}
        </option>
      ))}

      {passiveCompanies.length > 0 && (
        <optgroup label="Pasif Firmalar">
          {passiveCompanies.map((company) => (
            <option key={`company-passive-${company.id}`} value={company.id}>
              {getCompanyDisplayName(company)}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
