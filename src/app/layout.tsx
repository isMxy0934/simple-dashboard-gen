import type { Metadata } from "next";
import { IBM_Plex_Sans, Lexend } from "next/font/google";
import { AppProviders } from "./providers";
import "antd/dist/reset.css";
import "../web/shared/design-system.css";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const lexendDisplay = Lexend({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  variable: "--font-lexend",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Dashboard Studio",
  description: "Phase 1 viewer runtime sandbox",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${ibmPlexSans.variable} ${lexendDisplay.variable}`}
      suppressHydrationWarning
    >
      <body className={ibmPlexSans.className}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
