"use client";

/**
 * Aktif firma listesi — tek kaynak: CompanyWorkspaceProvider (AnnveroAppShell).
 */
import { useOptionalCompanyWorkspace } from "@/src/contexts/CompanyWorkspaceContext";

export { CompanyWorkspaceProvider } from "@/src/contexts/CompanyWorkspaceContext";

export function useCompanyList() {
  const workspace = useOptionalCompanyWorkspace();
  if (!workspace) {
    throw new Error(
      "useCompanyList requires CompanyWorkspaceProvider. Wrap layout with AnnveroAppShell."
    );
  }
  return workspace;
}
