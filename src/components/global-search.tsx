"use client";

import { useEffect, useState } from "react";

type Result = {
  customers: { id: string; name: string; phone: string | null }[];
  invoices: { id: string; invoiceNumber: number; customerName: string; branchName: string; total: number; status: string }[];
  products: { id: string; name: string; sku: string | null; category: string; branches: { name: string; quantity: number }[] }[];
};
const empty: Result = { customers: [], invoices: [], products: [] };
const money = (value: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(value);

export default function GlobalSearch({ onNavigate, isOwner }: { onNavigate: (tab: string) => void; isOwner: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result>(empty);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) { setResults(empty); setError(""); setLoading(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch("/api/global-search?q=" + encodeURIComponent(value), { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "تعذر البحث");
        if (active) { setResults(data as Result); setOpen(true); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "تعذر البحث"); }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  const hasResults = results.customers.length + results.invoices.length + results.products.length > 0;
  function go(tab: string) { onNavigate(tab); setOpen(false); setQuery(""); }
  return <div className="global-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <input aria-label="بحث عام" value={query} onFocus={() => setOpen(true)} onChange={(event) => setQuery(event.target.value)} placeholder="بحث عام: عميل، فاتورة، صنف…" />
    {open && query.trim().length >= 2 && <div className="global-search-results">
      {loading && <p>جارٍ البحث…</p>}
      {error && <p className="notice error">{error}</p>}
      {!loading && !error && !hasResults && <p>لا توجد نتائج مطابقة.</p>}
      {results.customers.length > 0 && <section><strong>العملاء</strong>{results.customers.map((item) => <button type="button" key={item.id} onClick={() => go("customers")}><span>{item.name}</span><small>{item.phone || "بدون هاتف"}</small></button>)}</section>}
      {results.invoices.length > 0 && <section><strong>الفواتير</strong>{results.invoices.map((item) => <button type="button" key={item.id} onClick={() => go("invoices")}><span>فاتورة #{item.invoiceNumber} — {item.customerName}</span><small>{item.branchName} · {money(item.total)} · {item.status}</small></button>)}</section>}
      {results.products.length > 0 && <section><strong>الأصناف</strong>{results.products.map((item) => <button type="button" key={item.id} onClick={() => go(isOwner ? "inventory" : "pos")}><span>{item.name}</span><small>{item.sku || "بدون كود"} · {(item.branches ?? []).map((branch) => branch.name + ": " + branch.quantity).join("، ")}</small></button>)}</section>}
    </div>}
  </div>;
}
