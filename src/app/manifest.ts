import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "نظرة | إدارة الفروع",
    short_name: "نظرة",
    description: "نظام إدارة فروع البصريات: الفواتير والتسليمات والمخزون والورديات",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    lang: "ar",
    dir: "rtl",
    background_color: "#f5f7f5",
    theme_color: "#27685f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
