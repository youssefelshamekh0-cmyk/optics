"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Branch = { id: string; name: string; status: "ACTIVE" | "INACTIVE" };
type Product = { id: string; sku: string | null; name: string; category: string; brand: string | null; model: string | null; color: string | null; size: string | null; stock: { quantity: number; cost_price: number; reference_price: number } };
const categoryLabels: Record<string, string> = { frame: "شنبر طبي", lens: "عدسة طبية", sunglasses: "نظارة شمسية", contact_lens: "عدسة لاصقة", sports_glasses: "نظارة رياضية", accessory: "إكسسوار", other: "أخرى" };
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "تعذر إتمام الطلب");
  return data;
}

export function ProductsSection({ branches }: { branches: Branch[] }) {
  const activeBranches = branches.filter((b) => b.status === "ACTIVE");
  const [branchId, setBranchId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ sku: "", name: "", category: "frame", brand: "", model: "", color: "", size: "", quantity: "0", costPrice: "0", referencePrice: "0" });
  useEffect(() => { if (!branchId && activeBranches.length) setBranchId(activeBranches[0].id); }, [branchId, activeBranches]);
  const refresh = useCallback(async () => { if (!branchId) return; try { setProducts((await requestJson(`/api/inventory?branchId=${branchId}`)).products); } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل المخزون"); } }, [branchId]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await requestJson("/api/inventory", { method: "POST", body: JSON.stringify({ ...form, branchId, quantity: Number(form.quantity), costPrice: Number(form.costPrice), referencePrice: Number(form.referencePrice) }) });
      setForm({ sku: "", name: "", category: "frame", brand: "", model: "", color: "", size: "", quantity: "0", costPrice: "0", referencePrice: "0" });
      setNotice("تمت إضافة الصنف ورصيد البداية للفرع"); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ الصنف"); } finally { setBusy(false); }
  }
  return <section className="panel catalog-panel"><div className="section-heading"><div><p className="eyebrow">المنتجات والشنابر والعدسات</p><h2>الأصناف والمخزون</h2></div><span className="count-badge">{products.length} صنف</span></div>
    <div className="catalog-toolbar"><label>الفرع<select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><span className="footnote">الرصيد والسعر المرجعي والتكلفة مستقلون لكل فرع.</span></div>
    {error && <div className="notice error">{error}</div>}{notice && <div className="notice success">{notice}</div>}
    <form className="catalog-form" onSubmit={save}><div className="section-heading"><div><p className="eyebrow">كتالوج البراند</p><h3>إضافة صنف ورصيد أولي</h3></div></div><div className="catalog-fields">
      <label>اسم الصنف<input required minLength={2} maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>الفئة<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="frame">شنبر طبي</option><option value="lens">عدسة طبية مخزنية</option><option value="sunglasses">نظارة شمسية</option><option value="contact_lens">عدسة لاصقة</option><option value="sports_glasses">نظارة رياضية</option><option value="accessory">إكسسوار</option><option value="other">أخرى</option></select></label>
      <label>كود الصنف SKU<input maxLength={80} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></label><label>الشركة / الماركة<input maxLength={100} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></label><label>الموديل<input maxLength={100} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></label><label>اللون<input maxLength={60} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></label><label>المقاس<input maxLength={60} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} /></label>
      <label>رصيد البداية<input required type="number" min="0" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label><label>تكلفة الشراء<input required type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></label><label>السعر المرجعي للفرع<input required type="number" min="0" step="0.01" value={form.referencePrice} onChange={(e) => setForm({ ...form, referencePrice: e.target.value })} /></label><button className="primary" disabled={busy || !branchId}>{busy ? "جارٍ الحفظ…" : "حفظ الصنف"}</button>
    </div></form>
    <div className="table-wrap"><table><thead><tr><th>الصنف</th><th>الفئة</th><th>الكود</th><th>الكمية</th><th>التكلفة</th><th>السعر المرجعي</th></tr></thead><tbody>{products.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><small>{[p.brand, p.model, p.color, p.size].filter(Boolean).join(" · ") || "—"}</small></td><td>{categoryLabels[p.category] ?? p.category}</td><td>{p.sku || "—"}</td><td>{p.stock.quantity}</td><td>{money(Number(p.stock.cost_price))}</td><td>{money(Number(p.stock.reference_price))}</td></tr>)}{products.length === 0 && <tr><td colSpan={6} className="table-empty">لا توجد أصناف لهذا الفرع حتى الآن.</td></tr>}</tbody></table></div>
    <p className="footnote">إضافة الصنف تسجل حركة رصيد بداية. التوريدات تسجل من تبويب «توريد العدسات»؛ بيع أصناف الكتالوج يخصم الكمية من رصيد الفرع بعد اعتماد الفاتورة.</p>
  </section>;
}

type Price = { id: string; sphere_min: number; sphere_max: number; cylinder_min: number | null; cylinder_max: number | null; options: string; cost_price: number; reference_price: number; lens: { name: string; category: string; company: string } | null };
export function LensPricesSection({ branches }: { branches: Branch[] }) {
  const activeBranches = branches.filter((b) => b.status === "ACTIVE");
  const [branchId, setBranchId] = useState(""); const [prices, setPrices] = useState<Price[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ company: "", type: "", category: "طبي", sphereMin: "-6", sphereMax: "6", cylinderMin: "", cylinderMax: "", options: "", costPrice: "0", referencePrice: "0" });
  useEffect(() => { if (!branchId && activeBranches.length) setBranchId(activeBranches[0].id); }, [branchId, activeBranches]);
  const refresh = useCallback(async () => { if (!branchId) return; try { setPrices((await requestJson(`/api/lens-prices?branchId=${branchId}`)).prices); } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل الأسعار"); } }, [branchId]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); setNotice(""); try {
    await requestJson("/api/lens-prices", { method: "POST", body: JSON.stringify({ ...form, branchId, sphereMin: Number(form.sphereMin), sphereMax: Number(form.sphereMax), cylinderMin: form.cylinderMin === "" ? null : Number(form.cylinderMin), cylinderMax: form.cylinderMax === "" ? null : Number(form.cylinderMax), costPrice: Number(form.costPrice), referencePrice: Number(form.referencePrice) }) });
    setNotice("تم حفظ نطاق السعر للفرع"); await refresh();
  } catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ السعر"); } finally { setBusy(false); } }
  return <section className="panel catalog-panel"><div className="section-heading"><div><p className="eyebrow">قائمة مرجعية مستقلة لكل فرع</p><h2>أسعار العدسات</h2></div><span className="count-badge">{prices.length} نطاق سعر</span></div>
    <div className="catalog-toolbar"><label>الفرع<select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
    {error && <div className="notice error">{error}</div>}{notice && <div className="notice success">{notice}</div>}
    <form className="catalog-form" onSubmit={save}><div className="section-heading"><div><p className="eyebrow">شركة ونوع ونطاق مقاس</p><h3>إضافة سعر مرجعي</h3></div></div><div className="catalog-fields">
      <label>شركة العدسات<input required minLength={2} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label><label>نوع العدسة<input required minLength={2} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} /></label><label>الفئة<input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
      <label>SPH من<input required type="number" step="0.25" value={form.sphereMin} onChange={(e) => setForm({ ...form, sphereMin: e.target.value })} /></label><label>SPH إلى<input required type="number" step="0.25" value={form.sphereMax} onChange={(e) => setForm({ ...form, sphereMax: e.target.value })} /></label><label>CYL من (اختياري)<input type="number" step="0.25" value={form.cylinderMin} onChange={(e) => setForm({ ...form, cylinderMin: e.target.value })} /></label><label>CYL إلى<input type="number" step="0.25" value={form.cylinderMax} onChange={(e) => setForm({ ...form, cylinderMax: e.target.value })} /></label>
      <label>الإضافات أو الخيارات<input placeholder="مثال: بلوكات، فوتوكروميك" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} /></label><label>التكلفة<input required type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></label><label>السعر المرجعي<input required type="number" min="0" step="0.01" value={form.referencePrice} onChange={(e) => setForm({ ...form, referencePrice: e.target.value })} /></label><button className="primary" disabled={busy || !branchId}>{busy ? "جارٍ الحفظ…" : "حفظ السعر"}</button>
    </div></form>
    <div className="table-wrap"><table><thead><tr><th>الشركة والنوع</th><th>SPH</th><th>CYL</th><th>الإضافات</th><th>التكلفة</th><th>السعر المرجعي</th></tr></thead><tbody>{prices.map((p) => <tr key={p.id}><td><strong>{p.lens?.company}</strong><small>{p.lens?.name} · {p.lens?.category}</small></td><td>{p.sphere_min} إلى {p.sphere_max}</td><td>{p.cylinder_min === null ? "الكل" : `${p.cylinder_min} إلى ${p.cylinder_max}`}</td><td>{p.options || "—"}</td><td>{money(Number(p.cost_price))}</td><td>{money(Number(p.reference_price))}</td></tr>)}{prices.length === 0 && <tr><td colSpan={6} className="table-empty">لم تضاف أسعار لهذا الفرع بعد.</td></tr>}</tbody></table></div>
    <p className="footnote">النظام يمنع تداخل نطاقي قياسات متعارضين لنفس الشركة والنوع والخيارات. إدخال سعر العدسات تلقائيًا في الفاتورة يأتي بعد اكتمال وتدقيق جداول الفروع.</p>
  </section>;
}

type SupplyItem = { id: string; quantity: number; unit_cost: number; item_name?: string | null; product: { name: string } | null };
type Supply = { id: string; invoice_number: string; received_at: string; total_cost: number; supplier: { name: string } | null; items: SupplyItem[] };
type Company = { id: string; name: string; pending: number };
type Rx = { sphere: number | string | null; cylinder: number | string | null; axis: number | string | null };
type Requirement = { id: string; invoiceNumber: number; createdAt: string; deliveryStatus: string; customer: string; phone: string; lensName: string; options: string; right: Rx; left: Rx; suggestedCost: number };
type SupplyLine = { key: string; productId?: string; newName?: string; category?: string; name: string; quantity: string; unitCost: string };
const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const rx = (side: Rx) => `${side.sphere ?? "—"} / ${side.cylinder ?? "—"}${side.axis !== null && side.axis !== "" ? ` × ${side.axis}` : ""}`;
export function LensSuppliesSection({ branches }: { branches: Branch[] }) {
  const activeBranches = branches.filter((b) => b.status === "ACTIVE");
  const [branchId, setBranchId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [arrived, setArrived] = useState<Record<string, string>>({}); // saleItemId -> unit cost (a key present = lens arrived)
  const [products, setProducts] = useState<Product[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ invoiceNumber: "", supplierName: "", supplierPhone: "", receivedAt: localInput() });
  const [lines, setLines] = useState<SupplyLine[]>([]);
  const [filter, setFilter] = useState(""); const [newName, setNewName] = useState(""); const [newCategory, setNewCategory] = useState("lens");
  useEffect(() => { if (!branchId && activeBranches.length) setBranchId(activeBranches[0].id); }, [branchId, activeBranches]);
  const refresh = useCallback(async () => {
    if (!branchId) return;
    try {
      const result = await requestJson(`/api/lens-supplies?branchId=${branchId}${companyId ? `&companyId=${companyId}` : ""}`);
      setSupplies(result.supplies ?? []); setCompanies(result.companies ?? []); setRequirements(result.requirements ?? []);
      setProducts((result.products ?? []).filter((p: Product) => ["lens", "contact_lens"].includes(p.category))); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل التوريدات"); }
  }, [branchId, companyId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const company = companies.find((c) => c.id === companyId) ?? null;
  function chooseCompany(next: Company) {
    setCompanyId(next.id); setArrived({}); setLines([]); setRequirements([]);
    setForm((current) => ({ ...current, supplierName: next.name }));
  }
  function toggleArrived(r: Requirement) {
    setArrived((current) => { const copy = { ...current }; if (r.id in copy) delete copy[r.id]; else copy[r.id] = r.suggestedCost ? String(r.suggestedCost) : ""; return copy; });
  }
  const allArrived = requirements.length > 0 && requirements.every((r) => r.id in arrived);
  function toggleAll() { setArrived(allArrived ? {} : Object.fromEntries(requirements.map((r) => [r.id, r.suggestedCost ? String(r.suggestedCost) : ""]))); }

  const picked = new Set(lines.map((l) => l.productId).filter(Boolean));
  const brandMatches = company ? products.filter((p) => (p.brand ?? "").trim().toLowerCase() === company.name.trim().toLowerCase()) : products;
  const stockCatalog = company && brandMatches.length === 0 ? products : brandMatches;
  const visible = stockCatalog.filter((p) => !filter.trim() || `${p.name} ${p.brand ?? ""} ${p.sku ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const arrivedIds = Object.keys(arrived);
  const arrivedTotal = arrivedIds.reduce((sum, id) => sum + (Number(arrived[id]) || 0), 0);
  const stockTotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const total = arrivedTotal + stockTotal;
  const patch = (key: string, change: Partial<SupplyLine>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...change } : l)));
  function toggle(p: Product) {
    if (picked.has(p.id)) setLines(lines.filter((l) => l.productId !== p.id));
    else setLines([...lines, { key: p.id, productId: p.id, name: p.name, quantity: "1", unitCost: "" }]);
  }
  function addNew() {
    const name = newName.trim();
    if (name.length < 2) return;
    if (lines.some((l) => l.name.trim().toLowerCase() === name.toLowerCase())) { setError("هذا النوع مضاف بالفعل في القائمة"); return; }
    setError(""); setLines([...lines, { key: `new-${Date.now()}`, newName: name, category: newCategory, name, quantity: "1", unitCost: "" }]); setNewName("");
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (!arrivedIds.length && !lines.length) { setError("حدّد العدسات التي وصلت أو أضف أصنافًا مخزنية"); return; }
    if (arrivedIds.some((id) => arrived[id] === "" || Number(arrived[id]) < 0) || lines.some((l) => l.unitCost === "" || Number(l.unitCost) < 0 || !(Number(l.quantity) >= 1))) { setError("اكتب سعر كل عدسة وصلت وكمية وسعر كل صنف قبل التأكيد"); return; }
    setBusy(true);
    try {
      const category = (key: string) => (key === "contact_lens" ? "contact_lens" : "lens");
      await requestJson("/api/lens-supplies", { method: "POST", body: JSON.stringify({ ...form, receivedAt: new Date(form.receivedAt).toISOString(), branchId,
        requirements: arrivedIds.map((id) => ({ saleItemId: id, unitCost: Number(arrived[id]) })),
        items: lines.map((l) => (l.productId ? { productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) } : { newName: l.newName, category: category(l.category ?? "lens"), quantity: Number(l.quantity), unitCost: Number(l.unitCost) })) }) });
      setForm({ ...form, invoiceNumber: "", supplierPhone: "", receivedAt: localInput() }); setLines([]); setArrived({});
      setNotice("تم إتمام فاتورة التوريد وتسجيل العدسات الواصلة"); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تسجيل التوريد"); } finally { setBusy(false); }
  }

  return <section className="panel catalog-panel"><div className="section-heading"><div><p className="eyebrow">استلام فعلي من شركة العدسات</p><h2>توريد العدسات</h2></div><span className="count-badge">{supplies.length} فاتورة توريد</span></div>
    <div className="catalog-toolbar"><label>الفرع المستلم<select value={branchId} onChange={(e) => { setBranchId(e.target.value); setCompanyId(""); setArrived({}); setLines([]); setRequirements([]); }}>{activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    <form className="catalog-form" onSubmit={save}>
      <div className="section-heading"><div><p className="eyebrow">الخطوة ١</p><h3>اختر شركة العدسات</h3></div></div>
      <div className="req-company" role="group" aria-label="شركات العدسات">{companies.map((c) => <button type="button" key={c.id} className={c.id === companyId ? "on" : ""} aria-pressed={c.id === companyId} onClick={() => chooseCompany(c)}>{c.name}{c.pending > 0 && <b>{c.pending}</b>}</button>)}{companies.length === 0 && <span className="footnote">لا توجد شركات عدسات مسجلة بعد. تُضاف الشركة من «أسعار العدسات».</span>}</div>

      {company && <>
        <div className="section-heading"><div><p className="eyebrow">الخطوة ٢</p><h3>العدسات المطلوبة من {company.name}</h3></div>{requirements.length > 0 && <button type="button" className="row-action" onClick={toggleAll}>{allArrived ? "إلغاء تحديد الكل" : "تحديد الكل كواصل"}</button>}</div>
        {requirements.length > 0 ? <div className="table-wrap"><table className="supply-table req-table"><thead><tr><th>وصل</th><th>الفاتورة والعميل</th><th>نوع العدسة</th><th>اليمنى SPH / CYL × AXIS</th><th>اليسرى SPH / CYL × AXIS</th><th>تكلفة الزوج</th></tr></thead><tbody>
          {requirements.map((r) => { const on = r.id in arrived; return <tr key={r.id} className={on ? "picked" : ""}>
            <td><input type="checkbox" aria-label={`وصلت عدسات الفاتورة ${r.invoiceNumber}`} checked={on} onChange={() => toggleArrived(r)} /></td>
            <td><strong>#{r.invoiceNumber}</strong><small>{r.customer}{r.phone ? ` · ${r.phone}` : ""}</small></td>
            <td>{r.lensName}{r.options && <small>{r.options}</small>}</td>
            <td className="rx">{rx(r.right)}</td><td className="rx">{rx(r.left)}</td>
            <td>{on ? <input aria-label={`تكلفة عدسات الفاتورة ${r.invoiceNumber}`} type="number" min="0" step="0.01" required value={arrived[r.id]} onChange={(e) => setArrived({ ...arrived, [r.id]: e.target.value })} /> : <span className="footnote">{r.suggestedCost ? money(r.suggestedCost) : "—"}</span>}</td></tr>; })}
        </tbody></table></div> : <p className="footnote">لا توجد عدسات مطلوبة من هذه الشركة لهذا الفرع حاليًا. يمكنك إضافة أصناف مخزنية بالأسفل.</p>}

        <details className="lens-picker" open={lines.length > 0}><summary className="sale-subheading"><strong>أصناف عدسات مخزنية من نفس الشركة (اختياري)</strong></summary>
          {stockCatalog.length > 0 && <>
            <input className="lens-filter" type="search" placeholder="ابحث في أنواع العدسات…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="lens-chips" role="group" aria-label="أنواع العدسات">{visible.map((p) => <button type="button" key={p.id} className={`lens-chip ${picked.has(p.id) ? "on" : ""}`} aria-pressed={picked.has(p.id)} onClick={() => toggle(p)}>{picked.has(p.id) ? "✓ " : "＋ "}{p.name}{p.brand ? ` — ${p.brand}` : ""}</button>)}{visible.length === 0 && <span className="footnote">لا توجد أنواع مطابقة.</span>}</div>
          </>}
          <div className="lens-new"><input placeholder={products.length ? "نوع جديد غير موجود في القائمة" : "اكتب اسم أول نوع عدسة"} maxLength={160} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNew(); } }} />
            <select aria-label="فئة النوع الجديد" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}><option value="lens">عدسة طبية</option><option value="contact_lens">عدسة لاصقة</option></select>
            <button type="button" className="row-action" onClick={addNew} disabled={newName.trim().length < 2}>＋ إضافة نوع جديد</button></div>
          {lines.length > 0 && <div className="table-wrap"><table className="supply-table"><thead><tr><th>نوع العدسة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th></th></tr></thead><tbody>
            {lines.map((l) => <tr key={l.key}><td><strong>{l.name}</strong>{l.newName && <small>نوع جديد سيُضاف للكتالوج</small>}</td>
              <td><input aria-label={`كمية ${l.name}`} required type="number" min="1" step="1" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} /></td>
              <td><input aria-label={`سعر ${l.name}`} required type="number" min="0" step="0.01" value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} /></td>
              <td>{money((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}</td>
              <td><button type="button" className="quiet remove-sale-item" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>حذف</button></td></tr>)}
          </tbody></table></div>}
        </details>

        <div className="section-heading"><div><p className="eyebrow">الخطوة ٣</p><h3>إتمام فاتورة التوريد</h3></div></div>
        <div className="catalog-fields">
          <label>المورد<input required minLength={2} value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} /></label>
          <label>رقم هاتف المورد<input type="tel" value={form.supplierPhone} onChange={(e) => setForm({ ...form, supplierPhone: e.target.value })} /></label>
          <label>رقم فاتورة المورد<input required value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></label>
          <label>تاريخ الاستلام<input required type="datetime-local" value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} /></label>
        </div>
        <div className="req-summary"><span>العدسات الواصلة: <strong>{arrivedIds.length}</strong>{lines.length > 0 && <> · أصناف مخزنية: <strong>{lines.length}</strong></>}</span><span>إجمالي الفاتورة: <strong>{money(total)}</strong></span></div>
        <button className="primary" disabled={busy || !branchId || (arrivedIds.length === 0 && lines.length === 0)}>{busy ? "جارٍ التسجيل…" : "إتمام فاتورة التوريد وتحديث الحالة"}</button>
        <p className="footnote">التأكيد عملية نهائية: تُسجَّل العدسات المحددة كمستلمة وتخرج من قائمة المطلوب، وتزيد الأصناف المخزنية رصيد الفرع مرة واحدة.</p>
      </>}
    </form>
    <div className="table-wrap"><table><thead><tr><th>فاتورة المورد</th><th>المورد</th><th>تاريخ الاستلام</th><th>الأصناف</th><th>الإجمالي</th></tr></thead><tbody>{supplies.map((s) => <tr key={s.id}><td>{s.invoice_number}</td><td>{s.supplier?.name ?? "—"}</td><td>{new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(s.received_at))}</td><td>{s.items.map((i) => `${i.product?.name ?? i.item_name ?? "صنف"} × ${i.quantity} (${money(Number(i.unit_cost))})`).join("، ")}</td><td>{money(Number(s.total_cost))}</td></tr>)}{supplies.length === 0 && <tr><td colSpan={5} className="table-empty">لا توجد توريدات مسجلة لهذا الفرع.</td></tr>}</tbody></table></div>
  </section>;
}
