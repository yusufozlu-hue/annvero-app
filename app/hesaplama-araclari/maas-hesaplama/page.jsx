import PublicHeader from "@/app/components/landing/PublicHeader";
import PublicSiteFooter from "@/app/components/landing/PublicSiteFooter";
import MaasHesaplamaPageContent from "@/app/components/hesaplama/MaasHesaplamaPageContent";

export const metadata = {
  title: "Maaş Hesaplama Merkezi | ANNVERO",
  description:
    "Brüt-net ve net-brüt maaş hesaplama, SGK primleri, gelir vergisi ve işveren maliyeti projeksiyonu.",
};

export default function MaasHesaplamaPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />
      <MaasHesaplamaPageContent variant="public" />
      <PublicSiteFooter />
    </div>
  );
}
