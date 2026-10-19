"use client";
import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import { hoursLabel } from "@/components/shift-panel";

type Payroll = { id: string; period_start: string; period_end: string; base_salary: number; commission_amount: number; deductions: number; amount_paid: number; status: string };
type Account = {
  name: string; phone: string; isOwner: boolean; week: { start: string; end: string };
  salary: null | { jobTitle: string; branches: string[]; weeklySalary: number; commissionRate: number; weekSeconds: number; weekSales: number; weekCommission: number; payroll: Payroll[] };
};
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
const dayText = (d: string) => new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`));

/** Available to every user: change own password and (for staff) see the weekly salary. */
export default function AccountSection({ isOwner }: { isOwner: boolean }) {
  const [data, setData] = useState<Account | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoNotice, setLogoNotice] = useState("");
  const [logoError, setLogoError] = useState("");
  useEffect(() => {
    if (!isOwner) return;
    fetch("/api/brand-settings", { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل شعار البراند");
      setBrandLogo(j.logoDataUrl ?? null);
    }).catch((e) => setLogoError(e instanceof Error ? e.message : "تعذر تحميل شعار البراند"));
  }, [isOwner]);

  async function uploadBrandLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLogoError(""); setLogoNotice("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setLogoError("اختار صورة PNG أو JPG أو WebP."); return; }
    if (file.size > 1024 * 1024) { setLogoError("حجم الشعار يجب ألا يتجاوز 1 ميجابايت."); return; }
    setLogoBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("تعذر قراءة الصورة"));
        reader.onerror = () => reject(new Error("تعذر قراءة الصورة"));
        reader.readAsDataURL(file);
      });
      const r = await fetch("/api/brand-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ logoDataUrl: dataUrl }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر حفظ الشعار");
      setBrandLogo(j.logoDataUrl ?? dataUrl); setLogoNotice("تم حفظ شعار البراند، وسيظهر في الفواتير والتقارير المطبوعة.");
    } catch (e) { setLogoError(e instanceof Error ? e.message : "تعذر حفظ الشعار"); }
    finally { setLogoBusy(false); }
  }

  async function removeBrandLogo() {
    setLogoBusy(true); setLogoError(""); setLogoNotice("");
    try {
      const r = await fetch("/api/brand-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ remove: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر حذف الشعار");
      setBrandLogo(null); setLogoNotice("تم حذف شعار البراند.");
    } catch (e) { setLogoError(e instanceof Error ? e.message : "تعذر حذف الشعار"); }
    finally { setLogoBusy(false); }
  }

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/account", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل بيانات الحساب");
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل بيانات الحساب"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (form.newPassword.length < 8) { setError("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف"); return; }
    if (form.newPassword !== form.confirm) { setError("تأكيد كلمة المرور غير مطابق"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/account/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تغيير كلمة المرور");
      setForm({ currentPassword: "", newPassword: "", confirm: "" }); setNotice("تم تغيير كلمة المرور. استخدم الجديدة في تسجيل الدخول القادم.");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تغيير كلمة المرور"); } finally { setBusy(false); }
  }

  const s = data?.salary;
  return <div className="account-grid">
    <section className="panel form-panel"><div className="section-heading"><div><p className="eyebrow">الأمان</p><h2>تغيير كلمة المرور</h2></div><span className="soft-icon">🔒</span></div>
      <form className="form-grid" onSubmit={changePassword}>
        <label className="wide">كلمة المرور الحالية<input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></label>
        <label>كلمة المرور الجديدة<input type="password" autoComplete="new-password" required minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></label>
        <label>تأكيد كلمة المرور<input type="password" autoComplete="new-password" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></label>
        <p className="wide footnote">8 أحرف على الأقل. كلمة المرور المبدئية هي رقم موبايلك بدون الصفر الأول، ويُفضّل تغييرها.</p>
        {error && <div className="wide notice error" role="alert">{error}</div>}{notice && <div className="wide notice success" role="status">{notice}</div>}
        <button className="primary" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}</button>
      </form></section>

    {isOwner && <section className="panel form-panel">
      <div className="section-heading"><div><p className="eyebrow">هوية البراند</p><h2>شعار الفواتير والتقارير</h2></div><span className="soft-icon">✦</span></div>
      <p className="muted">ارفع شعار البراند ليظهر تلقائيًا في الفواتير وقوائم التسليم المطبوعة. الصيغ المدعومة PNG وJPG وWebP، بحد أقصى 1 ميجابايت.</p>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", margin: "18px 0" }}>
        <div style={{ width: 148, height: 100, border: "1px dashed var(--line, #cbd8d2)", borderRadius: 12, display: "grid", placeItems: "center", padding: 10, background: "var(--surface, #f8faf9)" }}>
          {brandLogo ? <img src={brandLogo} alt="شعار البراند الحالي" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span className="footnote">لا يوجد شعار مرفوع</span>}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label className="primary" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: logoBusy ? "wait" : "pointer", opacity: logoBusy ? .65 : 1 }}>
            {logoBusy ? "جارٍ الحفظ…" : brandLogo ? "تغيير الشعار" : "رفع شعار"}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={logoBusy} onChange={uploadBrandLogo} style={{ display: "none" }} />
          </label>
          {brandLogo && <button type="button" className="row-action" disabled={logoBusy} onClick={() => void removeBrandLogo()}>حذف الشعار</button>}
        </div>
      </div>
      {logoError && <p className="notice error" role="alert">{logoError}</p>}
      {logoNotice && <p className="notice success" role="status">{logoNotice}</p>}
    </section>}
    {!isOwner && <section className="panel"><div className="section-heading"><div><p className="eyebrow">{data ? `أسبوع ${dayText(data.week.start)} – ${dayText(data.week.end)}` : "الأسبوع الحالي"}</p><h2>مرتبي</h2>{s && s.branches.length > 0 && <p className="footnote">الفروع: {s.branches.join("، ")}</p>}</div>{s && <span className="count-badge">{s.jobTitle}</span>}</div>
      {!data ? <p className="footnote">جارٍ التحميل…</p> : !s ? <p className="footnote">لم يُسجَّل لك مرتب بعد. اطلب من المالك ربط حسابك بسجل موظف.</p> : <>
        <div className="account-kpis">
          <article><span>المرتب الأسبوعي</span><strong>{money(s.weeklySalary)}</strong><small>يُصرف كل أسبوع</small></article>
          <article><span>ساعات هذا الأسبوع</span><strong>{hoursLabel(s.weekSeconds * 1000)}</strong><small>من الورديات المسجلة</small></article>
          <article><span>عمولة هذا الأسبوع</span><strong>{money(s.weekCommission)}</strong><small>{s.commissionRate > 0 ? `${s.commissionRate}% من ${money(s.weekSales)}` : "لا توجد عمولة"}</small></article>
        </div>
        <h3 className="ops-subtitle">كشوف الرواتب السابقة</h3>
        <div className="table-wrap"><table><thead><tr><th>الأسبوع</th><th>الأساسي</th><th>العمولة</th><th>الخصم</th><th>المصروف</th><th>الحالة</th></tr></thead><tbody>
          {s.payroll.map((p) => <tr key={p.id}><td>{dayText(p.period_start)} – {dayText(p.period_end)}</td><td>{money(p.base_salary)}</td><td>{money(p.commission_amount)}</td><td>{money(p.deductions)}</td><td>{money(p.amount_paid)}</td><td>{p.status === "pending" ? "قيد الصرف" : "تم الصرف"}</td></tr>)}
          {s.payroll.length === 0 && <tr><td colSpan={6} className="table-empty">لا توجد كشوف رواتب بعد.</td></tr>}
        </tbody></table></div>
        <p className="footnote">الساعات والعمولة محسوبة على كل فروعك معًا. العمولة المعروضة تقديرية حتى يُعتمد كشف الأسبوع من المالك.</p></>}
    </section>}
  </div>;
}
