import PublicHeader from "../components/landing/PublicHeader";
import PublicSiteFooter from "../components/landing/PublicSiteFooter";
import HesaplamaAraclariHub from "../components/hesaplama/HesaplamaAraclariHub";

export const metadata = {
  title: "Hesaplama Araçları | ANNVERO",
  description:
    "KDV, maaş ve diğer mali hesaplama araçları — giriş yapmadan kullanın.",
};

export default function HesaplamaAraclariPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />
      <HesaplamaAraclariHub variant="public" />
      <PublicSiteFooter />
    </div>
  );
}
