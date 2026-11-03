import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({ subsets: ["hebrew", "latin"], weight: ["400", "500", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "טיוטת כתב תביעה קטנה",
  description: "סוכן שמראיין אותך ומכין טיוטת כתב תביעה לבית משפט לתביעות קטנות",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className={heebo.className}>{children}</body>
    </html>
  );
}
