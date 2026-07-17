import AnnveroRoleGate from "@/src/components/AnnveroRoleGate";

/** Shell (annvero) layout'ta; burada yalnız rol kontrolü. */
export default function SistemLoglariLayout({ children }) {
  return <AnnveroRoleGate>{children}</AnnveroRoleGate>;
}
