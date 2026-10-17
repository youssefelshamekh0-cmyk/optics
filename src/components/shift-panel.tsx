"use client";
import { useCallback, useEffect, useState } from "react";

type Shift = { id: string; branch_id: string; cash_account_id: string; opening_cash: number; closing_cash?: number | null; status: "open" | "closed"; opened_at: string; closed_at?: string | null; branches?: { name: string } | null; cash_accounts?: { name: string } | null };
type Account = { id: string; branch_id: string; name: string };
type Deposit = { id: string; amount: number; description: string | null; created_at: string };
type ShiftData = { owner: boolean; shifts: Shift[]; accounts: Account[]; deposits: Deposit[] };

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
export const hoursLabel = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); const h = Math.floor(m / 60); return h ? `${h} س ${m % 60} د` : `${m} د`; };
const durationOf = (s: Shift, now: number) => (s.closed_at ? new Date(s.closed_at).getTime() : now) - new Date(s.opened_at).getTime();
const time = (iso: string) => new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat("ar-EG", { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);

async function loadShifts(): Promise<ShiftData> {
  const r = await fetch("/api/shifts", { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "تعذر تحميل الوردية");
  return { owner: Boolean(j.owner), shifts: j.shifts ?? [], accounts: j.accounts ?? [], deposits: j.deposits ?? [] };
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [active]);
  return now;
}

/** Small running timer shown in the top bar on every tab while a shift is open. */
export function ShiftBadge() {
  const [open, setOpen] = useState<Shift | null>(null);
  const [owner, setOwner] = useState(true);
  const load = useCallback(() => { loadShifts().then((d) => { setOwner(d.owner); setOpen(d.shifts.find((s) => s.status === "open") ?? null); }).catch(() => undefined); }, []);
  useEffect(() => { load(); window.addEventListener("shift-changed", load); return () => window.removeEventListener("shift-changed", load); }, [load]);
  const now = useNow(Boolean(open));
  if (owner || !open) return null;
  return <span className="shift-badge" title={`بدأت الوردية ${time(open.opened_at)}`}><i aria-hidden="true" />وردية {clock(now - new Date(open.opened_at).getTime())}</span>;
}

export default function ShiftPanel() {
  const [data, setData] = useState<ShiftData | null>(null);
  const [accountId, setAccountId] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCash, setClosingCash] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNotes, setDepositNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try { const d = await loadShifts(); setData(d); setAccountId((cur) => cur || d.accounts[0]?.id || ""); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل الوردية"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = data?.shifts.find((s) => s.status === "open");
  const now = useNow(Boolean(open));

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await fetch("/api/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تنفيذ العملية");
      setMessage(done); setClosingCash(""); setDepositAmount(""); setDepositNotes(""); await load(); window.dispatchEvent(new Event("shift-changed"));
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تنفيذ العملية"); } finally { setBusy(false); }
  }

  if (!data || data.owner) return null;
  const account = data.accounts.find((a) => a.id === accountId);
  // Hours are counted per shop week (Saturday -> Friday), not per month.
  const weekStartMs = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); return d.getTime(); })();
  const weekMs = data.shifts.filter((s) => new Date(s.opened_at).getTime() >= weekStartMs).reduce((sum, s) => sum + durationOf(s, now), 0);
  const history = data.shifts.filter((s) => s.status === "closed").slice(0, 10);

  return (
    <section className="panel shift-panel">
      <div className="section-heading"><div><p className="eyebrow">اليومية</p><h2>{open ? "يوم عمل جارٍ" : "لا توجد وردية مفتوحة"}</h2></div>
        {weekMs > 0 && <span className="count-badge" title="من يوم السبت">ساعات هذا الأسبوع: {hoursLabel(weekMs)}</span>}</div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}
      {open ? (
        <div className="shift-running">
          <div className="shift-timer" aria-live="off"><span>الوقت المنقضي</span><strong>{clock(now - new Date(open.opened_at).getTime())}</strong><small>بدأت {day(open.opened_at)} الساعة {time(open.opened_at)} — {open.branches?.name ?? "الفرع"} · {open.cash_accounts?.name ?? "الخزنة"}</small></div>
          <form className="shift-form" onSubmit={(e) => { e.preventDefault(); void send({ action: "deposit", shiftId: open.id, amount: Number(depositAmount), notes: depositNotes }, "تم تسجيل التوريد للخزنة المركزية وخصمه من درج الوردية"); }}>
            <p className="footnote">توريد كاش للخزنة المركزية: يُخصم من درج الوردية ويظهر للمالك فورًا. اعدّ الكاش المتبقي فقط عند الإغلاق.</p>
            <label>مبلغ التوريد<input required type="number" min="0.01" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} /></label>
            <label>ملاحظة (اختياري)<input maxLength={200} value={depositNotes} onChange={(e) => setDepositNotes(e.target.value)} /></label>
            <button className="primary" disabled={busy || depositAmount === "" || Number(depositAmount) <= 0}>توريد للخزنة المركزية</button>
          </form>
          <form className="shift-form" onSubmit={(e) => { e.preventDefault(); void send({ action: "close", shiftId: open.id, closingCash: Number(closingCash), notes: "" }, `تم إغلاق الوردية وتسجيل ${hoursLabel(now - new Date(open.opened_at).getTime())} عمل`); }}>
            <p className="footnote">كاش البداية {money(Number(open.opening_cash))}</p>
            <label>العد الفعلي للكاش عند الإغلاق<input required type="number" min="0" step="0.01" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} /></label>
            <button className="primary" disabled={busy || closingCash === ""}>إغلاق اليومية وتسجيل الساعات</button>
          </form>
        </div>
      ) : data.accounts.length === 0 ? (
        <p className="notice error">لا توجد خزنة كاش نشطة في فرعك. اطلب من المالك إنشاءها أولاً.</p>
      ) : (
        <form className="shift-form" onSubmit={(e) => { e.preventDefault(); if (!account) return; void send({ action: "open", branchId: account.branch_id, cashAccountId: account.id, openingCash: Number(openingCash) }, "بدأت اليومية وبدأ احتساب ساعات العمل"); }}>
          <p className="footnote">ابدأ اليومية قبل تسجيل أي فاتورة؛ يبدأ عداد الوقت ويتسجل عند الإغلاق.</p>
          <label>الخزنة<select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>الكاش في الدرج الآن<input required type="number" min="0" step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} /></label>
          <button className="primary" disabled={busy || !account}>بدء اليومية</button>
        </form>
      )}
      {data.deposits.length > 0 && <>
        <h3 className="ops-subtitle">توريداتي للخزنة المركزية</h3>
        <div className="table-wrap"><table><thead><tr><th>اليوم</th><th>الوقت</th><th>المبلغ</th><th>البيان</th></tr></thead><tbody>
          {data.deposits.slice(0, 10).map((d) => <tr key={d.id}><td>{day(d.created_at)}</td><td>{time(d.created_at)}</td><td><strong>{money(Number(d.amount))}</strong></td><td>{d.description ?? "—"}</td></tr>)}
        </tbody></table></div>
      </>}
      {history.length > 0 && <>
        <h3 className="ops-subtitle">سجل ساعات العمل</h3>
        <div className="table-wrap"><table><thead><tr><th>اليوم</th><th>الفرع</th><th>من</th><th>إلى</th><th>المدة</th><th>العد عند الإغلاق</th></tr></thead><tbody>
          {history.map((s) => <tr key={s.id}><td>{day(s.opened_at)}</td><td>{s.branches?.name ?? "—"}</td><td>{time(s.opened_at)}</td><td>{s.closed_at ? time(s.closed_at) : "—"}</td><td><strong>{hoursLabel(durationOf(s, now))}</strong></td><td>{s.closing_cash == null ? "—" : money(Number(s.closing_cash))}</td></tr>)}
        </tbody></table></div>
      </>}
    </section>
  );
}
