"use client";

import Link from "next/link";
import { useState } from "react";
import KdvCalculator from "./KdvCalculator";
import KdvDahilHaricCalculator from "./KdvDahilHaricCalculator";

const tools = [
  {
    id: "kdv",
    title: "KDV Hesaplama",
    active: true,
    component: KdvCalculator,
    description: "Matrah ve KDV oranına göre anlık hesaplama yapın.",
  },
  {
    id: "kdv-dahil",
    title: "KDV Dahil / Hariç",
    active: true,
    component: KdvDahilHaricCalculator,
    description:
      "KDV hariç tutardan dahile veya KDV dahil tutardan hariç tutarı hesaplayın.",
  },
  {
    id: "kidem-ihbar",
    title: "Kıdem ve İhbar Tazminatı Hesaplama",
    active: true,
    href: "/hesaplama-araclari/kidem-ihbar",
    description:
      "Hizmet süresi, brüt ücret ve menfaatlere göre kıdem ve ihbar tazminatı brüt/net hesaplama.",
  },
  { id: "sgk", title: "SGK İşveren Maliyeti" },
  { id: "binek", title: "Binek Araç Gider Kısıtlaması" },
  { id: "finansman", title: "Finansman Gider Kısıtlaması" },
  { id: "adat", title: "Adat Hesaplama" },
  { id: "police", title: "Poliçe Giderleştirme" },
  { id: "ihracat", title: "İhracat İndirimi Hesaplama" },
  { id: "kar-dagitim", title: "Kar Dağıtım Tablosu" },
  {
    id: "maas-hesaplama",
    title: "Maaş Hesaplama Merkezi",
    active: true,
    href: "/hesaplama-araclari/maas-hesaplama",
    description:
      "Brüt-net ve net-brüt maaş, SGK primleri, gelir vergisi ve işveren maliyeti hesaplayın.",
  },
  { id: "bordro", title: "Bordro Hesaplama", href: "/hesaplama-araclari/maas-hesaplama", description: "Maaş Hesaplama Merkezi'ne yönlendirir." },
  { id: "tazminat-toplu", title: "Tazminat Hesaplama Toplu" },
];

function ChevronIcon({ isOpen }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-5 w-5 shrink-0 text-violet-600 transition-transform ${
        isOpen ? "rotate-180" : ""
      }`}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function CalculatorToolsGrid() {
  const [activeCalculator, setActiveCalculator] = useState("kdv");

  const handleActiveToolToggle = (toolId) => {
    setActiveCalculator((current) => (current === toolId ? null : toolId));
  };

  return (
    <div className="mt-8 flex flex-col gap-4">
      {tools.map((tool) => {
        if (tool.active && tool.href) {
          return (
            <article
              key={tool.id}
              className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm transition hover:border-violet-200 hover:shadow-md hover:shadow-violet-500/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{tool.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{tool.description}</p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Aktif
                </span>
              </div>
              <Link
                href={tool.href}
                className="mt-4 inline-flex rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800"
              >
                Aracı Aç
              </Link>
            </article>
          );
        }

        if (tool.active && tool.component) {
          const Calculator = tool.component;
          const isOpen = activeCalculator === tool.id;

          return (
            <article
              key={tool.id}
              className={`rounded-2xl border p-5 shadow-sm transition ${
                isOpen
                  ? "border-violet-300 bg-violet-50/70"
                  : "border-violet-100 bg-white hover:border-violet-200 hover:shadow-md hover:shadow-violet-500/5"
              }`}
            >
              <button
                type="button"
                onClick={() => handleActiveToolToggle(tool.id)}
                aria-expanded={isOpen}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {tool.title}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {tool.description}
                  </p>
                </div>
                <ChevronIcon isOpen={isOpen} />
              </button>

              {isOpen ? (
                <div className="mt-4 border-t border-violet-200/80 pt-4">
                  <Calculator />
                </div>
              ) : null}
            </article>
          );
        }

        return (
          <article
            key={tool.id}
            className="rounded-2xl border border-violet-100 bg-white p-5"
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
