"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import MuhasebeMenu from "../components/MuhasebeMenu";
import CompanySelectOptions from "../components/CompanySelectOptions";
import { useCompanyList } from "../hooks/useCompanyList";
import { getCompanyDisplayName } from "@/src/utils/companies";
import { savePendingLucaRows } from "@/src/utils/companyCenter";

type Filtre = "tumu" | "riskli" | "dengesiz" | "aciklama" | "belgeTuru";

const PAGE_SIZE = 25;

export default function ElektrawebPage() {
  const router = useRouter();

  const { companies, selectedCompanyId, setSelectedCompanyId, selectedCompany } =
    useCompanyList();

  const [file, setFile] = useState<File | null>(null);
  const [donem, setDonem] = useState("tum");
  const [yukleniyor, setYukleniyor] = useState(false);

  const [satirSayisi, setSatirSayisi] = useState(0);
  const [fisSayisi, setFisSayisi] = useState(0);
  const [dengeliFis, setDengeliFis] = useState(0);
  const [dengesizFis, setDengesizFis] = useState(0);
  const [aciklamaEksikSatir, setAciklamaEksikSatir] = useState(0);
  const [belgeTuruEksikSatir, setBelgeTuruEksikSatir] = useState(0);
  const [fisler, setFisler] = useState<any[]>([]);

  const [filtre, setFiltre] = useState<Filtre>("tumu");
  const [arama, setArama] = useState("");
  const [page, setPage] = useState(1);
  const [exportAcik, setExportAcik] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [filtre, arama, fisler]);

  const onIzlemeOlustur = async () => {
    if (!file) {
      alert("Önce ElektraWeb fiş dosyasını seçmelisin.");
      return;
    }

    setYukleniyor(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/elektraweb", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Dosya işlenirken hata oluştu.");
        return;
      }

      const siraliFisler = [...data.fisler].sort(
        (a, b) => b.riskPuani - a.riskPuani
      );

      setSatirSayisi(data.toplamSatir ?? data.fisler.length);
      setFisSayisi(data.toplamFis ?? 0);
      setDengeliFis(data.dengeliFis ?? 0);
      setDengesizFis(data.dengesizFis ?? 0);
      setAciklamaEksikSatir(data.aciklamaEksikSatir ?? 0);
      setBelgeTuruEksikSatir(data.belgeTuruEksikSatir ?? 0);
      setFisler(siraliFisler);
      setFiltre("tumu");
    } finally {
      setYukleniyor(false);
    }
  };

  const handleLucaAktar = () => {
    if (fisler.length === 0) {
      alert("Önce ön izleme oluşturmalısın.");
      return;
    }

    savePendingLucaRows({
      companyId: selectedCompanyId,
      companyName: selectedCompany ? getCompanyDisplayName(selectedCompany) : "",
      selectedBank: "ELEKTRAWEB",
      createdAt: new Date().toISOString(),
      rows: fisler.map((f) => ({
        Tarih: f.tarih,
        Aciklama: f.aciklama,
        Tutar: f.borc || f.alacak,
        BelgeTuru: f.belgeTuru,
        LucaAciklama: f.aciklama,
      })),
    });

    router.push("/muhasebe/luca-donusturucu");
  };

  const yuksekRiskli = useMemo(
    () => fisler.filter((f) => f.riskSeviyesi === "Yüksek").length,
    [fisler]
  );

  const ortalamaRisk = useMemo(() => {
    if (fisler.length === 0) return 0;
    const toplam = fisler.reduce((acc, f) => acc + (f.riskPuani || 0), 0);
    return Math.round(toplam / fisler.length);
  }, [fisler]);

  const yuzde = (deger: number, toplam: number) =>
    toplam > 0 ? Math.round((deger / toplam) * 100) : 0;

  const filtrelenmis = useMemo(() => {
    const aramaText = arama.trim().toLocaleLowerCase("tr");

    return fisler.filter((f) => {
      if (filtre === "riskli" && f.durum !== "Riskli") return false;
      if (filtre === "dengesiz" && !f.riskler?.includes("Fiş dengesi bozuk"))
        return false;
      if (filtre === "aciklama" && !f.riskler?.includes("Açıklama boş"))
        return false;
      if (filtre === "belgeTuru" && !f.riskler?.includes("Belge türü boş"))
        return false;

      if (aramaText) {
        const hay = `${f.fisNo} ${f.aciklama} ${f.belgeTuru}`.toLocaleLowerCase(
          "tr"
        );
        if (!hay.includes(aramaText)) return false;
      }

      return true;
    });
  }, [fisler, filtre, arama]);

  const totalPages = Math.max(1, Math.ceil(filtrelenmis.length / PAGE_SIZE));
  const sayfaSatirlari = filtrelenmis.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const exportToExcel = (rows: any[]) => {
    if (rows.length === 0) {
      alert("Dışa aktarılacak satır yok.");
      return;
    }

    const data = rows.map((f) => ({
      "Fiş No": f.fisNo,
      Tarih: f.tarih,
      "Belge Türü": f.belgeTuru,
      Açıklama: f.aciklama,
      Borç: f.borc,
      Alacak: f.alacak,
      "Risk Puanı": f.riskPuani,
      "Risk Seviyesi": f.riskSeviyesi,
      "Kontrol Notu": f.risk,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Kontrol Raporu");
    XLSX.writeFile(wb, "elektraweb_kontrol_raporu.xlsx");
    setExportAcik(false);
  };

  const filtreler: { key: Filtre; label: string }[] = [
    { key: "tumu", label: "Tüm Satırlar" },
    { key: "riskli", label: "Riskliler" },
    { key: "dengesiz", label: "Dengesiz" },
    { key: "aciklama", label: "Açıklama Eksik" },
    { key: "belgeTuru", label: "Belge Türü Eksik" },
  ];

  const statCards = [
    {
      label: "Toplam Fiş",
      value: fisSayisi,
      sub: `${satirSayisi} satır`,
      glow: "from-blue-500/20",
      icon: <FileIcon />,
      iconColor: "text-blue-300",
    },
    {
      label: "Dengeli Fiş",
      value: dengeliFis,
      sub: `%${yuzde(dengeliFis, dengeliFis + dengesizFis)}`,
      glow: "from-emerald-500/20",
      icon: <CheckIcon />,
      iconColor: "text-emerald-300",
    },
    {
      label: "Dengesiz Fiş",
      value: dengesizFis,
      sub: `%${yuzde(dengesizFis, dengeliFis + dengesizFis)}`,
      glow: "from-red-500/20",
      icon: <ScaleIcon />,
      iconColor: "text-red-300",
    },
    {
      label: "Belge Türü Eksik",
      value: belgeTuruEksikSatir,
      sub: `%${yuzde(belgeTuruEksikSatir, satirSayisi)}`,
      glow: "from-amber-500/20",
      icon: <TagIcon />,
      iconColor: "text-amber-300",
    },
    {
      label: "Yüksek Riskli",
      value: yuksekRiskli,
      sub: `%${yuzde(yuksekRiskli, satirSayisi)}`,
      glow: "from-rose-500/20",
      icon: <AlertIcon />,
      iconColor: "text-rose-300",
    },
    {
      label: "Ortalama Risk",
      value: ortalamaRisk,
      sub: "ort. puan",
      glow: "from-violet-500/20",
      icon: <GaugeIcon />,
      iconColor: "text-violet-300",
    },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      {/* Arka plan neon glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute -right-32 top-10 h-96 w-96 rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-[1500px] p-6 sm:p-8">
        {/* Premium navbar */}
        <nav className="mb-8 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 px-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 text-sm font-black">
              A
            </span>
            <span className="bg-gradient-to-r from-sky-400 to-violet-400 bg-clip-text text-lg font-black tracking-tight text-transparent">
              ANNVERO
            </span>
          </div>

          <div className="flex-1 lg:flex lg:justify-center">
            <MuhasebeMenu />
          </div>

          <div className="flex items-center gap-3 px-2">
            <div className="text-right">
              <p className="text-sm font-semibold leading-tight">
                {selectedCompany
                  ? getCompanyDisplayName(selectedCompany)
                  : "Muhasebe"}
              </p>
              <p className="text-xs text-slate-400">ANNVERO Panel</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold">
              AN
            </span>
          </div>
        </nav>

        {/* Sayfa header */}
        <header className="mb-8 flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/30 to-rose-600/10 text-rose-200 ring-1 ring-rose-400/30">
            <RefreshIcon />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Elektraweb Fiş Dönüştürücü
            </h1>
            <p className="mt-2 text-base text-slate-400">
              Elektraweb fiş listesini Luca aktarım formatına dönüştürün.
            </p>
          </div>
        </header>

        {/* Üst işlem kartı */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/30 backdrop-blur-xl sm:p-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-400">
                Firma Seçimi
              </label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none transition focus:border-blue-500"
              >
                <CompanySelectOptions companies={companies} />
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-400">
                Dönem
              </label>
              <select
                value={donem}
                onChange={(e) => setDonem(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none transition focus:border-blue-500"
              >
                <option value="tum">Tüm Dönemler</option>
                <option value="2025">2025</option>
                <option value="2024">2024</option>
                <option value="2023">2023</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-400">
                ElektraWeb Excel Dosyası
              </label>
              <div className="flex items-center gap-3">
                <label className="cursor-pointer rounded-xl border border-slate-700 bg-slate-950 px-5 py-3 font-semibold text-slate-200 transition hover:border-blue-500 hover:text-white">
                  Dosya Seç
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
                <span className="truncate text-sm text-slate-400">
                  {file ? file.name : "Dosya seçilmedi"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-4">
            <button
              onClick={onIzlemeOlustur}
              disabled={yukleniyor}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:from-blue-500 hover:to-violet-500 disabled:opacity-60"
            >
              {yukleniyor ? "İşleniyor..." : "Ön İzleme Oluştur"}
            </button>

            <button
              onClick={handleLucaAktar}
              className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:from-emerald-500 hover:to-teal-500"
            >
              Luca Fiş Üretici’ye Aktar
            </button>
          </div>
        </section>

        {/* İstatistik kartları */}
        {fisler.length > 0 && (
          <section className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {statCards.map((card) => (
              <div
                key={card.label}
                className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur-xl"
              >
                <div
                  className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${card.glow} to-transparent blur-2xl`}
                />
                <div className={`relative ${card.iconColor}`}>{card.icon}</div>
                <p className="relative mt-3 text-sm text-slate-400">
                  {card.label}
                </p>
                <p className="relative mt-1 text-3xl font-bold">{card.value}</p>
                <p className="relative mt-1 text-xs text-slate-500">{card.sub}</p>
              </div>
            ))}
          </section>
        )}

        {/* Kontrol raporu */}
        {fisler.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/30 backdrop-blur-xl">
            <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <h2 className="text-2xl font-bold">ANNVERO Kontrol Raporu</h2>

              <div className="flex flex-wrap items-center gap-2">
                {/* Arama kutusu */}
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                    <SearchIcon />
                  </span>
                  <input
                    value={arama}
                    onChange={(e) => setArama(e.target.value)}
                    placeholder="Ara: fiş, açıklama, belge türü"
                    className="w-56 rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white outline-none transition focus:border-blue-500"
                  />
                </div>

                {/* Filtre butonu (aramayı temizler) */}
                <button
                  onClick={() => {
                    setArama("");
                    setFiltre("tumu");
                  }}
                  className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:text-white"
                >
                  <FilterIcon />
                  Sıfırla
                </button>

                {/* Excel export dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setExportAcik((v) => !v)}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-500 hover:to-teal-500"
                  >
                    <DownloadIcon />
                    Excel
                    <ChevronDownIcon />
                  </button>

                  {exportAcik && (
                    <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
                      <button
                        onClick={() => exportToExcel(fisler)}
                        className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                      >
                        Tümünü Dışa Aktar
                      </button>
                      <button
                        onClick={() => exportToExcel(filtrelenmis)}
                        className="block w-full px-4 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                      >
                        Görünenleri Dışa Aktar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Filtre barı */}
            <div className="mb-5 flex flex-wrap gap-2">
              {filtreler.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFiltre(f.key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    filtre === f.key
                      ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/30"
                      : "border border-slate-700 bg-slate-950 text-slate-300 hover:text-white"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="max-h-[600px] overflow-auto rounded-xl border border-slate-800">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-950">
                  <tr className="text-slate-400">
                    <th className="p-3 font-semibold">Fiş No</th>
                    <th className="p-3 font-semibold">Tarih</th>
                    <th className="p-3 font-semibold">Belge Türü</th>
                    <th className="p-3 font-semibold">Açıklama</th>
                    <th className="p-3 text-right font-semibold">Borç</th>
                    <th className="p-3 text-right font-semibold">Alacak</th>
                    <th className="p-3 text-right font-semibold">Risk</th>
                    <th className="p-3 font-semibold">Seviye</th>
                    <th className="p-3 font-semibold">Kontrol Notu</th>
                    <th className="p-3 text-center font-semibold">İşlem</th>
                  </tr>
                </thead>

                <tbody>
                  {sayfaSatirlari.map((fis) => (
                    <tr
                      key={fis.id}
                      className="border-t border-slate-800 transition-colors hover:bg-slate-800/50"
                    >
                      <td className="p-3 font-medium">{fis.fisNo}</td>
                      <td className="p-3 text-slate-300">{fis.tarih}</td>
                      <td className="p-3">
                        <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs font-medium text-slate-200">
                          {fis.belgeTuru || "-"}
                        </span>
                      </td>
                      <td className="max-w-xs truncate p-3 text-slate-300">
                        {fis.aciklama || "-"}
                      </td>
                      <td className="p-3 text-right tabular-nums">{fis.borc}</td>
                      <td className="p-3 text-right tabular-nums">
                        {fis.alacak}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {fis.riskPuani}
                      </td>
                      <td className="p-3">
                        <RiskBadge seviye={fis.riskSeviyesi} />
                      </td>
                      <td
                        className={`p-3 ${
                          fis.durum === "Riskli"
                            ? "text-yellow-300"
                            : "text-emerald-300"
                        }`}
                      >
                        {fis.risk}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() =>
                            alert(
                              `Fiş No: ${fis.fisNo}\nKontrol: ${fis.risk}`
                            )
                          }
                          title="Detay"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-300 transition hover:border-blue-500 hover:text-white"
                        >
                          <EyeIcon />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {sayfaSatirlari.length === 0 && (
                    <tr>
                      <td
                        colSpan={10}
                        className="p-8 text-center text-slate-500"
                      >
                        Sonuç bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-sm text-slate-500">
                {filtrelenmis.length} kayıt · Sayfa {page}/{totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:text-white disabled:opacity-40"
                >
                  Önceki
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:text-white disabled:opacity-40"
                >
                  Sonraki
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Bilgilendirme alanı */}
        <section className="mt-6 flex items-center gap-3 rounded-2xl border border-blue-900/50 bg-blue-950/30 p-5 text-blue-200 backdrop-blur-xl">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-300">
            <InfoIcon />
          </span>
          <p className="text-sm font-medium">
            Luca’ya aktarılmadan önce fişleri kontrol edin.
          </p>
        </section>
      </div>
    </main>
  );
}

function RiskBadge({ seviye }: { seviye: string }) {
  const styles: Record<string, string> = {
    Yüksek: "border-red-700/60 bg-red-950/50 text-red-300",
    Orta: "border-yellow-700/60 bg-yellow-950/50 text-yellow-300",
    Düşük: "border-emerald-700/60 bg-emerald-950/50 text-emerald-300",
  };

  const cls = styles[seviye] || styles.Düşük;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {seviye}
    </span>
  );
}

function Svg({ children, size = 24 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
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

function RefreshIcon() {
  return (
    <Svg size={28}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </Svg>
  );
}

function FileIcon() {
  return (
    <Svg>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </Svg>
  );
}

function ScaleIcon() {
  return (
    <Svg>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </Svg>
  );
}

function TagIcon() {
  return (
    <Svg>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </Svg>
  );
}

function AlertIcon() {
  return (
    <Svg>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

function GaugeIcon() {
  return (
    <Svg>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </Svg>
  );
}

function SearchIcon() {
  return (
    <Svg size={16}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

function FilterIcon() {
  return (
    <Svg size={16}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </Svg>
  );
}

function DownloadIcon() {
  return (
    <Svg size={16}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </Svg>
  );
}

function ChevronDownIcon() {
  return (
    <Svg size={16}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

function EyeIcon() {
  return (
    <Svg size={16}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

function InfoIcon() {
  return (
    <Svg size={18}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Svg>
  );
}
