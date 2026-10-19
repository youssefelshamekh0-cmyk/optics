"use client";

import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) { case "&": return "&amp;"; case "<": return "&lt;"; case ">": return "&gt;"; case '"': return "&quot;"; case "'": return "&#39;"; default: return ch; }
  });
}
function printSaleInvoice(sale: Sale, brandName: string) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed"; frame.style.width = "0"; frame.style.height = "0"; frame.style.border = "0"; frame.style.right = "0"; frame.style.bottom = "0";
  document.body.appendChild(frame);
  const documentRef = frame.contentDocument;
  if (!documentRef) { frame.remove(); throw new Error("تعذر فتح نافذة طباعة الفاتورة"); }
  const esc = escapeHtml;
  documentRef.open();
  documentRef.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${esc(sale.invoice_number)}</title><style>
  @page{size:A4;margin:12mm}body{font-family:Arial,Tahoma,sans-serif;color:#172d2a;font-size:12px;line-height:1.7;margin:0}h1{font-size:22px;margin:0 0 6px}h2{font-size:15px;margin:18px 0 7px}.brand{text-align:center;border-bottom:2px solid #27685f;padding:0 0 12px;margin-bottom:14px;font-size:18px;font-weight:bold}.meta{color:#657571;margin-bottom:16px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:15px}.summary div{border:1px solid #dbe4de;border-radius:7px;padding:10px}.summary b{display:block;font-size:15px;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #dbe4de;padding:8px;text-align:right}th{background:#f2f6f3}.sign{display:flex;justify-content:space-between;margin-top:48px}.sign span{border-top:1px solid #788783;width:35%;padding-top:6px;text-align:center}.notes{white-space:pre-wrap;margin-top:16px} </style></head><body>
  <div class="brand">${esc(brandName)}</div><h1>فاتورة بيع #${esc(sale.invoice_number)}</h1><div class="meta">${esc(sale.branch?.name)} — ${esc(new Date(sale.created_at).toLocaleString("ar-EG"))} — حالة التسليم: ${esc(statusLabels[sale.delivery_status])}</div>
  <h2>بيانات العميل</h2><table><tbody><tr><th>الاسم</th><td>${esc(sale.customer?.full_name)}</td><th>الهاتف</th><td>${esc(sale.customer?.phone || "—")}</td></tr></tbody></table>
  <h2>الأصناف</h2><table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر المرجعي</th><th>الإجمالي المرجعي</th></tr></thead><tbody>${sale.items.map((item) => `<tr><td>${esc(item.item_name)}</td><td>${esc(item.quantity)}</td><td>${esc(money(Number(item.unit_price)))}</td><td>${esc(money(Number(item.line_total)))}</td></tr>`).join("") || "<tr><td colspan='4'>لا توجد بنود</td></tr>"}</tbody></table>
  <div class="summary"><div>إجمالي البيع<b>${esc(money(Number(sale.grand_total)))}</b></div><div>المدفوع<b>${esc(money(Number(sale.paid_amount)))}</b></div><div>المتبقي<b>${esc(money(Number(sale.due_amount)))}</b></div></div>
  <h2>الدفعات</h2><table><thead><tr><th>التاريخ</th><th>الطريقة</th><th>المبلغ</th></tr></thead><tbody>${sale.payments.map((p) => `<tr><td>${esc(new Date(p.created_at).toLocaleString("ar-EG"))}</td><td>${esc(methodLabels[p.payment_method] ?? p.payment_method)}</td><td>${esc(money(Number(p.amount)))}</td></tr>`).join("") || "<tr><td colspan='3'>لا توجد دفعات</td></tr>"}</tbody></table>
  ${sale.prescription && Object.keys(sale.prescription).length ? `<h2>الوصفة الطبية</h2><p>العدسة: ${esc(sale.prescription.lensCompany ?? "")} — ${esc(sale.prescription.lensTypeName ?? "")}</p><p>اليمنى: ${esc(sale.prescription.rightSphere ?? "—")} / ${esc(sale.prescription.rightCylinder ?? "—")} / ${esc(sale.prescription.rightAxis ?? "—")}</p><p>اليسرى: ${esc(sale.prescription.leftSphere ?? "—")} / ${esc(sale.prescription.leftCylinder ?? "—")} / ${esc(sale.prescription.leftAxis ?? "—")}</p><p>ADD: ${esc(sale.prescription.add ?? "—")} · PD: ${esc(sale.prescription.pupilDistance ?? "—")}</p>` : ""}
  ${sale.notes ? `<div class="notes"><strong>ملاحظات: </strong>${esc(sale.notes)}</div>` : ""}<div class="sign"><span>توقيع المستلم</span><span>توقيع الموظف</span></div></body></html>`);
  documentRef.close();
  frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 60000); };
}


type Branch = { id: string; name: string; code: string; status: "ACTIVE" | "INACTIVE" };
type Customer = { id: string; full_name: string; phone: string | null; email: string | null };
type SaleItemDraft = { name: string; quantity: number; productId: string; itemKind: "product" | "service" };
type CatalogProduct = { id: string; name: string; category: string; sku: string | null; stock: { quantity: number; reference_price: number } };
type LensType = { id: string; name: string; category: string; company: string };
type LensSelection = { lensTypeId: string; options: string; rightSphere: string; rightCylinder: string; rightAxis: string; leftSphere: string; leftCylinder: string; leftAxis: string; add: string; pupilDistance: string };
type LensQuote = { lensTypeId: string; lensTypeName: string; company: string; right: { priceId: string; referencePrice: number }; left: { priceId: string; referencePrice: number }; pairReferencePrice: number };
type Sale = {
  id: string; invoice_number: number; customer_id: string; branch_id: string; sale_type: string; total_amount: number; discount_amount: number; grand_total: number; reference_total: number;
  paid_amount: number; due_amount: number; delivery_status: "pending" | "processing" | "ready" | "delivered" | "cancelled";
  prescription: Record<string, string | number> | null; notes: string | null; created_at: string;
  customer: { full_name: string; phone: string | null } | null; branch: { name: string; code: string } | null;
  items: { id: string; product_id: string | null; item_name: string; quantity: number; unit_price: number; line_total: number; item_kind: string; technical_details: Record<string, unknown> }[];
  payments: { id: string; amount: number; payment_method: string; created_at: string }[];
};
const emptyLensSelection: LensSelection = { lensTypeId: "", options: "", rightSphere: "", rightCylinder: "", rightAxis: "", leftSphere: "", leftCylinder: "", leftAxis: "", add: "", pupilDistance: "" };
const saleTypeLabels: Record<string, string> = { medical_glasses: "نظارة طبية كاملة", frame_only: "شنبر فقط", lenses_only: "عدسات طبية فقط", sunglasses: "نظارة شمسية", contact_lenses: "عدسات لاصقة", sports_glasses: "نظارة رياضية", mixed: "أكثر من نوع", other: "بيع آخر" };
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

export default function SalesSection({ branches, branchIds, isOwner, canCreate, canPay, canUpdateDelivery, canManageCustomers, canManageReturns = false, view = "sales" }: {
  branches: Branch[]; branchIds: string[]; isOwner: boolean; canCreate: boolean; canPay: boolean; canUpdateDelivery: boolean; canManageCustomers: boolean; canManageReturns?: boolean; view?: "sales" | "management";
}) {
  const availableBranches = useMemo(() => branches.filter((branch) => branch.status === "ACTIVE" && (isOwner || branchIds.includes(branch.id))), [branches, branchIds, isOwner]);
  const [branchId, setBranchId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [sales, setSales] = useState<Sale[]>([]);
  const [items, setItems] = useState<SaleItemDraft[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [lensTypes, setLensTypes] = useState<LensType[]>([]);
  const [optionsByType, setOptionsByType] = useState<Record<string, string[]>>({});
  const [lensSelection, setLensSelection] = useState<LensSelection>(emptyLensSelection);
  const [lensQuote, setLensQuote] = useState<LensQuote | null>(null);
  const [lensQuoteError, setLensQuoteError] = useState("");
  const [saleType, setSaleType] = useState("medical_glasses");
  const [customerId, setCustomerId] = useState("");
  const [finalTotal, setFinalTotal] = useState("");
  const [initialPayment, setInitialPayment] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, { amount: string; paymentMethod: string }>>({});
  const [busy, setBusy] = useState(false);
  const [loadingSales, setLoadingSales] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [brandName, setBrandName] = useState("نظرة");
  const [returnSaleId, setReturnSaleId] = useState<string | null>(null);
  const [returnAccounts, setReturnAccounts] = useState<{ id: string; name: string; payment_method: string }[]>([]);
  const [returnCashAccountId, setReturnCashAccountId] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [alreadyReturned, setAlreadyReturned] = useState<Record<string, number>>({});
  const [refundableBalance, setRefundableBalance] = useState(0);
  const [returnLoading, setReturnLoading] = useState(false);

  useEffect(() => { if (!branchId && availableBranches.length) setBranchId(availableBranches[0].id); }, [availableBranches, branchId]);
  useEffect(() => { let active = true; fetch("/api/brand-settings", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (active && j && !j.error) setBrandName(j.brandName ?? "نظرة"); }).catch(() => {}); return () => { active = false; }; }, []);

  useEffect(() => {
    if (!canCreate || !branchId) { setCatalogProducts([]); return; }
    void requestJson(`/api/sales/products?branchId=${encodeURIComponent(branchId)}`).then((result) => setCatalogProducts(result.products)).catch((cause) => setError(cause instanceof Error ? cause.message : "تعذر تحميل أصناف الفرع"));
  }, [branchId, canCreate]);

  useEffect(() => {
    if (!canCreate || !branchId) { setLensTypes([]); return; }
    void requestJson(`/api/sales/lens-pricing?branchId=${encodeURIComponent(branchId)}`).then((result) => {
      setLensTypes(result.lensTypes); setOptionsByType(result.optionsByType);
      setLensSelection((current) => result.lensTypes.some((type: LensType) => type.id === current.lensTypeId) ? current : { ...current, lensTypeId: result.lensTypes[0]?.id ?? "", options: "" });
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "تعذر تحميل أنواع العدسات"));
  }, [branchId, canCreate]);

  useEffect(() => {
    setLensQuote(null); setLensQuoteError("");
    if (!canCreate || !branchId || !lensSelection.lensTypeId || [lensSelection.rightSphere, lensSelection.rightCylinder, lensSelection.leftSphere, lensSelection.leftCylinder].some((value) => value === "")) return;
    const params = new URLSearchParams({ branchId, lensTypeId: lensSelection.lensTypeId, options: lensSelection.options,
      rightSphere: lensSelection.rightSphere, rightCylinder: lensSelection.rightCylinder,
      leftSphere: lensSelection.leftSphere, leftCylinder: lensSelection.leftCylinder });
    const timer = window.setTimeout(() => {
      void requestJson(`/api/sales/lens-pricing?${params}`).then((result) => { setLensQuote(result.quote); setLensQuoteError(""); })
        .catch((cause) => { setLensQuote(null); setLensQuoteError(cause instanceof Error ? cause.message : "تعذر حساب سعر العدسات"); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [canCreate, branchId, lensSelection]);

  const refresh = useCallback(async () => {
    if (!branchId) { setSales([]); return; }
    setLoadingSales(true); setError("");
    try { const result = await requestJson(`/api/sales?branchId=${encodeURIComponent(branchId)}`); setSales(result.sales); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل الفواتير"); }
    finally { setLoadingSales(false); }
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

  const filteredSales = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar-EG");
    if (!term) return sales;
    return sales.filter((sale) => [String(sale.invoice_number), sale.customer?.full_name ?? "", sale.customer?.phone ?? "", sale.branch?.name ?? ""].some((value) => value.toLocaleLowerCase("ar-EG").includes(term)));
  }, [sales, search]);

  const itemReferenceTotal = items.reduce((sum, item) => {
    if (item.itemKind === "service") return sum;
    const product = catalogProducts.find((row) => row.id === item.productId);
    return sum + (product ? Number(product.stock.reference_price) * item.quantity : 0);
  }, 0);
  const referenceTotal = itemReferenceTotal + (lensQuote?.pairReferencePrice ?? 0);

  function changeBranch(nextId: string) {
    setBranchId(nextId);
    setItems([]); setLensQuote(null); setLensSelection(emptyLensSelection);
  }

  async function createSale(event: FormEvent) {
    event.preventDefault();
    if (!branchId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const requiresMedicalLens = ["medical_glasses", "lenses_only"].includes(saleType);
      if ((requiresMedicalLens || lensSelection.lensTypeId && [lensSelection.rightSphere, lensSelection.rightCylinder, lensSelection.leftSphere, lensSelection.leftCylinder].some((value) => value !== "")) && !lensQuote) throw new Error(lensQuoteError || "أدخل مقاسات العينين وانتظر حساب سعر العدسات");
      const result = await requestJson("/api/sales", { method: "POST", body: JSON.stringify({
        branchId, customerId, saleType, items: items.map((item) => ({ name: item.name, quantity: Number(item.quantity), productId: item.productId || null, itemKind: item.itemKind })),
        lensSelection: lensQuote ? { lensTypeId: lensSelection.lensTypeId, options: lensSelection.options,
          rightSphere: Number(lensSelection.rightSphere), rightCylinder: Number(lensSelection.rightCylinder), rightAxis: lensSelection.rightAxis,
          leftSphere: Number(lensSelection.leftSphere), leftCylinder: Number(lensSelection.leftCylinder), leftAxis: lensSelection.leftAxis,
          add: lensSelection.add, pupilDistance: lensSelection.pupilDistance } : null,
        finalTotal: Number(finalTotal), initialPayment: Number(initialPayment), paymentMethod, notes,
      }) });
      setNotice(`تم إنشاء الفاتورة رقم ${result.invoiceNumber}`);
      setItems([]); setSaleType("medical_glasses"); setLensSelection(emptyLensSelection); setLensQuote(null); setFinalTotal(""); setInitialPayment("0"); setPaymentMethod("cash"); setNotes(""); setCustomerId(""); setCustomerSearch(""); setSelectedCustomerLabel("");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إنشاء الفاتورة"); }
    finally { setBusy(false); }
  }

  async function createCustomerInline() {
    setBusy(true); setError("");
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

  async function openReturnForm(sale: Sale) {
    if (returnSaleId === sale.id) { setReturnSaleId(null); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestJson(`/api/sales/${sale.id}/returns`);
      setReturnAccounts(result.accounts ?? []);
      setAlreadyReturned(result.returnedQuantities ?? {});
      setRefundableBalance(Number(result.refundableBalance ?? 0));
      setReturnCashAccountId(result.accounts?.[0]?.id ?? "");
      setReturnReason("");
      setReturnQuantities({});
      setReturnSaleId(sale.id);
      if (!result.accounts?.length) setError("لا توجد خزنة نشطة في فرع الفاتورة لرد المبلغ");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل خزن رد المبلغ");
    } finally { setBusy(false); }
  }

  async function submitReturn(event: FormEvent, sale: Sale) {
    event.preventDefault();
    const selectedItems = sale.items.filter((item) => Number(returnQuantities[item.id]) > 0)
      .map((item) => ({ saleItemId: item.id, quantity: Number(returnQuantities[item.id]) }));
    if (selectedItems.some((selected) => {
      const item = sale.items.find((row) => row.id === selected.saleItemId)!;
      return selected.quantity > item.quantity - (alreadyReturned[item.id] ?? 0);
    })) { setError("الكمية المختارة أكبر من الكمية المتبقية بعد المرتجعات السابقة"); return; }
    if (!selectedItems.length) { setError("اختر بندًا واحدًا على الأقل وحدد الكمية المرتجعة"); return; }
    if (!returnCashAccountId) { setError("اختر خزنة رد المبلغ"); return; }
    const referenceTotal = sale.items.reduce((sum, item) => sum + Number(item.line_total), 0);
    const estimatedRefund = selectedItems.reduce((sum, selected) => { const item = sale.items.find((row) => row.id === selected.saleItemId)!; const effectiveUnit = referenceTotal > 0 ? Number(item.unit_price) * Number(sale.grand_total) / referenceTotal : 0; return sum + Math.round(selected.quantity * effectiveUnit * 100) / 100; }, 0);
    if (estimatedRefund > refundableBalance + 0.009) { setError(`قيمة المرتجع التقديرية ${money(estimatedRefund)} أكبر من الرصيد القابل للرد ${money(refundableBalance)}. قلل الكمية أو سجل دفعة العميل أولًا.`); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestJson(`/api/sales/${sale.id}/returns`, { method: "POST", body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(), cashAccountId: returnCashAccountId, reason: returnReason, items: selectedItems,
      }) });
      setNotice(`تم تسجيل المرتجع بنجاح — مبلغ الرد ${money(Number(result.refundAmount))}`);
      setReturnSaleId(null); setReturnQuantities({}); setReturnReason("");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تسجيل المرتجع"); }
    finally { setBusy(false); }
  }

  const visibleProducts = catalogProducts.filter((product) => {
    const expected: Record<string, string> = { frame_only: "frame", sunglasses: "sunglasses", contact_lenses: "contact_lens", sports_glasses: "sports_glasses" };
    if (saleType in expected) return product.category === expected[saleType];
    if (saleType === "medical_glasses") return ["frame", "accessory", "other"].includes(product.category);
    if (saleType === "lenses_only") return false;
    return true;
  });

  return <section className="panel sales-panel">
    <div className="section-heading"><div><p className="eyebrow">المبيعات والتسليم</p><h2>الفواتير</h2></div><span className="count-badge">{sales.length}{sales.length === 100 ? "+" : ""} فاتورة</span></div>
    <div className="sales-toolbar"><label>فرع الفاتورة<select value={branchId} onChange={(event) => changeBranch(event.target.value)}>{availableBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label className="sales-search">بحث<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم الفاتورة أو العميل" /></label></div>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    {availableBranches.length === 0 ? <div className="empty"><strong>لا يوجد فرع نشط متاح</strong><p>اربط حسابك بفرع نشط من حساب المالك.</p></div> : <>
      {view === "sales" && canCreate && <form className="sale-form" onSubmit={createSale}>
        <div className="section-heading"><div><p className="eyebrow">فاتورة جديدة</p><h3>تسجيل بيع</h3></div></div>
        <div className="sale-fields"><label className="customer-picker">ابحث عن العميل بالاسم أو الموبايل<input required autoComplete="off" value={customerId ? selectedCustomerLabel : customerSearch} onChange={(event) => { setCustomerId(""); setSelectedCustomerLabel(""); setCustomerSearch(event.target.value); }} placeholder="اكتب اسم العميل أو رقم الموبايل" />{!customerId && customerSearch.trim().length >= 2 && <div className="customer-suggestions" role="listbox">{customers.map((customer) => <button type="button" role="option" key={customer.id} onClick={() => { setCustomerId(customer.id); setSelectedCustomerLabel(`${customer.full_name}${customer.phone ? ` — ${customer.phone}` : ""}`); setCustomerSearch(""); setCustomers([]); }}>{customer.full_name}<small>{customer.phone || "بدون رقم"}</small></button>)}{customers.length === 0 && <span>لا توجد نتائج مطابقة</span>}</div>}{canManageCustomers && <button type="button" className="text-button" onClick={() => setShowNewCustomer(!showNewCustomer)}>{showNewCustomer ? "إخفاء إضافة عميل" : "＋ إضافة عميل جديد"}</button>}</label><label>نوع البيع<select required value={saleType} onChange={(event) => { setSaleType(event.target.value); setItems([]); setLensQuote(null); setLensQuoteError(""); setLensSelection((current) => ({ ...emptyLensSelection, lensTypeId: current.lensTypeId })); }}>{Object.entries(saleTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>الفرع<select value={branchId} onChange={(event) => changeBranch(event.target.value)}>{availableBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label></div>
        {showNewCustomer && canManageCustomers && <div className="inline-customer-form"><label>اسم العميل<input required minLength={2} value={newCustomer.name} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} /></label><label>رقم الموبايل<input required type="tel" inputMode="tel" value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} /></label><button type="button" className="primary" disabled={busy} onClick={() => void createCustomerInline()}>حفظ واختيار العميل</button></div>}
        {(["medical_glasses", "lenses_only", "mixed"].includes(saleType)) && <section className="prescription-details"><div className="sale-subheading"><strong>العدسات الطبية وتسعير العينين</strong><span className="footnote">السعر المرجعي يُحسب من قائمة الفرع ولا يمكن إدخاله يدويًا</span></div>
          {lensTypes.length === 0 ? <p className="notice error">لا توجد أنواع عدسات لها أسعار مضافة في هذا الفرع.</p> : <><div className="sale-fields"><label>الشركة ونوع العدسة<select value={lensSelection.lensTypeId} onChange={(event) => setLensSelection({ ...lensSelection, lensTypeId: event.target.value, options: "" })}>{lensTypes.map((type) => <option key={type.id} value={type.id}>{type.company} — {type.name}</option>)}</select></label><label>الإضافات / الخيارات<select value={lensSelection.options} onChange={(event) => setLensSelection({ ...lensSelection, options: event.target.value })}><option value="">بدون إضافة</option>{(optionsByType[lensSelection.lensTypeId] ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select></label></div>
            <div className="prescription-grid"><span></span><strong>كروي SPH</strong><strong>أسطواني CYL</strong><strong>المحور AXIS</strong><strong>اليمنى OD</strong><input required type="number" step="0.25" min="-30" max="30" value={lensSelection.rightSphere} onChange={(event) => setLensSelection({ ...lensSelection, rightSphere: event.target.value })} /><input required type="number" step="0.25" min="-20" max="20" value={lensSelection.rightCylinder} onChange={(event) => setLensSelection({ ...lensSelection, rightCylinder: event.target.value })} /><input type="number" min="0" max="180" value={lensSelection.rightAxis} onChange={(event) => setLensSelection({ ...lensSelection, rightAxis: event.target.value })} /><strong>اليسرى OS</strong><input required type="number" step="0.25" min="-30" max="30" value={lensSelection.leftSphere} onChange={(event) => setLensSelection({ ...lensSelection, leftSphere: event.target.value })} /><input required type="number" step="0.25" min="-20" max="20" value={lensSelection.leftCylinder} onChange={(event) => setLensSelection({ ...lensSelection, leftCylinder: event.target.value })} /><input type="number" min="0" max="180" value={lensSelection.leftAxis} onChange={(event) => setLensSelection({ ...lensSelection, leftAxis: event.target.value })} /><label>إضافة ADD<input value={lensSelection.add} onChange={(event) => setLensSelection({ ...lensSelection, add: event.target.value })} /></label><label>المسافة بين الحدقتين PD<input value={lensSelection.pupilDistance} onChange={(event) => setLensSelection({ ...lensSelection, pupilDistance: event.target.value })} /></label></div>
            {lensQuote && <p className="notice success">سعر مرجعي لليمين {money(lensQuote.right.referencePrice)} + اليسار {money(lensQuote.left.referencePrice)} = {money(lensQuote.pairReferencePrice)}</p>}{lensQuoteError && <p className="notice error" role="alert">{lensQuoteError}</p>}</>}</section>}
        <div className="sale-items"><div className="sale-subheading"><strong>المنتجات والإكسسوارات</strong><button type="button" className="row-action" disabled={busy || items.length >= 19} onClick={() => setItems([...items, { name: "", quantity: 1, productId: "", itemKind: "product" }])}>＋ إضافة صنف</button></div>
          {items.map((item, index) => { const selectedProduct = catalogProducts.find((product) => product.id === item.productId); return <div className="sale-item-row" key={index}><label>الصنف<select value={item.itemKind === "product" ? item.productId : "service"} onChange={(event) => { if (event.target.value === "service") setItems(items.map((row, i) => i === index ? { ...row, itemKind: "service", productId: "", name: "" } : row)); else { const product = visibleProducts.find((row) => row.id === event.target.value); setItems(items.map((row, i) => i === index ? { ...row, itemKind: "product", productId: product?.id ?? "", name: product?.name ?? "" } : row)); } }}><option value="">اختر من مخزون الفرع</option>{visibleProducts.map((product) => <option key={product.id} value={product.id} disabled={product.stock.quantity < 1}>{product.name} · مرجعي {money(Number(product.stock.reference_price))} · متاح {product.stock.quantity}</option>)}<option value="service">خدمة أو بند بدون مخزون</option></select>{item.itemKind === "service" && <input required minLength={2} maxLength={160} value={item.name} onChange={(event) => setItems(items.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} placeholder="اسم الخدمة أو البند" />}</label><label>الكمية<input required type="number" min={1} max={selectedProduct ? Math.min(100, selectedProduct.stock.quantity) : 100} step={1} value={item.quantity} onChange={(event) => setItems(items.map((row, i) => i === index ? { ...row, quantity: Number(event.target.value) } : row))} /></label>{selectedProduct && <div className="sale-total-preview"><small>السعر المرجعي</small><strong>{money(Number(selectedProduct.stock.reference_price) * item.quantity)}</strong></div>}{items.length > 0 && <button type="button" className="quiet remove-sale-item" onClick={() => setItems(items.filter((_, i) => i !== index))} aria-label="حذف البند">حذف</button>}</div>; })}
        </div>
        <div className="sale-fields sale-totals"><div className="sale-total-preview"><small>إجمالي الأسعار المرجعية</small><strong>{money(referenceTotal)}</strong></div><label>سعر البيع النهائي للفاتورة<input required type="number" min="0.01" max="1000000" step="0.01" value={finalTotal} onChange={(event) => setFinalTotal(event.target.value)} /></label><label>المدفوع الآن<input type="number" min="0" max={Number(finalTotal || 0)} step="0.01" value={initialPayment} onChange={(event) => setInitialPayment(event.target.value)} /></label><label>طريقة الدفع<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="instapay">إنستاباي</option><option value="other">أخرى</option></select></label></div>
        <label className="sale-notes-label">ملاحظات الفاتورة<textarea rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button className="primary" disabled={busy || !customerId || !finalTotal || (["medical_glasses", "lenses_only"].includes(saleType) && !lensQuote) || (items.length === 0 && !lensQuote)}>{busy ? "جارٍ حفظ الفاتورة…" : "حفظ الفاتورة"}</button>
      </form>}
      {view === "management" && <><div className="sales-list-heading"><h3>سجل الفواتير</h3><span className="footnote">ابحث عن الفاتورة لإدارة التفاصيل والمدفوعات والتسليمات والمرتجعات</span></div>
      <div className="table-wrap"><table className="sales-table"><thead><tr><th>الفاتورة</th><th>العميل</th><th>نوع البيع</th><th>المرجعي / النهائي</th><th>المدفوع</th><th>المتبقي</th><th>حالة التسليم</th><th>إجراءات</th></tr></thead><tbody>
        {!loadingSales && filteredSales.map((sale) => <Fragment key={sale.id}><tr><td><strong>#{sale.invoice_number}</strong><small>{date(sale.created_at)}</small></td><td><strong>{sale.customer?.full_name ?? "عميل غير متاح"}</strong><small>{sale.branch?.name ?? ""}</small></td><td>{saleTypeLabels[sale.sale_type] ?? sale.sale_type}</td><td><small>مرجعي {money(Number(sale.reference_total ?? sale.total_amount))}</small><strong>{money(Number(sale.grand_total))}</strong></td><td>{money(sale.paid_amount)}</td><td className={sale.due_amount > 0 ? "balance-due" : "balance-paid"}>{money(sale.due_amount)}</td><td><span className={`status-pill s-${sale.delivery_status}`}>{statusLabels[sale.delivery_status]}</span>{canUpdateDelivery && <select aria-label={`حالة تسليم الفاتورة ${sale.invoice_number}`} className="status-select" value={sale.delivery_status} disabled={busy || sale.delivery_status === "cancelled" || sale.delivery_status === "delivered"} onChange={(event) => void updateStatus(sale.id, event.target.value as Sale["delivery_status"])}>{(["pending", "processing", "ready", "delivered"] as const).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>}</td><td><div className="invoice-row-actions"><button type="button" className="row-action" onClick={() => printSaleInvoice(sale, brandName)}>طباعة</button>{canUpdateDelivery && sale.delivery_status !== "delivered" && sale.delivery_status !== "cancelled" && <button type="button" className="row-action" disabled={busy} onClick={() => void updateStatus(sale.id, "delivered")}>تسليم</button>}<button type="button" className="row-action" onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}>{expandedId === sale.id ? "إخفاء" : "التفاصيل"}</button></div></td></tr>
          {expandedId === sale.id && <tr key={`${sale.id}-details`}><td colSpan={8}><div className="sale-detail"><div><strong>الأسعار المرجعية للبنود</strong>{sale.items.map((item) => <p key={item.id}>{item.item_name} × {item.quantity} <span>{money(Number(item.line_total))}</span></p>)}<p><strong>إجمالي البيع النهائي</strong><span>{money(Number(sale.grand_total))}</span></p></div>{sale.prescription && Object.keys(sale.prescription).length > 0 && <div><strong>العدسات والوصفة</strong><p>{String(sale.prescription.lensCompany ?? "")} — {String(sale.prescription.lensTypeName ?? "")}</p><p>اليمنى: {String(sale.prescription.rightSphere ?? "—")} / {String(sale.prescription.rightCylinder ?? "—")} / {String(sale.prescription.rightAxis ?? "—")}</p><p>اليسرى: {String(sale.prescription.leftSphere ?? "—")} / {String(sale.prescription.leftCylinder ?? "—")} / {String(sale.prescription.leftAxis ?? "—")}</p><p>ADD: {String(sale.prescription.add ?? "—")} · PD: {String(sale.prescription.pupilDistance ?? "—")}</p></div>}{sale.notes && <div><strong>ملاحظات</strong><p>{sale.notes}</p></div>}<div><strong>الدفعات</strong>{sale.payments.map((payment) => <p key={payment.id}>{money(Number(payment.amount))} · {methodLabels[payment.payment_method] ?? payment.payment_method} <small>{date(payment.created_at)}</small></p>)}{sale.payments.length === 0 && <p>لم تسجل دفعات بعد.</p>}</div>
            {canPay && sale.due_amount > 0 && <form className="payment-form" onSubmit={(event) => void recordPayment(event, sale.id)}><label>دفعة جديدة<input type="number" min="0.01" max={sale.due_amount} step="0.01" required value={(paymentDrafts[sale.id] ?? { amount: "", paymentMethod: "cash" }).amount} onChange={(event) => setPaymentDrafts({ ...paymentDrafts, [sale.id]: { ...(paymentDrafts[sale.id] ?? { paymentMethod: "cash" }), amount: event.target.value } })} /></label><label>طريقة الدفع<select value={(paymentDrafts[sale.id] ?? { amount: "", paymentMethod: "cash" }).paymentMethod} onChange={(event) => setPaymentDrafts({ ...paymentDrafts, [sale.id]: { ...(paymentDrafts[sale.id] ?? { amount: "" }), paymentMethod: event.target.value } })}><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="instapay">إنستاباي</option><option value="other">أخرى</option></select></label><button className="primary" disabled={busy}>تسجيل الدفعة</button></form>}
            {canManageReturns && sale.delivery_status !== "cancelled" && <div className="sale-return-area">
              <button type="button" className="row-action" disabled={busy} onClick={() => void openReturnForm(sale)}>
                {returnSaleId === sale.id ? "إلغاء المرتجع" : "إنشاء مرتجع"}
              </button>
              {returnSaleId === sale.id && <form className="payment-form sale-return-form" onSubmit={(event) => void submitReturn(event, sale)}>
                <div><strong>مرتجع الفاتورة #{sale.invoice_number}</strong><p className="footnote">حدد الكميات المراد إرجاعها. لا يمكن رد أكثر من صافي ما دفعه العميل.</p><div className="return-balance"><span>المدفوع: <strong>{money(sale.paid_amount)}</strong></span><span>القابل للرد الآن: <strong>{money(refundableBalance)}</strong></span></div></div>
                {sale.items.map((item) => <label key={item.id} className="return-item-row">
                  <span>{item.item_name} · المباع {item.quantity}</span>
                  <input aria-label={`كمية مرتجعة من ${item.item_name}`} type="number" min="0" max={item.quantity} step="1"
                    value={returnQuantities[item.id] ?? 0}
                    onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: Math.max(0, Math.min(Math.max(0, item.quantity - (alreadyReturned[item.id] ?? 0)), Number(event.target.value) || 0)) }))} />
                </label>)}
                <label>خزنة رد المبلغ<select required value={returnCashAccountId} onChange={(event) => setReturnCashAccountId(event.target.value)}>
                  <option value="">اختر الخزنة</option>{returnAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {methodLabels[account.payment_method] ?? account.payment_method}</option>)}
                </select></label>
                <label>سبب المرتجع<textarea required minLength={3} maxLength={500} rows={2} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="اكتب سبب إرجاع الصنف" /></label>
                <button className="primary" disabled={busy || !returnCashAccountId || !returnReason.trim() || !sale.items.some((item) => Number(returnQuantities[item.id]) > 0)}>{busy ? "جارٍ تسجيل المرتجع…" : "تأكيد المرتجع ورد المبلغ"}</button>
              </form>}
            </div>}
          </div></td></tr>}</Fragment>)}
        {loadingSales ? <tr><td colSpan={8} className="table-empty" role="status" aria-live="polite"><span className="inline-spinner" aria-hidden="true"/> جارٍ تحميل الفواتير…</td></tr> : filteredSales.length === 0 && <tr><td colSpan={8} className="table-empty">{search ? "لا توجد نتائج مطابقة. جرّب تغيير كلمات البحث." : "لا توجد فواتير في هذا الفرع بعد."}</td></tr>}
      </tbody></table></div></>}
    <p className="footnote">السعر النهائي يُدخل مرة واحدة للفاتورة. أسعار البنود والعدسات مرجعية ومحفوظة كنسخة تاريخية، ومخزون المنتجات يُخصم عند اعتماد البيع.</p>
    </>}
  </section>;
}
