"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchCompanies,
  getCompanyDisplayName,
  syncSelectedCompanyId,
} from "@/src/utils/companies";

export function useCompanyList() {
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const refreshCompanies = useCallback(async () => {
    setIsLoading(true);

    try {
      const loaded = await fetchCompanies();
      setCompanies(loaded);
      setSelectedCompanyId((currentId) =>
        syncSelectedCompanyId(loaded, currentId)
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCompanies();

    const handleRefresh = () => {
      refreshCompanies();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshCompanies();
      }
    };

    window.addEventListener("focus", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleRefresh);
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
    isLoading,
  };
}
