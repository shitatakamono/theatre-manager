import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./AuthProvider";
import { getAppOrigin } from "@/lib/app-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getAppOrigin()),
  title: {
    default: "SeisakuBoard｜舞台・公演制作の管理ツール",
    template: "%s｜SeisakuBoard",
  },
  description: "舞台・公演制作の稽古、出欠、タスク、関係者情報をチームで管理するWebアプリケーションです。",
  applicationName: "SeisakuBoard",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "SeisakuBoard",
    title: "SeisakuBoard｜舞台・公演制作の管理ツール",
    description: "舞台・公演制作の稽古、出欠、タスク、関係者情報をチームで管理するWebアプリケーションです。",
    url: "/",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
