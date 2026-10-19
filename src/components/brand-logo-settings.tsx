"use client";
import { ChangeEvent, useEffect, useState } from "react";

export default function BrandLogoSettings() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("نظرة");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/brand-settings", { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل صورة البراند");
      if (active) { setLogoUrl(j.logoUrl ?? null); setBrandName(j.brandName ?? "نظرة"); }
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "تعذر تحميل صورة البراند"); });
    return () => { active = false; };
  }, []);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError(""); setNotice("");
  }

  async function upload() {
    if (!brandName.trim()) { setError("اكتب اسم البراند"); return; }
    if (brandName.trim().length > 100) { setError("اسم البراند يجب ألا يزيد عن 100 حرف"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData(); form.set("brandName", brandName.trim()); if (file) form.set("logo", file);
      const r = await fetch("/api/brand-settings", { method: "POST", body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر حفظ صورة البراند");
      setLogoUrl(j.logoUrl ?? null); setBrandName(j.brandName ?? brandName.trim()); setFile(null); setNotice("تم حفظ اسم البراند والشعار، وسيُستخدمان في الفواتير والتقارير.");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ صورة البراند"); }
    finally { setBusy(false); }
  }

  return <section className="panel form-panel">
    <div className="section-heading"><div><p className="eyebrow">هوية البراند</p><h2>صورة البراند على الفواتير والتقارير</h2></div><span className="soft-icon">▧</span></div>
    <div className="brand-logo-settings">
      <div className="brand-logo-preview">{logoUrl ? <img src={logoUrl} alt="شعار البراند الحالي" /> : <span>لا توجد صورة محفوظة</span>}</div>
      <div className="brand-logo-controls">
        <label>اسم البراند<input type="text" required maxLength={100} value={brandName} onChange={(event) => { setBrandName(event.target.value); setError(""); setNotice(""); }} placeholder="اسم البراند الذي سيظهر في الفواتير والتقارير" /></label>
        <label>اختيار صورة PNG أو JPG أو WebP<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseFile} /></label>
        <p className="footnote">الحد الأقصى 5 ميجابايت. تُحفظ الصورة في تخزين خاص ولا تكون متاحة للعامة.</p>
        <button type="button" className="primary" disabled={busy || !brandName.trim()} onClick={() => void upload()}>{busy ? "جارٍ الحفظ…" : "حفظ هوية البراند"}</button>
      </div>
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
  </section>;
}
