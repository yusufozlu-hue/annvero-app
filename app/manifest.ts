import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ANNVERO | Muhasebe ve Vergi Yönetimi",
    short_name: "ANNVERO",
    description:
      "Muhasebe süreçlerinizi otomatikleştirin, vergisel risklerinizi azaltın ve mali operasyonlarınızı tek merkezden yönetin.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    theme_color: "#030712",
    background_color: "#030712",
    lang: "tr",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
