"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ResmiBildirimShell from "./components/ResmiBildirimShell";
import { CHANNEL_META, RESMI_BILDIRIM_BASE } from "@/src/config/resmiBildirimDefaults";
import { fetchOfficialNotifications } from "@/src/utils/officialNotificationsApi";

export default function ResmiBildirimlerHubPage() {
  const [stats, setStats] = useState({ total: 0, unread: 0, gib: 0 });

  useEffect(() => {
    fetchOfficialNotifications()
      .then((rows) => {
        setStats({
          total: rows.length,
          unread: rows.filter((row) => row.status === "unread").length,
          gib: rows.filter((row) => row.channel === "gib").length,
        });
      })
      .catch(() => {});
  }, []);

  return (
    <ResmiBildirimShell
      title="Resmi Bildirim & Tebligat Takibi"
      description="GİB, SGK, UETS ve KEP bildirimlerini Ofis Takip modülü altında tek merkezden yönetin."
    >
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <HubStat title="Toplam bildirim" value={stats.total} />
        <HubStat title="Okunmamış" value={stats.unread} />
        <HubStat title="GİB kayıtları" value={stats.gib} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.entries(CHANNEL_META).map(([key, meta]) => (
          <Link
            key={key}
            href={meta.href}
            className="group rounded-2xl border border-gray-800 bg-gray-900 p-5 transition hover:border-violet-600/60 hover:bg-gray-900/80"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{meta.label}</h2>
                <p className="mt-2 text-sm text-gray-400">{meta.description}</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  meta.ready
                    ? "bg-emerald-900/60 text-emerald-100"
                    : "bg-gray-800 text-gray-300"
                }`}
              >
                {meta.ready ? "Aktif" : "Hazırlık"}
              </span>
            </div>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-sm text-gray-500">
        Ofis işleri için klasik takip ekranı:{" "}
        <Link href="/ofis-takip" className="text-violet-300 hover:underline">
          /ofis-takip
        </Link>
        {" · "}
        Bu modül route&apos;u: {RESMI_BILDIRIM_BASE}
      </p>
    </ResmiBildirimShell>
  );
}

function HubStat({ title, value }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="text-sm text-gray-400">{title}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
