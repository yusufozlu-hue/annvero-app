export default function DashboardPage() {
    return (
      <main className="min-h-screen bg-black p-10 text-white">
        <h1 className="text-4xl font-bold">Finansal Kontrol Paneli</h1>
  
        <p className="mt-3 text-gray-400">
          Hoş geldiniz. Mali analiz sistemleri hazır.
        </p>
  
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          
          <div className="rounded-2xl border border-gray-800 bg-zinc-900 p-6">
            <h2 className="text-xl font-semibold">Mizan Kontrolü</h2>
            <p className="mt-2 text-sm text-gray-400">
              Kur farkı, amortisman ve bakiye analizleri.
            </p>
          </div>
  
          <div className="rounded-2xl border border-gray-800 bg-zinc-900 p-6">
            <h2 className="text-xl font-semibold">Banka Mutabakat</h2>
            <p className="mt-2 text-sm text-gray-400">
              Ekstre ile muhasebe kayıtlarını karşılaştırır.
            </p>
          </div>
  
          <div className="rounded-2xl border border-gray-800 bg-zinc-900 p-6">
            <h2 className="text-xl font-semibold">AI Mali Analiz</h2>
            <p className="mt-2 text-sm text-gray-400">
              Riskli hareketleri otomatik yorumlar.
            </p>
          </div>
  
        </div>
      </main>
    )
  }