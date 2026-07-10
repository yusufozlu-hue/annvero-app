import Link from "next/link";
import CalculatorToolsGrid from "@/app/components/landing/CalculatorToolsGrid";
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

export default function HesaplamaAraclariHub({
  basePath = PUBLIC_CALCULATOR_BASE,
  variant = "public",
  backHref,
  backLabel,
  includePlatformTools = variant === "platform",
}) {
  const styles = VARIANT_STYLES[variant] || VARIANT_STYLES.public;
  const mainClass =
    variant === "platform"
      ? "mx-auto max-w-5xl"
      : "mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16";

  return (
    <main className={mainClass}>
      {backHref ? (
        <Link href={backHref} className={`text-sm font-semibold transition ${styles.back}`}>
          {backLabel || "← Geri"}
        </Link>
      ) : null}

      <div className={backHref ? "mt-4 max-w-3xl" : "max-w-3xl"}>
        <p className={`text-sm font-semibold uppercase tracking-wider ${styles.kicker}`}>
          Hesaplama Araçları Merkezi
        </p>
        <h1 className={`mt-3 text-3xl font-bold sm:text-4xl ${styles.title}`}>
          Vergi ve bordro hesaplamalarını hızlıca yapın
        </h1>
        <p className={`mt-4 ${styles.body}`}>
          ANNVERO hesaplama araçları ile sık kullanılan mali hesaplamaları tek merkezden
          yönetin. Yeni modüller kademeli olarak aktif edilecektir.
        </p>
      </div>

      <section className="mt-10">
        <h2 className={`text-xl font-bold sm:text-2xl ${styles.title}`}>
          Tüm Hesaplama Araçları
        </h2>
        <p className={`mt-2 text-sm ${styles.body}`}>
          Aktif olmayan araçlar yakında kullanıma açılacaktır.
        </p>

        <CalculatorToolsGrid
          basePath={basePath}
          includePlatformTools={includePlatformTools}
        />
      </section>
    </main>
  );
}
