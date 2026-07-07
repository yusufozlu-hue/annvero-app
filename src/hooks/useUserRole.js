"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ANNVERO_ROLE_STORAGE_KEY,
  canAccessRoute,
  resolveUserRole,
} from "@/src/config/annveroRoles";
import { useAdminAccess } from "@/src/hooks/useAdminAccess";

export function useUserRole() {
  const { isAdmin, loading: adminLoading } = useAdminAccess();
  const [storedRole, setStoredRole] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setStoredRole(localStorage.getItem(ANNVERO_ROLE_STORAGE_KEY) || "");
  }, []);

  const role = useMemo(
    () => resolveUserRole({ isAdmin, storedRole }),
    [isAdmin, storedRole]
  );

  const setRole = (nextRole) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(ANNVERO_ROLE_STORAGE_KEY, nextRole);
    setStoredRole(nextRole);
  };

  return {
    role,
    isAdmin,
    loading: adminLoading,
    setRole,
    canAccessRoute: (pathname) => canAccessRoute(role, pathname),
  };
}
