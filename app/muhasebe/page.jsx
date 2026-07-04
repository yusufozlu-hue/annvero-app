"use client";

import { useState } from "react";
import Link from "next/link";
import AnnveroModuleNav from "@/app/components/AnnveroModuleNav";
import AnnveroLogo from "@/app/components/AnnveroLogo";

function IconBase({ children }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function Building2Icon() {
  return (
    <IconBase>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </IconBase>
  );
}

function FileTextIcon() {
  return (
    <IconBase>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </IconBase>
  );
}

function ShieldCheckIcon() {
  return (
    <IconBase>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </IconBase>
  );
}

function BrainIcon() {
  return (
    <IconBase>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588 4 4 0 0 0 7.636 2.106 3.2 3.2 0 0 0 .556-6.588 4 4 0 0 0-2.526-5.77A3 3 0 0 0 12 5Z" />
      <path d="M12 5v14" />
      <path d="M9 9h6" />
      <path d="M9 15h6" />
    </IconBase>
  );
}

function CalculatorIcon() {
  return (
    <IconBase>
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <line x1="8" x2="16" y1="6" y2="6" />
      <line x1="8" x2="10" y1="14" y2="14" />
      <line x1="8" x2="10" y1="18" y2="18" />
      <line x1="14" x2="16" y1="14" y2="14" />
      <line x1="14" x2="16" y1="18" y2="18" />
    </IconBase>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

// Tailwind sınıflarının JIT tarafından algılanması için tema stringleri tam yazılır.
const THEMES = {
  blue: {
    border: "from-blue-500/60 via-blue-500/10 to-transparent",
    glow: "bg-blue-500/25",
    iconWrap: "from-blue-500/30 to-blue-600/5 text-blue-200 ring-blue-400/30",
    cardHover: "hover:shadow-blue-500/25",
    arrowHover:
      "group-hover:border-blue-400/60 group-hover:bg-blue-500/20 group-hover:text-blue-200",
    dot: "bg-blue-400",
    badgeText: "text-blue-200",
  },
  violet: {
    border: "from-violet-500/60 via-violet-500/10 to-transparent",
    glow: "bg-violet-500/25",
    iconWrap:
      "from-violet-500/30 to-violet-600/5 text-violet-200 ring-violet-400/30",
    cardHover: "hover:shadow-violet-500/25",
    arrowHover:
      "group-hover:border-violet-400/60 group-hover:bg-violet-500/20 group-hover:text-violet-200",
    dot: "bg-violet-400",
    badgeText: "text-violet-200",
  },
  teal: {
    border: "from-teal-500/60 via-teal-500/10 to-transparent",
    glow: "bg-teal-500/25",
    iconWrap: "from-teal-500/30 to-teal-600/5 text-teal-200 ring-teal-400/30",
    cardHover: "hover:shadow-teal-500/25",
    arrowHover:
      "group-hover:border-teal-400/60 group-hover:bg-teal-500/20 group-hover:text-teal-200",
    dot: "bg-teal-400",
    badgeText: "text-teal-200",
  },
  amber: {
    border: "from-amber-500/60 via-amber-500/10 to-transparent",
    glow: "bg-amber-500/25",
    iconWrap: "from-amber-500/30 to-amber-600/5 text-amber-200 ring-amber-400/30",
    cardHover: "hover:shadow-amber-500/25",
    arrowHover:
      "group-hover:border-amber-400/60 group-hover:bg-amber-500/20 group-hover:text-amber-200",
    dot: "bg-amber-400",
    badgeText: "text-amber-200",
  },
  fuchsia: {
    border: "from-fuchsia-500/60 via-fuchsia-500/10 to-transparent",
    glow: "bg-fuchsia-500/25",
    iconWrap:
      "from-fuchsia-500/30 to-fuchsia-600/5 text-fuchsia-200 ring-fuchsia-400/30",
    cardHover: "hover:shadow-fuchsia-500/25",
    arrowHover:
      "group-hover:border-fuchsia-400/60 group-hover:bg-fuchsia-500/20 group-hover:text-fuchsia-200",
    dot: "bg-fuchsia-400",
    badgeText: "text-fuchsia-200",
  },
};

const categories = [
  {
    id: "firma-yonetimi",
    title: "Firma Yönetimi",
    desc: "Firma, hesap planı, banka, personel, araç ve belge yönetimi.",
    Icon: Building2Icon,
    color: "blue",
    items: [
      {
        title: "Firma Yönetim Merkezi",
        desc: "Firma, banka, kredi kartı, araç, personel ve modül yönetimi.",
        href: "/muhasebe/firma-yonetimi",
      },
      {
        title: "Hesap Planı Yükleme",
        desc: "Firma bazlı hesap planı yükleme ve hesap eşleştirme.",
        href: "/muhasebe/hesap-plani",
      },
      {
        title: "Banka & Kredi Kartları",
        desc: "Firmanın banka hesapları ve kredi kartı tanımları.",
        href: "/muhasebe/firma-yonetimi?tab=banks",
      },
      {
        title: "Personel",
        desc: "Personel kayıtları ve Excel'den toplu yükleme.",
        href: "/muhasebe/firma-yonetimi?tab=employees",
      },
      {
        title: "Araçlar",
        desc: "Firma araç tanımları ve gider hesapları.",
        href: "/muhasebe/firma-yonetimi?tab=vehicles",
      },
      {
        title: "Belge Serileri",
        desc: "Belge türü ve seri tanımlama kuralları.",
        href: "/muhasebe/firma-yonetimi?tab=documents",
      },
    ],
  },
  {
    id: "fis-islemleri",
    title: "Fiş İşlemleri",
    desc: "Banka, Elektraweb ve Luca fiş üretim/dönüştürme araçları.",
    Icon: FileTextIcon,
    color: "violet",
    items: [
      {
        title: "Banka Parser Merkezi",
        desc: "TEB, Kuveyt, Vakıf, Garanti ve Ziraat ekstre parserleri.",
        href: "/muhasebe/banka-ekstresi",
      },
      {
        title: "Elektraweb Fiş Dönüştürücü",
        desc: "Elektraweb fiş listesini Luca aktarım formatına dönüştürür.",
        href: "/muhasebe/elektraweb",
      },
      {
        title: "Luca Fiş Üretici",
        desc: "Standartlaştırılmış verileri Luca aktarım fişine dönüştürür.",
        href: "/muhasebe/luca-donusturucu",
      },
      {
        title: "Kredi Kartı Ekstresi Dönüştürücü",
        desc: "Kredi kartı ekstrelerini fiş formatına dönüştürür.",
        href: null,
      },
      {
        title: "Fiş Dönüştürme Merkezi",
        desc: "Tüm kaynakları tek pipeline ile fişe dönüştürün. (Ana merkez)",
        href: "/muhasebe/fis-donusturme",
      },
    ],
  },
  {
    id: "kontrol-mutabakat",
    title: "Kontrol & Mutabakat",
    desc: "Fiş kontrol, banka mutabakat ve AI tabanlı denetim.",
    Icon: ShieldCheckIcon,
    color: "teal",
    items: [
      {
        title: "Fiş Kontrol Merkezi",
        desc: "Mükerrer fiş, belge no ve hesap kontrol işlemleri.",
        href: "/muhasebe/fis-kontrol",
      },
      {
        title: "Banka Muavin Mutabakat",
        desc: "Banka ekstresi ile Luca 102 muavinini karşılaştırır.",
        href: "/muhasebe/banka-mutabakat",
      },
      {
        title: "AI Kontrol Merkezi",
        desc: "Şüpheli ve olağandışı fiş kayıtlarını kural tabanlı analiz eder.",
        href: "/muhasebe/ai-kontrol",
      },
      {
        title: "Luca Aktarım Kontrol Merkezi",
        desc: "ANNVERO Luca export ile Luca'dan alınan fiş kayıtlarını karşılaştırır.",
        href: "/muhasebe/luca-aktarim-kontrol",
      },
      {
        title: "Kur Değerleme ve Kur Farkı Fiş Motoru",
        desc: "Dövizli hesapların dönem sonu kur değerlemesi ve Luca kur farkı fişi üretimi.",
        href: "/muhasebe/kur-degerleme",
      },
      {
        title: "Finansman Gider Kısıtlaması Motoru",
        desc: "Finansman gider kısıtlaması, KKEG ayrımı ve rapor üretimi.",
        href: "/muhasebe/finansman-gider-kisitlamasi",
      },
      {
        title: "Poliçe Giderleştirme ve Araç Gider Kısıtı Motoru",
        desc: "Sigorta poliçesi giderleştirme, binek araç KKEG ayrımı ve rapor üretimi.",
        href: "/muhasebe/police-giderlestirme",
      },
      {
        title: "Adat Hesaplama ve Faiz Fiş Motoru",
        desc: "Günlük bakiye üzerinden adat/faiz hesaplama ve Luca fiş önerisi.",
        href: "/muhasebe/adat-hesaplama",
      },
      {
        title: "KDV Matrah Kontrol Merkezi",
        desc: "Fatura ve KDV listelerinde matrah-KDV tutarlılık ve mükerrer risk kontrolü.",
        href: "/muhasebe/kdv-matrah-kontrol",
      },
      {
        title: "E-Defter Kontrol Merkezi",
        desc: "E-defter berat öncesi fiş, yevmiye, ters bakiye ve dönem sonu kayıt kontrolleri.",
        href: "/muhasebe/e-defter-kontrol",
      },
    ],
  },
  {
    id: "kural-hafiza",
    title: "Kural & Hafıza",
    desc: "Kural motoru, öğrenen hafıza ve eşleştirme standartları.",
    Icon: BrainIcon,
    color: "amber",
    items: [
      {
        title: "Muhasebe Kural Motoru",
        desc: "Belge türü ve muhasebe kurallarını yönetir.",
        href: "/muhasebe/kural-motoru",
      },
      {
        title: "İşlem Hafızası / Öğrenme Merkezi",
        desc: "Tanınmayan banka işlemlerini düzeltin; sistem benzer açıklamaları öğrenir.",
        href: "/muhasebe/islem-hafizasi",
      },
      {
        title: "Öğrenen Hafıza",
        desc: "Ön izlemede kaydedilen firma bazlı düzeltmeleri yönetin.",
        href: "/muhasebe/ogrenen-hafiza",
      },
      {
        title: "Açıklama Standartları",
        desc: "Fiş açıklama şablonları ve standartlarını yönetin.",
        href: null,
      },
      {
        title: "Cari Eşleştirme",
        desc: "Cari hesap adlarını hesap kodlarıyla eşleştirin.",
        href: null,
      },
    ],
  },
  {
    id: "hesaplama-araclari",
    title: "Hesaplama Araçları",
    desc: "Vergi, poliçe, amortisman, tevkifat ve kur farkı hesaplamaları.",
    Icon: CalculatorIcon,
    color: "fuchsia",
    items: [
      {
        title: "Vergi Hesaplama Araçları",
        desc: "Sık kullanılan vergi hesaplamalarını tek merkezden yapın.",
        href: "/hesaplama-araclari",
      },
      {
        title: "Poliçe Giderleştirme",
        desc: "Sigorta poliçelerini döneme yayarak giderleştirin.",
        href: "/muhasebe/police-giderlestirme",
      },
      {
        title: "Amortisman",
        desc: "Sabit kıymet amortisman hesaplamaları.",
        href: null,
      },
      {
        title: "Tevkifat",
        desc: "KDV ve gelir vergisi tevkifat hesaplamaları.",
        href: null,
      },
      {
        title: "Maaş Hesaplama Merkezi",
        desc: "Brüt-net, net-brüt maaş ve işveren maliyeti hesaplama.",
        href: "/hesaplama-araclari/maas-hesaplama",
      },
      {
        title: "Kıdem ve İhbar Tazminatı",
        desc: "Hizmet süresi ve ücret bileşenlerine göre kıdem/ihbar tazminatı hesaplama.",
        href: "/hesaplama-araclari/kidem-ihbar",
      },
      {
        title: "Toplu Kıdem ve İhbar Tazminatı Hesaplama",
        desc: "Excel personel listesi ile çoklu kıdem, ihbar ve net ödeme hesaplama.",
        href: "/muhasebe/toplu-kidem-ihbar",
      },
      {
        title: "Kur Farkı",
        desc: "Dövizli işlemler için kur farkı hesaplama.",
        href: "/muhasebe/kur-degerleme",
      },
      {
        title: "Finansman Gider Kısıtlaması",
        desc: "YK/ÖK oranına göre finansman gider kısıtlaması ve KKEG hesaplama.",
        href: "/muhasebe/finansman-gider-kisitlamasi",
      },
    ],
  },
];

const footerStats = [
  { label: "Güvenli", color: "bg-emerald-400" },
  { label: "Hızlı", color: "bg-cyan-400" },
  { label: "Doğru", color: "bg-blue-400" },
  { label: "Akıllı", color: "bg-violet-400" },
];

function CategoryCard({ category, onOpen }) {
  const theme = THEMES[category.color];
  const { Icon } = category;

  return (
    <button
      type="button"
      onClick={() => onOpen(category.id)}
      className="group block h-full w-full text-left"
    >
      <div
        className={`relative h-full rounded-3xl bg-gradient-to-br ${theme.border} p-[1.5px] transition-transform duration-300 group-hover:scale-[1.02]`}
      >
        <div
          className={`relative flex h-full flex-col overflow-hidden rounded-[22px] bg-gray-900/70 p-6 shadow-xl shadow-black/30 backdrop-blur-xl transition-shadow duration-300 ${theme.cardHover}`}
        >
          <div
            className={`pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full ${theme.glow} opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-100`}
          />

          <div className="relative flex items-start justify-between">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${theme.iconWrap} ring-1`}
            >
              <Icon />
            </div>

            <span
              className={`flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400 transition-all duration-300 group-hover:translate-x-0.5 ${theme.arrowHover}`}
            >
              <ArrowRightIcon />
            </span>
          </div>

          <h3 className="relative mt-6 text-xl font-semibold text-gray-100">
            {category.title}
          </h3>
          <p className="relative mt-2 flex-1 text-sm leading-relaxed text-gray-400">
            {category.desc}
          </p>

          <div className="relative mt-5 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium ${theme.badgeText}`}
            >
              <span
                className={`h-1.5 w-1.5 animate-pulse rounded-full ${theme.dot}`}
              />
              {category.items.length} modül
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function SubModuleCard({ item, theme }) {
  const available = Boolean(item.href);

  const inner = (
    <div
      className={`relative h-full rounded-3xl bg-gradient-to-br ${theme.border} p-[1.5px] transition-transform duration-300 ${
        available ? "group-hover:scale-[1.02]" : "opacity-60"
      }`}
    >
      <div
        className={`relative flex h-full flex-col overflow-hidden rounded-[22px] bg-gray-900/70 p-5 shadow-xl shadow-black/30 backdrop-blur-xl transition-shadow duration-300 ${
          available ? theme.cardHover : ""
        }`}
      >
        <div className="relative flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-100">{item.title}</h3>

          {available ? (
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400 transition-all duration-300 group-hover:translate-x-0.5 ${theme.arrowHover}`}
            >
              <ArrowRightIcon />
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gray-400">
              Yakında
            </span>
          )}
        </div>

        <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-400">
          {item.desc}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium ${
              available ? theme.badgeText : "text-gray-500"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                available ? `animate-pulse ${theme.dot}` : "bg-gray-600"
              }`}
            />
            {available ? "Aktif" : "Yakında"}
          </span>
        </div>
      </div>
    </div>
  );

  if (!available) {
    return <div className="block h-full cursor-not-allowed">{inner}</div>;
  }

  return (
    <Link href={item.href} className="group block h-full">
      {inner}
    </Link>
  );
}

export default function Page() {
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const activeCategory = categories.find((c) => c.id === activeCategoryId) || null;

  return (
    <main className="relative min-h-screen overflow-hidden bg-gray-950 p-6 text-white sm:p-10">
      {/* Arka plan neon glow katmanları */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-600/20 blur-[120px]" />
        <div className="absolute -right-24 top-20 h-96 w-96 rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-cyan-600/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl">
        <AnnveroModuleNav variant="muhasebe-home" className="mb-8" />

        {/* Üst bölüm */}
        <header className="mb-12 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-gray-300 backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Annvero Platform
            </span>

            <div className="mt-5">
              <AnnveroLogo onLight={false} size={52} priority />
            </div>

            <h2 className="mt-2 text-2xl font-semibold text-gray-200 sm:text-3xl">
              Muhasebe Modülü
            </h2>

            <p className="mt-3 max-w-xl text-base text-gray-400">
              {activeCategory
                ? activeCategory.desc
                : "Modülleri kategoriler altında tek çatıdan yönetin"}
            </p>
          </div>

          <div className="relative rounded-3xl p-[1.5px] bg-gradient-to-br from-white/20 via-white/5 to-transparent">
            <div className="rounded-[22px] bg-white/5 px-6 py-5 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/30 to-cyan-500/10 text-emerald-200 ring-1 ring-emerald-400/30">
                  <ShieldCheckIcon />
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-100">
                    Tüm muhasebe süreçleri
                  </p>
                  <p className="text-sm text-gray-400">tek platformda</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {!activeCategory ? (
          /* Ana kategori kartları */
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                onOpen={setActiveCategoryId}
              />
            ))}
          </div>
        ) : (
          /* Kategori detayı: alt modüller */
          <div>
            <div className="mb-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setActiveCategoryId(null)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10"
              >
                <ArrowLeftIcon />
                Geri
              </button>

              <div className="flex items-center gap-3">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${
                    THEMES[activeCategory.color].iconWrap
                  } ring-1`}
                >
                  <activeCategory.Icon />
                </span>
                <h3 className="text-2xl font-bold text-gray-100">
                  {activeCategory.title}
                </h3>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {activeCategory.items.map((item) => (
                <SubModuleCard
                  key={item.title}
                  item={item}
                  theme={THEMES[activeCategory.color]}
                />
              ))}
            </div>
          </div>
        )}

        {/* Alt bilgi barı */}
        <div className="mt-12 rounded-3xl border border-white/10 bg-white/5 px-6 py-5 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 sm:justify-between">
            {footerStats.map((stat) => (
              <div key={stat.label} className="flex items-center gap-2.5">
                <span className={`h-2 w-2 rounded-full ${stat.color}`} />
                <span className="text-sm font-medium text-gray-300">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
