"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import AuthUserBar from "@/src/components/AuthUserBar";
import { useAdminAccess } from "@/src/hooks/useAdminAccess";
import BuildVersionBadge from "@/app/components/BuildVersionBadge";
import MevzuatHapNotlariDashboardCard from "@/src/components/MevzuatHapNotlariDashboardCard";
import {
  buildDeclarationDashboardStats,
  loadDeclarationAccrualRecords,
} from "@/src/utils/beyannameTahakkukEngine";

type MenuItem = {
  label: string;
  href: string;
  badge?: string;
};

type MenuGroup = {
  title: string;
  href?: string;
  items?: MenuItem[];
};

type KpiCard = {
  label: string;
  value: string;
  helper: string;
  tone: "cyan" | "emerald" | "amber" | "violet";
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

type DashboardMemoryRow = {
  status?: string;
  learned_at?: string;
};

type DashboardQueueRow = {
  suggestionScore?: number | string;
  suggestion_score?: number | string;
  metadata?: {
    suggestionConfidence?: string;
  };
};

const menuGroups: MenuGroup[] = [
  { title: "Dashboard", href: "/dashboard" },
  {
    title: "Firmalar",
    items: [
      { label: "Firma Yönetimi", href: "/muhasebe/firma-yonetimi" },
      { label: "Hesap Planı", href: "/muhasebe/hesap-plani" },
      { label: "Ofis Takip", href: "/ofis-takip" },
    ],
  },
  {
    title: "Muhasebe Modülü",
    items: [
      { label: "Muhasebe Ana Sayfa", href: "/muhasebe" },
      { label: "Kural Motoru", href: "/muhasebe/kural-motoru" },
      { label: "Öğrenen Hafıza", href: "/muhasebe/ogrenen-hafiza" },
      { label: "İşlem Hafızası", href: "/muhasebe/islem-hafizasi" },
    ],
  },
  {
    title: "Fiş Üretim Merkezi",
    items: [
      { label: "Fiş Dönüştürme", href: "/muhasebe/fis-donusturme" },
      { label: "Luca Dönüştürücü", href: "/muhasebe/luca-donusturucu" },
      { label: "Luca Aktarım Kontrol", href: "/muhasebe/luca-aktarim-kontrol" },
    ],
  },
  {
    title: "Banka Merkezi",
    items: [
      { label: "Banka Parser Merkezi", href: "/muhasebe/banka-ekstresi" },
      { label: "Banka Mutabakat", href: "/muhasebe/banka-mutabakat" },
    ],
  },
  {
    title: "Kontrol & Denetim",
    items: [
      { label: "Fiş Kontrol", href: "/muhasebe/fis-kontrol" },
      { label: "KDV Matrah Kontrol", href: "/muhasebe/kdv-matrah-kontrol" },
      { label: "e-Defter Kontrol", href: "/muhasebe/e-defter-kontrol" },
      { label: "AI Kontrol", href: "/muhasebe/ai-kontrol" },
    ],
  },
  {
    title: "Fatura Merkezi",
    items: [
      { label: "ElektraWeb", href: "/muhasebe/elektraweb" },
      { label: "Belge Türü Kuralları", href: "/muhasebe/kurallar" },
    ],
  },
  {
    title: "e-Defter Merkezi",
    items: [
      { label: "e-Defter Kontrol", href: "/muhasebe/e-defter-kontrol" },
      { label: "Luca Aktarım Kontrol", href: "/muhasebe/luca-aktarim-kontrol" },
    ],
  },
  {
    title: "Finansal Analiz",
    items: [
      { label: "Adat Hesaplama", href: "/muhasebe/adat-hesaplama" },
      { label: "Kur Değerleme", href: "/muhasebe/kur-degerleme" },
      { label: "Finansman Gider Kısıtlaması", href: "/muhasebe/finansman-gider-kisitlamasi" },
    ],
  },
  {
    title: "Vergi & Beyanname",
    items: [
      { label: "KDV Matrah Kontrol", href: "/muhasebe/kdv-matrah-kontrol" },
      { label: "Beyanname / Tahakkuk", href: "/muhasebe/beyanname-tahakkuk" },
      { label: "Poliçe Giderleştirme", href: "/muhasebe/police-giderlestirme" },
      { label: "Resmi Bildirimler", href: "/dashboard/ofis-takip/resmi-bildirimler" },
    ],
  },
  {
    title: "Kurgan Risk Analizi",
    items: [
      { label: "Risk Kontrol Paneli", href: "/muhasebe/ai-kontrol" },
      { label: "Fiş Kontrol", href: "/muhasebe/fis-kontrol" },
    ],
  },
  {
    title: "İK / Personel Merkezi",
    items: [
      { label: "Personel Operasyon Merkezi", href: "/ik-personel" },
      { label: "Firma Yönetimi", href: "/muhasebe/firma-yonetimi" },
      { label: "Kıdem İhbar", href: "/hesaplama-araclari/kidem-ihbar" },
      { label: "Toplu Kıdem İhbar", href: "/muhasebe/toplu-kidem-ihbar" },
    ],
  },
  {
    title: "Ticaret Sicil / Operasyon Merkezi",
    items: [
      { label: "Operasyon Merkezi", href: "/ticaret-sicil" },
      { label: "Firma Yönetimi", href: "/muhasebe/firma-yonetimi" },
    ],
  },
  {
    title: "Hesaplama Araçları",
    items: [
      { label: "Araçlar Merkezi", href: "/hesaplama-araclari" },
      { label: "Kıdem İhbar", href: "/hesaplama-araclari/kidem-ihbar" },
      { label: "Maaş Hesaplama", href: "/hesaplama-araclari/maas-hesaplama" },
    ],
  },
  {
    title: "Mevzuat & Mali Gündem",
    items: [
      { label: "Mevzuat Hap Notları", href: "/mevzuat-hap-notlari" },
      { label: "Hap Not Yönetimi", href: "/admin/mevzuat-hap-notlari" },
      { label: "Parametre Yönetimi", href: "/admin/parametre-yonetimi" },
    ],
  },
  {
    title: "Rapor Merkezi",
    items: [
      { label: "Banka Mutabakat Raporları", href: "/muhasebe/banka-mutabakat" },
      { label: "Kontrol Raporları", href: "/muhasebe/fis-kontrol" },
    ],
  },
  {
    title: "Otomasyon Merkezi",
    items: [
      { label: "Akışlar", href: "/otomasyon?view=flows" },
      { label: "Tetikleyiciler", href: "/otomasyon?view=triggers" },
      { label: "Görev Kuyruğu", href: "/otomasyon?view=queue" },
      { label: "Sistem Logları", href: "/otomasyon?view=logs" },
      { label: "Hata Yönetimi", href: "/otomasyon?view=errors" },
      { label: "Zamanlanmış İşlemler", href: "/otomasyon?view=schedules" },
      { label: "Entegrasyonlar", href: "/otomasyon?view=integrations" },
    ],
  },
  {
    title: "AI Ofis Asistanı",
    items: [
      { label: "Evrak Havuzu", href: "/ai-ofis-asistani?view=pool" },
      { label: "Mail Gelen Kutusu", href: "/ai-ofis-asistani?view=mail" },
      { label: "AI Sınıflandırma", href: "/ai-ofis-asistani?view=classification" },
      { label: "Firma Eşleştirme", href: "/ai-ofis-asistani?view=matching" },
      { label: "Görevler", href: "/ai-ofis-asistani?view=tasks" },
      { label: "Hatırlatmalar", href: "/ai-ofis-asistani?view=reminders" },
      { label: "İşlem Geçmişi", href: "/ai-ofis-asistani?view=history" },
    ],
  },
  {
    title: "AI Asistan",
    items: [
      { label: "AI Kontrol", href: "/muhasebe/ai-kontrol" },
      { label: "Kurgan Risk Uyarıları", href: "/muhasebe/ai-kontrol" },
    ],
  },
  {
    title: "Ayarlar",
    items: [
      { label: "Mevzuat Parametreleri", href: "/admin/parametre-yonetimi" },
      { label: "Firma Ayarları", href: "/muhasebe/firma-yonetimi" },
    ],
  },
];

const emptyLearningStats: DashboardLearningStats = {
  pendingUnknown: null,
  learnedRules: null,
  learnedToday: null,
  highConfidenceMatches: null,
};

const emptyDeclarationStats: DeclarationDashboardStats = {
  pending: 0,
  paidThisMonth: 0,
  underpaidWarnings: 0,
  lateFeeFindings: 0,
};

const workflowItems = [
  { label: "Banka ekstreleri alındı", value: "42", status: "Tamamlandı" },
  { label: "Fiş satırları oluşturuldu", value: "1.920", status: "İşleniyor" },
  { label: "Öğrenen hafıza önerileri", value: "316", status: "Uygulandı" },
  { label: "Kontrol kuyruğu", value: "18", status: "Bekliyor" },
];

const riskItems = [
  "KDV matrah kontrolünde 3 firma için fark incelemesi öneriliyor.",
  "Banka açıklamalarında öğrenilmemiş 12 işlem tespit edildi.",
  "e-Defter kontrolünde berat dönemi yaklaşan 5 firma var.",
];

const recentActivities = [
  { title: "Vakıfbank ekstresi işlendi", meta: "Banka Merkezi · 09:04" },
  { title: "Poliçe gider dağıtımı oluşturuldu", meta: "Finansal Analiz · 08:52" },
  { title: "Hap not yayına alındı", meta: "Mevzuat & Mali Gündem · 08:38" },
  { title: "Firma parametreleri güncellendi", meta: "Ayarlar · Dün" },
];

const quickActions = [
  { label: "Ekstre Yükle", href: "/muhasebe/banka-ekstresi" },
  { label: "Tahakkuk Kaydı", href: "/muhasebe/beyanname-tahakkuk" },
  { label: "Fiş Kontrol Et", href: "/muhasebe/fis-kontrol" },
  { label: "Firma Aç", href: "/muhasebe/firma-yonetimi" },
  { label: "Hap Not Ekle", href: "/admin/mevzuat-hap-notlari" },
  { label: "Kıdem Hesapla", href: "/hesaplama-araclari/kidem-ihbar" },
  { label: "Resmi Bildirimler", href: "/dashboard/ofis-takip/resmi-bildirimler" },
];

export default function DashboardPage() {
  const { isAdmin } = useAdminAccess();
  const [openMenu, setOpenMenu] = useState<string>("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [learningStats, setLearningStats] =
    useState<DashboardLearningStats>(emptyLearningStats);
  const [declarationStats, setDeclarationStats] =
    useState<DeclarationDashboardStats>(emptyDeclarationStats);

  useEffect(() => {
    let active = true;

    async function loadLearningStats() {
      try {
        const [pendingResponse, allQueueResponse, memoryResponse] = await Promise.all([
          fetch("/api/transaction-memory?status=pending", { cache: "no-store" }),
          fetch("/api/transaction-memory?status=all", { cache: "no-store" }),
          fetch("/api/learning-memory?includeInactive=1", { cache: "no-store" }),
        ]);

        const [pendingPayload, allQueuePayload, memoryPayload] = await Promise.all([
          pendingResponse.json().catch(() => ({})),
          allQueueResponse.json().catch(() => ({})),
          memoryResponse.json().catch(() => ({})),
        ]);

        if (!active) return;

        const pendingRows: DashboardQueueRow[] = Array.isArray(pendingPayload.data)
          ? pendingPayload.data
          : [];
        const allQueueRows: DashboardQueueRow[] = Array.isArray(allQueuePayload.data)
          ? allQueuePayload.data
          : [];
        const memoryRows: DashboardMemoryRow[] = Array.isArray(memoryPayload.data)
          ? memoryPayload.data
          : [];
        const today = new Date();

        setLearningStats({
          pendingUnknown: pendingResponse.ok ? pendingRows.length : null,
          learnedRules: memoryResponse.ok
            ? memoryRows.filter(
                (row) =>
                  !["passive", "deleted"].includes(
                    String(row.status || "active").toLowerCase()
                  )
              ).length
            : null,
          learnedToday: memoryResponse.ok
            ? memoryRows.filter((row) => isSameLocalDay(row.learned_at, today)).length
            : null,
          highConfidenceMatches: allQueueResponse.ok
            ? allQueueRows.filter(
                (row) =>
                  Number(row.suggestionScore || row.suggestion_score || 0) >= 85 ||
                  row.metadata?.suggestionConfidence === "yüksek"
              ).length
            : null,
        });
      } catch (error) {
        console.error("[dashboard] learning stats failed", error);
        if (active) setLearningStats(emptyLearningStats);
      }
    }

    loadLearningStats();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setDeclarationStats(buildDeclarationDashboardStats(loadDeclarationAccrualRecords()));
  }, []);

  const kpiCards = useMemo<KpiCard[]>(
    () => [
      {
        label: "Tanınmayan İşlem Sayısı",
        value: formatStatValue(learningStats.pendingUnknown),
        helper: "Öğrenme Merkezi bekleyen kuyruğu",
        tone: "cyan",
      },
      {
        label: "Öğrenilen Kural Sayısı",
        value: formatStatValue(learningStats.learnedRules),
        helper: "Aktif learning_memory kayıtları",
        tone: "emerald",
      },
      {
        label: "Bugün Öğretilenler",
        value: formatStatValue(learningStats.learnedToday),
        helper: "Bugün kaydedilen hafıza kuralları",
        tone: "amber",
      },
      {
        label: "Yüksek Güvenli Eşleşmeler",
        value: formatStatValue(learningStats.highConfidenceMatches),
        helper: "Skoru yüksek öneri/eşleşme kayıtları",
        tone: "violet",
      },
    ],
    [learningStats]
  );

  return (
    <div className="min-h-screen bg-[#06111f] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_36%),radial-gradient(circle_at_top_right,rgba(124,58,237,0.14),transparent_32%)]" />

      <button
        type="button"
        onClick={() => setMobileMenuOpen((value) => !value)}
        className="fixed left-4 top-4 z-50 rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-2 text-sm font-semibold text-slate-100 shadow-xl shadow-black/30 lg:hidden"
      >
        Menü
      </button>

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[302px] border-r border-slate-800/80 bg-[#071527]/95 shadow-2xl shadow-black/40 backdrop-blur-xl transition-transform lg:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-800 px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
                  ANNVERO
                </p>
                <h1 className="mt-1 text-lg font-bold text-white">Operasyon Paneli</h1>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-lg font-black text-cyan-200 ring-1 ring-cyan-400/30">
                A
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {menuGroups.map((group) => (
              <SidebarGroup
                key={group.title}
                group={group}
                open={openMenu === group.title}
                onToggle={() =>
                  setOpenMenu((current) => (current === group.title ? "" : group.title))
                }
                onNavigate={() => setMobileMenuOpen(false)}
              />
            ))}
          </nav>

          <div className="border-t border-slate-800 p-4">
            <BuildVersionBadge className="mb-3" />
            <p className="text-xs leading-relaxed text-slate-500">
              Premium SaaS panel görünümü. Alt menüler varsayılan kapalıdır.
            </p>
          </div>
        </div>
      </aside>

      {mobileMenuOpen ? (
        <button
          type="button"
          aria-label="Menüyü kapat"
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      ) : null}

      <main className="relative px-4 pb-8 pt-20 sm:px-6 lg:ml-[302px] lg:p-8">
        <header className="mb-8 flex flex-col gap-4 rounded-[28px] border border-slate-800 bg-slate-950/60 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-cyan-300/80">
              Dashboard
            </p>
            <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              Finansal Kontrol Paneli
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
              Firmalar, muhasebe akışları, kontrol uyarıları ve mali gündem tek ekranda.
            </p>
          </div>
          <div className="w-full xl:w-auto xl:shrink-0">
            <AuthUserBar variant="embedded" showAdminLink />
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {kpiCards.map((card) => (
            <KpiTile key={card.label} card={card} />
          ))}
        </section>

        <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            card={{
              label: "Bekleyen Beyanname/Tahakkuk",
              value: formatStatValue(declarationStats.pending),
              helper: "Ödeme bekleyen tahakkuk kayıtları",
              tone: "cyan",
            }}
          />
          <KpiTile
            card={{
              label: "Bu Ay Ödenenler",
              value: formatStatValue(declarationStats.paidThisMonth),
              helper: "Bu ay banka ödemesiyle kapananlar",
              tone: "emerald",
            }}
          />
          <KpiTile
            card={{
              label: "Eksik Ödeme Uyarıları",
              value: formatStatValue(declarationStats.underpaidWarnings),
              helper: "Tahakkuk tutarının altında kalan ödemeler",
              tone: "amber",
            }}
          />
          <KpiTile
            card={{
              label: "Gecikme Zammı Tespitleri",
              value: formatStatValue(declarationStats.lateFeeFindings),
              helper: "Tahakkuk üstü fark dağıtımları",
              tone: "violet",
            }}
          />
        </section>

        <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.9fr]">
          <Panel title="İşlem Akış Özeti" eyebrow="Operasyon Akışı">
            <div className="space-y-4">
              {workflowItems.map((item, index) => (
                <div
                  key={item.label}
                  className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-sm font-bold text-cyan-200 ring-1 ring-cyan-400/30">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white">{item.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.status}</div>
                  </div>
                  <div className="text-right text-xl font-bold text-cyan-100">{item.value}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="AI Risk Uyarıları" eyebrow="Öncelikli Kontrol">
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
                href="/muhasebe/ai-kontrol"
                className="inline-flex rounded-xl bg-amber-500/90 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
              >
                Risk Paneline Git
              </Link>
            </div>
          </Panel>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_1.15fr_0.85fr]">
          <MevzuatHapNotlariDashboardCard />

          <Panel title="Son İşlemler" eyebrow="Aktivite">
            <div className="space-y-3">
              {recentActivities.map((activity) => (
                <div
                  key={activity.title}
                  className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
                >
                  <div className="font-semibold text-white">{activity.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{activity.meta}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Hızlı İşlemler" eyebrow="Kısayollar">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
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
        </section>

        {isAdmin ? (
          <section className="mt-6">
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
              </div>
            </Panel>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function formatStatValue(value: number | null) {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("tr-TR");
}

function isSameLocalDay(value: string | null | undefined, day: Date) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
}

function SidebarGroup({
  group,
  open,
  onToggle,
  onNavigate,
}: {
  group: MenuGroup;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  if (!group.items?.length) {
    return (
      <Link
        href={group.href || "/dashboard"}
        onClick={onNavigate}
        className="flex items-center justify-between rounded-2xl px-3 py-3 text-sm font-semibold text-slate-200 transition hover:bg-cyan-500/10 hover:text-cyan-100"
      >
        {group.title}
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-sm font-semibold text-slate-200 transition hover:bg-cyan-500/10 hover:text-cyan-100"
      >
        <span>{group.title}</span>
        <span className={`text-slate-500 transition ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open ? (
        <div className="mt-1 space-y-1 border-l border-slate-800/80 pl-3">
          {group.items.map((item) => (
            <Link
              key={`${group.title}-${item.label}`}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center justify-between rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-800/70 hover:text-white"
            >
              <span>{item.label}</span>
              {item.badge ? (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KpiTile({ card }: { card: KpiCard }) {
  const barClass = {
    cyan: "from-cyan-400",
    emerald: "from-emerald-400",
    amber: "from-amber-400",
    violet: "from-violet-400",
  }[card.tone];

  return (
    <div className="rounded-[26px] border border-slate-800 bg-slate-950/60 p-5 shadow-xl shadow-black/20 backdrop-blur-xl">
      <div
        className={`mb-4 h-2 w-16 rounded-full bg-gradient-to-r ${barClass} to-transparent`}
      />
      <div className="text-sm text-slate-400">{card.label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{card.value}</div>
      <div className="mt-2 text-xs leading-relaxed text-slate-500">{card.helper}</div>
    </div>
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
    <div className="rounded-[28px] border border-slate-800 bg-slate-950/60 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/70">
          {eyebrow}
        </p>
        <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}
