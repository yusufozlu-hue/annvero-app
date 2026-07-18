"use client";

import { useEffect } from "react";

/**
 * PWA SW kaydı — eski sürümleri temizler; login navigasyonunu bloke etmez.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    let cancelled = false;

    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          // Eski v1 worker'ı güncellemek için update tetikle
          void reg.update();
        }
        if (cancelled) return;
        await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
      } catch {
        // SW yoksa uygulama normal çalışır
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
