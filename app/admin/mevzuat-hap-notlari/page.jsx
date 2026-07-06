import MevzuatHapNotlariAdminApp from "./MevzuatHapNotlariAdminApp";

export const metadata = {
  title: "Mevzuat Hap Notları Yönetimi | ANNVERO",
  robots: "noindex, nofollow",
};

export default function MevzuatHapNotlariAdminPage() {
  return (
    <main className="min-h-screen bg-black p-6 text-white sm:p-10">
      <div className="mx-auto max-w-7xl">
        <MevzuatHapNotlariAdminApp />
      </div>
    </main>
  );
}
