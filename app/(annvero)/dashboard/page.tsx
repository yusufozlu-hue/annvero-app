"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useAdminAccess } from "@/src/hooks/useAdminAccess";
import MevzuatHapNotlariDashboardCard from "@/src/components/MevzuatHapNotlariDashboardCard";
import {
  buildDeclarationDashboardStats,
  loadDeclarationAccrualRecords,
} from "@/src/utils/beyannameTahakkukEngine";
import { annveroPanelClass } from "@/src/styles/annveroDesign";

type KpiCard = {
  label: string;
  value: string;
  helper: string;
  tone: "cyan" | "emerald" | "amber" | "violet" | "rose";
  href?: string;
};

type DashboardLearningStats = {
  pendingUnknown: number | null;
  learnedRules: number | null;
  learnedToday: number | null;
  highConfidenceMatches: number | null;
};

type DeclarationDashboardStats = {
  pending: number;
  paidThisMonth: number;
  underpaidWarnings: number;
  lateFeeFindings: number;
};

const emptyLearningStats: DashboardLearningStats = {
  pendingUnknown: null,
  learnedRules: null,
  learnedToday: null,
  highConfidenceMatches: null,
};

const riskItems = [
  "KDV matrah kontrolünde fark incelemesi gereken firmalar olabilir.",
  "Banka açıklamalarında öğrenilmemiş işlemler kuyrukta bekliyor olabilir.",
  "e-Defter kontrolünde berat dönemi yaklaşan firmaları kontrol edin.",
];

const aiSuggestions = [
  { title: "Unknown kuyruğunu toplu öğretin", href: "/muhasebe/islem-hafizasi", meta: "İşlem Hafızası" },
  { title: "Bekleyen tahakkukları kapatın", href: "/muhasebe/beyanname-tahakkuk", meta: "Beyanname Merkezi" },
  { title: "Otomasyon hatalarını inceleyin", href: "/sistem-loglari", meta: "Sistem Logları" },
];

const recentActivities = [
  { title: "Banka ekstresi işlendi", meta: "Banka Merkezi · 09:04" },
  { title: "Poliçe gider dağıtımı oluşturuldu", meta: "Finansal Analiz · 08:52" },
  { title: "Hap not yayına alındı", meta: "Mevzuat · 08:38" },
  { title: "Firma parametreleri güncellendi", meta: "Sistem · Dün" },
];

const quickActions = [
  { label: "Ekstre Yükle", href: "/muhasebe/banka-ekstresi" },
  { label: "Tahakkuk Kaydı", href: "/muhasebe/beyanname-tahakkuk" },
  { label: "Fiş Kontrol Et", href: "/muhasebe/fis-kontrol" },
  { label: "Unknown Kuyruk", href: "/muhasebe/islem-hafizasi" },
  { label: "Sistem Logları", href: "/sistem-loglari" },
  { label: "Kıdem Hesapla", href: "/ik-personel/kidem-ihbar" },
];

export default function DashboardPage() {
  const { isAdmin } = useAdminAccess();
  const learningStats = emptyLearningStats;
  const [declarationStats] = useState<DeclarationDashboardStats>(() =>
    buildDeclarationDashboardStats(loadDeclarationAccrualRecords())
  );

  const kpiCards = useMemo<KpiCard[]>(
    () => [
      {
        label: "Unknown Kuyruk",
        value: formatStatValue(learningStats.pendingUnknown),
        helper: "Öğrenme bekleyen işlemler",
        tone: "cyan",
        href: "/muhasebe/islem-hafizasi",
      },
      {
        label: "Öğrenilen Kurallar",
        value: formatStatValue(learningStats.learnedRules),
        helper: "Aktif hafıza kayıtları",
        tone: "emerald",
        href: "/muhasebe/ogrenen-hafiza",
      },
      {
        label: "Bugün Öğretilen",
        value: formatStatValue(learningStats.learnedToday),
        helper: "Günlük öğrenme aktivitesi",
        tone: "amber",
      },
      {
        label: "Yüksek Güven Eşleşme",
        value: formatStatValue(learningStats.highConfidenceMatches),
        helper: "AI skoru ≥ 85 öneriler",
        tone: "violet",
      },
      {
        label: "Bekleyen Tahakkuk",
        value: formatStatValue(declarationStats.pending),
        helper: "Ödeme bekleyen kayıtlar",
        tone: "rose",
        href: "/muhasebe/beyanname-tahakkuk",
      },
      {
        label: "Bu Ay Ödenen",
        value: formatStatValue(declarationStats.paidThisMonth),
        helper: "Kapanan tahakkuklar",
        tone: "emerald",
      },
      {
        label: "Eksik Ödeme Uyarısı",
        value: formatStatValue(declarationStats.underpaidWarnings),
        helper: "Tutar farkı tespitleri",
        tone: "amber",
      },
      {
        label: "Gecikme Zammı",
        value: formatStatValue(declarationStats.lateFeeFindings),
        helper: "Tahakkuk üstü farklar",
        tone: "violet",
      },
    ],
    [learningStats, declarationStats]
  );

  return (
    <div className="space-y-6">
      <header className={annveroPanelClass}>
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-cyan-300/80">Dashboard</p>
        <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">Finansal Kontrol Paneli</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Risk göstergeleri, unknown kuyruk, AI önerileri ve yaklaşan işlemler tek ekranda.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <KpiTile key={card.label} card={card} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Bekleyen Görevler & Yaklaşan İşlemler" eyebrow="Operasyon">
          <div className="space-y-3">
            <TaskRow
              label="Unknown işlem kuyruğu"
              value={formatStatValue(learningStats.pendingUnknown)}
              href="/muhasebe/islem-hafizasi"
              status="Öncelikli"
            />
            <TaskRow
              label="Bekleyen tahakkuk"
              value={formatStatValue(declarationStats.pending)}
              href="/muhasebe/beyanname-tahakkuk"
              status="Takip"
            />
            <TaskRow
              label="Eksik ödeme uyarıları"
              value={formatStatValue(declarationStats.underpaidWarnings)}
              href="/muhasebe/beyanname-tahakkuk"
              status="Risk"
            />
            <TaskRow
              label="Sistem log incelemesi"
              value="→"
              href="/sistem-loglari"
              status="Kontrol"
            />
          </div>
        </Panel>

        <Panel title="Kritik Riskler" eyebrow="Öncelik">
          <div className="space-y-3">
            {riskItems.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-amber-500/20 bg-amber-950/20 p-4 text-sm leading-relaxed text-amber-100"
              >
                {item}
              </div>
            ))}
            <Link
              href="/muhasebe/risk-denetim-merkezi"
              className="inline-flex rounded-xl bg-amber-500/90 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
            >
              Risk Merkezine Git
            </Link>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr_0.9fr]">
        <Panel title="AI Önerileri" eyebrow="Asistan">
          <div className="space-y-3">
            {aiSuggestions.map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className="block rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4 transition hover:border-cyan-400/40"
              >
                <div className="font-semibold text-cyan-100">{item.title}</div>
                <div className="mt-1 text-xs text-cyan-300/70">{item.meta}</div>
              </Link>
            ))}
          </div>
        </Panel>

        <MevzuatHapNotlariDashboardCard />

        <Panel title="Son İşlemler" eyebrow="Aktivite">
          <div className="space-y-3">
            {recentActivities.map((activity) => (
              <div key={activity.title} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="font-semibold text-white">{activity.title}</div>
                <div className="mt-1 text-xs text-slate-500">{activity.meta}</div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Hızlı İşlemler" eyebrow="Kısayollar">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {quickActions
              .filter((action) => isAdmin || !action.href.startsWith("/admin"))
              .map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-500/50 hover:bg-cyan-950/20 hover:text-cyan-100"
                >
                  {action.label}
                </Link>
              ))}
          </div>
        </Panel>

        {isAdmin ? (
          <Panel title="Yönetim Kısayolları" eyebrow="Admin">
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/parametre-yonetimi"
                className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500"
              >
                Parametre Yönetimi
              </Link>
              <Link
                href="/admin/mevzuat-hap-notlari"
                className="rounded-xl border border-violet-700 px-4 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-950"
              >
                Hap Not Yönetimi
              </Link>
              <Link
                href="/sistem-loglari"
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-900"
              >
                Sistem Logları
              </Link>
            </div>
          </Panel>
        ) : null}
      </section>
    </div>
  );
}

function formatStatValue(value: number | null) {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("tr-TR");
}

function KpiTile({ card }: { card: KpiCard }) {
  const barClass = {
    cyan: "from-cyan-400",
    emerald: "from-emerald-400",
    amber: "from-amber-400",
    violet: "from-violet-400",
    rose: "from-rose-400",
  }[card.tone];

  const content = (
    <>
      <div className={`mb-4 h-2 w-16 rounded-full bg-gradient-to-r ${barClass} to-transparent`} />
      <div className="text-sm text-slate-400">{card.label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{card.value}</div>
      <div className="mt-2 text-xs leading-relaxed text-slate-500">{card.helper}</div>
    </>
  );

  if (card.href) {
    return (
      <Link
        href={card.href}
        className="block rounded-[26px] border border-slate-800 bg-slate-950/60 p-5 shadow-xl shadow-black/20 backdrop-blur-xl transition hover:border-cyan-500/30"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-[26px] border border-slate-800 bg-slate-950/60 p-5 shadow-xl shadow-black/20 backdrop-blur-xl">
      {content}
    </div>
  );
}

function TaskRow({
  label,
  value,
  href,
  status,
}: {
  label: string;
  value: string;
  href: string;
  status: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 transition hover:border-cyan-500/30"
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-white">{label}</div>
        <div className="mt-1 text-xs text-slate-500">{status}</div>
      </div>
      <div className="text-xl font-bold text-cyan-100">{value}</div>
    </Link>
  );
}

function Panel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <div className={annveroPanelClass}>
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/70">{eyebrow}</p>
        <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}
