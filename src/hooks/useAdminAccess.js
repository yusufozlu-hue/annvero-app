"use client";

import { useUserRole } from "@/src/hooks/useUserRole";

/**
 * Admin bayrağı — ayrı /api/admin/me yerine ortak /api/auth/me önbelleği.
 */
export function useAdminAccess() {
  const { isAdmin, loading } = useUserRole();
  return { isAdmin, loading };
}
