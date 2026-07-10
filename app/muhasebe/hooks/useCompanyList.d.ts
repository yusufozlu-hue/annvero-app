export interface CompanyListHook {
  companies: import("@/src/utils/companyNormalize").emptyCompany[];
  allCompanies: unknown[];
  selectedCompanyId: string;
  setSelectedCompanyId: (id: string) => void;
  selectedCompany: Record<string, unknown> | null;
  getCompanyDisplayName: (company: unknown) => string;
  refreshCompanies: (options?: { force?: boolean }) => Promise<void>;
  isLoading: boolean;
  canAccessCompany: (id: string) => boolean;
}

export function useCompanyList(): CompanyListHook;

export { CompanyWorkspaceProvider } from "@/src/contexts/CompanyWorkspaceContext";
