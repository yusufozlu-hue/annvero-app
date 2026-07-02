import AuthGate from "@/src/components/AuthGate";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AuthGate>{children}</AuthGate>;
}
