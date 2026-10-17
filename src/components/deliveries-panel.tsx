"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Branch = { id: string; name: string; code: string; status: "ACTIVE" | "INACTIVE" };
type Item = { item_name: string; quantity: number; unit_price: number; line_total: number };
type CashAccount = { id: string; branch_id: string; name: string; payment_method: string };
type Sale = {
  id: string; invoice_number: number; branch_id: string; total_amount: number; discount_amount: number; delivery_status: "pending" | "processing" | "ready" | "delivered"; grand_total: number; paid_amount: number; due_amount: number; notes: string | null; created_at: string;
  customers: { full_name: string; phone: string } | null; branches: { name: string } | null; sale_items?: Item[];
};
const STATUSES = ["pending", "processing", "ready", "delivered"] as const;
const statusLabel: Record<string, string> = { pending: "جديد", processing: "قيد التجهيز", ready: "جاهز", delivered: "تم التسليم" };
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("ar-EG");

const PRINT_CSS = `*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#1e292c;margin:24px;font-size:13px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px}.meta{color:#69767a;font-size:12px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #cfd8d3;padding:7px 9px;text-align:right;vertical-align:top}th{background:#eef4f0;font-size:12px}small{display:block;color:#69767a;font-size:11px}
.totals{margin-top:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.totals div{border:1px solid #cfd8d3;border-radius:8px;padding:8px 10px}.totals b{display:block;font-size:15px;margin-top:2px}.due b{color:#a34039}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:46px}.sign div{border-top:1px solid #1e292c;padding-top:6px;text-align:center;font-size:12px}.brand{font-size:12px;color:#27685f;font-weight:bold;margin-bottom:10px}
@media print{body{margin:10mm}}`;

/** Print an HTML document through a hidden iframe (no pop-up window needed). */
function printHtml(title: string, body: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.srcdoc = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
  frame.onload = () => { const w = frame.contentWindow; if (!w) return; w.focus(); w.print(); setTimeout(() => frame.remove(), 60000); };
  document.body.appendChild(frame);
}

function printList(rows: Sale[], branchName: string, filters: string) {
  const total = rows.reduce((s, r) => s + Number(r.grand_total), 0), paid = rows.reduce((s, r) => s + r.paid_amount, 0), due = rows.reduce((s, r) => s + r.due_amount, 0);
  printHtml("قائمة التسليمات", `<div class="brand">نظرة | إدارة الفروع</div><h1>قائمة التسليمات</h1><div class="meta">${esc(branchName)} — ${esc(filters)} — طُبعت ${esc(new Date().toLocaleString("ar-EG"))}</div>
  <table><thead><tr><th>#</th><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الهاتف</th><th>الفرع</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>#${r.invoice_number}</td><td>${esc(dateOf(r.created_at))}</td><td>${esc(r.customers?.full_name)}</td><td>${esc(r.customers?.phone)}</td><td>${esc(r.branches?.name)}</td><td>${esc(money(Number(r.grand_total)))}</td><td>${r.due_amount > 0 ? esc(money(r.due_amount)) : "—"}</td><td>${esc(statusLabel[r.delivery_status])}</td></tr>`).join("") || `<tr><td colspan="9">لا توجد فواتير مطابقة</td></tr>`}</tbody></table>
  <div class="totals"><div>عدد الفواتير<b>${rows.length}</b></div><div>الإجمالي<b>${esc(money(total))}</b></div><div class="due">المتبقي<b>${esc(money(due))}</b></div></div><div class="meta" style="margin-top:8px">المدفوع: ${esc(money(paid))}</div>`);
}

function printSlip(s: Sale) {
  const items = s.sale_items ?? [];
  printHtml(`فاتورة ${s.invoice_number}`, `<div class="brand">نظرة | إدارة الفروع</div><h1>فاتورة #${s.invoice_number}</h1><div class="meta">${esc(s.branches?.name)} — ${esc(dateOf(s.created_at))} — الحالة: ${esc(statusLabel[s.delivery_status])}</div>
  <h2>العميل</h2><table><tbody><tr><th>الاسم</th><td>${esc(s.customers?.full_name)}</td><th>الهاتف</th><td>${esc(s.customers?.phone)}</td></tr></tbody></table>
  <h2>البنود</h2><table><thead><tr><th>البند</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.item_name)}</td><td>${esc(i.quantity)}</td><td>${esc(money(Number(i.unit_price)))}</td><td>${esc(money(Number(i.line_total)))}</td></tr>`).join("") || `<tr><td colspan="4">—</td></tr>`}</tbody></table>
  <div class="totals"><div>الإجمالي<b>${esc(money(Number(s.grand_total)))}</b></div><div>المدفوع<b>${esc(money(s.paid_amount))}</b></div><div class="due">المتبقي<b>${esc(money(s.due_amount))}</b></div></div>
  ${s.notes ? `<h2>ملاحظات</h2><p>${esc(s.notes)}</p>` : ""}<div class="sign"><div>توقيع المستلم</div><div>توقيع الموظف</div></div>`);
}

export default function DeliveriesPanel({ branches, branchIds, isOwner }: { branches: Branch[]; branchIds: string[]; isOwner: boolean }) {
  const available = useMemo(() => branches.filter((b) => b.status === "ACTIVE" && (isOwner || branchIds.includes(b.id))), [branches, branchIds, isOwner]);
  const [branchId, setBranchId] = useState("");
  const [sales, setSales] = useState<Sale[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string>>({});
  const [deliveryDialogSaleId, setDeliveryDialogSaleId] = useState<string | null>(null);
  const [discountDraft, setDiscountDraft] = useState("0");
  const [status, setStatus] = useState<"all" | (typeof STATUSES)[number]>("all");
  const [payment, setPayment] = useState<"all" | "due" | "paid">("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/operations?module=deliveries${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل التسليمات");
      setSales(j.sales ?? []); setCashAccounts(j.accounts ?? []); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل التسليمات"); }
  }, [branchId]);
  useEffect(() => { void load(); }, [load]);

  async function deliverAndCollect(saleId: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "deliverAndCollect", saleId, cashAccountId: selectedAccounts[saleId] ?? "", discountAmount: Number(discountDraft || 0) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تسليم الفاتورة وتسجيل المتبقي");
      setSelectedAccounts((current) => { const next = { ...current }; delete next[saleId]; return next; });
      setDeliveryDialogSaleId(null); setDiscountDraft("0");
      setNotice("تم تسليم الفاتورة وتسجيل الخصم والتحصيل في حساب الخزنة المختار"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تسليم الفاتورة"); } finally { setBusy(false); }
  }

  async function updateStatus(saleId: string, next: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delivery", saleId, status: next, notes: "" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحديث الحالة");
      setNotice("تم تحديث حالة التسليم"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحديث الحالة"); } finally { setBusy(false); }
  }

  const q = search.trim().toLowerCase();
  const bySearchAndPayment = sales.filter((s) => (!q || [s.invoice_number, s.customers?.full_name, s.customers?.phone].some((x) => String(x ?? "").toLowerCase().includes(q))) && (payment === "all" || (payment === "due" ? s.due_amount > 0 : s.due_amount <= 0)));
  const counts = Object.fromEntries(STATUSES.map((k) => [k, bySearchAndPayment.filter((s) => s.delivery_status === k).length])) as Record<string, number>;
  const rows = bySearchAndPayment.filter((s) => status === "all" || s.delivery_status === status);
  const branchName = branchId ? (available.find((b) => b.id === branchId)?.name ?? "") : "كل الفروع";
  const filterText = [status === "all" ? "كل الحالات" : statusLabel[status], payment === "all" ? "" : payment === "due" ? "عليها متبقي" : "مسددة بالكامل", q ? `بحث: ${search.trim()}` : ""].filter(Boolean).join(" · ");

  return (
    <section className="panel operations-panel deliveries-panel">
      <div className="section-heading"><div><p className="eyebrow">دورة الطلب</p><h2>التسليمات</h2></div>
        <button type="button" className="row-action" onClick={() => printList(rows, branchName, filterText)} disabled={!rows.length}>🖨 طباعة القائمة ({rows.length})</button></div>
      {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
      <div className="ops-toolbar">
        <label className="ops-branch">الفرع<select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">كل الفروع</option>{available.map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
        <label>بحث برقم الفاتورة أو اسم/رقم العميل<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث دون اختيار مسبق" /></label>
        <label>حالة الدفع<select value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)}><option value="all">الكل</option><option value="due">عليها متبقي</option><option value="paid">مسددة بالكامل</option></select></label>
      </div>
      <div className="status-filters" role="group" aria-label="حالة الفاتورة">
        <button type="button" className={`status-chip ${status === "all" ? "on" : ""}`} aria-pressed={status === "all"} onClick={() => setStatus("all")}>الكل <b>{bySearchAndPayment.length}</b></button>
        {STATUSES.map((k) => <button type="button" key={k} className={`status-chip s-${k} ${status === k ? "on" : ""}`} aria-pressed={status === k} onClick={() => setStatus(k)}>{statusLabel[k]} <b>{counts[k]}</b></button>)}
      </div>
      <div className="table-wrap"><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>الفرع</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th><th>تحديث التسليم</th><th>حساب الخزنة للتحصيل</th><th>تسليم</th><th>طباعة</th></tr></thead><tbody>
        {rows.map((s) => <tr key={s.id}><td>#{s.invoice_number}<small>{dateOf(s.created_at)}</small></td><td>{s.customers?.full_name}<small>{s.customers?.phone}</small></td><td>{s.branches?.name}</td><td>{money(Number(s.grand_total))}</td><td>{s.due_amount > 0 ? <strong className="due">{money(s.due_amount)}</strong> : "—"}</td>
          <td><span className={`status-pill s-${s.delivery_status}`}>{statusLabel[s.delivery_status]}</span></td>
          <td><select className="status-select" aria-label={`حالة الفاتورة ${s.invoice_number}`} value={s.delivery_status} disabled={busy || s.delivery_status === "delivered"} onChange={(e) => void updateStatus(s.id, e.target.value)}>{STATUSES.map((x) => <option value={x} key={x}>{statusLabel[x]}</option>)}</select></td>
          <td>{s.due_amount > 0 ? <select className="status-select" aria-label={`حساب خزنة تحصيل الفاتورة ${s.invoice_number}`} value={selectedAccounts[s.id] ?? ""} disabled={busy || s.delivery_status === "delivered"} onChange={(e) => setSelectedAccounts((current) => ({ ...current, [s.id]: e.target.value }))}><option value="">اختر حساب الخزنة</option>{cashAccounts.filter((account) => account.branch_id === s.branch_id).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select> : "لا يوجد متبقي"}</td><td><button type="button" className="row-action" disabled={busy || s.delivery_status === "delivered" || (s.due_amount > 0 && !selectedAccounts[s.id])} onClick={() => { setDeliveryDialogSaleId(s.id); setDiscountDraft("0"); }}>تسليم</button></td><td><button type="button" className="row-action" onClick={() => printSlip(s)} aria-label={`طباعة الفاتورة ${s.invoice_number}`}>🖨</button></td></tr>)}
        {rows.length === 0 && <tr><td colSpan={10} className="table-empty">لا توجد طلبات مطابقة.</td></tr>}
      </tbody></table></div>
      <p className="footnote">كل تغيير حالة يُحفظ في سجل تسليم الفاتورة. القائمة تعرض آخر 200 فاتورة غير ملغاة.</p>
      {deliveryDialogSaleId && (() => {
        const sale = sales.find((row) => row.id === deliveryDialogSaleId);
        if (!sale) return null;
        const discount = Number(discountDraft || 0);
        const newTotal = Number(sale.total_amount) - discount;
        const newDue = newTotal - Number(sale.paid_amount);
        const accountsForSale = cashAccounts.filter((account) => account.branch_id === sale.branch_id);
        return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeliveryDialogSaleId(null); }}>
          <section className="panel" role="dialog" aria-modal="true" aria-labelledby="delivery-confirm-title" style={{ width: "min(720px, 96vw)", maxHeight: "90vh", overflowY: "auto", margin: "auto" }}>
            <div className="section-heading"><div><p className="eyebrow">مراجعة قبل التسليم</p><h2 id="delivery-confirm-title">تسليم الفاتورة #{sale.invoice_number}</h2></div><button type="button" className="row-action" disabled={busy} onClick={() => setDeliveryDialogSaleId(null)}>إغلاق</button></div>
            <div className="ops-toolbar">
              <div><small>العميل</small><strong>{sale.customers?.full_name ?? "—"}</strong></div>
              <div><small>الفرع</small><strong>{sale.branches?.name ?? "—"}</strong></div>
              <div><small>رقم الهاتف</small><strong>{sale.customers?.phone ?? "—"}</strong></div>
            </div>
            <div className="table-wrap"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>
              {(sale.sale_items ?? []).map((item, index) => <tr key={`${item.item_name}-${index}`}><td>{item.item_name}</td><td>{item.quantity}</td><td>{money(Number(item.unit_price))}</td><td>{money(Number(item.line_total))}</td></tr>)}
              {!(sale.sale_items ?? []).length && <tr><td colSpan={4}>لا توجد تفاصيل أصناف متاحة.</td></tr>}
            </tbody></table></div>
            <div className="ops-toolbar">
              <div><small>إجمالي الأصناف قبل الخصم</small><strong>{money(Number(sale.total_amount))}</strong></div>
              <label>الخصم على الفاتورة<input type="number" min="0" max={Math.max(0, Number(sale.total_amount))} step="0.01" value={discountDraft} onChange={(event) => setDiscountDraft(event.target.value)} /></label>
              <div><small>الإجمالي بعد الخصم</small><strong>{money(newTotal)}</strong></div>
              <div><small>المدفوع سابقًا</small><strong>{money(Number(sale.paid_amount))}</strong></div>
              <div><small>المتبقي المطلوب تحصيله</small><strong>{money(newDue)}</strong></div>
            </div>
            {newDue > 0.009 ? <label>حساب الخزنة / وسيلة الدفع
              <select value={selectedAccounts[sale.id] ?? ""} onChange={(event) => setSelectedAccounts((current) => ({ ...current, [sale.id]: event.target.value }))}>
                <option value="">اختر حساب الخزنة</option>
                {accountsForSale.map((account) => <option key={account.id} value={account.id}>{account.name} — {({cash:"نقدي",card:"بطاقة",instapay:"إنستاباي",other:"أخرى"} as Record<string,string>)[account.payment_method] ?? account.payment_method}</option>)}
              </select>
            </label> : <p>لا يوجد مبلغ متبقٍ للتحصيل بعد الخصم.</p>}
            {discount < 0 || !Number.isFinite(discount) || discount > Number(sale.total_amount) ? <div className="notice error">قيمة الخصم غير صحيحة.</div> : null}
            <div className="section-heading"><span>سيتم تسجيل الخصم والتحصيل وتحديث حالة الفاتورة معًا.</span><button type="button" className="primary-button" disabled={busy || discount < 0 || !Number.isFinite(discount) || discount > Number(sale.total_amount) || (newDue > 0.009 && !selectedAccounts[sale.id])} onClick={() => void deliverAndCollect(sale.id)}>{busy ? "جارٍ الحفظ…" : "تأكيد التسليم"}</button></div>
          </section>
        </div>;
      })()}
    </section>
  );
}
