import Link from "next/link";
import PublicHeader from "./PublicHeader";
import AnnveroLogo from "@/app/components/AnnveroLogo";

const services = [
  {
    title: "Akıllı Muhasebe",
    description:
      "Fiş üretimi, hesap eşleştirme ve kural motoru ile muhasebe kayıtlarını otomatikleştirin.",
  },
  {
    title: "Vergi Danışmanlığı",
    description:
      "Güncel mevzuat ve vergisel riskleri takip ederek doğru kararlar alın.",
  },
  {
    title: "Banka Entegrasyonu",
    description:
      "Banka ekstrelerini standart formata dönüştürün, cari eşleştirmeyi hızlandırın.",
  },
  {
    title: "Rapor & Analiz",
    description:
      "Operasyonel verileri anlamlı raporlara dönüştürün, yönetim kararlarını destekleyin.",
  },
  {
    title: "Ofis Yönetimi",
    description:
      "Firma, personel, araç ve belge süreçlerini tek merkezden yönetin.",
  },
  {
    title: "AI Destekli Kontrol",
    description:
      "Öğrenen hafıza ve akıllı kontrollerle hataları erken yakalayın.",
  },
];

const calculators = [
  "Kıdem Tazminatı",
  "İhbar Tazminatı",
  "KDV Hesaplama",
  "SGK Prim Hesaplama",
  "Binek Araç Gider Kısıtlaması",
  "Finansman Gider Kısıtlaması",
];

const taxGuideItems = [
  {
    title: "2026 Kurumlar Vergisi Güncellemeleri",
    date: "Mart 2026",
    tag: "Kurumlar",
  },
  {
    title: "KDV Beyannamesi Hazırlık Rehberi",
    date: "Şubat 2026",
    tag: "KDV",
  },
  {
    title: "SGK Teşvik ve Prim Uygulamaları",
    date: "Ocak 2026",
    tag: "SGK",
  },
  {
    title: "Binek Araç Gider Kısıtlaması Özet",
    date: "Aralık 2025",
    tag: "Gider",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />

      <main>
        <section className="relative overflow-hidden bg-white">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-violet-200/40 blur-3xl" />
            <div className="absolute right-0 top-20 h-96 w-96 rounded-full bg-purple-100/60 blur-3xl" />
          </div>

          <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-24">
            <div>
              <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-violet-700">
                ANNVERO Platform
              </span>

              <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                Muhasebe ve Vergi Yönetiminde{" "}
                <span className="bg-gradient-to-r from-violet-700 to-purple-600 bg-clip-text text-transparent">
                  Akıllı Dönüşüm
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
                ANNVERO ile muhasebe süreçlerinizi otomatikleştirin, vergisel
                risklerinizi azaltın ve mali operasyonlarınızı tek merkezden
                yönetin.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href="#hizmetler"
                  className="inline-flex items-center justify-center rounded-full bg-violet-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:bg-violet-800"
                >
                  Hizmetlerimizi İncele
                </a>
                <Link
                  href="/hesaplama-araclari"
                  className="inline-flex items-center justify-center rounded-full border border-violet-200 bg-white px-6 py-3 text-sm font-semibold text-violet-700 transition hover:bg-violet-50"
                >
                  Hesaplama Araçları
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-white to-violet-50 p-6 shadow-2xl shadow-violet-500/10 sm:p-8">
                <div className="grid grid-cols-2 gap-4">
                  {services.slice(0, 4).map((item) => (
                    <div
                      key={item.title}
                      className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm"
                    >
                      <div className="mb-3 h-2 w-10 rounded-full bg-violet-600" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-xs leading-relaxed text-slate-500">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="hizmetler" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-violet-700">
              Hizmetler
            </p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">
              Kurumsal mali operasyonlar için uçtan uca çözümler
            </h2>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {services.map((service) => (
              <article
                key={service.title}
                className="rounded-3xl border border-violet-100 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-500/10"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                  <span className="text-lg font-bold">A</span>
                </div>
                <h3 className="text-xl font-semibold text-slate-900">
                  {service.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  {service.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="hesaplama-araclari"
          className="border-y border-violet-100 bg-white py-20"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-wider text-violet-700">
                Hesaplama Araçları
              </p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">
                Popüler Hesaplama Araçları
              </h2>
              <p className="mt-4 text-slate-600">
                Sık kullanılan vergi ve bordro hesaplamalarına hızlı erişim.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {calculators.map((title) => (
                <div
                  key={title}
                  className="group rounded-2xl border border-violet-100 bg-slate-50 p-5 transition hover:border-violet-300 hover:bg-violet-50"
                >
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="font-semibold text-slate-900">{title}</h3>
                    <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
                      Yakında
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-500">
                    Hesaplama modülü yakında platformda aktif olacak.
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-10">
              <Link
                href="/hesaplama-araclari"
                className="inline-flex items-center justify-center rounded-full bg-violet-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-800"
              >
                Hesaplama Araçları Merkezi
              </Link>
            </div>
          </div>
        </section>

        <section id="vergi-rehberi" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-violet-700">
              Vergi Rehberi
            </p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">
              Güncel Vergi Rehberi
            </h2>
            <p className="mt-4 text-slate-600">
              Mevzuat değişiklikleri ve pratik uygulama notları için placeholder
              içerik alanı.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
            {taxGuideItems.map((item) => (
              <article
                key={item.title}
                className="rounded-3xl border border-dashed border-violet-200 bg-white p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                    {item.tag}
                  </span>
                  <span className="text-sm text-slate-500">{item.date}</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm text-slate-500">
                  İçerik yakında eklenecek.
                </p>
              </article>
            ))}
          </div>
        </section>

        <section id="hakkimizda" className="border-t border-violet-100 bg-white py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-violet-700">
                Hakkımızda
              </p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">
                ANNVERO ile dijital muhasebe dönüşümü
              </h2>
              <p className="mt-4 leading-relaxed text-slate-600">
                ANNVERO; muhasebe ofisleri, işletmeler ve finans ekipleri için
                tasarlanmış modern bir platformdur. Operasyonel yükü azaltır,
                kontrol gücünü artırır ve vergisel uyumu destekler.
              </p>
            </div>

            <div
              id="iletisim"
              className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-8"
            >
              <p className="text-sm font-semibold uppercase tracking-wider text-violet-700">
                İletişim
              </p>
              <h3 className="mt-3 text-2xl font-bold text-slate-900">
                Birlikte çalışalım
              </h3>
              <p className="mt-4 text-slate-600">
                Demo, entegrasyon veya kurumsal kullanım için bizimle iletişime
                geçin.
              </p>
              <div className="mt-6 space-y-3 text-sm text-slate-700">
                <p>
                  <span className="font-semibold">E-posta:</span>{" "}
                  info@annvero.com
                </p>
                <p>
                  <span className="font-semibold">Telefon:</span> +90 (212) 000
                  00 00
                </p>
                <p>
                  <span className="font-semibold">Adres:</span> İstanbul, Türkiye
                </p>
              </div>
            </div>
          </div>
        </section>
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
