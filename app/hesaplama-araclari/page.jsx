import PublicHeader from "../components/landing/PublicHeader";
import KdvCalculator from "../components/landing/KdvCalculator";

const tools = [
  { id: "kdv", title: "KDV Hesaplama", active: true },
  { id: "kdv-dahil", title: "KDV Dahil / Hariç" },
  { id: "kidem", title: "Kıdem Tazminatı" },
  { id: "ihbar", title: "İhbar Tazminatı" },
  { id: "sgk", title: "SGK İşveren Maliyeti" },
  { id: "binek", title: "Binek Araç Gider Kısıtlaması" },
  { id: "finansman", title: "Finansman Gider Kısıtlaması" },
  { id: "amortisman", title: "Amortisman Hesaplama" },
  { id: "mtv", title: "MTV Hesaplama" },
  { id: "kur", title: "Kur Değerleme" },
  { id: "adat", title: "Adat Hesaplama" },
  { id: "police", title: "Poliçe Giderleştirme" },
];

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

        <div className="mt-10">
          <KdvCalculator />
        </div>

        <section className="mt-14">
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
            Tüm Hesaplama Araçları
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Aktif olmayan araçlar yakında kullanıma açılacaktır.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tools.map((tool) => (
              <article
                key={tool.id}
                className={`rounded-2xl border p-5 transition ${
                  tool.active
                    ? "border-violet-300 bg-violet-50/70 shadow-sm"
                    : "border-violet-100 bg-white hover:border-violet-200 hover:shadow-md hover:shadow-violet-500/5"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-slate-900">{tool.title}</h3>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                      tool.active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-violet-100 text-violet-700"
                    }`}
                  >
                    {tool.active ? "Aktif" : "Yakında"}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-500">
                  {tool.active
                    ? "Hesaplama modülü kullanıma hazır."
                    : "Bu araç üzerinde çalışılıyor."}
                </p>
              </article>
            ))}
          </div>
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
