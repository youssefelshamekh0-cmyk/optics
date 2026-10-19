"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { addDays, todayCairo } from "@/lib/week";
import { hoursLabel } from "@/components/shift-panel";

type Account = {
  profile: { name: string; phone: string; isOwner: boolean };
  employee: { jobTitle: string; branch: string; weeklySalary: number; commissionRate: number } | null;
  week: { start: string; end: string; hoursSeconds: number; shifts: number };
  current: { salesTotal: number; base: number; commission: number; deductions: number; advancesPaid: number; advancesPending: number; salaryPaid: number; remaining: number; sheetIssued: boolean } | null;
  payroll: { id: string; periodStart: string; periodEnd: string; base: number; commission: number; deductions: number; paid: number; remaining: number; status: string }[];
  advances: { id: string; amount: number; notes: string | null; status: string; created_at: string; decided_at: string | null }[];
  leaves: { id: string; request_type: "leave" | "permission"; start_date: string; end_date: string; start_time: string | null; end_time: string | null; reason: string | null; status: string; decision_note: string | null; created_at: string }[];
};

const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
const shortDate = (d: string) => new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`));
const leaveStatus: Record<string, string> = { pending: "قيد المراجعة", approved: "موافق عليه", rejected: "مرفوض", cancelled: "ملغي" };
const advanceStatus: Record<string, string> = { pending: "قيد المراجعة", paid: "تم الصرف", rejected: "مرفوض" };

async function call(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "تعذر إتمام الطلب");
  return data;
}

export default function AccountPanel() {
  const [data, setData] = useState<Account | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [leave, setLeave] = useState({ type: "leave" as "leave" | "permission", startDate: todayCairo(), endDate: todayCairo(), startTime: "", endTime: "", reason: "" });

  const load = useCallback(async () => {
    try { setData(await call("/api/account")); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل بيانات حسابك"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (pw.newPassword !== pw.confirm) { setError("تأكيد كلمة المرور غير مطابق"); return; }
    setBusy(true);
    try { await call("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }) }); setPw({ currentPassword: "", newPassword: "", confirm: "" }); setNotice("تم تغيير كلمة المرور"); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر تغيير كلمة المرور"); } finally { setBusy(false); }
  }
  async function sendLeave(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const body = leave.type === "leave" ? { type: "leave", startDate: leave.startDate, endDate: leave.endDate, reason: leave.reason } : { type: "permission", startDate: leave.startDate, startTime: leave.startTime, endTime: leave.endTime, reason: leave.reason };
      await call("/api/account/leave", { method: "POST", body: JSON.stringify(body) });
      setLeave({ ...leave, reason: "", startTime: "", endTime: "" }); setNotice("تم إرسال الطلب للمالك"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر إرسال الطلب"); } finally { setBusy(false); }
  }
  async function cancelLeave(id: string) {
    setBusy(true); setError(""); setNotice("");
    try { await call(`/api/account/leave?id=${id}`, { method: "DELETE" }); setNotice("تم إلغاء الطلب"); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر إلغاء الطلب"); } finally { setBusy(false); }
  }

  if (!data) return <section className="panel">{error ? <p className="notice error" role="alert">{error}</p> : <p className="footnote">جارٍ تحميل حسابك…</p>}</section>;
  const c = data.current;
  const isOwner = data.profile.isOwner;

  return <section className="panel account-panel">
    <div className="section-heading"><div><p className="eyebrow">حسابي</p><h2>{data.profile.name}</h2></div>{data.employee && <span className="count-badge">{data.employee.jobTitle}{data.employee.branch ? ` · ${data.employee.branch}` : ""}</span>}</div>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    <p className="footnote">رقم الدخول: <span dir="ltr">{data.profile.phone || "—"}</span></p>

    {!isOwner && (data.employee && c ? <>
      <h3 className="ops-subtitle">راتب هذا الأسبوع ({shortDate(data.week.start)} – {shortDate(data.week.end)})</h3>
      <div className="fin-kpis">
        <article className="fin-kpi"><span>الراتب الأسبوعي</span><strong>{money(c.base)}</strong></article>
        <article className="fin-kpi"><span>العمولة ({data.employee.commissionRate}% من {money(c.salesTotal)})</span><strong>{money(c.commission)}</strong></article>
        <article className="fin-kpi"><span>المسحوبات المصروفة</span><strong>{money(c.advancesPaid)}</strong></article>
        {c.deductions > 0 && <article className="fin-kpi"><span>الخصومات</span><strong>{money(c.deductions)}</strong></article>}
        {c.salaryPaid > 0 && <article className="fin-kpi"><span>المصروف من الكشف</span><strong>{money(c.salaryPaid)}</strong></article>}
        <article className={`fin-kpi ${c.remaining >= 0 ? "good" : "bad"}`}><span>الراتب المتبقي</span><strong>{money(c.remaining)}</strong></article>
        <article className="fin-kpi"><span>ساعات العمل هذا الأسبوع</span><strong>{data.week.hoursSeconds ? hoursLabel(data.week.hoursSeconds * 1000) : "—"}</strong></article>
      </div>
      <p className="footnote">المتبقي = الراتب الأسبوعي + العمولة − الخصومات − المسحوبات − ما صُرف من الكشف. {c.advancesPending > 0 ? `لديك طلبات مسحوبات قيد المراجعة بقيمة ${money(c.advancesPending)}. ` : ""}{c.sheetIssued ? "تم إصدار كشف هذا الأسبوع." : "العمولة تقديرية حتى يصدر المالك كشف الأسبوع."}</p>

      {data.payroll.length > 0 && <><h3 className="ops-subtitle">كشوف الرواتب السابقة</h3><div className="table-wrap"><table><thead><tr><th>الأسبوع</th><th>الأساسي</th><th>العمولة</th><th>الخصم</th><th>المصروف</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>{data.payroll.map((p) => <tr key={p.id}><td>{shortDate(p.periodStart)} – {shortDate(p.periodEnd)}</td><td>{money(p.base)}</td><td>{money(p.commission)}</td><td>{money(p.deductions)}</td><td>{money(p.paid)}</td><td>{money(p.remaining)}</td><td>{p.status === "paid" ? "مكتمل" : p.status === "cancelled" ? "ملغي" : "قيد الصرف"}</td></tr>)}</tbody></table></div></>}

      <h3 className="ops-subtitle">المسحوبات</h3>
      <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظة</th><th>الحالة</th></tr></thead><tbody>{data.advances.map((a) => <tr key={a.id}><td>{new Date(a.created_at).toLocaleDateString("ar-EG")}</td><td>{money(Number(a.amount))}</td><td>{a.notes || "—"}</td><td>{advanceStatus[a.status] ?? a.status}</td></tr>)}{data.advances.length === 0 && <tr><td colSpan={4} className="table-empty">لا توجد مسحوبات.</td></tr>}</tbody></table></div>
    </> : <p className="notice error">لا يوجد سجل راتب مرتبط بحسابك بعد؛ اطلب من المالك إضافته.</p>)}

    <div className="ops-forms">
      <form className="ops-form" onSubmit={changePassword}>
        <h3>تغيير كلمة المرور</h3>
        <label>كلمة المرور الحالية<input required type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></label>
        <label>كلمة المرور الجديدة (8 أحرف على الأقل)<input required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></label>
        <label>تأكيد كلمة المرور الجديدة<input required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></label>
        <button className="primary" disabled={busy}>حفظ كلمة المرور</button>
      </form>
      {!isOwner && <form className="ops-form" onSubmit={sendLeave}>
        <h3>طلب إجازة أو استئذان</h3>
        <label>نوع الطلب<select value={leave.type} onChange={(e) => setLeave({ ...leave, type: e.target.value as "leave" | "permission" })}><option value="leave">إجازة</option><option value="permission">استئذان (ساعات)</option></select></label>
        <label>{leave.type === "leave" ? "من تاريخ" : "التاريخ"}<input required type="date" min={todayCairo()} value={leave.startDate} onChange={(e) => setLeave({ ...leave, startDate: e.target.value, endDate: e.target.value > leave.endDate ? e.target.value : leave.endDate })} /></label>
        {leave.type === "leave" ? <label>إلى تاريخ<input required type="date" min={leave.startDate} max={addDays(leave.startDate, 60)} value={leave.endDate} onChange={(e) => setLeave({ ...leave, endDate: e.target.value })} /></label>
          : <><label>من الساعة<input required type="time" value={leave.startTime} onChange={(e) => setLeave({ ...leave, startTime: e.target.value })} /></label><label>إلى الساعة<input required type="time" value={leave.endTime} onChange={(e) => setLeave({ ...leave, endTime: e.target.value })} /></label></>}
        <label>السبب<input required minLength={2} maxLength={500} value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} /></label>
        <button className="primary" disabled={busy}>إرسال الطلب</button>
      </form>}
    </div>

    {!isOwner && <><h3 className="ops-subtitle">طلباتي</h3><div className="table-wrap"><table><thead><tr><th>النوع</th><th>التاريخ</th><th>السبب</th><th>الحالة</th><th></th></tr></thead><tbody>{data.leaves.map((l) => <tr key={l.id}><td>{l.request_type === "leave" ? "إجازة" : "استئذان"}</td><td>{l.request_type === "leave" ? (l.start_date === l.end_date ? l.start_date : `${l.start_date} ← ${l.end_date}`) : `${l.start_date} · ${String(l.start_time).slice(0, 5)} – ${String(l.end_time).slice(0, 5)}`}</td><td>{l.reason || "—"}</td><td>{leaveStatus[l.status] ?? l.status}{l.decision_note && <small>{l.decision_note}</small>}</td><td>{l.status === "pending" && <button className="row-action" disabled={busy} onClick={() => void cancelLeave(l.id)}>إلغاء</button>}</td></tr>)}{data.leaves.length === 0 && <tr><td colSpan={5} className="table-empty">لم تقدّم أي طلبات بعد.</td></tr>}</tbody></table></div></>}
  </section>;
}
