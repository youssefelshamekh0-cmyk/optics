"use client";
import { useCallback, useEffect, useState } from "react";

type Shift = { id: string; branch_id: string; cash_account_id: string; opening_cash: number; status: "open" | "closed"; opened_at: string; branches?: { name: string } | null; cash_accounts?: { name: string } | null };
type Account = { id: string; branch_id: string; name: string };

export default function ShiftPanel() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [owner, setOwner] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCash, setClosingCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/shifts", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "تعذر تحميل الوردية"); setLoaded(true); return; }
    setOwner(Boolean(j.owner)); setShifts(j.shifts ?? []); setAccounts(j.accounts ?? []);
    setAccountId((cur) => cur || j.accounts?.[0]?.id || ""); setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await fetch("/api/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تنفيذ العملية");
      setMessage(done); setClosingCash(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تنفيذ العملية"); } finally { setBusy(false); }
  }

  if (!loaded || owner) return null;
  const open = shifts.find((s) => s.status === "open");
  const account = accounts.find((a) => a.id === accountId);

  return (
    <section className="panel">
      <div className="section-heading"><div><p className="eyebrow">الوردية</p><h2>{open ? "وردية مفتوحة" : "لا توجد وردية مفتوحة"}</h2></div></div>
      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice success">{message}</p>}
      {open ? (
        <form className="shift-form" onSubmit={(e) => { e.preventDefault(); void send({ action: "close", shiftId: open.id, closingCash: Number(closingCash), notes: "" }, "تم إغلاق الوردية"); }}>
          <p className="footnote">{open.branches?.name ?? "الفرع"} — {open.cash_accounts?.name ?? "الخزنة"} — رصيد البداية {open.opening_cash}</p>
          <label>العد الفعلي للكاش عند الإغلاق<input required type="number" min="0" step="0.01" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} /></label>
          <button className="primary" disabled={busy || closingCash === ""}>إغلاق الوردية</button>
        </form>
      ) : accounts.length === 0 ? (
        <p className="notice error">لا توجد خزنة كاش نشطة في فرعك. اطلب من المالك إنشاءها أولاً.</p>
      ) : (
        <form className="shift-form" onSubmit={(e) => { e.preventDefault(); if (!account) return; void send({ action: "open", branchId: account.branch_id, cashAccountId: account.id, openingCash: Number(openingCash) }, "تم فتح الوردية، تقدر تسجل فواتير"); }}>
          <p className="footnote">لازم تفتح وردية قبل تسجيل أي فاتورة.</p>
          <label>الخزنة<select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>الكاش في الدرج الآن<input required type="number" min="0" step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} /></label>
          <button className="primary" disabled={busy || !account}>فتح الوردية</button>
        </form>
      )}
    </section>
  );
}
