"use client";

import { useEffect, useState } from "react";

export function useAdminAccess() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function checkAdmin() {
      try {
        const response = await fetch("/api/admin/me", {
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) {
          if (active) setIsAdmin(false);
          return;
        }
        const data = await response.json();
        if (active) setIsAdmin(Boolean(data.isAdmin));
      } catch {
        if (active) setIsAdmin(false);
      } finally {
        if (active) setLoading(false);
      }
    }

    checkAdmin();
    return () => {
      active = false;
    };
  }, []);

  return { isAdmin, loading };
}
