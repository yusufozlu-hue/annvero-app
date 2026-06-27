"use client";

import KdvCalculator from "./KdvCalculator";

const tools = [
  { id: "kdv", title: "KDV Hesaplama", active: true },
  { id: "kdv-dahil", title: "KDV Dahil / Hariç" },
  { id: "kidem", title: "Kıdem Tazminatı" },
  { id: "ihbar", title: "İhbar Tazminatı" },
  { id: "sgk", title: "SGK İşveren Maliyeti" },
  { id: "binek", title: "Binek Araç Gider Kısıtlaması" },
  { id: "finansman", title: "Finansman Gider Kısıtlaması" },
  { id: "amortisman", title: "Amortisman Hesaplama" },
  { id: "mtv", title: "MTV Hesaplama" },
  { id: "kur", title: "Kur Değerleme" },
  { id: "adat", title: "Adat Hesaplama" },
  { id: "police", title: "Poliçe Giderleştirme" },
  { id: "ihracat", title: "İhracat İndirimi Hesaplama" },
  { id: "kar-dagitim", title: "Kar Dağıtım Tablosu" },
  { id: "fon", title: "Fon Alış Satış Tablosu" },
  { id: "bordro", title: "Bordro Hesaplama" },
  { id: "tazminat-toplu", title: "Tazminat Hesaplama Toplu" },
  { id: "ekstre", title: "Ekstre Karşılaştırma Mutabakat" },
];

export default function CalculatorToolsGrid() {
  return (
    <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
      {tools.map((tool) => {
        if (tool.active) {
          return (
            <article
              key={tool.id}
              className="rounded-2xl border border-violet-300 bg-violet-50/70 p-5 shadow-sm lg:col-span-3"
            >
              <h3 className="text-lg font-semibold text-slate-900">
                {tool.title}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Matrah ve KDV oranına göre anlık hesaplama yapın.
              </p>
              <KdvCalculator />
            </article>
          );
        }

        return (
          <article
            key={tool.id}
            className="rounded-2xl border border-violet-100 bg-white p-5 transition hover:border-violet-200 hover:shadow-md hover:shadow-violet-500/5"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-slate-900">{tool.title}</h3>
              <span className="shrink-0 rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                Yakında
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Bu araç üzerinde çalışılıyor.
            </p>
          </article>
        );
      })}
    </div>
  );
}
