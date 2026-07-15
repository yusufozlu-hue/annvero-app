"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { useCompanyList } from "../hooks/useCompanyList";
import CompanySelectOptions from "../components/CompanySelectOptions";

const MaliYukumlulukUploadPanel = dynamic(
  () => import("./MaliYukumlulukUploadPanel"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[220px] w-full items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 text-sm text-slate-500 sm:min-h-[260px]">
        Yükleme alanı hazırlanıyor…
      </div>
    ),
  }
);

const DASHBOARD_CARDS = [
  { key: "total", label: "Toplam Tahakkuk", value: "—", hint: "Tüm yükümlülükler" },
  { key: "tax", label: "Vergi Tahakkuku", value: "—", hint: "Vergi belgeleri" },
  { key: "sgk", label: "SGK Tahakkuku", value: "—", hint: "SGK belgeleri" },
  { key: "pending", label: "Bekleyen", value: "—", hint: "İşlem bekleyen" },
  { key: "matched", label: "Eşleşen", value: "—", hint: "Banka ile eşleşen" },
  { key: "fix", label: "Düzeltme", value: "—", hint: "Kontrol / düzeltme" },
];

const PLACEHOLDER_SECTIONS = [
  {
    id: "uploaded",
    title: "Yüklenen Belgeler",
    description: "Yüklenen beyanname, tahakkuk ve XML/PDF kayıtları burada listelenecek.",
  },
  {
    id: "pending",
    title: "Bekleyen Tahakkuklar",
    description: "Banka ödemesi bekleyen veya eşleşme sürecindeki tahakkuklar.",
  },
  {
    id: "matched",
    title: "Banka ile Eşleşenler",
    description: "Banka Parser üzerinden otomatik veya manuel eşleşen kayıtlar.",
  },
  {
    id: "unmatched",
    title: "Eşleşmeyenler",
    description: "Tahakkuk veya banka tarafında eşleşmeyen açık kayıtlar.",
  },
  {
    id: "errors",
    title: "Hatalar",
    description: "Parse, OCR, mükerrer ve doğrulama hataları.",
  },
  {
    id: "history",
    title: "Geçmiş",
    description: "Tamamlanan işlemler ve geçmiş dönem özeti.",
  },
];

function DashboardCard({ label, value, hint }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-950/50 px-4 py-4 shadow-sm shadow-black/10">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-white">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function PlaceholderSection({ title, description }) {
  return (
    <section className="w-full min-w-0 rounded-2xl border border-slate-800/80 bg-slate-950/40">
      <div className="border-b border-slate-800/80 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
      <div className="flex min-h-[140px] items-center justify-center px-4 py-10 sm:min-h-[160px] sm:px-5">
        <p className="text-sm text-slate-500">Henüz kayıt yok.</p>
      </div>
    </section>
  );
}

/**
 * Mali Yükümlülük Merkezi V2 — Vergi & SGK Operasyon Merkezi ana ekranı.
 * Domain / store / API değişmez; yalnızca UI.
 */
export default function MaliYukumlulukPage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompany,
    isLoading,
  } = useCompanyList();

  return (
    <div className="w-full min-w-0 max-w-[1600px] space-y-6 pb-16 text-slate-100">
      <header className="flex flex-col gap-4 border-b border-slate-800/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5 px-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Beyanname Merkezi · Vergi &amp; SGK
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Mali Yükümlülük Merkezi
          </h1>
          <p className="max-w-3xl text-sm text-slate-400">
            Vergi ve SGK tahakkuk operasyonlarının ana ekranı. Belge yükleme,
            eşleştirme ve düzeltme akışları burada toplanır.
          </p>
        </div>

        <div className="w-full shrink-0 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 sm:max-w-md">
          <label className="block text-xs font-medium text-slate-400">
            Aktif firma
          </label>
          <select
            className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-600"
            value={selectedCompanyId || ""}
            disabled={isLoading}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
          >
            <option value="">Firma seçin</option>
            <CompanySelectOptions companies={companies} />
          </select>
          {selectedCompany ? (
            <p className="mt-1.5 truncate text-xs text-slate-500">
              {getCompanyDisplayName(selectedCompany)}
            </p>
          ) : null}
        </div>
      </header>

      <section aria-label="Özet paneli" className="w-full min-w-0">
        <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
          <h2 className="text-sm font-semibold text-slate-200">Operasyon özeti</h2>
          <span className="text-[11px] text-slate-500">Placeholder veriler</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {DASHBOARD_CARDS.map(({ key, ...card }) => (
            <DashboardCard key={key} {...card} />
          ))}
        </div>
      </section>

      <section aria-label="Belge yükleme" className="w-full min-w-0">
        <MaliYukumlulukUploadPanel
          companyId={selectedCompanyId || ""}
          companyName={
            selectedCompany ? getCompanyDisplayName(selectedCompany) : ""
          }
        />
      </section>

      <div className="grid w-full min-w-0 gap-5">
        {PLACEHOLDER_SECTIONS.map((section) => (
          <PlaceholderSection
            key={section.id}
            title={section.title}
            description={section.description}
          />
        ))}
      </div>

      <p className="px-1 text-xs text-slate-500">
        Manuel tahakkuk girişi için{" "}
        <Link
          href="/muhasebe/beyanname-tahakkuk"
          className="text-sky-300 underline-offset-2 hover:underline"
        >
          Beyanname / Tahakkuk
        </Link>
        . Banka ekstresi eşleştirmesi{" "}
        <Link
          href="/muhasebe/banka-ekstresi"
          className="text-sky-300 underline-offset-2 hover:underline"
        >
          Banka Parser
        </Link>{" "}
        üzerinden devam eder.
      </p>
    </div>
  );
}
