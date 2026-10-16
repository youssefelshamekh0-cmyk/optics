"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { hoursLabel } from "@/components/shift-panel";

type Branch = { id: string; name: string; status: "ACTIVE" | "INACTIVE" };
type Shift = {
  id: string; user_id: string; branch_id: string; opening_cash: number; closing_cash: number | null; expected_cash: number | null; variance: number | null;
  status: "open" | "closed"; opened_at: string; closed_at: string | null; closing_notes: string | null;
  user_profiles: { full_name: string; phone: string | null } | null; branches: { name: string } | null;
};
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
const dayText = (iso: string) => new Intl.DateTimeFormat("ar-EG", { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
const timeText = (iso: string) => new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const localDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); return localDay(new Date(d.getFullYear(), d.getMonth(), 1)); };

/** Owner-only report of every seller's worked hours, built from their opened/closed shifts. */
export default function StaffHours({ branches }: { branches: Branch[] }) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => localDay(new Date()));
  const [branchId, setBranchId] = useState("");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sellerFilter, setSellerFilter] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString() });
      if (branchId) params.set("branchId", branchId);
      const r = await fetch(`/api/shifts?${params}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل الورديات");
      setShifts(j.shifts ?? []); setNow(Date.now());
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل الورديات"); } finally { setBusy(false); }
  }, [from, to, branchId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  const duration = useCallback((s: Shift) => (s.closed_at ? new Date(s.closed_at).getTime() : now) - new Date(s.opened_at).getTime(), [now]);
  const summary = useMemo(() => {
    const byUser = new Map<string, { id: string; name: string; phone: string; shifts: number; ms: number; days: Set<string>; open: boolean }>();
    for (const s of shifts) {
      const row = byUser.get(s.user_id) ?? { id: s.user_id, name: s.user_profiles?.full_name ?? "—", phone: s.user_profiles?.phone ?? "", shifts: 0, ms: 0, days: new Set<string>(), open: false };
      row.shifts += 1; row.ms += Math.max(0, duration(s)); row.days.add(localDay(new Date(s.opened_at))); if (s.status === "open") row.open = true;
      byUser.set(s.user_id, row);
    }
    return [...byUser.values()].sort((a, b) => b.ms - a.ms);
  }, [shifts, duration]);
  const visibleShifts = sellerFilter ? shifts.filter((s) => s.user_id === sellerFilter) : shifts;
  const totalMs = summary.reduce((sum, r) => sum + r.ms, 0);
  const activeBranches = branches.filter((b) => b.status === "ACTIVE");

  return <section className="panel operations-panel">
    <div className="section-heading"><div><p className="eyebrow">من الورديات المفتوحة والمغلقة</p><h2>ساعات عمل الموظفين</h2></div><span className="count-badge">الإجمالي: {hoursLabel(totalMs)}</span></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    <div className="ops-toolbar">
      <label>من<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>إلى<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      <label>الفرع<select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">كل الفروع</option>{activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <button type="button" className="row-action" onClick={() => void load()} disabled={busy}>{busy ? "جارٍ التحديث…" : "تحديث"}</button>
    </div>
    <h3 className="ops-subtitle">ملخص لكل موظف</h3>
    <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>أيام العمل</th><th>عدد الورديات</th><th>إجمالي الساعات</th><th>متوسط الوردية</th><th></th></tr></thead><tbody>
      {summary.map((r) => <tr key={r.id}><td><strong>{r.name}</strong><small>{r.phone}</small></td><td>{r.days.size}</td><td>{r.shifts}</td><td><strong>{hoursLabel(r.ms)}</strong><small>{(r.ms / 3600000).toFixed(1)} ساعة</small></td><td>{hoursLabel(r.ms / r.shifts)}</td><td>{r.open && <span className="status active">يعمل الآن</span>} <button type="button" className="row-action" onClick={() => setSellerFilter(sellerFilter === r.id ? "" : r.id)}>{sellerFilter === r.id ? "عرض الكل" : "تفاصيل"}</button></td></tr>)}
      {summary.length === 0 && <tr><td colSpan={6} className="table-empty">لا توجد ورديات في هذه الفترة.</td></tr>}
    </tbody></table></div>
    <h3 className="ops-subtitle">سجل الورديات{sellerFilter ? ` — ${summary.find((r) => r.id === sellerFilter)?.name ?? ""}` : ""}</h3>
    <div className="table-wrap"><table><thead><tr><th>اليوم</th><th>الموظف</th><th>الفرع</th><th>من</th><th>إلى</th><th>المدة</th><th>العد الفعلي</th><th>الفرق</th></tr></thead><tbody>
      {visibleShifts.map((s) => <tr key={s.id}><td>{dayText(s.opened_at)}</td><td>{s.user_profiles?.full_name ?? "—"}</td><td>{s.branches?.name ?? "—"}</td><td>{timeText(s.opened_at)}</td><td>{s.closed_at ? timeText(s.closed_at) : <span className="status active">جارية</span>}</td><td><strong>{hoursLabel(duration(s))}</strong></td><td>{s.closing_cash == null ? "—" : money(Number(s.closing_cash))}</td><td className={s.variance != null && Number(s.variance) !== 0 ? "balance-due" : ""}>{s.variance == null ? "—" : money(Number(s.variance))}</td></tr>)}
      {visibleShifts.length === 0 && <tr><td colSpan={8} className="table-empty">لا توجد ورديات.</td></tr>}
    </tbody></table></div>
    <p className="footnote">الساعات = من فتح اليومية حتى إغلاقها. الوردية المفتوحة تُحسب حتى الآن. «الفرق» بين العد الفعلي والمتوقع، وهو ظاهر للمالك فقط.</p>
  </section>;
}
