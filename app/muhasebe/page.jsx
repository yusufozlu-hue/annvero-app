import Link from "next/link";

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

function FileSpreadsheetIcon() {
  return (
    <IconBase>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </IconBase>
  );
}

function SettingsIcon() {
  return (
    <IconBase>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}

function LandmarkIcon() {
  return (
    <IconBase>
      <line x1="3" x2="21" y1="22" y2="22" />
      <line x1="6" x2="6" y1="18" y2="11" />
      <line x1="10" x2="10" y1="18" y2="11" />
      <line x1="14" x2="14" y1="18" y2="11" />
      <line x1="18" x2="18" y1="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
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

function RefreshCwIcon() {
  return (
    <IconBase>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
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

const modules = [
  {
    title: "Firma Yönetim Merkezi",
    desc: "Firma, banka, kredi kartı, araç, personel ve modül yönetimi.",
    href: "/muhasebe/firma-yonetimi",
    Icon: Building2Icon,
    border: "from-blue-500/60 via-blue-500/10 to-transparent",
    glow: "bg-blue-500/25",
    iconWrap: "from-blue-500/30 to-blue-600/5 text-blue-200 ring-blue-400/30",
    cardHover: "hover:shadow-blue-500/25",
    arrowHover:
      "group-hover:border-blue-400/60 group-hover:bg-blue-500/20 group-hover:text-blue-200",
    dot: "bg-blue-400",
    badgeText: "text-blue-200",
  },
  {
    title: "Hesap Planı Yükleme",
    desc: "Firma bazlı hesap planı yükleme ve hesap eşleştirme işlemleri.",
    href: "/muhasebe/hesap-plani",
    Icon: FileSpreadsheetIcon,
    border: "from-emerald-500/60 via-emerald-500/10 to-transparent",
    glow: "bg-emerald-500/25",
    iconWrap:
      "from-emerald-500/30 to-emerald-600/5 text-emerald-200 ring-emerald-400/30",
    cardHover: "hover:shadow-emerald-500/25",
    arrowHover:
      "group-hover:border-emerald-400/60 group-hover:bg-emerald-500/20 group-hover:text-emerald-200",
    dot: "bg-emerald-400",
    badgeText: "text-emerald-200",
  },
  {
    title: "Muhasebe Kural Motoru",
    desc: "Belge türü ve muhasebe kurallarını yönetir.",
    href: "/muhasebe/kurallar",
    Icon: SettingsIcon,
    border: "from-orange-500/60 via-orange-500/10 to-transparent",
    glow: "bg-orange-500/25",
    iconWrap:
      "from-orange-500/30 to-orange-600/5 text-orange-200 ring-orange-400/30",
    cardHover: "hover:shadow-orange-500/25",
    arrowHover:
      "group-hover:border-orange-400/60 group-hover:bg-orange-500/20 group-hover:text-orange-200",
    dot: "bg-orange-400",
    badgeText: "text-orange-200",
  },
  {
    title: "Banka Parser Merkezi",
    desc: "TEB, Kuveyt, Vakıf, Garanti ve Ziraat ekstre parserleri.",
    href: "/muhasebe/banka-ekstresi",
    Icon: LandmarkIcon,
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
  {
    title: "Luca Fiş Üretici",
    desc: "Standartlaştırılmış verileri Luca aktarım fişine dönüştürür.",
    href: "/muhasebe/luca-donusturucu",
    Icon: FileTextIcon,
    border: "from-cyan-500/60 via-cyan-500/10 to-transparent",
    glow: "bg-cyan-500/25",
    iconWrap: "from-cyan-500/30 to-cyan-600/5 text-cyan-200 ring-cyan-400/30",
    cardHover: "hover:shadow-cyan-500/25",
    arrowHover:
      "group-hover:border-cyan-400/60 group-hover:bg-cyan-500/20 group-hover:text-cyan-200",
    dot: "bg-cyan-400",
    badgeText: "text-cyan-200",
  },
  {
    title: "Fiş Kontrol Merkezi",
    desc: "Mükerrer fiş, belge no ve hesap kontrol işlemleri.",
    href: "/muhasebe/fis-kontrol",
    Icon: ShieldCheckIcon,
    border: "from-teal-500/60 via-teal-500/10 to-transparent",
    glow: "bg-teal-500/25",
    iconWrap: "from-teal-500/30 to-teal-600/5 text-teal-200 ring-teal-400/30",
    cardHover: "hover:shadow-teal-500/25",
    arrowHover:
      "group-hover:border-teal-400/60 group-hover:bg-teal-500/20 group-hover:text-teal-200",
    dot: "bg-teal-400",
    badgeText: "text-teal-200",
  },
  {
    title: "Elektraweb Fiş Dönüştürücü",
    desc: "Elektraweb fiş listesini Luca aktarım formatına dönüştürür.",
    href: "/muhasebe/elektraweb",
    Icon: RefreshCwIcon,
    border: "from-rose-500/60 via-rose-500/10 to-transparent",
    glow: "bg-rose-500/25",
    iconWrap: "from-rose-500/30 to-rose-600/5 text-rose-200 ring-rose-400/30",
    cardHover: "hover:shadow-rose-500/25",
    arrowHover:
      "group-hover:border-rose-400/60 group-hover:bg-rose-500/20 group-hover:text-rose-200",
    dot: "bg-rose-400",
    badgeText: "text-rose-200",
  },
];

const footerStats = [
  { label: "Güvenli", color: "bg-emerald-400" },
  { label: "Hızlı", color: "bg-cyan-400" },
  { label: "Doğru", color: "bg-blue-400" },
  { label: "Akıllı", color: "bg-violet-400" },
];

export default function Page() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-gray-950 p-6 text-white sm:p-10">
      {/* Arka plan neon glow katmanları */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-600/20 blur-[120px]" />
        <div className="absolute -right-24 top-20 h-96 w-96 rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-cyan-600/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-7xl">
        {/* Üst bölüm */}
        <header className="mb-12 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-gray-300 backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Annvero Platform
            </span>

            <h1 className="mt-5 text-5xl font-black leading-none tracking-tight sm:text-6xl">
              <span className="bg-gradient-to-r from-sky-400 via-blue-400 to-violet-400 bg-clip-text text-transparent">
                ANNVERO
              </span>
            </h1>

            <h2 className="mt-2 text-2xl font-semibold text-gray-200 sm:text-3xl">
              Muhasebe Modülü
            </h2>

            <p className="mt-3 max-w-xl text-base text-gray-400">
              Tüm muhasebe süreçlerinizi tek ekrandan yönetin
            </p>
          </div>

          {/* Sağ üst mini info kartı */}
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

        {/* Modül kartları */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const { Icon } = m;
            return (
              <Link key={m.href} href={m.href} className="group block h-full">
                <div
                  className={`relative h-full rounded-3xl bg-gradient-to-br ${m.border} p-[1.5px] transition-transform duration-300 group-hover:scale-[1.02]`}
                >
                  <div
                    className={`relative flex h-full flex-col overflow-hidden rounded-[22px] bg-gray-900/70 p-6 shadow-xl shadow-black/30 backdrop-blur-xl transition-shadow duration-300 ${m.cardHover}`}
                  >
                    {/* İkon arkası neon glow */}
                    <div
                      className={`pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full ${m.glow} opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-100`}
                    />

                    <div className="relative flex items-start justify-between">
                      <div
                        className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${m.iconWrap} ring-1`}
                      >
                        <Icon />
                      </div>

                      {/* Sağda yuvarlak ok butonu */}
                      <span
                        className={`flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400 transition-all duration-300 group-hover:translate-x-0.5 ${m.arrowHover}`}
                      >
                        <ArrowRightIcon />
                      </span>
                    </div>

                    <h3 className="relative mt-6 text-lg font-semibold text-gray-100">
                      {m.title}
                    </h3>
                    <p className="relative mt-2 flex-1 text-sm leading-relaxed text-gray-400">
                      {m.desc}
                    </p>

                    {/* Alt status badge */}
                    <div className="relative mt-5 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium ${m.badgeText}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 animate-pulse rounded-full ${m.dot}`}
                        />
                        Aktif
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

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
