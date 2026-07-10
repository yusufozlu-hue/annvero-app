import { redirect } from "next/navigation";

export const metadata = {
  title: "Kıdem ve İhbar Tazminatı Hesaplama | ANNVERO",
  description:
    "İşe giriş ve çıkış tarihine göre kıdem ve ihbar tazminatı brüt/net hesaplama aracı.",
};

export default function KidemIhbarHesaplamaShortcutPage() {
  redirect("/ik-personel/kidem-ihbar");
}
