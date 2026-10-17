"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeEgyptianPhone } from "@/lib/phone";
import BrandLogo from "@/components/brand-logo";

export default function LoginForm() {
  const [phoneInput, setPhoneInput] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const credentials = normalizeEgyptianPhone(phoneInput);
    if (!credentials) { setError("أدخل رقم موبايل مصري صحيحًا مثل 01012345678"); setBusy(false); return; }
    const supabase = createClient();
    const { error: loginError } = await supabase.auth.signInWithPassword({ phone: credentials.phone, password });
    if (!loginError) {
      const check = await fetch("/api/auth/session", { cache: "no-store" });
      if (check.ok) { window.location.assign("/dashboard"); return; }
      await supabase.auth.signOut({ scope: "local" });
    }
    setError("تعذر تسجيل الدخول. تحقق من رقم الموبايل أو حالة الحساب."); setBusy(false);
  }
  return <main className="login-wrap"><div className="login-card"><div className="login-logo"><BrandLogo size={64} /></div><p className="eyebrow">نظام إدارة البصريات</p><h1>مرحبًا بعودتك</h1><p className="muted">سجّل الدخول لمتابعة فروعك من مكان واحد.</p>
    <form onSubmit={submit} className="stack"><label>رقم الموبايل<input type="tel" inputMode="tel" autoComplete="username" required value={phoneInput} onChange={(event) => { const value = event.target.value; setPhoneInput(value); const normalized = normalizeEgyptianPhone(value); if (normalized) setPassword(normalized.initialPassword); }} placeholder="01012345678" /></label><label>كلمة المرور<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><p className="footnote">تُملأ مبدئيًا من رقمك بعد حذف الصفر الأول، ويمكنك إدخال كلمة مرور مختلفة.</p><button className="primary" disabled={busy}>{busy ? "جارٍ التحقق…" : "تسجيل الدخول"}</button></form>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="secure-note"><span className="dot"/> الجلسة والصلاحيات محمية عبر Supabase</div></div></main>;
}
