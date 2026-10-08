import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_SCRIPT } from "@/components/theme-script";

export const metadata: Metadata = {
  title: "Nakama Cards",
  description: "Inventory, price stickers, and show sales",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Nakama POS", statusBarStyle: "black" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // the inline script sets data-theme before paint; React must not undo it
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
