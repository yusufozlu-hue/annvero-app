"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AnnveroModuleNav from "@/app/components/AnnveroModuleNav";
import AnnveroLogo from "@/app/components/AnnveroLogo";

function IconBase({ children }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
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

function HomeIcon() {
  return (
    <IconBase>
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
      <path d="M9 21v-6h6v6" />
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

function ScaleIcon() {
  return (
    <IconBase>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M7 7 5 21" />
      <path d="M17 7l2 14" />
      <path d="M9 13h6" />
    </IconBase>
  );
}

function SparklesIcon() {
  return (
    <IconBase>
      <path d="M9.5 2 11 7l5 1.5L11 10l-1.5 5L8 10l-5-1.5L8 7z" />
      <path d="M18 12 19 16l4 1-4 1-1 4-1-4-4-1 4-1 1-4z" />
    </IconBase>
  );
}

function LayersIcon() {
  return (
    <IconBase>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.84Z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </IconBase>
  );
}

const links = [
  { title: "Muhasebe Ana Sayfa", href: "/muhasebe", Icon: HomeIcon },
  {
    title: "Fiş Dönüştürme",
    href: "/muhasebe/fis-donusturme",
    Icon: LayersIcon,
  },
  { title: "Hesap Planı", href: "/muhasebe/hesap-plani", Icon: FileSpreadsheetIcon },
  { title: "Kural Motoru", href: "/muhasebe/kural-motoru", Icon: SettingsIcon },
  { title: "Banka Parser", href: "/muhasebe/banka-ekstresi", Icon: LandmarkIcon },
  {
    title: "Banka Mutabakat",
    href: "/muhasebe/banka-mutabakat",
    Icon: ScaleIcon,
  },
  {
    title: "Luca Aktarım Kontrol",
    href: "/muhasebe/luca-aktarim-kontrol",
    Icon: ShieldCheckIcon,
  },
  {
    title: "Kur Değerleme",
    href: "/muhasebe/kur-degerleme",
    Icon: ScaleIcon,
  },
  {
    title: "Finansman Gider Kısıtlaması",
    href: "/muhasebe/finansman-gider-kisitlamasi",
    Icon: ShieldCheckIcon,
  },
  {
    title: "Poliçe Giderleştirme",
    href: "/muhasebe/police-giderlestirme",
    Icon: FileSpreadsheetIcon,
  },
  {
    title: "Adat Hesaplama",
    href: "/muhasebe/adat-hesaplama",
    Icon: ScaleIcon,
  },
  {
    title: "KDV Matrah Kontrol",
    href: "/muhasebe/kdv-matrah-kontrol",
    Icon: ShieldCheckIcon,
  },
  {
    title: "Luca Fiş Üretici",
    href: "/muhasebe/luca-donusturucu",
    Icon: FileTextIcon,
  },
  { title: "Fiş Kontrol", href: "/muhasebe/fis-kontrol", Icon: ShieldCheckIcon },
  { title: "AI Kontrol", href: "/muhasebe/ai-kontrol", Icon: SparklesIcon },
  { title: "Öğrenen Hafıza", href: "/muhasebe/ogrenen-hafiza", Icon: BrainIcon },
  { title: "Elektraweb", href: "/muhasebe/elektraweb", Icon: RefreshCwIcon },
];

export default function MuhasebeMenu() {
  const pathname = usePathname();

  const isActive = (href) =>
    href === "/muhasebe" ? pathname === "/muhasebe" : pathname.startsWith(href);

  return (
    <>
      <div className="mb-4 flex items-center gap-4">
        <Link href="/muhasebe" aria-label="Muhasebe ana sayfa">
          <AnnveroLogo onLight={false} size={30} />
        </Link>
        <AnnveroModuleNav variant="muhasebe-subpage" />
      </div>
      <nav className="mb-8 -mx-1 overflow-x-auto pb-2">
      <div className="flex w-max gap-2 rounded-2xl border border-white/10 bg-white/5 p-1.5 backdrop-blur-xl sm:w-full sm:flex-wrap">
        {links.map(({ title, href, Icon }) => {
          const active = isActive(href);

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`group inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                active
                  ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/30"
                  : "text-gray-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span
                className={`transition-colors ${
                  active ? "text-white" : "text-gray-500 group-hover:text-white"
                }`}
              >
                <Icon />
              </span>
              {title}
            </Link>
          );
        })}
      </div>
    </nav>
    </>
  );
}
