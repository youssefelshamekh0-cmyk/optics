"use client";

import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { cachedRequestJson } from "@/lib/offline-sync";

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

import { cachedRequestJson } from "@/lib/offline-sync";

async function requestJson(url: string, init?: RequestInit) {
  return cachedRequestJson<any>(url, init);
}

const money = (value: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function SalesSection({ branches, branchIds, isOwner, canCreate, canPay, canUpdateDelivery, canManageCustomers }: {
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
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, { amount: string; paymentMethod: string; operationId: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [returnSaleId, setReturnSaleId] = useState<string | null>(null);
  const [returnAccounts, setReturnAccounts] = useState<{ id: string; name: string; payment_method: string }[]>([]);
  const [returnCashAccountId, setReturnCashAccountId] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnOperationId, setReturnOperationId] = useState("");
  const [returnLoading, setReturnLoading] = useState(false);

  useEffect(() => { if (!branchId && availableBranches.length) setBranchId(availableBranches[0].id); }, [availableBranches, branchId]);

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
      setNotice(result.queued ? "تم حفظ الفاتورة على هذا الجهاز، وهي معلّقة لحين عودة الإنترنت والتحقق من المخزون. لا تعتبر فاتورة معتمدة بعد." : `تم إنشاء الفاتورة رقم ${result.invoiceNumber}`);
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
    const payment = paymentDrafts[saleId] ?? { amount: "", paymentMethod: "cash", operationId: crypto.randomUUID() };
    setPaymentDrafts((current) => ({ ...current, [saleId]: payment }));
    setBusy(true); setError(""); setNotice("");
    try {
      await requestJson(`/api/sales/${saleId}/payments`, { method: "POST", body: JSON.stringify({ amount: Number(payment.amount), paymentMethod: payment.paymentMethod, operationId: payment.operationId }) });
      setPaymentDrafts((current) => ({ ...current, [saleId]: { ...payment, amount: "", operationId: crypto.randomUUID() } })); setNotice("تم تسجيل الدفعة"); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تسجيل الدفعة"); }
    finally { setBusy(false); }
  }

  async function openReturnForm(sale: Sale) {
    if (returnSaleId === sale.id) { setReturnSaleId(null); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestJson(`/api/sales/${sale.id}/returns`);
      setReturnAccounts(result.accounts ?? []);
      setReturnCashAccountId(result.accounts?.[0]?.id ?? "");
      setReturnReason("");
      setReturnQuantities({});
      setReturnOperationId(crypto.randomUUID());
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
    if (!selectedItems.length) { setError("اختر بندًا واحدًا على الأقل وحدد الكمية المرتجعة"); return; }
    if (!returnCashAccountId) { setError("اختر خزنة رد المبلغ"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestJson(`/api/sales/${sale.id}/returns`, { method: "POST", body: JSON.stringify({
        idempotencyKey: returnOperationId || crypto.randomUUID(), cashAccountId: returnCashAccountId, reason: returnReason, items: selectedItems,
      }) });
      setNotice(`تم تسجيل المرتجع بنجاح — مبلغ الرد ${money(Number(result.refundAmount))}`);
      setReturnSaleId(null); setReturnQuantities({}); setReturnReason(""); setReturnOperationId("");
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
      {canCreate && <form className="sale-form" onSubmit={createSale}>
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
      <div className="sales-list-heading"><h3>سجل الفواتير</h3><span className="footnote">آخر 100 فاتورة للفرع المحدد</span></div>
      <div className="table-wrap"><table className="sales-table"><thead><tr><th>الفاتورة</th><th>العميل</th><th>نوع البيع</th><th>المرجعي / النهائي</th><th>المدفوع</th><th>المتبقي</th><th>التسليم</th><th>التفاصيل</th></tr></thead><tbody>
        {filteredSales.map((sale) => <Fragment key={sale.id}><tr><td><strong>#{sale.invoice_number}</strong><small>{date(sale.created_at)}</small></td><td><strong>{sale.customer?.full_name ?? "عميل غير متاح"}</strong><small>{sale.branch?.name ?? ""}</small></td><td>{saleTypeLabels[sale.sale_type] ?? sale.sale_type}</td><td><small>مرجعي {money(Number(sale.reference_total ?? sale.total_amount))}</small><strong>{money(Number(sale.grand_total))}</strong></td><td>{money(sale.paid_amount)}</td><td className={sale.due_amount > 0 ? "balance-due" : "balance-paid"}>{money(sale.due_amount)}</td><td>{canUpdateDelivery ? <select aria-label={`حالة تسليم الفاتورة ${sale.invoice_number}`} className="status-select" value={sale.delivery_status} disabled={busy || sale.delivery_status === "cancelled"} onChange={(event) => void updateStatus(sale.id, event.target.value as Sale["delivery_status"])}>{(["pending", "processing", "ready", "delivered"] as const).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select> : <span className="status active">{statusLabels[sale.delivery_status]}</span>}</td><td><button className="row-action" onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}>{expandedId === sale.id ? "إخفاء" : "عرض"}</button></td></tr>
          {expandedId === sale.id && <tr key={`${sale.id}-details`}><td colSpan={8}><div className="sale-detail"><div><strong>الأسعار المرجعية للبنود</strong>{sale.items.map((item) => <p key={item.id}>{item.item_name} × {item.quantity} <span>{money(Number(item.line_total))}</span></p>)}<p><strong>إجمالي البيع النهائي</strong><span>{money(Number(sale.grand_total))}</span></p></div>{sale.prescription && Object.keys(sale.prescription).length > 0 && <div><strong>العدسات والوصفة</strong><p>{String(sale.prescription.lensCompany ?? "")} — {String(sale.prescription.lensTypeName ?? "")}</p><p>اليمنى: {String(sale.prescription.rightSphere ?? "—")} / {String(sale.prescription.rightCylinder ?? "—")} / {String(sale.prescription.rightAxis ?? "—")}</p><p>اليسرى: {String(sale.prescription.leftSphere ?? "—")} / {String(sale.prescription.leftCylinder ?? "—")} / {String(sale.prescription.leftAxis ?? "—")}</p><p>ADD: {String(sale.prescription.add ?? "—")} · PD: {String(sale.prescription.pupilDistance ?? "—")}</p></div>}{sale.notes && <div><strong>ملاحظات</strong><p>{sale.notes}</p></div>}<div><strong>الدفعات</strong>{sale.payments.map((payment) => <p key={payment.id}>{money(Number(payment.amount))} · {methodLabels[payment.payment_method] ?? payment.payment_method} <small>{date(payment.created_at)}</small></p>)}{sale.payments.length === 0 && <p>لم تسجل دفعات بعد.</p>}</div>
            {canPay && sale.due_amount > 0 && <form className="payment-form" onSubmit={(event) => void recordPayment(event, sale.id)}><label>دفعة جديدة<input type="number" min="0.01" max={sale.due_amount} step="0.01" required value={(paymentDrafts[sale.id] ?? { amount: "", paymentMethod: "cash", operationId: "" }).amount} onChange={(event) => setPaymentDrafts({ ...paymentDrafts, [sale.id]: { ...(paymentDrafts[sale.id] ?? { paymentMethod: "cash", operationId: crypto.randomUUID() }), amount: event.target.value, operationId: crypto.randomUUID() } })} /></label><label>طريقة الدفع<select value={(paymentDrafts[sale.id] ?? { amount: "", paymentMethod: "cash", operationId: "" }).paymentMethod} onChange={(event) => setPaymentDrafts({ ...paymentDrafts, [sale.id]: { ...(paymentDrafts[sale.id] ?? { amount: "", operationId: crypto.randomUUID() }), paymentMethod: event.target.value, operationId: crypto.randomUUID() } })}><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="instapay">إنستاباي</option><option value="other">أخرى</option></select></label><button className="primary" disabled={busy}>تسجيل الدفعة</button></form>}
            {canPay && sale.delivery_status !== "cancelled" && <div className="sale-return-area">
              <button type="button" className="row-action" disabled={busy} onClick={() => void openReturnForm(sale)}>
                {returnSaleId === sale.id ? "إلغاء المرتجع" : "إنشاء مرتجع"}
              </button>
              {returnSaleId === sale.id && <form className="payment-form sale-return-form" onSubmit={(event) => void submitReturn(event, sale)}>
                <div><strong>مرتجع الفاتورة #{sale.invoice_number}</strong><p className="footnote">حدد الكميات المراد إرجاعها. المبلغ النهائي يعتمد على قواعد الخصم والمبالغ المدفوعة في قاعدة البيانات.</p></div>
                {sale.items.map((item) => <label key={item.id} className="return-item-row">
                  <span>{item.item_name} · المباع {item.quantity}</span>
                  <input aria-label={`كمية مرتجعة من ${item.item_name}`} type="number" min="0" max={item.quantity} step="1"
                    value={returnQuantities[item.id] ?? 0}
                    onChange={(event) => { setReturnQuantities((current) => ({ ...current, [item.id]: Math.max(0, Math.min(item.quantity, Number(event.target.value) || 0)) })); setReturnOperationId(crypto.randomUUID()); }} />
                </label>)}
                <label>خزنة رد المبلغ<select required value={returnCashAccountId} onChange={(event) => { setReturnCashAccountId(event.target.value); setReturnOperationId(crypto.randomUUID()); }}>
                  <option value="">اختر الخزنة</option>{returnAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {methodLabels[account.payment_method] ?? account.payment_method}</option>)}
                </select></label>
                <label>سبب المرتجع<textarea required minLength={3} maxLength={500} rows={2} value={returnReason} onChange={(event) => { setReturnReason(event.target.value); setReturnOperationId(crypto.randomUUID()); }} placeholder="اكتب سبب إرجاع الصنف" /></label>
                <button className="primary" disabled={busy || !returnCashAccountId || !returnReason.trim() || !sale.items.some((item) => Number(returnQuantities[item.id]) > 0)}>{busy ? "جارٍ تسجيل المرتجع…" : "تأكيد المرتجع ورد المبلغ"}</button>
              </form>}
            </div>}
          </div></td></tr>}</Fragment>)}
        {filteredSales.length === 0 && <tr><td colSpan={8} className="table-empty">{search ? "لا توجد نتائج مطابقة." : "لا توجد فواتير في هذا الفرع بعد."}</td></tr>}
      </tbody></table></div>
    </>}
    <p className="footnote">السعر النهائي يُدخل مرة واحدة للفاتورة. أسعار البنود والعدسات مرجعية ومحفوظة كنسخة تاريخية، ومخزون المنتجات يُخصم عند اعتماد البيع.</p>
  </section>;
}
