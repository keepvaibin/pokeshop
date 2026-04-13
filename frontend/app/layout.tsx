import { Montserrat, Open_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/Providers";
import { Toaster } from "react-hot-toast";
import Footer from "./components/Footer";
import type { Metadata } from "next";

const montserrat = Montserrat({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const openSans = Open_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "SCTCG",
  description: "Reservation storefront for SCTCG Pokemon TCG drops, pickups, and campus delivery.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${openSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-pkmn-bg text-pkmn-gray font-sans antialiased">
        <Providers>
          <Toaster
            position="top-center"
            toastOptions={{
              duration: 3000,
              className: '!bg-white !text-pkmn-text !border !border-pkmn-border',
              style: { borderRadius: '0px', padding: '12px 16px' },
            }}
          />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
