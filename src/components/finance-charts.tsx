"use client";
import { useEffect, useState } from "react";

type Point = { key: string; label: string; revenue?: number; expenses?: number; purchases?: number; payroll?: number; sales?: number };
type Dash = {
  role: "owner" | "seller";
  metrics: Record<string, number>;
  series: Point[];
  byBranch?: { id: string; name: string; sales: number; orders: number }[];
  accounts?: { id: string; name: string; balance: number; branch_id: string }[];
};

const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n);
const compact = (n: number) => new Intl.NumberFormat("ar-EG", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return <article className={`fin-kpi ${tone ?? ""}`}><span>{label}</span><strong>{money(value)}</strong></article>;
}

function MonthlyBars({ data }: { data: { label: string; a: number; b: number }[]; }) {
  const W = 560, H = 220, padL = 44, padB = 28, padT = 10;
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const innerH = H - padB - padT, step = (W - padL) / data.length, bw = Math.min(26, step / 3);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fin-svg" role="img" aria-label="الإيرادات مقابل المصروفات لآخر 6 شهور">
      {[0, 0.5, 1].map((t) => <g key={t}><line x1={padL} x2={W} y1={y(max * t)} y2={y(max * t)} className="fin-grid" /><text x={padL - 6} y={y(max * t) + 3} textAnchor="end" className="fin-axis">{compact(max * t)}</text></g>)}
      {data.map((d, i) => {
        const cx = padL + step * i + step / 2;
        return <g key={d.label + i}>
          <rect x={cx - bw - 1} y={y(d.a)} width={bw} height={Math.max(0, padT + innerH - y(d.a))} rx="3" className="fin-bar-a"><title>{`${d.label} — إيرادات: ${money(d.a)}`}</title></rect>
          <rect x={cx + 1} y={y(d.b)} width={bw} height={Math.max(0, padT + innerH - y(d.b))} rx="3" className="fin-bar-b"><title>{`${d.label} — مصروفات: ${money(d.b)}`}</title></rect>
          <text x={cx} y={H - 8} textAnchor="middle" className="fin-axis">{d.label}</text>
        </g>;
      })}
    </svg>
  );
}

function HBars({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <p className="footnote">{empty}</p>;
  return <div className="fin-hbars">{rows.map((r) => <div className="fin-hrow" key={r.label}><span className="fin-hlabel">{r.label}</span><div className="fin-htrack"><div className={`fin-hfill ${r.value < 0 ? "neg" : ""}`} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /></div><strong>{money(r.value)}</strong></div>)}</div>;
}

export default function FinanceCharts() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/dashboard", { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "تعذر تحميل الماليات"); if (live) setD(j); })
      .catch((e) => live && setErr(e instanceof Error ? e.message : "تعذر تحميل الماليات"));
    return () => { live = false; };
  }, []);

  if (err) return <section className="panel"><p className="notice error">{err}</p></section>;
  if (!d) return <section className="panel"><p className="footnote">جارٍ تحميل الماليات…</p></section>;

  if (d.role === "seller") {
    return <section className="panel fin-panel">
      <div className="section-heading"><div><p className="eyebrow">أداؤك</p><h2>مبيعاتك لآخر 6 شهور</h2></div></div>
      <div className="fin-kpis"><Kpi label="مبيعات الشهر" value={d.metrics.sales ?? 0} /><Kpi label="عمولة الشهر" value={d.metrics.commission ?? 0} tone="good" /></div>
      <HBars rows={d.series.map((s) => ({ label: s.label, value: s.sales ?? 0 }))} empty="لا توجد مبيعات." />
    </section>;
  }

  const m = d.metrics;
  const bars = d.series.map((s) => ({ label: s.label, a: s.revenue ?? 0, b: (s.purchases ?? 0) + (s.expenses ?? 0) + (s.payroll ?? 0) }));
  const net = (m.sales ?? 0) - (m.purchases ?? 0) - (m.expenses ?? 0);
  return (
    <section className="panel fin-panel">
      <div className="section-heading"><div><p className="eyebrow">الماليات</p><h2>ملخص الشهر الحالي</h2></div></div>
      <div className="fin-kpis">
        <Kpi label="المبيعات" value={m.sales ?? 0} />
        <Kpi label="المشتريات" value={m.purchases ?? 0} />
        <Kpi label="المصروفات" value={m.expenses ?? 0} />
        <Kpi label="صافي تقريبي (مبيعات − مشتريات − مصروفات)" value={net} tone={net >= 0 ? "good" : "bad"} />
        <Kpi label="رصيد الخزن" value={m.cash ?? 0} />
        <Kpi label="مستحق من العملاء" value={m.due ?? 0} />
        <Kpi label="مستحق للموردين" value={m.supplierDue ?? 0} />
        <Kpi label="رواتب معلّقة" value={m.pendingPayroll ?? 0} />
      </div>
      <div className="fin-grid-2">
        <div><h3>الإيرادات مقابل المصروفات (6 شهور)</h3>
          <div className="fin-legend"><span><i className="a" />إيرادات</span><span><i className="b" />مشتريات + مصروفات + رواتب</span></div>
          <MonthlyBars data={bars} /></div>
        <div><h3>مبيعات الفروع هذا الشهر</h3>
          <HBars rows={(d.byBranch ?? []).map((b) => ({ label: b.name, value: b.sales })).sort((x, y) => y.value - x.value)} empty="لا توجد مبيعات هذا الشهر." />
          <h3 className="fin-sub">أرصدة الخزن</h3>
          <HBars rows={(d.accounts ?? []).map((a) => ({ label: a.name, value: a.balance })).sort((x, y) => y.value - x.value)} empty="لا توجد خزن." /></div>
      </div>
    </section>
  );
}
