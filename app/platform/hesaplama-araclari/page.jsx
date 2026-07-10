import HesaplamaAraclariHub from "@/app/components/hesaplama/HesaplamaAraclariHub";
import { PLATFORM_CALCULATOR_BASE } from "@/src/config/calculatorRoutes";

export const metadata = {
  title: "Hesaplama Araçları | ANNVERO Platform",
  description: "Platform içi vergi ve bordro hesaplama araçları merkezi.",
};

export default function PlatformHesaplamaAraclariPage() {
  return (
    <HesaplamaAraclariHub
      basePath={PLATFORM_CALCULATOR_BASE}
      variant="platform"
    />
  );
}
