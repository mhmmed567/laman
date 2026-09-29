import type { Metadata } from "next";
import "./globals.css";
import "./ledger.css";

export const metadata: Metadata = {
  title: "دفتر المبيعات",
  description: "إدارة المنتجات المستلمة والمبيعات والمسترجعات والأرباح.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
