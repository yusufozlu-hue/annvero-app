import MaasHesaplamaPageContent from "@/app/components/hesaplama/MaasHesaplamaPageContent";
import { PLATFORM_CALCULATOR_BASE } from "@/src/config/calculatorRoutes";

export const metadata = {
  title: "Maaş Hesaplama Merkezi | ANNVERO Platform",
  description:
    "Brüt-net ve net-brüt maaş hesaplama, SGK primleri, gelir vergisi ve işveren maliyeti.",
};

export default function PlatformMaasHesaplamaPage() {
  return (
    <MaasHesaplamaPageContent
      variant="platform"
      backHref={PLATFORM_CALCULATOR_BASE}
      backLabel="← Hesaplama Araçları"
    />
  );
}
