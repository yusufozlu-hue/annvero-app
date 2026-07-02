import Link from "next/link";
import MaasHesaplamaMerkezi from "@/app/components/hesaplama/MaasHesaplamaMerkezi";
import PublicHeader from "@/app/components/landing/PublicHeader";
import AnnveroLogo from "@/app/components/AnnveroLogo";

export const metadata = {
  title: "Maaş Hesaplama Merkezi | ANNVERO",
  description:
    "Brüt-net ve net-brüt maaş hesaplama, SGK primleri, gelir vergisi ve işveren maliyeti projeksiyonu.",
};

export default function MaasHesaplamaPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="max-w-4xl">
          <Link
            href="/hesaplama-araclari"
            className="text-sm font-semibold text-violet-700 transition hover:text-violet-900"
          >
            ← Hesaplama Araçları
          </Link>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-violet-700">
            Maaş Hesaplama Merkezi
          </p>
          <h1 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">
            Brüt / Net maaş ve işveren maliyeti hesaplama
          </h1>
          <p className="mt-4 text-slate-600">
            SGK primleri, gelir vergisi, damga vergisi ve yol ödemesi dahil aylık
            bordro projeksiyonu oluşturun.
          </p>
        </div>

        <div className="mt-10">
          <MaasHesaplamaMerkezi />
        </div>
      </main>

      <footer className="border-t border-violet-100 bg-slate-900 px-4 py-10 text-slate-300 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <AnnveroLogo onLight={false} size={36} />
          <p className="mt-3 text-sm text-slate-400">
            Muhasebe ve vergi yönetiminde akıllı dönüşüm.
          </p>
        </div>
      </footer>
    </div>
  );
}
