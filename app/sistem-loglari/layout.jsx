import AuthGate from "@/src/components/AuthGate";
import AnnveroAppShell from "@/src/components/AnnveroAppShell";
import AnnveroRoleGate from "@/src/components/AnnveroRoleGate";

export default function SistemLoglariLayout({ children }) {
  return (
    <AuthGate>
      <AnnveroAppShell>
        <AnnveroRoleGate>{children}</AnnveroRoleGate>
      </AnnveroAppShell>
    </AuthGate>
  );
}
