import AuthGate from "@/src/components/AuthGate";
import AuthUserBar from "@/src/components/AuthUserBar";

export default function OfisTakipLayout({ children }) {
  return (
    <AuthGate>
      <AuthUserBar />
      {children}
    </AuthGate>
  );
}
