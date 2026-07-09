"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserRole } from "@/src/hooks/useUserRole";
import {
  canAccessCoreTestCenter,
  isCoreTestCenterPath,
  isDevelopmentEnvironment,
} from "@/src/lib/dev/coreTestCenterAccess";

export default function AnnveroRoleGate({ children }) {
  const pathname = usePathname();
  const { role, loading, canAccessRoute, isActive, isManagementUser, isAdmin, isPartner } =
    useUserRole();

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">
        Yetki kontrolü yapılıyor...
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-amber-900/40 bg-amber-950/20 p-8 text-center">
        <h1 className="text-xl font-bold text-amber-100">Hesap pasif</h1>
        <p className="mt-2 text-sm text-amber-200/80">Kullanıcı hesabınız pasif durumda. Yöneticinize başvurun.</p>
      </div>
    );
  }

  const coreTestAllowed = canAccessCoreTestCenter({
    isDevelopment: isDevelopmentEnvironment(),
    isManagementUser,
    isAdmin,
    isPartner,
  });

  if (isCoreTestCenterPath(pathname) && !coreTestAllowed) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-red-900/40 bg-red-950/20 p-8 text-center">
        <h1 className="text-xl font-bold text-red-100">Erişim kısıtlı</h1>
        <p className="mt-2 text-sm text-red-200/80">
          CORE Test Merkezi yalnızca development ortamında veya yönetim kullanıcıları içindir.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Dashboard&apos;a dön
        </Link>
      </div>
    );
  }

  if (
    !isCoreTestCenterPath(pathname) &&
    !canAccessRoute(pathname)
  ) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-red-900/40 bg-red-950/20 p-8 text-center">
        <h1 className="text-xl font-bold text-red-100">Erişim kısıtlı</h1>
        <p className="mt-2 text-sm text-red-200/80">
          Bu sayfayı görüntülemek için yeterli rolünüz yok. Mevcut rol:{" "}
          <span className="font-semibold">{role}</span>
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Dashboard&apos;a dön
        </Link>
      </div>
    );
  }

  return children;
}
