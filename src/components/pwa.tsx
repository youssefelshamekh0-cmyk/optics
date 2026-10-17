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

const DISMISS_KEY = "nazra-install-dismissed";
const DISMISS_DAYS = 7;
const recentlyDismissed = () => { try { const at = Number(window.localStorage.getItem(DISMISS_KEY)); return Boolean(at) && Date.now() - at < DISMISS_DAYS * 86400000; } catch { return false; } };

/** Small bottom pop-up offering to install the site as an app. Hidden once installed or dismissed (for a week). */
export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIos(isIos);
    const sync = () => setVisible(!standalone && !recentlyDismissed() && (Boolean(window.__nazraInstall) || isIos));
    sync(); window.addEventListener("pwa-installable", sync);
    return () => window.removeEventListener("pwa-installable", sync);
  }, []);
  function dismiss() { try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage may be blocked */ } setVisible(false); }
  async function install() {
    const prompt = window.__nazraInstall;
    if (!prompt) return;
    await prompt.prompt(); await prompt.userChoice.catch(() => undefined);
    window.__nazraInstall = null; setVisible(false);
  }
  if (!visible) return null;
  return <div className="install-popup" role="dialog" aria-label="تثبيت التطبيق">
    <span className="install-popup-icon" aria-hidden="true">ن</span>
    <div className="install-popup-text"><strong>ثبّت «نظرة» كتطبيق</strong><small>{ios && !window.__nazraInstall ? "في سفاري اضغط «مشاركة» ثم «إضافة إلى الشاشة الرئيسية»." : "فتح أسرع وتجربة أوضح من شاشة الموبايل مباشرة."}</small></div>
    {(!ios || window.__nazraInstall) && <button type="button" className="primary install-popup-btn" onClick={() => void install()}>تثبيت</button>}
    <button type="button" className="quiet install-popup-close" onClick={dismiss} aria-label="إغلاق">✕</button>
  </div>;
}
