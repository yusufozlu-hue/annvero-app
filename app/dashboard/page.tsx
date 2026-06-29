"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type Account = {
  code: string;
  name: string;
  currency: string;
};

type Firm = {
  name: string;
  taxNo: string;
  accounts: Account[];
  accountPlanUpdatedAt?: string;
};

const LUCA_HEADERS = [
  "Fiş No",
  "Fiş Tarihi",
  "Fiş Açıklama",
  "Hesap Kodu",
  "Evrak No",
  "Evrak Tarihi",
  "Detay Açıklama",
  "Borç",
  "Alacak",
  "Miktar",
  "Belge Türü",
  "Para Birimi",
  "Kur",
  "Döviz Tutar",
];

function temizle(value: any) {
  return String(value ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function aciklamaTemizle(text: any) {
  let value = temizle(text);

  value = value.replace(/^.*?\bNolu\b\s*/i, "");
  value = value.replace(/Hizmet Alış Faturası/gi, "");
  value = value.replace(/Mal Alış Faturası/gi, "");
  value = value.replace(/Alış Faturası/gi, "");
  value = value.replace(/Satış Faturası/gi, "");
  value = value.replace(/Faturası/gi, "");
  value = value.replace(/\s+/g, " ").trim();

  return value;
}

function excelTarihCevir(value: any) {
  if (!value) return "";

  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return "";

    const gun = String(date.d).padStart(2, "0");
    const ay = String(date.m).padStart(2, "0");
    const yil = date.y;

    return `${gun}.${ay}.${yil}`;
  }

  return temizle(value).replaceAll("/", ".");
}

function sayiCevir(value: any) {
  if (value === "" || value === null || value === undefined) return "";
  const numberValue = Number(value);
  if (isNaN(numberValue)) return "";
  return numberValue;
}

function belgeTuruBul(fisSatirlari: any[]) {
  const hesaplar = fisSatirlari.map((r) => temizle(r["Hesap Kodu"]));
  const evrakNo = temizle(fisSatirlari[0]?.["Evrak No"]).toUpperCase();
  const aciklama = temizle(fisSatirlari[0]?.["Açıklama"]).toUpperCase();

  if (aciklama.includes("NOTER")) return "NM";

  if (
    aciklama.includes("YUSUF ÖZLÜ") ||
    aciklama.includes("YUSUF OZLU") ||
    aciklama.includes("BATUHAN BULUT")
  ) {
    return "SMM";
  }

  if (evrakNo.startsWith("GIB")) return "EA";
  if (evrakNo.startsWith("MDA")) return "EA";

  if (
    evrakNo.startsWith("MRT") ||
    evrakNo.startsWith("MR1") ||
    evrakNo.startsWith("MDF")
  ) {
    return "EF";
  }

  if (hesaplar.some((h) => h.startsWith("102"))) return "DK";
  if (hesaplar.some((h) => h.startsWith("309"))) return "KR";

  return "EF";
}

export default function DashboardPage() {
  const [loaded, setLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const [firmName, setFirmName] = useState("");
  const [taxNo, setTaxNo] = useState("");

  const [firms, setFirms] = useState<Firm[]>([]);
  const [selectedFirm, setSelectedFirm] = useState("");

  const [accountFile, setAccountFile] = useState<File | null>(null);

  const [elektraFile, setElektraFile] = useState<File | null>(null);
  const [elektraKey, setElektraKey] = useState(0);
  const [elektraSatirSayisi, setElektraSatirSayisi] = useState(0);
  const [elektraFisSayisi, setElektraFisSayisi] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem("annvero-firms");

    if (saved) {
      try {
        setFirms(JSON.parse(saved));
      } catch {
        setFirms([]);
      }
    }

    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("annvero-firms", JSON.stringify(firms));
  }, [firms, loaded]);

  const selectedFirmData = firms.find((f) => f.name === selectedFirm);

  const isMare =
    selectedFirmData?.name?.toUpperCase().includes("MARE") ||
    selectedFirmData?.name?.toUpperCase().includes("RESORT");

  const addFirm = () => {
    if (!firmName.trim()) {
      alert("Firma adı gir.");
      return;
    }

    setFirms([
      ...firms,
      {
        name: firmName.trim(),
        taxNo: taxNo.trim(),
        accounts: [],
      },
    ]);

    setFirmName("");
    setTaxNo("");
    setShowModal(false);
  };

  const uploadAccountPlan = async () => {
    if (!selectedFirmData || !accountFile) {
      alert("Lütfen firma seçin ve hesap planı dosyası seçin.");
      return;
    }

    const buffer = await accountFile.arrayBuffer();
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const accounts: Account[] = rows
      .map((row) => {
        const code =
          row["HESAP KODU"] ||
          row["Hesap Kodu"] ||
          row["Kod"] ||
          "";

        const name =
          row["HESAP ADI"] ||
          row["Hesap Adı"] ||
          row["Ad"] ||
          "";

        const currency =
          row["DÖVİZ"] ||
          row["DOVIZ"] ||
          row["PARA BİRİMİ"] ||
          "TL";

        return {
          code: temizle(code),
          name: temizle(name),
          currency: temizle(currency) || "TL",
        };
      })
      .filter((account) => account.code && account.name);

    setFirms(
      firms.map((firm) =>
        firm.name === selectedFirm
          ? {
              ...firm,
              accounts,
              accountPlanUpdatedAt: new Date().toLocaleString("tr-TR"),
            }
          : firm
      )
    );

    setAccountFile(null);
    alert(accounts.length + " hesap başarıyla yüklendi.");
  };

  const exportElektrawebToLuca = async () => {
    if (!elektraFile) {
      alert("Lütfen Elektraweb fiş dosyasını seç.");
      return;
    }

    const buffer = await elektraFile.arrayBuffer();
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const groups: Record<string, any[]> = {};

    rows.forEach((row) => {
      const fisNo = temizle(row["Fiş Numarası"]);
      if (!fisNo) return;

      if (!groups[fisNo]) groups[fisNo] = [];
      groups[fisNo].push(row);
    });

    const fisler = Object.entries(groups);

    setElektraSatirSayisi(rows.length);
    setElektraFisSayisi(fisler.length);

    const chunks: any[][][] = [];

    for (let i = 0; i < fisler.length; i += 50) {
      chunks.push(fisler.slice(i, i + 50).map(([, satirlar]) => satirlar));
    }

    chunks.forEach((chunk, chunkIndex) => {
      const output: any[][] = [LUCA_HEADERS];

      chunk.forEach((fisSatirlari, fisIndex) => {
        const belgeTuru = belgeTuruBul(fisSatirlari);
        const yeniFisNo = chunkIndex * 50 + fisIndex + 1;

        fisSatirlari.forEach((row) => {
          const paraBirimi = temizle(row["Döviz"]).toUpperCase();
          const dovizBorc = sayiCevir(row["Döviz Borç"]);
          const dovizAlacak = sayiCevir(row["Döviz Alacak"]);
          const dovizTutar = dovizBorc || dovizAlacak || "";

          const isDoviz =
            paraBirimi &&
            paraBirimi !== "TRY" &&
            paraBirimi !== "TL";

            const hamAciklama =
            row["Açıklama"] ||
            row["Detay Notları"] ||
            row["Evrak No"] ||
            "Ödeme";
          
          const temizAciklama =
            aciklamaTemizle(hamAciklama) || temizle(hamAciklama);

          output.push([
            yeniFisNo,
            excelTarihCevir(row["Fiş Tarihi"]),
            temizAciklama,
            temizle(row["Hesap Kodu"]),
            temizle(row["Evrak No"]),
            excelTarihCevir(row["Evrak Tarihi"]),
            temizAciklama,
            sayiCevir(row["Borç"]),
            sayiCevir(row["Alacak"]),
            sayiCevir(row["Miktar"]),
            belgeTuru,
            isDoviz ? paraBirimi : "",
            isDoviz ? sayiCevir(row["Kur"]) : "",
            isDoviz ? dovizTutar : "",
          ]);
        });
      });

      const ws = XLSX.utils.aoa_to_sheet(output);

      ws["!cols"] = [
        { wch: 10 },
        { wch: 14 },
        { wch: 70 },
        { wch: 18 },
        { wch: 22 },
        { wch: 14 },
        { wch: 70 },
        { wch: 15 },
        { wch: 15 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 15 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Fiş Aktarım Şablon");

      const fileName =
        "Mare_Resort_Luca_Aktarim_" + (chunkIndex + 1) + ".xlsx";

      XLSX.writeFile(wb, fileName);
    });

    setElektraFile(null);
    setElektraKey((prev) => prev + 1);

    alert(`${fisler.length} fiş işlendi. ${chunks.length} dosya oluşturuldu.`);
  };

  return (
    <main className="min-h-screen bg-black p-8 text-white">
      <section className="mb-10">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-gray-500">
          Modüller
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="relative rounded-3xl bg-gradient-to-br from-violet-500/60 via-violet-500/10 to-transparent p-[1.5px]">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[22px] bg-gray-900/90 p-6 shadow-xl shadow-black/30 backdrop-blur-xl">
              <div className="pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full bg-violet-500/25 opacity-70 blur-2xl" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-violet-600/5 text-violet-200 ring-1 ring-violet-400/30">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  <rect width="20" height="14" x="2" y="6" rx="2" />
                </svg>
              </div>
              <h2 className="relative mt-6 text-2xl font-semibold text-gray-100">
                Ofis Takip
              </h2>
              <p className="relative mt-2 flex-1 text-sm leading-relaxed text-gray-400">
                Günlük ofis iş yönetimi
              </p>
              <Link
                href="/ofis-takip"
                className="relative mt-6 inline-flex w-fit items-center justify-center rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
              >
                Modüle Git
              </Link>
            </div>
          </div>

          <div className="relative rounded-3xl bg-gradient-to-br from-blue-500/60 via-blue-500/10 to-transparent p-[1.5px]">
            <div className="relative flex h-full flex-col overflow-hidden rounded-[22px] bg-gray-900/90 p-6 shadow-xl shadow-black/30 backdrop-blur-xl">
              <div className="pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full bg-blue-500/25 opacity-70 blur-2xl" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/30 to-sky-600/5 text-blue-200 ring-1 ring-blue-400/30">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                  <path d="M8 13h2" />
                  <path d="M14 13h2" />
                  <path d="M8 17h2" />
                  <path d="M14 17h2" />
                </svg>
              </div>
              <h2 className="relative mt-6 text-2xl font-semibold text-gray-100">
                Muhasebe Modülü
              </h2>
              <p className="relative mt-2 flex-1 text-sm leading-relaxed text-gray-400">
                Fiş, banka, kural motoru ve firma yönetimi
              </p>
              <Link
                href="/muhasebe"
                className="relative mt-6 inline-flex w-fit items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                Modüle Git
              </Link>
            </div>
          </div>
        </div>
      </section>

      <h1 className="text-6xl font-bold">Finansal Kontrol Paneli</h1>

      <section className="mt-14 rounded-3xl border border-gray-800 bg-zinc-900 p-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-5xl font-bold">Firmalar</h2>
            <p className="mt-4 text-2xl text-gray-400">
              Firmanın ayrı hesap planı ve özel işlem kuralları tutulacaktır.
            </p>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="rounded-2xl bg-white px-8 py-4 text-2xl font-bold text-black"
          >
            Yeni Firma Ekle
          </button>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-6">
          {firms.length === 0 ? (
            <div className="col-span-3 rounded-2xl border border-dashed border-gray-700 p-10 text-center text-2xl text-gray-500">
              Henüz firma eklenmedi.
            </div>
          ) : (
            firms.map((firm, index) => (
              <div
                key={index}
                onClick={() => {
                  setSelectedFirm(firm.name);
                  setAccountFile(null);
                  setElektraFile(null);
                  setElektraKey((prev) => prev + 1);
                }}
                className="cursor-pointer rounded-2xl border border-gray-800 bg-black p-6 transition hover:border-blue-500"
              >
                <h3 className="text-2xl font-bold text-white">{firm.name}</h3>
                <p className="mt-4 text-gray-400">VKN: {firm.taxNo}</p>
                <p className="mt-2 text-gray-500">
                  Hesap sayısı: {firm.accounts?.length || 0}
                </p>
              </div>
            ))
          )}
        </div>

        {selectedFirmData && (
          <div className="mt-10 rounded-2xl border border-blue-500 bg-black p-8">
            <h3 className="text-4xl font-bold text-blue-400">
              {selectedFirmData.name}
            </h3>

            <div className="mt-8 rounded-2xl border border-gray-700 bg-zinc-900 p-6">
              <h4 className="text-3xl font-bold">Hesap Planı</h4>

              <label className="mt-6 inline-block cursor-pointer rounded-xl border border-gray-600 bg-black px-5 py-3 font-bold text-white hover:border-blue-500">
                Hesap Planı Dosyası Seç
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setAccountFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>

              <p className="mt-3 text-gray-400">
                {accountFile ? accountFile.name : "Dosya seçilmedi"}
              </p>

              <button
                onClick={uploadAccountPlan}
                className="mt-6 rounded-xl bg-white px-5 py-3 font-bold text-black"
              >
                Hesap Planını Yükle
              </button>

              <div className="mt-6 rounded-xl bg-black p-4 text-gray-300">
                <p>
                  Yüklü hesap sayısı:{" "}
                  <strong>{selectedFirmData.accounts?.length || 0}</strong>
                </p>

                <p className="mt-2">
                  Son güncelleme:{" "}
                  <strong>
                    {selectedFirmData.accountPlanUpdatedAt || "Henüz yok"}
                  </strong>
                </p>
              </div>
            </div>

            {isMare && (
              <div className="mt-10 rounded-2xl border border-emerald-500 bg-black p-8">
                <h3 className="text-4xl font-bold text-emerald-400">
                  Mare Resort Elektraweb → Luca
                </h3>

                <p className="mt-4 text-xl text-gray-400">
                  Elektraweb muhasebe fişlerini Luca aktarım formatına dönüştürür.
                </p>

                <label className="mt-8 inline-block cursor-pointer rounded-xl border border-gray-600 bg-black px-6 py-4 font-bold text-white hover:border-emerald-500">
                  Elektraweb Fiş Dosyası Seç
                  <input
                    key={elektraKey}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setElektraFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>

                <p className="mt-4 text-gray-400">
                  {elektraFile ? elektraFile.name : "Dosya seçilmedi"}
                </p>

                <button
                  onClick={exportElektrawebToLuca}
                  className="mt-8 rounded-xl bg-emerald-500 px-6 py-4 font-bold text-black hover:bg-emerald-400"
                >
                  Luca Excel Oluştur
                </button>

                <div className="mt-8 rounded-xl bg-zinc-950 p-5 text-gray-300">
                  <p>
                    Okunan satır sayısı: <strong>{elektraSatirSayisi}</strong>
                  </p>
                  <p className="mt-2">
                    Oluşturulan fiş sayısı: <strong>{elektraFisSayisi}</strong>
                  </p>
                </div>

                <div className="mt-8 rounded-xl border border-gray-700 bg-zinc-950 p-5 text-gray-400">
                  <p className="text-lg font-bold text-white">
                    Aktif Belge Türü Kuralları
                  </p>

                  <ul className="mt-4 space-y-2 text-sm">
                    <li>102 hesap → DK</li>
                    <li>309 hesap → KR</li>
                    <li>GIB / MDA → EA</li>
                    <li>MRT / MR1 / MDF → EF</li>
                    <li>NOTER → NM</li>
                    <li>YUSUF ÖZLÜ / BATUHAN BULUT → SMM</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70">
          <div className="w-[500px] rounded-3xl border border-gray-800 bg-zinc-900 p-8">
            <h2 className="text-4xl font-bold">Yeni Firma</h2>

            <input
              type="text"
              placeholder="Firma Adı"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              className="mt-8 w-full rounded-2xl border border-gray-700 bg-black p-4 text-xl text-white outline-none"
            />

            <input
              type="text"
              placeholder="Vergi No"
              value={taxNo}
              onChange={(e) => setTaxNo(e.target.value)}
              className="mt-4 w-full rounded-2xl border border-gray-700 bg-black p-4 text-xl text-white outline-none"
            />

            <div className="mt-8 flex justify-end gap-4">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-2xl border border-gray-700 px-6 py-3 text-xl"
              >
                İptal
              </button>

              <button
                onClick={addFirm}
                className="rounded-2xl bg-white px-6 py-3 text-xl font-bold text-black"
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}