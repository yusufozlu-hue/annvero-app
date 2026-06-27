import AuthUserBar from "@/src/components/AuthUserBar";

export default function MuhasebeLayout({ children }) {
  return (
    <>
      <AuthUserBar />
      {children}
    </>
  );
}
