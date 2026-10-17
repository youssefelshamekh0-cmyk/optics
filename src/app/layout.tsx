import type { Metadata, Viewport } from "next";
import "./globals.css";
import { InstallPrompt, PwaRegister } from "@/components/pwa";

export const metadata: Metadata = {
  title: "نظرة | إدارة الفروع",
  description: "نظام إدارة متاجر البصريات",
  applicationName: "نظرة",
  appleWebApp: { capable: true, title: "نظرة", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { themeColor: "#27685f", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}<PwaRegister /><InstallPrompt /></body></html>;
}
