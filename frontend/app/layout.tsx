import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/Providers";
import { Toaster } from "react-hot-toast";
import AnnouncementBanner from "./components/AnnouncementBanner";
import type { Metadata } from "next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UCSC Pok\u00e9shop",
  description: "Inventory reservation system for UCSC students",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <Providers>
          <Toaster position="top-center" toastOptions={{ duration: 3000, style: { borderRadius: '12px', padding: '12px 16px' } }} />
          <AnnouncementBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
