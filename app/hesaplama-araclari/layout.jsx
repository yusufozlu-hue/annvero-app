import AuthGate from "@/src/components/AuthGate";
import AnnveroAppShell from "@/src/components/AnnveroAppShell";

export default function HesaplamaAraclariLayout({ children }) {
  return (
    <AuthGate>
      <AnnveroAppShell>{children}</AnnveroAppShell>
    </AuthGate>
  );
}
