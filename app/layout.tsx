import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AnnveroSupportWidget from "./components/AnnveroSupportWidget";
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
  icons: {
    icon: "/annvero-icon.png",
    shortcut: "/annvero-icon.png",
    apple: "/annvero-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <AnnveroSupportWidget />
      </body>
    </html>
  );
}
