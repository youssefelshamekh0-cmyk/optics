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

type Supply = { id: string; invoice_number: string; received_at: string; total_cost: number; supplier: { name: string } | null; items: { id: string; quantity: number; unit_cost: number; product: { name: string } | null }[] };
type SupplyLine = { productId: string; quantity: string; unitCost: string };
export function LensSuppliesSection({ branches }: { branches: Branch[] }) {
  const activeBranches = branches.filter((b) => b.status === "ACTIVE"); const [branchId, setBranchId] = useState(""); const [products, setProducts] = useState<Product[]>([]); const [supplies, setSupplies] = useState<Supply[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ invoiceNumber: "", supplierName: "", supplierPhone: "", receivedAt: new Date().toISOString().slice(0, 16) }); const [lines, setLines] = useState<SupplyLine[]>([{ productId: "", quantity: "1", unitCost: "" }]);
  useEffect(() => { if (!branchId && activeBranches.length) setBranchId(activeBranches[0].id); }, [branchId, activeBranches]);
  const refresh = useCallback(async () => { if (!branchId) return; try { const result = await requestJson(`/api/lens-supplies?branchId=${branchId}`); setSupplies(result.supplies); setProducts(result.products.filter((p: Product) => ["lens", "contact_lens"].includes(p.category))); } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل التوريدات"); } }, [branchId]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); setNotice(""); try {
    await requestJson("/api/lens-supplies", { method: "POST", body: JSON.stringify({ ...form, receivedAt: new Date(form.receivedAt).toISOString(), branchId, items: lines.map((x) => ({ productId: x.productId, quantity: Number(x.quantity), unitCost: Number(x.unitCost) })) }) });
    setForm({ ...form, invoiceNumber: "", supplierPhone: "" }); setLines([{ productId: "", quantity: "1", unitCost: "" }]); setNotice("تم تسجيل التوريد وزيادة رصيد الفرع بعد الاستلام"); await refresh();
  } catch (e) { setError(e instanceof Error ? e.message : "تعذر تسجيل التوريد"); } finally { setBusy(false); } }
  return <section className="panel catalog-panel"><div className="section-heading"><div><p className="eyebrow">استلام فعلي يسجل حركة مخزون</p><h2>توريد العدسات</h2></div><span className="count-badge">{supplies.length} فاتورة توريد</span></div>
    <div className="catalog-toolbar"><label>الفرع المستلم<select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
    {error && <div className="notice error">{error}</div>}{notice && <div className="notice success">{notice}</div>}
    {products.length === 0 ? <div className="empty"><strong>أضف أصناف العدسات أولًا</strong><p>بعدها هتظهر هنا لاختيارها في فاتورة التوريد.</p></div> : <form className="catalog-form" onSubmit={save}><div className="section-heading"><div><p className="eyebrow">فاتورة المورد</p><h3>تسجيل استلام عدسات</h3></div></div><div className="catalog-fields">
      <label>المورد<input required minLength={2} value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} /></label><label>رقم هاتف المورد<input type="tel" value={form.supplierPhone} onChange={(e) => setForm({ ...form, supplierPhone: e.target.value })} /></label><label>رقم فاتورة المورد<input required value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></label><label>تاريخ الاستلام<input required type="datetime-local" value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} /></label>
    </div><div className="supply-lines"><div className="sale-subheading"><strong>الأصناف المستلمة</strong><button type="button" className="row-action" onClick={() => setLines([...lines, { productId: "", quantity: "1", unitCost: "" }])}>＋ إضافة صنف</button></div>{lines.map((line, index) => <div className="supply-line" key={index}><label>نوع العدسة<select required value={line.productId} onChange={(e) => setLines(lines.map((row, i) => i === index ? { ...row, productId: e.target.value } : row))}><option value="">اختر الصنف</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` — ${p.brand}` : ""}</option>)}</select></label><label>الكمية<input required type="number" min="1" step="1" value={line.quantity} onChange={(e) => setLines(lines.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} /></label><label>تكلفة الوحدة<input required type="number" min="0" step="0.01" value={line.unitCost} onChange={(e) => setLines(lines.map((row, i) => i === index ? { ...row, unitCost: e.target.value } : row))} /></label>{lines.length > 1 && <button type="button" className="quiet" onClick={() => setLines(lines.filter((_, i) => i !== index))}>حذف</button>}</div>)}</div><button className="primary" disabled={busy || !branchId}>{busy ? "جارٍ التسجيل…" : "تأكيد الاستلام وتحديث المخزون"}</button><p className="footnote">التأكيد عملية نهائية وتزيد المخزون مرة واحدة، مع حفظ رقم الفاتورة والمورد والتكلفة.</p></form>}
    <div className="table-wrap"><table><thead><tr><th>فاتورة المورد</th><th>المورد</th><th>تاريخ الاستلام</th><th>الأصناف</th><th>الإجمالي</th></tr></thead><tbody>{supplies.map((s) => <tr key={s.id}><td>{s.invoice_number}</td><td>{s.supplier?.name ?? "—"}</td><td>{new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(s.received_at))}</td><td>{s.items.map((i) => `${i.product?.name ?? "صنف"} × ${i.quantity}`).join("، ")}</td><td>{money(Number(s.total_cost))}</td></tr>)}{supplies.length === 0 && <tr><td colSpan={5} className="table-empty">لا توجد توريدات مسجلة لهذا الفرع.</td></tr>}</tbody></table></div>
  </section>;
}
