import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AnnveroSupportWidget from "./components/AnnveroSupportWidget";
import PwaRegister from "./components/PwaRegister";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ANNVERO | Muhasebe ve Vergi Yönetiminde Akıllı Dönüşüm",
  description:
    "ANNVERO ile muhasebe süreçlerinizi otomatikleştirin, vergisel risklerinizi azaltın ve mali operasyonlarınızı tek merkezden yönetin.",
  applicationName: "ANNVERO",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ANNVERO",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
      { url: "/annvero-icon.png" },
    ],
    shortcut: "/annvero-icon.png",
    apple: [{ url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#030712",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-x-hidden antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k='annvero_theme_v1';var t=localStorage.getItem(k);if(t!=='light'&&t!=='dark')t='dark';document.documentElement.dataset.annveroTheme=t;}catch(e){document.documentElement.dataset.annveroTheme='dark';}})();`,
          }}
        />
      </head>
      <body className="flex min-h-full min-w-0 flex-col overflow-x-hidden bg-[var(--annvero-bg)] text-[var(--annvero-text)]">
        {children}
        <AnnveroSupportWidget />
        <PwaRegister />
      </body>
    </html>
  );
}
