"use client";

import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Branch = { id: string; name: string; code: string; status: "ACTIVE" | "INACTIVE" };
type Customer = { id: string; full_name: string; phone: string | null; email: string | null };
type SaleItemDraft = { name: string; quantity: number; unitPrice: string };
type Prescription = { rightSphere: string; rightCylinder: string; rightAxis: string; leftSphere: string; leftCylinder: string; leftAxis: string; add: string; pupilDistance: string };
type Sale = {
  id: string; invoice_number: number; customer_id: string; branch_id: string; total_amount: number; discount_amount: number; grand_total: number;
  paid_amount: number; due_amount: number; delivery_status: "pending" | "processing" | "ready" | "delivered" | "cancelled";
  prescription: Prescription | null; notes: string | null; created_at: string;
  customer: { full_name: string; phone: string | null } | null; branch: { name: string; code: string } | null;
  items: { id: string; item_name: string; quantity: number; unit_price: number; line_total: number }[];
  payments: { id: string; amount: number; payment_method: string; created_at: string }[];
};
const emptyPrescription: Prescription = { rightSphere: "", rightCylinder: "", rightAxis: "", leftSphere: "", leftCylinder: "", leftAxis: "", add: "", pupilDistance: "" };
const statusLabels: Record<Sale["delivery_status"], string> = { pending: "جديد", processing: "قيد التجهيز", ready: "جاهز", delivered: "تم التسليم", cancelled: "ملغي" };
const methodLabels: Record<string, string> = { cash: "نقدي", card: "بطاقة", instapay: "إنستاباي", other: "أخرى" };

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "تعذر إتمام الطلب");
  return data;
}

const money = (value: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function SalesSection({ branches, branchIds, isOwner, canCreate, canPay, canUpdateDelivery }: {
  branches: Branch[]; branchIds: string[]; isOwner: boolean; canCreate: boolean; canPay: boolean; canUpdateDelivery: boolean; canManageCustomers: boolean;
}) {
  const availableBranches = useMemo(() => branches.filter((branch) => branch.status === "ACTIVE" && (isOwner || branchIds.includes(branch.id))), [branches, branchIds, isOwner]);
  const [branchId, setBranchId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<SaleItemDraft[]>([{ name: "", quantity: 1, unitPrice: "" }]);
  const [customerId, setCustomerId] = useState("");
  const [discount, setDiscount] = useState("0");
  const [initialPayment, setInitialPayment] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [prescription, setPrescription] = useState<Prescription>(emptyPrescription);
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [printSale, setPrintSale] = useState<Sale | null>(null);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, { amount: string; paymentMethod: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { if (!branchId && availableBranches.length) setBranchId(availableBranches[0].id); }, [availableBranches, branchId]);

  const refresh = useCallback(async () => {
    if (!branchId) { setSales([]); return; }
    setError("");
    try { const result = await requestJson(`/api/sales?branchId=${encodeURIComponent(branchId)}`); setSales(result.sales); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل الفواتير"); }
  }, [branchId]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const query = customerSearch.trim();
    if (!canCreate || query.length < 2 || customerId) { setCustomers([]); return; }
    const timer = window.setTimeout(() => {
      void requestJson(`/api/sales/customers?q=${encodeURIComponent(query)}`)
        .then((result) => setCustomers(result.customers))
        .catch((cause) => setError(cause instanceof Error ? cause.message : "تعذر البحث عن العميل"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [canCreate, customerSearch, customerId]);

  useEffect(() => {
    const clearPrintSale = () => setPrintSale(null);
    window.addEventListener("afterprint", clearPrintSale);
    return () => window.removeEventListener("afterprint", clearPrintSale);
  }, []);

  const filteredSales = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar-EG");
    if (!term) return sales;
    return sales.filter((sale) => [String(sale.invoice_number), sale.customer?.full_name ?? "", sale.customer?.phone ?? "", sale.branch?.name ?? ""].some((value) => value.toLocaleLowerCase("ar-EG").includes(term)));
  }, [sales, search]);

  const expectedTotal = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);

  async function createSale(event: FormEvent) {
    event.preventDefault();
    if (!branchId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestJson("/api/sales", { method: "POST", body: JSON.stringify({
        branchId, customerId, items: items.map((item) => ({ name: item.name, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) })),
        discount: Number(discount), initialPayment: Number(initialPayment), paymentMethod, prescription, notes,
      }) });
      setNotice(`تم إنشاء الفاتورة رقم ${result.invoiceNumber}`);
      setItems([{ name: "", quantity: 1, unitPrice: "" }]); setDiscount("0"); setInitialPayment("0"); setPaymentMethod("cash"); setPrescription(emptyPrescription); setNotes(""); setCustomerId(""); setCustomerSearch(""); setSelectedCustomerLabel("");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إنشاء الفاتورة"); }
    finally { setBusy(false); }
  }

  async function createCustomerInline(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await requestJson("/api/customers", { method: "POST", body: JSON.stringify(newCustomer) });
      setCustomerId(result.customer.id); setSelectedCustomerLabel(`${result.customer.full_name} — ${result.customer.phone ?? ""}`);
      setCustomerSearch(""); setCustomers([]); setShowNewCustomer(false); setNewCustomer({ name: "", phone: "" });
      window.dispatchEvent(new Event("customers:changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذرت إضافة العميل"); }
    finally { setBusy(false); }
  }

  async function updateStatus(saleId: string, deliveryStatus: Sale["delivery_status"]) {
    setBusy(true); setError(""); setNotice("");
    try { await requestJson(`/api/sales/${saleId}`, { method: "PATCH", body: JSON.stringify({ deliveryStatus }) }); setNotice("تم تحديث حالة التسليم"); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحديث الحالة"); }
    finally { setBusy(false); }
  }

  async function recordPayment(event: FormEvent, saleId: string) {
    event.preventDefault();
    const payment = paymentDrafts[saleId] ?? { amount: "", paymentMethod: "cash" };
    setBusy(true); setError(""); setNotice("");
    try {
      await requestJson(`/api/sales/${saleId}/payments`, { method: "POST", body: JSON.stringify({ amount: Number(payment.amount), paymentMethod: payment.paymentMethod }) });
      setPaymentDrafts((current) => ({ ...current, [saleId]: { ...payment, amount: "" } })); setNotice("تم تسجيل الدفعة"); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تسجيل الدفعة"); }
    finally { setBusy(false); }
  }

  function printInvoice(sale: Sale) {
    setPrintSale(sale);
    window.setTimeout(() => window.print(), 100);
  }

  return <section className="panel sales-panel">
    <div className="section-heading"><div><p className="eyebrow">المبيعات والتسليم</p><h2>الفواتير</h2></div><span className="count-badge">{sales.length}{sales.length === 100 ? "+" : ""} فاتورة</span></div>
    <div className="sales-toolbar"><label>فرع الفاتورة<select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{availableBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label className="sales-search">بحث<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم الفاتورة أو العميل" /></label></div>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    {availableBranches.length === 0 ? <div className="empty"><strong>لا يوجد فرع نشط متاح</strong><p>اربط حسابك بفرع نشط من حساب المالك.</p></div> : <>
      {canCreate && <form className="sale-form" onSubmit={createSale}>
        <div className="section-heading"><div><p className="eyebrow">فاتورة جديدة</p><h3>تسجيل بيع</h3></div></div>
        <>
          <div className="sale-fields"><label className="customer-picker">ابحث عن العميل بالاسم أو الموبايل<input required autoComplete="off" value={customerId ? selectedCustomerLabel : customerSearch} onChange={(event) => { setCustomerId(""); setSelectedCustomerLabel(""); setCustomerSearch(event.target.value); }} placeholder="اكتب اسم العميل أو رقم الموبايل" />{!customerId && customerSearch.trim().length >= 2 && <div className="customer-suggestions" role="listbox">{customers.map((customer) => <button type="button" role="option" key={customer.id} onClick={() => { setCustomerId(customer.id); setSelectedCustomerLabel(`${customer.full_name}${customer.phone ? ` — ${customer.phone}` : ""}`); setCustomerSearch(""); setCustomers([]); }}>{customer.full_name}<small>{customer.phone || "بدون رقم"}</small></button>)}{customers.length === 0 && <span>لا توجد نتائج مطابقة</span>}</div>}{canManageCustomers && <button type="button" className="text-button" onClick={() => setShowNewCustomer(!showNewCustomer)}>{showNewCustomer ? "إخفاء إضافة عميل" : "＋ إضافة عميل جديد"}</button>}</label><label>الفرع<select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{availableBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label></div>
          {showNewCustomer && canManageCustomers && <form className="inline-customer-form" onSubmit={createCustomerInline}><label>اسم العميل<input required minLength={2} value={newCustomer.name} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} /></label><label>رقم الموبايل<input required type="tel" inputMode="tel" value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} /></label><button className="primary" disabled={busy}>حفظ واختيار العميل</button></form>}
          <div className="sale-items"><div className="sale-subheading"><strong>بنود الفاتورة</strong><button type="button" className="row-action" disabled={busy || items.length >= 20} onClick={() => setItems([...items, { name: "", quantity: 1, unitPrice: "" }])}>＋ إضافة بند</button></div>
            {items.map((item, index) => <div className="sale-item-row" key={index}><label>الصنف أو الخدمة<input required minLength={2} maxLength={160} value={item.name} onChange={(event) => setItems(items.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} placeholder="إطار، عدسة، كشف…" /></label><label>الكمية<input required type="number" min={1} max={100} step={1} value={item.quantity} onChange={(event) => setItems(items.map((row, i) => i === index ? { ...row, quantity: Number(event.target.value) } : row))} /></label><label>سعر الوحدة<input required type="number" min="0.01" max="1000000" step="0.01" value={item.unitPrice} onChange={(event) => setItems(items.map((row, i) => i === index ? { ...row, unitPrice: event.target.value } : row))} /></label>{items.length > 1 && <button type="button" className="quiet remove-sale-item" onClick={() => setItems(items.filter((_, i) => i !== index))} aria-label="حذف البند">حذف</button>}</div>)}
          </div>
          <details className="prescription-details"><summary>بيانات الوصفة الطبية (اختياري)</summary><div className="prescription-grid"><span></span><strong>كروي SPH</strong><strong>أسطواني CYL</strong><strong>المحور AXIS</strong><strong>اليمنى OD</strong><input aria-label="كروي العين اليمنى" value={prescription.rightSphere} onChange={(event) => setPrescription({ ...prescription, rightSphere: event.target.value })} /><input aria-label="أسطواني العين اليمنى" value={prescription.rightCylinder} onChange={(event) => setPrescription({ ...prescription, rightCylinder: event.target.value })} /><input aria-label="محور العين اليمنى" value={prescription.rightAxis} onChange={(event) => setPrescription({ ...prescription, rightAxis: event.target.value })} /><strong>اليسرى OS</strong><input aria-label="كروي العين اليسرى" value={prescription.leftSphere} onChange={(event) => setPrescription({ ...prescription, leftSphere: event.target.value })} /><input aria-label="أسطواني العين اليسرى" value={prescription.leftCylinder} onChange={(event) => setPrescription({ ...prescription, leftCylinder: event.target.value })} /><input aria-label="محور العين اليسرى" value={prescription.leftAxis} onChange={(event) => setPrescription({ ...prescription, leftAxis: event.target.value })} /><label>إضافة ADD<input value={prescription.add} onChange={(event) => setPrescription({ ...prescription, add: event.target.value })} /></label><label>المسافة بين الحدقتين PD<input value={prescription.pupilDistance} onChange={(event) => setPrescription({ ...prescription, pupilDistance: event.target.value })} /></label></div></details>
          <div className="sale-fields sale-totals"><label>الخصم بالجنيه<input type="number" min="0" max={expectedTotal} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} /></label><label>المدفوع الآن<input type="number" min="0" max={Math.max(0, expectedTotal - Number(discount || 0))} step="0.01" value={initialPayment} onChange={(event) => setInitialPayment(event.target.value)} /></label><label>طريقة الدفع<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="instapay">إنستاباي</option><option value="other">أخرى</option></select></label><div className="sale-total-preview"><small>الإجمالي بعد الخصم</small><strong>{money(Math.max(0, expectedTotal - Number(discount || 0)))}</strong></div></div>
          <label className="sale-notes-label">ملاحظات الفاتورة<textarea rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button className="primary" disabled={busy || !customerId || !items.some((item) => item.name.trim() && Number(item.unitPrice) > 0)}>حفظ الفاتورة</button>
        </>
      </form>}
      <div className="sales-list-heading"><h3>سجل الفواتير</h3><span className="footnote">آخر 100 فاتورة للفرع المحدد</span></div>
      <div className="table-wrap"><table className="sales-table"><thead><tr><th>الفاتورة</th><th>العميل</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>التسليم</th><th>التفاصيل</th></tr></thead><tbody>
        {filteredSales.map((sale) => <Fragment key={sale.id}><tr><td><strong>#{sale.invoice_number}</strong><small>{date(sale.created_at)}</small></td><td><strong>{sale.customer?.full_name ?? "عميل غير متاح"}</strong><small>{sale.branch?.name ?? ""}</small></td><td>{money(Number(sale.grand_total))}</td><td>{money(sale.paid_amount)}</td><td className={sale.due_amount > 0 ? "balance-due" : "balance-paid"}>{money(sale.due_amount)}</td><td>{canUpdateDelivery ? <select aria-label={`حالة تسليم الفاتورة ${sale.invoice_number}`} className="status-select" value={sale.delivery_status} disabled={busy || sale.delivery_status === "cancelled"} onChange={(event) => void updateStatus(sale.id, event.target.value as Sale["delivery_status"])}>{(["pending", "processing", "ready", "delivered"] as const).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select> : <span className="status active">{statusLabels[sale.delivery_status]}</span>}</td><td><button className="row-action" onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}>{expandedId === sale.id ? "إخفاء" : "عرض"}</button></td></tr>
          {expandedId === sale.id && <tr key={`${sale.id}-details`}><td colSpan={7}><div className="sale-detail"><div><strong>الأصناف</strong>{sale.items.map((item) => <p key={item.id}>{item.item_name} × {item.quantity} <span>{money(Number(item.line_total))}</span></p>)}{sale.discount_amount > 0 && <p>الخصم <span>− {money(Number(sale.discount_amount))}</span></p>}</div><div><strong>الوصفة</strong><p>اليمنى: {sale.prescription?.rightSphere || "—"} / {sale.prescription?.rightCylinder || "—"} / {sale.prescription?.rightAxis || "—"}</p><p>اليسرى: {sale.prescription?.leftSphere || "—"} / {sale.prescription?.leftCylinder || "—"} / {sale.prescription?.leftAxis || "—"}</p><p>ADD: {sale.prescription?.add || "—"} · PD: {sale.prescription?.pupilDistance || "—"}</p>{sale.notes && <p>{sale.notes}</p>}</div><div><strong>الدفعات</strong>{sale.payments.map((payment) => <p key={payment.id}>{money(Number(payment.amount))} · {methodLabels[payment.payment_method] ?? payment.payment_method} <small>{date(payment.created_at)}</small></p>)}{sale.payments.length === 0 && <p>لم تسجل دفعات بعد.</p>}</div>
            <div className="sale-print-action"><button className="row-action" onClick={() => printInvoice(sale)}>طباعة الفاتورة</button></div>
            {canPay && sale.due_amount > 0 && <form className="payment-form" onSubmit={(event) => void recordPayment(event, sale.id)}><label>دفعة جديدة<input type="number" min="0.01" max={sale.due_amount} step="0.01" required value={(paymentDrafts[sale.id] ?? { amount: "", paymentMethod: "cash" }).amount} onChange={(event) => setPaymentDrafts({ ...paymentDrafts, [sale.id]: { ...(paymentDrafts[sale.id] ?? { paymentMethod: "cash" }), amount: event.target.value } })} /></label><label>طريقة الدفع<select value={(paymentDrafts[sale.id] ?? { amount: "", paymentMethod: "cash" }).paymentMethod} onChange={(event) => setPaymentDrafts({ ...paymentDrafts, [sale.id]: { ...(paymentDrafts[sale.id] ?? { amount: "" }), paymentMethod: event.target.value } })}><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="instapay">إنستاباي</option><option value="other">أخرى</option></select></label><button className="primary" disabled={busy}>تسجيل الدفعة</button></form>}
          </div>{printSale?.id === sale.id && <article className="invoice-print" dir="rtl"><header><strong>نظرة</strong><span>فاتورة بيع</span></header><div className="invoice-print-meta"><p>رقم الفاتورة: <strong>#{sale.invoice_number}</strong></p><p>التاريخ: {date(sale.created_at)}</p><p>الفرع: {sale.branch?.name ?? "—"}</p><p>العميل: {sale.customer?.full_name ?? "—"}</p><p>الموبايل: {sale.customer?.phone ?? "—"}</p></div><table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>{sale.items.map((item) => <tr key={item.id}><td>{item.item_name}</td><td>{item.quantity}</td><td>{money(Number(item.unit_price))}</td><td>{money(Number(item.line_total))}</td></tr>)}</tbody></table><div className="invoice-print-totals"><p>الإجمالي: {money(Number(sale.total_amount))}</p><p>الخصم: {money(Number(sale.discount_amount))}</p><p><strong>الصافي: {money(Number(sale.grand_total))}</strong></p><p>المدفوع: {money(sale.paid_amount)}</p><p>المتبقي: {money(sale.due_amount)}</p></div><section className="invoice-print-prescription"><strong>الوصفة الطبية</strong><p>اليمنى OD: {sale.prescription?.rightSphere || "—"} / {sale.prescription?.rightCylinder || "—"} / {sale.prescription?.rightAxis || "—"}</p><p>اليسرى OS: {sale.prescription?.leftSphere || "—"} / {sale.prescription?.leftCylinder || "—"} / {sale.prescription?.leftAxis || "—"}</p><p>ADD: {sale.prescription?.add || "—"} · PD: {sale.prescription?.pupilDistance || "—"}</p></section><footer>شكرًا لزيارتكم</footer></article>}</td></tr>}</Fragment>)}
        {filteredSales.length === 0 && <tr><td colSpan={7} className="table-empty">{search ? "لا توجد نتائج مطابقة." : "لا توجد فواتير في هذا الفرع بعد."}</td></tr>}
      </tbody></table></div>
    </>}
    <p className="footnote">أسماء الأصناف وأسعارها تُسجل يدويًا حاليًا؛ ربطها بالمخزون يأتي في المرحلة التالية.</p>
  </section>;
}
