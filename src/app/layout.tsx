import type { Metadata } from "next";
import { AppProviders } from "./providers";
import "antd/dist/reset.css";
import "../web/styles/design-system.css";
import "./globals.css";

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
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
