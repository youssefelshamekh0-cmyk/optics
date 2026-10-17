"use client";
import { useCallback, useEffect, useState } from "react";

type Deposit = { id: string; amount: number; description: string | null; created_at: string; seller: string };
type Central = { id: string; name: string; balance: number; deposits: Deposit[] } | null;
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
const when = (iso: string) => new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Owner-only: balance of the brand's central cash box and every seller deposit into it. */
export default function CentralCash() {
  const [central, setCentral] = useState<Central>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/operations?module=central", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل الخزنة المركزية");
      setCentral(j.central ?? null); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل الخزنة المركزية"); } finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { window.addEventListener("shift-changed", load); return () => window.removeEventListener("shift-changed", load); }, [load]);

  if (!loaded) return null;
  return <section className="panel operations-panel">
    <div className="section-heading"><div><p className="eyebrow">رصيد البراند النقدي</p><h2>الخزنة المركزية</h2></div>{central && <button type="button" className="row-action" onClick={() => void load()}>تحديث</button>}</div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {!error && !central && <div className="notice error">لم يتم إنشاء الخزنة المركزية؛ طبّق آخر migration على قاعدة البيانات.</div>}
    {central && <>
      <div className="ops-account-grid"><article className="ops-account"><small>{central.name}</small><strong>الرصيد الحالي</strong><b>{money(central.balance)}</b></article></div>
      <h3 className="ops-subtitle">توريدات البائعين</h3>
      <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>البائع</th><th>المبلغ</th><th>البيان</th></tr></thead><tbody>
        {central.deposits.map((d) => <tr key={d.id}><td>{when(d.created_at)}</td><td>{d.seller}</td><td><strong>{money(d.amount)}</strong></td><td>{d.description ?? "—"}</td></tr>)}
        {central.deposits.length === 0 && <tr><td colSpan={4} className="table-empty">لا توجد توريدات بعد.</td></tr>}
      </tbody></table></div>
      <p className="footnote">كل توريد يخصم من درج وردية البائع ويضاف هنا في عملية واحدة، فلا يظهر الكاش مرتين في إجمالي الخزائن.</p>
    </>}
  </section>;
}
