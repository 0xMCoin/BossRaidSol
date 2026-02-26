import type { Metadata } from "next";
import "./globals.css";
import { Sora, Be_Vietnam_Pro } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

const sora = Sora({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
});

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800"],
  variable: "--font-be-vietnam-pro",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CT WARS",
  description: "CT WARS - Real-time trading battle",
  keywords: [
    "CT WARS",
    "real-time trading battle",
    "pump portal",
    "solana",
    "crypto",
    "web3",
  ],
  authors: [{ name: "CT WARS Team" }],
  creator: "CT WARS",
  publisher: "CT WARS",
  robots: "index, follow",
  manifest: "/manifest.json",
  openGraph: {
    title: "CT WARS",
    description: "Real-time trading battle on Solana",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/images/hero_bg.jpg",
        width: 1200,
        height: 630,
        alt: "CT WARS",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CT WARS",
    description: "Real-time trading battle on Solana",
    images: ["/hero_bg.jpg"],
  },
  icons: {
    icon: [
      { url: "/logo.jpg", sizes: "64x64", type: "image/png" },
      { url: "/logo.jpg", sizes: "192x192", type: "image/png" },
      { url: "/logo.jpg", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/logo.jpg", sizes: "180x180", type: "image/png" }],
  },
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`scroll-smooth antialiased ${sora.variable} ${beVietnamPro.variable}`}
    >
      <head>
        <link rel="icon" href="/logo.png" />
        <meta name="color-scheme" content="dark" />
      </head>
      <body className="min-h-screen bg-background text-foreground flex flex-col">
        <main className="flex-1">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
