import MevzuatHapNotlariAdminApp from "./MevzuatHapNotlariAdminApp";

export const metadata = {
  title: "Mevzuat Hap Notları Yönetimi | ANNVERO",
  robots: "noindex, nofollow",
};

export default function MevzuatHapNotlariAdminPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <MevzuatHapNotlariAdminApp />
    </div>
  );
}
