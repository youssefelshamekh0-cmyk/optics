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
type TypeRow = { key: number; name: string; costPrice: string; referencePrice: string };
const emptyTypeRow = (key: number): TypeRow => ({ key, name: "", costPrice: "0", referencePrice: "0" });
export function LensPricesSection({ branches }: { branches: Branch[] }) {
  const activeBranches = branches.filter((b) => b.status === "ACTIVE");
  const [branchId, setBranchId] = useState(""); const [prices, setPrices] = useState<Price[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ company: "", category: "طبي", sphereMin: "-6", sphereMax: "6", cylinderMin: "", cylinderMax: "", options: "" });
  const [rows, setRows] = useState<TypeRow[]>([emptyTypeRow(1)]);
  const [nextKey, setNextKey] = useState(2);
  useEffect(() => { if (!branchId && activeBranches.length) setBranchId(activeBranches[0].id); }, [branchId, activeBranches]);
  const refresh = useCallback(async () => { if (!branchId) return; try { setPrices((await requestJson(`/api/lens-prices?branchId=${branchId}`)).prices); } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل الأسعار"); } }, [branchId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const patchRow = (key: number, change: Partial<TypeRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  function addRow() { setRows([...rows, emptyTypeRow(nextKey)]); setNextKey(nextKey + 1); }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    const names = rows.map((r) => r.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) { setError("نوع العدسة مكرر في القائمة"); return; }
    setBusy(true);
    try {
      const result = await requestJson("/api/lens-prices", { method: "POST", body: JSON.stringify({
        branchId, company: form.company, category: form.category, options: form.options,
        sphereMin: Number(form.sphereMin), sphereMax: Number(form.sphereMax),
        cylinderMin: form.cylinderMin === "" ? null : Number(form.cylinderMin), cylinderMax: form.cylinderMax === "" ? null : Number(form.cylinderMax),
        types: rows.map((r) => ({ name: r.name, costPrice: Number(r.costPrice), referencePrice: Number(r.referencePrice) })),
      }) });
      setNotice(`تم حفظ ${result.created} نوع بأسعارها للفرع`); setRows([emptyTypeRow(nextKey)]); setNextKey(nextKey + 1); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ الأسعار"); } finally { setBusy(false); }
  }
  return <section className="panel catalog-panel"><div className="section-heading"><div><p className="eyebrow">قائمة مرجعية مستقلة لكل فرع</p><h2>أسعار العدسات</h2></div><span className="count-badge">{prices.length} نطاق سعر</span></div>
    <div className="catalog-toolbar"><label>الفرع<select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    <form className="catalog-form" onSubmit={save}><div className="section-heading"><div><p className="eyebrow">شركة واحدة، عدة أنواع، ولكل نوع سعره</p><h3>إضافة أسعار مرجعية</h3></div></div>
      <div className="catalog-fields">
        <label>شركة العدسات<input required minLength={2} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label><label>الفئة<input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
        <label>SPH من<input required type="number" step="0.25" value={form.sphereMin} onChange={(e) => setForm({ ...form, sphereMin: e.target.value })} /></label><label>SPH إلى<input required type="number" step="0.25" value={form.sphereMax} onChange={(e) => setForm({ ...form, sphereMax: e.target.value })} /></label><label>CYL من (اختياري)<input type="number" step="0.25" value={form.cylinderMin} onChange={(e) => setForm({ ...form, cylinderMin: e.target.value })} /></label><label>CYL إلى<input type="number" step="0.25" value={form.cylinderMax} onChange={(e) => setForm({ ...form, cylinderMax: e.target.value })} /></label>
        <label>الإضافات أو الخيارات<input placeholder="مثال: بلوكات، فوتوكروميك" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} /></label>
      </div>
      <div className="supply-table-wrap"><div className="sale-subheading"><strong>أنواع العدسات لهذه الشركة</strong><span className="footnote">النطاق والخيارات أعلاه تنطبق على كل الأنواع؛ اكتب سعر كل نوع بجانبه.</span></div>
        <div className="table-wrap"><table className="supply-table"><thead><tr><th>نوع العدسة</th><th>التكلفة</th><th>السعر المرجعي</th><th></th></tr></thead><tbody>
          {rows.map((r, index) => <tr key={r.key}>
            <td><input aria-label={`نوع العدسة ${index + 1}`} required minLength={2} maxLength={120} value={r.name} onChange={(e) => patchRow(r.key, { name: e.target.value })} placeholder="اسم النوع" /></td>
            <td><input aria-label={`تكلفة ${r.name || `النوع ${index + 1}`}`} required type="number" min="0" step="0.01" value={r.costPrice} onChange={(e) => patchRow(r.key, { costPrice: e.target.value })} /></td>
            <td><input aria-label={`سعر ${r.name || `النوع ${index + 1}`}`} required type="number" min="0" step="0.01" value={r.referencePrice} onChange={(e) => patchRow(r.key, { referencePrice: e.target.value })} /></td>
            <td>{rows.length > 1 && <button type="button" className="quiet remove-sale-item" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>حذف</button>}</td></tr>)}
        </tbody></table></div>
        <button type="button" className="row-action" onClick={addRow} disabled={rows.length >= 30}>＋ إضافة نوع آخر</button>
      </div>
      <button className="primary" disabled={busy || !branchId}>{busy ? "جارٍ الحفظ…" : `حفظ ${rows.length > 1 ? `${rows.length} أنواع` : "السعر"}`}</button>
    </form>
    <div className="table-wrap"><table><thead><tr><th>الشركة والنوع</th><th>SPH</th><th>CYL</th><th>الإضافات</th><th>التكلفة</th><th>السعر المرجعي</th></tr></thead><tbody>{prices.map((p) => <tr key={p.id}><td><strong>{p.lens?.company}</strong><small>{p.lens?.name} · {p.lens?.category}</small></td><td>{p.sphere_min} إلى {p.sphere_max}</td><td>{p.cylinder_min === null ? "الكل" : `${p.cylinder_min} إلى ${p.cylinder_max}`}</td><td>{p.options || "—"}</td><td>{money(Number(p.cost_price))}</td><td>{money(Number(p.reference_price))}</td></tr>)}{prices.length === 0 && <tr><td colSpan={6} className="table-empty">لم تضاف أسعار لهذا الفرع بعد.</td></tr>}</tbody></table></div>
    <p className="footnote">النظام يمنع تداخل نطاقي قياسات متعارضين لنفس الشركة والنوع والخيارات. إذا تعارض نوع واحد لا يُحفظ أي نوع من المجموعة.</p>
  </section>;
}

type Supply = { id: string; invoice_number: string; received_at: string; total_cost: number; supplier: { name: string } | null; items: { id: string; quantity: number; unit_cost: number; product: { name: string } | null }[] };
type RegisteredLens = { id: string; name: string; category: string; company: string };
type SupplyLine = { key: string; productId?: string; newName?: string; category?: string; name: string; quantity: string; unitCost: string };
const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function LensSuppliesSection({ branches }: { branches: Branch[] }) {
  const activeBranches = branches.filter((b) => b.status === "ACTIVE");
  const [branchId, setBranchId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [lensTypes, setLensTypes] = useState<RegisteredLens[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ invoiceNumber: "", supplierName: "", supplierPhone: "", receivedAt: localInput() });
  const [lines, setLines] = useState<SupplyLine[]>([]);
  const [filter, setFilter] = useState(""); const [newName, setNewName] = useState(""); const [newCategory, setNewCategory] = useState("lens");
  const [bulkCost, setBulkCost] = useState("");
  useEffect(() => { if (!branchId && activeBranches.length) setBranchId(activeBranches[0].id); }, [branchId, activeBranches]);
  const refresh = useCallback(async () => {
    if (!branchId) return;
    try { const result = await requestJson(`/api/lens-supplies?branchId=${branchId}`); setSupplies(result.supplies ?? []); setProducts((result.products ?? []).filter((p: Product) => ["lens", "contact_lens"].includes(p.category))); setLensTypes(result.lensTypes ?? []); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل التوريدات"); }
  }, [branchId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const picked = new Set(lines.map((l) => l.productId).filter(Boolean));
  const pickedNames = new Set(lines.map((l) => l.name.trim().toLowerCase()));
  const fullName = (l: RegisteredLens) => `${l.company} ${l.name}`.trim();
  const q = filter.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const registeredNames = new Set(lensTypes.map((l) => fullName(l).toLowerCase()));
  const companyEntries = Object.entries(lensTypes.filter((l) => matches(fullName(l))).reduce<Record<string, RegisteredLens[]>>((acc, l) => { (acc[l.company] ??= []).push(l); return acc; }, {}));
  const otherProducts = products.filter((p) => !registeredNames.has(p.name.trim().toLowerCase()) && matches(`${p.name} ${p.brand ?? ""} ${p.sku ?? ""}`));
  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const patch = (key: string, change: Partial<SupplyLine>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...change } : l)));
  function toggle(p: Product) {
    if (picked.has(p.id)) setLines(lines.filter((l) => l.productId !== p.id));
    else setLines([...lines, { key: p.id, productId: p.id, name: p.name, quantity: "1", unitCost: "" }]);
  }
  // Picking a registered lens reuses the matching stock product when one exists; otherwise the server creates it once.
  function toggleRegistered(l: RegisteredLens) {
    const name = fullName(l); const key = name.toLowerCase();
    if (pickedNames.has(key)) { setLines(lines.filter((x) => x.name.trim().toLowerCase() !== key)); return; }
    const existing = products.find((p) => p.name.trim().toLowerCase() === key);
    if (existing) setLines([...lines, { key: existing.id, productId: existing.id, name: existing.name, quantity: "1", unitCost: "" }]);
    else setLines([...lines, { key: `reg-${l.id}`, newName: name, category: /لاصق/.test(l.category) ? "contact_lens" : "lens", name, quantity: "1", unitCost: "" }]);
  }
  function addNew() {
    const name = newName.trim();
    if (name.length < 2) return;
    if (lines.some((l) => l.name.trim().toLowerCase() === name.toLowerCase())) { setError("هذا النوع مضاف بالفعل في القائمة"); return; }
    setError(""); setLines([...lines, { key: `new-${Date.now()}`, newName: name, category: newCategory, name, quantity: "1", unitCost: "" }]); setNewName("");
  }
  function applyBulk() { if (bulkCost === "") return; setLines(lines.map((l) => ({ ...l, unitCost: bulkCost }))); }

  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (!lines.length) { setError("اختر نوع عدسة واحدًا على الأقل"); return; }
    if (lines.some((l) => l.unitCost === "" || Number(l.unitCost) < 0 || !(Number(l.quantity) >= 1))) { setError("اكتب الكمية وسعر كل نوع قبل التأكيد"); return; }
    setBusy(true);
    try {
      const category = (key: string) => (key === "contact_lens" ? "contact_lens" : "lens");
      await requestJson("/api/lens-supplies", { method: "POST", body: JSON.stringify({ ...form, receivedAt: new Date(form.receivedAt).toISOString(), branchId,
        items: lines.map((l) => (l.productId ? { productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) } : { newName: l.newName, category: category(l.category ?? "lens"), quantity: Number(l.quantity), unitCost: Number(l.unitCost) })) }) });
      setForm({ ...form, invoiceNumber: "", supplierPhone: "", receivedAt: localInput() }); setLines([]); setBulkCost("");
      setNotice("تم تسجيل التوريد وزيادة رصيد الفرع بعد الاستلام"); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تسجيل التوريد"); } finally { setBusy(false); }
  }

  return <section className="panel catalog-panel"><div className="section-heading"><div><p className="eyebrow">استلام فعلي يسجل حركة مخزون</p><h2>توريد العدسات</h2></div><span className="count-badge">{supplies.length} فاتورة توريد</span></div>
    <div className="catalog-toolbar"><label>الفرع المستلم<select value={branchId} onChange={(e) => { setBranchId(e.target.value); setLines([]); }}>{activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    <form className="catalog-form" onSubmit={save}>
      <div className="section-heading"><div><p className="eyebrow">فاتورة المورد</p><h3>تسجيل استلام عدسات</h3></div></div>
      <div className="catalog-fields">
        <label>المورد<input required minLength={2} value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} /></label>
        <label>رقم هاتف المورد<input type="tel" value={form.supplierPhone} onChange={(e) => setForm({ ...form, supplierPhone: e.target.value })} /></label>
        <label>رقم فاتورة المورد<input required value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></label>
        <label>تاريخ الاستلام<input required type="datetime-local" value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} /></label>
      </div>
      <div className="lens-picker">
        <div className="sale-subheading"><strong>أنواع العدسات المستلمة</strong><span className="footnote">اضغط على أي نوع لإضافته، واكتب كمية وسعر كل نوع.</span></div>
        {(products.length > 0 || lensTypes.length > 0) && <>
          <input className="lens-filter" type="search" placeholder="ابحث في أنواع العدسات…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {companyEntries.map(([company, types]) => <div key={company} className="lens-company-group"><strong className="footnote">{company} — عدسات مسجلة في الأسعار والفواتير</strong><div className="lens-chips" role="group" aria-label={`عدسات ${company}`}>{types.map((l) => { const on = pickedNames.has(fullName(l).toLowerCase()); return <button type="button" key={l.id} className={`lens-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleRegistered(l)}>{on ? "✓ " : "＋ "}{l.name}</button>; })}</div></div>)}
          {otherProducts.length > 0 && <div className="lens-company-group"><strong className="footnote">أصناف عدسات أخرى بالمخزون</strong><div className="lens-chips" role="group" aria-label="أصناف العدسات">{otherProducts.map((p) => <button type="button" key={p.id} className={`lens-chip ${picked.has(p.id) ? "on" : ""}`} aria-pressed={picked.has(p.id)} onClick={() => toggle(p)}>{picked.has(p.id) ? "✓ " : "＋ "}{p.name}{p.brand ? ` — ${p.brand}` : ""}</button>)}</div></div>}
          {companyEntries.length === 0 && otherProducts.length === 0 && <span className="footnote">لا توجد أنواع مطابقة.</span>}
        </>}
        <div className="lens-new"><input placeholder={products.length ? "نوع جديد غير موجود في القائمة" : "اكتب اسم أول نوع عدسة"} maxLength={160} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNew(); } }} />
          <select aria-label="فئة النوع الجديد" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}><option value="lens">عدسة طبية</option><option value="contact_lens">عدسة لاصقة</option></select>
          <button type="button" className="row-action" onClick={addNew} disabled={newName.trim().length < 2}>＋ إضافة نوع جديد</button></div>
      </div>
      {lines.length > 0 && <div className="supply-table-wrap">
        <div className="supply-bulk"><label>سعر موحد لكل الأنواع<input type="number" min="0" step="0.01" value={bulkCost} onChange={(e) => setBulkCost(e.target.value)} placeholder="اختياري" /></label><button type="button" className="row-action" onClick={applyBulk} disabled={bulkCost === ""}>تطبيق على الكل</button></div>
        <div className="table-wrap"><table className="supply-table"><thead><tr><th>نوع العدسة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th></th></tr></thead><tbody>
          {lines.map((l) => <tr key={l.key}><td><strong>{l.name}</strong>{l.newName && <small>نوع جديد سيُضاف للكتالوج</small>}</td>
            <td><input aria-label={`كمية ${l.name}`} required type="number" min="1" step="1" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} /></td>
            <td><input aria-label={`سعر ${l.name}`} required type="number" min="0" step="0.01" value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} /></td>
            <td>{money((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}</td>
            <td><button type="button" className="quiet remove-sale-item" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>حذف</button></td></tr>)}
        </tbody><tfoot><tr><td colSpan={3}>إجمالي الفاتورة ({lines.length} نوع)</td><td colSpan={2}><strong>{money(total)}</strong></td></tr></tfoot></table></div>
      </div>}
      <button className="primary" disabled={busy || !branchId || lines.length === 0}>{busy ? "جارٍ التسجيل…" : "تأكيد الاستلام وتحديث المخزون"}</button>
      <p className="footnote">التأكيد عملية نهائية وتزيد المخزون مرة واحدة، مع حفظ رقم الفاتورة والمورد والتكلفة.</p>
    </form>
    <div className="table-wrap"><table><thead><tr><th>فاتورة المورد</th><th>المورد</th><th>تاريخ الاستلام</th><th>الأصناف</th><th>الإجمالي</th></tr></thead><tbody>{supplies.map((s) => <tr key={s.id}><td>{s.invoice_number}</td><td>{s.supplier?.name ?? "—"}</td><td>{new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(s.received_at))}</td><td>{s.items.map((i) => `${i.product?.name ?? "صنف"} × ${i.quantity} (${money(Number(i.unit_cost))})`).join("، ")}</td><td>{money(Number(s.total_cost))}</td></tr>)}{supplies.length === 0 && <tr><td colSpan={5} className="table-empty">لا توجد توريدات مسجلة لهذا الفرع.</td></tr>}</tbody></table></div>
  </section>;
}
