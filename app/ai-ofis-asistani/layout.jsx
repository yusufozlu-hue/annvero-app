import AuthGate from "@/src/components/AuthGate";
import AuthUserBar from "@/src/components/AuthUserBar";

export default function AiOfisAsistaniLayout({ children }) {
  return (
    <AuthGate>
      <AuthUserBar />
      {children}
    </AuthGate>
  );
}
