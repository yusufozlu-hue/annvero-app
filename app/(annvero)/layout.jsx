import AuthGate from "@/src/components/AuthGate";
import AnnveroAppShell from "@/src/components/AnnveroAppShell";

/**
 * Korumalı modüllerin ortak ve kalıcı layout'u.
 * Route group URL'yi değiştirmez; AuthGate + AnnveroAppShell bir kez mount kalır.
 * Segmentler arası geçişte yalnız {children} (main içerik) değişir — shell yanıp sönmez.
 */
export default function AnnveroProtectedLayout({ children }) {
  return (
    <AuthGate>
      <AnnveroAppShell>{children}</AnnveroAppShell>
    </AuthGate>
  );
}
