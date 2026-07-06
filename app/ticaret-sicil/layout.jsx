import AuthGate from "@/src/components/AuthGate";
import AuthUserBar from "@/src/components/AuthUserBar";

export default function TicaretSicilLayout({ children }) {
  return (
    <AuthGate>
      <AuthUserBar />
      {children}
    </AuthGate>
  );
}
