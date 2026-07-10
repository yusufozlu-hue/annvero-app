import Link from "next/link";
import KidemIhbarHesaplama from "@/app/components/hesaplama/KidemIhbarHesaplama";

export const metadata = {
  title: "Kıdem ve İhbar Tazminatı | ANNVERO İK",
  description:
    "İşe giriş ve çıkış tarihine göre kıdem ve ihbar tazminatı brüt/net hesaplama.",
};

export default function IkKidemIhbarPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href="/ik-personel"
        className="text-sm font-semibold text-violet-400 transition hover:text-violet-300"
      >
        ← İK / İş Hukuku
      </Link>
      <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-violet-400">
        Kıdem ve İhbar Tazminatı
      </p>
      <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
        Kıdem ve İhbar Tazminatı Hesaplama
      </h1>
      <p className="mt-3 text-sm text-gray-400">
        Brüt ücret, düzenli menfaatler ve hizmet süresine göre kıdem ve ihbar tazminatını
        brüt ve net olarak hesaplayın.
      </p>

      <div className="mt-8">
        <KidemIhbarHesaplama />
      </div>
    </div>
  );
}
