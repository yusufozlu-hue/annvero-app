"use client";

import Link from "next/link";
import ResmiBildirimShell from "./ResmiBildirimShell";
import { CHANNEL_META } from "@/src/config/resmiBildirimDefaults";

export default function ChannelPlaceholder({ channelKey }) {
  const meta = CHANNEL_META[channelKey];

  return (
    <ResmiBildirimShell
      title={meta.label}
      description={`${meta.description} Bu kanal için arayüz hazırlanıyor; veriler ortak official_notifications tablosunda saklanacak.`}
    >
      <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 p-10 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-950/60 text-2xl font-bold text-violet-200 ring-1 ring-violet-700/40">
          {meta.shortLabel}
        </div>
        <h2 className="text-xl font-semibold">Hazırlık Aşamasında</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-gray-400">
          {meta.label} entegrasyonu bir sonraki sürümde aktif olacak. Şimdilik GİB e-Tebligat
          kontrol ve hatırlatmalarını kullanabilirsiniz.
        </p>
        <Link
          href={CHANNEL_META.gib.href}
          className="mt-6 inline-flex rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold hover:bg-violet-500"
        >
          GİB e-Tebligat&apos;a Git
        </Link>
      </div>
    </ResmiBildirimShell>
  );
}
