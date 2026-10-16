"use client";
import { useCallback, useEffect, useState } from "react";
import { clock, hoursLabel } from "@/components/shift-panel";

type Invoice = { id: string; invoice_number: number; branch: string; customer: string; phone: string; seller: string; total: number; paid: number; due: number; status: string; created_at: string };
type Daily = {
  role: "owner" | "seller"; date: string; today: string; branches: { id: string; name: string }[]; branchId: string;
  summary: { invoices: number; sales: number; collected: number; due: number; expenses: number; cashIn: number; cashOut: number };
  invoices: Invoice[];
  accounts: { id: string; name: string; branch: string; payment_method: string; balance: number; in_today: number; out_today: number }[];
  expenses: { id: string; branch: string; description: string; category: string; amount: number }[];
  shifts: { id: string; user: string; branch: string; opened_at: string; closed_at: string | null; status: "open" | "closed"; opening_cash: number; closing_cash: number | null; variance: number | null }[];
  monthHours: { user_id: string; name: string; seconds: number; shifts: number }[];
};
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
const statusLabel: Record<string, string> = { pending: "جديد", processing: "قيد التجهيز", ready: "جاهز", delivered: "تم التسليم", cancelled: "ملغي" };
const methodLabel: Record<string, string> = { cash: "نقدي", card: "بطاقة", instapay: "إنستاباي", other: "أخرى" };
const time = (iso: string) => new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const shiftDate = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export default function DailyOverview() {
  const [data, setData] = useState<Daily | null>(null);
  const [branchId, setBranchId] = useState("all");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const qs = new URLSearchParams({ branchId }); if (date) qs.set("date", date);
      const r = await fetch(`/api/daily?${qs}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل اليومية");
      setData(j); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل اليومية"); } finally { setLoading(false); }
  }, [branchId, date]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => void load(true); window.addEventListener("shift-changed", reload); const id = setInterval(() => { setNow(Date.now()); if (!date || date === data?.today) reload(); }, 60000); return () => { window.removeEventListener("shift-changed", reload); clearInterval(id); }; }, [load, date, data?.today]);

  if (error && !data) return <section className="panel"><p className="notice error">{error}</p></section>;
  if (!data) return <section className="panel"><p className="footnote">جارٍ تحميل اليومية…</p></section>;

  const owner = data.role === "owner";
  const isToday = data.date === data.today;
  const dayLabel = new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${data.date}T12:00:00Z`));
  const s = data.summary;

  return (
    <section className="panel daily-panel">
      <div className="section-heading"><div><p className="eyebrow">{isToday ? "اليومية · اليوم" : "اليومية"}</p><h2>{dayLabel}</h2></div>
        <div className="daily-controls">
          <label>الفرع<select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="all">{owner ? "كل الفروع" : "كل فروعي"}</option>{data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <div className="daily-date"><button type="button" className="row-action" aria-label="اليوم السابق" onClick={() => setDate(shiftDate(data.date, -1))}>›</button>
            <input type="date" aria-label="اختر يومًا" value={data.date} max={data.today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button type="button" className="row-action" aria-label="اليوم التالي" disabled={isToday} onClick={() => setDate(shiftDate(data.date, 1) >= data.today ? "" : shiftDate(data.date, 1))}>‹</button>
            {!isToday && <button type="button" className="row-action" onClick={() => setDate("")}>اليوم</button>}</div>
          <button type="button" className="row-action" onClick={() => void load()} disabled={loading}>{loading ? "…" : "تحديث"}</button></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="fin-kpis">
        <article className="fin-kpi"><span>عدد الفواتير</span><strong>{s.invoices}</strong></article>
        <article className="fin-kpi"><span>مبيعات اليوم</span><strong>{money(s.sales)}</strong></article>
        <article className="fin-kpi good"><span>{owner ? "المحصّل في الخزن" : "المحصّل على فواتيري"}</span><strong>{money(s.collected)}</strong></article>
        <article className={`fin-kpi ${s.due > 0 ? "bad" : ""}`}><span>المتبقي على فواتير اليوم</span><strong>{money(s.due)}</strong></article>
        {owner && <><article className="fin-kpi"><span>مصروفات اليوم</span><strong>{money(s.expenses)}</strong></article>
          <article className="fin-kpi"><span>داخل الخزن</span><strong>{money(s.cashIn)}</strong></article>
          <article className="fin-kpi"><span>خارج الخزن</span><strong>{money(s.cashOut)}</strong></article>
          <article className={`fin-kpi ${s.cashIn - s.cashOut >= 0 ? "good" : "bad"}`}><span>صافي حركة اليوم</span><strong>{money(s.cashIn - s.cashOut)}</strong></article></>}
      </div>

      <h3 className="ops-subtitle">فواتير اليوم</h3>
      <div className="table-wrap"><table><thead><tr><th>الفاتورة</th><th>العميل</th>{owner && <th>البائع</th>}<th>الفرع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>
        {data.invoices.map((i) => <tr key={i.id} className={i.status === "cancelled" ? "row-cancelled" : ""}><td>#{i.invoice_number}<small>{time(i.created_at)}</small></td><td>{i.customer}<small>{i.phone}</small></td>{owner && <td>{i.seller}</td>}<td>{i.branch}</td><td>{money(i.total)}</td><td>{money(i.paid)}</td><td>{i.due > 0 ? <strong className="due">{money(i.due)}</strong> : "—"}</td><td>{statusLabel[i.status] ?? i.status}</td></tr>)}
        {data.invoices.length === 0 && <tr><td colSpan={owner ? 8 : 7} className="table-empty">لا توجد فواتير في هذا اليوم.</td></tr>}
      </tbody></table></div>

      {owner && <>
        <h3 className="ops-subtitle">حسابات الفرع (الخزن وطرق الدفع)</h3>
        {data.accounts.length ? <div className="ops-account-grid">{data.accounts.map((a) => <article className="ops-account" key={a.id}><small>{a.branch} · {methodLabel[a.payment_method] ?? a.payment_method}</small><strong>{a.name}</strong><b>{money(a.balance)}</b><small>اليوم: ↓ {money(a.in_today)} · ↑ {money(a.out_today)}</small></article>)}</div> : <p className="footnote">لا توجد خزن نشطة لهذا الاختيار.</p>}
        {data.expenses.length > 0 && <><h3 className="ops-subtitle">مصروفات اليوم</h3><div className="table-wrap"><table><thead><tr><th>الفرع</th><th>البيان</th><th>البند</th><th>القيمة</th></tr></thead><tbody>{data.expenses.map((x) => <tr key={x.id}><td>{x.branch}</td><td>{x.description}</td><td>{x.category}</td><td>{money(x.amount)}</td></tr>)}</tbody></table></div></>}
      </>}

      <h3 className="ops-subtitle">ورديات اليوم وساعات العمل</h3>
      <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>الفرع</th><th>بدأ</th><th>انتهى</th><th>المدة</th><th>كاش البداية</th><th>العد عند الإغلاق</th>{owner && <th>الفرق</th>}</tr></thead><tbody>
        {data.shifts.map((x) => { const ms = (x.closed_at ? Date.parse(x.closed_at) : now) - Date.parse(x.opened_at); return <tr key={x.id}><td>{x.user}</td><td>{x.branch}</td><td>{time(x.opened_at)}</td><td>{x.closed_at ? time(x.closed_at) : <span className="status active">جارية</span>}</td><td><strong>{x.closed_at ? hoursLabel(ms) : <span className="clock">{clock(ms)}</span>}</strong></td><td>{money(x.opening_cash)}</td><td>{x.closing_cash == null ? "—" : money(x.closing_cash)}</td>{owner && <td>{x.variance == null ? "—" : <span className={x.variance < 0 ? "due" : ""}>{money(x.variance)}</span>}</td>}</tr>; })}
        {data.shifts.length === 0 && <tr><td colSpan={owner ? 8 : 7} className="table-empty">لا توجد ورديات في هذا اليوم.</td></tr>}
      </tbody></table></div>

      {owner && data.monthHours.length > 0 && <><h3 className="ops-subtitle">إجمالي ساعات العمل هذا الشهر</h3><div className="table-wrap"><table><thead><tr><th>الموظف</th><th>عدد الورديات</th><th>إجمالي الساعات</th></tr></thead><tbody>{data.monthHours.map((m) => <tr key={m.user_id}><td>{m.name}</td><td>{m.shifts}</td><td><strong>{hoursLabel(m.seconds * 1000)}</strong></td></tr>)}</tbody></table></div></>}
    </section>
  );
}
