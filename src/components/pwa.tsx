"use client";
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
declare global { interface Window { __nazraInstall?: InstallEvent | null } }

/** Registers the service worker and keeps the browser's install prompt so the top bar can offer it. */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const onPrompt = (event: Event) => { event.preventDefault(); window.__nazraInstall = event as InstallEvent; window.dispatchEvent(new Event("pwa-installable")); };
    const onInstalled = () => { window.__nazraInstall = null; window.dispatchEvent(new Event("pwa-installable")); };
    window.addEventListener("beforeinstallprompt", onPrompt); window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  return null;
}

export function InstallButton() {
  const [available, setAvailable] = useState(false);
  const [ios, setIos] = useState(false);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const sync = () => setAvailable(Boolean(window.__nazraInstall));
    sync(); window.addEventListener("pwa-installable", sync);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
    return () => window.removeEventListener("pwa-installable", sync);
  }, []);
  async function install() {
    const prompt = window.__nazraInstall;
    if (!prompt) { setHint((v) => !v); return; }
    await prompt.prompt(); await prompt.userChoice.catch(() => undefined);
    window.__nazraInstall = null; setAvailable(false);
  }
  if (!available && !ios) return null;
  return <span className="install-wrap"><button type="button" className="quiet install-btn" onClick={() => void install()}>⬇ تثبيت التطبيق</button>{hint && ios && <span className="install-hint" role="note">في سفاري اضغط «مشاركة» ثم «إضافة إلى الشاشة الرئيسية».</span>}</span>;
}
