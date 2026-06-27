import AuthUserBar from "@/src/components/AuthUserBar";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <AuthUserBar />
      {children}
    </>
  );
}
