"use client";

import { useCompanyList } from "@/app/(annvero)/muhasebe/hooks/useCompanyList";
import { getCompanyDisplayName } from "@/src/utils/companies";

/**
 * Mükellef firma satırı — tek firmada seçici gizlenir.
 */
export default function TaxpayerCompanyBar({
  label = "Firma",
}: {
  label?: string;
}) {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    isLoading,
  } = useCompanyList();

  const companyName = isLoading
    ? "Yükleniyor…"
    : getCompanyDisplayName(selectedCompany) || "Firma atanmamış";

  if (companies.length <= 1) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </p>
        <p className="mt-1 text-sm font-medium text-zinc-100">{companyName}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <label
        htmlFor="mukellef-company-select"
        className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
      >
        {label}
      </label>
      <select
        id="mukellef-company-select"
        value={selectedCompanyId || ""}
        onChange={(event) => setSelectedCompanyId(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500/60"
      >
        {companies.map((company: { id: string }) => (
          <option key={company.id} value={company.id}>
            {getCompanyDisplayName(company) || company.id}
          </option>
        ))}
      </select>
    </div>
  );
}
