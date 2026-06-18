export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white">
      <header className="fixed left-0 top-0 z-50 flex w-full items-center justify-between border-b border-white/10 bg-black/70 px-8 py-5 backdrop-blur">
        <div className="text-xl font-bold tracking-widest">ANNVERO</div>

        <nav className="hidden gap-8 text-sm text-gray-300 md:flex">
          <a href="#">Platform</a>
          <a href="#">Çözümler</a>
          <a href="#">Yazılar</a>
          <a href="#">İletişim</a>
        </nav>

        <button className="rounded-full border border-white/20 px-5 py-2 text-sm font-semibold">
          Panel Girişi
        </button>
      </header>

      <section className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="mb-4 text-sm uppercase tracking-[0.4em] text-gray-400">
          Audit • Tax • Accounting Intelligence
        </p>

        <h1 className="text-6xl font-bold tracking-tight md:text-8xl">
          ANNVERO
        </h1>

        <p className="mt-6 max-w-2xl text-lg text-gray-300">
          Mali verileri analiz eden, hataları önceden fark eden ve muhasebe
          operasyonlarını akıllı hale getiren yeni nesil platform.
        </p>

        <div className="mt-10 flex gap-4">
          <button className="rounded-full bg-white px-6 py-3 font-semibold text-black">
            Giriş Yap
          </button>

          <button className="rounded-full border border-gray-600 px-6 py-3 font-semibold text-white">
            Platformu İncele
          </button>
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-800 bg-zinc-900 p-6">
            <h3 className="text-xl font-semibold">Mizan Kontrolü</h3>
            <p className="mt-3 text-gray-400">
              Kur farkı, amortisman, bakiyeler ve olağandışı hareketleri analiz eder.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-zinc-900 p-6">
            <h3 className="text-xl font-semibold">Banka Mutabakatı</h3>
            <p className="mt-3 text-gray-400">
              Banka ekstresi ile muhasebe kayıtlarını otomatik karşılaştırır.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-zinc-900 p-6">
            <h3 className="text-xl font-semibold">AI Mali Analiz</h3>
            <p className="mt-3 text-gray-400">
              Riskli kayıtları ve dikkat edilmesi gereken alanları yorumlar.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}