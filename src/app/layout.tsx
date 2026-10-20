import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./poslix-theme.css";
import { InstallPrompt, PwaRegister } from "@/components/pwa";
import OfflineSyncStatus from "@/components/offline-sync-status";

export const metadata: Metadata = {
  title: "نظرة | إدارة الفروع",
  description: "نظام إدارة متاجر البصريات",
  applicationName: "نظرة",
  appleWebApp: { capable: true, title: "نظرة", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { themeColor: "#20283b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}<PwaRegister /><InstallPrompt /><OfflineSyncStatus /></body></html>;
}
