import ParametreYonetimiApp from "./ParametreYonetimiApp";

export const metadata = {
  title: "Mevzuat Parametre Yönetimi | ANNVERO",
  robots: "noindex, nofollow",
};

export default function ParametreYonetimiPage() {
  return (
    <main className="min-h-screen bg-black p-6 text-white sm:p-10">
      <div className="mx-auto max-w-7xl">
        <ParametreYonetimiApp />
      </div>
    </main>
  );
}
