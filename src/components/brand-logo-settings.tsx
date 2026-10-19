"use client";
import { ChangeEvent, useEffect, useState } from "react";

export default function BrandLogoSettings() {
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/brand-settings", { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل شعار البراند");
      if (active) setLogoDataUrl(j.logoDataUrl ?? null);
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "تعذر تحميل الشعار"); });
    return () => { active = false; };
  }, []);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError(""); setNotice("");
    if (selected && (!["image/png", "image/jpeg", "image/webp"].includes(selected.type) || selected.size > 1024 * 1024)) {
      setFile(null); event.target.value = "";
      setError("اختر صورة PNG أو JPG أو WebP بحجم لا يتجاوز 1 ميجابايت.");
      return;
    }
    setFile(selected);
  }

  async function save(remove = false) {
    setBusy(true); setError(""); setNotice("");
    try {
      let dataUrl: string | null = null;
      if (!remove && file) dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("تعذر قراءة الصورة"));
        reader.onerror = () => reject(new Error("تعذر قراءة الصورة"));
        reader.readAsDataURL(file);
      });
      if (!remove && !dataUrl && !logoDataUrl) throw new Error("اختر صورة أولًا.");
      const response = await fetch("/api/brand-settings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(remove ? { remove: true } : { logoDataUrl: dataUrl ?? logoDataUrl }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "تعذر حفظ الشعار");
      setLogoDataUrl(result.logoDataUrl ?? null); setFile(null);
      setNotice(remove ? "تم حذف الشعار." : "تم حفظ الشعار وسيظهر في واجهة النظام والتقارير.");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ الشعار"); }
    finally { setBusy(false); }
  }

  return <section className="panel form-panel">
    <div className="section-heading"><div><p className="eyebrow">هوية البراند</p><h2>شعار البراند</h2></div><span className="soft-icon">▧</span></div>
    <div className="brand-logo-settings">
      <div className="brand-logo-preview">{logoDataUrl ? <img src={logoDataUrl} alt="شعار البراند الحالي" /> : <span>لا يوجد شعار محفوظ</span>}</div>
      <div className="brand-logo-controls">
        <label>اختيار صورة PNG أو JPG أو WebP<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseFile} /></label>
        <p className="footnote">الحد الأقصى 1 ميجابايت. تُحفظ الصورة في إعدادات البراند وتظهر في الواجهة والفواتير والتقارير.</p>
        <button type="button" className="primary" disabled={busy || (!file && !logoDataUrl)} onClick={() => void save()}>{busy ? "جارٍ الحفظ…" : "حفظ الشعار"}</button>
        {logoDataUrl && <button type="button" className="secondary" disabled={busy} onClick={() => void save(true)}>حذف الشعار</button>}
      </div>
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
  </section>;
}
