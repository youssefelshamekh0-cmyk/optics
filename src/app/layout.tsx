import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "نظرة | إدارة الفروع", description: "نظام إدارة متاجر البصريات" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
