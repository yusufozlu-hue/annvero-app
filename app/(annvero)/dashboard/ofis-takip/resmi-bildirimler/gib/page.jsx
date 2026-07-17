"use client";

import ResmiBildirimShell from "../components/ResmiBildirimShell";
import GibTebligatPanel from "../components/GibTebligatPanel";

export default function GibTebligatPage() {
  return (
    <ResmiBildirimShell
      title="GİB e-Tebligat Kontrol Merkezi"
      description="Doğrulama kodu ile manuel kontrol, toplu firma taraması, hatırlatmalar ve mobil push bildirimleri."
    >
      <GibTebligatPanel />
    </ResmiBildirimShell>
  );
}
