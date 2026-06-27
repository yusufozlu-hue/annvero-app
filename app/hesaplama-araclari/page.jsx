import CalculatorToolsGrid from "../components/landing/CalculatorToolsGrid";
import PublicHeader from "../components/landing/PublicHeader";

export default function HesaplamaAraclariPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-violet-700">
            Hesaplama Araçları Merkezi
          </p>
          <h1 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">
            Vergi ve bordro hesaplamalarını hızlıca yapın
          </h1>
          <p className="mt-4 text-slate-600">
            ANNVERO hesaplama araçları ile sık kullanılan mali hesaplamaları tek
            merkezden yönetin. Yeni modüller kademeli olarak aktif edilecektir.
          </p>
        </div>

        <section className="mt-10">
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
            Tüm Hesaplama Araçları
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Aktif olmayan araçlar yakında kullanıma açılacaktır.
          </p>

          <CalculatorToolsGrid />
        </section>
      </main>

      <footer className="border-t border-violet-100 bg-slate-900 px-4 py-10 text-slate-300 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-lg font-bold text-white">ANNVERO</p>
          <p className="mt-1 text-sm text-slate-400">
            Muhasebe ve vergi yönetiminde akıllı dönüşüm.
          </p>
        </div>
      </footer>
    </div>
  );
}
