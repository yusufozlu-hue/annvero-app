"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getCompanyDisplayName,
  loadCompanies,
  syncSelectedCompanyId,
} from "@/src/utils/companies";

export function useCompanyList() {
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  const refreshCompanies = useCallback(() => {
    const loaded = loadCompanies();
    setCompanies(loaded);
    setSelectedCompanyId((currentId) => syncSelectedCompanyId(loaded, currentId));
  }, []);

  useEffect(() => {
    refreshCompanies();

    const handleRefresh = () => refreshCompanies();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshCompanies();
      }
    };

    window.addEventListener("focus", handleRefresh);
    window.addEventListener("storage", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("storage", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshCompanies]);

  const selectedCompany =
    companies.find((company) => company.id === selectedCompanyId) || null;

  return {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    getCompanyDisplayName,
    refreshCompanies,
  };
}
