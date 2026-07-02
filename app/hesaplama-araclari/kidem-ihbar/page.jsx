import Link from "next/link";
import KidemIhbarHesaplama from "@/app/components/hesaplama/KidemIhbarHesaplama";
import PublicHeader from "@/app/components/landing/PublicHeader";
import AnnveroLogo from "@/app/components/AnnveroLogo";

export const metadata = {
  title: "Kıdem ve İhbar Tazminatı Hesaplama | ANNVERO",
  description:
    "İşe giriş ve çıkış tarihine göre kıdem ve ihbar tazminatı brüt/net hesaplama aracı.",
};

export default function KidemIhbarHesaplamaPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <PublicHeader />

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="max-w-4xl">
          <Link
            href="/hesaplama-araclari"
            className="text-sm font-semibold text-violet-400 transition hover:text-violet-300"
          >
            ← Hesaplama Araçları
          </Link>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-violet-400">
            Kıdem ve İhbar Tazminatı
          </p>
          <h1 className="mt-3 text-3xl font-bold text-slate-50 sm:text-4xl">
            Kıdem ve İhbar Tazminatı Hesaplama
          </h1>
          <p className="mt-4 text-slate-400">
            Brüt ücret, düzenli menfaatler ve hizmet süresine göre kıdem ve ihbar
            tazminatını brüt ve net olarak hesaplayın.
          </p>
        </div>

        <div className="mt-10">
          <KidemIhbarHesaplama />
        </div>
      </main>

      <footer className="border-t border-slate-800 bg-slate-900 px-4 py-10 text-slate-300 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <AnnveroLogo onLight={false} size={36} />
          <p className="mt-3 text-sm text-slate-500">
            Muhasebe ve vergi yönetiminde akıllı dönüşüm.
          </p>
        </div>
      </footer>
    </div>
  );
}
