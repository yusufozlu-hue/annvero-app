import Link from "next/link";
import MaasHesaplamaMerkezi from "@/app/components/hesaplama/MaasHesaplamaMerkezi";
import { PUBLIC_CALCULATOR_BASE } from "@/src/config/calculatorRoutes";

const VARIANT_STYLES = {
  public: {
    kicker: "text-violet-700",
    title: "text-slate-900",
    body: "text-slate-600",
    back: "text-violet-700 hover:text-violet-900",
  },
  platform: {
    kicker: "text-violet-400",
    title: "text-white",
    body: "text-gray-400",
    back: "text-violet-400 hover:text-violet-300",
  },
};

export default function MaasHesaplamaPageContent({
  backHref = PUBLIC_CALCULATOR_BASE,
  backLabel = "← Hesaplama Araçları",
  variant = "public",
}) {
  const styles = VARIANT_STYLES[variant] || VARIANT_STYLES.public;
  const mainClass =
    variant === "platform"
      ? "mx-auto max-w-5xl"
      : "mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16";

  return (
    <main className={mainClass}>
      <div className="max-w-4xl">
        <Link href={backHref} className={`text-sm font-semibold transition ${styles.back}`}>
          {backLabel}
        </Link>
        <p className={`mt-4 text-sm font-semibold uppercase tracking-wider ${styles.kicker}`}>
          Maaş Hesaplama Merkezi
        </p>
        <h1 className={`mt-3 text-3xl font-bold sm:text-4xl ${styles.title}`}>
          Brüt / Net maaş ve işveren maliyeti hesaplama
        </h1>
        <p className={`mt-4 ${styles.body}`}>
          SGK primleri, gelir vergisi, damga vergisi ve yol ödemesi dahil aylık bordro
          projeksiyonu oluşturun.
        </p>
      </div>

      <div className="mt-10">
        <MaasHesaplamaMerkezi />
      </div>
    </main>
  );
}
